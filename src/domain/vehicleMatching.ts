/**
 * Identity resolution for the Master Vehicle Index.
 *
 * Tiered the same way the name index is, and for the same reason: linking two
 * records that are not the same thing puts one car's history on another's, and
 * a stolen flag on the wrong minivan is not a clerical error to the person
 * driving it.
 *
 * The tiers are not the same as a person's, because the evidence is not:
 *
 * **A VIN is certain.** It identifies the vehicle itself, it is issued once,
 * and it never moves. Same VIN, same car.
 *
 * **A plate is strong, never certain.** Registrations follow the owner in most
 * states, so a plate leaves one car and lands on another every time somebody
 * buys a vehicle. A plate hit backed by a matching make and model is a car we
 * have seen. A plate hit that argues with the make and model is the *opposite*
 * of a match — it is a plate that moved, and linking them would merge two
 * strangers' vehicles. That case scores as a conflict, not a hit.
 *
 * **Different VINs settle it.** No amount of agreement about plate, colour and
 * model outranks two different VINs. They are two cars.
 */

import type { MasterVehicle, VehicleIndex } from './vehicle';
import { normalizePlate, normalizeState, normalizeVin } from './vehicle';
import { jaroWinkler, normalizeName } from './matching';

export type VehicleMatchTier = 'certain' | 'strong' | 'possible';

export interface VehicleMatchResult {
  master: MasterVehicle;
  score: number;
  tier: VehicleMatchTier;
  reasons: string[];
  conflicts: string[];
}

export type VehicleQuery = Partial<
  Pick<MasterVehicle, 'vin' | 'plate' | 'plateState' | 'year' | 'make' | 'model' | 'color'>
>;

const has = (value: string | undefined): value is string => Boolean(value && value.trim());

const STRONG_THRESHOLD = 70;
const POSSIBLE_THRESHOLD = 30;

/**
 * The short names people actually say on the radio.
 *
 * Written out rather than guessed at from a shared prefix, because the prefix
 * rule that joins CHEVY to CHEVROLET also joins MERCURY to MERCEDES — both
 * start MERC — and quietly merging two makes is worse than failing to spell
 * one of them out.
 */
const MAKE_ALIASES: Record<string, string> = {
  CHEVY: 'CHEVROLET',
  CHEV: 'CHEVROLET',
  VW: 'VOLKSWAGEN',
  MB: 'MERCEDESBENZ',
  MERCEDES: 'MERCEDESBENZ',
  BENZ: 'MERCEDESBENZ',
  HD: 'HARLEYDAVIDSON',
  HARLEY: 'HARLEYDAVIDSON',
  BEEMER: 'BMW',
  LANDROVER: 'LAND ROVER',
};

const canonicalMake = (value: string): string => {
  const name = normalizeName(value).replace(/[^A-Z]/g, '');
  return MAKE_ALIASES[name] ?? name;
};

/** Makes are typed and misspelled: "Chevrolet", "Chevy", "Cheverolet". */
function sameMake(a: string, b: string): boolean {
  const left = canonicalMake(a);
  const right = canonicalMake(b);
  if (!left || !right) return false;
  if (left === right) return true;
  // A misspelling, which is a different problem from a shortening.
  return jaroWinkler(left, right) >= 0.9;
}

function sameModel(a: string, b: string): boolean {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  return left === right || jaroWinkler(left, right) >= 0.9;
}

/**
 * How far apart two model years are, or null when either is missing.
 *
 * A year is the field officers get wrong most, because they are reading a body
 * shape rather than a document — so one year out is a rounding error and four
 * years out is a different car.
 */
function yearGap(a: string, b: string): number | null {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right) || !left || !right) return null;
  return Math.abs(left - right);
}

