import { describe, expect, it } from 'vitest';
import { buildIndex, groupResults, KIND_ORDER, queryTerms, search, tokenize, type IndexInput } from '../search';
import { createIncident, createIncidentPerson, createLocation, createMasterPerson, createNote, createOffense, createVehicle } from '../factory';
import { createCrashReport, createUnit } from '../crash';
import type { PersonIndex } from '../person';
import type { LocationIndex } from '../location';
import { createMasterVehicle } from '../vehicle';

const whitfield = createMasterPerson({
  id: 'mp-1',
  lastName: 'Whitfield',
  firstName: 'Dana',
  middleName: 'Marie',
  dob: '1985-03-14',
  sex: 'F',
  address: '1142 Ashwood Ln',
  city: 'Cedar Falls',
  driverLicense: 'AL7729140',
  phone: '(205) 555-0148',
  ssn: '123-45-6789',
  cautions: ['Registered firearm owner'],
});

const mercer = createMasterPerson({
  id: 'mp-2',
  lastName: 'Mercer',
  firstName: 'Travis',
  dob: '1994-07-22',
  address: '88 Depot St',
  city: 'Cedar Falls',
  aliases: ['Trav Mercer'],
});

const storage = createLocation({
  id: 'loc-1',
  commonName: 'Marion Street Self Storage',
  aliases: ['the storage place on Marion'],
  address: '612 N Marion St',
  city: 'Cedar Falls',
  beat: '1A',
  notes: [
    createNote({ id: 'n1', kind: 'access', text: 'Police gate code 4417#', sensitive: true }),
    createNote({ id: 'n2', kind: 'hazard', text: 'Aisle lighting between C and D has been out since spring.' }),
  ],
});

const ashwood = createLocation({
  id: 'loc-2',
  address: '1142 Ashwood Ln',
  city: 'Cedar Falls',
  beat: '3B',
});

const burglary = createIncident({
  id: 'inc-1',
  caseNumber: '2026-000418',
  locationId: 'loc-2',
  reportingOfficer: 'M. Reyes',
  offenses: [createOffense({ code: '220', statute: '13A-7-6' })],
  persons: [createIncidentPerson('victim', 'mp-1')],
  vehicles: [createVehicle({ id: 'veh-1', plate: '4AC-7821', plateState: 'AL', vin: '3GCPKSE31BG104457', year: '2011', make: 'Chevrolet', model: 'Silverado' })],
  narrative: 'Pry marks were observed on the rear sliding door frame.',
});

const crash = createCrashReport({
  id: 'crash-1',
  caseNumber: '2026-C00001',
  callNumber: 'CF-2026-0417',
  onRoad: 'US-411',
  crossStreet: 'Watson Rd',
  reportingOfficer: 'M. Reyes',
  units: [createUnit({ id: 'u1', number: 1, plate: 'JHK4402', year: '2018', make: 'Nissan', model: 'Altima' })],
});

const PEOPLE: PersonIndex = { 'mp-1': whitfield, 'mp-2': mercer };
const LOCATIONS: LocationIndex = { 'loc-1': storage, 'loc-2': ashwood };
const INPUT: IndexInput = { people: PEOPLE, locations: LOCATIONS, incidents: [burglary], crashes: [crash] };

const index = buildIndex(INPUT);
const find = (q: string) => search(index, q);
const keys = (q: string) => find(q).map((r) => r.key);

/* ------------------------------------------------------------------ */
/* Tokenizing                                                          */
/* ------------------------------------------------------------------ */

