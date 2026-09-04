/**
 * Retention, sealing and court-ordered destruction.
 *
 * ## The registry
 *
 * The dangerous failure in this feature is not destroying too much. It is
 * destroying too little — a court orders a record gone, somebody signs a
 * certificate saying it is gone, and two years later it turns up in a table
 * nobody remembered. So every collection that can hold case data is declared
 * in one list below, with how to find its rows and how to purge them. Adding a
 * collection to this system without adding it here is the mistake this shape
 * exists to make visible: the list is the checklist.
 *
 * ## What "destroyed" means
 *
 * Rows are deleted and files are unlinked. The audit log is not — its entries
 * keep their place and their hash and lose their content, so the log still
 * proves nothing was inserted or removed while no longer saying what the
 * destroyed entries were about. See `verifyLinks` for why.
 *
 * ## Two people
 *
 * One person writes the order down and proposes it; a different person carries
 * it out. Both need `records.expunge`, which nobody holds by role. It is the
 * same shape as a two-signature drug destruction, for the same reason.
 */

import { existsSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, documents } from './db';
import { newId } from './ids';
import { requireAuth, requirePermission } from './auth';
import { can } from '../src/domain/auth';
import { recordAudit, readAuditLog } from './audit';
import { isRedacted, redactEntry, type AuditEntry } from '../src/domain/audit';
import {
  blockingProblems,
  canExecute,
  certificateFor,
  checkOrder,
  createOrder,
  needsTwoPeople,
  nextOrderReference,
  type DisposalOrder,
  type ManifestLine,
  type OrderKind,
  type ScopeKind,
} from '../src/domain/retention';
import type { Incident } from '../src/domain/types';
import type { MasterPerson } from '../src/domain/person';

const orders = documents<DisposalOrder>(DOC_TABLES.disposalOrders);
const incidents = documents<Incident>(DOC_TABLES.incidents);
const people = documents<MasterPerson>(DOC_TABLES.people);

const ORDER_KINDS: OrderKind[] = ['seal', 'unseal', 'expunge'];
const SCOPES: ScopeKind[] = ['case', 'person'];

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);
const day = (value: unknown): string => {
  const raw = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
};
function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/* ------------------------------------------------------------------ */
/* The registry                                                        */
/* ------------------------------------------------------------------ */

interface Row {
  id: string;
  /** Shown in the preview so nobody signs blind. Never in the certificate. */
  label: string;
  /** Files on disk this row owns, relative to the data directory. */
  files?: string[];
}

interface Holder {
  /** What a records manager would call it. */
  kind: string;
  /** Everything this collection holds for one case. */
  byCase: (db: DatabaseSync, caseId: string) => Row[];
  /**
   * Everything it holds for one identity.
   *
   * `pending` is what the holders above have already put on this order's list.
   * Only one holder needs it, and it needs it badly: whether a name index
   * entry may go depends on whether any case still points at it *after* this
   * order runs, and every one of those cases is in `pending`.
   */
  byPerson: (db: DatabaseSync, masterId: string, pending: Set<string>) => Row[];
  /** Removes the rows. Files are unlinked by the caller. */
  purge: (db: DatabaseSync, ids: string[]) => void;
}

/** Rows out of a table where a column matches, mapped to `Row`. */
function query(
  db: DatabaseSync,
  table: string,
  column: string,
  value: string,
  label: (doc: Record<string, unknown>) => string,
  files: (doc: Record<string, unknown>) => string[] = () => [],
): Row[] {
  if (!value) return [];
  // The column and table names come from this file, never from a request.
  const rows = db
    .prepare(`SELECT id, doc FROM ${table} WHERE ${column} = ?`)
    .all(value) as { id: string; doc: string }[];
  return rows.map((row) => {
    const doc = JSON.parse(row.doc) as Record<string, unknown>;
    return { id: row.id, label: label(doc), files: files(doc) };
  });
}

const del = (table: string) => (db: DatabaseSync, ids: string[]) => {
  const statement = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
  for (const id of ids) statement.run(id);
};

/**
 * Every collection that can hold something about a case or a person.
 *
 * Read this as the answer to "what does the agency actually have on him". If a
 * collection is missing from this list, an expungement order will silently
 * leave its rows behind.
 */
