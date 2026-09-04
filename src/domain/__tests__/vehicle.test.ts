import { describe, expect, it } from 'vitest';
import {
  createMasterVehicle,
  isIdentifiable,
  normalizePlate,
  normalizeVin,
  vehicleName,
  vehicleTag,
  vinCheckDigit,
} from '../vehicle';
import {
  autoLinkVehicle,
  findVehicleMatches,
  mergeObservation,
  scoreVehicleMatch,
} from '../vehicleMatching';
import type { MasterVehicle, VehicleIndex } from '../vehicle';

const vehicle = (partial: Partial<MasterVehicle>): MasterVehicle =>
  createMasterVehicle({ id: partial.plate || partial.vin || 'v1', ...partial });

const index = (...list: MasterVehicle[]): VehicleIndex =>
  Object.fromEntries(list.map((v) => [v.id, v]));

describe('normalising what somebody typed', () => {
  it('reads a VIN the way the standard means it to be read', () => {
    // I, O and Q are not in the VIN alphabet, so any of them is a misread.
    expect(normalizeVin('1hgcm82633a0043 52')).toBe('1HGCM82633A004352');
    expect(normalizeVin('1HGCM8263IA004352')).toBe('1HGCM82631A004352');
    expect(normalizeVin('1HGCM8263OA004352')).toBe('1HGCM82630A004352');
    expect(normalizeVin('1HGCM8263QA004352')).toBe('1HGCM82631A004352');
  });

  it('strips the decoration people put in a plate', () => {
    expect(normalizePlate('4ac-7821')).toBe('4AC7821');
    expect(normalizePlate('4AC 7821')).toBe('4AC7821');
  });
});

/*
  The check digit is the one piece of arithmetic in this file that has a right
  answer independent of anything I wrote, so the VINs below are real ones whose
  ninth character can be recomputed by hand from the published weights.
*/
describe('the VIN check digit', () => {
  it.each([
    '1HGCM82633A004352',
    '1M8GDM9AXKP042788',
    '11111111111111111',
    '5YJ3E1EA6PF384836',
  ])('accepts %s', (vin) => {
    expect(vinCheckDigit(vin).ok).toBe(true);
  });

  it('catches a single wrong character', () => {
    const check = vinCheckDigit('1HGCM82633A004353');
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/does not check out/);
  });

  it('catches two characters swapped, which is the other mistake people make', () => {
    // 43 52 becomes 45 32 at the end of a valid VIN.
    expect(vinCheckDigit('1HGCM82633A004532').ok).toBe(false);
  });

  it('says what position nine should have been', () => {
    expect(vinCheckDigit('1HGCM82613A004352').expected).toBe('3');
  });

  it('says so plainly when the length is wrong', () => {
    expect(vinCheckDigit('1HGCM8263').reason).toMatch(/17 characters; this one is 9/);
  });

  it('has nothing to say about an empty VIN', () => {
    expect(vinCheckDigit('')).toEqual({ ok: true, reason: '', expected: '' });
  });
});

describe('what counts as a vehicle worth filing', () => {
  it('needs a VIN or a plate', () => {
    expect(isIdentifiable({ make: 'Toyota', color: 'Silver' })).toBe(false);
    expect(isIdentifiable({ plate: '4AC7821' })).toBe(true);
    expect(isIdentifiable({ vin: '1HGCM82633A004352' })).toBe(true);
  });

  it('names itself from whatever it has', () => {
    expect(vehicleName({ year: '2019', make: 'Toyota', model: 'Camry' })).toBe('2019 Toyota Camry');
    expect(vehicleName({ make: 'Toyota' })).toBe('Toyota');
    expect(vehicleName({})).toBe('Unidentified vehicle');
    expect(vehicleTag({ plate: '4AC7821', plateState: 'AL' })).toBe('4AC7821 (AL)');
    expect(vehicleTag({ vin: 'X' })).toBe('X');
  });
});

