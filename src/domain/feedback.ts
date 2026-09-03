/**
 * Telling the vendor something is wrong.
 *
 * Every records system accumulates a list of things officers hate about it, and
 * in most agencies that list lives in a sergeant's head and never reaches
 * anyone who could fix it. The gap is rarely unwillingness — it is that the
 * only channel is a support ticket somebody has to open from a desk, hours
 * after the thing that annoyed them, by which time it is not worth it.
 *
 * So: two clicks from wherever they are, at the moment it happens, and the
 * screen they were on is captured rather than described.
 *
 * The hard part is not the form. It is that a free-text box in a police records
 * system is an exfiltration path. An officer explaining "this rejects a valid
 * date" will paste the date. Explaining "this report will not submit" will
 * paste the case number, and then a name, and then whatever else it takes to
 * make the problem legible — and all of it leaves the agency, to a vendor with
 * no lawful basis to hold it.
 *
 * Hence `scan`. Most findings are shown back rather than removed — mangling a
 * bug report is its own failure, and an officer who finds their words rewritten
 * stops using the channel. One click replaces them all if they want that.
 *
 * The exception is a social security number, which the server removes whether
 * or not the client did. Everything else here is a matter of judgement; that
 * one is not, no bug report needs a real one, and a guarantee that depends on
 * the client behaving is not a guarantee. The officer is told it happened.
 */

import type { Role } from './auth';
import type { UUID } from './person';

/* ------------------------------------------------------------------ */
/* What a piece of feedback is                                         */
/* ------------------------------------------------------------------ */

export type FeedbackKind = 'bug' | 'idea' | 'slow' | 'wording';

export const KIND_LABEL: Record<FeedbackKind, string> = {
  bug: 'Something is wrong',
  idea: 'An idea',
  slow: 'Something is slow',
  wording: 'Confusing wording',
};

export const KIND_HINT: Record<FeedbackKind, string> = {
  bug: 'It does the wrong thing, or will not let you do the right one.',
  idea: 'Something the job needs that is not here.',
  slow: 'It works, but it takes longer than it should.',
  wording: 'A label, a message or a tip that reads wrong or misleads.',
};

/**
 * How much it is costing them.
 *
 * The single most useful field on the form, and the one a vendor cannot infer.
 * "The report will not submit" and "the button is the wrong shade" are the same
 * length in a queue and nothing alike in a shift.
 */
export type Impact = 'blocked' | 'workaround' | 'annoyance';

export const IMPACT_LABEL: Record<Impact, string> = {
  blocked: 'It stopped me working',
  workaround: 'I got around it, but it cost me time',
  annoyance: 'It is just annoying',
};

export type FeedbackStatus = 'new' | 'reading' | 'planned' | 'shipped' | 'declined';

export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: 'Not looked at yet',
  reading: 'Being looked at',
  planned: 'Going to be fixed',
  shipped: 'Fixed',
  declined: 'Not going to be done',
};

/**
 * Where they were, captured rather than typed.
 *
 * All of it is structural — which screen, which field, what version. None of it
 * is content. The case number is deliberately absent: it would help reproduce
 * the fault and it is criminal justice information, and the second of those
 * wins. An agency that needs to tie a report back to its own case can do it
 * from its own audit log, which never leaves the building.
 */
export interface FeedbackContext {
  /** "Incident report", "Setup — NIBRS export". */
  screen: string;
  /** The field they were in when they opened the form, if any. */
  field: string;
  /** Build the agency is running, so a fixed fault is not re-diagnosed. */
  version: string;
  /** Which agency, so one agency's flood is not read as everyone's. */
  agencyOri: string;
  agencyName: string;
  /** Browser and platform, for the faults that are only ever one of them. */
  userAgent: string;
}

export interface Feedback {
  id: UUID;
  kind: FeedbackKind;
  impact: Impact;
  /** One line, so a queue is readable. */
  summary: string;
  detail: string;
  context: FeedbackContext;

  submittedBy: UUID;
  submittedByName: string;
  submittedByRole: Role;
  at: string;

  status: FeedbackStatus;
  /** The answer, shown to whoever raised it. */
  response: string;
  respondedAt: string;
  /**
   * Who answered.
   *
   * Named because an agency administrator triaging locally and the vendor
   * declining something are not the same event, and an officer reading
   * "not going to be done" deserves to know which one they are looking at.
   */
  respondedBy: string;
  respondedByName: string;
  respondedByRole: Role | '';

  /**
   * Everyone else who hit the same thing.
   *
   * The best prioritisation signal there is, and free: three officers
   * seconding one entry says more than three separately worded reports of it,
   * and seeing it already raised stops the third from writing the fourth.
   */
  seconded: UUID[];

