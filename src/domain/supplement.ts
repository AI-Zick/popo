/**
 * Supplements.
 *
 * A report has a terminal state; a case does not. The original report is
 * written at 3am and approved the next morning, and then the case keeps moving:
 * the lab comes back a week later, a detective picks it up, an arrest happens
 * in March on a January burglary. None of that is a *correction* to the
 * original report — it is new information about a case that was closed out
 * correctly.
 *
 * Without supplements the only way to add any of it is to reopen the report,
 * which reverses a supervisor's approval and rewrites a document that was
 * accurate when it was signed. That is how a system quietly loses the
 * distinction between "the officer got it wrong" and "we learned something
 * new", and that distinction is exactly what a defence attorney will spend an
 * afternoon on.
 *
 * So a supplement is its own document, with its own author, its own review, and
 * its own place in the audit trail. It never edits the report it hangs from.
 */

import type { UUID } from './person';
import type { ClearanceStatus, ReportStatus } from './types';
import type { ReviewComment, ReviewEvent, TransitionCheck } from './review';
import type { User } from './auth';

/* ------------------------------------------------------------------ */
/* What kind                                                           */
/* ------------------------------------------------------------------ */

export type SupplementType =
  | 'narrative'
  | 'arrest'
  | 'property'
  | 'evidence'
  | 'disposition';

export const SUPPLEMENT_TYPE_LABEL: Record<SupplementType, string> = {
  narrative: 'Follow-up narrative',
  arrest: 'Arrest',
  property: 'Property recovered or added',
  evidence: 'Evidence or lab result',
  disposition: 'Case status change',
};

export const SUPPLEMENT_TYPE_HINT: Record<SupplementType, string> = {
  narrative: 'Anything learned since the report was approved.',
  arrest: 'Someone was arrested for this case after the report was filed.',
  property: 'Stolen property recovered, or property discovered later.',
  evidence: 'Lab results, prints, digital forensics, anything that came back.',
  disposition: 'The case is being cleared, unfounded or made inactive.',
};

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

/**
 * A change to the parent case's disposition, carried by the supplement and
 * applied only when a supervisor approves it.
 *
 * This is the one thing a supplement may reach out and change, and it is
 * deliberately a closed set. A case that was cleared by an arrest in March
 * must actually read as cleared — otherwise it shows open forever, and the
 * state's figures say the crime was never solved. Burying that in a narrative
 * nobody parses is how clearance rates end up wrong.
 */
export interface DispositionChange {
  clearanceStatus: ClearanceStatus;
  exceptionalClearanceReason: string;
  clearedAt: string;
}

/** Who was arrested, when a supplement clears a case by arrest. */
export interface ArrestReference {
  personName: string;
  arrestDate: string;
  /** The case number the arrest itself was booked under, where there is one. */
  arrestCaseNumber: string;
}

export interface Supplement {
  id: UUID;
  /** The report this hangs from. Never modified by the supplement. */
  caseId: UUID;
  /** Denormalised so a supplement can be listed and searched on its own. */
  caseNumber: string;
  /** 1, 2, 3 — officers refer to "the second supplement on 418". */
  number: number;

  type: SupplementType;
  narrative: string;

  /** Applied to the parent case on approval. Absent on most supplements. */
  disposition: DispositionChange | null;
  arrest: ArrestReference | null;

  status: ReportStatus;

  /** Matches `Incident` so the review machinery works on both unchanged. */
  createdBy: UUID | '';
  reportingOfficer: string;
  reportingBadge: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string;
  reviewedBy: string;
  reviewedAt: string;
  returnedReason: string;
  reviewComments: ReviewComment[];
  reviewHistory: ReviewEvent[];
}

export function createSupplement(partial: Partial<Supplement> & { caseId: UUID }): Supplement {
  const now = new Date().toISOString();
  return {
    id: '',
    caseNumber: '',
    number: 1,
    type: 'narrative',
    narrative: '',
    disposition: null,
    arrest: null,
    status: 'draft',
    createdBy: '',
    reportingOfficer: '',
    reportingBadge: '',
    createdAt: now,
    updatedAt: now,
    submittedAt: '',
    reviewedBy: '',
    reviewedAt: '',
    returnedReason: '',
    reviewComments: [],
    reviewHistory: [],
    ...partial,
  };
}

/** Next number for a case: supplements are numbered within their case. */
export function nextNumber(existing: Supplement[], caseId: UUID): number {
  const forCase = existing.filter((s) => s.caseId === caseId);
  return forCase.reduce((max, s) => Math.max(max, s.number), 0) + 1;
}

/** "2026-000418 S2" — how an officer says it out loud. */
export function supplementLabel(supplement: Supplement): string {
  return `${supplement.caseNumber} S${supplement.number}`;
}

export function supplementsFor(all: Supplement[], caseId: UUID): Supplement[] {
  return all.filter((s) => s.caseId === caseId).sort((a, b) => a.number - b.number);
}

/* ------------------------------------------------------------------ */
/* Transitions                                                         */
/* ------------------------------------------------------------------ */

/**
 * Who may supplement a case, and when.
 *
 * The rule turns on *who is asking*, not just on the report's status, because
 * two different things were being conflated:
 *
 *   A **secondary officer** documenting their own involvement. Three units
 *   respond to a burglary; one writes the report, and the other two each need
 *   to record what they did — who they canvassed, what they processed. They
 *   cannot edit the primary's report, because it is the primary's sworn
 *   statement, and making them wait for it to clear review means writing it
 *   from memory a week later. They may supplement immediately, at any status.
 *
 *   The **author** adding to their own report. Here the earlier rule holds:
 *   until it is approved, new information belongs in the report itself.
 *   Otherwise there is a way to route material around review — file a thin
 *   report, get it approved, put the substance in a supplement — and nobody
 *   can say which document the case rests on.
 */