const HOLDERS: Holder[] = [
  {
    kind: 'Incident reports',
    byCase: (db, id) => query(db, 'incidents', 'id', id, (d) => String(d.caseNumber ?? '')),
    byPerson: (db, masterId) =>
      (incidents.all(db) as Incident[])
        .filter((i) => i.persons.some((p) => p.masterId === masterId))
        .map((i) => ({ id: i.id, label: i.caseNumber })),
    purge: del('incidents'),
  },
  {
    kind: 'Supplements',
    byCase: (db, id) => query(db, 'supplements', 'case_id', id, (d) => `Supplement ${d.number ?? ''}`),
    byPerson: () => [],
    purge: del('supplements'),
  },
  {
    kind: 'Arrest records',
    byCase: (db, id) => query(db, 'arrests', 'case_id', id, (d) => String(d.arrestNumber ?? '')),
    byPerson: (db, masterId) =>
      query(db, 'arrests', 'master_id', masterId, (d) => String(d.arrestNumber ?? '')),
    purge: del('arrests'),
  },
  {
    kind: 'Crash reports',
    byCase: (db, id) => query(db, 'crashes', 'id', id, (d) => String(d.caseNumber ?? '')),
    byPerson: () => [],
    purge: del('crashes'),
  },
  {
    kind: 'Property and evidence',
    byCase: (db, id) => query(db, 'evidence', 'case_id', id, (d) => String(d.tagNumber ?? '')),
    byPerson: () => [],
    purge: (db, ids) => {
      // The custody ledger goes with the item. It is append-only against
      // editing, not against a court.
      const chain = db.prepare('DELETE FROM custody WHERE item_id = ?');
      const item = db.prepare('DELETE FROM evidence WHERE id = ?');
      for (const id of ids) {
        chain.run(id);
        item.run(id);
      }
    },
  },
  {
    kind: 'Attachments',
    byCase: (db, id) => {
      const rows = db
        .prepare('SELECT id, filename, mime FROM attachments WHERE incident_id = ?')
        .all(id) as { id: string; filename: string; mime: string }[];
      return rows.map((row) => ({
        id: row.id,
        label: row.filename,
        files: [join('attachments', `${row.id}.${extensionFor(row.mime)}`)],
      }));
    },
    byPerson: () => [],
    purge: del('attachments'),
  },
  {
    /*
      Warrants naming this person.

      Person-scoped only, like the trespass notices. A warrant is a fact about
      somebody, and a case-scoped order that swept up warrants would destroy
      court records that have nothing to do with the case.
    */
    kind: 'Warrants',
    byCase: () => [],
    byPerson: (db, masterId) =>
      query(
        db,
        'warrants',
        'person_id',
        masterId,
        (d) => `${String(d.kind ?? 'warrant')} ${String(d.number ?? '')} (${String(d.court ?? '')})`.trim(),
      ),
    purge: del('warrants'),
  },
  {
    /*
      Field contacts naming this person.

      These do not have a person_id column — a contact can name several people,
      and a subject may be a description rather than an identity — so the match
      is on the documents. A person-scoped order destroys the whole contact
      only when this person is the only subject on it; otherwise it would
      destroy somebody else's record along with theirs, and a contact naming
      three people is three people's record.
    */
    kind: 'Field contacts',
    byCase: () => [],
    byPerson: (db, masterId) => {
      const rows = db.prepare('SELECT id, doc FROM field_contacts').all() as {
        id: string;
        doc: string;
      }[];
      return rows
        .map((row) => ({ id: row.id, doc: JSON.parse(row.doc) as Record<string, unknown> }))
        .filter(({ doc }) => {
          const subjects = (doc.subjects ?? []) as { masterId?: string }[];
          const named = subjects.filter((s) => s.masterId);
          return named.length > 0 && named.every((s) => s.masterId === masterId);
        })
        .map(({ id, doc }) => ({
          id,
          label: `Field contact ${String(doc.number ?? '')} on ${String(doc.occurredAt ?? '').slice(0, 10)}`,
          files: [],
        }));
    },
    purge: del('field_contacts'),
  },
  {
    /*
      Trespass notices naming this person.

      Person-scoped only. A notice is a fact about somebody, not about a case,
      and a case-scoped order that swept up the notices served at the same
      address would destroy other people's records.
    */
    kind: 'Trespass notices',
    byCase: () => [],
    byPerson: (db, masterId) =>
      query(
        db,
        'trespasses',
        'person_id',
        masterId,
        (d) => `Barred from ${String(d.locationId ?? '')} from ${String(d.servedOn ?? '')}`,
      ),
    purge: del('trespasses'),
  },
  {
    kind: 'Photographs',
    byCase: () => [],
    byPerson: (db, masterId) =>
      query(
        db,
        'person_photos',
        'master_id',
        masterId,
        (d) => `${d.kind || 'photograph'} ${d.takenOn || ''}`.trim(),
        (d) => [join('photos', `${d.id}.${PHOTO_EXTENSION[String(d.mime)] ?? 'bin'}`)],
      ),
    purge: del('person_photos'),
  },
  {
    /*
      Traffic stops. Linked to a case only when the stop turned into one, which
      is the minority — so a case-scoped order catches those and a person-scoped
      order catches the rest by plate.
    */
    kind: 'Traffic stops',
    byCase: (db, id) => {
      const rows = db.prepare('SELECT id, doc FROM stops').all() as { id: string; doc: string }[];
      return rows
        .map((row) => ({ row, doc: JSON.parse(row.doc) as Record<string, unknown> }))
        .filter(({ doc }) => doc.incidentId === id)
        .map(({ row, doc }) => ({ id: row.id, label: String(doc.plate || doc.location || '') }));
    },
    byPerson: (db, masterId) => {
      const person = people.find(db, masterId);
      if (!person) return [];
      const plates = vehiclePlatesFor(db, person);
      if (plates.size === 0) return [];
      const rows = db.prepare('SELECT id, doc FROM stops').all() as { id: string; doc: string }[];
      return rows
        .map((row) => ({ row, doc: JSON.parse(row.doc) as Record<string, unknown> }))
        .filter(({ doc }) => plates.has(String(doc.plate ?? '').toUpperCase()))
        .map(({ row, doc }) => ({ id: row.id, label: String(doc.plate ?? '') }));
    },
    purge: del('stops'),
  },
  {
    /*
      What the DMV and the interstate system sent back — a licence with a date
      of birth on it, a registration with an address. As much about the person
      as anything they typed, and the collection this registry missed first
      time: nothing about a return says which case it belongs to, so it was
      quietly out of scope until a test went looking for the name in the
      database file.

      Matched on the name in the return itself, which is over-inclusive across
      two people with one name. That is why the preview lists them with
      examples: somebody reads it before anything is destroyed.
    */
    kind: 'Query returns from DMV and NLETS',
    /*
      Nothing on a return points at an incident — they arrive grouped by
      dispatch call, which an incident report does not carry — so a
      case-scoped order does not reach them. Said out loud in the preview
      rather than left as a surprise: an order covering a person's records
      should be person-scoped, and one covering a case may need both.
    */
    byCase: () => [],
    byPerson: (db, masterId) => {
      const person = people.find(db, masterId);
      if (!person?.lastName) return [];
      const last = person.lastName.toLowerCase();
      const first = person.firstName.toLowerCase();
      const rows = db.prepare('SELECT id, doc FROM returns').all() as { id: string; doc: string }[];
      return rows
        .map((row) => ({ row, doc: JSON.parse(row.doc) as Record<string, unknown> }))
        .filter(({ doc }) => {
          const payload = (doc.payload ?? {}) as Record<string, unknown>;
          const names: [unknown, unknown][] = [
            [payload.lastName, payload.firstName],
            [payload.ownerLastName, payload.ownerFirstName],
          ];
          return names.some(
            ([l, f]) =>
              String(l ?? '').toLowerCase() === last &&
              (!first || String(f ?? '').toLowerCase() === first),
          );
        })
        .map(({ row, doc }) => ({ id: row.id, label: `${doc.kind ?? 'return'} ${doc.query ?? ''}`.trim() }));
    },
    purge: del('returns'),
  },
  {
    kind: 'Case to-do items',
    byCase: (db, id) => query(db, 'case_tasks', 'case_id', id, (d) => String(d.text ?? '')),
    byPerson: () => [],
    purge: del('case_tasks'),
  },
  {
    kind: 'Master name records',
    byCase: () => [],
    /*
      Only ever reached by a person-scoped order, and only when nothing else
      still points at the identity — a name shared with a case that was not
      part of the order stays, or the order would destroy somebody else's
      record. The rows above are purged first, so by the time this runs the
      question is about what is left.
    */
    byPerson: (db, masterId, pending) => {
      const person = people.find(db, masterId);
      if (!person) return [];
      /*
        Anything still pointing at this identity that is not itself being
        destroyed keeps it. A name shared with a case outside the order stays,
        or the order would reach a record it does not cover.
      */
      const stillReferenced = (incidents.all(db) as Incident[]).some(
        (i) => !pending.has(i.id) && i.persons.some((p) => p.masterId === masterId),
      );
      if (stillReferenced) return [];
      return [{ id: masterId, label: `${person.lastName}, ${person.firstName}` }];
    },
    purge: del('people'),
  },
];

