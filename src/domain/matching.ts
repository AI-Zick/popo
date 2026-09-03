/**
 * Identity resolution for the Master Name Index.
 *
 * The rule this module exists to enforce: never silently merge two people on
 * weak evidence. Merging two identities creates a record in which one person
 * carries another's criminal history, and that error is close to impossible to
 * unpick once reports, charges and cautions have accumulated against it.
 *
 * So matching is tiered. A hit on a genuinely unique identifier links
 * automatically. Anything weaker is *proposed* to the officer, who decides.
 */

import type { MasterPerson, PersonIndex } from './person';

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

export function normalizeName(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const STREET_WORDS: Record<string, string> = {
  STREET: 'ST', ST: 'ST',
  AVENUE: 'AVE', AVE: 'AVE',
  ROAD: 'RD', RD: 'RD',
  DRIVE: 'DR', DR: 'DR',
  LANE: 'LN', LN: 'LN',
  BOULEVARD: 'BLVD', BLVD: 'BLVD',
  COURT: 'CT', CT: 'CT',
  CIRCLE: 'CIR', CIR: 'CIR',
  PLACE: 'PL', PL: 'PL',
  TERRACE: 'TER', TER: 'TER',
  HIGHWAY: 'HWY', HWY: 'HWY',
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
  NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW',
  APARTMENT: 'APT', APT: 'APT', UNIT: 'APT', '#': 'APT',
};

export function normalizeAddress(value: string): string {
  return value
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => STREET_WORDS[word] ?? word)
    .join(' ')
    .trim();
}

export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  // Drop a leading country code so (205) 555-0148 and 1-205-555-0148 agree.
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

export function normalizeId(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/* ------------------------------------------------------------------ */
/* String similarity                                                   */
/* ------------------------------------------------------------------ */

/** Jaro similarity, 0..1. */
function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aFlags = new Array<boolean>(a.length).fill(false);
  const bFlags = new Array<boolean>(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (bFlags[j] || a[i] !== b[j]) continue;
      aFlags[i] = true;
      bFlags[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aFlags[i]) continue;
    while (!bFlags[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }

  const t = transpositions / 2;
  return (matches / a.length + matches / b.length + (matches - t) / matches) / 3;
}

/**
 * Jaro-Winkler, which weights a shared prefix more heavily. Good for names,
 * where typos cluster after the first few characters.
 */
export function jaroWinkler(a: string, b: string): number {
  const base = jaro(a, b);
  if (base < 0.7) return base;
  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix += 1;
  return base + prefix * 0.1 * (1 - base);
}

/**
 * Soundex, so "Smith"/"Smyth" and "Jon"/"John" collide. Crude, but it is what
 * catches the phonetic spelling an officer took down over a radio.
 */
export function soundex(value: string): string {
  const s = normalizeName(value).replace(/\s/g, '');
  if (!s) return '';
  const codes: Record<string, string> = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6',
  };
  let result = s[0];
  let previous = codes[s[0]] ?? '';
  for (let i = 1; i < s.length && result.length < 4; i += 1) {
    const code = codes[s[i]] ?? '';
    // H and W do not break a run of the same code; vowels do.
    if (code && code !== previous) result += code;
    if (s[i] !== 'H' && s[i] !== 'W') previous = code;
  }
  return result.padEnd(4, '0');
}

/* ------------------------------------------------------------------ */
/* Date of birth comparison                                            */
/* ------------------------------------------------------------------ */

export type DobComparison = 'exact' | 'typo' | 'different' | 'unknown';

/**
 * Distinguishes a mistyped date of birth from a genuinely different one.
 * A single wrong digit or a pair of transposed digits reads as a typo;
 * anything further apart is treated as a different person.
 */
export function compareDob(a: string, b: string): DobComparison {
  if (!a || !b) return 'unknown';
  if (a === b) return 'exact';

  const da = a.replace(/\D/g, '');
  const db = b.replace(/\D/g, '');
  if (da.length !== 8 || db.length !== 8) return 'different';

  let diffs = 0;
  const positions: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    if (da[i] !== db[i]) {
      diffs += 1;
      positions.push(i);
    }
  }
  if (diffs === 1) return 'typo';
  if (diffs === 2) {
    const [i, j] = positions;
    // Adjacent transposition, e.g. 1985-03-14 vs 1985-03-41.
    if (j === i + 1 && da[i] === db[j] && da[j] === db[i]) return 'typo';
  }
  return 'different';
}

/* ------------------------------------------------------------------ */
/* Match scoring                                                       */
/* ------------------------------------------------------------------ */

export type MatchTier = 'certain' | 'strong' | 'possible';

export interface MatchResult {
  master: MasterPerson;
  score: number;
  tier: MatchTier;
  /** Human-readable evidence for the match. */
  reasons: string[];
  /** Evidence *against* it. Any conflict caps the tier at "possible". */
  conflicts: string[];
}

/** The subset of identity fields matching actually reads. */
export type MatchQuery = Partial<
  Pick<
    MasterPerson,
    | 'lastName' | 'firstName' | 'middleName' | 'suffix' | 'businessName'
    | 'dob' | 'sex' | 'race'
    | 'address' | 'city' | 'phone' | 'email'
    | 'ssn' | 'driverLicense' | 'driverLicenseState' | 'stateId'
  >
