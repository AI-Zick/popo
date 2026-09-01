import { describe, expect, it } from 'vitest';
import { runRules, type Issue } from '../engine';
import { ALL_RULES } from '../rules';
import {
  createIncident,
  createIncidentPerson,
  createMasterPerson,
  createOffense,
  createProperty,
  createVehicle,
  createCharge,
} from '@/domain/factory';
import type { Incident } from '@/domain/types';
import {
  emptyMaster,
  type IncidentPerson,
  type MasterPerson,
  type PersonIndex,
  type PersonRole,
} from '@/domain/person';

/**
 * Shared Master Name Index for the suite. Record ids are unique per call, so
 * tests cannot collide through it.
 */
const PEOPLE: PersonIndex = {};

const MASTER_KEYS = new Set(Object.keys(emptyMaster('probe')));

/**
 * Builds a participant from a flat set of fields, routing each one to the
 * master identity or the incident involvement as appropriate.
 */
function mkPerson(
  role: PersonRole,
  fields: Partial<MasterPerson & IncidentPerson> = {},
): IncidentPerson {
  const identity: Record<string, unknown> = {};
  const involvement: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (MASTER_KEYS.has(key)) identity[key] = value;
    else involvement[key] = value;
  }
  const master = createMasterPerson(identity as Partial<MasterPerson>);
  PEOPLE[master.id] = master;
  return createIncidentPerson(role, master.id, involvement as Partial<IncidentPerson>);
}

/** A report with the universally-required fields already satisfied. */
function baseIncident(partial: Partial<Incident> = {}): Incident {
  return createIncident({
    caseNumber: '2026-000001',
    reportedAt: '2026-01-10T09:00',
    occurredFrom: '2026-01-10T08:00',
    address: '100 Main St',
    city: 'Cedar Falls',
    state: 'AL',
    locationType: '20',
    reportingOfficer: 'M. Reyes',
    narrative:
      'On the above date I was dispatched to the location listed and made contact with the reporting party, who stated the following account of what occurred at the residence.',
    ...partial,
  });
}

const ruleIds = (issues: Issue[]) => issues.map((i) => i.ruleId);
const check = (incident: Incident) => runRules(incident, ALL_RULES, PEOPLE);

describe('incident-level rules', () => {
  it('requires the core fields', () => {
    const result = check(createIncident());
    expect(ruleIds(result.errors)).toEqual(
      expect.arrayContaining([
        'incident.occurredFrom',
        'incident.address',
        'incident.city',
        'incident.locationType',
        'incident.reportingOfficer',
        'offenses.none',
        'narrative.empty',
      ]),
    );
  });

  it('rejects an occurrence later than the report time', () => {
    const result = check(
      baseIncident({ reportedAt: '2026-01-10T09:00', occurredFrom: '2026-01-11T09:00' }),
    );
    expect(ruleIds(result.errors)).toContain('incident.occurredFrom.afterReported');
  });

  it('rejects a date range that ends before it starts', () => {
    const result = check(
      baseIncident({
        occurredIsRange: true,
        occurredFrom: '2026-01-10T22:00',
        occurredTo: '2026-01-10T06:00',
      }),
    );
    expect(ruleIds(result.errors)).toContain('incident.occurredTo.beforeFrom');
  });

  it('requires an arrestee when the case is cleared by arrest', () => {
    const result = check(baseIncident({ clearanceStatus: 'cleared_arrest' }));
    expect(ruleIds(result.errors)).toContain('incident.clearedByArrest.noArrestee');
  });

  it('requires a reason and date for exceptional clearance', () => {
    const result = check(baseIncident({ clearanceStatus: 'cleared_exceptional' }));
    expect(ruleIds(result.errors)).toEqual(
      expect.arrayContaining(['incident.exceptionalReason', 'incident.clearedAt']),
    );
  });
});

describe('offense-driven conditional rules', () => {
  it('requires method of entry only for burglary', () => {
    const burglary = check(
      baseIncident({ offenses: [createOffense({ code: '220', locationType: '20' })] }),
    );
    expect(ruleIds(burglary.errors)).toContain('offense.methodOfEntry');

    const larceny = check(
      baseIncident({ offenses: [createOffense({ code: '23H', locationType: '20' })] }),
    );
    expect(ruleIds(larceny.errors)).not.toContain('offense.methodOfEntry');
  });

  it('requires a weapon on aggravated assault but not on simple assault', () => {
    const agg = check(baseIncident({ offenses: [createOffense({ code: '13A', locationType: '20' })] }));
    expect(ruleIds(agg.errors)).toContain('offense.weapons');

    const simple = check(baseIncident({ offenses: [createOffense({ code: '13B', locationType: '20' })] }));
    expect(ruleIds(simple.errors)).not.toContain('offense.weapons');
  });

  it('requires criminal activity for drug offenses', () => {
    const result = check(baseIncident({ offenses: [createOffense({ code: '35A', locationType: '20' })] }));
    expect(ruleIds(result.errors)).toContain('offense.criminalActivity');
  });

  it('rejects an attempted homicide', () => {
    const result = check(
      baseIncident({
        offenses: [createOffense({ code: '09A', locationType: '20', attemptCompleted: 'A' })],
      }),
    );
    expect(ruleIds(result.errors)).toContain('offense.attempted');
  });

  it('flags the same offense listed twice', () => {
    const result = check(
      baseIncident({
        offenses: [
          createOffense({ code: '23C', locationType: '20' }),
          createOffense({ code: '23C', locationType: '20' }),
        ],
      }),
    );
    expect(ruleIds(result.warnings)).toContain('offense.duplicate');
  });
});

