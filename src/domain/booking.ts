/**
 * Booking — what happens to a person after the arrest.
 *
 * The arrest record already carried a booking number and a timestamp, typed
 * onto the arresting officer's own form. That is a note about a booking, not a
 * booking, and it misses the three things that actually matter once somebody
 * is in a cell.
 *
 * **Where their things went.** Somebody arrested at two in the morning hands
 * over a wallet, a phone, a wedding ring and £340 in notes, and gets them back
 * from a different officer two days later. Every jail that has been sued over
 * property was sued because that handover was a line in a logbook. Here it is
 * an itemised list, each line with where it is and what became of it, and a
 * release cannot be recorded while a line is neither returned nor accounted
 * for. Not a warning — a refusal.
 *
 * **What could kill them.** A diabetic, somebody coming off alcohol, somebody
 * who said something on the way in, two co-defendants who must not share a
 * cell. This is the part of booking that is about whether a person is alive in
 * the morning, so a concern is raised by anybody who sees it, is never
 * deleted, and is cleared only by somebody who may — with their name on the
 * clearing.
 *
 * **Whether they are still here.** Nowhere in this file is a field saying
 * somebody is in custody. It is derived from the booking and release times
 * every time it is read, because a stored flag is a flag that goes wrong: a
 * release recorded with the checkbox missed leaves a person on the roster who
 * went home yesterday, and the roster is what the next shift briefs from.
 */

import type { UUID } from './person';

/* ------------------------------------------------------------------ */
/* Property taken at intake                                            */
/* ------------------------------------------------------------------ */

/**
 * What kind of thing it is.
 *
 * Money is its own category because money is counted rather than described,
 * and because a disagreement about cash is the disagreement that happens.
 */
export type ItemKind = 'money' | 'valuables' | 'clothing' | 'electronics' | 'documents' | 'medication' | 'other';

export const ITEM_KIND_LABEL: Record<ItemKind, string> = {
  money: 'Money',
  valuables: 'Jewellery and valuables',
  clothing: 'Clothing',
  electronics: 'Phone and electronics',
  documents: 'Documents and cards',
  medication: 'Medication',
  other: 'Other',
};

/**
 * What became of an item.
 *
 * `held` is the only one that is not an ending, and a release cannot be
 * recorded while anything is still on it.
 */
export type ItemOutcome = '' | 'returned' | 'toEvidence' | 'contraband' | 'releasedToOther' | 'destroyed';

export const ITEM_OUTCOME_LABEL: Record<ItemOutcome, string> = {
  '': 'Still held',
  returned: 'Returned to them',
  toEvidence: 'Taken into evidence',
  contraband: 'Seized as contraband',
  releasedToOther: 'Released to somebody else',
  destroyed: 'Destroyed',
};

/** Outcomes that mean nothing more is owed on this line. */
export const SETTLED: ItemOutcome[] = ['returned', 'toEvidence', 'contraband', 'releasedToOther', 'destroyed'];

export interface HeldItem {
  id: UUID;
  kind: ItemKind;
  description: string;
  /** Blank reads as one. Free text because "a handful of keys" is honest. */
  quantity: string;
  /**
   * Counted, in whole units of currency.
   *
   * Only meaningful for money, and money is the line that gets argued about,
   * so it is a number rather than part of the description.
   */
  amount: string;
  /** The bag, envelope or locker it went into. */
  storedAt: string;

  outcome: ItemOutcome;
  outcomeAt: string;
  /** Who it went to, when that is not the person it came from. */
  releasedTo: string;
  /**
   * Where it went, for anything that left the property bag.
   *
   * An evidence tag number, a destruction order — something a person can
   * follow. An item that left with no reference is an item that vanished.
   */
  reference: string;
  note: string;
}

export function createItem(partial: Partial<HeldItem> = {}): HeldItem {
  return {
    id: '',
    kind: 'other',
    description: '',
    quantity: '',
    amount: '',
    storedAt: '',
    outcome: '',
    outcomeAt: '',
    releasedTo: '',
    reference: '',
    note: '',
    ...partial,
  };
}

/** Whether this line still owes an answer. */
export const stillHeld = (item: HeldItem): boolean => !SETTLED.includes(item.outcome);

