/**
 * The board: BOLOs and bulletins.
 *
 * Every agency has one, and in most of them it is a corkboard by the door, a
 * group text, and whatever the last sergeant remembered to say out loud. The
 * failure is always the same shape — the officer who needed the information
 * was on days off when it was posted, or was on the road when the text went
 * round, and nobody can tell afterwards whether they ever saw it.
 *
 * So it is one board, everybody can put something on it, and what is on it is
 * worked out rather than curated.
 *
 * **Anybody may post.** The officer who just watched a silver pickup leave a
 * burglary is the person with the information, and a board that requires them
 * to find a supervisor first is a board that gets the description an hour late
 * and second hand. This is the same line the location notes draw: adding what
 * you know is open to everyone.
 *
 * **Taking one down is not.** Removal sits with administrators and dispatch,
 * because a BOLO somebody found inconvenient and quietly deleted is exactly
 * the failure the notes rule exists to prevent. And removal here means
 * withdrawn, not destroyed: the entry stops showing on the board, keeps who
 * took it down and why, and can still be read by the people allowed to see
 * withdrawn material. The one time anybody asks about a deleted BOLO is after
 * something went wrong, and that is precisely when "it is gone" is the wrong
 * answer.
 *
 * **Clearing is different from removing.** A BOLO ends because the car was
 * found, and saying so is not an administrative act — it is the outcome, and
 * the officer who found it is the person who knows. So the poster and the
 * finder can clear one, with a reason, and it stays legible as a thing that
 * happened rather than vanishing.
 *
 * **Nothing lives forever by accident.** Every board in every agency rots the
 * same way: it fills with BOLOs from eighteen months ago, officers learn that
 * most of it is stale, and then they stop reading the part that is not. A
 * lookout therefore has to say when it stops — the state is derived from that
 * date on every read, never written by a job that might not run — and an
 * indefinite standing warning has to be reviewed rather than simply outliving
 * everyone who remembers posting it.
 */

import type { UUID } from './person';

/* ------------------------------------------------------------------ */
/* What kind of thing is on the board                                  */
/* ------------------------------------------------------------------ */

export type BulletinKind = 'bolo' | 'attemptToLocate' | 'officerSafety' | 'information';

export const KIND_LABEL: Record<BulletinKind, string> = {
  bolo: 'BOLO',
  attemptToLocate: 'Attempt to locate',
  officerSafety: 'Officer safety',
  information: 'Information',
};

export const KIND_DESCRIPTION: Record<BulletinKind, string> = {
  bolo: 'Look out for a person, a vehicle or property connected to something that has happened.',
  attemptToLocate:
    'Somebody who needs to be found — a missing person, or someone a case needs to speak to.',
  officerSafety:
    'A warning about a person, an address or a situation that the next officer to attend should know.',
  information:
    'Everything else the shift needs to know: road closures, a detail assignment, a change to a procedure.',
};

/**
 * The kinds that go stale, and therefore must say when they stop.
 *
 * A lookout is about a moment — a car seen leaving somewhere an hour ago is
 * not a car anybody should still be stopping in March. A standing safety
 * warning about an address is the opposite: it is true until somebody says it
 * is not, and forcing a date onto it would mean it silently stops warning
 * people while the reason it was posted is still there.
 */
export const MUST_EXPIRE: BulletinKind[] = ['bolo', 'attemptToLocate'];

export const needsExpiry = (kind: BulletinKind): boolean => MUST_EXPIRE.includes(kind);

/** What to offer as an expiry when one of these is being written, in days. */
export const DEFAULT_DAYS: Record<BulletinKind, number> = {
  bolo: 7,
  attemptToLocate: 30,
  officerSafety: 0,
  information: 14,
};

/**
 * How long an indefinite entry may stand before somebody is asked whether it
 * is still true.
 *
 * Not an expiry. Nothing is taken down at ninety days — the warning about the
 * address with the dog is still the warning about the address with the dog.
 * It is a prompt, so that a board of standing warnings is a board somebody has
 * confirmed rather than a board nobody has touched.
 */
