/**
 * Field contacts.
 *
 * The conversation that is neither a traffic stop nor a report: an officer
 * talks to somebody, nothing is charged, and something about it is worth
 * writing down. Operationally these are useful — the person seen behind the
 * closed units at 0200 is who you ask about later. They are also, of every
 * record type in policing, the one that has cost agencies the most in court.
 *
 * That shapes what this file does and, more importantly, what it refuses to do.
 *
 * **A stated basis, or it is not a stop.** A consensual conversation and a
 * detention are different legal events with different consequences, and
 * officers blur them constantly because in the moment they feel identical. The
 * record has to say which, and a detention has to carry what the officer
 * actually saw. "Suspicious person" is a conclusion, not an observation, and
 * it is the sentence that loses cases.
 *
 * **No affiliation field.** There is deliberately nowhere here to tick "gang
 * member". Agencies have been sued into consent decrees over exactly that
 * dropdown: a box ticked on a street corner becomes a database label, the
 * label outlives the officer who ticked it, and the person it is attached to
 * is never told and cannot contest it. An officer who observed a tattoo, a
 * colour or an association can write what they saw in the narrative, where it
 * reads as an observation somebody made rather than as a fact the system holds.
 *
 * **These age out.** A field contact is on the retention schedule with a short
 * default, and the screen says when this one goes. A record of somebody who
 * did nothing should not outlive the reason for making it, and "we keep
 * everything forever" is the policy that turns a useful note into a dossier.
 *
 * **A contact is not evidence of anything.** Said on the screen, because a
 * list of times somebody was spoken to reads like a record of wrongdoing to
 * anybody who did not write it.
 */

import type { UUID } from './person';

/* ------------------------------------------------------------------ */
/* What kind of contact                                                */
/* ------------------------------------------------------------------ */

export type ContactBasis = '' | 'consensual' | 'detention' | 'community';

export const BASIS_LABEL: Record<ContactBasis, string> = {
  '': 'Not stated',
  consensual: 'Consensual conversation',
  detention: 'Detained on reasonable suspicion',
  community: 'Community contact',
};

export const BASIS_HINT: Record<ContactBasis, string> = {
  '': '',
  consensual:
    'They were free to walk away and would have been let go. No suspicion needed, and none is claimed.',
  detention:
    'They were not free to leave. This needs what you actually saw, in your words — it is the part that gets read out in court.',
  community:
    'A welfare check, a business call-round, a conversation at an event. Nobody is suspected of anything.',
};

export type Disposition =
  | ''
  | 'advised'
  | 'released'
  | 'citation'
  | 'arrest'
  | 'referred'
  | 'transported';

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  '': 'Not stated',
  advised: 'Advised and left',
  released: 'Released',
  citation: 'Citation issued',
  arrest: 'Arrested',
  referred: 'Referred to services',
  transported: 'Transported',
};

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

/**
 * Who was spoken to.
 *
 * A contact can name somebody in the Master Name Index, or describe somebody
 * who would not give a name — and those are kept apart on purpose. Creating a
 * master identity for everybody an officer ever spoke to fills the index with
 * people who did nothing, and an index like that is one nobody trusts and
 * everybody has to page through.
 */
export interface ContactSubject {
  id: UUID;
  /** Blank when this person is not in the index, which is allowed. */
  masterId: UUID | '';
  /** What they gave, when they gave anything. Not an identity. */
  givenName: string;
  /** Build, clothing, anything that would identify them again that night. */
  description: string;
  /** True when they declined to identify themselves, which is usually lawful. */
  declinedToIdentify: boolean;
}

export interface FieldContact {
  id: UUID;
  number: string;

  occurredAt: string;

  /** Where. A location record when there is one, free text when there is not. */
  locationId: UUID | '';
  address: string;

  basis: ContactBasis;
  /**
   * What the officer saw. Required for a detention.
   *
   * The field this whole module is arranged around. It is not a category and
   * it is not a checkbox, because the answer that matters is a sentence.
   */
  reason: string;

  subjects: ContactSubject[];

  /** Points into the Master Vehicle Index, when a vehicle was involved. */
  vehicleId: UUID | '';

