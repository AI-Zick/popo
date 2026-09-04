/**
 * Warrant routes.
 *
 * Two reads matter and they are different shapes. "Is this person wanted" is
 * asked constantly, of one person, and travels with their record. "What is
 * outstanding across the agency" is the warrant clerk's screen and is answered
 * here with a filter and a page rather than by shipping every warrant the
 * agency has ever held to every browser.
 *
 * Nothing in here decides that a warrant is good. That is a phone call to the
 * issuing court, and every response carries the sentence saying so.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, documents } from './db';
import { newId } from './ids';
import { requireAuth } from './auth';
import { recordAudit } from './audit';
import { can } from '../src/domain/auth';
import {
  CONFIRMATION_NOTICE,
  checkAttempt,
  checkRecall,
  checkWarrant,
  createWarrant,
  createWarrantCharge,
  sortWarrants,
  today,
  warrantState,
  type Extradition,
  type ServiceAttempt,
  type Warrant,
  type WarrantCharge,
  type WarrantKind,
} from '../src/domain/warrant';
import type { MasterPerson } from '../src/domain/person';
import { displayName } from '../src/domain/person';

const warrants = documents<Warrant>(DOC_TABLES.warrants);
const people = documents<MasterPerson>(DOC_TABLES.people);

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);
const day = (value: unknown): string => {
  const raw = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
};

const KINDS: WarrantKind[] = ['', 'arrest', 'bench', 'capias', 'search', 'civil', 'probation'];
const EXTRADITION: Extradition[] = ['', 'none', 'county', 'state', 'surrounding', 'national'];

const oneOf = <T extends string>(value: unknown, allowed: T[], fallback: T): T =>
  (allowed as string[]).includes(String(value ?? '')) ? (value as T) : fallback;

function chargesFrom(input: unknown): WarrantCharge[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 30).map((raw) => {
    const charge = (raw ?? {}) as Record<string, unknown>;
    return createWarrantCharge({
      id: text(charge.id, 64) || newId('wc'),
      statute: text(charge.statute, 60).trim(),
      description: text(charge.description, 200).trim(),
      severity: text(charge.severity, 20).trim(),
      counts: text(charge.counts, 4).trim(),
    });
  });
}

const stringList = (input: unknown, max: number, each: number): string[] =>
  Array.isArray(input) ? input.slice(0, max).map((item) => text(item, each).trim()).filter(Boolean) : [];

/*
  Outstanding, in SQL.

  Written once so the count and the page cannot disagree. An empty served,
  recalled and expiry column is what "still standing" means; the expiry
  comparison uses >= because the last day is a day it stands.
*/
const OUTSTANDING = "served_on = '' AND recalled_on = '' AND (expires_on = '' OR expires_on >= ?)";

/**
 * Who is wanted, in the smallest form that answers the question.
 *
 * Enough for a name search to raise an alert, and deliberately not enough to
 * be a warrant file: no charge, no court, no bond. Somebody who needs those
 * opens the record, which is a read the server can log.
 */
export interface WantedEntry {
  count: number;
  /** True when at least one of them is extraditable nationally. */
  national: boolean;
}

export function outstandingWarrants(db: DatabaseSync): Record<string, WantedEntry> {
  const rows = db
    .prepare(`SELECT person_id, doc FROM warrants WHERE ${OUTSTANDING}`)
    .all(today()) as { person_id: string; doc: string }[];

  const wanted: Record<string, WantedEntry> = {};
  for (const row of rows) {
    if (!row.person_id) continue;
    const warrant = JSON.parse(row.doc) as Warrant;
    const entry = wanted[row.person_id] ?? { count: 0, national: false };
    entry.count += 1;
    entry.national = entry.national || warrant.extradition === 'national';
    wanted[row.person_id] = entry;
  }
  return wanted;
}

