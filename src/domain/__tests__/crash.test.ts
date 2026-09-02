import { describe, expect, it } from 'vitest';
import {
  canSubmitCrash,
  checkCrash,
  createCrashReport,
  createOccupant,
  createUnit,
  crashErrors,
  injuredCount,
  nextUnitNumber,
  occupantCount,
  unitLabel,
  worstInjury,
  type CrashReport,
} from '../crash';

const NARRATIVE =
  'Unit 1 was travelling north on US-411 approaching Watson Road. Unit 2 was stopped at the stop line facing east and pulled into the intersection. Unit 1 struck unit 2 in the passenger side. Both drivers remained at the scene.';

function occupant(partial = {}) {
  return createOccupant({ id: `o${Math.random()}`, masterId: 'mp-1', ...partial });
}

function unit(partial = {}) {
  const driver = occupant({ id: 'o-driver', seat: 'driver' });
  return createUnit({
    id: `u${Math.random()}`,
    number: 1,
    plate: '4AC7821',
    driverOccupantId: driver.id,
    occupants: [driver],
    contributingFactors: ['none'],
    ...partial,
  });
}

function report(partial: Partial<CrashReport> = {}): CrashReport {
  return createCrashReport({
    caseNumber: '2026-000501',
    occurredAt: '2026-03-14T21:30',
    reportedAt: '2026-03-14T21:35',
    onRoad: 'US-411',
    crossStreet: 'Watson Rd',
    manner: 'angle',
    lightCondition: 'dark_lighted',
    weather: 'clear',
    roadSurface: 'dry',
    narrative: NARRATIVE,
    units: [unit(), unit({ number: 2 })],
    ...partial,
  });
}

/* ------------------------------------------------------------------ */
/* Units                                                               */
/* ------------------------------------------------------------------ */

