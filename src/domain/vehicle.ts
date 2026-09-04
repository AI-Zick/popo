/**
 * Master Vehicle Index.
 *
 * The same argument the Master Name Index makes about people, made about cars.
 * A vehicle appears on a crash, on three traffic stops and on a stolen report,
 * and today each of those is an unrelated blob of make-model-colour. Nobody can
 * ask the question officers actually ask — *have we seen this car before?*
 *
 * What makes vehicles different from people, and what most of this file is
 * about: **a plate is not a car.** In most states the registration follows the
 * owner, not the vehicle, so a plate moves to the next car they buy and the old
 * plate goes on somebody else's. A VIN is the car. Treating a plate hit as
 * identity is how a stolen-vehicle flag ends up on a minivan belonging to
 * somebody who has never been stopped.
 */

import type { FieldProvenance, UUID } from './person';

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

/** Vehicle fields that carry where they came from. */
export const PROVENANCED_VEHICLE_FIELDS = [
  'vin',
  'plate',
  'plateState',
  'year',
  'make',
  'model',
  'color',
  'registeredOwnerId',
] as const;

export type ProvenancedVehicleField = (typeof PROVENANCED_VEHICLE_FIELDS)[number];

export interface MasterVehicle {
  id: UUID;

  /** The identity of a car, when it is known. */
  vin: string;

  /** What is on it now. History lives in `formerPlates`. */
  plate: string;
  plateState: string;
  plateYear: string;

  /**
   * Plates seen on this vehicle before, newest first.
   *
   * Kept because "the car that had ABC-123 on it in March" is a question that
   * gets asked, and because a plate that moved is the explanation for a
   * mismatch rather than evidence of a different car.
   */
  formerPlates: { plate: string; state: string; seenUntil: string }[];

  year: string;
  make: string;
  model: string;
  style: string;
  color: string;

  /** Points into the Master Name Index. */
  registeredOwnerId: UUID | '';

  /**
   * Officer-safety flags, surfaced wherever this vehicle appears — the same
   * idea, and the same wording discipline, as the cautions on a person.
   */
  cautions: string[];

  notes: string;

  provenance: Partial<Record<ProvenancedVehicleField, FieldProvenance>>;

  /** Master ids absorbed into this record by a merge. */
  mergedFrom: UUID[];

  createdAt: string;
  updatedAt: string;
}

export type VehicleIndex = Record<UUID, MasterVehicle>;

export function createMasterVehicle(partial: Partial<MasterVehicle> = {}): MasterVehicle {
  const now = new Date().toISOString();
  return {
    id: '',
    vin: '',
    plate: '',
    plateState: '',
    plateYear: '',
    formerPlates: [],
    year: '',
    make: '',
    model: '',
    style: '',
    color: '',
    registeredOwnerId: '',
    cautions: [],
    notes: '',
    provenance: {},
    mergedFrom: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

/**
 * A VIN, as it should have been typed.
 *
 * The standard leaves I, O and Q out of the alphabet precisely because they
 * are unreadable next to 1 and 0, so any of them in a typed VIN is a
 * transcription error with exactly one sensible reading. Fixing it here means
 * a VIN copied off a windscreen at night still matches the one the DMV
 * returned.
 */
export function normalizeVin(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/[IQ]/g, '1')
    .replace(/O/g, '0');
}

/** A plate, with the decoration people put in it removed. */
export function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export const normalizeState = (value: string): string =>
  value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);

/* ------------------------------------------------------------------ */
/* The VIN check digit                                                 */
/* ------------------------------------------------------------------ */

/*
  Every VIN issued for the North American market since 1981 carries a check
  digit in position nine, computed from the other sixteen characters. It exists
  to catch exactly the two mistakes people make copying seventeen characters off
  a door jamb: a wrong character, and two characters swapped.

  Checking it is worth the forty lines because of when a wrong VIN surfaces —
  months later, when a query comes back empty on a car that is sitting in the
  impound lot.
*/

const VIN_VALUES: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export const VIN_LENGTH = 17;

export interface VinCheck {
  ok: boolean;
  /** Empty when there is nothing to say — an unchecked VIN is not an error. */
  reason: string;
  /** What position nine should hold, when that is the problem. */
  expected: string;
}

const fine: VinCheck = { ok: true, reason: '', expected: '' };

/**
 * Whether a VIN is internally consistent.
 *
 * Silent about anything it cannot judge. A seventeenth-character VIN from
 * outside North America may legitimately fail the check digit, so a failure is
 * reported as something to look at rather than something to refuse — see
 * `checkVin` in the routes, which warns and stores it anyway.
 */
export function vinCheckDigit(value: string): VinCheck {
  const vin = normalizeVin(value);
  if (!vin) return fine;
  if (vin.length !== VIN_LENGTH) {
    return {
      ok: false,
      reason: `A VIN is ${VIN_LENGTH} characters; this one is ${vin.length}.`,
      expected: '',
    };
  }

  let sum = 0;
  for (let i = 0; i < VIN_LENGTH; i += 1) {
    const character = vin[i];
    const value = /\d/.test(character) ? Number(character) : VIN_VALUES[character];
    // Normalisation has already removed I, O and Q, so an unknown character
    // here is one that cannot appear in any VIN.
    if (value === undefined) {
      return { ok: false, reason: `"${character}" cannot appear in a VIN.`, expected: '' };
    }
    sum += value * VIN_WEIGHTS[i];
  }

  const remainder = sum % 11;
  const expected = remainder === 10 ? 'X' : String(remainder);
  if (vin[8] === expected) return fine;

  return {
    ok: false,
    reason: 'That VIN does not check out — one character is probably wrong, or two are swapped.',
    expected,
  };
}

/* ------------------------------------------------------------------ */
/* Display                                                             */
/* ------------------------------------------------------------------ */

/** "2019 Toyota Camry", or the best available approximation of it. */
export function vehicleName(vehicle: Partial<MasterVehicle>): string {
  const name = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ').trim();
  return name || 'Unidentified vehicle';
}

/** "4AC-7821 (AL)", or the VIN, or nothing. */
export function vehicleTag(vehicle: Partial<MasterVehicle>): string {
  if (vehicle.plate) {
    return vehicle.plateState ? `${vehicle.plate} (${vehicle.plateState})` : vehicle.plate;
  }
  return vehicle.vin ?? '';
}

/**
 * Whether there is enough here to be a record at all.
 *
 * A colour and a make is a description, not a vehicle — filing it in the index
 * creates an entry nothing will ever match and everything will nearly match.
 */
export function isIdentifiable(vehicle: Partial<MasterVehicle>): boolean {
  return Boolean(normalizeVin(vehicle.vin ?? '') || normalizePlate(vehicle.plate ?? ''));
}
