import { describe, expect, it } from 'vitest';
import {
  applySuggestion,
  EXTRACTABLE_FIELDS,
  extractByPattern,
  isExtractableField,
  mergeFindings,
  readNarrative,
  toSuggestions,
  type Finding,
} from '../extraction';
import {
  createIncident,
  createLocation,
  createMasterPerson,
  createIncidentPerson,
  createOffense,
  createProperty,
  createVehicle,
} from '../factory';
import type { PersonIndex } from '../person';
import type { LocationIndex } from '../location';

const LOCATIONS: LocationIndex = {};
const PEOPLE: PersonIndex = {};

function mkPerson(identity = {}) {
  const master = createMasterPerson(identity);
  PEOPLE[master.id] = master;
  return master;
}

function report(narrative: string, partial = {}) {
  const location = createLocation({ address: '100 Main St', city: 'Cedar Falls', state: 'AL' });
  LOCATIONS[location.id] = location;
  return createIncident({
    caseNumber: '2026-000101',
    reportedAt: '2026-03-14T22:00',
    occurredFrom: '2026-03-14T21:30',
    locationId: location.id,
    narrative,
    ...partial,
  });
}

const find = (narrative: string, partial = {}) =>
  extractByPattern({ incident: report(narrative, partial), people: PEOPLE });

const fieldsOf = (findings: Finding[]) => findings.map((f) => f.field);

/* ------------------------------------------------------------------ */
/* Identifiers                                                         */
/* ------------------------------------------------------------------ */

describe('reading identifiers out of a narrative', () => {
  it('finds a labelled plate', () => {
    const found = find('The vehicle bore Alabama plate 4AC7821 and was parked facing north.');
    const plate = found.find((f) => f.field === 'vehicle.plate');
    expect(plate?.value).toBe('4AC7821');
    expect(plate?.confidence).toBe('high');
  });

  it('does not treat any capitalised run as a plate', () => {
    // An unlabelled alphanumeric string is not a plate, and a system that
    // guesses one teaches officers to stop reading the suggestions.
    expect(fieldsOf(find('I responded to the RESIDENCE and spoke to AB1234.'))).not.toContain(
      'vehicle.plate',
    );
  });

  it('finds a VIN by its shape', () => {
    const found = find('The VIN 3GCPKSE31BG104457 was confirmed against dispatch.');
    expect(found.find((f) => f.field === 'vehicle.vin')?.value).toBe('3GCPKSE31BG104457');
  });

  it('does not read a 17-character string containing I, O or Q as a VIN', () => {
    // Those letters are excluded from the VIN alphabet precisely because they
    // are confusable with 1 and 0.
    expect(fieldsOf(find('Reference number IOQ45678901234567 was noted.'))).not.toContain(
      'vehicle.vin',
    );
  });

  it('finds a phone number', () => {
    const found = find('She provided a callback number of (205) 555-0148 for follow-up.');
    expect(found.find((f) => f.field === 'person.phone')?.value).toBe('(205) 555-0148');
  });

  it('finds where a vehicle was towed', () => {
    const found = find("The truck was towed by Halloran's Towing and released to the owner.");
    expect(found.find((f) => f.field === 'vehicle.towedTo')?.value).toBe("Halloran's Towing");
  });

  it('finds a dollar value', () => {
    const found = find('The victim valued the laptop at $1,450 based on the original receipt.');
    expect(found.find((f) => f.field === 'property.value')?.value).toBe('1450');
  });
});

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

describe('reading times', () => {
  it('reads military time and puts it on the date already in the report', () => {
    const found = find('She left the residence at approximately 2200 hours the previous evening.');
    expect(found.find((f) => f.field === 'occurredFrom')?.value).toBe('2026-03-14T22:00');
  });

  it('treats a second time as the end of a range', () => {
    const found = find('She left at 2200 hours and returned at 0745 hours to find the door open.');
    expect(found.find((f) => f.field === 'occurredTo')?.value).toBe('2026-03-14T07:45');
  });

  it('will not guess a date when the report has none', () => {
    // A time with an invented date files the incident to the wrong day, which
    // is worse than leaving the field empty.
    const incident = report('Contact was made at 1400 hours.', {
      occurredFrom: '',
      reportedAt: '',
    });
    const found = extractByPattern({ incident, people: PEOPLE });
    expect(fieldsOf(found)).not.toContain('occurredFrom');
  });

  it('ignores a bare number that is not written as a time', () => {
    expect(fieldsOf(find('There were 2200 dollars in the register at close.'))).not.toContain(
      'occurredFrom',
    );
  });
});

