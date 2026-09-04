/**
 * Proposing redactions, and never making them.
 *
 * Everything in this file suggests. A person decides. That is not caution for
 * its own sake — it is because the two ways of getting this wrong are both
 * serious and they pull in opposite directions.
 *
 * Release something exempt — a social security number, a juvenile's name, a
 * confidential source — and the harm cannot be taken back. Withhold something
 * releasable and the agency has broken the public records act, which is the
 * thing most agencies actually get sued over. A tool that leans either way on
 * its own is a tool that does harm on its own.
 *
 * **What it finds is not everything there is.** This is the most important
 * sentence in the module. A pattern reliably finds a social security number
 * because the shape of the thing is the thing. Nothing here can find "the
 * neighbour with the blue truck who called it in", and that sentence
 * identifies somebody as surely as a name does. So a clerk reads the whole
 * record, every time, and the screen says so rather than reporting a count and
 * implying completeness. A proposal with four spans on it means four spans
 * were found, not that four is how many there are.
 */

import type { Detector, ExemptionRule } from './exemption';
import { DETECTOR_FAMILY, activeRules } from './exemption';

/* ------------------------------------------------------------------ */
/* What a proposal is made of                                          */
/* ------------------------------------------------------------------ */

export type Confidence = 'high' | 'medium';

/** One stretch of text a rule wants hidden. */
export interface Span {
  id: string;
  /** Which text this is in — 'narrative', 'summary', a supplement id. */
  field: string;
  start: number;
  end: number;
  /** What is actually there, so a clerk can see what they are approving. */
  text: string;
  ruleId: string;
  ruleLabel: string;
  authority: string;
  detector: Detector;
  confidence: Confidence;
  /** Why this one, in words a clerk can put in front of a requester. */
  because: string;
}

/**
 * A rule that has something to say but nothing to point at.
 *
 * The honest half of the design. "This report mentions an ambulance" is worth
 * telling a clerk; pretending a regular expression located the medical
 * information in a narrative is not.
 */
export interface Notice {
  ruleId: string;
  ruleLabel: string;
  authority: string;
  action: 'flag' | 'review';
  message: string;
}

/** Something on the record this engine cannot read at all. */
export interface Unreadable {
  kind: string;
  label: string;
  why: string;
}

export interface Proposal {
  spans: Span[];
  notices: Notice[];
  /**
   * Attachments and anything else nothing here has looked inside.
   *
   * Never empty just because there is nothing to say — if a record carries a
   * photograph, that photograph is on this list, because a release that
   * includes it has had a human look at it or it should not go out.
   */
  unreadable: Unreadable[];
  /** Which rules actually ran, so a clerk can see what was and was not checked. */
  ranRules: { id: string; label: string; authority: string }[];
}

/* ------------------------------------------------------------------ */
/* What the engine is given to read                                    */
/* ------------------------------------------------------------------ */

/** One person on the record, as the record-aware detectors need them. */
export interface SubjectContext {
  id: string;
  firstName: string;
  lastName: string;
  aliases: string[];
  dob: string;
  address: string;
  driverLicense: string;
  /** victim, witness, suspect, arrestee, complainant, other. */
  role: string;
  /** Worked out from the date of birth against the date of the offence. */
  juvenile: boolean;
}

export interface RecordContext {
  subjects: SubjectContext[];
  plates: string[];
  offenseCodes: string[];
  /** True where a DMV or registry query is attached to this record. */
  hasDmvReturn: boolean;
  hasCriminalHistory: boolean;
  /** Attachments, which nothing here reads. */
  attachments: { id: string; filename: string; mime: string }[];
}

/** The text this engine works over, keyed by a field name a screen can show. */
export type TextFields = Record<string, string>;

/* ------------------------------------------------------------------ */
/* Pattern detectors                                                   */
/* ------------------------------------------------------------------ */