describe('tokenizing', () => {
  it('splits on punctuation', () => {
    expect(tokenize('Dana Whitfield')).toEqual(['dana', 'whitfield']);
  });

  it('keeps the joined form too, so a plate matches typed either way', () => {
    // An officer types 4AC-7821 or 4AC7821 and neither should miss.
    expect(tokenize('4AC-7821')).toContain('4ac');
    expect(tokenize('4AC-7821')).toContain('7821');
    expect(tokenize('4AC-7821')).toContain('4ac7821');
  });

  it('does not duplicate when there is nothing to join', () => {
    expect(tokenize('mercer')).toEqual(['mercer']);
  });

  it('copes with empty and punctuation-only input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('  --  ')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Finding people                                                      */
/* ------------------------------------------------------------------ */

describe('finding people', () => {
  it('finds a surname', () => {
    expect(keys('whitfield')).toContain('person:mp-1');
  });

  it('finds a partial surname as you type it', () => {
    expect(keys('whit')).toContain('person:mp-1');
    expect(keys('w')).toContain('person:mp-1');
  });

  it('narrows as more words are typed rather than widening', () => {
    // Two words must mean "both", or a two-word search is useless on a big
    // index.
    expect(keys('dana whitfield')).toContain('person:mp-1');
    expect(keys('travis whitfield')).not.toContain('person:mp-1');
  });

  it('finds an alias', () => {
    expect(keys('trav')).toContain('person:mp-2');
  });

  it('finds a driver licence number', () => {
    expect(keys('AL7729140')).toContain('person:mp-1');
  });

  it('finds by address', () => {
    expect(keys('ashwood')).toContain('person:mp-1');
  });

  it('never finds anybody by their social security number', () => {
    // It is not in the token list at all. Being able to reverse-look-up a
    // person from fragments of an SSN is not a feature.
    expect(keys('123456789')).toEqual([]);
    expect(keys('6789')).toEqual([]);
  });

  it('carries officer-safety cautions onto the result', () => {
    // This is why somebody searched a name at 2am.
    const hit = find('whitfield').find((r) => r.kind === 'person');
    expect(hit?.cautions).toContain('Registered firearm owner');
  });
});

/* ------------------------------------------------------------------ */
/* Places, plates, reports                                             */
/* ------------------------------------------------------------------ */

describe('finding places', () => {
  it('finds a common name', () => {
    expect(keys('marion storage')).toContain('location:loc-1');
  });

  it('finds an alias people actually say', () => {
    expect(keys('storage place')).toContain('location:loc-1');
  });

  it('surfaces a hazard note on the result', () => {
    const hit = find('marion street').find((r) => r.kind === 'location');
    expect(hit?.cautions[0]).toMatch(/lighting/);
  });

  it('never matches a restricted note', () => {
    // A gate code must not be findable by typing it.
    expect(keys('4417')).not.toContain('location:loc-1');
  });
});

describe('query terms are not index terms', () => {
  it('treats a punctuated identifier as one term', () => {
    // Splitting 4AC-7821 into "4ac" AND "7821" fails against a plate stored as
    // 4AC7821, which indexes as a single token.
    expect(queryTerms('4AC-7821')).toEqual(['4ac7821']);
    expect(queryTerms('2026-000418')).toEqual(['2026000418']);
  });

  it('keeps a multi-word query split', () => {
    expect(queryTerms('dana whitfield')).toEqual(['dana', 'whitfield']);
  });

  it('indexes generously so any fragment still finds the record', () => {
    expect(tokenize('2026-000418')).toEqual(['2026', '000418', '2026000418']);
  });

  it('is empty for an empty query', () => {
    expect(queryTerms('  ')).toEqual([]);
  });
});

describe('finding vehicles', () => {
  /*
    A vehicle written on a report is found *through the report*. It is not a
    vehicle of record until somebody puts it in the index, and giving it a row
    under "Vehicles" that opened a report put two different kinds of thing
    under one heading — an officer running a plate could not tell from looking
    which rows opened a car and which opened a burglary.
  */
  it('finds a plate written with a dash', () => {
    expect(keys('4AC7821')).toContain('incident:inc-1');
  });

  it('finds a plate written without one', () => {
    expect(keys('4AC-7821')).toContain('incident:inc-1');
  });

  it('finds a plate stored unpunctuated when it is typed with a dash', () => {
    // The seed stores JHK4402; an officer reading it off a screen may type
    // JHK-4402, and the two must behave identically.
    expect(keys('JHK-4402')).toContain('crash:crash-1');
  });

  it('finds a case number typed in part', () => {
    expect(keys('000418')).toContain('incident:inc-1');
  });

  it('finds a VIN', () => {
    expect(keys('3GCPKSE31BG104457')).toContain('incident:inc-1');
  });

  it('finds a vehicle on a crash unit', () => {
    expect(keys('JHK4402')).toContain('crash:crash-1');
  });

  it('says it is opening a report, because that is what it opens', () => {
    const hit = find('4AC7821').find((r) => r.target.id === 'inc-1');
    expect(hit?.kind).toBe('incident');
    expect(hit?.target).toEqual({ kind: 'incident', id: 'inc-1' });
  });

  /*
    A vehicle in the index is its own row, and opens its own record. The plate
    it used to carry is indexed too — running an old plate and being told
    nothing is the failure the index exists to prevent.
  */
  it('finds a vehicle of record, and opens the vehicle', () => {
    const index = buildIndex({
      people: {},
      locations: {},
      incidents: [],
      crashes: [],
      vehicles: {
        v1: createMasterVehicle({
          id: 'v1',
          vin: '1HGCM82633A004352',
          plate: 'NEW999',
          plateState: 'AL',
          year: '2019',
          make: 'Toyota',
          model: 'Camry',
          formerPlates: [{ plate: '4AC7821', state: 'AL', seenUntil: '2026-03-02' }],
        }),
      },
    });
    const byPlate = search(index, 'NEW999');
    expect(byPlate[0].target).toEqual({ kind: 'vehicle', id: 'v1' });
    expect(byPlate[0].title).toBe('2019 Toyota Camry');

    expect(search(index, '4AC7821')[0]?.target).toEqual({ kind: 'vehicle', id: 'v1' });
    expect(search(index, '1HGCM82633A004352')[0]?.target).toEqual({ kind: 'vehicle', id: 'v1' });
  });
});

describe('finding reports', () => {
  it('finds a case number', () => {
    expect(keys('2026-000418')).toContain('incident:inc-1');
  });

  it('finds a report by somebody on it', () => {
    // "The Whitfield burglary" has to work.
    expect(keys('whitfield')).toContain('incident:inc-1');
  });

  it('finds a report by offense', () => {
    expect(keys('burglary')).toContain('incident:inc-1');
  });

  it('finds words in a narrative, at low weight', () => {
    expect(keys('pry')).toContain('incident:inc-1');
  });

  it('finds a crash by its dispatch call number', () => {
    expect(keys('CF-2026-0417')).toContain('crash:crash-1');
  });

  it('finds a crash by the road it happened on', () => {
    expect(keys('watson')).toContain('crash:crash-1');
  });
});

/* ------------------------------------------------------------------ */
/* Ranking and shape                                                   */
/* ------------------------------------------------------------------ */

describe('ranking', () => {
  it('puts the person above a report that merely mentions them', () => {
    // A name is what a name search is for.
    const results = find('whitfield');
    const person = results.findIndex((r) => r.kind === 'person');
    const incident = results.findIndex((r) => r.kind === 'incident');
    expect(person).toBeLessThan(incident);
  });

  it('scores an exact hit above a prefix hit', () => {
    const exact = find('mercer').find((r) => r.key === 'person:mp-2')!;
    const prefix = find('merc').find((r) => r.key === 'person:mp-2')!;
    expect(exact.score).toBeGreaterThan(prefix.score);
  });

  it('returns nothing for an empty query rather than everything', () => {
    expect(find('')).toEqual([]);
    expect(find('   ')).toEqual([]);
  });

  it('returns nothing for a term nobody has', () => {
    expect(find('zzzzqqq')).toEqual([]);
  });

  it('respects the result limit', () => {
    expect(search(index, 'cedar', 2)).toHaveLength(2);
  });
});

describe('grouping for display', () => {
  it('groups by kind in a stable order', () => {
    const groups = groupResults(find('whitfield'));
    const order = groups.map((g) => g.kind);
    expect(order).toEqual(KIND_ORDER.filter((k) => order.includes(k)));
  });

  it('leaves out groups with nothing in them', () => {
    expect(groupResults(find('4AC7821')).every((g) => g.results.length > 0)).toBe(true);
  });
});

describe('the index itself', () => {
  it('covers every entity kind', () => {
    // 2 people + 2 locations + 1 incident + 1 crash. The vehicle on that
    // incident is findable through it rather than as a row of its own.
    expect(index.size).toBe(6);
  });

  it('builds postings so a keystroke is a lookup, not a scan', () => {
    expect(index.postings.get('whitfield')).toBeDefined();
    expect(index.postings.get('whitfield')!.length).toBeGreaterThan(0);
  });

  it('handles an empty agency without falling over', () => {
    const empty = buildIndex({ people: {}, locations: {}, incidents: [], crashes: [] });
    expect(empty.size).toBe(0);
    expect(search(empty, 'anything')).toEqual([]);
  });
});
