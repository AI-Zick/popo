import { describe, expect, it } from 'vitest';
import {
  administrativeSegment,
  alpha,
  arresteeSegments,
  buildExport,
  dateField,
  exportFilename,
  numeric,
  numericOrBlank,
  offenderSegments,
  offenseSegments,
  propertySegments,
  victimSegments,
} from '../nibrs';
import {
  createIncident,
  createLocation,
  createMasterPerson,
  createIncidentPerson,
  createOffense,
  createProperty,
  createCharge,
} from '../factory';
import { emptyAgency, type AgencyProfile } from '../agency';
import { resolvePeople, type PersonIndex } from '../person';
import type { LocationIndex } from '../location';

const AGENCY: AgencyProfile = { ...emptyAgency(), name: 'Cedar Falls PD', ori: 'AL0010200' };

const LOCATIONS: LocationIndex = {};
function mkLocation(partial = {}) {
  const location = createLocation({ address: '100 Main St', city: 'Cedar Falls', state: 'AL', ...partial });
  LOCATIONS[location.id] = location;
  return location;
}

const PEOPLE: PersonIndex = {};
function mkPerson(role: Parameters<typeof createIncidentPerson>[0], identity = {}, involvement = {}) {
  const master = createMasterPerson(identity);
  PEOPLE[master.id] = master;
  return createIncidentPerson(role, master.id, involvement);
}

/** An incident that passes as complete for export purposes. */
function approvedIncident(partial = {}) {
  const location = mkLocation();
  return createIncident({
    caseNumber: '2026-000101',
    status: 'approved',
    occurredFrom: '2026-03-14T21:30',
    reportedAt: '2026-03-14T22:00',
    locationId: location.id,
    offenses: [createOffense({ code: '23F', locationType: '20' })],
    ...partial,
  });
}

/* ------------------------------------------------------------------ */
/* Field helpers                                                       */
/* ------------------------------------------------------------------ */

describe('field formatting', () => {
  it('pads alpha fields to the right and uppercases', () => {
    expect(alpha('ab', 5)).toBe('AB   ');
  });

  it('truncates rather than overflowing the field', () => {
    // An over-long value that runs into the next field corrupts every field
    // after it on the line, so width is enforced, not assumed.
    expect(alpha('ABCDEFGH', 3)).toBe('ABC');
    expect(alpha('ABCDEFGH', 3)).toHaveLength(3);
  });

  it('zero-pads numeric fields to the left', () => {
    expect(numeric(42, 5)).toBe('00042');
  });

  it('strips non-digits from numeric fields', () => {
    expect(numeric('$1,250.00', 6)).toBe('125000');
  });

  it('writes an absent optional number as spaces, not zeroes', () => {
    // 00 in an age field claims the person is a newborn.
    expect(numericOrBlank('', 2)).toBe('  ');
    expect(numericOrBlank(7, 2)).toBe('07');
  });

  it('writes a blank date as spaces, not zeroes', () => {
    // 00000000 is a date the receiving system will try to parse.
    expect(dateField('')).toBe('        ');
  });

  it('formats a date as YYYYMMDD', () => {
    expect(dateField('2026-03-14')).toBe('20260314');
  });

  it('treats an unparseable date as blank rather than emitting garbage', () => {
    expect(dateField('not a date')).toBe('        ');
  });
});

/* ------------------------------------------------------------------ */
/* Segments                                                            */
/* ------------------------------------------------------------------ */

