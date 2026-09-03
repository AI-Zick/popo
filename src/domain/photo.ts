/**
 * Photographs of a person.
 *
 * A photograph is not a fact about somebody, it is a fact about how they
 * looked *on a date* — exactly like an address or a phone number, and it rots
 * the same way. An officer shown a picture with no date has no way to tell
 * whether they are looking at the person who answered the door last week or a
 * booking photo from a decade and forty pounds ago, and "the man in the
 * picture is not the man I stopped" is a complaint that ends careers.
 *
 * So a photograph carries its age wherever it is shown, on the same machinery
 * the contact details use — with thresholds set for a face rather than a phone
 * number, because people change more slowly than their addresses do.
 *
 * Anyone may add one. Nobody deletes one: a wrong photograph is *asked* to be
 * taken down, and somebody with the authority decides. That is the same rule
 * location notes follow, for the same reason — the wrong picture on a record
 * is a serious thing, and so is a picture quietly disappearing from one.
 */

import type { UUID } from './types';
import type { FieldSource } from './person';
import { freshness, type Freshness } from './freshness';

/**
 * How long a photograph stays a fair likeness.
 *
 * Much longer than a phone number. A face at eighteen months is still the
 * face; an address at eighteen months is a coin toss. Past five years it is
 * worth saying out loud, because a decade-old booking photo shown to a patrol
 * officer looking for somebody is worse than no photograph at all.
 */
export const PHOTO_FRESHNESS_DAYS = {
  current: 2 * 365,
  aging: 5 * 365,
  stale: 10 * 365,
} as const;

export type PhotoKind = '' | 'booking' | 'field' | 'identification' | 'marks' | 'other';

export const PHOTO_KIND_LABEL: Record<PhotoKind, string> = {
  '': 'Not stated',
  booking: 'Booking photograph',
  field: 'Taken in the field',
  identification: 'From an identity document',
  marks: 'Scars, marks or tattoos',
  other: 'Other',
};

/** Where a takedown request has got to. */
export type RemovalState = '' | 'requested' | 'removed' | 'kept';

export interface PersonPhoto {
  id: UUID;
  /** The identity it belongs to, not an incident. A face outlives a case. */
  masterId: UUID;

  /**
   * When the photograph was taken.
   *
   * Not when it was uploaded — a booking photo scanned out of a 2014 file is
   * twelve years old however recently somebody got round to adding it. Blank
   * is allowed and is shown as unknown, never as current.
   */
  takenOn: string;
  kind: PhotoKind;
  caption: string;
  source: FieldSource;

  filename: string;
  mime: string;
  size: number;
  /** Recorded at upload; what proves the bytes served are the bytes taken. */
  sha256: string;

  addedBy: UUID;
  addedByName: string;
  addedAt: string;

  /* ---- Taking one down -------------------------------------------- */
  removal: RemovalState;
  requestedBy: UUID | '';
  requestedByName: string;
  requestedAt: string;
  /** Why it should come down. Required — "wrong photo" is not a reason. */
  requestReason: string;
  decidedByName: string;
  decidedAt: string;
  decisionNote: string;
}

export function createPhoto(partial: Partial<PersonPhoto> = {}): PersonPhoto {
  const at = partial.addedAt ?? new Date().toISOString();
  return {
    id: '',
    masterId: '',
    takenOn: '',
    kind: '',
    caption: '',
    source: 'officer',
    filename: '',
    mime: '',
    size: 0,
    sha256: '',
    addedBy: '',
    addedByName: '',
    addedAt: at,
    removal: '',
    requestedBy: '',
    requestedByName: '',
    requestedAt: '',
    requestReason: '',
    decidedByName: '',
    decidedAt: '',
    decisionNote: '',
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* How current it is                                                   */
/* ------------------------------------------------------------------ */

/** The age of the likeness, on the same scale the contact details use. */
export function photoAge(photo: PersonPhoto, now = Date.now()): Freshness {
  return freshness(photo.takenOn, now, PHOTO_FRESHNESS_DAYS);
}

/* ------------------------------------------------------------------ */
/* Which ones to show                                                  */
/* ------------------------------------------------------------------ */

/** A photograph that has been taken down is out of the record, not deleted. */
export function isVisible(photo: PersonPhoto): boolean {
  return photo.removal !== 'removed';
}

/**
 * Newest likeness first.
 *
 * Sorted by when the photograph was *taken*, since that is the question being
 * asked. Undated ones sink to the bottom rather than sorting as ancient or as
 * new — either would be a claim the record does not support.
 */
export function sortPhotos(photos: PersonPhoto[]): PersonPhoto[] {
  return [...photos].sort((a, b) => {
    if (Boolean(a.takenOn) !== Boolean(b.takenOn)) return a.takenOn ? -1 : 1;
    if (a.takenOn !== b.takenOn) return b.takenOn.localeCompare(a.takenOn);
    return b.addedAt.localeCompare(a.addedAt);
  });
}

/**
 * The one to put on the record: the most recent likeness still standing.
 *
 * A photograph awaiting a takedown decision still shows. Somebody has said it
 * may be wrong, not that it is — and hiding it the moment it is questioned
 * would make a takedown request a way to quietly clear a record.
 */
export function currentPhoto(photos: PersonPhoto[]): PersonPhoto | null {
  return sortPhotos(photos.filter(isVisible))[0] ?? null;
}

/** Every photograph of this person, newest first. */
export function photosFor(photos: PersonPhoto[], masterId: string): PersonPhoto[] {
  return sortPhotos(photos.filter((p) => p.masterId === masterId));
}

/** Takedown requests nobody has decided yet — a queue, oldest first. */
export function pendingRemovals(photos: PersonPhoto[]): PersonPhoto[] {
  return photos
    .filter((p) => p.removal === 'requested')
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

/* ------------------------------------------------------------------ */
/* What can be done to one                                             */
/* ------------------------------------------------------------------ */

export interface Check {
  ok: boolean;
  reason?: string;
}

/**
 * Whether this photograph can be asked about.
 *
 * Anyone may ask. The only things that stop it are asking twice and asking
 * about one that is already gone.
 */
export function canRequestRemoval(photo: PersonPhoto): Check {
  if (photo.removal === 'requested') {
    return {
      ok: false,
      reason: `${photo.requestedByName || 'Somebody'} has already asked for this one to come down.`,
    };
  }
  if (photo.removal === 'removed') {
    return { ok: false, reason: 'This photograph has already been taken down.' };
  }
  return { ok: true };
}

/** A decision needs something to decide. */
export function canDecide(photo: PersonPhoto): Check {
  if (photo.removal !== 'requested') {
    return { ok: false, reason: 'Nothing has been asked about this photograph.' };
  }
  return { ok: true };
}

/**
 * What the officer looking at a person should be told about their picture.
 *
 * Empty when there is nothing worth saying, so a current photograph carries no
 * warning at all and the ones that do carry it mean something.
 */
export function photoWarning(photo: PersonPhoto | null, now = Date.now()): string {
  if (!photo) return 'No photograph on file.';
  const age = photoAge(photo, now);
  if (age.level === 'unknown') {
    return 'This photograph has no date. It could have been taken at any time.';
  }
  if (age.worthChecking) {
    return `This photograph is ${age.label.toLowerCase()}. Do not rely on it for an identification.`;
  }
  return '';
}
