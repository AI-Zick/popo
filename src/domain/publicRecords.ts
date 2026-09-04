/**
 * Public records requests.
 *
 * A records clerk's job is a clock and a judgement, and this file is mostly the
 * clock. Every state's public records act sets a period to respond in, and
 * missing it is the failure agencies are actually sued for — far more often
 * than releasing something they should not have.
 *
 * Three things shape how this is built.
 *
 * **The clock is derived, never stored.** There is no `daysLeft` column that a
 * nightly job keeps honest, because the day that job does not run is the day a
 * clerk is told a request is fine when it is four days late. The date it is due
 * is worked out from when it arrived, the agency's period, the extensions taken
 * and the days it sat waiting on the requester — every time anybody looks.
 *
 * **A requester does not have to say who they are.** Several states forbid
 * conditioning a release on identifying yourself or saying why you want it, and
 * a form with a required name field quietly breaks that law on every request.
 * The name is optional here and the screen says why. What is required is some
 * way to hand the records back, and "they are standing at the counter" is one.
 *
 * **The clock stops only for things the requester controls.** Waiting on a
 * clarification, or on a fee the requester has not paid, is time the agency is
 * not spending. Being busy is not. A system that lets an agency pause its own
 * statutory clock for any reason it likes is a system for laundering late
 * responses, so the reasons are a closed list.
 */

import type { UUID } from './person';
import type { ExemptionRule } from './exemption';
import { CITATION_NEEDED, isCited } from './exemption';
import type { Notice, Span, Unreadable } from './redaction';
import { applyRedactions, withholdingLog, type WithholdingLine } from './redaction';

/* ------------------------------------------------------------------ */
/* What the agency has decided about answering                         */
/* ------------------------------------------------------------------ */

export interface PublicRecordsPolicy {
  /** How long the state gives the agency to respond. */
  responseDays: number;

  /**
   * Whether that period is counted in business days.
   *
   * States split roughly evenly and the difference is nearly a week on a
   * ten-day clock, so guessing is not an option.
   */
  businessDays: boolean;

  /** The longest single extension the statute allows. Zero where there is none. */
  extensionDays: number;

  /** How many times it may be extended. Zero where the statute is silent. */
  maxExtensions: number;

  /** Days the agency is closed, so a due date does not land on one. */
  holidays: string[];

  /**
   * The state's public records act. Blank until an agency fills it in — the
   * same rule as every other schedule here: a number nobody has checked
   * against the statute is a number, not a policy.
   */
  authority: string;

  /** What the agency charges, in words, shown to a requester before any fee. */
  feeNotice: string;
}

export function defaultPolicy(): PublicRecordsPolicy {
  return {
    /*
      Ten days, which is the most common period and is wrong in a good number
      of states — some are three days, some are "promptly" with no number at
      all, some are twenty. It ships with a blank authority for exactly that
      reason.
    */
    responseDays: 10,
    businessDays: true,
    extensionDays: 0,
    maxExtensions: 0,
    holidays: [],
    authority: '',
    feeNotice: '',
  };
}

/* ------------------------------------------------------------------ */
/* The request                                                         */
/* ------------------------------------------------------------------ */

export type RequestChannel = 'counter' | 'email' | 'post' | 'portal' | 'phone';

export const CHANNEL_LABEL: Record<RequestChannel, string> = {
  counter: 'At the counter',
  email: 'By email',
  post: 'By post',
  portal: 'Through the portal',
  phone: 'By telephone',
};

/**
 * Who asked, as far as they chose to say.
 *
 * Every field is optional. `collect` records how the records get back to them,
 * which is the only thing the agency actually needs.
 */
export interface Requester {
  name: string;
  organization: string;
  email: string;
  phone: string;
  address: string;
  /** 'They will collect it at the counter' is a legitimate answer. */
  collect: string;
}

/** One record identified as responsive to the request. */
export interface ResponsiveItem {
  id: UUID;
  /** 'incident', 'citation', 'crash', 'arrest', 'attachment'… */
  kind: string;
  recordId: UUID;
  /** How it reads in the queue — a case number, a ticket number. */
  label: string;
  addedAt: string;
  addedBy: string;
  review: ItemReview | null;
}

/**
 * What the clerk decided about one record.
 *
 * `spans` is the proposal after a person has been through it: every span
 * carries an explicit accept or reject, and a clerk may add their own — which
 * is the case the automatic pass exists to make easier rather than to replace.
 */
