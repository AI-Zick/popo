/**
 * Supplement routes.
 *
 * A supplement is a document in its own right, so it gets the same treatment as
 * a report: authorship comes from the session, transitions are re-decided here
 * rather than trusted from the browser, and the separation-of-duties rule holds
 * — nobody approves a supplement they wrote.
 *
 * The one thing a supplement may reach out and change is the parent case's
 * disposition, and only on approval. That is what stops a case cleared by an
 * arrest in March from reading as open forever, which would put the agency's
 * clearance rate wrong in a way nobody notices until the annual return.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, documents } from './db';
import { newId } from './ids';
import { requireAuth } from './auth';
import { reviewEvent } from './review';
import { recordAudit } from './audit';
import { canReopen, canReview, canSubmit, type ReviewComment, type ReviewEvent } from '../src/domain/review';
import {
  canSupplement,
  checkSupplement,
  createSupplement,
  effectiveDisposition,
  nextNumber,
  supplementLabel,
  type Supplement,
} from '../src/domain/supplement';
import type { Incident } from '../src/domain/types';

const supplements = documents<Supplement>(DOC_TABLES.supplements);
const cases = documents<Incident>(DOC_TABLES.incidents);

/**
 * Writes the winning disposition onto the case.
 *
 * Recomputed from every approved supplement rather than applied incrementally,
 * so that returning or reopening a supplement takes its change back out. An
 * incremental apply would leave a case cleared by a supplement that was later
 * rejected, which is the worst of both — the paperwork says one thing and the
 * statistics another.
 */
function syncCaseDisposition(db: DatabaseSync, caseId: string): Incident | null {
  const incident = cases.find(db, caseId);
  if (!incident) return null;

  const winning = effectiveDisposition(supplements.where(db, { case_id: caseId }), caseId);

  /*
    Nothing is moving the case any more — the supplement that was, has been
    returned or reopened. Put the disposition back to what the report itself
    said.

    Leaving it cleared would be the worst outcome available: the decision was
    withdrawn, the paperwork says so, and the statistics would still count the
    crime as solved. Nobody would notice until the annual return.
  */
  if (!winning) {
    const base = incident.dispositionBeforeSupplement;
    if (!base) return incident;
    const reverted: Incident = {
      ...incident,
      clearanceStatus: base.clearanceStatus,
      exceptionalClearanceReason: base.exceptionalClearanceReason,
      clearedAt: base.clearedAt,
      dispositionBeforeSupplement: null,
      updatedAt: new Date().toISOString(),
    };
    cases.save(db, reverted);
    return reverted;
  }

  const next: Incident = {
    ...incident,
    // Captured once, on the first supplement to move the case, so a chain of
    // supplements still reverts to what the report said rather than to
    // whatever the previous supplement decided.
    dispositionBeforeSupplement: incident.dispositionBeforeSupplement ?? {
      clearanceStatus: incident.clearanceStatus,
      exceptionalClearanceReason: incident.exceptionalClearanceReason,
      clearedAt: incident.clearedAt,
    },
    clearanceStatus: winning.change.clearanceStatus,
    exceptionalClearanceReason: winning.change.exceptionalClearanceReason,
    clearedAt: winning.change.clearedAt,
    updatedAt: new Date().toISOString(),
  };
  cases.save(db, next);
  return next;
}

/** The parent facts the supplement's own checks need. */
function parentFacts(incident: Incident) {
  return {
    clearanceStatus: incident.clearanceStatus,
    hasArrestee: incident.persons.some((p) => p.role === 'arrestee'),
    status: incident.status,
  };
}

