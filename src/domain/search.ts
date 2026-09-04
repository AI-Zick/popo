/**
 * Search.
 *
 * Officers search far more than they write. "Have we dealt with this guy
 * before?", "what do we know about this address?", "whose plate is that?" —
 * asked from a car, at 2am, with one hand. Every good thing already in this
 * system (the Master Name Index, the location index with its gate codes, prior
 * contacts) is worth nothing if the only way to reach it is to open a report
 * you are not writing.
 *
 * Built as an inverted index rather than a scan, for a reason that shows up
 * only at real scale: an agency with 200,000 people in the index cannot afford
 * to lowercase and substring-match every one of them on every keystroke. Tokens
 * are extracted once when the data changes, and a keystroke intersects sets.
 */

import type { MasterPerson, PersonIndex } from './person';
import { displayName } from './person';
import type { LocationIndex, MasterLocation } from './location';
import { vehicleName, vehicleTag, type VehicleIndex } from './vehicle';
import { locationLabel } from './location';
import type { Incident } from './types';
import type { CrashReport } from './crash';
import { OFFENSE_BY_CODE } from './codes';

export type ResultKind = 'person' | 'location' | 'incident' | 'crash' | 'vehicle';

export const KIND_LABEL: Record<ResultKind, string> = {
  person: 'People',
  location: 'Places',
  incident: 'Reports',
  crash: 'Crash reports',
  vehicle: 'Vehicles',
};

/** Groups appear in this order, which is roughly how often they are wanted. */
export const KIND_ORDER: ResultKind[] = ['person', 'vehicle', 'location', 'incident', 'crash'];

export interface SearchResult {
  key: string;
  kind: ResultKind;
  title: string;
  subtitle: string;
  /** Third line, only where it disambiguates. */
  detail: string;
  score: number;
  /** Officer-safety flags. These are why somebody searched a name at 2am. */
  cautions: string[];
  /** What to open, and where it lives. */
  target: { kind: ResultKind; id: string; parentId?: string };
}

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

/**
 * Splits text into searchable tokens.
 *
 * Punctuation both drops and joins: `4AC-7821` yields `4ac`, `7821` *and*
 * `4ac7821`, because an officer types a plate either way and neither should
 * miss. Same for `2026-000418` and `CF-2026-0417`.
 *
 * The joined form is produced **only when there is no whitespace**, and that
 * restriction is load-bearing rather than tidiness. Joining across spaces turns
 * "dana whitfield" into a `danawhitfield` token that matches nothing — and
 * since every query term has to match, one useless token silently empties the
 * result set. Punctuation inside a single word is an identifier; a space is two
 * words.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase().trim();
  const parts = lower.split(/[^a-z0-9]+/).filter((t) => t.length > 0);
  if (/\s/.test(lower)) return parts;

  const joined = lower.replace(/[^a-z0-9]+/g, '');
  return joined.length > 1 && !parts.includes(joined) ? [...parts, joined] : parts;
}

/**
 * Terms for a *query*, which is not the same job as indexing.
 *
 * Indexing is generous — `2026-000418` is stored as `2026`, `000418` and
 * `2026000418`, so any fragment finds it. Querying has to be precise, because
 * every term must match: splitting `4AC-7821` into `4ac` AND `7821` fails
 * against a plate stored as `4AC7821`, which indexes only as one token.
 *
 * So a query with no whitespace is one identifier and collapses to its joined
 * form; a query with whitespace is several words and stays split. Punctuation
 * inside a word is noise either way, and the two spellings of a plate now
 * behave identically.
 */
export function queryTerms(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase().trim();
  if (/\s/.test(lower)) return lower.split(/[^a-z0-9]+/).filter((t) => t.length > 0);
  const joined = lower.replace(/[^a-z0-9]+/g, '');
  return joined ? [joined] : [];
}

interface Entry {
  result: Omit<SearchResult, 'score'>;
  /** Every token that should match this entry, with its weight. */
  tokens: Map<string, number>;
}

/** Field weights. A surname is worth more than a word buried in a narrative. */
const W = {
  name: 10,
  identifier: 12,
  address: 6,
  caseNumber: 12,
  secondary: 3,
  body: 1,
} as const;

function addTokens(map: Map<string, number>, text: string, weight: number): void {
  for (const token of tokenize(text)) {
    map.set(token, Math.max(map.get(token) ?? 0, weight));
  }
}