export interface ItemReview {
  spans: DecidedSpan[];
  /** Notices answered, by rule id. A notice nobody answered blocks the release. */
  answered: string[];
  /** What was decided about each thing nothing could read inside. */
  attachments: AttachmentDecision[];

  /**
   * The clerk's attestation that they read the whole record.
   *
   * Not a formality. The automatic pass cannot find a person identified by
   * description, and this is the checkbox that says somebody looked for one.
   */
  readInFull: boolean;

  approvedAt: string;
  approvedBy: string;
  approvedByName: string;
}

export type SpanDecision = 'accepted' | 'rejected';

/**
 * The authority as it stands now, written onto the spans being approved.
 *
 * A span carries the citation its rule had when the proposal was drawn. If an
 * administrator names the statute in between — which is exactly what the
 * release gate asks them to do — every span on the clerk's screen is still
 * carrying the blank it was born with, and the withholding log would go out to
 * the requester with nothing against it. The gate would have passed, because
 * the gate reads the rule; the document would be wrong, because it reads the
 * span.
 *
 * So the authority is stamped at the moment of approval. What is recorded is
 * what was in force when a person approved it, which is the thing they
 * approved under. A span the clerk drew themselves keeps the citation they
 * typed: it belongs to no rule.
 */
export function stampAuthorities(spans: DecidedSpan[], rules: ExemptionRule[]): DecidedSpan[] {
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  return spans.map((span) => {
    if (span.addedByClerk) return span;
    const rule = byId.get(span.ruleId);
    return rule ? { ...span, authority: rule.authority, ruleLabel: rule.label } : span;
  });
}

export interface DecidedSpan extends Span {
  decision: SpanDecision;
  /** True where the clerk drew it rather than a rule proposing it. */
  addedByClerk: boolean;
  /** Why it was rejected, where a clerk overruled a rule. */
  note: string;
}

export type AttachmentOutcome = 'released' | 'withheld' | 'replaced';

export interface AttachmentDecision {
  attachmentId: string;
  filename: string;
  outcome: AttachmentOutcome;
  /** The authority, where it was withheld. Required, same as a span. */
  authority: string;
  note: string;
}

/** Something said to or heard from the requester, kept in order. */
export interface Correspondence {
  id: UUID;
  at: string;
  by: string;
  byName: string;
  direction: 'out' | 'in';
  text: string;
}

/**
 * A stretch of time the clock was not running.
 *
 * `until` empty means it is still running now. The reasons are a closed list
 * because an open one is a way to be on time about everything.
 */
export type PauseReason = 'clarification' | 'fee';

export const PAUSE_LABEL: Record<PauseReason, string> = {
  clarification: 'Waiting for the requester to say what they want',
  fee: 'Waiting for the requester to pay the fee',
};

export interface Pause {
  id: UUID;
  reason: PauseReason;
  from: string;
  until: string;
  note: string;
}

export interface Extension {
  id: UUID;
  at: string;
  by: string;
  days: number;
  /** Told to the requester, because most statutes require it to be. */
  reason: string;
}

export type Outcome = 'released' | 'partial' | 'denied' | 'noRecords' | 'withdrawn';

export const OUTCOME_LABEL: Record<Outcome, string> = {
  released: 'Released in full',
  partial: 'Released in part',
  denied: 'Denied',
  noRecords: 'No records held',
  withdrawn: 'Withdrawn by the requester',
};

export interface Closure {
  at: string;
  by: string;
  byName: string;
  outcome: Outcome;
  /**
   * Why, in the words that go to the requester.
   *
   * Required for a denial and for a partial release. Most acts require a
   * written statement of the reason and the specific exemption, and a denial
   * with an empty reason is the one an agency loses.
   */
  reason: string;
}

export interface PublicRequest {
  id: UUID;
  /** PR-2026-0041, shown to the requester and used to find it again. */
  number: string;
  receivedAt: string;
  channel: RequestChannel;
  requester: Requester;

  /** What was asked for, in the requester's own words where possible. */
  description: string;

  assignedTo: string;
  assignedToName: string;

  items: ResponsiveItem[];
  correspondence: Correspondence[];
  pauses: Pause[];
  extensions: Extension[];
  closure: Closure | null;