export const REVIEW_DAYS = 90;

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

/** Where an entry came from. Dispatch software posts here too. */
export type BulletinSource = 'officer' | 'dispatch' | 'external';

export const SOURCE_LABEL: Record<BulletinSource, string> = {
  officer: 'Posted by an officer',
  dispatch: 'Posted by dispatch',
  external: 'Received from another agency',
};

/** Closed off because it is over. */
export interface Cleared {
  at: string;
  byId: UUID | '';
  byName: string;
  /** Found, arrested, returned home, called off by the originating agency. */
  reason: string;
}

/** Taken off the board by somebody with the authority to. */
export interface Removed {
  at: string;
  byId: UUID | '';
  byName: string;
  reason: string;
}

export interface Bulletin {
  id: UUID;
  kind: BulletinKind;

  /** One line, read out at briefing. */
  headline: string;
  /** The rest of it. */
  detail: string;

  /**
   * What to look for, in words.
   *
   * Free text rather than a structured description, because the officer typing
   * this is repeating what a witness just told them and the witness did not
   * speak in fields. Where the person or vehicle is already known to the
   * agency, the links below carry the structure.
   */
  lookFor: string;

  /** Into the master indexes, when the subject is somebody already on file. */
  personId: UUID | '';
  vehicleId: UUID | '';

  /** The report this came out of, when there was one. */
  caseNumber: string;

  /** Where it happened, or where to look. */
  area: string;

  /** Who to call. An entry nobody can respond to is a notice, not a lookout. */
  contact: string;

  postedById: UUID | '';
  postedByName: string;
  postedAt: string;
  source: BulletinSource;
  /** The agency that originated it, when it came from outside. */
  originatingAgency: string;

  /**
   * When it stops. Empty means indefinite, which is a fact about the entry
   * rather than something a reader infers from a date in the year 9999.
   */
  expiresAt: string;

  cleared: Cleared | null;
  removed: Removed | null;
}

