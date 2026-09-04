/**
 * Investigation routes.
 *
 * One investigation per case, created the first time somebody does anything
 * investigative with it — so a report nobody has triaged has no row here, and
 * "untouched" is a state the caseload screen can ask about rather than infer.
 *
 * The limitation date is computed on the server from the offences on the
 * report and the agency's schedule, and recomputed whenever the case is
 * touched. Storing it is a cache of a legal fact, not the fact itself; the
 * offences on the report are the fact.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, documents } from './db';
import { newId } from './ids';
import { requireAuth, requirePermission } from './auth';
import { recordAudit } from './audit';
import { can } from '../src/domain/auth';
import {
  DEFAULT_LIMITATIONS,
  checkAssignment,
  checkReview,
  checkSuspension,
  createInvestigation,
  investigationStatus,
  limitationDate,
  limitationStanding,
  mustBeWorked,
  reviewDue,
  reviewOverdueBy,
  solvabilityScore,
  sortCaseload,
  suspensionAdvice,
  today,
  type CaseReview,
  type FactorAnswers,
  type Investigation,
  type LimitationRule,
  type ReviewDecision,
} from '../src/domain/investigation';
import type { Incident } from '../src/domain/types';
import type { AgencyProfile } from '../src/domain/agency';

const investigations = documents<Investigation>(DOC_TABLES.investigations);
const cases = documents<Incident>(DOC_TABLES.incidents);

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);

const DECISIONS: ReviewDecision[] = ['', 'continue', 'suspend', 'close', 'reassign'];

/** The agency's limitation schedule, or the starting point. */
function schedule(db: DatabaseSync): LimitationRule[] {
  const row = db.prepare('SELECT doc FROM agency WHERE id = ?').get('default') as
    | { doc: string }
    | undefined;
  const agency = row ? (JSON.parse(row.doc) as AgencyProfile & { limitations?: LimitationRule[] }) : null;
  return agency?.limitations?.length ? agency.limitations : DEFAULT_LIMITATIONS;
}

const offenceCodes = (report: Incident | null): string[] =>
  report?.offenses.map((offense) => offense.code).filter(Boolean) ?? [];

/**
 * The investigation for a case, made if this is the first time.
 *
 * Creating on demand rather than alongside every report keeps the table
 * meaningful: a row here means somebody has picked the case up.
 */
function openInvestigation(db: DatabaseSync, caseId: string): { investigation: Investigation; report: Incident } | null {
  const report = cases.find(db, caseId);
  if (!report) return null;

  const existing = investigations.where(db, { case_id: caseId })[0];
  const limitation = limitationDate(
    offenceCodes(report),
    /*
      The clock runs from when the offence happened, not from when it was
      reported. Where a range was given, the *earliest* it could have been is
      the one to use — that is the date the limitation period actually starts,
      and picking the later end quietly buys time nobody has.
    */
    report.occurredFrom || report.reportedAt || report.createdAt,
    schedule(db),
  );

  if (existing) {
    // Recomputed every time. The offences on the report can change, and a
    // cached date that disagrees with them is worse than no date.
    if (existing.limitationDate !== limitation) {
      const updated = { ...existing, limitationDate: limitation };
      investigations.save(db, updated);
      return { investigation: updated, report };
    }
    return { investigation: existing, report };
  }

  const investigation = createInvestigation({
    id: newId('inv'),
    caseId,
    caseNumber: report.caseNumber,
    limitationDate: limitation,
  });
  investigations.save(db, investigation);
  return { investigation, report };
}

/** Everything a screen needs about one investigation, computed here. */
function describe(investigation: Investigation, report: Incident | null, on: string) {
  const codes = offenceCodes(report);
  return {
    investigation,
    status: investigationStatus(investigation),
    score: solvabilityScore(investigation.factors),
    reviewDue: reviewDue(investigation),
    reviewOverdueBy: reviewOverdueBy(investigation, on),
    limitation: limitationStanding(investigation.limitationDate, on),
    mustBeWorked: mustBeWorked(codes),
    caseNumber: report?.caseNumber ?? investigation.caseNumber,
  };
}