>;

const has = (v: string | undefined): v is string => Boolean(v && v.trim());

const STRONG_THRESHOLD = 74;
const POSSIBLE_THRESHOLD = 42;

export function scoreMatch(query: MatchQuery, master: MasterPerson): MatchResult | null {
  const reasons: string[] = [];
  const conflicts: string[] = [];
  let score = 0;
  /*
    What the conflicts alone took off. Tracked separately because a conflict
    must never be able to hide a candidate — see `finalise`.
  */
  let penalty = 0;
  let strongIdMatch = false;

  /* ---- Strong identifiers ------------------------------------------ */

  if (has(query.ssn) && has(master.ssn)) {
    if (normalizeId(query.ssn) === normalizeId(master.ssn)) {
      score += 60;
      strongIdMatch = true;
      reasons.push('Same SSN');
    } else {
      conflicts.push('Different SSN on file');
      score -= 20;
      penalty += 20;
    }
  }

  if (has(query.driverLicense) && has(master.driverLicense)) {
    const sameNumber = normalizeId(query.driverLicense) === normalizeId(master.driverLicense);
    // Licence numbers are only unique within an issuing state.
    const sameState =
      !has(query.driverLicenseState) ||
      !has(master.driverLicenseState) ||
      query.driverLicenseState === master.driverLicenseState;
    if (sameNumber && sameState) {
      score += 55;
      strongIdMatch = true;
      reasons.push('Same driver licence');
    } else if (!sameNumber) {
      conflicts.push('Different driver licence on file');
      score -= 15;
      penalty += 15;
    }
  }

  if (has(query.stateId) && has(master.stateId)) {
    if (normalizeId(query.stateId) === normalizeId(master.stateId)) {
      score += 55;
      strongIdMatch = true;
      reasons.push('Same state ID');
    } else {
      conflicts.push('Different state ID on file');
      score -= 15;
      penalty += 15;
    }
  }

  /* ---- Business records --------------------------------------------- */

  if (has(query.businessName) || has(master.businessName)) {
    if (has(query.businessName) && has(master.businessName)) {
      const similarity = jaroWinkler(
        normalizeName(query.businessName),
        normalizeName(master.businessName),
      );
      if (similarity >= 0.93) {
        score += 45;
        reasons.push('Same business name');
      } else if (similarity >= 0.85) {
        score += 20;
        reasons.push('Similar business name');
      } else {
        return null;
      }
      if (
        has(query.address) &&
        has(master.address) &&
        normalizeAddress(query.address) === normalizeAddress(master.address)
      ) {
        score += 25;
        reasons.push('Same address');
      }
      return finalise(master, score, penalty, reasons, conflicts, strongIdMatch);
    }
    // One is a business and the other is not.
    return null;
  }

  /* ---- Name ---------------------------------------------------------- */

  if (has(query.lastName) && has(master.lastName)) {
    const a = normalizeName(query.lastName);
    const b = normalizeName(master.lastName);
    const similarity = jaroWinkler(a, b);
    if (a === b) {
      score += 14;
      reasons.push('Same last name');
    } else if (similarity >= 0.9) {
      score += 9;
      reasons.push('Similar last name');
    } else if (soundex(a) === soundex(b)) {
      score += 6;
      reasons.push('Last name sounds alike');
    } else if (similarity < 0.7) {
      score -= 20;
      penalty += 20;
      conflicts.push('Different last name');
    }
  }

  if (has(query.firstName) && has(master.firstName)) {
    const a = normalizeName(query.firstName);
    const b = normalizeName(master.firstName);
    const similarity = jaroWinkler(a, b);
    if (a === b) {
      score += 12;
      reasons.push('Same first name');
    } else if (similarity >= 0.9) {
      score += 7;
      reasons.push('Similar first name');
    } else if (soundex(a) === soundex(b)) {
      score += 4;
      reasons.push('First name sounds alike');
    } else if (similarity < 0.7) {
      score -= 12;
    }
  }

  if (has(query.middleName) && has(master.middleName)) {
    const a = normalizeName(query.middleName);
    const b = normalizeName(master.middleName);
    if (a === b) score += 4;
    else if (a[0] === b[0]) score += 2;
  }

  /**
   * A differing suffix on an otherwise identical name is the classic
   * father-and-son case. It is evidence *against* a match, not for one.
   */
  if (has(query.suffix) && has(master.suffix)) {
    if (normalizeName(query.suffix) !== normalizeName(master.suffix)) {
      score -= 18;
      penalty += 18;
      conflicts.push('Different name suffix — may be a relative');
    }
  }

  /* ---- Date of birth -------------------------------------------------- */

  const dob = compareDob(query.dob ?? '', master.dob ?? '');
  if (dob === 'exact') {
    score += 30;
    reasons.push('Same date of birth');
  } else if (dob === 'typo') {
    score += 12;
    reasons.push('Date of birth differs by one digit');
  } else if (dob === 'different') {
    score -= 28;
    penalty += 28;
    conflicts.push('Different date of birth');
  }

  /* ---- Descriptors ---------------------------------------------------- */

  if (has(query.sex) && has(master.sex)) {
    if (query.sex === master.sex) score += 4;
    else if (query.sex !== 'U' && master.sex !== 'U') {
      score -= 14;
      penalty += 14;
      conflicts.push('Different sex recorded');
    }
  }

  if (has(query.race) && has(master.race) && query.race === master.race) score += 2;

  /* ---- Contact -------------------------------------------------------- */

  if (
    has(query.address) &&
    has(master.address) &&
    normalizeAddress(query.address) === normalizeAddress(master.address)
  ) {
    score += 10;
    reasons.push('Same address');
  }

  if (
    has(query.phone) &&
    has(master.phone) &&
    normalizePhone(query.phone) === normalizePhone(master.phone)
  ) {
    score += 10;
    reasons.push('Same phone number');
  }

  if (
    has(query.email) &&
    has(master.email) &&
    query.email.trim().toLowerCase() === master.email.trim().toLowerCase()
  ) {
    score += 6;
    reasons.push('Same email');
  }

  return finalise(master, score, penalty, reasons, conflicts, strongIdMatch);
}

