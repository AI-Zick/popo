/**
 * Address resolution for the location index.
 *
 * Addresses differ from people in one useful way: they have a canonical form.
 * "612 North Marion Street" and "612 N Marion St" are not *similar* — they are
 * the same string once standardised. So this leans on deterministic
 * normalisation first and only falls back to fuzzy scoring for the cases
 * normalisation cannot reach, like a misspelt street name.
 *
 * The goal the officer actually cares about: typing an address they have been
 * to before returns exactly one option, with the gate code attached.
 */

import { jaroWinkler, normalizeAddress, soundex } from './matching';
import type { LocationIndex, MasterLocation } from './location';

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

export interface AddressParts {
  /** Leading house number, or '' for a block-level or named location. */
  number: string;
  /** Everything after the number, normalised. */
  street: string;
  /** The whole line, normalised. */
  line: string;
}

/**
 * Splits an address into a house number and a street. Handles the ways
 * officers actually write locations — "600 block N Marion St", "1142 Ashwood
 * Ln", "US-411 at Watson Rd".
 */
export function parseAddress(raw: string): AddressParts {
  const line = normalizeAddress(raw);
  // "600 BLOCK N MARION ST" — the block marker is noise once parsed.
  const blockMatch = /^(\d+)\s+BLOCK\s+(.*)$/.exec(line);
  if (blockMatch) {
    return { number: blockMatch[1], street: blockMatch[2].trim(), line };
  }
  const match = /^(\d+)\s+(.*)$/.exec(line);
  if (match) return { number: match[1], street: match[2].trim(), line };
  return { number: '', street: line, line };
}

/** Street numbers within the same hundred block. */
function sameBlock(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.floor(na / 100) === Math.floor(nb / 100);
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

export type LocationTier = 'certain' | 'strong' | 'possible';

export interface LocationMatch {
  location: MasterLocation;
  score: number;
  tier: LocationTier;
  reasons: string[];
}

export interface LocationQuery {
  address?: string;
  commonName?: string;
  city?: string;
  state?: string;
  zip?: string;
}

const has = (v: string | undefined): v is string => Boolean(v && v.trim());

function cityAgrees(query: LocationQuery, location: MasterLocation): boolean {
  if (!has(query.city) || !has(location.city)) return true;
  return normalizeAddress(query.city) === normalizeAddress(location.city);
}

export function scoreLocation(query: LocationQuery, location: MasterLocation): LocationMatch | null {
  const reasons: string[] = [];
  let score = 0;
  let exactAddress = false;

  const sameCity = cityAgrees(query, location);

  /* ---- Address line ------------------------------------------------- */
  if (has(query.address) && has(location.address)) {
    const q = parseAddress(query.address);
    const l = parseAddress(location.address);

    if (q.line === l.line) {
      score += 70;
      exactAddress = true;
      reasons.push('Same address');
    } else if (q.number && q.number === l.number && q.street === l.street) {
      score += 70;
      exactAddress = true;
      reasons.push('Same address');
    } else {
      const streetSimilarity = jaroWinkler(q.street, l.street);
      const streetSounds = soundex(q.street) === soundex(l.street);

      if (q.number && q.number === l.number && (streetSimilarity >= 0.88 || streetSounds)) {
        score += 55;
        reasons.push('Same number, street spelt differently');
      } else if (streetSimilarity >= 0.9 && sameBlock(q.number, l.number)) {
        score += 40;
        reasons.push('Same block of the same street');
      } else if (streetSimilarity >= 0.93 && (!q.number || !l.number)) {
        // One side is block-level or a named place with no house number.
        score += 35;
        reasons.push('Same street');
      } else {
        // Different street entirely — only a name match can save this.
        score -= 30;
      }
    }
  }

  /* ---- Common name and aliases -------------------------------------- */
  if (has(query.commonName)) {
    const q = normalizeAddress(query.commonName);
    const candidates = [location.commonName, ...location.aliases].filter(has);
    let best = 0;
    for (const candidate of candidates) {
      best = Math.max(best, jaroWinkler(q, normalizeAddress(candidate)));
    }
    if (best >= 0.94) {
      score += 45;
      reasons.push('Known by this name');
    } else if (best >= 0.85) {
      score += 25;
      reasons.push('Similar name');
    }
  }

  /* ---- Corroboration -------------------------------------------------- */
  if (has(query.city) && has(location.city)) {
    if (sameCity) score += 6;
    else {
      // The same street name in two different cities is two different places.
      score -= 35;
      reasons.length = 0;
    }
  }

  if (
    has(query.zip) &&
    has(location.zip) &&
    query.zip.trim().slice(0, 5) === location.zip.trim().slice(0, 5)
  ) {
    score += 5;
  }

  const bounded = Math.max(0, Math.min(100, score));

  /**
   * An exact normalised address in the same city is the same place. That is a
   * fact about addresses, not a guess, so it links without asking — which is
   * what stops a second record for a place the agency already knows.
   */
  if (exactAddress && sameCity) {
    return { location, score: bounded, tier: 'certain', reasons };
  }
  if (bounded >= 62) return { location, score: bounded, tier: 'strong', reasons };
  if (bounded >= 34) return { location, score: bounded, tier: 'possible', reasons };
  return null;
}

export function findLocations(
  query: LocationQuery,
  index: LocationIndex,
  options: { excludeIds?: string[]; limit?: number } = {},
): LocationMatch[] {
  if (!has(query.address) && !has(query.commonName)) return [];
  const exclude = new Set(options.excludeIds ?? []);

  const results: LocationMatch[] = [];
  for (const location of Object.values(index)) {
    if (exclude.has(location.id)) continue;
    const match = scoreLocation(query, location);
    if (match) results.push(match);
  }

  results.sort((a, b) => b.score - a.score);
  return options.limit ? results.slice(0, options.limit) : results;
}

/** The one location safe to reuse without asking, if there is one. */
export function autoLinkLocation(matches: LocationMatch[]): LocationMatch | null {
  const certain = matches.filter((m) => m.tier === 'certain');
  return certain.length === 1 ? certain[0] : null;
}

/**
 * Free-text search across the index, for the address box. Matches on address,
 * common name and aliases so "marion storage", "612 marion" and "storage" all
 * find the same place.
 */
export function searchLocations(
  query: string,
  index: LocationIndex,
  limit = 20,
): MasterLocation[] {
  const q = normalizeAddress(query);
  const all = Object.values(index);
  if (!q) {
    return all
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  const terms = q.split(' ').filter(Boolean);
  const scored = all
    .map((location) => {
      const haystack = normalizeAddress(
        [location.address, location.commonName, ...location.aliases, location.city].join(' '),
      );
      // Every term has to appear somewhere, so "marion storage" does not match
      // every address on Marion Street.
      const hit = terms.every((term) => haystack.includes(term));
      if (!hit) return null;
      const prefixBonus = haystack.startsWith(q) ? 10 : 0;
      return { location, rank: prefixBonus + location.notes.length };
    })
    .filter((x): x is { location: MasterLocation; rank: number } => x !== null);

  scored.sort((a, b) => b.rank - a.rank || locationSort(a.location, b.location));
  return scored.slice(0, limit).map((s) => s.location);
}

function locationSort(a: MasterLocation, b: MasterLocation): number {
  return (a.commonName || a.address).localeCompare(b.commonName || b.address);
}