describe('victim rules', () => {
  it('requires an individual victim on a crime against a person', () => {
    const result = check(
      baseIncident({ offenses: [createOffense({ code: '13B', locationType: '20' })] }),
    );
    expect(ruleIds(result.errors)).toContain('persons.victim.missing');
  });

  it('rejects a business as the only victim of an assault', () => {
    const offense = createOffense({ code: '13B', locationType: '20' });
    const result = check(
      baseIncident({
        offenses: [offense],
        persons: [
          mkPerson('victim', {
            victimType: 'B',
            businessName: 'Riverside Mini Mart',
            offenseIds: [offense.id],
          }),
        ],
      }),
    );
    expect(ruleIds(result.errors)).toContain('persons.victim.notIndividual');
  });

  it('requires age, sex and race on an individual victim', () => {
    const offense = createOffense({ code: '13B', locationType: '20' });
    const result = check(
      baseIncident({
        offenses: [offense],
        persons: [
          mkPerson('victim', { lastName: 'Whitfield', victimType: 'I', offenseIds: [offense.id] }),
        ],
      }),
    );
    expect(ruleIds(result.errors)).toEqual(
      expect.arrayContaining(['person.age', 'person.sex', 'person.race']),
    );
  });

  it('requires a victim-to-offender relationship, and the quick fix resolves it', () => {
    const offense = createOffense({ code: '13B', locationType: '20' });
    const suspect = mkPerson('suspect', { lastName: 'Mercer', offenseIds: [offense.id] });
    const victim = mkPerson('victim', {
      lastName: 'Whitfield',
      victimType: 'I',
      dob: '1985-03-14',
      sex: 'F',
      race: 'W',
      injuries: ['N'],
      offenseIds: [offense.id],
    });
    const incident = baseIncident({ offenses: [offense], persons: [victim, suspect] });

    const before = check(incident);
    const issue = before.errors.find((i) => i.ruleId === 'person.relationship');
    expect(issue).toBeDefined();

    const draft = structuredClone(incident);
    const draftPeople = structuredClone(PEOPLE);
    issue!.quickFix!.apply(draft, draftPeople);
    expect(ruleIds(runRules(draft, ALL_RULES, draftPeople).errors)).not.toContain(
      'person.relationship',
    );
  });

  it('rejects a homicide victim marked as uninjured', () => {
    const offense = createOffense({ code: '09A', locationType: '20', weapons: ['12'] });
    const result = check(
      baseIncident({
        offenses: [offense],
        persons: [
          mkPerson('victim', {
            lastName: 'Doe',
            victimType: 'I',
            dob: '1980-01-01',
            sex: 'M',
            race: 'W',
            injuries: ['N'],
            offenseIds: [offense.id],
          }),
        ],
      }),
    );
    expect(ruleIds(result.errors)).toContain('person.homicideInjury');
  });

  it('warns when a victimless offense carries an individual victim', () => {
    const offense = createOffense({ code: '90D', locationType: '13' });
    const result = check(
      baseIncident({
        offenses: [offense],
        persons: [
          mkPerson('victim', {
            lastName: 'Doe',
            victimType: 'I',
            dob: '1980-01-01',
            sex: 'M',
            race: 'W',
            offenseIds: [offense.id],
          }),
        ],
      }),
    );
    expect(ruleIds(result.warnings)).toContain('persons.societyVictim');
  });
});

describe('arrestee rules', () => {
  it('requires arrest date, type and at least one charge', () => {
    const offense = createOffense({ code: '90Z', locationType: '20' });
    const result = check(
      baseIncident({
        offenses: [offense],
        persons: [mkPerson('arrestee', { lastName: 'Mercer', offenseIds: [offense.id] })],
      }),
    );
    expect(ruleIds(result.errors)).toEqual(
      expect.arrayContaining(['person.arrestDate', 'person.arrestType', 'person.charges']),
    );
  });

  it('accepts a fully populated arrestee', () => {
    const offense = createOffense({ code: '90Z', locationType: '20' });
    const result = check(
      baseIncident({
        offenses: [offense],
        persons: [
          mkPerson('arrestee', {
            lastName: 'Mercer',
            arrestDate: '2026-01-10',
            arrestType: 'O',
            charges: [createCharge({ statute: '13A-1-1', description: 'Test' })],
            offenseIds: [offense.id],
          }),
        ],
      }),
    );
    expect(ruleIds(result.errors)).not.toEqual(
      expect.arrayContaining(['person.arrestDate', 'person.arrestType', 'person.charges']),
    );
  });
});

