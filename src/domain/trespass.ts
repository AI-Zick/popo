/**
 * Trespass notices.
 *
 * A property owner tells the police they have withdrawn permission for
 * somebody to be on their land. From then on that person being there is an
 * offence, and the whole value of writing it down is that the officer who
 * turns up eight months later — who was not there, and has never met either of
 * them — can find out in seconds whether this person has been warned off this
 * place.
 *
 * So it is stored once, against the person and the place, and read from both
 * ends: a person's record says where they are barred from, and a place's record
 * lists everybody barred from it.
 *
 * Two decisions worth reading.
 *
 * **Expiry is worked out, never done.** Nothing runs on a timer and nothing is
 * deleted on a date. A notice with an expiry stops counting as being in force
 * the moment that date passes, on every read, everywhere — the same way this
 * system already treats every other derived state. A background job that
 * deletes rows is a job that can fail silently, run twice, or run while the
 * clock is wrong, and the failure mode is an officer being told somebody is
 * barred when they are not.
 *
 * **An expired notice is kept.** This is the part that matters legally. If
 * somebody is arrested for trespassing on the last day a notice was in force,
 * that case is prosecuted months after it expired, and the notice is the
 * evidence that they had been warned. Destroying it on the expiry date
 * destroys the proof of the offence. So expiry moves a notice out of the way;
 * it never removes it. Genuine destruction happens the way it does everywhere
 * else in this system — under a retention schedule or a court order.
 */

import type { UUID } from './person';

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

/** Where the notice came from. */
export type TrespassSource = 'officer' | 'dispatch' | 'import';

export const SOURCE_LABEL: Record<TrespassSource, string> = {
  officer: 'Served by an officer',
  dispatch: 'Taken by dispatch',
  import: 'Migrated from the previous system',
};

export interface Trespass {
  id: UUID;

  /** Points into the Master Name Index. */
  personId: UUID;
  /** Points into the location index. */
  locationId: UUID;

  /** The day it was served. */
  servedOn: string;
  /**
   * The last day it is in force.
   *
   * Empty means indefinite, which is what a property owner usually asks for
   * and what most notices are. It is stored as absence rather than as a far
   * future date so that "indefinite" is a fact about the notice rather than
   * something a reader has to infer from the year 9999.
   */
  expiresOn: string;

  /** The person at the property who asked for it — a manager, an owner. */
  requestedBy: string;
  /** How to reach them, because the officer at 2am will need to. */
  requestedByPhone: string;

  /** Who recorded it here. */
  issuedById: UUID | '';
  issuedByName: string;
  source: TrespassSource;

  /** The report this came out of, when there was one. */
  caseNumber: string;

  notes: string;

  /**
   * Lifted early.
   *
   * Withdrawal rather than deletion, for the same reason a location note is
   * withdrawn rather than deleted: a notice that was in force and then was not
   * is a sequence of facts, and "who lifted it, and when" is asked after
   * somebody is arrested on a notice that had already been withdrawn.
   */
  liftedAt: string;
  liftedBy: string;
  liftReason: string;

  createdAt: string;
  updatedAt: string;
}

