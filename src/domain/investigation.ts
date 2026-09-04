/**
 * Case management for investigations.
 *
 * The report is written and approved; now somebody has to work it, or decide
 * not to. That decision is the whole of this module, and it is a decision
 * agencies get wrong in both directions — cases sitting unassigned for a
 * month because nobody owned them, and cases suspended on a number when the
 * victim was never told.
 *
 * Four things live here.
 *
 * **Assignment.** A case with no detective on it is a case nobody is working,
 * whatever its status says. Assignment names a person and a date, so the
 * question "who has this" has an answer that is not a corridor conversation.
 *
 * **Solvability.** A weighted checklist of what a case actually has to go on —
 * a named suspect, a plate, traceable property, usable prints. It is decades
 * old and it works, and it is also the thing most likely to be misused here,
 * so see the long note on `solvabilityScore` before touching it.
 *
 * **Review.** A case is looked at again on a schedule, and somebody says
 * whether it is still being worked. Without that, "open" quietly comes to mean
 * "nobody has thought about this since March".
 *
 * **The statute of limitations.** The one clock in this system that cannot be
 * extended by anybody. A case worked past it was work that could never have
 * gone anywhere, and nobody notices until a prosecutor says so.
 */

import type { UUID } from './person';

/* ------------------------------------------------------------------ */
/* Solvability                                                         */
/* ------------------------------------------------------------------ */

export interface Factor {
  key: string;
  question: string;
  /** What this is worth. Higher is more likely to lead somewhere. */
  weight: number;
  hint: string;
}

/**
 * What a case has to go on.
 *
 * The weights are the conventional ones and every agency should argue with
 * them. A named suspect and a traceable serial number are worth more than a
 * description, because they lead somewhere on their own; a description of a
 * man in a dark hoodie leads nowhere without something else beside it.
 */
export const FACTORS: Factor[] = [
  {
    key: 'suspectNamed',
    question: 'Can a suspect be named?',
    weight: 10,
    hint: 'A name, or something that resolves to one — a plate, an account, a phone number.',
  },
  {
    key: 'suspectDescribed',
    question: 'Can a suspect be described?',
    weight: 3,
    hint: 'Enough to pick out of a group. "Male, dark clothing" is not a description.',
  },
  {
    key: 'suspectVehicle',
    question: 'Is there a suspect vehicle?',
    weight: 7,
    hint: 'A plate, or a make and model distinctive enough to work with.',
  },
  {
    key: 'witness',
    question: 'Is there a witness who saw it happen?',
    weight: 7,
    hint: 'Somebody who saw the act, not somebody who found the damage afterwards.',
  },
  {
    key: 'traceableProperty',
    question: 'Is any stolen property traceable?',
    weight: 8,
    hint: 'Serial numbers, an IMEI, an engraved mark — something a pawn check would hit.',
  },
  {
    key: 'physicalEvidence',
    question: 'Is there physical evidence worth examining?',
    weight: 6,
    hint: 'Recovered, booked and worth the lab time. Not "we swabbed something".',
  },
  {
    key: 'evidencePositive',
    question: 'Has evidence already come back positive?',
    weight: 9,
    hint: 'A print hit, a DNA match, a usable image. A result, not a submission.',
  },
  {
    key: 'distinctiveMo',
    question: 'Is the method distinctive?',
    weight: 5,
    hint: 'Something that would link this to other cases — an entry method, a phrase used.',
  },
  {
    key: 'limitedOpportunity',
    question: 'Could only a small number of people have done it?',
    weight: 6,
    hint: 'A locked office, a gated yard, a family home with no forced entry.',
  },
  {
    key: 'cameraCoverage',
    question: 'Is there camera footage that has been secured?',
    weight: 8,
    hint: 'Secured, not "there is a camera". Footage nobody collected is gone in a fortnight.',
  },
];

export const MAX_SCORE = FACTORS.reduce((sum, factor) => sum + factor.weight, 0);

/** Above this a case is worth assigning on the numbers alone. */
export const ASSIGN_THRESHOLD = 15;

export type FactorAnswers = Record<string, boolean>;

