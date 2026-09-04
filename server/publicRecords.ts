/**
 * Public records routes.
 *
 * Two things here are worth reading before the code.
 *
 * **The released text is built here, never received.** A client that hands the
 * server a finished string is a client that can hand it the unredacted one,
 * and nothing downstream could tell the difference. So what crosses the wire
 * is the original record's id and a list of approved offsets, and this file
 * reads the record and applies them. The same reasoning makes the review
 * endpoint check that every span still covers the text it says it covers: a
 * report edited between the proposal and the approval would otherwise leave a
 * redaction sitting three words to the left of the thing it was meant to hide.
 *
 * **Logging a request is open; deciding what leaves the building is not.**
 * Anybody can write down that somebody asked — a request that goes unlogged
 * because the only clerk was at lunch is a statutory clock that never started,
 * and the clock runs from when it arrived, not from when it was typed in.
 * Attaching records, approving redactions and closing the request all need
 * `records.release`.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, documents } from './db';
import { newId } from './ids';
import { requireAuth, requirePermission } from './auth';
import { recordAudit } from './audit';
import { can } from '../src/domain/auth';
import type { AgencyProfile } from '../src/domain/agency';
import { DEFAULT_RULES, type ExemptionRule } from '../src/domain/exemption';
import { propose, type Proposal, type RecordContext, type TextFields } from '../src/domain/redaction';
import {
  buildRelease,
  checkClosure,
  checkExtension,
  checkRequest,
  createRequest,
  defaultPolicy,
  impliedOutcome,
  releaseBlockers,
  sortQueue,
  stage,
  stampAuthorities,
  standing,
  type AttachmentDecision,
  type DecidedSpan,
  type ItemReview,
  type Outcome,
  type PublicRecordsPolicy,
  type PublicRequest,
  type ReleasedRecord,
  type RequestChannel,
  type ResponsiveItem,
} from '../src/domain/publicRecords';
import type { Incident } from '../src/domain/types';
import type { MasterPerson } from '../src/domain/person';
import type { Supplement } from '../src/domain/supplement';

const requests = documents<PublicRequest>(DOC_TABLES.publicRequests);
/** One release: everything that went out on a request, on one day. */
interface ReleaseBundle {
  id: string;
  requestId: string;
  requestNumber: string;
  releasedAt: string;
  releasedBy: string;
  releasedByName: string;
  outcome: Outcome;
  records: ReleasedRecord[];
}

const releases = documents<ReleaseBundle>(DOC_TABLES.publicReleases);
const cases = documents<Incident>(DOC_TABLES.incidents);
const supplements = documents<Supplement>(DOC_TABLES.supplements);
const people = documents<MasterPerson>(DOC_TABLES.people);

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);

const CHANNELS: RequestChannel[] = ['counter', 'email', 'post', 'portal', 'phone'];
const OUTCOMES: Outcome[] = ['released', 'partial', 'denied', 'noRecords', 'withdrawn'];

const oneOf = <T extends string>(value: unknown, allowed: T[], fallback: T): T =>
  (allowed as string[]).includes(String(value ?? '')) ? (value as T) : fallback;

/* ------------------------------------------------------------------ */
/* What the agency has decided                                         */
/* ------------------------------------------------------------------ */

function agency(db: DatabaseSync): AgencyProfile | null {
  const row = db.prepare('SELECT doc FROM agency WHERE id = ?').get('default') as
    | { doc: string }
    | undefined;
  return row ? (JSON.parse(row.doc) as AgencyProfile) : null;
}

/** The agency's exemptions, or the catalogue everyone starts with. */
function rulesFor(db: DatabaseSync): ExemptionRule[] {
  const profile = agency(db);
  return profile?.exemptions?.length ? profile.exemptions : DEFAULT_RULES;
}

function policyFor(db: DatabaseSync): PublicRecordsPolicy {
  const profile = agency(db);
  return profile?.publicRecords ?? defaultPolicy();
}

/* ------------------------------------------------------------------ */
/* Numbering                                                           */
/* ------------------------------------------------------------------ */