export function registerWarrantRoutes(app: Express, db: DatabaseSync): void {
  /** Everything outstanding against one person, then everything else. */
  app.get('/api/people/:id/warrants', requireAuth, (req: Request, res: Response) => {
    const personId = text(req.params.id, 64);
    const list = warrants.where(db, { person_id: personId });
    const on = today();
    res.json({
      warrants: sortWarrants(list, on).map((warrant) => ({
        warrant,
        state: warrantState(warrant, on),
      })),
      notice: CONFIRMATION_NOTICE,
    });
  });

  /**
   * The warrant clerk's screen.
   *
   * Paged and filtered on the server for the same reason the trespass list is:
   * an agency's outstanding warrants is a number that only goes up, and this
   * is the one screen that wants all of them.
   */
  app.get('/api/warrants', requireAuth, (req: Request, res: Response) => {
    const query = text(req.query.q, 80).trim();
    const showAll = req.query.state === 'all';
    const on = today();
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const state = showAll ? { sql: '', params: [] as string[] } : { sql: ` AND ${OUTSTANDING}`, params: [on] };
    const search = query
      ? {
          sql: ' AND (p.last_name LIKE ? OR p.first_name LIKE ? OR w.number LIKE ?)',
          params: [`${query}%`, `${query}%`, `${query}%`],
        }
      : { sql: '', params: [] as string[] };

    // A left join: a warrant whose person was destroyed under a court order is
    // still a warrant, and dropping the row would change the total silently.
    const from = `FROM warrants w LEFT JOIN people p ON p.id = w.person_id WHERE 1=1${state.sql}${search.sql}`;
    const params = [...state.params, ...search.params];

    const total = (db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...params) as { n: number }).n;
    const rows = db
      .prepare(
        `SELECT w.doc AS doc, p.doc AS person ${from} ORDER BY w.issued_on DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as { doc: string; person: string | null }[];

    const outstanding = (
      db.prepare(`SELECT COUNT(*) AS n FROM warrants WHERE ${OUTSTANDING}`).get(on) as { n: number }
    ).n;

    res.json({
      total,
      outstanding,
      limit,
      offset,
      notice: CONFIRMATION_NOTICE,
      rows: rows.map((row) => {
        const warrant = JSON.parse(row.doc) as Warrant;
        const person = row.person ? (JSON.parse(row.person) as MasterPerson) : null;
        return {
          warrant,
          person: person
            ? { id: person.id, name: displayName(person), dob: person.dob, cautions: person.cautions ?? [] }
            : null,
          state: warrantState(warrant, on),
        };
      }),
    });
  });

  app.post('/api/warrants', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const body = req.body ?? {};

    const draft = {
      personId: text(body.personId, 64),
      number: text(body.number, 60).trim(),
      kind: oneOf(body.kind, KINDS, 'arrest'),
      court: text(body.court, 120).trim(),
      docket: text(body.docket, 60).trim(),
      judge: text(body.judge, 120).trim(),
      issuedOn: day(body.issuedOn),
      expiresOn: day(body.expiresOn),
      charges: chargesFrom(body.charges),
      bond: text(body.bond, 80).trim(),
      extradition: oneOf(body.extradition, EXTRADITION, ''),
      cautions: stringList(body.cautions, 12, 160),
      notes: text(body.notes, 2000).trim(),
    };

    /*
      A mistyped date arrives here blank because `day` rejects it, and blank
      means "does not expire". Those are opposite meanings, so the raw value is
      checked before it is thrown away.
    */
    for (const [field, raw] of [
      ['issuedOn', text(body.issuedOn, 20).trim()],
      ['expiresOn', text(body.expiresOn, 20).trim()],
    ] as const) {
      if (raw && !draft[field]) {
        res.status(400).json({ error: `That ${field === 'issuedOn' ? 'issue' : 'end'} date is not a date. Use YYYY-MM-DD.`, field });
        return;
      }
    }

    const check = checkWarrant(draft);
    if (!check.ok) {
      res.status(400).json({ error: check.reason, field: check.field });
      return;
    }
    if (!people.find(db, draft.personId)) {
      res.status(404).json({ error: 'No such person on file.', field: 'personId' });
      return;
    }

    /*
      The same court number entered twice is almost always somebody
      re-entering a warrant that is already here, so it is reported rather
      than merged — two agencies can legitimately hold the same number, and
      guessing wrong joins two people's warrants.
    */
    const duplicate = warrants
      .where(db, { number: draft.number })
      .find((existing) => warrantState(existing) === 'active');

    const warrant = createWarrant({
      ...draft,
      id: newId('war'),
      enteredById: user.id,
      enteredByName: user.name,
    });
    warrants.save(db, warrant);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'warrant.entered',
      target: draft.number,
      detail: `${draft.kind} · ${draft.court}`,
    });

    res.status(201).json({ warrant, duplicateOf: duplicate ?? null, notice: CONFIRMATION_NOTICE });
  });

  /**
   * An attempt to serve it.
   *
   * Appended, never edited. An attempt that happened cannot stop having
   * happened, and the pattern across attempts is the useful part.
   */
  app.post('/api/warrants/:id/attempts', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const warrant = warrants.find(db, text(req.params.id, 64));
    if (!warrant) {
      res.status(404).json({ error: 'No such warrant.' });
      return;
    }
    if (warrantState(warrant) !== 'active') {
      res.status(409).json({
        error: 'That warrant is no longer outstanding, so there is nothing to serve.',
      });
      return;
    }

    const body = req.body ?? {};
    const attempt: ServiceAttempt = {
      id: newId('att'),
      at: new Date().toISOString(),
      address: text(body.address, 200).trim(),
      byId: user.id,
      byName: user.name,
      outcome: text(body.outcome, 20) as ServiceAttempt['outcome'],
      notes: text(body.notes, 1000).trim(),
    };

    const check = checkAttempt(attempt);
    if (!check.ok) {
      res.status(400).json({ error: check.reason, field: check.field });
      return;
    }

    const now = new Date().toISOString();
    const next: Warrant = {
      ...warrant,
      attempts: [...warrant.attempts, attempt],
      // Serving it is what closes it. Recorded here rather than through a
      // separate route, because the officer at the door does one thing.
      servedOn: attempt.outcome === 'served' ? now.slice(0, 10) : warrant.servedOn,
      servedByName: attempt.outcome === 'served' ? user.name : warrant.servedByName,
      updatedAt: now,
    };
    warrants.save(db, next);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: attempt.outcome === 'served' ? 'warrant.served' : 'warrant.attempted',
      target: warrant.number,
      detail: attempt.outcome,
    });

    res.json({ warrant: next });
  });

  /**
   * Recalling one.
   *
   * A court did something — quashed it, or somebody else served it. Needs the
   * same authority as withdrawing a location note, because taking a warrant
   * out of sight on a wrong entry is how somebody wanted for a felony stops
   * showing up on a name check.
   */
  app.post('/api/warrants/:id/recall', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    if (!can(user, 'notes.retract')) {
      res.status(403).json({
        error: 'Taking a warrant out of circulation needs the same authority as withdrawing a note.',
      });
      return;
    }

    const warrant = warrants.find(db, text(req.params.id, 64));
    if (!warrant) {
      res.status(404).json({ error: 'No such warrant.' });
      return;
    }
    if (warrant.recalledOn) {
      res.status(409).json({ error: 'That warrant has already been recalled.' });
      return;
    }
    if (warrant.servedOn) {
      res.status(409).json({ error: 'That warrant was served. A served warrant is not recalled.' });
      return;
    }

    const reason = text(req.body?.reason, 500).trim();
    const check = checkRecall(reason);
    if (!check.ok) {
      res.status(400).json({ error: check.reason, field: check.field });
      return;
    }

    const now = new Date().toISOString();
    const next: Warrant = {
      ...warrant,
      recalledOn: now.slice(0, 10),
      recalledReason: reason,
      updatedAt: now,
    };
    warrants.save(db, next);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'warrant.recalled',
      target: warrant.number,
      detail: reason,
    });

    res.json({ warrant: next });
  });
}