/** Plates a person's registration returns name them as the owner of. */
function vehiclePlatesFor(db: DatabaseSync, person: MasterPerson): Set<string> {
  const last = person.lastName.toLowerCase();
  const rows = db.prepare('SELECT doc FROM returns').all() as { doc: string }[];
  const plates = new Set<string>();
  for (const row of rows) {
    const doc = JSON.parse(row.doc) as Record<string, unknown>;
    const payload = (doc.payload ?? {}) as Record<string, unknown>;
    if (String(payload.ownerLastName ?? '').toLowerCase() === last && payload.plate) {
      plates.add(String(payload.plate).toUpperCase());
    }
  }
  return plates;
}

const PHOTO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/webp': 'webp',
};

function extensionFor(mime: string): string {
  const map: Record<string, string> = {
    ...PHOTO_EXTENSION,
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
  };
  return map[mime] ?? 'bin';
}

interface Manifest {
  lines: ManifestLine[];
  /** Everything to delete, grouped so purging can run holder by holder. */
  work: { holder: Holder; rows: Row[] }[];
  auditMatches: AuditEntry[];
  /**
   * What this order does not reach, and why.
   *
   * The dangerous failure here is not destroying too much, it is destroying
   * too little — a certificate saying a record is gone while a copy of it sits
   * in a collection nobody thought about. Anything the registry knowingly
   * leaves out is said before the order is carried out, so the records manager
   * can raise the second order it needs rather than discovering the gap when
   * the court does.
   */
  gaps: string[];
}