export function createBulletin(partial: Partial<Bulletin> & { id: UUID }): Bulletin {
  return {
    kind: 'bolo',
    headline: '',
    detail: '',
    lookFor: '',
    personId: '',
    vehicleId: '',
    caseNumber: '',
    area: '',
    contact: '',
    postedById: '',
    postedByName: '',
    postedAt: new Date().toISOString(),
    source: 'officer',
    originatingAgency: '',
    expiresAt: '',
    cleared: null,
    removed: null,
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* State, worked out rather than stored                                */
/* ------------------------------------------------------------------ */

export type BulletinState = 'live' | 'cleared' | 'expired' | 'removed';

export const STATE_LABEL: Record<BulletinState, string> = {
  live: 'Live',
  cleared: 'Cleared',
  expired: 'Expired',
  removed: 'Withdrawn',
};

/**
 * What this entry is, right now.
 *
 * Derived on every read, from the same three facts, in the same order,
 * everywhere. Nothing writes a status column and nothing runs on a timer: a
 * job that expires rows is a job that can fail silently, run twice, or run
 * against a wrong clock, and the failure mode is an officer stopping a car on
 * a lookout that ended last week.
 *
 * The order matters. Withdrawn beats everything, because somebody with the
 * authority decided it should not be on the board at all. Cleared beats
 * expired, because "we found the car" is what happened and "the week ran out"
 * is merely when — an entry that was resolved should read as resolved even if
 * nobody got round to it until after the date.
 */
export function state(bulletin: Bulletin, now: Date = new Date()): BulletinState {
  if (bulletin.removed) return 'removed';
  if (bulletin.cleared) return 'cleared';
  if (bulletin.expiresAt && new Date(bulletin.expiresAt).getTime() <= now.getTime()) return 'expired';
  return 'live';
}

export const isLive = (bulletin: Bulletin, now: Date = new Date()): boolean =>
  state(bulletin, now) === 'live';

/**
 * A live entry standing on an indefinite basis for longer than anybody has
 * checked. Prompts a question; takes nothing down.
 */
export function needsReview(bulletin: Bulletin, now: Date = new Date()): boolean {
  if (!isLive(bulletin, now) || bulletin.expiresAt) return false;
  const posted = new Date(bulletin.postedAt).getTime();
  if (Number.isNaN(posted)) return false;
  return now.getTime() - posted >= REVIEW_DAYS * 86_400_000;
}

/** Days until it stops, or null when it never does. Negative once past. */
export function daysLeft(bulletin: Bulletin, now: Date = new Date()): number | null {
  if (!bulletin.expiresAt) return null;
  const until = new Date(bulletin.expiresAt).getTime();
  if (Number.isNaN(until)) return null;
  return Math.ceil((until - now.getTime()) / 86_400_000);
}

/* ------------------------------------------------------------------ */
/* Ordering                                                            */
/* ------------------------------------------------------------------ */

/**
 * The order a shift reads them in.
 *
 * Officer safety first, always, regardless of age — the point of that kind is
 * that somebody is about to walk into something, and a warning sorted below a
 * fortnight of road closures has failed at the only job it had. Everything
 * else is newest first, because a board is read from the top by somebody who
 * saw yesterday's already.
 */
const KIND_RANK: Record<BulletinKind, number> = {
  officerSafety: 0,
  bolo: 1,
  attemptToLocate: 2,
  information: 3,
};

export function forBriefing(bulletins: Bulletin[], now: Date = new Date()): Bulletin[] {
  return bulletins
    .filter((b) => isLive(b, now))
    .sort((a, b) => {
      const byKind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
      if (byKind !== 0) return byKind;
      return b.postedAt.localeCompare(a.postedAt);
    });
}

/* ------------------------------------------------------------------ */
/* What has to be filled in                                            */
/* ------------------------------------------------------------------ */

export interface BulletinProblem {
  field: string;
  message: string;
  tip?: string;
  severity: 'error' | 'warning';
}

/**
 * Checked the way a report is checked: what blocks, and what is merely worth a
 * look, kept apart.
 *
 * The one thing that blocks beyond a headline is an expiry on the kinds that
 * go stale. It is the difference between a board people read and a board
 * people have learned to ignore, and it cannot be added later by somebody
 * else, because by then nobody knows how long the lookout was meant to last.
 */
export function check(bulletin: Bulletin): BulletinProblem[] {
  const problems: BulletinProblem[] = [];

  if (!bulletin.headline.trim()) {
    problems.push({
      field: 'headline',
      message: 'Say in one line what this is.',
      tip: 'This is the line read out at briefing — "Silver pickup, burglary on Third Street".',
      severity: 'error',
    });
  }

  if (needsExpiry(bulletin.kind) && !bulletin.expiresAt) {
    problems.push({
      field: 'expiresAt',
      message: `Say when this ${KIND_LABEL[bulletin.kind]} stops.`,
      tip: 'A lookout with no end date is still on the board next year, which is how boards stop being read. Extend it if it is still current.',
      severity: 'error',
    });
  }

  if (!bulletin.detail.trim() && !bulletin.lookFor.trim()) {
    problems.push({
      field: 'lookFor',
      message: 'Nothing here says what to look for.',
      tip: 'A description, a plate, a direction of travel — anything the next officer could act on.',
      severity: 'warning',
    });
  }

  if (!bulletin.contact.trim()) {
    problems.push({
      field: 'contact',
      message: 'Nobody is named to call.',
      tip: 'An officer who finds the car at 3am needs somebody to ring. A unit number or a desk extension is enough.',
      severity: 'warning',
    });
  }

  return problems;
}

export const blocking = (bulletin: Bulletin): BulletinProblem[] =>
  check(bulletin).filter((p) => p.severity === 'error');

export const canPost = (bulletin: Bulletin): boolean => blocking(bulletin).length === 0;