/**
 * What the answers add up to.
 *
 * **Read this before using the number for anything.** A solvability score is a
 * triage aid for a detective bureau with more cases than detectives. It is not
 * a judgement about whether a crime mattered, and it is not a reason on its
 * own to stop working one.
 *
 * The failure it invites is specific and it has happened to real agencies: a
 * sexual assault or a domestic with no witness, no camera and no forensics
 * scores near zero on this list, because the list was built for burglaries.
 * An agency that suspends on the number alone will suspend exactly the cases
 * it can least afford to. That is why `mustBeWorked` exists and why
 * `checkSuspension` refuses to suspend those cases without somebody saying so
 * in writing.
 */
export function solvabilityScore(answers: FactorAnswers): number {
  return FACTORS.reduce((sum, factor) => sum + (answers[factor.key] ? factor.weight : 0), 0);
}

/** Which of the answered factors carried the weight, best first. */
export function scoringFactors(answers: FactorAnswers): Factor[] {
  return FACTORS.filter((factor) => answers[factor.key]).sort((a, b) => b.weight - a.weight);
}

/**
 * Offence groups that are worked whatever the score says.
 *
 * NIBRS group codes for crimes against a person, plus the property offences
 * where suspending quietly is its own harm. Not a complete list and not meant
 * to be — an agency adds to it, and the point is that the list exists at all.
 */
const ALWAYS_WORKED = new Set([
  '09A', '09B', '09C', // homicide
  '100',               // kidnapping
  '11A', '11B', '11C', '11D', // sexual assault
  '120',               // robbery
  '13A',               // aggravated assault
  '36A', '36B',        // offences against children
  '64A', '64B',        // human trafficking
  '200',               // arson
]);

/**
 * Whether this case is worked regardless of what the checklist says.
 *
 * Takes the offence codes on the report. A case that hits this list can still
 * be suspended — sometimes there is genuinely nothing to do — but not silently
 * and not on the strength of a number.
 */
export function mustBeWorked(offenseCodes: string[]): boolean {
  return offenseCodes.some((code) => ALWAYS_WORKED.has(code));
}

/* ------------------------------------------------------------------ */
/* The investigation record                                            */
/* ------------------------------------------------------------------ */

export type InvestigationStatus = 'unassigned' | 'assigned' | 'suspended' | 'closed';

export const STATUS_LABEL: Record<InvestigationStatus, string> = {
  unassigned: 'Not assigned',
  assigned: 'Being worked',
  suspended: 'Suspended',
  closed: 'Closed',
};

export type ReviewDecision = '' | 'continue' | 'suspend' | 'close' | 'reassign';

export const DECISION_LABEL: Record<ReviewDecision, string> = {
  '': 'Not stated',
  continue: 'Keep working it',
  suspend: 'Suspend it',
  close: 'Close it',
  reassign: 'Give it to somebody else',
};

/**
 * One supervisor's look at a case.
 *
 * Appended, never edited. "Nobody has looked at this since March" is a fact
 * about an agency, and it is only visible if the looks are recorded.
 */
export interface CaseReview {
  id: UUID;
  at: string;
  byId: UUID | '';
  byName: string;
  decision: ReviewDecision;
  note: string;
}

export interface Investigation {
  id: UUID;
  /** The report this is about. One investigation per case. */
  caseId: UUID;
  caseNumber: string;

  assignedToId: UUID | '';
  assignedToName: string;
  assignedAt: string;
  assignedById: UUID | '';
  assignedByName: string;

  factors: FactorAnswers;
  /** When the checklist was last answered, so a stale score reads as stale. */
  scoredAt: string;

  reviews: CaseReview[];
  /** How often this case comes back for a look. */
  reviewEveryDays: number;

  suspendedAt: string;
  suspendedReason: string;
  /** True when it was suspended despite being on the always-worked list. */
  suspendedAgainstPolicy: boolean;

  closedAt: string;

  /** The offence with the shortest limitation period, and when it runs out. */
  limitationDate: string;

  createdAt: string;
  updatedAt: string;
}