/* ------------------------------------------------------------------ */
/* The index                                                           */
/* ------------------------------------------------------------------ */

export interface SearchIndex {
  entries: Entry[];
  /** token → indices into `entries`. The thing that makes a keystroke cheap. */
  postings: Map<string, number[]>;
  size: number;
}

export interface IndexInput {
  people: PersonIndex;
  locations: LocationIndex;
  incidents: Incident[];
  crashes: CrashReport[];
  /** The Master Vehicle Index. Absent on older callers, which is fine. */
  vehicles?: VehicleIndex;
}

export function buildIndex(input: IndexInput): SearchIndex {
  const entries: Entry[] = [];

  /*
    Where a person or a place can be opened.

    Neither has a screen of its own yet, so a hit opens the most recent report
    it appears on. Computed once here rather than searched for on click, and it
    is what lets the result row say which report it is about to open — a search
    result that goes nowhere is worse than no result.
  */
  const latestByPerson = new Map<string, Incident>();
  const latestByLocation = new Map<string, Incident>();
  for (const incident of input.incidents) {
    for (const link of incident.persons) {
      const seen = latestByPerson.get(link.masterId);
      if (!seen || incident.reportedAt > seen.reportedAt) latestByPerson.set(link.masterId, incident);
    }
    if (incident.locationId) {
      const seen = latestByLocation.get(incident.locationId);
      if (!seen || incident.reportedAt > seen.reportedAt) {
        latestByLocation.set(incident.locationId, incident);
      }
    }
  }

  /* ---- People ------------------------------------------------------- */
  for (const person of Object.values(input.people)) {
    entries.push({
      result: personResult(person, latestByPerson.get(person.id)),
      tokens: personTokens(person),
    });
  }

  /* ---- Places ------------------------------------------------------- */
  for (const location of Object.values(input.locations)) {
    entries.push({
      result: locationResult(location, latestByLocation.get(location.id)),
      tokens: locationTokens(location),
    });
  }

  /* ---- Vehicles of record --------------------------------------------- */
  /*
    One entry per vehicle, not per sighting. The plate a vehicle used to carry
    is indexed too, so running an old plate still finds the car — which is the
    single most useful thing an index of vehicles does that a list of vehicles
    on reports cannot.
  */
  for (const vehicle of Object.values(input.vehicles ?? {})) {
    const tokens = new Map<string, number>();
    addTokens(tokens, vehicle.plate, W.identifier);
    addTokens(tokens, vehicle.vin, W.identifier);
    for (const former of vehicle.formerPlates ?? []) {
      addTokens(tokens, former.plate, W.identifier);
    }
    addTokens(
      tokens,
      `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.color}`,
      W.secondary,
    );
    entries.push({
      result: {
        key: `vehicle:${vehicle.id}`,
        kind: 'vehicle',
        title: vehicleName(vehicle),
        subtitle: [vehicleTag(vehicle), vehicle.color].filter(Boolean).join(' · '),
        detail: vehicle.formerPlates?.length
          ? `Previously ${vehicle.formerPlates[0].plate}`
          : 'Vehicle of record',
        cautions: vehicle.cautions ?? [],
        target: { kind: 'vehicle', id: vehicle.id },
      },
      tokens,
    });
  }

  /* ---- Reports ------------------------------------------------------- */
  /*
    A vehicle written on a report is findable *through the report*, not as a
    vehicle in its own right. It used to be its own row under "Vehicles", which
    put two different kinds of thing under one heading: rows that opened a
    vehicle record, and rows that opened a report. An officer running a plate
    got both and could not tell which was which from looking.

    The tokens still travel — the plate, the VIN and the description all reach
    the report — so a plate search still finds the burglary it was written on.
    It just says "report" now, because that is what it opens.
  */
  for (const incident of input.incidents) {
    entries.push({
      result: incidentResult(incident, input.locations),
      tokens: incidentTokens(incident, input.people),
    });
  }

  /* ---- Crash reports and their units ---------------------------------- */
  for (const crash of input.crashes) {
    const tokens = new Map<string, number>();
    addTokens(tokens, crash.caseNumber, W.caseNumber);
    addTokens(tokens, crash.stateCrashNumber, W.caseNumber);
    addTokens(tokens, crash.callNumber, W.identifier);
    addTokens(tokens, `${crash.onRoad} ${crash.crossStreet}`, W.address);
    addTokens(tokens, crash.reportingOfficer, W.secondary);
    addTokens(tokens, crash.narrative, W.body);
    for (const unit of crash.units) {
      addTokens(tokens, unit.plate, W.identifier);
      addTokens(tokens, unit.vin, W.identifier);
      addTokens(tokens, `${unit.year} ${unit.make} ${unit.model}`, W.secondary);
    }
    entries.push({
      result: {
        key: `crash:${crash.id}`,
        kind: 'crash',
        title: crash.caseNumber,
        subtitle: [crash.onRoad, crash.crossStreet].filter(Boolean).join(' at ') || 'Location not set',
        detail: `${crash.units.length} ${crash.units.length === 1 ? 'unit' : 'units'} · ${crash.reportingOfficer || 'Unassigned'}`,
        cautions: [],
        target: { kind: 'crash', id: crash.id },
      },
      tokens,
    });
  }

  /* ---- Postings ------------------------------------------------------- */
  const postings = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    for (const token of entry.tokens.keys()) {
      const list = postings.get(token);
      if (list) list.push(index);
      else postings.set(token, [index]);
    }
  });

  return { entries, postings, size: entries.length };
}

