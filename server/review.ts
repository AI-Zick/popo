/**
 * Review routes.
 *
 * The transition rules live in `src/domain/review.ts` and are re-decided here
 * against the session the server issued. In particular the separation-of-duties
 * rule — nobody approves a report they wrote — is enforced here rather than in
 * the browser, because a review step that can be talked out of by the client is
 * not a review step.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, documents } from './db';
import { newId } from './ids';
import { requireAuth } from './auth';
import { recordAudit } from './audit';
import { canReopen, canReview, canSubmit, type ReviewComment, type ReviewEvent } from '../src/domain/review';
import type { Incident } from '../src/domain/types';

export const incidents = documents<Incident>(DOC_TABLES.incidents);

/**
 * One entry in a report's review history.
 *
 * Exported because crash reports and supplements move through the same review
 * states and were each building this identically. The shape is the audit trail
 * for who moved a document and when, and three copies of it is three chances
 * for one to drift.
 */
export function reviewEvent(
  action: ReviewEvent['action'],
  user: { id: string; name: string },
  note = '',
): ReviewEvent {
  return {
    id: newId('rev'),
    action,
    actorId: user.id,
    actorName: user.name,
    at: new Date().toISOString(),
    note,
  };
}

/**
 * Writes the report back without a version check.
 *
 * A review action is not an edit of the report's content — it moves the report
 * between states, and it should not fail because the officer happened to save a
 * comma a second earlier. The content written is the content just read.
 */
function save(db: DatabaseSync, doc: Incident): void {
  incidents.save(db, doc);
}

export function registerReviewRoutes(app: Express, db: DatabaseSync): void {
  /** Officer sends the report up. */
  app.post('/api/reports/:id/submit', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const loaded = incidents.findWithVersion(db, req.params.id);
    if (!loaded) {
      res.status(404).json({ error: 'No such report.' });
      return;
    }

    const check = canSubmit(loaded.doc.status);
    if (!check.ok) {
      res.status(409).json({ error: check.reason });
      return;
    }

    const doc: Incident = {
      ...loaded.doc,
      status: 'pending_review',
      submittedAt: new Date().toISOString(),
      // Recorded on first submission so review can tell whose report it is.
      createdBy: loaded.doc.createdBy || user.id,
      returnedReason: '',
      reviewHistory: [...(loaded.doc.reviewHistory ?? []), reviewEvent('submitted', user)],
      updatedAt: new Date().toISOString(),
    };
    save(db, doc);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'report.submitted',
      target: doc.caseNumber,
      detail: '',
    });
    res.json({ ok: true, report: doc });
  });

  app.post('/api/reports/:id/approve', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const loaded = incidents.findWithVersion(db, req.params.id);
    if (!loaded) {
      res.status(404).json({ error: 'No such report.' });
      return;
    }

    const check = canReview(user, loaded.doc);
    if (!check.ok) {
      res.status(403).json({ error: check.reason });
      return;
    }

    const note = String(req.body?.note ?? '').slice(0, 1000);
    const doc: Incident = {
      ...loaded.doc,
      status: 'approved',
      reviewedBy: user.name,
      reviewedAt: new Date().toISOString(),
      returnedReason: '',
      reviewHistory: [...(loaded.doc.reviewHistory ?? []), reviewEvent('approved', user, note)],
      updatedAt: new Date().toISOString(),
    };
    save(db, doc);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'report.approved',
      target: doc.caseNumber,
      detail: note,
    });
    res.json({ ok: true, report: doc });
  });

  /**
   * Sends it back. A reason is required, and field comments are the point —
   * "do it again" wastes a shift, "the victim's date of birth is missing"
   * does not.
   */
  app.post('/api/reports/:id/return', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const loaded = incidents.findWithVersion(db, req.params.id);
    if (!loaded) {
      res.status(404).json({ error: 'No such report.' });
      return;
    }

    const check = canReview(user, loaded.doc);
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
        section: (c.section ?? 'review') as ReviewComment['section'],
        message: String(c.message ?? '').slice(0, 1000),
        // Authorship comes from the session, never from the request.
        authorId: user.id,
        authorName: user.name,
        createdAt: new Date().toISOString(),
        resolvedAt: '',
      };
    });

    const doc: Incident = {
      ...loaded.doc,
      status: 'returned',
      reviewedBy: user.name,
      reviewedAt: new Date().toISOString(),
      returnedReason: reason,
      // Previous rounds' comments are kept; the officer sees the whole history.
      reviewComments: [...(loaded.doc.reviewComments ?? []), ...comments],
      reviewHistory: [...(loaded.doc.reviewHistory ?? []), reviewEvent('returned', user, reason)],
      updatedAt: new Date().toISOString(),
    };
    save(db, doc);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'report.returned',
      target: doc.caseNumber,
      detail: `${reason}${comments.length ? ` · ${comments.length} field notes` : ''}`,
    });
    res.json({ ok: true, report: doc });
  });

  /** Puts an approved report back into the officer's hands for correction. */
  app.post('/api/reports/:id/reopen', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const loaded = incidents.findWithVersion(db, req.params.id);
    if (!loaded) {
      res.status(404).json({ error: 'No such report.' });
      return;
    }

    const check = canReopen(user, loaded.doc.status);
    if (!check.ok) {
      res.status(403).json({ error: check.reason });
      return;
    }

    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) {
      res.status(400).json({ error: 'Say why an approved report is being reopened.' });
      return;
    }

    const doc: Incident = {
      ...loaded.doc,
      status: 'returned',
      returnedReason: reason,
      reviewHistory: [...(loaded.doc.reviewHistory ?? []), reviewEvent('reopened', user, reason)],
      updatedAt: new Date().toISOString(),
    };
    save(db, doc);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'report.reopened',
      target: doc.caseNumber,
      detail: reason,
    });
    res.json({ ok: true, report: doc });
  });

  /** Officer marks one of the supervisor's notes as dealt with. */
  app.post('/api/reports/:id/comments/:commentId/resolve', requireAuth, (req: Request, res: Response) => {
    const loaded = incidents.findWithVersion(db, req.params.id);
    if (!loaded) {
      res.status(404).json({ error: 'No such report.' });
      return;
    }
    const doc: Incident = {
      ...loaded.doc,
      reviewComments: (loaded.doc.reviewComments ?? []).map((c) =>
        c.id === req.params.commentId && !c.resolvedAt
          ? { ...c, resolvedAt: new Date().toISOString() }
          : c,
      ),
      updatedAt: new Date().toISOString(),
    };
    save(db, doc);
    res.json({ ok: true, report: doc });
  });
}