describe('matching one vehicle to another', () => {
  const camry = vehicle({
    id: 'camry',
    vin: '1HGCM82633A004352',
    plate: '4AC7821',
    plateState: 'AL',
    year: '2019',
    make: 'Toyota',
    model: 'Camry',
    color: 'Silver',
  });

  it('links on a VIN and nothing else', () => {
    const result = scoreVehicleMatch({ vin: '1hgcm82633a004352' }, camry);
    expect(result?.tier).toBe('certain');
    expect(result?.reasons).toContain('Same VIN');
  });

  it('treats two different VINs as two cars, whatever else agrees', () => {
    const result = scoreVehicleMatch(
      {
        vin: '1M8GDM9AXKP042788',
        plate: '4AC7821',
        plateState: 'AL',
        year: '2019',
        make: 'Toyota',
        model: 'Camry',
        color: 'Silver',
      },
      camry,
    );
    expect(result).toBeNull();
  });

  /*
    The rule the whole module exists for. A plate is a registration, not a car,
    and in most states it follows the owner to their next vehicle.
  */
  it('never links on a plate alone, however much agrees', () => {
    const result = scoreVehicleMatch(
      { plate: '4AC-7821', plateState: 'AL', year: '2019', make: 'Toyota', model: 'Camry' },
      camry,
    );
    expect(result?.tier).toBe('strong');
    expect(result?.tier).not.toBe('certain');
  });

  it('calls a plate that is on the car today a strong hit on its own', () => {
    // What an officer running a plate gets back. Strong, never certain.
    const result = scoreVehicleMatch({ plate: '4AC-7821', plateState: 'AL' }, camry);
    expect(result?.tier).toBe('strong');
  });

  it('is more cautious about a plate with no state to check it against', () => {
    expect(scoreVehicleMatch({ plate: '4AC7821' }, camry)?.tier).toBe('possible');
  });

  it('treats a plate the car used to wear as worth a look, not a match', () => {
    const moved = vehicle({
      id: 'moved',
      plate: 'NEW999',
      plateState: 'AL',
      formerPlates: [{ plate: '4AC7821', state: 'AL', seenUntil: '2026-03-02' }],
    });
    const result = scoreVehicleMatch({ plate: '4AC7821', plateState: 'AL' }, moved);
    expect(result?.tier).toBe('possible');
    expect(result?.reasons.join(' ')).toMatch(/Carried 4AC7821 \(AL\) until 2026-03-02/);
  });

  it('reads a plate hit on a different car as a plate that moved', () => {
    const result = scoreVehicleMatch(
      { plate: '4AC7821', plateState: 'AL', year: '2012', make: 'Ford', model: 'F-150' },
      camry,
    );
    expect(result?.tier).toBe('possible');
    expect(result?.conflicts.join(' ')).toMatch(/plates move between vehicles/);
  });

  it('does not confuse the same characters registered in two states', () => {
    const result = scoreVehicleMatch({ plate: '4AC7821', plateState: 'GA' }, camry);
    expect(result?.tier).toBe('possible');
    expect(result?.conflicts.join(' ')).toMatch(/registered in AL, not GA/);
  });

  it('forgives a model year one out, because officers judge it by eye', () => {
    const near = scoreVehicleMatch({ plate: '4AC7821', plateState: 'AL', year: '2020' }, camry);
    const far = scoreVehicleMatch({ plate: '4AC7821', plateState: 'AL', year: '2009' }, camry);
    expect(near!.score).toBeGreaterThan(far!.score);
    expect(far!.conflicts.join(' ')).toMatch(/Model year/);
  });

  it('accepts the short name people actually say for a make', () => {
    const chevy = vehicle({ id: 'c', plate: 'AAA111', make: 'Chevrolet', model: 'Malibu' });
    expect(scoreVehicleMatch({ plate: 'AAA111', make: 'Chevy' }, chevy)?.reasons).toContain(
      'Same make',
    );
  });

  it('finds a car by a plate it used to wear', () => {
    const moved = vehicle({
      id: 'moved',
      vin: '1HGCM82633A004352',
      plate: 'NEW999',
      plateState: 'AL',
      formerPlates: [{ plate: '4AC7821', state: 'AL', seenUntil: '2026-01-01' }],
    });
    const matches = findVehicleMatches({ plate: '4AC7821', plateState: 'AL' }, index(moved));
    expect(matches).toHaveLength(1);
    expect(matches[0].master.id).toBe('moved');
  });

  it('has nothing to say about a description with no identifier in it', () => {
    expect(findVehicleMatches({ make: 'Toyota', color: 'Silver' }, index(camry))).toEqual([]);
  });

  it('never surfaces a conflict-free candidate below the floor, but always a conflicted one', () => {
    const thin = vehicle({ id: 'thin', plate: '4AC7821', make: 'Ford', model: 'F-150' });
    const matches = findVehicleMatches({ plate: '4AC7821', make: 'Ford', model: 'F-150' }, index(thin));
    expect(matches.length).toBeGreaterThan(0);
  });
});

