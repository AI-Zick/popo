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

export type ReviewAction =
  | 'submitted'
  | 'approved'
  | 'returned'
  | 'reopened'
  | 'recalled'
  | 'handedOff';

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
  recalled: 'Taken back by the officer',
  handedOff: 'Handed to another officer',
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

/**
 * Taking a report back out of the queue.
 *
 * An officer who submits and then remembers the thing they meant to add has
 * two bad options without this: ask a supervisor to return it, which puts a
 * "returned for correction" on a report nothing was wrong with, or say nothing.
 * The second is the one that actually happens, and it is how a report goes into
 * the record incomplete.
 *
 * Only the author, only while nobody has acted on it. Once a supervisor has
 * started reading, pulling the report out from under them is a different thing
 * — and once it is approved or returned, the status already says what happened.
 */
export function canRecall(
  officer: User | null,
  report: { status: ReportStatus; createdBy: string; reviewComments?: { id: string }[] },
): TransitionCheck {
  if (!officer) return { ok: false, reason: 'You are not signed in.' };
  if (report.status !== 'pending_review') {
    return {
      ok: false,
      reason:
        report.status === 'approved'
          ? 'This report has been approved. A supervisor reopens it from here.'
          : 'This report is not waiting on a supervisor.',
    };
  }
  if (report.createdBy && report.createdBy !== officer.id) {
    return { ok: false, reason: 'Only the officer who wrote it can take it back.' };
  }
  if ((report.reviewComments ?? []).length > 0) {
    return {
      ok: false,
      reason:
        'A supervisor has already left notes on this report. Answer those instead — taking it back now would drop what they asked for.',
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Throwing one away                                                   */
/* ------------------------------------------------------------------ */

/**
 * What "nothing has been written on it" means.
 *
 * A report is created by pressing a button, and pressing it by mistake is
 * ordinary. What comes out is a case number and the officer's own name filled
 * in automatically — none of which anybody typed, and none of which is a
 * record of anything.
 */
export function isUntouched(report: UntouchedTarget, attachments = 0): boolean {
  return (
    report.offenses.length === 0 &&
    report.persons.length === 0 &&
    report.property.length === 0 &&
    report.vehicles.length === 0 &&
    !report.narrative.trim() &&
    !report.locationId &&
    !report.occurredFrom.trim() &&
    attachments === 0
  );
}

interface UntouchedTarget {
  offenses: unknown[];
  persons: unknown[];
  property: unknown[];
  vehicles: unknown[];
  narrative: string;
  locationId: string;
  occurredFrom: string;
}

/**
 * Whether a report can be thrown away rather than filed.
 *
 * Only one that nobody has written on. That line is the whole design: an
 * empty report created by a misclick is litter, and making an officer file it
 * to be rid of it puts a case number on nothing and teaches them to submit
 * junk. A report with anything real in it is a different object — it is a
 * record, and records in this system are destroyed under a court order with a
 * second person watching, not by whoever has it open.
 *
 * So this refuses, and says which of the two it is, rather than offering a
 * button that sometimes means "tidy up" and sometimes means "destroy
 * evidence".
 */
export function canDiscard(
  officer: User | null,
  report: UntouchedTarget & { status: ReportStatus; createdBy: string },
  attachments = 0,
): TransitionCheck {
  if (!officer) return { ok: false, reason: 'You are not signed in.' };
  if (report.status !== 'draft') {
    return {
      ok: false,
      reason:
        report.status === 'returned'
          ? 'This one has been through review. Fix what was asked for and send it back up.'
          : 'This report has been filed. Only a court order removes it now.',
    };
  }
  if (report.createdBy && report.createdBy !== officer.id) {
    return { ok: false, reason: 'Only the officer who started it can throw it away.' };
  }
  if (!isUntouched(report, attachments)) {
    return {
      ok: false,
      reason:
        'There is something written on this report, so it is a record now. Records are destroyed under a court order, with a second person — not from here.',
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Handing it on                                                       */
/* ------------------------------------------------------------------ */

/**
 * Whether this report can be passed to somebody else to finish.
 *
 * The case it exists for: an officer does the scene, writes what they have,
 * and goes off shift with the follow-up still open. Without a way to hand it
 * over, the report waits for them to come back — or the other officer starts a
 * second one about the same incident.
 *
 * Only while it is still the officer's to work on. A report waiting on a
 * supervisor is not the author's to give away, and an approved one is finished.
 */
export function canHandOff(
  officer: User | null,
  report: { status: ReportStatus; createdBy: string },
): TransitionCheck {
  if (!officer) return { ok: false, reason: 'You are not signed in.' };
  if (!isEditable(report.status)) {
    return {
      ok: false,
      reason:
        report.status === 'pending_review'
          ? 'This report is with a supervisor. Take it back first if it needs more work.'
          : 'This report has been approved.',
    };
  }
  /*
    A supervisor may reassign anybody's; an officer may only give away their
    own. Reassigning somebody else's work to a third person, without either of
    them present, is a supervisor's decision by definition.
  */
  if (report.createdBy && report.createdBy !== officer.id && !can(officer, 'reports.approve')) {
    return { ok: false, reason: 'Only the officer who has it, or a supervisor, can hand it on.' };
  }
  return { ok: true };
}

/**
 * The change a handoff makes.
 *
 * The officer giving it up becomes a supporting officer, and that is the whole
 * point rather than a nicety: they wrote part of this report, and a document
 * that ends up with one name on it when two people worked it is a document
 * that misleads everybody who reads it afterwards — including the second
 * officer, when somebody asks them two years later what they saw.
 *
 * Returns the fields to change, so the caller decides how to apply them.
 */
export function handOffPatch<T extends HandOffTarget>(
  report: T,
  to: { id: string; name: string; badge: string },
  newId: () => string,
): Pick<T, 'reportingOfficer' | 'reportingBadge' | 'createdBy' | 'supportingOfficers'> {
  const previous = report.reportingOfficer.trim();
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

  /*
    Whoever is taking it comes off the supporting list, because they are now
    the officer on the report. Reports get handed back — A to B, then B to A —
    and without this A ends up listed twice, once as the author and once as
    their own assistant.
  */
  const supporting = report.supportingOfficers.filter((officer) => !same(officer.name, to.name));

  const alreadyThere = supporting.some((officer) => same(officer.name, previous));

  return {
    reportingOfficer: to.name,
    reportingBadge: to.badge,
    createdBy: to.id,
    supportingOfficers:
      previous && !alreadyThere
        ? [
            ...supporting,
            { id: newId(), name: previous, badge: report.reportingBadge, role: 'Started the report' },
          ]
        : supporting,
  } as Pick<T, 'reportingOfficer' | 'reportingBadge' | 'createdBy' | 'supportingOfficers'>;
}

interface HandOffTarget {
  reportingOfficer: string;
  reportingBadge: string;
  createdBy: string;
  supportingOfficers: { id: string; name: string; badge: string; role: string }[];
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