/** PR-2026-00014. Sequential, because it is the number a requester quotes. */
function nextNumber(db: DatabaseSync, now = new Date()): string {
  const prefix = `PR-${now.getFullYear()}-`;
  const used = requests
    .columnValues(db, 'number')
    .filter((number) => number.startsWith(prefix))
    .map((number) => Number(number.slice(prefix.length)))
    .filter((number) => Number.isFinite(number));
  return `${prefix}${String((used.length > 0 ? Math.max(...used) : 0) + 1).padStart(5, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Reading the record a request is about                               */
/* ------------------------------------------------------------------ */

/**
 * How old somebody was when it happened.
 *
 * Eighteen, which is the usual line and is not the line everywhere — a few
 * states treat sixteen or seventeen year olds as adults for some purposes.
 * The engine takes this as a fact rather than deciding it, so an agency that
 * needs a different line changes it here and the reason is in one place.
 */
function wasJuvenile(dob: string, occurredAt: string): boolean {
  if (!dob || !occurredAt) return false;
  const born = new Date(`${dob.slice(0, 10)}T00:00:00Z`);
  const when = new Date(occurredAt.slice(0, 10) || occurredAt);
  if (Number.isNaN(born.getTime()) || Number.isNaN(when.getTime())) return false;
  const years = (when.getTime() - born.getTime()) / (365.2425 * 86_400_000);
  return years >= 0 && years < 18;
}

interface Readable {
  label: string;
  fields: TextFields;
  context: RecordContext;
}

/**
 * A record as the redaction engine needs to see it.
 *
 * The context is where the value is. A generic redaction tool reading this
 * narrative sees names; this one knows which of them is the victim, which was
 * fifteen at the time, and which plate belongs to the car on the report.
 */
function readable(db: DatabaseSync, item: ResponsiveItem): Readable | null {
  if (item.kind === 'supplement') {
    const supplement = supplements.find(db, item.recordId);
    if (!supplement) return null;
    const report = supplement.caseId ? cases.find(db, supplement.caseId) : null;
    return {
      label: `${supplement.caseNumber} supplement ${supplement.number}`,
      fields: { narrative: supplement.narrative ?? '' },
      context: report ? contextOf(db, report) : emptyContext(),
    };
  }

  const report = cases.find(db, item.recordId);
  if (!report) return null;
  return {
    label: report.caseNumber,
    fields: {
      narrative: report.narrative ?? '',
      ...Object.fromEntries(
        report.persons
          .filter((person) => person.notes?.trim())
          .map((person) => [`person:${person.id}`, person.notes]),
      ),
    },
    context: contextOf(db, report),
  };
}

/**
 * Whether a motor vehicle or criminal history query is attached to this scene.
 *
 * Read as two separate answers because they answer to two separate federal
 * rules — the Driver's Privacy Protection Act and the criminal history
 * regulation — and a release that cites the wrong one is a release the agency
 * cannot defend.
 */
function returnsFor(db: DatabaseSync, caseNumber: string): { dmv: boolean; criminalHistory: boolean } {
  if (!caseNumber) return { dmv: false, criminalHistory: false };
  const kinds = (
    db.prepare('SELECT doc FROM returns WHERE call_number = ?').all(caseNumber) as { doc: string }[]
  ).map((stored) => String((JSON.parse(stored.doc) as { kind?: string }).kind ?? ''));
  return {
    dmv: kinds.some((kind) => kind === 'registration' || kind === 'license'),
    criminalHistory: kinds.includes('person'),
  };
}

const emptyContext = (): RecordContext => ({
  subjects: [],
  plates: [],
  offenseCodes: [],
  hasDmvReturn: false,
  hasCriminalHistory: false,
  attachments: [],
});

function contextOf(db: DatabaseSync, report: Incident): RecordContext {
  const occurred = report.occurredFrom || report.reportedAt;
  const subjects = report.persons.map((person) => {
    const master = person.masterId ? people.find(db, person.masterId) : null;
    return {
      id: person.id,
      firstName: master?.firstName ?? '',
      lastName: master?.lastName ?? master?.businessName ?? '',
      aliases: master?.aliases ?? [],
      dob: master?.dob ?? '',
      address: master?.address ?? '',
      driverLicense: master?.driverLicense ?? '',
      role: person.role,
      juvenile: wasJuvenile(master?.dob ?? '', occurred),
    };
  });

  /*
    Which external queries are attached to the scene, and of what kind. A
    registration return is motor vehicle record data and carries the federal
    restriction whatever the state act says; a person query is criminal history
    and carries a different one. Counting them together would apply the wrong
    authority to both.
  */
  const returns = returnsFor(db, report.caseNumber);

  /*
    Withdrawn attachments are left out. An attachment that was retracted is not
    part of the record, and listing it would have a clerk deciding what to do
    about a file that is not going anywhere.
  */
  const attachments = db
    .prepare("SELECT id, filename, mime FROM attachments WHERE incident_id = ? AND retracted_at = ''")
    .all(report.id) as { id: string; filename: string; mime: string }[];

  return {
    subjects,
    plates: report.vehicles.map((vehicle) => vehicle.plate).filter(Boolean),
    offenseCodes: report.offenses.map((offense) => offense.code).filter(Boolean),
    hasDmvReturn: returns.dmv,
    hasCriminalHistory: returns.criminalHistory,
    attachments: attachments.map((row) => ({
      id: row.id,
      filename: row.filename ?? '',
      mime: row.mime ?? '',
    })),
  };
}

const proposalFor = (db: DatabaseSync, item: ResponsiveItem): { readable: Readable; proposal: Proposal } | null => {
  const record = readable(db, item);
  if (!record) return null;
  return { readable: record, proposal: propose(record.fields, record.context, rulesFor(db)) };
};

/* ------------------------------------------------------------------ */
/* Reading what a clerk sends back                                     */
/* ------------------------------------------------------------------ */

/**
 * The clerk's decisions, checked against the record as it is now.
 *
 * Offsets arrive from a screen that was drawn against the record at some
 * earlier moment. A supplement approved in between, or a correction, moves
 * every offset after the change — and a redaction three words to the left of
 * the thing it was meant to hide is a release with the thing still in it. So
 * every span has to still cover the text it claims to, and one that does not
 * is refused rather than adjusted: guessing where it moved to is how a
 * redactor covers the wrong words with confidence.
 */
function decisionsFrom(input: unknown, fields: TextFields): { spans: DecidedSpan[]; bad: string[] } {
  const spans: DecidedSpan[] = [];
  const bad: string[] = [];
  if (!Array.isArray(input)) return { spans, bad };

  for (const raw of input.slice(0, 2000)) {
    const span = (raw ?? {}) as Record<string, unknown>;
    const field = text(span.field, 120);
    const start = Number(span.start);
    const end = Number(span.end);
    const source = fields[field];
    if (source === undefined || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > source.length) {
      bad.push(text(span.id, 64));
      continue;
    }
    const actual = source.slice(start, end);
    const claimed = text(span.text, 4000);
    if (claimed && claimed !== actual) {
      bad.push(text(span.id, 64));
      continue;
    }
    spans.push({
      id: text(span.id, 64) || newId('sp'),
      field,
      start,
      end,
      text: actual,
      ruleId: text(span.ruleId, 64),
      ruleLabel: text(span.ruleLabel, 200),
      authority: text(span.authority, 300),
      detector: text(span.detector, 40) as DecidedSpan['detector'],
      confidence: span.confidence === 'medium' ? 'medium' : 'high',
      because: text(span.because, 600),
      decision: span.decision === 'rejected' ? 'rejected' : 'accepted',
      addedByClerk: Boolean(span.addedByClerk),
      note: text(span.note, 600),
    });
  }
  return { spans, bad };
}

function attachmentsFrom(input: unknown): AttachmentDecision[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 200).map((raw) => {
    const decision = (raw ?? {}) as Record<string, unknown>;
    return {
      attachmentId: text(decision.attachmentId, 64),
      filename: text(decision.filename, 300),
      outcome: oneOf(decision.outcome, ['released', 'withheld', 'replaced'] as const, 'released'),
      authority: text(decision.authority, 300).trim(),
      note: text(decision.note, 600).trim(),
    };
  });
}

/* ------------------------------------------------------------------ */
/* What a list row carries                                             */
/* ------------------------------------------------------------------ */

const row = (request: PublicRequest, policy: PublicRecordsPolicy) => ({
  request,
  standing: standing(request, policy),
  stage: stage(request),
});

export function registerPublicRecordsRoutes(app: Express, db: DatabaseSync): void {
  /* ---- The queue ----------------------------------------------------- */

  /**
   * The queue, paged in SQL.
   *
   * Requests only accumulate, and an agency five years in has thousands of
   * closed ones. Sending all of them so a browser can filter them is the shape
   * of a list that works in a demonstration and not in year three.
   *
   * SQL orders by arrival and `sortQueue` puts the page into true deadline
   * order. Those are the same order except where an extension or a pause has
   * moved a deadline, so a request whose deadline shifted can in principle sit
   * on the wrong page of a very long queue. Ordering in SQL by the real
   * deadline is not possible — it is derived, not stored, which is the whole
   * point of it — and the alternative, reading every row to sort it, is the
   * thing this endpoint exists to avoid.
   */
  app.get('/api/public-requests', requireAuth, (req: Request, res: Response) => {
    const policy = policyFor(db);
    const open = req.query.scope !== 'all';
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const where = open ? "WHERE closed_at = ''" : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM public_requests ${where}`).get() as { n: number }).n;
    const rows = db
      .prepare(`SELECT doc FROM public_requests ${where} ORDER BY received_at ASC LIMIT ? OFFSET ?`)
      .all(limit, offset) as { doc: string }[];

    const list = rows.map((stored) => JSON.parse(stored.doc) as PublicRequest);
    res.json({
      requests: sortQueue(list, policy).map((request) => row(request, policy)),
      total,
      limit,
      offset,
      policy,
    });
  });

  /**
   * Logging one, which anybody may do.
   *
   * The clock runs from when it arrived. Somebody at the counter on a Friday
   * evening writing it down is what starts it correctly; a request that waits
   * for the records clerk on Monday has already spent a weekend.
   */
  app.post('/api/public-requests', requireAuth, (req: Request, res: Response) => {
    const user = req.user!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requester = (body.requester ?? {}) as Record<string, unknown>;

    const draft = createRequest({
      id: newId('prr'),
      number: nextNumber(db),
      receivedAt: text(body.receivedAt, 40).trim() || new Date().toISOString(),
      channel: oneOf(body.channel, CHANNELS, 'email'),
      description: text(body.description, 4000).trim(),
      requester: {
        name: text(requester.name, 160).trim(),
        organization: text(requester.organization, 160).trim(),
        email: text(requester.email, 200).trim(),
        phone: text(requester.phone, 40).trim(),
        address: text(requester.address, 300).trim(),
        collect: text(requester.collect, 300).trim(),
      },
    });

    const check = checkRequest(draft);
    if (!check.ok) {
      res.status(400).json({ error: check.reason, field: check.field, advice: check.advice });
      return;
    }

    requests.save(db, draft);
    void recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'publicRecords.logged',
      target: draft.number,
      detail: '',
    });
    res.status(201).json(row(draft, policyFor(db)));
  });

  /** One request, with everything a screen needs to show it. */
  app.get('/api/public-requests/:id', requireAuth, (req: Request, res: Response) => {
    const request = requests.find(db, text(req.params.id, 64));
    if (!request) {
      res.status(404).json({ error: 'No such request.' });
      return;
    }
    const policy = policyFor(db);
    res.json({
      ...row(request, policy),
      policy,
      implied: impliedOutcome(request),
      mayRelease: can(req.user!, 'records.release'),
    });
  });

  /* ---- Working it ---------------------------------------------------- */

  app.patch('/api/public-requests/:id', requirePermission('records.release'), (req: Request, res: Response) => {
    const found = requests.findWithVersion(db, text(req.params.id, 64));
    if (!found) {
      res.status(404).json({ error: 'No such request.' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const request: PublicRequest = { ...found.doc };
    if ('assignedTo' in body) {
      request.assignedTo = text(body.assignedTo, 64);
      request.assignedToName = text(body.assignedToName, 160);
    }
    if ('description' in body) request.description = text(body.description, 4000).trim();
    if ('feeCents' in body) request.feeCents = Math.max(0, Math.floor(Number(body.feeCents) || 0));

    const check = checkRequest(request);
    if (!check.ok) {
      res.status(400).json({ error: check.reason, field: check.field, advice: check.advice });
      return;
    }
    requests.save(db, request, found.version);
    res.json(row(request, policyFor(db)));
  });

  /** Something said to, or heard from, the requester. */
  app.post('/api/public-requests/:id/correspondence', requireAuth, (req: Request, res: Response) => {
    const found = requests.findWithVersion(db, text(req.params.id, 64));
    if (!found) {
      res.status(404).json({ error: 'No such request.' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const message = text(body.text, 8000).trim();
    if (!message) {
      res.status(400).json({ error: 'There is nothing to record.' });
      return;
    }
    const request: PublicRequest = {
      ...found.doc,
      correspondence: [
        ...found.doc.correspondence,
        {
          id: newId('cor'),
          at: new Date().toISOString(),
          by: req.user!.id,
          byName: req.user!.name,
          direction: body.direction === 'in' ? 'in' : 'out',
          text: message,
        },
      ],
    };
    requests.save(db, request, found.version);
    res.json(row(request, policyFor(db)));
  });

  /**
   * Stopping the clock, and starting it again.
   *
   * Only for time the requester controls. There is no reason code for "we are
   * busy", because a system that lets an agency pause its own statutory clock
   * for any reason it likes is a system for laundering late responses.
   */
  app.post('/api/public-requests/:id/pause', requirePermission('records.release'), (req: Request, res: Response) => {
    const found = requests.findWithVersion(db, text(req.params.id, 64));
    if (!found) {
      res.status(404).json({ error: 'No such request.' });
      return;
    }
    if (found.doc.closure) {
      res.status(409).json({ error: 'This request is closed.' });
      return;
    }
    if (found.doc.pauses.some((pause) => !pause.until)) {
      res.status(409).json({ error: 'The clock is already stopped on this request.' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = body.reason === 'fee' ? 'fee' : 'clarification';
    const note = text(body.note, 1000).trim();
    if (reason === 'clarification' && !note) {
      res.status(400).json({
        error: 'Say what was asked of them.',
        field: 'note',
        advice:
          'The clock stops because the request is with them, so what was asked has to be on the record — and it is usually what an appeal turns on if they say they were never asked.',
      });
      return;
    }
    const request: PublicRequest = {
      ...found.doc,
      pauses: [...found.doc.pauses, { id: newId('pau'), reason, from: new Date().toISOString(), until: '', note }],
    };
    requests.save(db, request, found.version);
    void recordAudit(db, {
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'publicRecords.paused',
      target: request.number,
      detail: reason,
    });
    res.json(row(request, policyFor(db)));
  });

  app.post('/api/public-requests/:id/resume', requirePermission('records.release'), (req: Request, res: Response) => {
    const found = requests.findWithVersion(db, text(req.params.id, 64));
    if (!found) {
      res.status(404).json({ error: 'No such request.' });
      return;
    }
    const open = found.doc.pauses.find((pause) => !pause.until);
    if (!open) {
      res.status(409).json({ error: 'The clock is already running.' });
      return;
    }
    const request: PublicRequest = {
      ...found.doc,
      pauses: found.doc.pauses.map((pause) =>
        pause.id === open.id ? { ...pause, until: new Date().toISOString() } : pause,
      ),
    };
    requests.save(db, request, found.version);
    res.json(row(request, policyFor(db)));
  });

  app.post('/api/public-requests/:id/extensions', requirePermission('records.release'), (req: Request, res: Response) => {
    const found = requests.findWithVersion(db, text(req.params.id, 64));
    if (!found) {
      res.status(404).json({ error: 'No such request.' });
      return;
    }
    const policy = policyFor(db);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const days = Math.floor(Number(body.days) || 0);
    const reason = text(body.reason, 2000).trim();

    const check = checkExtension(found.doc, policy, days, reason);
    if (!check.ok) {
      res.status(400).json({ error: check.reason, field: check.field, advice: check.advice });
      return;
    }
    const request: PublicRequest = {
      ...found.doc,
      extensions: [
        ...found.doc.extensions,
        { id: newId('ext'), at: new Date().toISOString(), by: req.user!.id, days, reason },
      ],
    };
    requests.save(db, request, found.version);
    void recordAudit(db, {
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'publicRecords.extended',
      target: request.number,
      detail: `${days} days`,
    });
    res.json(row(request, policy));
  });

  /* ---- The records ---------------------------------------------------- */

  app.post('/api/public-requests/:id/items', requirePermission('records.release'), (req: Request, res: Response) => {
    const found = requests.findWithVersion(db, text(req.params.id, 64));
    if (!found) {
      res.status(404).json({ error: 'No such request.' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = body.kind === 'supplement' ? 'supplement' : 'incident';
    const recordId = text(body.recordId, 64);
    const item: ResponsiveItem = {
      id: newId('pri'),
      kind,
      recordId,
      label: '',
      addedAt: new Date().toISOString(),
      addedBy: req.user!.id,
      review: null,
    };
    const record = readable(db, item);
    if (!record) {
      res.status(404).json({ error: 'That record is not on file, or has been sealed.' });
      return;
    }
    if (found.doc.items.some((existing) => existing.kind === kind && existing.recordId === recordId)) {
      res.status(409).json({ error: 'That record is already attached to this request.' });
      return;
    }
    item.label = record.label;
    const request: PublicRequest = { ...found.doc, items: [...found.doc.items, item] };
    requests.save(db, request, found.version);
    res.status(201).json(row(request, policyFor(db)));
  });

  app.delete('/api/public-requests/:id/items/:itemId', requirePermission('records.release'), (req: Request, res: Response) => {
    const found = requests.findWithVersion(db, text(req.params.id, 64));
    if (!found) {
      res.status(404).json({ error: 'No such request.' });
      return;
    }
    const itemId = text(req.params.itemId, 64);
    const request: PublicRequest = {
      ...found.doc,
      items: found.doc.items.filter((item) => item.id !== itemId),
    };
    requests.save(db, request, found.version);
    res.json(row(request, policyFor(db)));
  });

  /**
   * What an automatic pass found, and what it could not look at.
   *
   * Recomputed on every read rather than stored with the request. A rule the
   * agency enabled this morning applies to the request that arrived last week,
   * and a stored proposal would quietly answer with yesterday's policy.
   */
  app.get('/api/public-requests/:id/items/:itemId/proposal', requirePermission('records.release'), (req: Request, res: Response) => {
    const request = requests.find(db, text(req.params.id, 64));
    const item = request?.items.find((entry) => entry.id === text(req.params.itemId, 64));
    if (!request || !item) {
      res.status(404).json({ error: 'No such record on this request.' });
      return;
    }
    const found = proposalFor(db, item);
    if (!found) {
      res.status(404).json({ error: 'That record is not on file, or has been sealed.' });
      return;
    }
    res.json({
      item,
      label: found.readable.label,
      fields: found.readable.fields,
      proposal: found.proposal,
      review: item.review,
      blockers: item.review
        ? releaseBlockers(item.review, found.proposal.notices, found.proposal.unreadable, rulesFor(db))
        : [],
    });
  });

  /**
   * The clerk's decisions.
   *
   * Everything blocking the release comes back on a refusal, rather than the
   * first thing found — being told about one problem at a time is how a
   * five-minute job becomes four round trips.
   */
  app.post('/api/public-requests/:id/items/:itemId/review', requirePermission('records.release'), (req: Request, res: Response) => {
    const found = requests.findWithVersion(db, text(req.params.id, 64));
    const item = found?.doc.items.find((entry) => entry.id === text(req.params.itemId, 64));
    if (!found || !item) {
      res.status(404).json({ error: 'No such record on this request.' });
      return;
    }
    if (found.doc.closure) {
      res.status(409).json({ error: 'This request is closed.' });
      return;
    }
    const record = proposalFor(db, item);
    if (!record) {
      res.status(404).json({ error: 'That record is not on file, or has been sealed.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const { spans, bad } = decisionsFrom(body.spans, record.readable.fields);
    if (bad.length > 0) {
      res.status(409).json({
        error: `${bad.length} ${bad.length === 1 ? 'redaction no longer covers' : 'redactions no longer cover'} the text ${bad.length === 1 ? 'it was' : 'they were'} drawn on.`,
        advice:
          'The record has changed since this screen was drawn — a supplement, or a correction. Reload it and go through the proposal again. Moving a redaction to where it probably went now is how a redactor covers the wrong words with confidence.',
        field: 'spans',
      });
      return;
    }

    const review: ItemReview = {
      /*
        Stamped with the authority as it stands now, not as it stood when the
        proposal was drawn — otherwise a statute named between the two moments
        never reaches the withholding log that goes to the requester.
      */
      spans: stampAuthorities(spans, rulesFor(db)),
      answered: Array.isArray(body.answered) ? body.answered.slice(0, 100).map((id) => text(id, 64)) : [],
      attachments: attachmentsFrom(body.attachments),
      readInFull: Boolean(body.readInFull),
      approvedAt: '',
      approvedBy: req.user!.id,
      approvedByName: req.user!.name,
    };

    const blockers = releaseBlockers(review, record.proposal.notices, record.proposal.unreadable, rulesFor(db));
    const approving = body.approve !== false;
    if (approving && blockers.length > 0) {
      res.status(400).json({ error: 'This record is not ready to go out.', blockers });
      return;
    }
    if (approving) review.approvedAt = new Date().toISOString();

    const request: PublicRequest = {
      ...found.doc,
      items: found.doc.items.map((entry) => (entry.id === item.id ? { ...entry, review } : entry)),
    };
    requests.save(db, request, found.version);
    if (approving) {
      void recordAudit(db, {
        actorId: req.user!.id,
        actorName: req.user!.name,
        action: 'publicRecords.approved',
        target: `${request.number} · ${item.label}`,
        detail: `${spans.filter((span) => span.decision === 'accepted').length} redactions`,
      });
    }
    res.json({ ...row(request, policyFor(db)), blockers });
  });

  /** What this record would look like going out, built the same way it will be. */
  app.get('/api/public-requests/:id/items/:itemId/preview', requirePermission('records.release'), (req: Request, res: Response) => {
    const request = requests.find(db, text(req.params.id, 64));
    const item = request?.items.find((entry) => entry.id === text(req.params.itemId, 64));
    if (!request || !item?.review) {
      res.status(404).json({ error: 'That record has not been reviewed yet.' });
      return;
    }
    const record = readable(db, item);
    if (!record) {
      res.status(404).json({ error: 'That record is not on file, or has been sealed.' });
      return;
    }
    res.json({ release: buildRelease(item.id, record.label, record.fields, item.review) });
  });

  /* ---- Closing it out -------------------------------------------------- */

  /**
   * Closing the request, and building what goes out.
   *
   * The released text is assembled here from the records as they stand and the
   * approved offsets, and stored — because "what did we send them" is a
   * question asked a year later, by which time the record itself may have been
   * supplemented, corrected or sealed. Rebuilding it from today's file would
   * answer a different question.
   */
  app.post('/api/public-requests/:id/close', requirePermission('records.release'), (req: Request, res: Response) => {
    const found = requests.findWithVersion(db, text(req.params.id, 64));
    if (!found) {
      res.status(404).json({ error: 'No such request.' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const outcome = oneOf(body.outcome, OUTCOMES, 'released');
    const reason = text(body.reason, 8000).trim();

    const check = checkClosure(found.doc, outcome, reason);
    if (!check.ok) {
      res.status(400).json({ error: check.reason, field: check.field, advice: check.advice });
      return;
    }

    /*
      What the decisions actually add up to, checked against what was chosen.
      A clerk who redacted four passages and picked "released in full" has
      misdescribed the response, and the requester is the one who finds out.
    */
    const implied = impliedOutcome(found.doc);
    if ((outcome === 'released' || outcome === 'partial') && outcome !== implied) {
      res.status(409).json({
        error:
          implied === 'partial'
            ? 'Material was withheld from these records, so this is a release in part.'
            : 'Nothing was withheld from these records, so this is a release in full.',
        field: 'outcome',
        implied,
      });
      return;
    }

    const at = new Date().toISOString();
    const records: ReleasedRecord[] = [];
    if (outcome === 'released' || outcome === 'partial') {
      for (const item of found.doc.items) {
        const record = readable(db, item);
        if (!record || !item.review) continue;
        records.push(buildRelease(item.id, record.label, record.fields, item.review));
      }
      releases.save(db, {
        id: newId('prl'),
        requestId: found.doc.id,
        requestNumber: found.doc.number,
        releasedAt: at,
        releasedBy: req.user!.id,
        releasedByName: req.user!.name,
        outcome,
        records,
      });
    }

    const request: PublicRequest = {
      ...found.doc,
      closure: { at, by: req.user!.id, byName: req.user!.name, outcome, reason },
    };
    requests.save(db, request, found.version);
    void recordAudit(db, {
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'publicRecords.closed',
      target: request.number,
      detail: outcome,
    });
    res.json({ ...row(request, policyFor(db)), records });
  });

  /** What actually went out, as it went out. */
  app.get('/api/public-requests/:id/release', requirePermission('records.release'), (req: Request, res: Response) => {
    const list = releases.where(db, { request_id: text(req.params.id, 64) });
    if (list.length === 0) {
      res.status(404).json({ error: 'Nothing has been released on this request.' });
      return;
    }
    res.json({ releases: list });
  });
}