describe('linking without asking', () => {
  const a = vehicle({ id: 'a', vin: '1HGCM82633A004352' });
  const b = vehicle({ id: 'b', vin: '1HGCM82633A004352' });

  it('links a lone VIN hit', () => {
    const matches = findVehicleMatches({ vin: '1HGCM82633A004352' }, index(a));
    expect(autoLinkVehicle(matches)?.master.id).toBe('a');
  });

  it('refuses when the index already holds two of the same VIN', () => {
    const matches = findVehicleMatches({ vin: '1HGCM82633A004352' }, index(a, b));
    expect(autoLinkVehicle(matches)).toBeNull();
  });

  it('never links on a plate, even a perfect one', () => {
    const plated = vehicle({ id: 'p', plate: '4AC7821', plateState: 'AL', make: 'Toyota', model: 'Camry', year: '2019' });
    const matches = findVehicleMatches(
      { plate: '4AC7821', plateState: 'AL', make: 'Toyota', model: 'Camry', year: '2019' },
      index(plated),
    );
    expect(matches[0].tier).toBe('strong');
    expect(autoLinkVehicle(matches)).toBeNull();
  });
});

describe('folding an observation into the record', () => {
  const known = vehicle({
    id: 'k',
    vin: '1HGCM82633A004352',
    plate: '4AC7821',
    plateState: 'AL',
    make: 'Toyota',
    model: 'Camry',
    year: '2019',
    color: 'Silver',
  });

  it('fills in what was blank', () => {
    const sparse = vehicle({ id: 's', vin: '1HGCM82633A004352' });
    const merged = mergeObservation(sparse, { make: 'Toyota', color: 'Silver' }, '2026-09-04T00:00:00Z');
    expect(merged.make).toBe('Toyota');
    expect(merged.color).toBe('Silver');
  });

  it('never overwrites something already on file', () => {
    const merged = mergeObservation(known, { make: 'Honda', color: 'Grey' }, '2026-09-04T00:00:00Z');
    expect(merged.make).toBe('Toyota');
    expect(merged.color).toBe('Silver');
  });

  it('records a new plate as a re-registration and keeps the old one', () => {
    const merged = mergeObservation(known, { plate: 'NEW999', plateState: 'AL' }, '2026-09-04T00:00:00Z');
    expect(merged.plate).toBe('NEW999');
    expect(merged.formerPlates[0]).toEqual({ plate: '4AC7821', state: 'AL', seenUntil: '2026-09-04T00:00:00Z' });
  });

  it('returns the same object when there is nothing to add', () => {
    expect(mergeObservation(known, { make: 'Toyota' }, '2026-09-04T00:00:00Z')).toBe(known);
  });

  it('does not grow the plate history without limit', () => {
    let current = known;
    for (let i = 0; i < 20; i += 1) {
      current = mergeObservation(current, { plate: `P${i}0000`, plateState: 'AL' }, '2026-09-04T00:00:00Z');
    }
    expect(current.formerPlates.length).toBeLessThanOrEqual(12);
    expect(current.plate).toBe('P190000');
  });
});