function finalise(
  master: MasterPerson,
  rawScore: number,
  penalty: number,
  reasons: string[],
  conflicts: string[],
  strongIdMatch: boolean,
): MatchResult | null {
  const score = Math.max(0, Math.min(100, rawScore));

  let tier: MatchTier;
  if (strongIdMatch && conflicts.length === 0) {
    tier = 'certain';
  } else if (score >= STRONG_THRESHOLD) {
    tier = 'strong';
  } else if (score >= POSSIBLE_THRESHOLD) {
    tier = 'possible';
  } else if (conflicts.length > 0 && rawScore + penalty >= POSSIBLE_THRESHOLD) {
    /*
      A conflict caps a match; it must never erase one.

      Without this branch, a record that agrees on name and date of birth but
      carries a different licence number scores below the floor and disappears
      from the results entirely — the officer sees "no match" and creates a
      second record for a person the system already knows, which is the exact
      outcome all of this exists to prevent. The right answer is to show it,
      with the conflict named, and let a human look.
    */
    tier = 'possible';
  } else {
    return null;
  }

  // Any contradicting evidence bars an automatic link, however high the score.
  if (conflicts.length > 0 && tier !== 'possible') tier = 'possible';

  return { master, score, tier, reasons, conflicts };
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/**
 * Cheap pre-filter. Scoring every record in the index is fine at prototype
 * scale but not at agency scale, so candidates are blocked down first by the
 * signals that any true match must share at least one of.
 */
function blockingKeys(q: MatchQuery): Set<string> {
  const keys = new Set<string>();
  if (has(q.lastName)) keys.add(`N:${soundex(q.lastName)}`);
  if (has(q.businessName)) keys.add(`N:${soundex(q.businessName)}`);
  if (has(q.dob)) keys.add(`D:${q.dob.replace(/\D/g, '')}`);
  if (has(q.ssn)) keys.add(`S:${normalizeId(q.ssn)}`);
  if (has(q.driverLicense)) keys.add(`L:${normalizeId(q.driverLicense)}`);
  if (has(q.stateId)) keys.add(`I:${normalizeId(q.stateId)}`);
  if (has(q.phone)) keys.add(`P:${normalizePhone(q.phone)}`);
  return keys;
}

export function indexKeys(master: MasterPerson): Set<string> {
  return blockingKeys(master);
}

/**
 * Candidate matches for an identity, best first. Never mutates anything and
 * never decides on the officer's behalf — the tier tells the caller how much
 * weight the evidence carries.
 */
export function findMatches(
  query: MatchQuery,
  index: PersonIndex,
  options: { excludeIds?: string[]; limit?: number } = {},
): MatchResult[] {
  const exclude = new Set(options.excludeIds ?? []);
  const queryKeys = blockingKeys(query);
  // With nothing identifying to go on there is nothing to match against.
  if (queryKeys.size === 0) return [];

  const results: MatchResult[] = [];
  for (const master of Object.values(index)) {
    if (exclude.has(master.id)) continue;

    // A near-miss on a typed date of birth would not share the DOB block, so
    // fall back to scoring anything that shares a name key.
    let shares = false;
    for (const key of indexKeys(master)) {
      if (queryKeys.has(key)) {
        shares = true;
        break;
      }
    }
    if (!shares) continue;

    const result = scoreMatch(query, master);
    if (result) results.push(result);
  }

  results.sort((a, b) => b.score - a.score);
  return options.limit ? results.slice(0, options.limit) : results;
}

/** The single candidate safe to link automatically, if there is one. */
export function autoLinkCandidate(matches: MatchResult[]): MatchResult | null {
  const certain = matches.filter((m) => m.tier === 'certain');
  // Two "certain" hits means the index itself holds a duplicate; a human
  // has to resolve that rather than the system picking one.
  return certain.length === 1 ? certain[0] : null;
}