  /** Cents. Zero where nothing is charged, which is most of them. */
  feeCents: number;
  feePaidAt: string;
}

export function createRequest(partial: Partial<PublicRequest> = {}): PublicRequest {
  return {
    id: '',
    number: '',
    receivedAt: new Date().toISOString(),
    channel: 'email',
    requester: { name: '', organization: '', email: '', phone: '', address: '', collect: '' },
    description: '',
    assignedTo: '',
    assignedToName: '',
    items: [],
    correspondence: [],
    pauses: [],
    extensions: [],
    closure: null,
    feeCents: 0,
    feePaidAt: '',
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* Taking one in                                                       */
/* ------------------------------------------------------------------ */

export interface Check {
  ok: boolean;
  reason: string;
  field: string;
  advice: string;
}

const good: Check = { ok: true, reason: '', field: '', advice: '' };

/**
 * Whether a request can be logged.
 *
 * Short on purpose. What is asked for, and how to answer it — nothing else is
 * the agency's business, and a form that asks for more than it needs is a form
 * that discourages people from asking, which is its own kind of failure.
 */
export function checkRequest(request: PublicRequest): Check {
  if (!request.description.trim()) {
    return {
      ok: false,
      reason: 'What did they ask for?',
      field: 'description',
      advice:
        'Their own words are best, even where they are vague — a request this office later narrowed reads differently from one that arrived narrow, and the difference matters if anybody asks whether the search was adequate.',
    };
  }
  const { email, phone, address, collect } = request.requester;
  if (!email.trim() && !phone.trim() && !address.trim() && !collect.trim()) {
    return {
      ok: false,
      reason: 'There is no way to get the records back to them.',
      field: 'collect',
      advice:
        'An email address, a telephone number, a postal address, or a note that they are collecting it. Their name is not required and should not be asked for as a condition — several states forbid it.',
    };
  }
  if (!request.receivedAt) {
    return { ok: false, reason: 'When did it arrive?', field: 'receivedAt', advice: 'The statutory clock runs from this date.' };
  }
  return good;
}

/* ------------------------------------------------------------------ */
/* The clock                                                           */
/* ------------------------------------------------------------------ */

const DAY = 86_400_000;

const iso = (date: Date): string => date.toISOString().slice(0, 10);

const at = (day: string): Date => new Date(`${day}T12:00:00Z`);

/** Saturday, Sunday, or a day the agency said it is closed. */
export function isClosed(day: string, holidays: string[]): boolean {
  const weekday = at(day).getUTCDay();
  return weekday === 0 || weekday === 6 || holidays.includes(day);
}

/**
 * Counting forward.
 *
 * Business days count the days the office is open, so a request in on Friday
 * afternoon with a three-day clock is due Wednesday, not Monday. Calendar days
 * still cannot fall due on a closed day — every state that counts this way
 * rolls to the next open one, because an agency cannot respond on a day it is
 * shut.
 */
export function addDays(
  from: string,
  days: number,
  businessDays: boolean,
  holidays: string[],
): string {
  let cursor = at(from);
  if (businessDays) {
    let left = days;
    while (left > 0) {
      cursor = new Date(cursor.getTime() + DAY);
      if (!isClosed(iso(cursor), holidays)) left -= 1;
    }
    return iso(cursor);
  }
  cursor = new Date(cursor.getTime() + days * DAY);
  while (isClosed(iso(cursor), holidays)) cursor = new Date(cursor.getTime() + DAY);
  return iso(cursor);
}

/** Days a pause has taken off the clock, counted the same way the clock is. */
export function pausedDays(
  pauses: Pause[],
  businessDays: boolean,
  holidays: string[],
  today: string,
): number {
  let total = 0;
  for (const pause of pauses) {
    if (!pause.from) continue;
    const end = pause.until ? pause.until.slice(0, 10) : today;
    let cursor = at(pause.from.slice(0, 10));
    const last = at(end);
    while (cursor < last) {
      cursor = new Date(cursor.getTime() + DAY);
      if (!businessDays || !isClosed(iso(cursor), holidays)) total += 1;
    }
  }
  return total;
}

export interface Standing {
  /** The date a response is due, after extensions and pauses. */
  dueDate: string;
  /** Negative once it is late. */
  daysLeft: number;
  overdue: boolean;
  /** Still open and running, as opposed to paused or closed. */
  running: boolean;
  paused: Pause | null;
  line: string;
  tone: 'ok' | 'soon' | 'late' | 'done';
}

/**
 * When this is due, worked out from scratch every time it is asked.
 *
 * The extensions add to the period. The pauses add to it too, but only for
 * time already spent — a request paused this morning is not due five days
 * later than it was yesterday, it is due five days after the pause ends,
 * which is what counting only elapsed paused days produces.
 */
export function standing(
  request: PublicRequest,
  policy: PublicRecordsPolicy,
  today: string = iso(new Date()),
): Standing {
  const paused = request.pauses.find((pause) => !pause.until) ?? null;
  const spent = pausedDays(request.pauses, policy.businessDays, policy.holidays, today);
  const granted = request.extensions.reduce((sum, extension) => sum + extension.days, 0);
  const dueDate = addDays(
    request.receivedAt.slice(0, 10),
    policy.responseDays + granted + spent,
    policy.businessDays,
    policy.holidays,
  );

  if (request.closure) {
    const closedOn = request.closure.at.slice(0, 10);
    const late = closedOn > dueDate;
    return {
      dueDate,
      daysLeft: 0,
      overdue: late,
      running: false,
      paused: null,
      line: late
        ? `${OUTCOME_LABEL[request.closure.outcome]} on ${closedOn}, after the ${dueDate} deadline`
        : `${OUTCOME_LABEL[request.closure.outcome]} on ${closedOn}`,
      tone: late ? 'late' : 'done',
    };
  }

  const daysLeft = Math.round((at(dueDate).getTime() - at(today).getTime()) / DAY);
  const overdue = daysLeft < 0;

  if (paused) {
    return {
      dueDate,
      daysLeft,
      overdue,
      running: false,
      paused,
      line: `${PAUSE_LABEL[paused.reason]} since ${paused.from.slice(0, 10)} — the clock is stopped`,
      tone: 'soon',
    };
  }

  return {
    dueDate,
    daysLeft,
    overdue,
    running: true,
    paused: null,
    line: overdue
      ? `${Math.abs(daysLeft)} ${Math.abs(daysLeft) === 1 ? 'day' : 'days'} past the ${dueDate} deadline`
      : daysLeft === 0
        ? `Due today, ${dueDate}`
        : `Due ${dueDate}, in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`,
    tone: overdue ? 'late' : daysLeft <= 2 ? 'soon' : 'ok',
  };
}

/**
 * Whether another extension is allowed.
 *
 * A state that gives no extension is not one where the agency may take one
 * anyway, so this refuses rather than warning. Where the statute is silent —
 * `maxExtensions` of zero with days available — it allows one and says the
 * requester has to be told.
 */
export function checkExtension(
  request: PublicRequest,
  policy: PublicRecordsPolicy,
  days: number,
  reason: string,
): Check {
  if (request.closure) {
    return { ok: false, reason: 'This request is closed.', field: '', advice: '' };
  }
  if (policy.extensionDays <= 0) {
    return {
      ok: false,
      reason: 'This agency has no extension configured.',
      field: 'days',
      advice:
        'Not every public records act allows one. If the state does, an administrator sets the length in the records policy — and if it does not, the answer is due on the date it is due.',
    };
  }
  if (policy.maxExtensions > 0 && request.extensions.length >= policy.maxExtensions) {
    return {
      ok: false,
      reason: `The statute allows ${policy.maxExtensions} ${policy.maxExtensions === 1 ? 'extension' : 'extensions'} and ${request.extensions.length} have been taken.`,
      field: 'days',
      advice: 'Respond with what has been found so far rather than taking one that is not there.',
    };
  }
  if (days <= 0 || days > policy.extensionDays) {
    return {
      ok: false,
      reason: `An extension here is between 1 and ${policy.extensionDays} days.`,
      field: 'days',
      advice: '',
    };
  }
  if (reason.trim().split(/\s+/).filter(Boolean).length < 4) {
    return {
      ok: false,
      reason: 'Say why, in a sentence.',
      field: 'reason',
      advice:
        'Most acts require the requester to be told the reason and the new date, and this text is what goes to them. "Volume" on its own is not a reason anybody can check.',
    };
  }
  return good;
}

/* ------------------------------------------------------------------ */
/* Where the request has got to                                        */
/* ------------------------------------------------------------------ */

export type Stage = 'logged' | 'searching' | 'review' | 'ready' | 'closed';

export const STAGE_LABEL: Record<Stage, string> = {
  logged: 'Logged, nothing found yet',
  searching: 'Records being gathered',
  review: 'Redactions being reviewed',
  ready: 'Ready to release',
  closed: 'Closed',
};

/**
 * What stage this is at, worked out from what has happened to it.
 *
 * Not a column somebody remembers to change. A request is in review because
 * records have been attached and not all of them are approved — that is the
 * same sentence as the definition, which is why it cannot drift.
 */
export function stage(request: PublicRequest): Stage {
  if (request.closure) return 'closed';
  if (request.items.length === 0) return request.assignedTo ? 'searching' : 'logged';
  if (request.items.every((item) => item.review?.approvedAt)) return 'ready';
  return 'review';
}

/**
 * The order a queue is worked in.
 *
 * Overdue first, then by how little time is left. A queue sorted by arrival is
 * a queue where the request that came in yesterday and is due tomorrow sits
 * under thirty older ones with a fortnight in hand.
 */
export function sortQueue(
  requests: PublicRequest[],
  policy: PublicRecordsPolicy,
  today?: string,
): PublicRequest[] {
  return [...requests].sort((a, b) => {
    const left = standing(a, policy, today);
    const right = standing(b, policy, today);
    if (left.running !== right.running) return left.running ? -1 : 1;
    if (left.dueDate !== right.dueDate) return left.dueDate < right.dueDate ? -1 : 1;
    return a.receivedAt < b.receivedAt ? -1 : 1;
  });
}

/* ------------------------------------------------------------------ */
/* Approving a record for release                                      */
/* ------------------------------------------------------------------ */

export interface Blocker {
  /** Where on the screen the thing that needs doing is. */
  field: string;
  reason: string;
  advice: string;
}

/**
 * Everything standing between this record and going out of the door.
 *
 * Returned as a list rather than the first one found, because a clerk who
 * fixes one thing and is immediately told about the next has been made to do
 * the same work four times. All of it, at once, in the order it appears on the
 * screen.
 */
export function releaseBlockers(
  review: ItemReview,
  notices: Notice[],
  unreadable: Unreadable[],
  rules: ExemptionRule[],
): Blocker[] {
  const blockers: Blocker[] = [];
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const accepted = review.spans.filter((span) => span.decision === 'accepted');

  /*
    The citation gate, enforced here rather than at the detector. A redaction
    with nothing named against it cannot go on a withholding log, and a
    withholding log is what a requester is entitled to. Two ways out, and both
    are legitimate: name the statute, or release the passage.
  */
  const uncited = accepted.filter((span) => {
    if (span.addedByClerk) return !span.authority.trim();
    const rule = byId.get(span.ruleId);
    return rule ? !isCited(rule) : !span.authority.trim();
  });

  /*
    Grouped by the rule, not listed per span. One rule with nothing named
    against it produces one problem and one fix, however many passages it
    reached — and eleven copies of the same sentence is a screen a clerk stops
    reading, which is the opposite of what this is for.
  */
  const byRule = new Map<string, { label: string; spans: DecidedSpan[] }>();
  for (const span of uncited) {
    const entry = byRule.get(span.ruleId) ?? { label: span.ruleLabel, spans: [] };
    entry.spans.push(span);
    byRule.set(span.ruleId, entry);
  }
  for (const [ruleId, entry] of byRule) {
    const count = entry.spans.length;
    blockers.push({
      field: `rule:${ruleId}`,
      reason:
        count === 1
          ? `"${entry.label}" is withholding one passage with no statute named.`
          : `"${entry.label}" is withholding ${count} passages with no statute named.`,
      advice: CITATION_NEEDED,
    });
  }

  for (const notice of notices) {
    if (!review.answered.includes(notice.ruleId)) {
      blockers.push({
        field: `notice:${notice.ruleId}`,
        reason: `Nothing has been said about ${notice.ruleLabel.toLowerCase()}.`,
        advice: `${notice.message} Mark it read once you have looked — this is a question nothing automatic can answer.`,
      });
    }
  }

  for (const item of unreadable) {
    const decided = review.attachments.find((decision) => decision.filename === item.label);
    if (!decided) {
      blockers.push({
        field: `attachment:${item.label}`,
        reason: `Nothing has decided what happens to ${item.label}.`,
        advice: item.why,
      });
      continue;
    }
    if (decided.outcome === 'withheld' && !decided.authority.trim()) {
      blockers.push({
        field: `attachment:${item.label}`,
        reason: `${item.label} is being withheld with no statute named.`,
        advice: CITATION_NEEDED,
      });
    }
  }

  if (!review.readInFull) {
    blockers.push({
      field: 'readInFull',
      reason: 'Nobody has said they read the whole record.',
      advice:
        'The automatic pass finds what has a shape it can recognise. It will not find "the neighbour with the blue truck who called it in", and that sentence identifies somebody as surely as a name. This is the box that says a person looked for one.',
    });
  }

  return blockers;
}

/**
 * Whether the request as a whole can be closed out.
 *
 * A denial needs its reason in writing, and so does a partial release: nearly
 * every act requires the requester to be told what was withheld and under what
 * authority, and "some material was redacted" is not that.
 */
export function checkClosure(request: PublicRequest, outcome: Outcome, reason: string): Check {
  if (request.closure) {
    return { ok: false, reason: 'This request is already closed.', field: '', advice: '' };
  }
  if (outcome !== 'withdrawn' && outcome !== 'noRecords') {
    const unapproved = request.items.filter((item) => !item.review?.approvedAt);
    if (request.items.length === 0) {
      return {
        ok: false,
        reason: 'No records are attached to this request.',
        field: 'items',
        advice:
          'If the search found nothing, close it as no records held — that is a different answer from a release, and a requester may appeal it.',
      };
    }
    if (unapproved.length > 0) {
      return {
        ok: false,
        reason: `${unapproved.length} of ${request.items.length} records have not been reviewed.`,
        field: 'items',
        advice: 'Every record going out is read and approved by a person first.',
      };
    }
  }
  const words = reason.trim().split(/\s+/).filter(Boolean).length;
  if ((outcome === 'denied' || outcome === 'partial') && words < 6) {
    return {
      ok: false,
      reason: outcome === 'denied' ? 'A denial needs its reason in writing.' : 'Say what was withheld and why.',
      field: 'reason',
      advice:
        'This is what goes to the requester, and in most states it is what an appeal is decided on. Name the exemption and what it covers — a denial with nothing in it is the one the agency loses.',
    };
  }
  return good;
}

/**
 * What the outcome must be, given what was actually done.
 *
 * A clerk who redacted four passages and then closed the request as released
 * in full has misdescribed it, probably by clicking the first option. The
 * outcome follows from the decisions, and where it disagrees with the choice
 * the screen says so before anything is sent.
 */
export function impliedOutcome(request: PublicRequest): Outcome {
  if (request.items.length === 0) return 'noRecords';
  const withheld = request.items.some(
    (item) =>
      item.review?.spans.some((span) => span.decision === 'accepted') ||
      item.review?.attachments.some((decision) => decision.outcome !== 'released'),
  );
  return withheld ? 'partial' : 'released';
}

/* ------------------------------------------------------------------ */
/* What actually goes out                                              */
/* ------------------------------------------------------------------ */

export interface ReleasedRecord {
  itemId: UUID;
  label: string;
  fields: Record<string, string>;
  withholding: WithholdingLine[];
}

/**
 * The released text, built here from the original and the accepted spans.
 *
 * Built, never received. A client that hands the server a finished string is a
 * client that can hand it the unredacted one, and the difference would not be
 * visible to anybody. The original text and the list of what was approved is
 * all this needs, and it is the only thing it will take.
 */
export function buildRelease(
  itemId: UUID,
  label: string,
  fields: Record<string, string>,
  review: ItemReview,
): ReleasedRecord {
  const accepted = review.spans.filter((span) => span.decision === 'accepted');
  const released: Record<string, string> = {};
  for (const [field, text] of Object.entries(fields)) {
    released[field] = applyRedactions(
      text,
      accepted.filter((span) => span.field === field),
    );
  }
  return { itemId, label, fields: released, withholding: withholdingLog(accepted) };
}

/**
 * What a requester is told about what was kept back.
 *
 * Goes out with the release whether or not the state requires it, because the
 * alternative is a document with holes in it and no account of who made them.
 */
export const WITHHOLDING_NOTICE =
  'Material has been withheld from this release. Each redaction is listed below with the authority it was made under. If you believe something has been withheld that should not have been, you may appeal — this agency will tell you how.';