/*
  A social security number, and deliberately not every nine-digit string.

  Matching bare nine digits would catch case numbers, serial numbers, amounts
  in cents and phone numbers without punctuation, and a redactor whose
  suggestions are mostly wrong is one clerks learn to click through — which
  costs more than it saves the first time a real one goes past.
*/
const SSN = /\b\d{3}-\d{2}-\d{4}\b|\b(?:ssn|social security(?:\s+(?:number|no\.?|#))?)\s*[:#]?\s*(\d{3}[-\s]?\d{2}[-\s]?\d{4})\b/gi;

const PHONE = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/*
  A date of birth, only where it is labelled as one.

  An unlabelled date is far more likely to be when the offence happened, and
  redacting that from a release would withhold the single most public fact on
  the report. Dates matching a known person's date of birth are caught
  separately, by a detector that knows whose they are.
*/
const LABELLED_DOB = /\b(?:d\.?o\.?b\.?|date of birth|born)\s*[:#]?\s*((?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4})|(?:\d{4}-\d{2}-\d{2}))/gi;

const LABELLED_LICENCE = /\b(?:dl|o\.?l\.?n\.?|driver'?s? licen[cs]e|licen[cs]e (?:number|no\.?|#))\s*[:#]?\s*([A-Z0-9-]{4,20})\b/gi;

/*
  Payment cards, checked against their own check digit.

  Thirteen to nineteen digits is the shape of a card number and also the shape
  of plenty of things that are not one. The Luhn check is what separates them,
  and it is the difference between a rule worth reading and a rule that flags
  every long number on a fraud report.
*/
const LONG_DIGITS = /\b(?:\d[ -]?){12,18}\d\b/g;

function luhn(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/* ------------------------------------------------------------------ */
/* Finding things                                                      */
/* ------------------------------------------------------------------ */

let counter = 0;
const spanId = (): string => `sp_${(counter += 1).toString(36)}_${Date.now().toString(36)}`;

interface Found {
  start: number;
  end: number;
  text: string;
  confidence: Confidence;
  because: string;
}

/** Every match of a pattern, with the capture used where there is one. */
function matches(text: string, pattern: RegExp, because: string, confidence: Confidence): Found[] {
  const found: Found[] = [];
  const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    /*
      Where the pattern captured a group, redact the group rather than the
      label. Blacking out "DOB:" as well as the date tells the reader less and
      makes the release harder to follow, and the label is not the exempt part.
    */
    const captured = match.slice(1).find((group) => group !== undefined);
    const value = captured ?? match[0];
    const start = captured ? match.index + match[0].indexOf(captured) : match.index;
    found.push({ start, end: start + value.length, text: value, confidence, because });
    if (match.index === regex.lastIndex) regex.lastIndex += 1;
  }
  return found;
}

/** Every occurrence of a literal string, case-insensitively, on word boundaries. */
function occurrences(text: string, needle: string, because: string, confidence: Confidence): Found[] {
  const clean = needle.trim();
  if (clean.length < 3) return [];
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return matches(text, new RegExp(`\\b${escaped}\\b`, 'gi'), because, confidence);
}

/** The ways a person's name turns up in a narrative. */
function nameForms(subject: SubjectContext): string[] {
  const forms = new Set<string>();
  const first = subject.firstName.trim();
  const last = subject.lastName.trim();
  if (first && last) {
    forms.add(`${first} ${last}`);
    forms.add(`${last}, ${first}`);
  }
  /*
    The surname on its own, and not the forename. A narrative says "Whitfield
    stated" far more often than it says the full name, and a surname is
    identifying in a way a common forename is not — redacting every "Dana" in
    a report would black out half the sentences and identify nobody.
  */
  if (last.length >= 3) forms.add(last);
  for (const alias of subject.aliases) if (alias.trim().length >= 3) forms.add(alias.trim());
  return [...forms];
}

const displayName = (subject: SubjectContext): string =>
  [subject.firstName, subject.lastName].filter(Boolean).join(' ').trim() || 'a person on this record';

/**
 * Which subjects a record-aware rule is about.
 *
 * The role names come from the incident model. `juvenile` is worked out by the
 * caller from the date of birth, because this module has no business deciding
 * what counts as a juvenile — that is state law and it is not always eighteen.
 */
function subjectsFor(detector: Detector, context: RecordContext): SubjectContext[] {
  switch (detector) {
    case 'juvenileName':
      return context.subjects.filter((subject) => subject.juvenile);
    case 'victimIdentity':
      return context.subjects.filter((subject) => subject.role === 'victim');
    case 'witnessIdentity':
      return context.subjects.filter((subject) => subject.role === 'witness');
    case 'reportingPartyIdentity':
      return context.subjects.filter((subject) => subject.role === 'complainant');
    case 'homeAddress':
      return context.subjects;
    default:
      return [];
  }
}

function findFor(rule: ExemptionRule, text: string, context: RecordContext): Found[] {
  switch (rule.detector) {
    case 'ssn':
      return matches(text, SSN, 'Looks like a social security number.', 'high');
    case 'phone':
      return matches(text, PHONE, 'Looks like a telephone number.', 'medium');
    case 'email':
      return matches(text, EMAIL, 'Looks like an email address.', 'medium');
    case 'dob': {
      const labelled = matches(text, LABELLED_DOB, 'Written down as a date of birth.', 'high');
      /*
        And any date that matches a date of birth actually on the record.
        Unlabelled dates are otherwise left alone, because the most common one
        in a report is when the offence happened, which is public.
      */
      const known = context.subjects
        .filter((subject) => subject.dob)
        .flatMap((subject) =>
          occurrences(
            text,
            subject.dob,
            `Matches the date of birth on file for ${displayName(subject)}.`,
            'high',
          ),
        );
      return [...labelled, ...known];
    }
    case 'driverLicense': {
      const labelled = matches(text, LABELLED_LICENCE, 'Written down as a licence number.', 'high');
      const known = context.subjects
        .filter((subject) => subject.driverLicense.length >= 4)
        .flatMap((subject) =>
          occurrences(
            text,
            subject.driverLicense,
            `Matches the licence number on file for ${displayName(subject)}.`,
            'high',
          ),
        );
      return [...labelled, ...known];
    }
    case 'plate':
      return context.plates
        .filter((plate) => plate.length >= 4)
        .flatMap((plate) => occurrences(text, plate, 'A registration plate on this record.', 'high'));
    case 'bankAccount':
      return matches(text, LONG_DIGITS, 'Passes the check digit for a payment card.', 'high').filter(
        (found) => luhn(found.text),
      );
    case 'custom':
      if (!rule.pattern) return [];
      try {
        return matches(text, new RegExp(rule.pattern, 'gi'), `Matches ${rule.label}.`, 'medium');
      } catch {
        return [];
      }

    case 'juvenileName':
    case 'victimIdentity':
    case 'witnessIdentity':
    case 'reportingPartyIdentity':
      return subjectsFor(rule.detector, context).flatMap((subject) =>
        nameForms(subject).flatMap((form) =>
          occurrences(
            text,
            form,
            `${displayName(subject)} is ${subject.role === 'complainant' ? 'the reporting party' : `a ${subject.role}`} on this record${subject.juvenile ? ' and was a juvenile at the time' : ''}.`,
            form.includes(' ') || form.includes(',') ? 'high' : 'medium',
          ),
        ),
      );

    case 'homeAddress':
      return context.subjects
        .filter((subject) => subject.address.trim().length >= 6)
        .flatMap((subject) =>
          occurrences(
            text,
            subject.address,
            `The home address on file for ${displayName(subject)}. If this is also where the offence happened, it is probably releasable — check.`,
            'medium',
          ),
        );

    // Everything else is a manual rule and finds nothing by design.
    default:
      return [];
  }
}

/* ------------------------------------------------------------------ */
/* Overlaps                                                            */
/* ------------------------------------------------------------------ */

/**
 * Drops spans swallowed by another, keeping the better-evidenced one.
 *
 * Two rules can find the same text — a juvenile who is also the victim — and
 * applying both would corrupt the offsets of everything after them. Keeping
 * one and losing the other's authority would be worse, so the survivor carries
 * both: the log has to be able to say every reason a thing was withheld.
 */
export function mergeSpans(spans: Span[]): Span[] {
  const byField = new Map<string, Span[]>();
  for (const span of spans) {
    const list = byField.get(span.field) ?? [];
    list.push(span);
    byField.set(span.field, list);
  }

  const kept: Span[] = [];
  for (const list of byField.values()) {
    const sorted = [...list].sort((a, b) => a.start - b.start || b.end - a.end);
    for (const span of sorted) {
      const overlapping = kept.find(
        (other) =>
          other.field === span.field && span.start < other.end && other.start < span.end,
      );
      if (!overlapping) {
        kept.push({ ...span });
        continue;
      }
      // Widen to cover both, and record that more than one rule reached it.
      overlapping.start = Math.min(overlapping.start, span.start);
      overlapping.end = Math.max(overlapping.end, span.end);
      if (!overlapping.because.includes(span.because)) {
        overlapping.because = `${overlapping.because} Also: ${span.because}`;
      }
      if (overlapping.ruleId !== span.ruleId && !overlapping.ruleLabel.includes(span.ruleLabel)) {
        overlapping.ruleLabel = `${overlapping.ruleLabel}; ${span.ruleLabel}`;
        overlapping.authority = `${overlapping.authority}; ${span.authority}`;
      }
      if (span.confidence === 'high') overlapping.confidence = 'high';
    }
  }
  return kept.sort((a, b) => a.field.localeCompare(b.field) || a.start - b.start);
}

/* ------------------------------------------------------------------ */
/* The proposal                                                        */
/* ------------------------------------------------------------------ */

const MANUAL_MESSAGE: Partial<Record<Detector, string>> = {
  dmvReturn:
    'A registration or licence query is attached to this record. What it returned is motor vehicle record data, restricted by federal law whatever the state records act says — and if an officer copied any of it into the narrative, that text carries the same restriction. Nothing here can tell which words those are.',
  criminalHistory:
    'A person query is attached to this record. Criminal history returned through NCIC or a state repository may be used for the purpose it was obtained for and not redisclosed. A conviction found in a public court record is a different thing and is not covered by this.',
  medical:
    'This record may carry medical information. Nothing here can find it — read the narrative and anything attached.',
  mentalHealth:
    'This record may involve mental health. That is often the substance of the narrative rather than a line in it, so read it whole.',
  sexualOffence:
    'A sexual offence is charged or described here. Identity is protected by more than a name — an address, a relationship or a distinctive detail identifies somebody just as well.',
  confidentialSource:
    'Check whether anybody on this record was a confidential source, and whether the narrative would identify one indirectly.',
  ongoingInvestigation:
    'If this case is open, consider whether release would actually harm the investigation. Being open is not itself a reason to withhold.',
  officerSafety:
    'Check for officer home addresses, personal details, and tactical information. An officer’s name on a report they wrote is usually public.',
};

/** Which manual detectors have a sentence written for them. */
export const MANUAL_MESSAGE_KEYS = Object.keys(MANUAL_MESSAGE) as Detector[];

/**
 * What a record's release would need, as far as anything automatic can tell.
 *
 * Runs every rule that is switched on and mechanically sound, cited or not —
 * the citation is enforced at the release, not here. The list of what ran comes
 * back with the proposal, because "we checked for X and found none" and "we
 * never checked for X" are different answers and a clerk needs to know which
 * they have.
 */
export function propose(
  fields: TextFields,
  context: RecordContext,
  rules: ExemptionRule[],
): Proposal {
  const usable = activeRules(rules);
  const spans: Span[] = [];
  const notices: Notice[] = [];

  for (const rule of usable) {
    if (DETECTOR_FAMILY[rule.detector] === 'manual' || rule.action !== 'redact') {
      /*
        A manual rule, or a rule set to flag rather than redact. Only raised
        when there is some reason to think it applies — a mental health notice
        on every burglary is noise, and noise is what teaches people to stop
        reading notices.
      */
      if (appliesManually(rule.detector, context, fields)) {
        notices.push({
          ruleId: rule.id,
          ruleLabel: rule.label,
          authority: rule.authority,
          action: rule.action === 'review' ? 'review' : 'flag',
          message: MANUAL_MESSAGE[rule.detector] ?? rule.note,
        });
      }
      continue;
    }

    for (const [field, text] of Object.entries(fields)) {
      if (!text) continue;
      for (const found of findFor(rule, text, context)) {
        spans.push({
          id: spanId(),
          field,
          start: found.start,
          end: found.end,
          text: found.text,
          ruleId: rule.id,
          ruleLabel: rule.label,
          authority: rule.authority,
          detector: rule.detector,
          confidence: found.confidence,
          because: found.because,
        });
      }
    }
  }

  return {
    spans: mergeSpans(spans),
    notices,
    unreadable: context.attachments.map((attachment) => ({
      kind: 'attachment',
      label: attachment.filename,
      why: 'Nothing here reads inside a file. A person has to open it and decide, and a redaction drawn over an image is not a redaction unless the file that goes out has been changed.',
    })),
    ranRules: usable.map((rule) => ({ id: rule.id, label: rule.label, authority: rule.authority })),
  };
}

/** Whether a manual rule has any reason to speak up about this record. */
function appliesManually(detector: Detector, context: RecordContext, fields: TextFields): boolean {
  const text = Object.values(fields).join(' ').toLowerCase();
  switch (detector) {
    case 'medical':
      return /\b(ambulance|paramedic|hospital|injur|treated|medic|ems|wound|medication)\b/.test(text);
    case 'mentalHealth':
      return /\b(mental health|crisis|committed|suicid|welfare check|psychiatric|self.harm)\b/.test(text);
    case 'sexualOffence':
      return context.offenseCodes.some((code) => code.startsWith('11') || code === '36A' || code === '36B');
    case 'confidentialSource':
      return /\b(informant|confidential|anonymous|source)\b/.test(text);
    case 'ongoingInvestigation':
      return true;
    case 'officerSafety':
      return true;
    case 'dmvReturn':
      return context.hasDmvReturn;
    case 'criminalHistory':
      return context.hasCriminalHistory;
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ */
/* Applying what was approved                                          */
/* ------------------------------------------------------------------ */

/** What a redaction looks like in the released text. */
export const MARKER = '█';

/**
 * The released text, built from the original and the approved spans.
 *
 * The replacement keeps the length of what it covers rather than collapsing
 * it, because a redaction that shortens the line lets a reader work out how
 * long the hidden thing was, and for a plate or a date of birth that is most
 * of the way to knowing it. That length is also what keeps every offset
 * meaning what it meant: nothing shifts, so nothing has to be recalculated.
 *
 * Applied back to front anyway. The equal-length replacement is the only
 * reason order does not matter here, and it is one edit away from not being
 * true — somebody swapping the block for "[REDACTED]" would otherwise turn a
 * correct function into one that is off by a few characters, which is a
 * function that releases the last few digits of a social security number.
 * Ordering costs a sort and removes that from the list of things that can go
 * wrong.
 */
export function applyRedactions(text: string, spans: Span[]): string {
  const ordered = [...spans].sort((a, b) => b.start - a.start);
  let output = text;
  for (const span of ordered) {
    if (span.start < 0 || span.end > output.length || span.start >= span.end) continue;
    output = output.slice(0, span.start) + MARKER.repeat(span.end - span.start) + output.slice(span.end);
  }
  return output;
}

/* ------------------------------------------------------------------ */
/* The withholding log                                                 */
/* ------------------------------------------------------------------ */

export interface WithholdingLine {
  authority: string;
  ruleLabel: string;
  /** How many separate redactions were made under it. */
  count: number;
  /** Which fields they were in, so a requester can see where. */
  fields: string[];
}

/**
 * What was withheld and under what law, which goes out with the release.
 *
 * Required by most state public records acts and the thing agencies most often
 * skip. It names the authority and the count and never the content — a log
 * saying "one social security number, redacted under §X" tells a requester
 * what was done without undoing it.
 */
export function withholdingLog(spans: Span[]): WithholdingLine[] {
  const byAuthority = new Map<string, WithholdingLine>();
  for (const span of spans) {
    const key = `${span.authority}::${span.ruleLabel}`;
    const line = byAuthority.get(key) ?? {
      authority: span.authority,
      ruleLabel: span.ruleLabel,
      count: 0,
      fields: [],
    };
    line.count += 1;
    if (!line.fields.includes(span.field)) line.fields.push(span.field);
    byAuthority.set(key, line);
  }
  return [...byAuthority.values()].sort((a, b) => b.count - a.count);
}

/**
 * The sentence that goes on every release, whatever the count.
 *
 * A proposal is what an automatic pass found, and there is no way for it to
 * know what it missed. Stating that plainly is what stops a count reading as
 * a guarantee.
 */
export const NOT_EXHAUSTIVE =
  'These are what an automatic pass found. It cannot find everything — a person identified by description rather than by name will not appear here — so the record still has to be read in full before it goes out.';