describe('property rules', () => {
  it('requires a property record on a theft', () => {
    const result = check(
      baseIncident({ offenses: [createOffense({ code: '23H', locationType: '20' })] }),
    );
    expect(ruleIds(result.errors)).toContain('property.missing');
  });

  it('requires a dollar value on stolen property for a theft', () => {
    const result = check(
      baseIncident({
        offenses: [createOffense({ code: '23H', locationType: '20' })],
        property: [createProperty({ lossType: 'stolen', descriptionCode: '16' })],
      }),
    );
    expect(ruleIds(result.errors)).toContain('property.value');
  });

  it('rejects a structure marked as stolen', () => {
    const result = check(
      baseIncident({
        offenses: [createOffense({ code: '220', locationType: '20', methodOfEntry: 'F' })],
        property: [createProperty({ lossType: 'stolen', descriptionCode: '29' })],
      }),
    );
    expect(ruleIds(result.errors)).toContain('property.structureStolen');
  });

  it('requires drug type, quantity and unit on seized narcotics', () => {
    const result = check(
      baseIncident({
        offenses: [createOffense({ code: '35A', locationType: '20', criminalActivity: ['P'] })],
        property: [createProperty({ lossType: 'seized', descriptionCode: '10' })],
      }),
    );
    expect(ruleIds(result.errors)).toEqual(
      expect.arrayContaining(['property.drugType', 'property.drugQuantity', 'property.drugMeasurement']),
    );
  });

  it('requires burned property on an arson', () => {
    const result = check(
      baseIncident({
        offenses: [createOffense({ code: '200', locationType: '20' })],
        property: [createProperty({ lossType: 'destroyed', descriptionCode: '29', value: '5000' })],
      }),
    );
    expect(ruleIds(result.errors)).toContain('property.damageLossType');
  });
});

describe('vehicle rules', () => {
  it('requires a vehicle record on a motor vehicle theft', () => {
    const result = check(
      baseIncident({ offenses: [createOffense({ code: '240', locationType: '18' })] }),
    );
    expect(ruleIds(result.errors)).toContain('vehicles.missing');
  });

  it('flags a VIN of the wrong length or with excluded letters', () => {
    const result = check(
      baseIncident({
        offenses: [createOffense({ code: '90Z', locationType: '20' })],
        vehicles: [createVehicle({ involvement: 'suspect', vin: '1G1IO5S53F7123456', plate: 'ABC123', plateState: 'AL' })],
      }),
    );
    expect(ruleIds(result.warnings)).toContain('vehicle.vin');
  });

  it('requires a tow destination for a towed vehicle', () => {
    const result = check(
      baseIncident({
        offenses: [createOffense({ code: '90Z', locationType: '20' })],
        vehicles: [createVehicle({ involvement: 'towed', plate: 'ABC123', plateState: 'AL' })],
      }),
    );
    expect(ruleIds(result.errors)).toContain('vehicle.towedTo');
  });
});

describe('quick fixes', () => {
  it('each quick fix resolves the issue it is attached to', () => {
    // A report engineered to surface a broad spread of fixable issues.
    const offense = createOffense({ code: '240', locationType: '' });
    const incident = baseIncident({ offenses: [offense], isHateCrime: false });

    const withFixes = check(incident).issues.filter((i) => i.quickFix);
    expect(withFixes.length).toBeGreaterThan(0);

    for (const issue of withFixes) {
      const draft = structuredClone(incident);
      const draftPeople = structuredClone(PEOPLE);
      issue.quickFix!.apply(draft, draftPeople);
      const after = runRules(draft, ALL_RULES, draftPeople).issues.map((i) => i.key);
      expect(after, `quick fix "${issue.quickFix!.label}" did not clear ${issue.key}`).not.toContain(
        issue.key,
      );
    }
  });
});

describe('result shape', () => {
  it('blocks submission while errors exist and allows it once clear', () => {
    expect(check(createIncident()).canSubmit).toBe(false);

    const offense = createOffense({ code: '90Z', locationType: '20' });
    const clean = baseIncident({ offenses: [offense] });
    expect(check(clean).canSubmit).toBe(true);
  });

  it('groups issues by section and by field path', () => {
    const result = check(createIncident());
    expect(result.bySection.incident.length).toBeGreaterThan(0);
    expect(result.byPath.get('incident.address')).toHaveLength(1);
  });
});