/* ---- Per-entity shaping -------------------------------------------- */

function personTokens(person: MasterPerson): Map<string, number> {
  const tokens = new Map<string, number>();
  addTokens(tokens, `${person.lastName} ${person.firstName} ${person.middleName} ${person.suffix}`, W.name);
  addTokens(tokens, person.businessName, W.name);
  for (const alias of person.aliases) addTokens(tokens, alias, W.name);
  addTokens(tokens, person.driverLicense, W.identifier);
  addTokens(tokens, person.stateId, W.identifier);
  addTokens(tokens, person.phone, W.identifier);
  // Deliberately not the SSN. Nobody should be able to find a person by typing
  // fragments of one, and it has no business being in a token list.
  addTokens(tokens, `${person.address} ${person.city} ${person.state} ${person.zip}`, W.address);
  addTokens(tokens, person.dob, W.identifier);
  return tokens;
}

function personResult(person: MasterPerson, latest?: Incident): Omit<SearchResult, 'score'> {
  return {
    key: `person:${person.id}`,
    kind: 'person',
    title: displayName(person),
    subtitle: [person.dob && `DOB ${person.dob}`, person.sex, person.race]
      .filter(Boolean)
      .join(' · '),
    detail: [
      [person.address, person.city].filter(Boolean).join(', '),
      latest ? `Last on ${latest.caseNumber}` : 'Not on any report',
    ]
      .filter(Boolean)
      .join(' · '),
    cautions: person.cautions,
    target: { kind: 'person', id: person.id, parentId: latest?.id },
  };
}

function locationTokens(location: MasterLocation): Map<string, number> {
  const tokens = new Map<string, number>();
  addTokens(tokens, location.commonName, W.name);
  for (const alias of location.aliases) addTokens(tokens, alias, W.name);
  addTokens(tokens, `${location.address} ${location.city} ${location.state} ${location.zip}`, W.address);
  addTokens(tokens, location.beat, W.secondary);
  // Note text is searchable, but never the restricted ones — a gate code must
  // not be findable by typing it.
  for (const note of location.notes) {
    if (!note.sensitive && !note.retractedAt) addTokens(tokens, note.text, W.body);
  }
  return tokens;
}

function locationResult(location: MasterLocation, latest?: Incident): Omit<SearchResult, 'score'> {
  const live = location.notes.filter((n) => !n.retractedAt);
  return {
    key: `location:${location.id}`,
    kind: 'location',
    title: locationLabel(location),
    subtitle: [location.address, location.city].filter(Boolean).join(', '),
    detail: [
      location.beat && `Beat ${location.beat}`,
      live.length > 0 && `${live.length} note${live.length === 1 ? '' : 's'}`,
      latest && `Last on ${latest.caseNumber}`,
    ]
      .filter(Boolean)
      .join(' · '),
    cautions: live.filter((n) => n.kind === 'hazard').map((n) => n.text.slice(0, 90)),
    target: { kind: 'location', id: location.id, parentId: latest?.id },
  };
}