/* ------------------------------------------------------------------ */
/* Language that maps to a code                                        */
/* ------------------------------------------------------------------ */

describe('method of entry', () => {
  const burglary = () => createOffense({ code: '220', locationType: '20' });

  it('reads pry marks as forced entry on a burglary', () => {
    const offense = burglary();
    const found = find('I observed fresh pry marks on the exterior frame of the rear door.', {
      offenses: [offense],
    });
    const entry = found.find((f) => f.field === 'offense.methodOfEntry');
    expect(entry?.value).toBe('F');
    expect(entry?.targetId).toBe(offense.id);
  });

  it('reads an unlocked door as entry without force', () => {
    const found = find('The rear door had been left unlocked overnight.', {
      offenses: [burglary()],
    });
    expect(found.find((f) => f.field === 'offense.methodOfEntry')?.value).toBe('N');
  });

  it('says nothing when the narrative affirms both', () => {
    // "It was left unlocked but the frame was pried" is a question for the
    // officer, not something to settle by taking whichever matched first.
    const found = find('The door had been left unlocked, though the frame appeared pried near the latch.', {
      offenses: [burglary()],
    });
    expect(fieldsOf(found)).not.toContain('offense.methodOfEntry');
  });

  it('still reads forced entry when the officer describes finding the door open', () => {
    // Real narratives read "I observed fresh pry marks ... and returned to
    // find the door standing open". The second clause describes what was
    // discovered, not how entry was made, and must not veto the first.
    const found = find(
      'I observed fresh pry marks on the frame, consistent with a flat bar, and she returned to find the rear sliding door standing open.',
      { offenses: [burglary()] },
    );
    expect(found.find((f) => f.field === 'offense.methodOfEntry')?.value).toBe('F');
  });

  it('says nothing about entry when there is no burglary on the report', () => {
    const found = find('I observed pry marks on the door frame.', {
      offenses: [createOffense({ code: '13B' })],
    });
    expect(fieldsOf(found)).not.toContain('offense.methodOfEntry');
  });
});

describe('weapons', () => {
  const assault = () => createOffense({ code: '13A', locationType: '20' });

  it('reads a named weapon to its code', () => {
    const found = find('The suspect produced a knife and held it at chest height.', {
      offenses: [assault()],
    });
    // 20 is Knife / Cutting Instrument.
    expect(found.find((f) => f.field === 'offense.weapon')?.value).toBe('20');
  });

  it('prefers the specific firearm type over "type not stated"', () => {
    // A narrative that says handgun has already told us the type; offering
    // "firearm, type not stated" alongside it is noise to dismiss.
    const found = find('He was armed with a handgun, which he pointed at the clerk.', {
      offenses: [assault()],
    });
    const weapons = found.filter((f) => f.field === 'offense.weapon').map((f) => f.value);
    expect(weapons).toContain('12');
    expect(weapons).not.toContain('11');
  });
});

describe('flags', () => {
  it('notices a domestic relationship', () => {
    const found = find('The caller stated her husband had thrown a chair across the kitchen.');
    expect(fieldsOf(found)).toContain('incident.isDomestic');
  });

  it('raises a juvenile only as something to check', () => {
    const found = find('A 14-year-old was present in the front room during the disturbance.');
    const flag = found.find((f) => f.field === 'incident.involvesJuvenile');
    expect(flag?.confidence).toBe('low');
  });
});

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

