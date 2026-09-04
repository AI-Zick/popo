/**
 * Citation routes.
 *
 * Two ways in, one record. The MDT submits what it wrote; an officer keys in a
 * ticket from a book when the MDT was down, out of coverage, or they were on
 * foot. Both paths land on the same row, because the ticket number is the
 * identity and one ticket is one record.
 *
 * That reconciliation is the whole reason the manual path is safe to offer.
 * Without it, an agency that lets officers enter citations ends up
 * double-counting every ticket that arrives twice, and an activity report
 * nobody trusts is worse than no activity report.
 *
 * Which path wrote a field matters, so `reconcile` decides that rather than a
 * last-write-wins update: the MDT read the licence off a magnetic stripe, the
 * officer read it off a page in the dark, and the notes somebody typed belong
 * to the person who typed them.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, documents } from './db';
import { newId } from './ids';
import { requireAuth } from './auth';
import { recordAudit } from './audit';
import { can } from '../src/domain/auth';
import {
  adviseCitation,
  awaitingCourt,
  checkCitation,
  checkVoid,
  citationState,
  createCitation,
  createViolation,
  reconcile,
  sortCitations,
  type Citation,
  type CourtDisposition,
  type Violation,
} from '../src/domain/citation';
import type { TrafficStop } from '../src/domain/activity';

const citations = documents<Citation>(DOC_TABLES.citations);
const stops = documents<TrafficStop>(DOC_TABLES.stops);

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);

const DISPOSITIONS: CourtDisposition[] = [
  '', 'pending', 'guilty', 'notGuilty', 'dismissed', 'nolleProsequi', 'deferred', 'paid', 'failedToAppear',
];

function violationsFrom(input: unknown): Violation[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 20).map((raw) => {
    const violation = (raw ?? {}) as Record<string, unknown>;
    return createViolation({
      id: text(violation.id, 64) || newId('vio'),
      statute: text(violation.statute, 60).trim(),
      description: text(violation.description, 200).trim(),
      warningOnly: Boolean(violation.warningOnly),
      speed: text(violation.speed, 4).trim(),
      speedLimit: text(violation.speedLimit, 4).trim(),
      fine: text(violation.fine, 20).trim(),
    });
  });
}

/** The fields both paths carry, read the same way from both. */
function draftFrom(body: Record<string, unknown>): Partial<Citation> {
  return {
    number: text(body.number, 60).trim(),
    issuedAt: text(body.issuedAt, 40).trim(),
    personId: text(body.personId, 64),
    subjectName: text(body.subjectName, 160).trim(),
    subjectDob: text(body.subjectDob, 10).trim(),
    driverLicense: text(body.driverLicense, 40).trim(),
    driverLicenseState: text(body.driverLicenseState, 2).trim(),
    vehicleId: text(body.vehicleId, 64),
    plate: text(body.plate, 16).trim(),
    plateState: text(body.plateState, 2).trim(),
    locationId: text(body.locationId, 64),
    location: text(body.location, 200).trim(),
    stopId: text(body.stopId, 64),
    caseNumber: text(body.caseNumber, 40).trim(),
    violations: violationsFrom(body.violations),
    court: text(body.court, 120).trim(),
    courtDate: text(body.courtDate, 10).trim(),
    notes: text(body.notes, 2000).trim(),
  };
}

const byNumber = (db: DatabaseSync, number: string): Citation | null =>
  number ? (citations.where(db, { number })[0] ?? null) : null;