/**
 * Items that left the bag but cannot be traced.
 *
 * "Taken into evidence" with no tag number is the same as gone, and it is the
 * shape a property claim takes six months later. Returning to the person needs
 * no reference — they signed for it.
 */
export function untraceable(items: HeldItem[]): HeldItem[] {
  const needsReference: ItemOutcome[] = ['toEvidence', 'contraband', 'destroyed'];
  return items.filter((item) => needsReference.includes(item.outcome) && !item.reference.trim());
}

/** What the money adds up to, for the lines still held. */
export function moneyHeld(items: HeldItem[]): number {
  return items
    .filter((item) => item.kind === 'money' && stillHeld(item))
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
}

/* ------------------------------------------------------------------ */
/* Concerns                                                            */
/* ------------------------------------------------------------------ */

/**
 * Something the next shift has to know.
 *
 * Deliberately a small closed list. A free-text "notes" box on a booking is
 * where a suicide risk goes to be scrolled past; a kind on the front of the
 * line is what makes it visible on a roster at a glance.
 */
export type ConcernKind =
  | 'medical'
  | 'medication'
  | 'mentalHealth'
  | 'suicideRisk'
  | 'withdrawal'
  | 'keepSeparate'
  | 'mobility'
  | 'communication'
  | 'other';

export const CONCERN_LABEL: Record<ConcernKind, string> = {
  medical: 'Medical condition',
  medication: 'Needs medication',
  mentalHealth: 'Mental health',
  suicideRisk: 'Risk of self-harm',
  withdrawal: 'Withdrawal',
  keepSeparate: 'Keep separate',
  mobility: 'Mobility',
  communication: 'Language or communication',
  other: 'Other',
};

/**
 * Concerns that mean somebody has to physically do something differently.
 *
 * These sort to the top of every list and print on the front of the sheet.
 * The rest are context; these are instructions.
 */
export const URGENT: ConcernKind[] = ['suicideRisk', 'medical', 'medication', 'withdrawal', 'keepSeparate'];

export const isUrgent = (concern: Concern): boolean => URGENT.includes(concern.kind) && !concern.clearedAt;

export interface Concern {
  id: UUID;
  kind: ConcernKind;
  detail: string;
  /** Who they must not be housed with. Free text — often not in the index. */
  keepSeparateFrom: string;

  raisedAt: string;
  raisedByName: string;

  /**
   * Cleared, not deleted.
   *
   * The same rule the location notes follow, for a stronger reason: the
   * question after somebody is hurt in a cell is "who knew, and when did it
   * stop being acted on". A concern that can be deleted cannot answer it.
   */
  clearedAt: string;
  clearedByName: string;
  clearedReason: string;
}

export function createConcern(partial: Partial<Concern> = {}): Concern {
  return {
    id: '',
    kind: 'other',
    detail: '',
    keepSeparateFrom: '',
    raisedAt: '',
    raisedByName: '',
    clearedAt: '',
    clearedByName: '',
    clearedReason: '',
    ...partial,
  };
}

export const CLEARING_NEEDS_A_REASON =
  'Say why this no longer applies. Somebody raised it because they saw something, and the record has to show why it stopped being acted on.';

/** Live concerns first, urgent ones above the rest, newest first within that. */
export function sortConcerns(concerns: Concern[]): Concern[] {
  return [...concerns].sort((a, b) => {
    const live = Number(Boolean(a.clearedAt)) - Number(Boolean(b.clearedAt));
    if (live !== 0) return live;
    const urgent = Number(isUrgent(b)) - Number(isUrgent(a));
    if (urgent !== 0) return urgent;
    return b.raisedAt.localeCompare(a.raisedAt);
  });
}

/* ------------------------------------------------------------------ */
/* Release                                                             */
/* ------------------------------------------------------------------ */

/** On what authority the person walked out. */
export type ReleaseReason =
  | ''
  | 'bond'
  | 'ownRecognisance'
  | 'citation'
  | 'chargesDropped'
  | 'timeServed'
  | 'courtOrder'
  | 'transferred'
  | 'toHospital';

export const RELEASE_LABEL: Record<ReleaseReason, string> = {
  '': 'Not stated',
  bond: 'Bond posted',
  ownRecognisance: 'Released on their own recognisance',
  citation: 'Cited to appear',
  chargesDropped: 'Charges not filed',
  timeServed: 'Time served',
  courtOrder: 'Court order',
  transferred: 'Transferred to another agency',
  toHospital: 'Taken to hospital',
};