export function createInvestigation(partial: Partial<Investigation> = {}): Investigation {
  const now = new Date().toISOString();
  return {
    id: '',
    caseId: '',
    caseNumber: '',
    assignedToId: '',
    assignedToName: '',
    assignedAt: '',
    assignedById: '',
    assignedByName: '',
    factors: {},
    scoredAt: '',
    reviews: [],
    reviewEveryDays: 30,
    suspendedAt: '',
    suspendedReason: '',
    suspendedAgainstPolicy: false,
    closedAt: '',
    limitationDate: '',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export const today = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** Worked out, never stored. Closed beats suspended beats assigned. */
export function investigationStatus(
  investigation: Pick<Investigation, 'closedAt' | 'suspendedAt' | 'assignedToId'>,
): InvestigationStatus {
  if (investigation.closedAt) return 'closed';
  if (investigation.suspendedAt) return 'suspended';
  return investigation.assignedToId ? 'assigned' : 'unassigned';
}

/* ------------------------------------------------------------------ */
/* Review timing                                                       */
/* ------------------------------------------------------------------ */

const daysBetween = (from: string, to: string): number | null => {
  const start = Date.parse(from);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86_400_000);
};

/** When this case is next due a look, or '' when it is not being worked. */
export function reviewDue(investigation: Investigation): string {
  const status = investigationStatus(investigation);
  if (status !== 'assigned') return '';
  const last = investigation.reviews.at(-1)?.at || investigation.assignedAt;
  if (!last) return '';
  const due = new Date(last);
  if (Number.isNaN(due.getTime())) return '';
  due.setUTCDate(due.getUTCDate() + investigation.reviewEveryDays);
  return due.toISOString().slice(0, 10);
}

/** Days a review is overdue by. Zero or negative means it is not. */
export function reviewOverdueBy(investigation: Investigation, on: string = today()): number {
  const due = reviewDue(investigation);
  if (!due) return 0;
  const days = daysBetween(`${due}T00:00:00Z`, on);
  return days === null ? 0 : Math.max(0, days);
}

/* ------------------------------------------------------------------ */
/* The statute of limitations                                          */
/* ------------------------------------------------------------------ */

/**
 * How long there is to charge, by offence.
 *
 * State law, so every number here is one an agency must check and change —
 * the same footing as the retention schedule. Zero years means no limit,
 * which is how most states treat homicide and some treat offences against
 * children.
 */
export interface LimitationRule {
  /** NIBRS offence code, or '*' for anything not named. */
  code: string;
  years: number;
  /** Named so nobody has to guess where the number came from. */
  authority: string;
}

export const DEFAULT_LIMITATIONS: LimitationRule[] = [
  { code: '09A', years: 0, authority: '' },
  { code: '09B', years: 0, authority: '' },
  { code: '11A', years: 0, authority: '' },
  { code: '36A', years: 0, authority: '' },
  { code: '36B', years: 0, authority: '' },
  { code: '120', years: 5, authority: '' },
  { code: '13A', years: 5, authority: '' },
  { code: '200', years: 5, authority: '' },
  { code: '220', years: 3, authority: '' },
  { code: '23D', years: 3, authority: '' },
  { code: '*', years: 3, authority: '' },
];

export function limitationYears(schedule: LimitationRule[], code: string): number {
  const exact = schedule.find((rule) => rule.code === code);
  if (exact) return exact.years;
  return schedule.find((rule) => rule.code === '*')?.years ?? 0;
}

/**
 * The date this case stops being chargeable.
 *
 * The *shortest* period among the offences on it, because that is the first
 * one to run out and the one worth warning about. An offence with no limit
 * does not stop the others expiring — a burglary charged alongside a homicide
 * still has three years on it.
 */
export function limitationDate(
  offenseCodes: string[],
  occurredAt: string,
  schedule: LimitationRule[] = DEFAULT_LIMITATIONS,
): string {
  const from = new Date(occurredAt);
  if (Number.isNaN(from.getTime()) || offenseCodes.length === 0) return '';

  const years = offenseCodes
    .map((code) => limitationYears(schedule, code))
    .filter((value) => value > 0);
  // Everything on it is unlimited, so there is no date to give.
  if (years.length === 0) return '';

  const due = new Date(from);
  due.setUTCFullYear(due.getUTCFullYear() + Math.min(...years));
  return due.toISOString().slice(0, 10);
}

/** Warn this far out. Long enough that something can still be done about it. */
export const LIMITATION_WARNING_DAYS = 180;

export interface LimitationStanding {
  /** Days left. Negative once it has passed. Null when there is no limit. */
  days: number | null;
  expired: boolean;
  soon: boolean;
  line: string;
}

export function limitationStanding(
  date: string,
  on: string = today(),
): LimitationStanding {
  if (!date) {
    return {
      days: null,
      expired: false,
      soon: false,
      line: 'No limitation period recorded for what is charged here.',
    };
  }
  const days = daysBetween(`${date}T00:00:00Z`, on);
  if (days === null) {
    return { days: null, expired: false, soon: false, line: '' };
  }
  const left = -days;
  if (left < 0) {
    return {
      days: left,
      expired: true,
      soon: false,
      line: `The limitation period ran out on ${date}. This can no longer be charged.`,
    };
  }
  if (left <= LIMITATION_WARNING_DAYS) {
    return {
      days: left,
      expired: false,
      soon: true,
      line: `${left} days left to charge — the limitation period ends ${date}.`,
    };
  }
  return { days: left, expired: false, soon: false, line: `Chargeable until ${date}.` };
}

/* ------------------------------------------------------------------ */
/* The decisions                                                       */
/* ------------------------------------------------------------------ */

export interface Check {
  ok: boolean;
  reason: string;
  field: string;
  /** Something to say that is not a refusal. */
  advice?: string;
}

const good: Check = { ok: true, reason: '', field: '' };

export function checkAssignment(detectiveId: string): Check {
  return detectiveId
    ? good
    : { ok: false, reason: 'Who is working it?', field: 'assignedToId' };
}

/**
 * Whether a case can be suspended.
 *
 * The rule the solvability score exists to be constrained by. A case on the
 * always-worked list can be suspended, because sometimes there is genuinely
 * nothing left to do — but the person doing it has to say so themselves, at
 * length, rather than leaning on a number that was never built for this kind
 * of case.
 */
export function checkSuspension(
  reason: string,
  offenseCodes: string[],
): Check {
  const trimmed = reason.trim();
  const words = trimmed.split(/\s+/).filter(Boolean).length;

  if (mustBeWorked(offenseCodes)) {
    if (words < 12) {
      return {
        ok: false,
        reason:
          'This is an offence the agency works regardless of solvability. Suspending it needs an account of what was done and why there is nothing left — not a sentence.',
        field: 'reason',
      };
    }
    return {
      ...good,
      advice:
        'Recorded as suspended against policy. It will show that way on the case and in the review list.',
    };
  }

  if (words < 4) {
    return { ok: false, reason: 'Say why it is being suspended.', field: 'reason' };
  }
  return good;
}

/**
 * What to tell somebody about to suspend a case.
 *
 * Separate from the refusal, because the useful thing to say is usually not
 * "no". A case with a named suspect and secured footage that somebody wants to
 * suspend is one worth a second look, and saying which factors are unworked is
 * more use than a score.
 */
export function suspensionAdvice(answers: FactorAnswers, offenseCodes: string[]): string {
  if (mustBeWorked(offenseCodes)) {
    return 'This is one the agency works regardless of the checklist. Somebody should be able to say what was tried.';
  }
  const strong = scoringFactors(answers).filter((factor) => factor.weight >= 7);
  if (strong.length === 0) return '';
  return `Still on the checklist: ${strong.map((f) => f.question.replace(/\?$/, '').toLowerCase()).join(', ')}. Worth a look before this goes on the shelf.`;
}

/** A review needs a decision, and a suspension needs more than that. */
export function checkReview(decision: ReviewDecision, note: string): Check {
  if (!decision) return { ok: false, reason: 'What is happening with it?', field: 'decision' };
  if (decision === 'continue' && !note.trim()) {
    return {
      ok: false,
      reason: 'What has moved since last time? A review that says nothing is a review nobody did.',
      field: 'note',
    };
  }
  return good;
}

/* ------------------------------------------------------------------ */
/* Reading a caseload                                                  */
/* ------------------------------------------------------------------ */

/**
 * What wants attention, worst first.
 *
 * Ordered by what will be lost if nobody acts: a limitation period running
 * out cannot be recovered, an overdue review can. Within that, oldest first.
 */
export function sortCaseload(list: Investigation[], on: string = today()): Investigation[] {
  const urgency = (investigation: Investigation): number => {
    const limitation = limitationStanding(investigation.limitationDate, on);
    if (limitation.expired) return 0;
    if (limitation.soon) return 1;
    if (reviewOverdueBy(investigation, on) > 0) return 2;
    if (investigationStatus(investigation) === 'unassigned') return 3;
    return 4;
  };
  return [...list].sort((a, b) => {
    const byUrgency = urgency(a) - urgency(b);
    if (byUrgency !== 0) return byUrgency;
    return a.createdAt.localeCompare(b.createdAt);
  });
}