export function registerCitationRoutes(app: Express, db: DatabaseSync): void {
  /** Every citation issued to one person. */
  app.get('/api/people/:id/citations', requireAuth, (req: Request, res: Response) => {
    const list = citations.where(db, { person_id: text(req.params.id, 64) });
    res.json({ citations: sortCitations(list) });
  });

  /** The citations on one stop, which is how a stop shows what it produced. */
  app.get('/api/stops/:id/citations', requireAuth, (req: Request, res: Response) => {
    const list = citations.where(db, { stop_id: text(req.params.id, 64) });
    res.json({ citations: sortCitations(list) });
  });

  /**
   * The list, with the clerk's chase queue.
   *
   * `scope=mine` is an officer's own. Everything is a records view — a
   * citation list across the agency is the shape of a productivity report, and
   * whether that is a thing this agency does is a decision for whoever runs it
   * rather than a side effect of an endpoint being open.
   */
  app.get('/api/citations', requireAuth, (req: Request, res: Response) => {
    const user = req.user!;
    const mine = req.query.scope !== 'all';
    if (!mine && !can(user, 'audit.view') && !can(user, 'reports.approve')) {
      res.status(403).json({ error: 'The whole citation list is a records and supervisor view.' });
      return;
    }
    const list = mine ? citations.where(db, { officer_id: user.id }) : citations.all(db);
    res.json({
      citations: sortCitations(list),
      awaitingCourt: awaitingCourt(list).length,
    });
  });

  /**
   * Recording one an officer has already issued.
   *
   * The fallback for a dead MDT, no coverage, or a paper book. It is a
   * transcription of a ticket that exists, which is why the number is required
   * and why the issue time is the roadside time rather than now.
   */
  app.post('/api/citations', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const draft = draftFrom(req.body ?? {});

    const check = checkCitation(draft);
    if (!check.ok) {
      res.status(400).json({ error: check.reason, field: check.field });
      return;
    }

    /*
      Already here, because the MDT got there first. Not an error — the officer
      is holding a ticket they wrote and cannot know what has been submitted —
      so it is answered with what is on file rather than refused.
    */
    const existing = byNumber(db, draft.number!);
    if (existing) {
      res.status(409).json({
        error: `Citation ${draft.number} is already on file, entered ${existing.source === 'mdt' ? 'from the MDT' : 'here'} on ${existing.recordedAt.slice(0, 10)}.`,
        field: 'number',
        citation: existing,
      });
      return;
    }

    if (draft.stopId && !stops.find(db, draft.stopId)) {
      res.status(404).json({ error: 'No such stop.', field: 'stopId' });
      return;
    }

    const now = new Date().toISOString();
    const citation = createCitation({
      ...draft,
      id: newId('cit'),
      source: 'officer',
      recordedAt: now,
      officerId: user.id,
      officerName: user.name,
    });
    citations.save(db, citation);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'citation.recorded',
      target: citation.number,
      detail: citation.violations.map((v) => v.description || v.statute).join(', '),
    });

    res.status(201).json({ citation, advice: adviseCitation(citation) });
  });

  /**
   * A submission arriving from the MDT.
   *
   * The other half of the contract. If the number is already here — because an
   * officer keyed it in first — this fills that record in rather than creating
   * a second. Never two rows for one ticket.
   */
  app.post('/api/citations/inbound', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const draft = draftFrom(req.body ?? {});

    const check = checkCitation(draft);
    if (!check.ok) {
      res.status(400).json({ error: check.reason, field: check.field });
      return;
    }

    const existing = byNumber(db, draft.number!);
    if (existing) {
      const merged = reconcile(existing, draft);
      if (merged !== existing) citations.save(db, merged);
      await recordAudit(db, {
        actorId: user.id,
        actorName: user.name,
        action: 'citation.received',
        target: merged.number,
        detail: 'Reconciled with a citation already on file',
      });
      res.json({ citation: merged, reconciled: true });
      return;
    }

    const now = new Date().toISOString();
    const citation = createCitation({
      ...draft,
      id: newId('cit'),
      source: 'mdt',
      recordedAt: now,
      officerId: text(req.body?.officerId, 64) || user.id,
      officerName: text(req.body?.officerName, 120).trim() || user.name,
    });
    citations.save(db, citation);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'citation.received',
      target: citation.number,
      detail: citation.violations.map((v) => v.description || v.statute).join(', '),
    });

    res.status(201).json({ citation, reconciled: false });
  });

  /**
   * What the court did with it.
   *
   * Comes back from the clerk, usually in a batch, months later. Recording it
   * is a records job rather than the issuing officer's.
   */
  app.post('/api/citations/:id/disposition', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    if (!can(user, 'audit.view') && !can(user, 'reports.approve')) {
      res.status(403).json({ error: 'Recording what the court did is a records job.' });
      return;
    }

    const citation = citations.find(db, text(req.params.id, 64));
    if (!citation) {
      res.status(404).json({ error: 'No such citation.' });
      return;
    }
    if (citation.voidedAt) {
      res.status(409).json({ error: 'That citation was voided. There is nothing for a court to do.' });
      return;
    }

    const disposition = text(req.body?.disposition, 20) as CourtDisposition;
    if (!DISPOSITIONS.includes(disposition) || !disposition) {
      res.status(400).json({ error: 'That is not a disposition this understands.', field: 'disposition' });
      return;
    }

    const now = new Date().toISOString();
    const next: Citation = { ...citation, disposition, dispositionAt: now, updatedAt: now };
    citations.save(db, next);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'citation.disposed',
      target: citation.number,
      detail: disposition,
    });

    res.json({ citation: next });
  });

  /**
   * Voiding one.
   *
   * Never deleted. Somebody was handed a numbered ticket, and "who voided it
   * and why" is the question asked when they say they were stopped and let
   * off. Needs the authority that withdrawing a note needs, because voiding
   * one's own tickets is not a thing an officer should be able to do alone.
   */
  app.post('/api/citations/:id/void', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    if (!can(user, 'notes.retract')) {
      res.status(403).json({
        error: 'Voiding a citation needs the same authority as withdrawing a note.',
      });
      return;
    }

    const citation = citations.find(db, text(req.params.id, 64));
    if (!citation) {
      res.status(404).json({ error: 'No such citation.' });
      return;
    }
    if (citation.voidedAt) {
      res.status(409).json({ error: 'That citation has already been voided.' });
      return;
    }
    if (citationState(citation) === 'disposed') {
      res.status(409).json({
        error: 'The court has already dealt with this one. Voiding it here would not undo that.',
      });
      return;
    }

    const reason = text(req.body?.reason, 500).trim();
    const check = checkVoid(reason);
    if (!check.ok) {
      res.status(400).json({ error: check.reason, field: check.field });
      return;
    }

    const now = new Date().toISOString();
    const next: Citation = {
      ...citation,
      voidedAt: now,
      voidedBy: user.name,
      voidReason: reason,
      updatedAt: now,
    };
    citations.save(db, next);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'citation.voided',
      target: citation.number,
      detail: reason,
    });

    res.json({ citation: next });
  });
}