export function scoreVehicleMatch(
  query: VehicleQuery,
  master: MasterVehicle,
): VehicleMatchResult | null {
  const reasons: string[] = [];
  const conflicts: string[] = [];
  let score = 0;
  let vinMatch = false;
  let plateMatch = false;

  /* ---- The VIN, which settles it either way ------------------------ */

  if (has(query.vin) && has(master.vin)) {
    if (normalizeVin(query.vin) === normalizeVin(master.vin)) {
      score += 100;
      vinMatch = true;
      reasons.push('Same VIN');
    } else {
      /*
        Two VINs that disagree is the end of the conversation. Returning null
        rather than a low score matters: a scored result can still be offered
        to an officer as "possible", and there is nothing possible about it.
      */
      return null;
    }
  }

  /* ---- The plate, which does not ----------------------------------- */

  if (has(query.plate)) {
    const wanted = normalizePlate(query.plate);
    const queryState = normalizeState(query.plateState ?? '');
    const masterState = normalizeState(master.plateState ?? '');
    const statesKnown = Boolean(queryState && masterState);
    const sameState = queryState === masterState;
    const samePlate = has(master.plate) && normalizePlate(master.plate) === wanted;

    if (samePlate && (!statesKnown || sameState)) {
      plateMatch = true;
      /*
        A plate and a state, matching what is on the car today, is enough on
        its own to reach `strong` — it is the current registration, and an
        officer who runs a plate and is told "possible" about the exact car it
        comes back to has been given a worse answer than the DMV would.
        Never `certain`, though: see the note at the top of this file.
      */
      score += statesKnown ? STRONG_THRESHOLD : 35;
      reasons.push(statesKnown ? `Same plate (${masterState})` : 'Same plate, state unknown');
    } else if (samePlate && !sameState) {
      // The same characters registered in two states is a coincidence, and a
      // common one on short plates.
      conflicts.push(`Plate matches but registered in ${masterState}, not ${queryState}`);
      score -= 20;
    } else {
      /*
        The plate this car used to wear. Worth a hit, and worth saying out
        loud — an officer running a plate that comes back to a car now wearing
        a different one needs to be told that rather than left to wonder why
        the record does not look like what they are standing behind.
      */
      const former = master.formerPlates?.find(
        (entry) => normalizePlate(entry.plate) === wanted,
      );
      if (former) {
        plateMatch = true;
        score += 45;
        reasons.push(
          `Carried ${former.plate}${former.state ? ` (${former.state})` : ''} until ${former.seenUntil.slice(0, 10)}`,
        );
      }
    }
  }

  /* ---- What the car actually is ------------------------------------ */

  const makeAgrees = has(query.make) && has(master.make) && sameMake(query.make, master.make);
  const makeDisagrees = has(query.make) && has(master.make) && !makeAgrees;
  const modelAgrees = has(query.model) && has(master.model) && sameModel(query.model, master.model);
  const modelDisagrees = has(query.model) && has(master.model) && !modelAgrees;

  if (makeAgrees) {
    score += 12;
    reasons.push('Same make');
  }
  if (modelAgrees) {
    score += 12;
    reasons.push('Same model');
  }

  const gap = yearGap(query.year ?? '', master.year ?? '');
  if (gap !== null) {
    if (gap === 0) {
      score += 10;
      reasons.push('Same model year');
    } else if (gap === 1) {
      score += 4;
      reasons.push('Model year one out, which officers judge by eye');
    } else {
      conflicts.push(`Model year ${query.year} against ${master.year} on file`);
      score -= 10;
    }
  }

  if (has(query.color) && has(master.color)) {
    if (normalizeName(query.color) === normalizeName(master.color)) {
      score += 6;
      reasons.push('Same colour');
    } else {
      // Cars get resprayed and colours get called different things at night.
      // Worth noting, never worth much.
      conflicts.push(`Recorded as ${master.color}, not ${query.color}`);
      score -= 4;
    }
  }

  /* ---- Tiers -------------------------------------------------------- */

  /*
    The rule this whole module exists for. A plate that agrees while the car it
    is on disagrees is a plate that has been transferred, and the two records
    are two different vehicles that happen to share a registration. Saying so
    out loud is more useful than a low score, because the officer looking at
    this needs to know the plate came back to something else.
  */
  const plateMoved = plateMatch && !vinMatch && (makeDisagrees || modelDisagrees);
  if (plateMoved) {
    conflicts.push(
      `That plate is on a ${[master.year, master.make, master.model].filter(Boolean).join(' ')} in this index — plates move between vehicles`,
    );
    score -= 45;
  }

  let tier: VehicleMatchTier;
  if (vinMatch) {
    tier = 'certain';
  } else if (score >= STRONG_THRESHOLD && !plateMoved && conflicts.length === 0) {
    tier = 'strong';
  } else {
    tier = 'possible';
  }

  /*
    A conflict must never be able to hide a candidate. Somebody has to see the
    plate that moved — hiding it is how the officer concludes the car is
    unknown to us when it is the second time this week.
  */
  if (score < POSSIBLE_THRESHOLD && conflicts.length === 0) return null;

  return { master, score, tier, reasons, conflicts };
}