/** Reasons where the person went somewhere rather than out. */
export const HANDED_OVER: ReleaseReason[] = ['transferred', 'toHospital'];

export interface Release {
  at: string;
  reason: ReleaseReason;
  /** The agency or hospital, where they were handed over rather than freed. */
  to: string;
  releasedByName: string;
  note: string;
}

/* ------------------------------------------------------------------ */
/* The booking                                                         */
/* ------------------------------------------------------------------ */

export interface Booking {
  id: UUID;
  /** `2026-B00042` — its own series, like the arrest number. */
  bookingNumber: string;

  /** The arrest this came from. A booking without one is not a booking. */
  arrestId: UUID;
  arrestNumber: string;

  masterId: UUID;
  /** Denormalised so a roster reads without resolving every identity. */
  personName: string;

  bookedAt: string;
  bookedByName: string;
  facility: string;
  cell: string;

  searchedByName: string;
  photographed: boolean;
  fingerprinted: boolean;

  items: HeldItem[];
  /**
   * The person's own acknowledgement of the list.
   *
   * A name typed by the officer who took the property is not a signature and
   * this does not pretend otherwise — it records that the list was read back
   * and by whom it was witnessed, which is what a paper form does.
   */
  inventoryAcknowledged: boolean;
  inventoryWitnessName: string;

  concerns: Concern[];

  release: Release | null;

  createdBy: UUID;
  createdAt: string;
  updatedAt: string;
}

export function createBooking(partial: Partial<Booking> = {}): Booking {
  const at = partial.createdAt ?? new Date().toISOString();
  return {
    id: '',
    bookingNumber: '',
    arrestId: '',
    arrestNumber: '',
    masterId: '',
    personName: '',
    bookedAt: '',
    bookedByName: '',
    facility: '',
    cell: '',
    searchedByName: '',
    photographed: false,
    fingerprinted: false,
    items: [],
    inventoryAcknowledged: false,
    inventoryWitnessName: '',
    concerns: [],
    release: null,
    createdBy: '',
    createdAt: at,
    updatedAt: at,
    ...partial,
  };
}

/**
 * `2026-B00042`.
 *
 * Its own series with a `B`, for the same reason the arrest number has an `A`:
 * one arrest can be booked twice — released and brought back on a warrant the
 * same week — and a number borrowed from the arrest would collide the first
 * time that happened.
 */
export function nextBookingNumber(existing: string[], now = new Date()): string {
  const prefix = `${now.getFullYear()}-B`;
  const used = existing
    .filter((n) => n.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)))
    .filter((n) => Number.isFinite(n));
  const next = (used.length > 0 ? Math.max(...used) : 0) + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Custody, derived                                                    */
/* ------------------------------------------------------------------ */

export type Custody = 'pending' | 'held' | 'released';

/**
 * Whether this person is in the building, worked out rather than stored.
 *
 * No `inCustody` field exists anywhere, on purpose. A stored flag and a
 * release time disagree the first time somebody records one and not the other,
 * and the roster is what the oncoming shift briefs from — a person on it who
 * went home yesterday is worse than no roster.
 */
export function custody(booking: Booking): Custody {
  if (booking.release?.at) return 'released';
  if (booking.bookedAt) return 'held';
  return 'pending';
}

export const CUSTODY_LABEL: Record<Custody, string> = {
  pending: 'Not booked in yet',
  held: 'In custody',
  released: 'Released',
};

/** Hours held, or hours so far. Null when the booking has not started. */
export function hoursHeld(booking: Booking, now = new Date()): number | null {
  if (!booking.bookedAt) return null;
  const from = new Date(booking.bookedAt).getTime();
  if (Number.isNaN(from)) return null;
  const to = booking.release?.at ? new Date(booking.release.at).getTime() : now.getTime();
  if (Number.isNaN(to) || to < from) return null;
  return (to - from) / 3_600_000;
}