describe('people named in the narrative', () => {
  it('offers someone already in the name index but not on the report', () => {
    const master = mkPerson({ firstName: 'Dana', lastName: 'Whitfield' });
    const found = find('I made contact with Dana Whitfield in the driveway.');
    const person = found.find((f) => f.field === 'person.add' && f.value === master.id);
    expect(person).toBeDefined();
    expect(person?.confidence).toBe('medium');
  });

  it('treats a bare surname as weaker', () => {
    mkPerson({ firstName: 'Marcus', lastName: 'Ellery' });
    const found = find('Ellery stated he had been asleep at the time.');
    expect(found.find((f) => f.field === 'person.add')?.confidence).toBe('low');
  });

  it('does not offer someone already on the report', () => {
    const master = mkPerson({ firstName: 'Tomas', lastName: 'Ruiz' });
    const found = find('Tomas Ruiz was interviewed at the scene.', {
      persons: [createIncidentPerson('witness', master.id)],
    });
    expect(found.some((f) => f.field === 'person.add' && f.value === master.id)).toBe(false);
  });

  it('never invents a person who is not in the index', () => {
    // It can only ever propose people the agency already knows about.
    const found = find('I spoke with Wendell Fairbrother, who lives next door.');
    const proposed = found.filter((f) => f.field === 'person.add').map((f) => f.value);
    expect(proposed.every((id) => id in PEOPLE)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Grounding — the guard that matters                                  */
/* ------------------------------------------------------------------ */

describe('grounding suggestions in the narrative', () => {
  const incident = report('The vehicle bore plate 4AC7821 and was towed from the scene.');

  it('drops a finding whose quote is not in the narrative', () => {
    // This is the hallucination guard: a fact the narrative does not contain
    // cannot be quoted from it.
    const invented: Finding = {
      field: 'vehicle.vin',
      value: '1HGCM82633A004352',
      quote: 'the VIN was recorded as 1HGCM82633A004352',
      confidence: 'high',
    };
    expect(toSuggestions([invented], incident, PEOPLE, 'model')).toHaveLength(0);
  });

  it('keeps a finding whose quote is in the narrative', () => {
    const grounded: Finding = {
      field: 'vehicle.plate',
      value: '4AC7821',
      quote: 'plate 4AC7821',
      confidence: 'high',
    };
    const [suggestion] = toSuggestions([grounded], incident, PEOPLE, 'model');
    expect(suggestion.value).toBe('4AC7821');
    expect(suggestion.span).toEqual({ start: 17, end: 30 });
  });

  it('drops a field outside the allowlist', () => {
    // Nothing arriving over the wire can reach a field nobody chose to expose.
    const rogue = {
      field: 'status',
      value: 'approved',
      quote: 'plate 4AC7821',
      confidence: 'high',
    } as unknown as Finding;
    expect(toSuggestions([rogue], incident, PEOPLE, 'model')).toHaveLength(0);
  });

  it('drops a finding with an empty quote', () => {
    const bare: Finding = { field: 'vehicle.plate', value: 'XYZ', quote: '', confidence: 'high' };
    expect(toSuggestions([bare], incident, PEOPLE, 'model')).toHaveLength(0);
  });

  it('recognises every allowlisted field and nothing else', () => {
    expect(EXTRACTABLE_FIELDS.every(isExtractableField)).toBe(true);
    expect(isExtractableField('narrative')).toBe(false);
    expect(isExtractableField('__proto__')).toBe(false);
  });

  it('offers one suggestion for a value the narrative mentions twice', () => {
    const twice = report('Plate 4AC7821 was called in. Dispatch confirmed plate 4AC7821.');
    const plates = readNarrative(twice, PEOPLE).filter((s) => s.field === 'vehicle.plate');
    expect(plates).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Already present                                                     */
/* ------------------------------------------------------------------ */

describe('what the report already says', () => {
  it('marks a suggestion the report already carries rather than hiding it', () => {
    // Showing that the system read the narrative and agreed is worth more than
    // a list that silently shrinks.
    const incident = report('The vehicle bore plate 4AC7821.', {
      vehicles: [createVehicle({ plate: '4AC7821' })],
    });
    const plate = readNarrative(incident, PEOPLE).find((s) => s.field === 'vehicle.plate');
    expect(plate?.alreadyPresent).toBe(true);
  });

  it('sorts what is new above what is already there', () => {
    const incident = report('The vehicle bore plate 4AC7821 and VIN 3GCPKSE31BG104457.', {
      vehicles: [createVehicle({ plate: '4AC7821' })],
    });
    const suggestions = readNarrative(incident, PEOPLE);
    expect(suggestions[0].alreadyPresent).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Applying                                                            */
/* ------------------------------------------------------------------ */

describe('accepting a suggestion', () => {
  const accept = (incident: ReturnType<typeof report>, field: string) => {
    const suggestion = readNarrative(incident, PEOPLE).find((s) => s.field === field);
    expect(suggestion).toBeDefined();
    const draft = structuredClone(incident);
    const focus = applySuggestion(draft, PEOPLE, suggestion!);
    return { draft, focus, suggestion: suggestion! };
  };

  it('writes a plate onto the vehicle already on the report', () => {
    const incident = report('The vehicle bore plate 4AC7821.', {
      vehicles: [createVehicle({ make: 'Chevrolet' })],
    });
    const { draft } = accept(incident, 'vehicle.plate');
    expect(draft.vehicles).toHaveLength(1);
    expect(draft.vehicles[0].plate).toBe('4AC7821');
  });

  it('creates a vehicle when the report has none', () => {
    const incident = report('The vehicle bore plate 4AC7821.');
    const { draft } = accept(incident, 'vehicle.plate');
    expect(draft.vehicles).toHaveLength(1);
    expect(draft.vehicles[0].plate).toBe('4AC7821');
  });

  it('sets the end of the range and marks it a range', () => {
    const incident = report('She left at 2200 hours and returned at 0745 hours.');
    const { draft } = accept(incident, 'occurredTo');
    expect(draft.occurredTo).toBe('2026-03-14T07:45');
    expect(draft.occurredIsRange).toBe(true);
  });

  it('adds a named person without deciding what they were', () => {
    // The narrative naming someone says nothing about whether they were the
    // victim or the suspect. Picking one is exactly the guess this must not
    // make, so the officer is taken to the role field.
    const master = mkPerson({ firstName: 'Priya', lastName: 'Raman' });
    const incident = report('Priya Raman met me at the door.');
    const { draft, focus } = accept(incident, 'person.add');
    const added = draft.persons.find((p) => p.masterId === master.id);
    expect(added).toBeDefined();
    expect(focus).toBe(`person.${added!.id}.role`);
  });

  it('adds a weapon to the offense it was found against', () => {
    const offense = createOffense({ code: '13A' });
    const incident = report('The suspect produced a knife.', { offenses: [offense] });
    const { draft } = accept(incident, 'offense.weapon');
    expect(draft.offenses[0].weapons).toContain('20');
  });

  it('returns the field to focus, so nothing is applied out of sight', () => {
    const incident = report('The caller stated her husband had thrown a chair.');
    const { draft, focus } = accept(incident, 'incident.isDomestic');
    expect(draft.isDomestic).toBe(true);
    expect(focus).toBe('incident.isDomestic');
  });

  it('does not duplicate a weapon already on the offense', () => {
    const offense = createOffense({ code: '13A', weapons: ['20'] });
    const incident = report('The suspect produced a knife.', { offenses: [offense] });
    const { draft } = accept(incident, 'offense.weapon');
    expect(draft.offenses[0].weapons).toEqual(['20']);
  });

  it('leaves every other field alone', () => {
    // The narrowest possible change: accepting one suggestion writes one field.
    const incident = report('The vehicle bore plate 4AC7821.', {
      property: [createProperty({ descriptionCode: '03', value: '500' })],
    });
    const { draft } = accept(incident, 'vehicle.plate');
    expect(draft.narrative).toBe(incident.narrative);
    expect(draft.property).toEqual(incident.property);
    expect(draft.offenses).toEqual(incident.offenses);
  });
});

/* ------------------------------------------------------------------ */
/* Merging the two extractors                                          */
/* ------------------------------------------------------------------ */

describe('merging pattern and model findings', () => {
  const incident = report('The vehicle bore plate 4AC7821 and the door showed pry marks.', {
    offenses: [createOffense({ code: '220' })],
  });

  it('keeps the deterministic finding when both found the same thing', () => {
    // Where the two agree, the reproducible one wins.
    const merged = mergeFindings(incident, PEOPLE, [
      { field: 'vehicle.plate', value: '4AC7821', quote: 'plate 4AC7821', confidence: 'medium' },
    ]);
    const plates = merged.filter((s) => s.field === 'vehicle.plate');
    expect(plates).toHaveLength(1);
    expect(plates[0].origin).toBe('pattern');
  });

  it('keeps a model finding the patterns did not reach', () => {
    const merged = mergeFindings(incident, PEOPLE, [
      {
        field: 'offense.premisesEntered',
        value: '1',
        quote: 'the door showed pry marks',
        confidence: 'low',
      },
    ]);
    expect(merged.find((s) => s.field === 'offense.premisesEntered')?.origin).toBe('model');
  });

  it('applies grounding to model findings in a merge too', () => {
    const merged = mergeFindings(incident, PEOPLE, [
      { field: 'vehicle.vin', value: 'X', quote: 'a VIN nobody wrote', confidence: 'high' },
    ]);
    expect(merged.some((s) => s.field === 'vehicle.vin')).toBe(false);
  });
});

describe('an empty narrative', () => {
  it('produces nothing rather than failing', () => {
    expect(readNarrative(report(''), PEOPLE)).toEqual([]);
    expect(readNarrative(report('   '), PEOPLE)).toEqual([]);
  });
});