export function createTrespass(partial: Partial<Trespass> = {}): Trespass {
  const now = new Date().toISOString();
  return {
    id: '',
    personId: '',
    locationId: '',
    servedOn: '',
    expiresOn: '',
    requestedBy: '',
    requestedByPhone: '',
    issuedById: '',
    issuedByName: '',
    source: 'officer',
    caseNumber: '',
    notes: '',
    liftedAt: '',
    liftedBy: '',
    liftReason: '',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* What state it is in                                                 */
/* ------------------------------------------------------------------ */

export type TrespassState = 'active' | 'expired' | 'lifted';

export const STATE_LABEL: Record<TrespassState, string> = {
  active: 'In force',
  expired: 'Expired',
  lifted: 'Lifted',
};

export const isIndefinite = (trespass: Pick<Trespass, 'expiresOn'>): boolean =>
  !trespass.expiresOn.trim();

/** Today, as the plain date the notices are written in. */
export const today = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/**
 * Whether a notice is in force, worked out rather than stored.
 *
 * Lifting beats expiry: a notice that was withdrawn and would also have run
 * out reads as lifted, because that is the fact somebody acted on.
 */
export function trespassState(
  trespass: Pick<Trespass, 'expiresOn' | 'liftedAt'>,
  on: string = today(),
): TrespassState {
  if (trespass.liftedAt) return 'lifted';
  if (isIndefinite(trespass)) return 'active';
  // The expiry date is the last day it is in force, not the first day it is
  // not. An officer told "expires the 14th" expects it to hold on the 14th.
  return trespass.expiresOn >= on ? 'active' : 'expired';
}

export const isActive = (
  trespass: Pick<Trespass, 'expiresOn' | 'liftedAt'>,
  on: string = today(),
): boolean => trespassState(trespass, on) === 'active';

/**
 * Days left, or null when there is no date to count to.
 *
 * Negative once it has passed, so a caller can tell "ran out yesterday" from
 * "ran out in 2019" without doing the arithmetic again.
 */
export function daysRemaining(
  trespass: Pick<Trespass, 'expiresOn'>,
  on: string = today(),
): number | null {
  if (isIndefinite(trespass)) return null;
  const end = Date.parse(`${trespass.expiresOn}T00:00:00Z`);
  const from = Date.parse(`${on}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(from)) return null;
  return Math.round((end - from) / 86_400_000);
}

/** How long before a notice runs out is worth warning somebody about. */
export const EXPIRING_SOON_DAYS = 30;

/**
 * One line saying where this notice stands, or '' when there is nothing worth
 * saying. Written to be read at a doorstep, so it says the date rather than
 * making somebody count days.
 */
export function trespassStanding(trespass: Trespass, on: string = today()): string {
  const state = trespassState(trespass, on);
  if (state === 'lifted') {
    return `Lifted ${trespass.liftedAt.slice(0, 10)}${trespass.liftedBy ? ` by ${trespass.liftedBy}` : ''}.`;
  }
  if (state === 'expired') return `Ran out ${trespass.expiresOn}. Not in force.`;
  if (isIndefinite(trespass)) return 'In force, with no end date.';

  const left = daysRemaining(trespass, on);
  if (left !== null && left <= EXPIRING_SOON_DAYS) {
    return left === 0
      ? `In force. Today is the last day.`
      : `In force until ${trespass.expiresOn} — ${left} day${left === 1 ? '' : 's'} left.`;
  }
  return `In force until ${trespass.expiresOn}.`;
}

/* ------------------------------------------------------------------ */
/* Writing one down                                                    */
/* ------------------------------------------------------------------ */

export interface Check {
  ok: boolean;
  reason: string;
  /** Which field to put the officer's cursor in. */
  field: string;
}

const good: Check = { ok: true, reason: '', field: '' };

const isDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Whether a notice can be recorded as written.
 *
 * Deliberately short. The people entering these are dispatchers taking a call
 * from a shop manager, and a form that argues about optional fields is a form
 * that gets abandoned halfway with the notice unrecorded.
 */
export function checkTrespass(trespass: Partial<Trespass>): Check {
  if (!trespass.personId) {
    return { ok: false, reason: 'Say who the notice is against.', field: 'personId' };
  }
  if (!trespass.locationId) {
    return { ok: false, reason: 'Say which place they are barred from.', field: 'locationId' };
  }
  if (!trespass.servedOn || !isDate(trespass.servedOn)) {
    return { ok: false, reason: 'When was it served?', field: 'servedOn' };
  }

  const expires = (trespass.expiresOn ?? '').trim();
  if (expires) {
    if (!isDate(expires)) {
      return {
        ok: false,
        reason: 'An end date needs to be a real date, or leave it blank for no end date.',
        field: 'expiresOn',
      };
    }
    if (expires < trespass.servedOn) {
      return {
        ok: false,
        reason: 'That end date is before the day it was served, so it would never be in force.',
        field: 'expiresOn',
      };
    }
  }

  /*
    Who asked for it is the one thing worth insisting on. A trespass notice is
    somebody else's decision that the police are recording, and a notice with
    nobody's name against it cannot be checked, renewed or defended later.
  */
  if (!(trespass.requestedBy ?? '').trim()) {
    return {
      ok: false,
      reason: 'Who asked for it? A notice nobody is named on cannot be checked later.',
      field: 'requestedBy',
    };
  }

  return good;
}

/** Lifting one early takes a reason, because it is undoing somebody's decision. */
export function checkLift(reason: string): Check {
  return reason.trim().length >= 3
    ? good
    : { ok: false, reason: 'Say why it is being lifted.', field: 'liftReason' };
}

/**
 * Whether this person is already barred from this place.
 *
 * Not an error — a notice served twice is a renewal, and refusing it would
 * send the dispatcher looking for the old one. It is a thing to say on screen
 * so the person entering it knows they are renewing rather than duplicating.
 */
export function existingFor(
  list: Trespass[],
  personId: string,
  locationId: string,
  on: string = today(),
): Trespass | null {
  return (
    list.find(
      (item) =>
        item.personId === personId && item.locationId === locationId && isActive(item, on),
    ) ?? null
  );
}

/* ------------------------------------------------------------------ */
/* Ordering                                                            */
/* ------------------------------------------------------------------ */

export type TrespassSort = 'name' | 'served' | 'expires';
export type SortDirection = 'asc' | 'desc';

/**
 * Ordering for a person's own list.
 *
 * In force first, then by how soon they run out — an officer reading somebody's
 * record wants the ones that bite today, and an indefinite one sorts last
 * within that group because it is the one that will still be there tomorrow.
 */
export function sortForPerson(list: Trespass[], on: string = today()): Trespass[] {
  const rank: Record<TrespassState, number> = { active: 0, expired: 1, lifted: 2 };
  return [...list].sort((a, b) => {
    const byState = rank[trespassState(a, on)] - rank[trespassState(b, on)];
    if (byState !== 0) return byState;

    const left = daysRemaining(a, on);
    const right = daysRemaining(b, on);
    if (left !== right) {
      if (left === null) return 1;
      if (right === null) return -1;
      return left - right;
    }
    return b.servedOn.localeCompare(a.servedOn);
  });
}