/**
 * How long somebody may be held before a magistrate has to see them.
 *
 * Forty-eight hours is the federal floor from *County of Riverside v.
 * McLaughlin*; a good many states are stricter, and none is more generous. It
 * is a prompt on a roster rather than a legal opinion — the screen says a clock
 * is running, and the agency's own counsel says what their number is.
 */
export const REVIEW_HOURS = 48;

export const REVIEW_NOTE =
  'A first appearance is generally owed within 48 hours of arrest. Some states allow less. Check what this agency’s counsel says the number is — this is a reminder that a clock is running, not advice about it.';

/** Somebody held long enough that the clock is worth showing. */
export function pastReview(booking: Booking, now = new Date()): boolean {
  if (custody(booking) !== 'held') return false;
  const held = hoursHeld(booking, now);
  return held !== null && held >= REVIEW_HOURS;
}

/* ------------------------------------------------------------------ */
/* What stops a release                                                */
/* ------------------------------------------------------------------ */

export interface ReleaseBlocker {
  field: string;
  reason: string;
  tip: string;
}

/**
 * Why this person cannot be released yet.
 *
 * The property rule with teeth. Everything else on this screen can be filled
 * in later, but property that is neither handed back nor accounted for is the
 * one thing that becomes unrecoverable the moment somebody walks out of the
 * door — and it is always discovered weeks afterwards, by a solicitor.
 *
 * Not a warning that can be clicked through. A release with an open property
 * line is a release that has not finished happening.
 */
export function releaseBlockers(booking: Booking): ReleaseBlocker[] {
  const blockers: ReleaseBlocker[] = [];

  if (custody(booking) === 'pending') {
    blockers.push({
      field: 'bookedAt',
      reason: 'This booking has not been started.',
      tip: 'Record when they were booked in before recording that they went out.',
    });
  }

  const open = booking.items.filter(stillHeld);
  if (open.length > 0) {
    blockers.push({
      field: 'items',
      reason: `${open.length} ${open.length === 1 ? 'item is' : 'items are'} still in the property bag.`,
      tip: 'Hand each one back, or say where it went — evidence, contraband, or released to somebody else. Property nobody accounted for is what a claim is made about later.',
    });
  }

  const lost = untraceable(booking.items);
  if (lost.length > 0) {
    blockers.push({
      field: 'items',
      reason:
        lost.length === 1
          ? 'One item left the property bag with nothing to trace it by.'
          : `${lost.length} items left the property bag with nothing to trace them by.`,
      tip: 'An evidence tag or an order number. "Taken into evidence" with no reference reads the same as missing when somebody asks in six months.',
    });
  }

  return blockers;
}

export const canRelease = (booking: Booking): boolean => releaseBlockers(booking).length === 0;

/* ------------------------------------------------------------------ */
/* The roster                                                          */
/* ------------------------------------------------------------------ */

export interface RosterRow {
  booking: Booking;
  custody: Custody;
  hours: number | null;
  concerns: Concern[];
  pastReview: boolean;
}

/**
 * Who is in the building, and what has to be known about them.
 *
 * Longest-held first. The person who has been in a cell nineteen hours is the
 * one a shift briefing is about, and putting the newest arrival at the top —
 * which is what sorting by booking time does — buries them.
 */
export function roster(bookings: Booking[], now = new Date()): RosterRow[] {
  return bookings
    .filter((booking) => custody(booking) === 'held')
    .map((booking) => ({
      booking,
      custody: custody(booking),
      hours: hoursHeld(booking, now),
      concerns: sortConcerns(booking.concerns).filter((concern) => !concern.clearedAt),
      pastReview: pastReview(booking, now),
    }))
    .sort((a, b) => (b.hours ?? 0) - (a.hours ?? 0));
}

/**
 * People in the building who must not be put together.
 *
 * Read off the live keep-separate concerns rather than stored as a pairing,
 * because the pairing only matters while both are here — and a stored one
 * would still be warning about somebody who left on Tuesday.
 */
export function keepApart(rows: RosterRow[]): { row: RosterRow; from: string }[] {
  const pairs: { row: RosterRow; from: string }[] = [];
  for (const row of rows) {
    for (const concern of row.concerns) {
      if (concern.kind !== 'keepSeparate') continue;
      const from = concern.keepSeparateFrom.trim() || concern.detail.trim();
      if (from) pairs.push({ row, from });
    }
  }
  return pairs;
}