/* ------------------------------------------------------------------ */
/* Lookup                                                              */
/* ------------------------------------------------------------------ */

/**
 * The keys a vehicle can be found by.
 *
 * Former plates are in here on purpose: a plate query about a car that has
 * since been re-registered should still find it, and the reason it matched is
 * exactly the thing the officer wants told to them.
 */
export function vehicleKeys(vehicle: VehicleQuery | MasterVehicle): Set<string> {
  const keys = new Set<string>();
  if (has(vehicle.vin)) keys.add(`V:${normalizeVin(vehicle.vin)}`);
  if (has(vehicle.plate)) keys.add(`P:${normalizePlate(vehicle.plate)}`);
  const former = (vehicle as MasterVehicle).formerPlates;
  if (Array.isArray(former)) {
    for (const entry of former) {
      if (entry.plate) keys.add(`P:${normalizePlate(entry.plate)}`);
    }
  }
  return keys;
}

export function findVehicleMatches(
  query: VehicleQuery,
  index: VehicleIndex,
  options: { excludeIds?: string[]; limit?: number } = {},
): VehicleMatchResult[] {
  const exclude = new Set(options.excludeIds ?? []);
  const queryKeys = vehicleKeys(query);
  // A make and a colour is a description of a thousand cars, not a query.
  if (queryKeys.size === 0) return [];

  const results: VehicleMatchResult[] = [];
  for (const master of Object.values(index)) {
    if (exclude.has(master.id)) continue;

    let shares = false;
    for (const key of vehicleKeys(master)) {
      if (queryKeys.has(key)) {
        shares = true;
        break;
      }
    }
    if (!shares) continue;

    const result = scoreVehicleMatch(query, master);
    if (result) results.push(result);
  }

  results.sort((a, b) => b.score - a.score);
  return options.limit ? results.slice(0, options.limit) : results;
}

/**
 * The one candidate safe to link without asking.
 *
 * Only ever a VIN. A plate is never enough on its own, however much else
 * agrees, because the cost of being wrong is somebody else's vehicle history.
 */
export function autoLinkVehicle(matches: VehicleMatchResult[]): VehicleMatchResult | null {
  const certain = matches.filter((match) => match.tier === 'certain');
  // Two certain hits means the index already holds a duplicate, which is a
  // person's problem to resolve rather than one to pick a side in.
  return certain.length === 1 ? certain[0] : null;
}

/**
 * Folding what was seen into what is on file.
 *
 * Only ever fills blanks and records a plate change; it never overwrites a
 * field that already has something in it. An officer reading a plate at
 * distance should not be able to rewrite a VIN-verified record, and the
 * moment this function starts overwriting is the moment the index stops being
 * worth reading.
 */
export function mergeObservation(
  master: MasterVehicle,
  seen: VehicleQuery,
  at: string,
): MasterVehicle {
  const next: MasterVehicle = { ...master, formerPlates: [...master.formerPlates] };
  let changed = false;

  const fill = <K extends keyof MasterVehicle>(field: K, value: string | undefined) => {
    if (has(value) && !String(master[field] ?? '').trim()) {
      (next[field] as unknown as string) = value.trim();
      changed = true;
    }
  };

  fill('vin', seen.vin);
  fill('year', seen.year);
  fill('make', seen.make);
  fill('model', seen.model);
  fill('color', seen.color);
  fill('plateState', seen.plateState);

  // A different plate on a VIN-identified car is a re-registration, which is
  // history worth keeping rather than a correction to apply silently.
  if (
    has(seen.plate) &&
    has(master.plate) &&
    normalizePlate(seen.plate) !== normalizePlate(master.plate)
  ) {
    next.formerPlates = [
      { plate: master.plate, state: master.plateState, seenUntil: at },
      ...master.formerPlates,
    ].slice(0, 12);
    next.plate = seen.plate.trim();
    next.plateState = (seen.plateState ?? '').trim() || master.plateState;
    changed = true;
  } else {
    fill('plate', seen.plate);
  }

  if (!changed) return master;
  return { ...next, updatedAt: at };
}