  /** Whether it has reached the vendor. False until it has, or forever. */
  forwarded: boolean;
  forwardedAt: string;
}

export type FeedbackDraft = Pick<Feedback, 'kind' | 'impact' | 'summary' | 'detail'> & {
  context: FeedbackContext;
};

/* ------------------------------------------------------------------ */
/* Looking for things that must not leave the building                 */
/* ------------------------------------------------------------------ */

export type FindingKind =
  | 'ssn'
  | 'caseNumber'
  | 'dob'
  | 'phone'
  | 'address'
  | 'email'
  | 'licencePlate';

export interface Finding {
  kind: FindingKind;
  /** What was matched, verbatim. */
  text: string;
  start: number;
  end: number;
  /** What replaces it if they take the offer. */
  placeholder: string;
  label: string;
  /** Carried rather than derived: "date of birth" does not take an -s. */
  plural: string;
  /**
   * `stop` findings are removed by the server, whatever the client did.
   *
   * Only the social security number earns it. There is no bug report that
   * needs a real one, the harm if it leaves is not recoverable, and a warning
   * that fires on every date of birth is a warning nobody reads.
   */
  severity: 'stop' | 'notice';
}

interface Pattern {
  kind: FindingKind;
  label: string;
  plural: string;
  placeholder: string;
  severity: 'stop' | 'notice';
  regex: RegExp;
}

