/**
 * How old a piece of information is.
 *
 * An address is not a fact, it is a fact *as at a date*. The system already
 * stamps every edit to a person's contact details, but a date sitting in the
 * database that nobody is shown is worth nothing: an officer looking at a phone
 * number has no way to tell whether it was confirmed this morning or copied out
 * of a 2019 field-interview card.
 *
 * That matters in specific, expensive ways. A warrant served at a four-year-old
 * address is served on whoever lives there now. A next-of-kin call to a
 * disconnected number is a death notification that does not happen. A victim
 * who cannot be reached for a follow-up becomes a case that gets closed for
 * lack of cooperation they were never asked for.
 *
 * So contact details carry their age wherever they are shown, and an unknown
 * age is shown as unknown — never as fresh.
 */

/** Thresholds in days, tuned for how fast contact details actually rot. */
export const FRESHNESS_DAYS = {
  /** Recent enough to act on without a second thought. */
  current: 90,
  /** Still probably right, but say so. */
  aging: 365,
  /** Old enough that it should be checked before it is relied on. */
  stale: 3 * 365,
} as const;

export type FreshnessLevel = 'current' | 'aging' | 'stale' | 'ancient' | 'unknown';

export interface Freshness {
  level: FreshnessLevel;
  /** Whole days since it was recorded, or null when there is no date. */
  days: number | null;
  /** "Confirmed today", "2 years old" — written to sit next to a value. */
  label: string;
  /** Whether it is worth the officer's attention before relying on it. */
  worthChecking: boolean;
}

const DAY = 86_400_000;

/**
 * Turns a timestamp into something an officer can act on.
 *
 * Deliberately vague past a few months. "Recorded 1,247 days ago" is precision
 * nobody needs; "3 years old" is the judgement they are actually making.
 */
export function freshness(iso: string | undefined | null, now = Date.now()): Freshness {
  if (!iso) {
    // No date is not the same as new. A record migrated from a previous system
    // with no provenance could be twenty years old, and saying nothing invites
    // the reader to assume it is current.
    return {
      level: 'unknown',
      days: null,
      label: 'Date unknown',
      worthChecking: true,
    };
  }

  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) {
    return { level: 'unknown', days: null, label: 'Date unknown', worthChecking: true };
  }

  const days = Math.max(0, Math.floor((now - at) / DAY));

  if (days <= FRESHNESS_DAYS.current) {
    return { level: 'current', days, label: recentLabel(days), worthChecking: false };
  }
  if (days <= FRESHNESS_DAYS.aging) {
    return {
      level: 'aging',
      days,
      label: `${Math.round(days / 30)} months old`,
      worthChecking: false,
    };
  }

  const years = Math.floor(days / 365);
  if (days <= FRESHNESS_DAYS.stale) {
    return {
      level: 'stale',
      days,
      label: `${years} ${years === 1 ? 'year' : 'years'} old`,
      worthChecking: true,
    };
  }
  return {
    level: 'ancient',
    days,
    label: `${years} years old`,
    worthChecking: true,
  };
}

function recentLabel(days: number): string {
  if (days === 0) return 'Recorded today';
  if (days === 1) return 'Recorded yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** Colour for the age, matching the tones the rest of the UI uses. */
export function freshnessTone(level: FreshnessLevel): 'ok' | 'neutral' | 'warn' {
  switch (level) {
    case 'current':
      return 'ok';
    case 'aging':
      return 'neutral';
    default:
      return 'warn';
  }
}

/** Short parenthetical for print, where there is no room for a badge. */
export function ageForPrint(iso: string | undefined | null, now = Date.now()): string {
  const result = freshness(iso, now);
  if (result.level === 'unknown') return 'date unknown';
  if (result.days !== null && result.days <= FRESHNESS_DAYS.current) return 'current';
  return result.label.toLowerCase();
}