/**
 * What an order would touch, before anybody signs it.
 *
 * Built freshly at preview and again at execution rather than stored between
 * the two. A manifest cached at proposal time would quietly go stale — a
 * report filed in between would survive an order that was supposed to cover
 * it, and the certificate would say otherwise.
 */
function manifestFor(db: DatabaseSync, order: DisposalOrder): Manifest {
  /*
    Built in order, each holder seeing what the ones before it have already
    claimed. The name index is last for exactly this reason: whether it may go
    is a question about what will be left, not about what is there now.
  */
  const pending = new Set<string>();
  const work: { holder: Holder; rows: Row[] }[] = [];

  for (const holder of HOLDERS) {
    const rows =
      order.scope === 'case'
        ? holder.byCase(db, order.subjectId)
        : holder.byPerson(db, order.subjectId, pending);
    for (const row of rows) pending.add(row.id);
    if (rows.length > 0) work.push({ holder, rows });
  }

  const lines: ManifestLine[] = work.map(({ holder, rows }) => ({
    kind: holder.kind,
    count: rows.length,
    examples: rows.slice(0, 4).map((r) => r.label).filter(Boolean),
  }));

  return { lines, work, auditMatches: auditMatching(db, order), gaps: gapsFor(order) };
}

/**
 * What the registry knows it cannot reach for this order.
 *
 * Kept next to the registry so the two are edited together. A holder that
 * returns nothing for a scope belongs in here saying so.
 */
function gapsFor(order: DisposalOrder): string[] {
  if (order.scope === 'case') {
    return [
      'Photographs of the people on this case. They belong to the identity, not the case, so an order covering somebody’s photographs has to name the person.',
      'Query returns from DMV and NLETS. Nothing on a return names the case it was run for.',
      'Crash reports naming the same people, unless the order names the crash itself.',
    ];
  }
  return [
    'Crash reports naming this person. A crash record identifies people by unit and driver, not by the name index.',
    'Notes left on a location, which may name somebody without pointing at their record.',
  ];
}