describe('segments', () => {
  it('puts the level, ORI and case number at the head of every line', () => {
    const incident = approvedIncident();
    const line = administrativeSegment(incident, AGENCY, LOCATIONS[incident.locationId]).line;
    expect(line.slice(0, 1)).toBe('1');
    expect(line.slice(1, 10)).toBe('AL0010200');
    // The case number occupies a fixed 12 characters, space-padded.
    expect(line.slice(10, 22)).toBe('2026-000101 ');
  });

  it('writes one offense segment per offense', () => {
    const incident = approvedIncident({
      offenses: [createOffense({ code: '23F' }), createOffense({ code: '13A' })],
    });
    const segments = offenseSegments(incident, AGENCY);
    expect(segments).toHaveLength(2);
    expect(segments.every((s) => s.level === '2')).toBe(true);
  });

  it('writes property values as whole dollars', () => {
    const incident = approvedIncident({
      property: [createProperty({ descriptionCode: '03', lossType: 'stolen', value: '1250.75' })],
    });
    const line = propertySegments(incident, AGENCY)[0].line;
    expect(line).toContain('000001251');
  });

  it('leaves the age blank on a society victim rather than calling it zero', () => {
    const link = mkPerson('victim', {}, { victimType: 'S' });
    const incident = approvedIncident({ persons: [link] });
    const persons = resolvePeople(incident.persons, PEOPLE);
    const line = victimSegments(incident, AGENCY, persons)[0].line;
    // Age sits at 56, after the type at 55; the ORI elsewhere on the line
    // legitimately contains zeroes, so the assertion is positional.
    expect(line.slice(55, 56)).toBe('S');
    expect(line.slice(56, 58)).toBe('  ');
  });

  it('leaves premises-entered blank on an offense that is not a burglary', () => {
    const incident = approvedIncident({
      offenses: [createOffense({ code: '23F', locationType: '20' })],
    });
    const line = offenseSegments(incident, AGENCY)[0].line;
    expect(line.slice(31, 33)).toBe('  ');
  });

  it('reports an unknown offender when nobody is named', () => {
    // NIBRS still counts the crime; an incident with no offender segment at
    // all is rejected, so an "unknown" line stands in.
    const incident = approvedIncident();
    const segments = offenderSegments(incident, AGENCY, []);
    expect(segments).toHaveLength(1);
    expect(segments[0].line.startsWith('5AL0010200')).toBe(true);
  });

  it('computes a victim age from the date of birth as at the offence date', () => {
    const link = mkPerson('victim', { dob: '1990-06-01' }, { victimType: 'I' });
    const incident = approvedIncident({ persons: [link], occurredFrom: '2026-03-14T21:30' });
    const persons = resolvePeople(incident.persons, PEOPLE);
    const line = victimSegments(incident, AGENCY, persons)[0].line;
    // 35 on 14 March 2026 — the birthday has not come round yet.
    expect(line).toContain('35');
  });

  it('writes one arrestee segment per arrest and flags multiples', () => {
    const a = mkPerson('arrestee', { dob: '1990-06-01' }, {
      arrestDate: '2026-03-14',
      arrestType: 'O',
      charges: [createCharge({ statute: '13A-8-4' })],
    });
    const b = mkPerson('arrestee', { dob: '1988-01-02' }, {
      arrestDate: '2026-03-14',
      arrestType: 'O',
      charges: [createCharge({ statute: '13A-8-4' })],
    });
    const incident = approvedIncident({ persons: [a, b] });
    const persons = resolvePeople(incident.persons, PEOPLE);
    const segments = arresteeSegments(incident, AGENCY, persons);
    expect(segments).toHaveLength(2);
    expect(segments.every((s) => s.line.includes('M'))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

describe('what goes in the file', () => {
  const base = { agency: AGENCY, people: PEOPLE, locations: LOCATIONS };

  it('includes an approved report with no problems', () => {
    const incident = approvedIncident();
    const result = buildExport({ ...base, incidents: [incident], errorsByIncident: {} });
    expect(result.included).toEqual(['2026-000101']);
    expect(result.excluded).toHaveLength(0);
  });

  it('holds back a draft', () => {
    const incident = approvedIncident({ status: 'draft' });
    const result = buildExport({ ...base, incidents: [incident], errorsByIncident: {} });
    expect(result.included).toHaveLength(0);
    expect(result.excluded[0].reason).toMatch(/draft/i);
  });

  it('holds back a report still waiting on a supervisor', () => {
    const incident = approvedIncident({ status: 'pending_review' });
    const result = buildExport({ ...base, incidents: [incident], errorsByIncident: {} });
    expect(result.excluded[0].reason).toMatch(/supervisor/i);
  });

  it('holds back an approved report that still has validation errors', () => {
    // An approved report can still be wrong; the state's edit checks will
    // reject it, and a bulk rejection is far more expensive than a hold.
    const incident = approvedIncident();
    const result = buildExport({
      ...base,
      incidents: [incident],
      errorsByIncident: { [incident.id]: 2 },
    });
    expect(result.included).toHaveLength(0);
    expect(result.excluded[0].reason).toMatch(/2 unresolved/);
  });

  it('holds everything back when the agency has no ORI', () => {
    const incident = approvedIncident();
    const result = buildExport({
      ...base,
      agency: { ...AGENCY, ori: '' },
      incidents: [incident],
      errorsByIncident: {},
    });
    expect(result.included).toHaveLength(0);
    expect(result.excluded[0].reason).toMatch(/ORI/);
  });

  it('names every held-back report so none disappears quietly', () => {
    const incidents = [
      approvedIncident({ caseNumber: '2026-000201', status: 'draft' }),
      approvedIncident({ caseNumber: '2026-000202', status: 'returned' }),
      approvedIncident({ caseNumber: '2026-000203' }),
    ];
    const result = buildExport({ ...base, incidents, errorsByIncident: {} });
    expect(result.included).toEqual(['2026-000203']);
    expect(result.excluded.map((e) => e.caseNumber)).toEqual(['2026-000201', '2026-000202']);
  });

  it('produces an empty file rather than a stray newline when nothing qualifies', () => {
    const result = buildExport({
      ...base,
      incidents: [approvedIncident({ status: 'draft' })],
      errorsByIncident: {},
    });
    expect(result.content).toBe('');
    expect(result.segmentCount).toBe(0);
  });

  it('ends the file with a newline when it has content', () => {
    const result = buildExport({ ...base, incidents: [approvedIncident()], errorsByIncident: {} });
    expect(result.content.endsWith('\n')).toBe(true);
  });

  it('counts every segment written', () => {
    const link = mkPerson('victim', { dob: '1990-06-01' }, { victimType: 'I' });
    const incident = approvedIncident({
      persons: [link],
      property: [createProperty({ descriptionCode: '03', lossType: 'stolen', value: '100' })],
    });
    const result = buildExport({ ...base, incidents: [incident], errorsByIncident: {} });
    // 1 admin + 1 offense + 1 property + 1 victim + 1 unknown offender.
    expect(result.segmentCount).toBe(5);
    expect(result.content.trimEnd().split('\n')).toHaveLength(5);
  });
});

describe('file name', () => {
  it('is the ORI and the date', () => {
    expect(exportFilename(AGENCY, new Date(2026, 8, 2))).toBe('AL0010200_20260902.txt');
  });

  it('does not produce a nameless file when there is no ORI', () => {
    expect(exportFilename({ ...AGENCY, ori: '' }, new Date(2026, 8, 2))).toBe('NOORI_20260902.txt');
  });
});