export function registerInvestigationRoutes(app: Express, db: DatabaseSync): void {
  /** The investigation for one case, created on first look. */
  app.get('/api/cases/:caseId/investigation', requireAuth, (req: Request, res: Response) => {
    const opened = openInvestigation(db, text(req.params.caseId, 64));
    if (!opened) {
      res.status(404).json({ error: 'No such case.' });
      return;
    }
    res.json(describe(opened.investigation, opened.report, today()));
  });

  /**
   * The caseload.
   *
   * Everything being worked, ordered by what will be lost if nobody acts.
   * `scope=mine` is a detective's own; the whole list is a supervisor's view
   * and needs the authority that reviewing reports needs.
   */
  app.get('/api/investigations', requireAuth, (req: Request, res: Response) => {
    const user = req.user!;
    const mine = req.query.scope !== 'all';
    if (!mine && !can(user, 'reports.approve')) {
      res.status(403).json({ error: 'The whole caseload is a supervisor’s view.' });
      return;
    }

    const list = mine
      ? investigations.where(db, { assigned_to: user.id })
      : investigations.all(db);
    const on = today();
    const reports = new Map(cases.all(db).map((report) => [report.id, report]));

    res.json({
      investigations: sortCaseload(list, on).map((investigation) =>
        describe(investigation, reports.get(investigation.caseId) ?? null, on),
      ),
    });
  });

  /** Giving a case to somebody. */
  app.post('/api/cases/:caseId/investigation/assign', requirePermission('reports.approve'), async (req: Request, res: Response) => {
    const user = req.user!;
    const opened = openInvestigation(db, text(req.params.caseId, 64));
    if (!opened) {
      res.status(404).json({ error: 'No such case.' });
      return;
    }

    const detectiveId = text(req.body?.detectiveId, 64);
    const check = checkAssignment(detectiveId);
    if (!check.ok) {
      res.status(400).json({ error: check.reason, field: check.field });
      return;
    }
    const detective = db.prepare('SELECT name FROM users WHERE id = ? AND active = 1').get(detectiveId) as
      | { name: string }
      | undefined;
    if (!detective) {
      res.status(404).json({ error: 'No such active account.', field: 'detectiveId' });
      return;
    }

    const now = new Date().toISOString();
    const next: Investigation = {
      ...opened.investigation,
      assignedToId: detectiveId,
      assignedToName: detective.name,
      assignedAt: now,
      assignedById: user.id,
      assignedByName: user.name,
      // Assigning an suspended case picks it back up. Saying so here rather
      // than making somebody unsuspend first, which nobody would.
      suspendedAt: '',
      suspendedReason: '',
      suspendedAgainstPolicy: false,
      updatedAt: now,
    };
    investigations.save(db, next);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'case.assigned',
      target: next.caseNumber,
      detail: detective.name,
    });

    res.json(describe(next, opened.report, today()));
  });

  /** Answering the solvability checklist. */
  app.post('/api/cases/:caseId/investigation/factors', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const opened = openInvestigation(db, text(req.params.caseId, 64));
    if (!opened) {
      res.status(404).json({ error: 'No such case.' });
      return;
    }

    const raw = (req.body?.factors ?? {}) as Record<string, unknown>;
    const factors: FactorAnswers = {};
    for (const [key, value] of Object.entries(raw).slice(0, 40)) {
      if (value) factors[text(key, 40)] = true;
    }

    const now = new Date().toISOString();
    const next: Investigation = {
      ...opened.investigation,
      factors,
      scoredAt: now,
      updatedAt: now,
    };
    investigations.save(db, next);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'case.scored',
      target: next.caseNumber,
      detail: `${solvabilityScore(factors)}`,
    });

    res.json(describe(next, opened.report, today()));
  });

  /**
   * Suspending it.
   *
   * The decision this whole module is arranged around. An offence on the
   * always-worked list can still be suspended — sometimes there is genuinely
   * nothing to do — but not on a sentence, and it is marked as having gone
   * against policy so it shows that way on every list afterwards.
   */
  app.post('/api/cases/:caseId/investigation/suspend', requirePermission('reports.approve'), async (req: Request, res: Response) => {
    const user = req.user!;
    const opened = openInvestigation(db, text(req.params.caseId, 64));
    if (!opened) {
      res.status(404).json({ error: 'No such case.' });
      return;
    }
    if (opened.investigation.suspendedAt) {
      res.status(409).json({ error: 'That case is already suspended.' });
      return;
    }

    const reason = text(req.body?.reason, 4000).trim();
    const codes = offenceCodes(opened.report);
    const check = checkSuspension(reason, codes);
    if (!check.ok) {
      res.status(400).json({
        error: check.reason,
        field: check.field,
        advice: suspensionAdvice(opened.investigation.factors, codes),
      });
      return;
    }

    const now = new Date().toISOString();
    const againstPolicy = mustBeWorked(codes);
    const next: Investigation = {
      ...opened.investigation,
      suspendedAt: now,
      suspendedReason: reason,
      suspendedAgainstPolicy: againstPolicy,
      updatedAt: now,
    };
    investigations.save(db, next);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: againstPolicy ? 'case.suspendedAgainstPolicy' : 'case.suspended',
      target: next.caseNumber,
      detail: reason,
    });

    res.json({ ...describe(next, opened.report, today()), advice: check.advice ?? '' });
  });

  /** A supervisor's look at it. Appended, never edited. */
  app.post('/api/cases/:caseId/investigation/reviews', requirePermission('reports.approve'), async (req: Request, res: Response) => {
    const user = req.user!;
    const opened = openInvestigation(db, text(req.params.caseId, 64));
    if (!opened) {
      res.status(404).json({ error: 'No such case.' });
      return;
    }

    const decision = text(req.body?.decision, 20) as ReviewDecision;
    const note = text(req.body?.note, 4000).trim();
    if (!DECISIONS.includes(decision)) {
      res.status(400).json({ error: 'That is not a decision this understands.', field: 'decision' });
      return;
    }
    const check = checkReview(decision, note);
    if (!check.ok) {
      res.status(400).json({ error: check.reason, field: check.field });
      return;
    }

    const now = new Date().toISOString();
    const review: CaseReview = {
      id: newId('rev'),
      at: now,
      byId: user.id,
      byName: user.name,
      decision,
      note,
    };
    const next: Investigation = {
      ...opened.investigation,
      reviews: [...opened.investigation.reviews, review],
      updatedAt: now,
    };

    /*
      A review that says "close it" closes it. The alternative is a review
      recording a decision and a second screen to carry it out, which is how
      decisions get recorded and never acted on.
    */
    if (decision === 'close') next.closedAt = now;
    if (decision === 'reassign') {
      next.assignedToId = '';
      next.assignedToName = '';
    }

    investigations.save(db, next);
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'case.reviewed',
      target: next.caseNumber,
      detail: decision,
    });

    res.json(describe(next, opened.report, today()));
  });
}