describe('units', () => {
  it('numbers from one, and never reuses a number', () => {
    // Units are referred to by number in the narrative and the diagram, so
    // unit 2 must always mean the same vehicle.
    expect(nextUnitNumber([])).toBe(1);
    expect(nextUnitNumber([unit({ number: 1 }), unit({ number: 3 })])).toBe(4);
  });

  it('reads the way an officer writes it', () => {
    expect(unitLabel(unit({ number: 2, year: '2011', make: 'Chevrolet', model: 'Silverado' }))).toBe(
      'Unit 2 — 2011 Chevrolet Silverado',
    );
  });

  it('falls back to the kind when there is no vehicle', () => {
    expect(unitLabel(unit({ number: 3, kind: 'pedestrian', year: '', make: '', model: '' }))).toBe(
      'Unit 3 — Pedestrian',
    );
  });

  it('counts occupants and injuries across every unit', () => {
    const r = report({
      units: [
        unit({ occupants: [occupant({ injury: 'minor' }), occupant()] }),
        unit({ number: 2, occupants: [occupant({ injury: 'none' })] }),
      ],
    });
    expect(occupantCount(r)).toBe(3);
    expect(injuredCount(r)).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Severity is derived                                                 */
/* ------------------------------------------------------------------ */

describe('crash severity', () => {
  it('is the worst injury anywhere on the report', () => {
    const r = report({
      units: [
        unit({ occupants: [occupant({ injury: 'possible' })] }),
        unit({ number: 2, occupants: [occupant({ injury: 'serious' })] }),
      ],
    });
    expect(worstInjury(r)).toBe('serious');
  });

  it('is "none" when nobody was hurt', () => {
    expect(worstInjury(report())).toBe('none');
  });

  it('refuses to let the header disagree with the occupants', () => {
    // An officer who marks a crash "minor" and records a fatality on unit 2
    // has produced a report the state rejects and — far worse — one that does
    // not trigger the response a fatality requires.
    const r = report({
      severity: 'minor',
      units: [unit({ occupants: [occupant({ injury: 'fatal', transportedTo: 'Regional' })] })],
    });
    expect(crashErrors(r).some((p) => p.field === 'severity')).toBe(true);
  });

  it('is satisfied when they agree', () => {
    const r = report({
      severity: 'serious',
      units: [
        unit({ occupants: [occupant({ injury: 'serious', transportedTo: 'Regional Medical' })] }),
        unit({ number: 2 }),
      ],
    });
    expect(crashErrors(r).some((p) => p.field === 'severity')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

describe('what a crash report must have', () => {
  it('accepts a complete two-unit crash', () => {
    expect(crashErrors(report())).toEqual([]);
    expect(canSubmitCrash(report())).toBe(true);
  });

  it('requires when it happened', () => {
    expect(crashErrors(report({ occurredAt: '' })).some((p) => p.field === 'occurredAt')).toBe(true);
  });

  it('rejects a crash that happened after it was reported', () => {
    const r = report({ occurredAt: '2026-03-15T09:00', reportedAt: '2026-03-14T21:35' });
    expect(crashErrors(r).some((p) => p.field === 'occurredAt')).toBe(true);
  });

  it('requires the road', () => {
    // Crashes are located by road and cross street, not by street number.
    expect(crashErrors(report({ onRoad: '' })).some((p) => p.field === 'onRoad')).toBe(true);
  });

  it('requires at least one unit', () => {
    expect(crashErrors(report({ units: [] })).some((p) => p.field === 'units')).toBe(true);
  });

  it('requires a narrative', () => {
    expect(crashErrors(report({ narrative: '' })).some((p) => p.field === 'narrative')).toBe(true);
  });

  it('requires a driver on a vehicle unit that has occupants', () => {
    const r = report({ units: [unit({ driverOccupantId: '' })] });
    expect(crashErrors(r).some((p) => p.field === 'driver')).toBe(true);
  });

  it('does not demand a driver on a pedestrian unit', () => {
    const r = report({
      manner: 'other',
      units: [
        unit(),
        createUnit({
          id: 'u-ped',
          number: 2,
          kind: 'pedestrian',
          contributingFactors: ['none'],
          occupants: [occupant({ seat: 'other' })],
        }),
      ],
    });
    expect(crashErrors(r).some((p) => p.field === 'driver')).toBe(false);
  });

  it('requires an identity on every occupant', () => {
    const r = report({ units: [unit({ occupants: [occupant({ id: 'x', masterId: '' })], driverOccupantId: 'x' })] });
    expect(crashErrors(r).some((p) => p.field === 'occupant')).toBe(true);
  });
});

describe('warnings that are not blockers', () => {
  const warningsOf = (r: CrashReport) => checkCrash(r).filter((p) => p.severity === 'warning');

  it('flags a missing plate and VIN without blocking', () => {
    const r = report({ units: [unit({ plate: '', vin: '' }), unit({ number: 2 })] });
    expect(warningsOf(r).some((p) => p.field === 'plate')).toBe(true);
    expect(crashErrors(r).some((p) => p.field === 'plate')).toBe(false);
  });

  it('flags one unit recorded against a two-unit manner', () => {
    const r = report({ units: [unit()], manner: 'rear_end' });
    expect(warningsOf(r).some((p) => p.field === 'manner')).toBe(true);
  });

  it('says nothing about that on a single-vehicle crash', () => {
    const r = report({ units: [unit()], manner: 'single' });
    expect(warningsOf(r).some((p) => p.field === 'manner')).toBe(false);
  });

  it('asks for a contributing factor, and takes "none" as an answer', () => {
    const blank = report({ units: [unit({ contributingFactors: [] })] });
    expect(warningsOf(blank).some((p) => p.field === 'contributingFactors')).toBe(true);
    expect(warningsOf(report()).some((p) => p.field === 'contributingFactors')).toBe(false);
  });

  it('flags a towed vehicle with nowhere recorded', () => {
    // The owner rings tomorrow asking where the car is.
    const r = report({ units: [unit({ towed: true, towedTo: '' }), unit({ number: 2 })] });
    expect(warningsOf(r).some((p) => p.field === 'towedTo')).toBe(true);
  });

  it('flags an injured occupant with no destination', () => {
    const r = report({
      severity: 'minor',
      units: [unit({ occupants: [occupant({ id: 'd', seat: 'driver', injury: 'minor' })], driverOccupantId: 'd' })],
    });
    expect(warningsOf(r).some((p) => p.field === 'transportedTo')).toBe(true);
  });

  it('flags a fatal crash with no linked incident report', () => {
    // A fatality is investigated, and in most states it is a criminal
    // investigation until ruled otherwise.
    const r = report({
      severity: 'fatal',
      units: [unit({ occupants: [occupant({ id: 'd', seat: 'driver', injury: 'fatal', transportedTo: 'Regional' })], driverOccupantId: 'd' })],
    });
    expect(warningsOf(r).some((p) => p.field === 'linkedIncidentId')).toBe(true);
  });

  it('says nothing when the fatal crash is linked', () => {
    const r = report({
      severity: 'fatal',
      linkedIncidentId: 'inc-9',
      units: [unit({ occupants: [occupant({ id: 'd', seat: 'driver', injury: 'fatal', transportedTo: 'Regional' })], driverOccupantId: 'd' })],
    });
    expect(warningsOf(r).some((p) => p.field === 'linkedIncidentId')).toBe(false);
  });

  it('lets a short narrative through as a warning, not a blocker', () => {
    const r = report({ narrative: 'Unit 1 hit unit 2.' });
    expect(warningsOf(r).some((p) => p.field === 'narrative')).toBe(true);
    expect(canSubmitCrash(r)).toBe(true);
  });
});