export function registerSupplementRoutes(app: Express, db: DatabaseSync): void {
  /** Start one against an approved case. */
  app.post('/api/supplements', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const caseId = String(req.body?.caseId ?? '');
    const incident = cases.find(db, caseId);
    if (!incident) {
      res.status(404).json({ error: 'No such case.' });
      return;
    }

    const allowed = canSupplement(user, {
      status: incident.status,
      createdBy: incident.createdBy,
    });
    if (!allowed.ok) {
      res.status(409).json({ error: allowed.reason });
      return;
    }

    const doc = createSupplement({
      id: newId('sup'),
      caseId,
      caseNumber: incident.caseNumber,
      number: nextNumber(supplements.where(db, { case_id: caseId }), caseId),
      type: 'narrative',
      // Authorship comes from the session, never from the request.
      createdBy: user.id,
      reportingOfficer: user.name,
      reportingBadge: user.badge ?? '',
    });
    supplements.save(db, doc);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'supplement.created',
      target: supplementLabel(doc),
      detail: '',
    });
    res.json({ ok: true, supplement: doc });
  });

  /** Save a draft. Only its author, and only while it is theirs to edit. */
  app.put('/api/supplements/:id', requireAuth, (req: Request, res: Response) => {
    const user = req.user!;
    const current = supplements.find(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: 'No such supplement.' });
      return;
    }
    if (current.status !== 'draft' && current.status !== 'returned') {
      res.status(409).json({ error: 'This supplement is not editable right now.' });
      return;
    }
    if (current.createdBy && current.createdBy !== user.id) {
      res.status(403).json({ error: 'This supplement belongs to another officer.' });
      return;
    }

    const patch = (req.body ?? {}) as Partial<Supplement>;
    const doc: Supplement = {
      ...current,
      // Only the fields an author owns. Status, authorship and review history
      // are not among them.
      type: patch.type ?? current.type,
      narrative: typeof patch.narrative === 'string' ? patch.narrative.slice(0, 50_000) : current.narrative,
      disposition: patch.disposition === undefined ? current.disposition : patch.disposition,
      arrest: patch.arrest === undefined ? current.arrest : patch.arrest,
      updatedAt: new Date().toISOString(),
    };
    supplements.save(db, doc);
    res.json({ ok: true, supplement: doc });
  });

  app.post('/api/supplements/:id/submit', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const current = supplements.find(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: 'No such supplement.' });
      return;
    }

    const transition = canSubmit(current.status);
    if (!transition.ok) {
      res.status(409).json({ error: transition.reason });
      return;
    }

    const incident = cases.find(db, current.caseId);
    if (!incident) {
      res.status(404).json({ error: 'The case this belongs to is missing.' });
      return;
    }

    // Re-checked here rather than trusted from the browser.
    const problems = checkSupplement(current, parentFacts(incident));
    if (problems.length > 0) {
      res.status(400).json({ error: problems[0].message, problems });
      return;
    }

    const doc: Supplement = {
      ...current,
      status: 'pending_review',
      submittedAt: new Date().toISOString(),
      createdBy: current.createdBy || user.id,
      returnedReason: '',
      reviewHistory: [...current.reviewHistory, reviewEvent('submitted', user)],
      updatedAt: new Date().toISOString(),
    };
    supplements.save(db, doc);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'supplement.submitted',
      target: supplementLabel(doc),
      detail: '',
    });
    res.json({ ok: true, supplement: doc });
  });

  app.post('/api/supplements/:id/approve', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const current = supplements.find(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: 'No such supplement.' });
      return;
    }

    const check = canReview(user, current);
    if (!check.ok) {
      res.status(403).json({ error: check.reason });
      return;
    }

    const note = String(req.body?.note ?? '').slice(0, 1000);
    const doc: Supplement = {
      ...current,
      status: 'approved',
      reviewedBy: user.name,
      reviewedAt: new Date().toISOString(),
      returnedReason: '',
      reviewHistory: [...current.reviewHistory, reviewEvent('approved', user, note)],
      updatedAt: new Date().toISOString(),
    };
    supplements.save(db, doc);

    // Approval is the point at which a disposition change reaches the case.
    const incident = syncCaseDisposition(db, doc.caseId);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'supplement.approved',
      target: supplementLabel(doc),
      detail: doc.disposition ? `Case now ${doc.disposition.clearanceStatus}` : note,
    });
    res.json({ ok: true, supplement: doc, incident });
  });

  app.post('/api/supplements/:id/return', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const current = supplements.find(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: 'No such supplement.' });
      return;
    }

    const check = canReview(user, current);
    if (!check.ok) {
      res.status(403).json({ error: check.reason });
      return;
    }

    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) {
      res.status(400).json({ error: 'Say what needs fixing — a return with no reason is a wasted shift.' });
      return;
    }

    const incoming: unknown[] = Array.isArray(req.body?.comments) ? req.body.comments : [];
    const comments: ReviewComment[] = incoming.slice(0, 50).map((raw) => {
      const c = raw as Partial<ReviewComment>;
      return {
        id: newId('cmt'),
        path: String(c.path ?? ''),
        section: (c.section ?? 'narrative') as ReviewComment['section'],
        message: String(c.message ?? '').slice(0, 1000),
        authorId: user.id,
        authorName: user.name,
        createdAt: new Date().toISOString(),
        resolvedAt: '',
      };
    });

    const doc: Supplement = {
      ...current,
      status: 'returned',
      reviewedBy: user.name,
      reviewedAt: new Date().toISOString(),
      returnedReason: reason,
      reviewComments: [...current.reviewComments, ...comments],
      reviewHistory: [...current.reviewHistory, reviewEvent('returned', user, reason)],
      updatedAt: new Date().toISOString(),
    };
    supplements.save(db, doc);

    // A returned supplement's disposition must come back off the case.
    const incident = syncCaseDisposition(db, doc.caseId);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'supplement.returned',
      target: supplementLabel(doc),
      detail: reason,
    });
    res.json({ ok: true, supplement: doc, incident });
  });

  app.post('/api/supplements/:id/reopen', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const current = supplements.find(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: 'No such supplement.' });
      return;
    }

    const check = canReopen(user, current.status);
    if (!check.ok) {
      res.status(403).json({ error: check.reason });
      return;
    }
    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) {
      res.status(400).json({ error: 'Say why an approved supplement is being reopened.' });
      return;
    }

    const doc: Supplement = {
      ...current,
      status: 'returned',
      returnedReason: reason,
      reviewHistory: [...current.reviewHistory, reviewEvent('reopened', user, reason)],
      updatedAt: new Date().toISOString(),
    };
    supplements.save(db, doc);
    const incident = syncCaseDisposition(db, doc.caseId);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'supplement.reopened',
      target: supplementLabel(doc),
      detail: reason,
    });
    res.json({ ok: true, supplement: doc, incident });
  });
}