function incidentTokens(incident: Incident, people: PersonIndex): Map<string, number> {
  const tokens = new Map<string, number>();
  addTokens(tokens, incident.caseNumber, W.caseNumber);
  addTokens(tokens, incident.reportingOfficer, W.secondary);
  addTokens(tokens, incident.narrative, W.body);
  for (const offense of incident.offenses) {
    addTokens(tokens, OFFENSE_BY_CODE.get(offense.code)?.label ?? '', W.secondary);
    addTokens(tokens, offense.statute, W.secondary);
  }
  // People on the report are findable through it, so "the Whitfield burglary"
  // works as a search.
  for (const link of incident.persons) {
    const master = people[link.masterId];
    if (master) addTokens(tokens, `${master.firstName} ${master.lastName} ${master.businessName}`, W.secondary);
  }
  // So are the vehicles on it, the same way a crash report carries its units.
  for (const vehicle of incident.vehicles) {
    addTokens(tokens, vehicle.plate, W.identifier);
    addTokens(tokens, vehicle.vin, W.identifier);
    addTokens(tokens, `${vehicle.year} ${vehicle.make} ${vehicle.model}`, W.secondary);
  }
  return tokens;
}

function incidentResult(incident: Incident, locations: LocationIndex): Omit<SearchResult, 'score'> {
  const offenses = incident.offenses
    .map((o) => OFFENSE_BY_CODE.get(o.code)?.label)
    .filter(Boolean)
    .join(', ');
  return {
    key: `incident:${incident.id}`,
    kind: 'incident',
    title: incident.caseNumber,
    subtitle: offenses || 'No offense recorded',
    detail: [locationLabel(locations[incident.locationId]), incident.reportingOfficer]
      .filter(Boolean)
      .join(' · '),
    cautions: [],
    target: { kind: 'incident', id: incident.id },
  };
}

/* ------------------------------------------------------------------ */
/* Querying                                                            */
/* ------------------------------------------------------------------ */

export const MAX_RESULTS = 40;

/**
 * Runs a query against the index.
 *
 * Every query token has to match something on the entry — typing more words
 * narrows rather than widens, which is what people expect and what makes a
 * two-word search useful on a big index. The last token matches as a prefix,
 * because the officer is still typing it.
 */
export function search(index: SearchIndex, query: string, limit = MAX_RESULTS): SearchResult[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  const scores = new Map<number, number>();
  let candidates: Set<number> | null = null;

  terms.forEach((term, i) => {
    const isLast = i === terms.length - 1;
    const matched = new Set<number>();

    /*
      An exact token hit is a postings lookup. A prefix hit has to walk the
      token list, which is the one linear pass in here — acceptable because it
      only happens for the term being typed, and only over distinct tokens
      rather than over every record.
    */
    const exact = index.postings.get(term);
    if (exact) {
      for (const entryIndex of exact) {
        matched.add(entryIndex);
        scores.set(entryIndex, (scores.get(entryIndex) ?? 0) + weightOf(index, entryIndex, term) * 2);
      }
    }

    if (isLast) {
      for (const [token, list] of index.postings) {
        if (token.length > term.length && token.startsWith(term)) {
          for (const entryIndex of list) {
            matched.add(entryIndex);
            const bump = weightOf(index, entryIndex, token) * (term.length / token.length);
            scores.set(entryIndex, (scores.get(entryIndex) ?? 0) + bump);
          }
        }
      }
    }

    candidates = candidates === null ? matched : intersect(candidates, matched);
  });

  const hits = candidates ?? new Set<number>();
  return [...hits]
    .map((entryIndex) => ({
      ...index.entries[entryIndex].result,
      score: scores.get(entryIndex) ?? 0,
    }))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}

function weightOf(index: SearchIndex, entryIndex: number, token: string): number {
  return index.entries[entryIndex].tokens.get(token) ?? 1;
}

function intersect(a: Set<number>, b: Set<number>): Set<number> {
  // Walk the smaller set, which matters once one term is common and the other
  // is a surname.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  const out = new Set<number>();
  for (const value of small) if (large.has(value)) out.add(value);
  return out;
}

/** Results grouped for display, in a stable order. */
export function groupResults(results: SearchResult[]): { kind: ResultKind; results: SearchResult[] }[] {
  return KIND_ORDER.map((kind) => ({ kind, results: results.filter((r) => r.kind === kind) })).filter(
    (group) => group.results.length > 0,
  );
}