export function canSupplement(
  user: User | null,
  parent: { status: ReportStatus; createdBy: string },
): TransitionCheck {
  if (!user) return { ok: false, reason: 'You are not signed in.' };

  // Not your report: you are documenting your own part in the same incident.
  if (parent.createdBy && parent.createdBy !== user.id) return { ok: true };

  if (parent.status === 'approved') return { ok: true };
  return {
    ok: false,
    reason:
      parent.status === 'pending_review'
        ? 'This is your report and it is with a supervisor. Wait for it to come back, or ask them to return it — a supplement is for what happens after it is approved.'
        : 'This is your own report and it is not approved yet — put the information in the report itself.',
  };
}

/** True when the supplement is somebody other than the report's author. */
/**
 * Whether an approved supplement's disposition change should be written to the
 * case.
 *
 * Only the newest approved supplement carrying a change wins. Two detectives
 * filing conflicting dispositions a week apart is a real thing, and the answer
 * is "the most recent decision stands, and the history shows both" rather than
 * whichever happened to be processed last.
 */
export function effectiveDisposition(
  supplements: Supplement[],
  caseId: UUID,
): { change: DispositionChange; from: Supplement } | null {
  const carrying = supplementsFor(supplements, caseId)
    .filter((s) => s.status === 'approved' && s.disposition)
    .sort((a, b) => (a.reviewedAt || a.updatedAt).localeCompare(b.reviewedAt || b.updatedAt));

  const latest = carrying[carrying.length - 1];
  return latest ? { change: latest.disposition!, from: latest } : null;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface SupplementProblem {
  field: 'narrative' | 'type' | 'disposition' | 'arrest';
  message: string;
  tip: string;
}

/** A supplement short enough to be a text message is not a report. */
export const MIN_NARRATIVE_WORDS = 15;

/**
 * What has to be true before a supplement can go up for review.
 *
 * Deliberately short. A supplement is not a second incident report and should
 * not be validated like one — the case already carries the coded detail. What
 * matters is that it says something, and that a disposition change is
 * supportable.
 */
export function checkSupplement(
  supplement: Supplement,
  parent: { clearanceStatus: ClearanceStatus; hasArrestee: boolean; status: ReportStatus },
): SupplementProblem[] {
  const problems: SupplementProblem[] = [];
  const words = supplement.narrative.trim() ? supplement.narrative.trim().split(/\s+/).length : 0;

  if (words === 0) {
    problems.push({
      field: 'narrative',
      message: 'A supplement needs a narrative.',
      tip: 'Say what you learned or did, and when. This is the part that will be read in two years.',
    });
  } else if (words < MIN_NARRATIVE_WORDS) {
    problems.push({
      field: 'narrative',
      message: `This is ${words} words. A supplement that short will not mean anything later.`,
      tip: 'Include the date you learned it, who told you or what document it came from, and what it changes about the case.',
    });
  }

  const change = supplement.disposition;
  if (change) {
    /*
      A secondary officer can file their part of an incident before the report
      clears review, but nobody closes a case whose report is not finished. The
      clearance would be resting on a document a supervisor has not signed.
    */
    if (parent.status !== 'approved') {
      problems.push({
        field: 'disposition',
        message: 'The report has not been approved yet, so the case status cannot change.',
        tip: 'File this as a narrative supplement now. The case can be cleared once the report is approved.',
      });
    }

    if (change.clearanceStatus === parent.clearanceStatus) {
      problems.push({
        field: 'disposition',
        message: 'The case is already in that status, so this changes nothing.',
        tip: 'Either pick a different status or drop the status change and file this as a narrative supplement.',
      });
    }

    if (change.clearanceStatus === 'cleared_exceptional' && !change.exceptionalClearanceReason) {
      problems.push({
        field: 'disposition',
        message: 'An exceptional clearance needs a reason.',
        tip: 'Exceptional means you know who did it and could charge them, but something outside your control stops you.',
      });
    }

    /*
      A case cannot be cleared by arrest with nobody arrested. The arrest is
      usually booked under its own case number months later, so requiring an
      arrestee on the *original* report would be wrong — a reference to the
      arrest is what is actually available.
    */
    if (change.clearanceStatus === 'cleared_arrest' && !parent.hasArrestee) {
      const arrest = supplement.arrest;
      if (!arrest?.personName?.trim() || !arrest?.arrestDate) {
        problems.push({
          field: 'arrest',
          message: 'Clearing by arrest needs the arrest details.',
          tip: 'Nobody is recorded as arrested on the original report, so name who was arrested and when. Give the arrest case number too if it was booked separately.',
        });
      }
    }

    if (change.clearanceStatus !== 'open' && !change.clearedAt) {
      problems.push({
        field: 'disposition',
        message: 'Say what date the case reached this status.',
        tip: 'The clearance date drives the statistics, and it is rarely the date you are typing this.',
      });
    }
  }

  return problems;
}

export function isReadyToSubmit(
  supplement: Supplement,
  parent: { clearanceStatus: ClearanceStatus; hasArrestee: boolean; status: ReportStatus },
): boolean {
  return checkSupplement(supplement, parent).length === 0;
}
