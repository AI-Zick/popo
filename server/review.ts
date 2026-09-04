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
import { canHandOff, canRecall, canReopen, canReview, canSubmit, handOffPatch, type ReviewComment, type ReviewEvent } from '../src/domain/review';
import { runRules, type Issue } from '../src/validation/engine';
import { ALL_RULES } from '../src/validation/rules';
import { stateRules } from '../src/domain/nibrs/rules';
import { profileFor } from '../src/domain/nibrs/states';
import { emptyAgency, type AgencyProfile } from '../src/domain/agency';
import type { PersonIndex } from '../src/domain/person';
import type { LocationIndex } from '../src/domain/location';
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

/**
 * What is wrong with a report, as the officer's own screen sees it.
 *
 * The people and places come out of the database rather than off the request,
 * because a rule that asks "does this victim have a date of birth" has to look
 * at the victim the agency actually holds. Reading them costs a query on a
 * path that runs once when a report goes up, which is the right place to pay
 * for being sure.
 *
 * Only errors. Warnings are the state's requirements and the softer advice —
 * they hold a report out of the state submission, deliberately, and they have
 * never blocked an officer from filing.
 */
function blockingIssues(db: DatabaseSync, report: Incident): Issue[] {
  const agencyRow = db.prepare('SELECT doc FROM agency WHERE id = ?').get('default') as
    | { doc: string }
    | undefined;
  const agency: AgencyProfile = agencyRow ? (JSON.parse(agencyRow.doc) as AgencyProfile) : emptyAgency();

  const people = Object.fromEntries(
    (db.prepare('SELECT doc FROM people').all() as { doc: string }[]).map((row) => {
      const person = JSON.parse(row.doc) as { id: string };
      return [person.id, person];
    }),
  ) as PersonIndex;
  const locations = Object.fromEntries(
    (db.prepare('SELECT doc FROM locations').all() as { doc: string }[]).map((row) => {
      const place = JSON.parse(row.doc) as { id: string };
      return [place.id, place];
    }),
  ) as LocationIndex;

  const rules = [...ALL_RULES, ...stateRules(profileFor(agency.state))];
  return runRules(report, rules, { people, locations, agency }).errors;
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

    /*
      And the report has to actually be finishable.

      The editor already refuses this, which is what makes the refusal useful —
      an officer is told which field and taken to it. But a check that only the
      editor performs is not a check: anything that posts to this route without
      going through that screen gets a report into the review queue with
      whatever is missing from it, and the first person to find out is the
      supervisor, or the state, or nobody.

      The same rules, run the same way. `blockingIssues` builds the context from
      the database rather than from what the client says it is, so a client that
      lies about the report's contents cannot talk its way past this either.
    */
    const blocking = blockingIssues(db, loaded.doc);
    if (blocking.length > 0) {
      res.status(400).json({
        error:
          blocking.length === 1
            ? 'This report has one problem that has to be fixed before it goes up.'
            : `This report has ${blocking.length} problems that have to be fixed before it goes up.`,
        issues: blocking.map((issue) => ({
          key: issue.key,
          section: issue.section,
          path: issue.path,
          scope: issue.scope,
          title: issue.title,
          message: issue.message,
          tip: issue.tip,
        })),
      });
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

  /** Officer takes it back before anybody has acted on it. */
  app.post('/api/reports/:id/recall', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const loaded = incidents.findWithVersion(db, req.params.id);
    if (!loaded) {
      res.status(404).json({ error: 'No such report.' });
      return;
    }
    const check = canRecall(user, loaded.doc);
    if (!check.ok) {
      res.status(409).json({ error: check.reason });
      return;
    }
    const doc: Incident = {
      ...loaded.doc,
      status: 'draft',
      submittedAt: '',
      /*
        Kept on the history rather than erased from it. A report that went up
        and came back down is a thing that happened, and a supervisor looking
        at the trail should see it — this is not a way to un-submit invisibly.
      */
      reviewHistory: [...(loaded.doc.reviewHistory ?? []), reviewEvent('recalled', user)],
      updatedAt: new Date().toISOString(),
    };
    save(db, doc);
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'report.recalled',
      target: doc.caseNumber,
      detail: '',
    });
    res.json({ ok: true, report: doc });
  });

  /** Passes the report to another officer to finish. */
  app.post('/api/reports/:id/hand-off', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const loaded = incidents.findWithVersion(db, req.params.id);
    if (!loaded) {
      res.status(404).json({ error: 'No such report.' });
      return;
    }
    const check = canHandOff(user, loaded.doc);
    if (!check.ok) {
      res.status(409).json({ error: check.reason });
      return;
    }

    const toId = String(req.body?.toId ?? '');
    const row = db.prepare('SELECT id, name, badge, active FROM users WHERE id = ?').get(toId) as
      | { id: string; name: string; badge: string; active: number }
      | undefined;
    if (!row || !row.active) {
      res.status(400).json({ error: 'That is not an account this report can be handed to.' });
      return;
    }
    if (row.id === loaded.doc.createdBy) {
      res.status(409).json({ error: 'That officer already has this report.' });
      return;
    }

    const doc: Incident = {
      ...loaded.doc,
      ...handOffPatch(loaded.doc, { id: row.id, name: row.name, badge: row.badge ?? '' }, () =>
        newId('sof'),
      ),
      reviewHistory: [
        ...(loaded.doc.reviewHistory ?? []),
        reviewEvent('handedOff', user, `To ${row.name}`),
      ],
      updatedAt: new Date().toISOString(),
    };
    save(db, doc);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'report.handedOff',
      target: doc.caseNumber,
      detail: `to ${row.name}`,
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
