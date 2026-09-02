/**
 * Supervisor review.
 *
 * A report leaves an officer's hands and goes to someone senior, who either
 * approves it or sends it back with what needs fixing. The part that matters is
 * the sending back: "this is wrong, do it again" wastes a shift, while "the
 * victim's date of birth is missing and the narrative does not say how you
 * identified the suspect" is actionable. So a return carries comments pinned to
 * specific fields, and those reach the officer through the same panel that
 * shows validation problems — with the same jump-to-the-field behaviour.
 */

import type { UUID } from './person';
import type { ReportStatus, SectionId } from './types';
import { can, type User } from './auth';

export const STATUS_LABEL: Record<ReportStatus, string> = {
  draft: 'Draft',
  pending_review: 'Pending review',
  approved: 'Approved',
  returned: 'Returned for correction',
};

/** A supervisor's note against one field or section of a report. */
export interface ReviewComment {
  id: UUID;
  /** Field path, so the officer can be taken straight to it. */
  path: string;
  section: SectionId;
  message: string;
  authorId: UUID;
  authorName: string;
  createdAt: string;
  /** Set when the officer has dealt with it. */
  resolvedAt: string;
}

export type ReviewAction = 'submitted' | 'approved' | 'returned' | 'reopened';

export interface ReviewEvent {
  id: UUID;
  action: ReviewAction;
  actorId: UUID;
  actorName: string;
  at: string;
  /** Required on a return. */
  note: string;
}

export const REVIEW_ACTION_LABEL: Record<ReviewAction, string> = {
  submitted: 'Submitted for review',
  approved: 'Approved',
  returned: 'Returned for correction',
  reopened: 'Reopened',
};

/* ------------------------------------------------------------------ */
/* Transitions                                                         */
/* ------------------------------------------------------------------ */

export interface TransitionCheck {
  ok: boolean;
  reason?: string;
}

/** A report is only editable by its author while it is theirs to work on. */
export function isEditable(status: ReportStatus): boolean {
  return status === 'draft' || status === 'returned';
}

export function canSubmit(status: ReportStatus): TransitionCheck {
  if (status === 'pending_review') {
    return { ok: false, reason: 'This report is already waiting on a supervisor.' };
  }
  if (status === 'approved') {
    return { ok: false, reason: 'This report has been approved. Reopen it to make changes.' };
  }
  return { ok: true };
}

/**
 * Nobody approves their own work.
 *
 * This is the whole point of a review step. Without it the queue becomes a
 * formality, and the first time it matters is the first time someone needs a
 * report to say something it should not.
 */
export function canReview(
  reviewer: User | null,
  report: { status: ReportStatus; createdBy: string; reportingOfficer: string },
): TransitionCheck {
  if (!reviewer || !can(reviewer, 'reports.approve')) {
    return { ok: false, reason: 'You do not have permission to review reports.' };
  }
  if (report.status !== 'pending_review') {
    return {
      ok: false,
      reason:
        report.status === 'approved'
          ? 'This report has already been approved.'
          : 'This report has not been submitted for review yet.',
    };
  }
  if (report.createdBy && report.createdBy === reviewer.id) {
    return { ok: false, reason: 'You cannot review a report you wrote yourself.' };
  }
  return { ok: true };
}

export function canReopen(reviewer: User | null, status: ReportStatus): TransitionCheck {
  if (!reviewer || !can(reviewer, 'reports.approve')) {
    return { ok: false, reason: 'You do not have permission to reopen reports.' };
  }
  if (status !== 'approved') {
    return { ok: false, reason: 'Only an approved report can be reopened.' };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

export interface QueueEntry<T> {
  report: T;
  /** Hours since submission, for ageing the queue. */
  waitingHours: number;
  /** True once it has been waiting long enough to chase. */
  overdue: boolean;
  /** The reviewer cannot action their own report; it still shows, greyed. */
  reviewable: boolean;
}

/** Reports left longer than this are surfaced as overdue. */
export const REVIEW_SLA_HOURS = 72;

export function buildQueue<
  T extends { status: ReportStatus; submittedAt: string; createdBy: string; reportingOfficer: string },
>(reports: T[], reviewer: User | null, now = Date.now()): QueueEntry<T>[] {
  return reports
    .filter((r) => r.status === 'pending_review')
    .map((report) => {
      const submitted = new Date(report.submittedAt).getTime();
      const waitingHours = Number.isNaN(submitted)
        ? 0
        : Math.max(0, (now - submitted) / 3_600_000);
      return {
        report,
        waitingHours,
        overdue: waitingHours > REVIEW_SLA_HOURS,
        reviewable: canReview(reviewer, report).ok,
      };
    })
    // Longest wait first: the queue should surface what is going stale.
    .sort((a, b) => b.waitingHours - a.waitingHours);
}

export function unresolvedComments(comments: ReviewComment[]): ReviewComment[] {
  return comments.filter((c) => !c.resolvedAt);
}

/** Rough wait time for a queue row. */
export function describeWait(hours: number): string {
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}