  disposition: Disposition;
  narrative: string;

  /** The report this became, if it became one. */
  caseNumber: string;

  officerId: UUID | '';
  officerName: string;

  createdAt: string;
  updatedAt: string;
}

export function createFieldContact(partial: Partial<FieldContact> = {}): FieldContact {
  const now = new Date().toISOString();
  return {
    id: '',
    number: '',
    occurredAt: '',
    locationId: '',
    address: '',
    basis: '',
    reason: '',
    subjects: [],
    vehicleId: '',
    disposition: '',
    narrative: '',
    caseNumber: '',
    officerId: '',
    officerName: '',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function createSubject(partial: Partial<ContactSubject> = {}): ContactSubject {
  return {
    id: '',
    masterId: '',
    givenName: '',
    description: '',
    declinedToIdentify: false,
    ...partial,
  };
}

/** `2026-FC00014`. The FC is there so nobody reads it as a case number. */
export function nextContactNumber(existing: string[], now = new Date()): string {
  const prefix = `${now.getFullYear()}-FC`;
  const used = existing
    .filter((number) => number.startsWith(prefix))
    .map((number) => Number(number.slice(prefix.length)))
    .filter((number) => Number.isFinite(number));
  const next = (used.length > 0 ? Math.max(...used) : 0) + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

/* ------------------------------------------------------------------ */
/* What makes a reason a reason                                        */
/* ------------------------------------------------------------------ */

/**
 * The phrases that are conclusions wearing the clothes of observations.
 *
 * Every one of these has been the whole stated basis for a stop in a case an
 * agency lost. They are not banned — an officer may have written a real
 * account that happens to contain one — but a reason that is *only* one of
 * these is a reason that says nothing, and the form says so before it is
 * filed rather than a lawyer saying so two years later.
 */
const CONCLUSIONS = [
  'suspicious',
  'suspicious person',
  'suspicious activity',
  'suspicious behaviour',
  'suspicious behavior',
  'loitering',
  'known to police',
  'known offender',
  'gang member',
  'gang activity',
  'out of place',
  'looked out of place',
  'high crime area',
  'acting nervous',
  'nervous',
  'no reason',
  'routine',
];

const normalise = (text: string): string =>
  text.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

const countWords = (text: string): number => normalise(text).split(' ').filter(Boolean).length;

/**
 * Whether a stated reason is only a label.
 *
 * True when the whole thing, with padding words removed, is one of the
 * conclusions above.
 */
const PADDING = /^(subject|male|female|party|individual|person|he|she|they|was|were|is|are|being|appeared|appearing|seemed|seeming|looked|looking|acting|just|very|really|possible|possibly)\s+/;

export function isConclusory(reason: string): boolean {
  /*
    Strip the padding repeatedly, not once. "Subject appeared nervous" is three
    words of scaffolding around one conclusion, and peeling only the first one
    leaves "appeared nervous", which matches nothing and lets the whole phrase
    through — which is precisely the phrase this is here to catch.
  */
  let clean = normalise(reason);
  let previous = '';
  while (clean !== previous) {
    previous = clean;
    clean = clean.replace(PADDING, '').trim();
  }
  return CONCLUSIONS.includes(clean);
}

export interface Check {
  ok: boolean;
  reason: string;
  field: string;
  /** Something worth saying that is not a refusal. */
  advice?: string;
}

const good: Check = { ok: true, reason: '', field: '' };

/** The minimum that counts as an account of what happened. */
export const MIN_REASON_WORDS = 6;

export function checkContact(contact: Partial<FieldContact>): Check {
  if (!contact.occurredAt) {
    return { ok: false, reason: 'When was it?', field: 'occurredAt' };
  }
  if (!contact.basis) {
    return {
      ok: false,
      reason: 'Was this a conversation they could walk away from, or a detention?',
      field: 'basis',
    };
  }
  if (!(contact.address ?? '').trim() && !contact.locationId) {
    return { ok: false, reason: 'Where were you?', field: 'address' };
  }
  if ((contact.subjects?.length ?? 0) === 0) {
    return { ok: false, reason: 'Who did you speak to?', field: 'subjects' };
  }

  /*
    The rule this module exists for. A detention is a seizure, and a seizure
    with no articulated basis is one the agency cannot defend — not in two
    years, and not tonight if somebody asks.
  */
  if (contact.basis === 'detention') {
    const reason = (contact.reason ?? '').trim();
    if (!reason) {
      return {
        ok: false,
        reason: 'A detention needs what you saw. This is the part that gets read out in court.',
        field: 'reason',
      };
    }
    if (isConclusory(reason)) {
      return {
        ok: false,
        reason: `“${reason}” is a conclusion, not something you saw. What was happening when you decided to stop them?`,
        field: 'reason',
      };
    }
    if (countWords(reason) < MIN_REASON_WORDS) {
      return {
        ok: false,
        reason: 'A sentence, not a label — what were they doing that made you stop them?',
        field: 'reason',
      };
    }
  }

  return good;
}

/**
 * Something worth saying that is not a refusal.
 *
 * Kept apart from `checkContact` because advice that blocks filing is advice
 * officers learn to route around, and a record that never gets written helps
 * nobody.
 */
export function adviseContact(contact: Partial<FieldContact>): string {
  if (contact.basis === 'consensual' && (contact.disposition === 'arrest' || contact.disposition === 'citation')) {
    return 'A consensual conversation that ended in an arrest or a citation was probably a detention by the end. Worth a second look at the basis.';
  }
  if (
    contact.basis === 'detention' &&
    contact.subjects?.some((subject) => subject.declinedToIdentify)
  ) {
    return 'Declining to give a name is lawful in most places and is not itself grounds for anything. Make sure the reason above stands on its own.';
  }
  if (contact.basis === 'community' && (contact.reason ?? '').trim()) {
    return 'Nobody is suspected of anything on a community contact, so this does not need a reason. It will be kept as written.';
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* How long it is kept                                                 */
/* ------------------------------------------------------------------ */

/**
 * A default, and a short one.
 *
 * Overridden by the agency's retention schedule like everything else. The
 * number matters less than that there is one: a record of somebody who did
 * nothing should not outlive the reason for making it.
 */
export const DEFAULT_RETENTION_YEARS = 2;

/** When this contact is due to go, given the agency's schedule. */
export function disposalDue(
  contact: Pick<FieldContact, 'occurredAt'>,
  years: number = DEFAULT_RETENTION_YEARS,
): string {
  const from = new Date(contact.occurredAt);
  if (Number.isNaN(from.getTime())) return '';
  const due = new Date(from);
  due.setUTCFullYear(due.getUTCFullYear() + years);
  return due.toISOString().slice(0, 10);
}

/** One line saying how long this is kept, in words rather than a date alone. */
export function retentionLine(
  contact: Pick<FieldContact, 'occurredAt'>,
  years: number = DEFAULT_RETENTION_YEARS,
): string {
  const due = disposalDue(contact, years);
  if (!due) return '';
  return `Kept until ${due}, then it comes up for disposal like any other record.`;
}

/* ------------------------------------------------------------------ */
/* Reading them back                                                   */
/* ------------------------------------------------------------------ */

/** Who this contact was with, for a one-line summary. */
export function subjectLine(contact: FieldContact, nameFor: (id: string) => string): string {
  const names = contact.subjects.map((subject) => {
    if (subject.masterId) return nameFor(subject.masterId) || 'Somebody on file';
    if (subject.givenName) return `${subject.givenName} (not on file)`;
    return subject.declinedToIdentify ? 'Declined to identify' : 'Unidentified';
  });
  if (names.length === 0) return 'Nobody recorded';
  if (names.length <= 2) return names.join(' and ');
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** Newest first. A field contact is worth reading in the order it happened. */
export function sortContacts(list: FieldContact[]): FieldContact[] {
  return [...list].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

/**
 * Said on every list of somebody's contacts.
 *
 * A list of times a person was spoken to reads, to anybody who did not write
 * them, like a record of wrongdoing. It is not one, and the screen should not
 * make the reader work that out for themselves.
 */
export const NOT_EVIDENCE =
  'Being spoken to is not an offence and these are not a record of one. Most people here have never been charged with anything.';