/*
  Ordered by how much it would hurt, because overlapping matches are resolved
  first-wins: a social security number written 123-45-6789 must not be claimed
  by the phone pattern and softened into a notice.

  These are all high-confidence shapes. Names are the obvious omission and they
  stay omitted — there is no pattern for "Whitfield" that does not also fire on
  half the English language, and a scanner that cries wolf is one officers learn
  to click past, which is worse than not having it.
*/
const PATTERNS: Pattern[] = [
  {
    kind: 'ssn',
    label: 'Social security number',
    plural: 'social security numbers',
    placeholder: '[SSN]',
    severity: 'stop',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    kind: 'dob',
    label: 'Date of birth',
    plural: 'dates of birth',
    placeholder: '[date]',
    severity: 'notice',
    // Written the way a person writes one, or the way the database holds it.
    regex: /\b(?:\d{1,2}\/\d{1,2}\/(?:19|20)?\d{2}|(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/g,
  },
  {
    kind: 'caseNumber',
    label: 'Case number',
    plural: 'case numbers',
    placeholder: '[case number]',
    severity: 'notice',
    regex: /\b(?:19|20)\d{2}-[A-Z]?\d{4,8}\b/g,
  },
  {
    kind: 'phone',
    label: 'Phone number',
    plural: 'phone numbers',
    placeholder: '[phone]',
    severity: 'notice',
    regex: /\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  },
  {
    kind: 'email',
    label: 'Email address',
    plural: 'email addresses',
    placeholder: '[email]',
    severity: 'notice',
    regex: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
  },
  {
    kind: 'address',
    label: 'Street address',
    plural: 'street addresses',
    placeholder: '[address]',
    severity: 'notice',
    regex:
      /\b\d{1,5}\s+(?:[A-Z][\w'-]*\s+){1,3}(?:St|Street|Rd|Road|Ave|Avenue|Ln|Lane|Dr|Drive|Ct|Court|Blvd|Boulevard|Way|Pl|Place|Ter|Terrace|Cir|Circle|Hwy|Highway)\b\.?/g,
  },
  {
    kind: 'licencePlate',
    label: 'Licence plate',
    plural: 'licence plates',
    placeholder: '[plate]',
    severity: 'notice',
    /*
      Only the shapes distinctive enough to be worth flagging: three letters
      then digits, or the digit-then-letters form this system's own data uses.
      Both require uppercase and a letter/digit boundary that ordinary prose
      does not have — and neither matches an ORI, which is two letters and
      seven digits, or a statute cite.
    */
    regex: /\b(?:[A-Z]{3}[-\s]?\d{3,4}|\d[A-Z]{2,3}[-\s]?\d{3,4})\b/g,
  },
];

/**
 * Everything in the text that should probably not leave the agency.
 *
 * Overlaps are resolved in favour of the earlier, more serious pattern, so one
 * span is never reported twice under two names.
 */
export function scan(text: string): Finding[] {
  const found: Finding[] = [];
  const taken: [number, number][] = [];

  const overlaps = (start: number, end: number) =>
    taken.some(([s, e]) => start < e && end > s);

  for (const pattern of PATTERNS) {
    // A `g` regex carries state between calls; a fresh one per scan avoids the
    // classic bug where every other call silently starts mid-string.
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (overlaps(start, end)) continue;
      taken.push([start, end]);
      found.push({
        kind: pattern.kind,
        label: pattern.label,
        plural: pattern.plural,
        placeholder: pattern.placeholder,
        severity: pattern.severity,
        text: match[0],
        start,
        end,
      });
    }
  }

  return found.sort((a, b) => a.start - b.start);
}

/** Replaces every finding with its placeholder, back to front so offsets hold. */
export function redact(text: string, findings: Finding[]): string {
  return [...findings]
    .sort((a, b) => b.start - a.start)
    .reduce(
      (out, finding) => out.slice(0, finding.start) + finding.placeholder + out.slice(finding.end),
      text,
    );
}

/** A finding that will be removed on the way out, said or not. */
export function mustAcknowledge(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === 'stop');
}

/**
 * Strips only what must not leave, and says whether it had to.
 *
 * Run on the server so the guarantee does not rest on the client having run
 * it. Notices are left exactly as the officer wrote them.
 */
export function enforceRedaction(text: string): { text: string; removed: Finding[] } {
  const removed = scan(text).filter((f) => f.severity === 'stop');
  return { text: removed.length > 0 ? redact(text, removed) : text, removed };
}

/** "a social security number and two dates" — for a warning worth reading. */
export function describeFindings(findings: Finding[]): string {
  const counts = new Map<string, { n: number; plural: string }>();
  for (const finding of findings) {
    const seen = counts.get(finding.label);
    counts.set(finding.label, { n: (seen?.n ?? 0) + 1, plural: finding.plural });
  }
  const parts = [...counts].map(([label, { n, plural }]) =>
    n === 1 ? `a ${label.toLowerCase()}` : `${n} ${plural}`,
  );
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export const SUMMARY_MAX = 120;
export const DETAIL_MAX = 4000;

export interface DraftProblem {
  field: 'summary' | 'detail';
  message: string;
}

/**
 * Deliberately thin.
 *
 * A feedback form that argues with an officer about how they filled it in is a
 * feedback form nobody uses twice. A summary is required because a queue of
 * blank titles cannot be triaged; everything else is optional.
 */
export function checkDraft(draft: FeedbackDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const summary = draft.summary.trim();

  if (!summary) {
    problems.push({ field: 'summary', message: 'Say in one line what happened.' });
  } else if (summary.length > SUMMARY_MAX) {
    problems.push({
      field: 'summary',
      message: `Keep the one-line summary under ${SUMMARY_MAX} characters — the detail box below has room.`,
    });
  }

  if (draft.detail.length > DETAIL_MAX) {
    problems.push({
      field: 'detail',
      message: `That is longer than ${DETAIL_MAX.toLocaleString()} characters. Trim it, or raise it as two.`,
    });
  }

  return problems;
}

/* ------------------------------------------------------------------ */
/* The queue                                                           */
/* ------------------------------------------------------------------ */

/**
 * Most useful first.
 *
 * Not newest first: a queue sorted by arrival buries the thing stopping four
 * officers under twelve fresh notes about a label. Blocking beats seconded
 * beats recent, and anything already answered drops below everything that is
 * not.
 */
export function triage(items: Feedback[]): Feedback[] {
  const openness = (item: Feedback) =>
    item.status === 'new' ? 0 : item.status === 'reading' ? 1 : item.status === 'planned' ? 2 : 3;
  const weight = (item: Feedback) =>
    item.impact === 'blocked' ? 0 : item.impact === 'workaround' ? 1 : 2;

  return [...items].sort(
    (a, b) =>
      openness(a) - openness(b) ||
      weight(a) - weight(b) ||
      b.seconded.length - a.seconded.length ||
      b.at.localeCompare(a.at),
  );
}

/** Whether this person has already said "same here" on this one. */
export function hasSeconded(item: Feedback, userId: string): boolean {
  return item.seconded.includes(userId);
}

/**
 * Suggestions worth showing before somebody writes a new one.
 *
 * Open items only, and never their own: the point is to turn a second report of
 * a known fault into a second voice on the existing one.
 */
export function alreadyRaised(items: Feedback[], userId: string): Feedback[] {
  return triage(
    items.filter(
      (item) =>
        (item.status === 'new' || item.status === 'reading' || item.status === 'planned') &&
        item.submittedBy !== userId,
    ),
  );
}

/**
 * Anything the person who raised it has not seen the answer to.
 *
 * Closing the loop is the whole difference between a feedback channel and a
 * suggestion box nailed shut. An officer who once saw "fixed — thank you" on
 * something they reported will report the next one.
 */
export function answeredFor(items: Feedback[], userId: string): Feedback[] {
  return items
    .filter(
      (item) =>
        item.submittedBy === userId &&
        Boolean(item.response) &&
        (item.status === 'shipped' || item.status === 'declined' || item.status === 'planned'),
    )
    .sort((a, b) => b.respondedAt.localeCompare(a.respondedAt));
}