/**
 * Audit entries that name the subject.
 *
 * Matched on the words the log actually stores — a case number, a person's
 * name — because that is what an entry contains. Anything matched is
 * over-inclusive rather than under: an entry mentioning the case number is
 * about the case, and a court order to destroy the record of a case covers
 * the log's references to it.
 */
function auditMatching(db: DatabaseSync, order: DisposalOrder): AuditEntry[] {
  const needles = subjectNeedles(db, order).filter((n) => n.length >= 4);
  if (needles.length === 0) return [];
  return readAuditLog(db).filter(
    (entry) =>
      !isRedacted(entry) &&
      needles.some(
        (needle) =>
          entry.target.toLowerCase().includes(needle) ||
          entry.detail.toLowerCase().includes(needle),
      ),
  );
}

function subjectNeedles(db: DatabaseSync, order: DisposalOrder): string[] {
  if (order.scope === 'case') {
    const incident = incidents.find(db, order.subjectId);
    return [incident?.caseNumber ?? '', order.subjectId].map((s) => s.toLowerCase());
  }
  const person = people.find(db, order.subjectId);
  if (!person) return [order.subjectId.toLowerCase()];
  const name = [person.lastName, person.firstName].filter(Boolean).join(', ');
  return [name, person.businessName, order.subjectId]
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

/* ------------------------------------------------------------------ */
/* Seals                                                               */
/* ------------------------------------------------------------------ */

export interface Seal {
  subjectId: string;
  scope: string;
  orderRef: string;
  sealedAt: string;
  sealedBy: string;
}

export function listSeals(db: DatabaseSync): Seal[] {
  return (db.prepare('SELECT * FROM seals').all() as Record<string, string>[]).map((row) => ({
    subjectId: row.subject_id,
    scope: row.scope,
    orderRef: row.order_ref,
    sealedAt: row.sealed_at,
    sealedBy: row.sealed_by,
  }));
}

export const isSealed = (db: DatabaseSync, subjectId: string): boolean =>
  db.prepare('SELECT 1 FROM seals WHERE subject_id = ?').get(subjectId) !== undefined;

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export function registerRetentionRoutes(app: Express, db: DatabaseSync, dataDir: string): void {
  const root = resolve(dataDir);

  app.get('/api/retention', requirePermission('records.seal'), (_req, res: Response) => {
    res.json({ orders: orders.all(db), seals: listSeals(db) });
  });

  /**
   * Opening one sealed record.
   *
   * The only way to see a sealed record's contents, and it writes an access
   * event every time. Sealed records are left out of the bulk state pull even
   * for the people entitled to read them, precisely so that reading one has to
   * come through here — "who looked at this after it was sealed" is the
   * question a seal exists to be able to answer, and an answer that relies on
   * the client reporting itself is not one.
   */
  app.get('/api/retention/sealed/:subjectId', requirePermission('records.seal'), async (req, res) => {
    const user = req.user!;
    const subjectId = text(req.params.subjectId, 64);
    if (!isSealed(db, subjectId)) {
      res.status(404).json({ error: 'That record is not sealed.' });
      return;
    }

    const incident = incidents.find(db, subjectId);
    const person = incident ? null : people.find(db, subjectId);
    if (!incident && !person) {
      res.status(404).json({ error: 'No such record.' });
      return;
    }

    const reason = text(req.body?.reason ?? req.query.reason, 300);
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'records.sealedViewed',
      target: incident ? incident.caseNumber : subjectId,
      detail: reason,
    });

    res.json({
      incident: incident ?? null,
      person: person ?? null,
      supplements: incident
        ? documents<Record<string, unknown>>(DOC_TABLES.supplements).where(db, {
            case_id: subjectId,
          })
        : [],
      arrests: documents<Record<string, unknown>>(DOC_TABLES.arrests).where(db, {
        case_id: subjectId,
      }),
    });
  });

  /** What this order would destroy, worked out now rather than remembered. */
  app.get('/api/retention/orders/:id/preview', requirePermission('records.seal'), (req, res) => {
    const order = orders.find(db, req.params.id);
    if (!order) {
      res.status(404).json({ error: 'No such order.' });
      return;
    }
    const manifest = manifestFor(db, order);
    res.json({
      lines: manifest.lines,
      auditEntries: manifest.auditMatches.length,
      gaps: manifest.gaps,
      problems: checkOrder(order),
    });
  });

  app.post('/api/retention/orders', requirePermission('records.seal'), (req, res: Response) => {
    const user = req.user!;
    const body = req.body ?? {};
    const scope = oneOf(body.scope, SCOPES, 'case');
    const subjectId = text(body.subjectId, 64);

    const subject =
      scope === 'case' ? incidents.find(db, subjectId) : people.find(db, subjectId);
    if (!subject) {
      res.status(404).json({ error: `No such ${scope}.` });
      return;
    }

    const order = createOrder({
      id: newId('ord'),
      reference: nextOrderReference(orders.columnValues(db, 'reference')),
      kind: oneOf(body.kind, ORDER_KINDS, 'seal'),
      court: text(body.court, 200),
      docket: text(body.docket, 100),
      orderedOn: day(body.orderedOn),
      instruction: text(body.instruction, 4000),
      scope,
      subjectId,
      subjectLabel:
        scope === 'case'
          ? (subject as Incident).caseNumber
          : [(subject as MasterPerson).lastName, (subject as MasterPerson).firstName]
              .filter(Boolean)
              .join(', '),
      createdBy: user.id,
      createdByName: user.name,
    });

    orders.save(db, order);
    res.json({ order, problems: checkOrder(order) });
  });

  /**
   * Proposing. The first of the two people.
   *
   * Everything the order says is fixed at this point — a proposal that can be
   * edited while it waits is a proposal the second person is not really
   * agreeing to.
   */
  app.post('/api/retention/orders/:id/propose', requirePermission('records.seal'), async (req, res) => {
    const user = req.user!;
    const order = orders.find(db, req.params.id);
    if (!order) {
      res.status(404).json({ error: 'No such order.' });
      return;
    }
    if (order.status !== 'draft') {
      res.status(409).json({ error: 'This order has already been proposed.' });
      return;
    }

    const blocking = blockingProblems(checkOrder(order));
    if (blocking.length > 0) {
      res.status(400).json({
        error: `${blocking.length} ${blocking.length === 1 ? 'thing' : 'things'} to fix first.`,
        problems: checkOrder(order),
      });
      return;
    }
    if (order.kind === 'expunge' && !can(user, 'records.expunge')) {
      res.status(403).json({
        error: 'Proposing a destruction order needs the authority to carry one out.',
      });
      return;
    }

    const next: DisposalOrder = {
      ...order,
      status: 'proposed',
      proposedBy: user.id,
      proposedByName: user.name,
      proposedAt: new Date().toISOString(),
    };
    orders.save(db, next);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'records.orderProposed',
      target: order.reference,
      detail: `${order.kind} · ${order.court} ${order.docket}`,
    });

    res.json({ order: next });
  });

  /** Carrying it out. The second person, and never the first. */
  app.post('/api/retention/orders/:id/execute', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const order = orders.find(db, req.params.id);
    if (!order) {
      res.status(404).json({ error: 'No such order.' });
      return;
    }

    const needed = order.kind === 'expunge' ? 'records.expunge' : 'records.seal';
    if (!can(user, needed)) {
      res.status(403).json({
        error:
          order.kind === 'expunge'
            ? 'Carrying out a destruction order needs the authority to do it.'
            : 'You do not have permission to seal records.',
      });
      return;
    }

    if (needsTwoPeople(order.kind)) {
      const allowed = canExecute(order, user.id);
      if (!allowed.ok) {
        res.status(403).json({ error: allowed.reason });
        return;
      }
    } else if (order.status === 'executed') {
      res.status(409).json({ error: 'This order has already been carried out.' });
      return;
    }

    const at = new Date().toISOString();
    let certificate = null;
    let redactedCount = 0;

    if (order.kind === 'seal') {
      db.prepare(
        `INSERT INTO seals (subject_id, scope, order_ref, sealed_at, sealed_by)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(subject_id) DO UPDATE SET
           order_ref = excluded.order_ref, sealed_at = excluded.sealed_at,
           sealed_by = excluded.sealed_by`,
      ).run(order.subjectId, order.scope, order.reference, at, user.name);
    } else if (order.kind === 'unseal') {
      db.prepare('DELETE FROM seals WHERE subject_id = ?').run(order.subjectId);
    } else {
      /*
        Destruction. Worked out again here rather than trusting the manifest
        shown at proposal time: anything filed in between is covered too, and
        the certificate says what actually went.
      */
      const manifest = manifestFor(db, order);

      for (const { holder, rows } of manifest.work) {
        for (const row of rows) {
          for (const file of row.files ?? []) {
            const path = join(root, file);
            if (existsSync(path)) unlinkSync(path);
          }
        }
        holder.purge(db, rows.map((r) => r.id));
      }

      // A lock outlives the record it was held on, and a stale lock naming a
      // destroyed id is a reference to it.
      const unlock = db.prepare('DELETE FROM edit_locks WHERE resource_id = ?');
      for (const { rows } of manifest.work) for (const row of rows) unlock.run(row.id);

      // Content out of the matching audit entries; hashes and links left alone.
      const statement = db.prepare(
        'UPDATE audit_log SET target = ?, detail = ?, redacted_by = ?, redacted_at = ? WHERE id = ?',
      );
      for (const entry of manifest.auditMatches) {
        const gone = redactEntry(entry, order.reference, at);
        statement.run(gone.target, gone.detail, gone.redactedBy!, gone.redactedAt!, entry.id);
      }
      redactedCount = manifest.auditMatches.length;

      db.prepare('DELETE FROM seals WHERE subject_id = ?').run(order.subjectId);

      certificate = certificateFor(
        { ...order, executedByName: user.name },
        manifest.lines,
        redactedCount,
        at,
      );
    }

    /*
      The order itself loses its subject once carried out. An expungement order
      that still names the case it destroyed has destroyed nothing — the name
      would sit in this table forever. What is left is the court's own
      reference, which is public record, and the certificate.
    */
    const destroyed = order.kind === 'expunge';
    const next: DisposalOrder = {
      ...order,
      status: 'executed',
      executedBy: user.id,
      executedByName: user.name,
      executedAt: at,
      certificate,
      subjectId: destroyed ? '' : order.subjectId,
      subjectLabel: destroyed ? '' : order.subjectLabel,
      instruction: destroyed ? order.instruction : order.instruction,
    };
    orders.save(db, next);

    if (destroyed) {
      /*
        Actually gone, not just unreachable — and only once the order row above
        has been rewritten without its subject.

        `secure_delete` zeroes a row's content as it is deleted, but the
        write-ahead log still holds the pages as they were, and a page freed
        earlier may still carry readable text. Checkpointing folds the log back
        into the file and VACUUM rebuilds it without the free pages, after
        which the destroyed content cannot be read out of the database with a
        hex editor.

        The ordering is the part that took a test to find: vacuuming before
        saving the order left the previous version of the order row in the
        file, still naming the case it had just destroyed.
      */
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.exec('VACUUM');
    }

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: order.kind === 'expunge' ? 'records.expunged' : 'records.sealed',
      // The order reference, never the subject: this entry outlives the record.
      target: order.reference,
      detail:
        order.kind === 'expunge'
          ? `${certificate?.destroyed ?? 0} ${(certificate?.destroyed ?? 0) === 1 ? 'record' : 'records'}, ${redactedCount} log ${redactedCount === 1 ? 'entry' : 'entries'}`
          : `${order.kind} · ${order.court} ${order.docket}`,
    });

    res.json({ order: next, certificate });
  });

  app.post('/api/retention/orders/:id/withdraw', requirePermission('records.seal'), async (req, res) => {
    const user = req.user!;
    const order = orders.find(db, req.params.id);
    if (!order) {
      res.status(404).json({ error: 'No such order.' });
      return;
    }
    if (order.status === 'executed') {
      res.status(409).json({ error: 'This order has already been carried out.' });
      return;
    }
    const reason = text(req.body?.reason, 500).trim();
    if (!reason) {
      res.status(400).json({ error: 'Say why it is being withdrawn.' });
      return;
    }

    const next: DisposalOrder = { ...order, status: 'withdrawn', withdrawnReason: reason };
    orders.save(db, next);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'records.orderWithdrawn',
      target: order.reference,
      detail: reason,
    });

    res.json({ order: next });
  });
}
