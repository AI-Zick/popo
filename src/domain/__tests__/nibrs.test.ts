import { describe, expect, it } from 'vitest';
import {
  administrativeValues,
  alpha,
  arresteeValues,
  buildExport,
  columnMap,
  dateField,
  escapeXml,
  exportFilename,
  layoutWidth,
  numeric,
  numericOrBlank,
  offenderValues,
  offenseValues,
  profileFor,
  propertyValues,
  renderSegment,
  requiredFieldRules,
  victimValues,
  NATIONAL,
  NEW_HAMPSHIRE,
  SOUTH_CAROLINA,
} from '../nibrs';
import {
  createIncident,
  createLocation,
  createMasterPerson,
  createIncidentPerson,
  createOffense,
  createProperty,
} from '../factory';
import { emptyAgency, type AgencyProfile } from '../agency';
import { resolvePeople, type PersonIndex } from '../person';
import { runRules } from '@/validation/engine';
import type { LocationIndex } from '../location';

const AGENCY: AgencyProfile = {
  ...emptyAgency(),
  name: 'Cedar Falls PD',
  ori: 'AL0010200',
  state: 'AL',
};

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

function approvedIncident(partial = {}) {
  const location = mkLocation();
  return createIncident({
    caseNumber: '2026-000101',
    status: 'approved',
    occurredFrom: '2026-03-14T21:30',
    reportedAt: '2026-03-14T22:00',
    locationId: location.id,
    offenses: [createOffense({ code: '23F', locationType: '20', statute: '16-13-30' })],
    ...partial,
  });
}

/* ------------------------------------------------------------------ */
/* Field formatting                                                    */
/* ------------------------------------------------------------------ */

describe('field formatting', () => {
  it('pads alpha fields to the right and uppercases', () => {
    expect(alpha('ab', 5)).toBe('AB   ');
  });

  it('truncates rather than overflowing the field', () => {
    // An over-long value that runs into the next field corrupts every field
    // after it on the line, so width is enforced, not assumed.
    expect(alpha('ABCDEFGH', 3)).toBe('ABC');
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
/* The renderer                                                        */
/* ------------------------------------------------------------------ */

describe('rendering a layout', () => {
  const layout = [
    { field: 'a', width: 3 },
    { field: 'b', width: 2, type: 'numericOrBlank' as const },
    { field: 'c', width: 4 },
  ] as const;

  it('writes each field at its declared width, in order', () => {
    expect(renderSegment(layout, { a: 'xy', b: '7', c: 'zzzz' })).toBe('XY 07zzzz'.toUpperCase());
  });

  it('produces a line exactly as wide as the layout says', () => {
    const line = renderSegment(layout, { a: 'x' });
    expect(line).toHaveLength(layoutWidth(layout));
  });

  it('writes a field the extractor did not supply as blank, not a crash', () => {
    // A state layout may ask for a column this system does not collect. The
    // right answer is an empty column and a validation message, not an export
    // that dies in front of a records clerk on deadline.
    expect(() => renderSegment(layout, {})).not.toThrow();
  });

  it('reports where every field starts and ends, for checking against a spec', () => {
    expect(columnMap(layout)).toEqual([
      { field: 'a', from: 1, to: 3, spec: layout[0] },
      { field: 'b', from: 4, to: 5, spec: layout[1] },
      { field: 'c', from: 6, to: 9, spec: layout[2] },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Extraction — national, and the same for every state                 */
/* ------------------------------------------------------------------ */

describe('extraction', () => {
  it('computes an age from the date of birth as at the offence date', () => {
    const link = mkPerson('victim', { dob: '1990-06-01' }, { victimType: 'I' });
    const incident = approvedIncident({ persons: [link], occurredFrom: '2026-03-14T21:30' });
    const persons = resolvePeople(incident.persons, PEOPLE);
    // 35 on 14 March 2026 — the birthday has not come round yet.
    expect(victimValues(incident, AGENCY, persons)[0].age).toBe('35');
  });

  it('leaves the age of a society victim empty rather than calling it zero', () => {
    const link = mkPerson('victim', {}, { victimType: 'S' });
    const incident = approvedIncident({ persons: [link] });
    const persons = resolvePeople(incident.persons, PEOPLE);
    expect(victimValues(incident, AGENCY, persons)[0].age).toBe('');
  });

  it('reports an unknown offender when nobody is named', () => {
    // NIBRS still counts the crime; a submission with no offender segment at
    // all is rejected, so an "unknown" record stands in.
    const values = offenderValues(approvedIncident(), AGENCY, []);
    expect(values).toHaveLength(1);
    expect(values[0].sequence).toBe('0');
  });

  it('leaves premises-entered empty on an offense that is not a burglary', () => {
    const incident = approvedIncident({
      offenses: [createOffense({ code: '23F', locationType: '20' })],
    });
    expect(offenseValues(incident, AGENCY)[0].premisesEntered).toBe('');
  });

  it('carries premises-entered on a burglary', () => {
    const incident = approvedIncident({
      offenses: [createOffense({ code: '220', locationType: '20', premisesEntered: '3' })],
    });
    expect(offenseValues(incident, AGENCY)[0].premisesEntered).toBe('3');
  });

  it('writes property values as whole dollars', () => {
    const incident = approvedIncident({
      property: [createProperty({ descriptionCode: '03', lossType: 'stolen', value: '1250.75' })],
    });
    expect(propertyValues(incident, AGENCY)[0].value).toBe('1251');
  });

  it('flags multiple arrests on each arrestee', () => {
    const a = mkPerson('arrestee', {}, { arrestDate: '2026-03-14', arrestType: 'O' });
    const b = mkPerson('arrestee', {}, { arrestDate: '2026-03-14', arrestType: 'O' });
    const incident = approvedIncident({ persons: [a, b] });
    const persons = resolvePeople(incident.persons, PEOPLE);
    const values = arresteeValues(incident, AGENCY, persons);
    expect(values).toHaveLength(2);
    expect(values.every((v) => v.multipleArrestIndicator === 'M')).toBe(true);
  });

  it('puts the ORI and case number on every segment', () => {
    const incident = approvedIncident();
    expect(administrativeValues(incident, AGENCY, undefined).ori).toBe('AL0010200');
    expect(offenseValues(incident, AGENCY)[0].caseNumber).toBe('2026-000101');
  });
});

/* ------------------------------------------------------------------ */
/* State selection                                                     */
/* ------------------------------------------------------------------ */

describe('choosing a profile', () => {
  it('picks the pack for the agency state', () => {
    expect(profileFor('SC')).toBe(SOUTH_CAROLINA);
    expect(profileFor('NH')).toBe(NEW_HAMPSHIRE);
  });

  it('is not case sensitive', () => {
    expect(profileFor('sc')).toBe(SOUTH_CAROLINA);
  });

  it('falls back to the national baseline for a state with no pack', () => {
    // Falling back rather than refusing lets the agency see a federal-shape
    // file; the screen says which profile was used.
    expect(profileFor('AL')).toBe(NATIONAL);
    expect(profileFor('')).toBe(NATIONAL);
  });

  it('marks every profile unverified until someone checks it against the spec', () => {
    for (const profile of [NATIONAL, SOUTH_CAROLINA, NEW_HAMPSHIRE]) {
      expect(profile.verified).toBe(false);
      expect(profile.specReference).not.toBe('');
    }
  });
});

/* ------------------------------------------------------------------ */
/* South Carolina — fixed width, header, wider case number             */
/* ------------------------------------------------------------------ */

describe('South Carolina', () => {
  const SC_AGENCY: AgencyProfile = {
    ...AGENCY,
    ori: 'SC0230100',
    state: 'SC',
    // Deliberately not a substring of the ORI: an earlier version of the
    // "on every record" test below passed because '02301' happens to sit
    // inside 'SC0230100', while three of the six segments were in fact
    // missing the field entirely.
    stateAgencyCode: 'Z9901',
  };
  const base = { agency: SC_AGENCY, people: PEOPLE, locations: LOCATIONS, errorsByIncident: {} };

  it('writes a fixed-width file', () => {
    const result = buildExport({ ...base, incidents: [approvedIncident()] });
    expect(result.profile).toBe(SOUTH_CAROLINA);
    expect(result.content.startsWith('<?xml')).toBe(false);
  });

  it('leads with a submission header carrying the counts', () => {
    // A truncated transfer should be caught on receipt, not show up a year
    // later as a quiet undercount in the annual return.
    const result = buildExport({ ...base, incidents: [approvedIncident()] });
    const header = result.content.split('\n')[0];
    expect(header.startsWith('H')).toBe(true);
    expect(header).toContain('SC0230100');
    expect(header).toContain('Z9901');
    // One incident: administrative, one offense, one unknown offender. The
    // header is not itself counted as a segment.
    expect(header).toContain('000001');
    expect(result.segmentCount).toBe(3);
    expect(result.content.trimEnd().split('\n')).toHaveLength(4);
  });

  it('carries the state agency code on every record, not just the header', () => {
    // A state difference applied to some segments and not others produces a
    // file that looks right in the first two lines and is wrong in the rest.
    const link = mkPerson('victim', { dob: '1990-06-01' }, { victimType: 'I' });
    const incident = approvedIncident({
      persons: [link],
      property: [createProperty({ descriptionCode: '03', lossType: 'stolen', value: '100' })],
    });
    const result = buildExport({ ...base, incidents: [incident] });
    const records = result.content.trimEnd().split('\n').slice(1);
    expect(records).toHaveLength(5);
    expect(records.every((line) => line.slice(10, 15) === 'Z9901')).toBe(true);
  });

  it('widens the case number on every record, not just the first two', () => {
    const link = mkPerson('victim', { dob: '1990-06-01' }, { victimType: 'I' });
    const incident = approvedIncident({ persons: [link] });
    const result = buildExport({ ...base, incidents: [incident] });
    const records = result.content.trimEnd().split('\n').slice(1);
    // Segment level, ORI, agency code, then the case number in its 16 columns.
    expect(records.every((line) => line.slice(15, 31) === '2026-000101     ')).toBe(true);
  });

  it('gives the case number a wider field than the national record', () => {
    const scWidth = SOUTH_CAROLINA.segments.administrative.find((f) => f.field === 'caseNumber')!.width;
    const nationalWidth = NATIONAL.segments.administrative.find((f) => f.field === 'caseNumber')!.width;
    // A truncated case number silently mismatches every other segment for
    // that incident, which is the worst kind of failure — it validates.
    expect(scWidth).toBeGreaterThan(nationalWidth);
  });

  it('requires the state statute cite on an offense', () => {
    const required = SOUTH_CAROLINA.segments.offense.find((f) => f.field === 'statute');
    expect(required?.required).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* New Hampshire — the same data, a different transport                */
/* ------------------------------------------------------------------ */

describe('New Hampshire', () => {
  const NH_AGENCY: AgencyProfile = { ...AGENCY, ori: 'NH0070200', state: 'NH' };
  const base = { agency: NH_AGENCY, people: PEOPLE, locations: LOCATIONS, errorsByIncident: {} };

  it('writes XML', () => {
    const result = buildExport({ ...base, incidents: [approvedIncident()] });
    expect(result.profile).toBe(NEW_HAMPSHIRE);
    expect(result.content.startsWith('<?xml version="1.0"')).toBe(true);
    expect(result.content).toContain('<administrative>');
    expect(result.content).toContain('<offense>');
  });

  it('counts the same segments the fixed-width transport would', () => {
    // The transport is a renderer. The data behind it does not change.
    const incidents = [approvedIncident()];
    const asXml = buildExport({ ...base, incidents });
    const asFixed = buildExport({ ...base, incidents, profile: SOUTH_CAROLINA });
    expect(asXml.segmentCount).toBe(asFixed.segmentCount);
    expect(asXml.included).toEqual(asFixed.included);
  });

  it('omits an empty field rather than writing an empty element', () => {
    // In a positional format a blank column is meaningful. In XML an absent
    // element says the same thing, and an empty element is a third thing.
    const result = buildExport({ ...base, incidents: [approvedIncident()] });
    expect(result.content).not.toContain('></');
    expect(result.content).not.toMatch(/<\w+ \/>\s*<\/\w+>/);
  });

  it('applies field types, so a date is a date and not the raw form value', () => {
    // The form holds '2026-03-14T21:30'. A column says 20260314 and an element
    // says 2026-03-14; what neither says is the raw datetime string.
    const result = buildExport({ ...base, incidents: [approvedIncident()] });
    expect(result.content).toContain('<incidentDate>2026-03-14</incidentDate>');
    expect(result.content).toContain('<incidentHour>21</incidentHour>');
    expect(result.content).not.toContain('T21:30');
  });

  it('escapes text that would otherwise break the document', () => {
    expect(escapeXml('Smith & Sons <Ltd>')).toBe('Smith &amp; Sons &lt;Ltd&gt;');
  });

  it('collects resident status, which the national record does not', () => {
    const nh = NEW_HAMPSHIRE.segments.victim.some((f) => f.field === 'residentStatus');
    const national = NATIONAL.segments.victim.some((f) => f.field === 'residentStatus');
    expect(nh).toBe(true);
    expect(national).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Validation generated from the layouts                               */
/* ------------------------------------------------------------------ */

describe('state required fields become validation', () => {
  const check = (incident: ReturnType<typeof approvedIncident>, agency: AgencyProfile, profile = profileFor(agency.state)) =>
    runRules(incident, [requiredFieldRules(profile)], {
      people: PEOPLE,
      locations: LOCATIONS,
      agency,
    });

  const SC_AGENCY: AgencyProfile = {
    ...AGENCY,
    ori: 'SC0230100',
    state: 'SC',
    stateAgencyCode: 'Z9901',
  };

  it('raises the missing statute South Carolina asks for', () => {
    const incident = approvedIncident({
      offenses: [createOffense({ code: '23F', locationType: '20', statute: '' })],
    });
    const issues = check(incident, SC_AGENCY).issues;
    expect(issues.some((i) => /statute/i.test(i.title))).toBe(true);
  });

  it('says nothing when the statute is there', () => {
    const issues = check(approvedIncident(), SC_AGENCY).issues;
    expect(issues.some((i) => /statute/i.test(i.title))).toBe(false);
  });

  it('does not ask New Hampshire agencies for a South Carolina statute', () => {
    const incident = approvedIncident({
      offenses: [createOffense({ code: '23F', locationType: '20', statute: '' })],
    });
    const issues = check(incident, { ...AGENCY, state: 'NH' }).issues;
    expect(issues.some((i) => /statute/i.test(i.title))).toBe(false);
  });

  it('raises the missing SLED agency code', () => {
    const issues = check(approvedIncident(), { ...SC_AGENCY, stateAgencyCode: '' }).issues;
    expect(issues.some((i) => /agency code/i.test(i.title))).toBe(true);
  });

  it('warns rather than blocks, so a federally complete report can still be filed', () => {
    // The state's requirement is real, but it is the state's. It holds the
    // report out of the submission, not out of the record.
    const incident = approvedIncident({
      offenses: [createOffense({ code: '23F', locationType: '20', statute: '' })],
    });
    const result = check(incident, SC_AGENCY);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('points the officer at the section the field is edited in', () => {
    const incident = approvedIncident({
      offenses: [createOffense({ code: '23F', locationType: '20', statute: '' })],
    });
    const issue = check(incident, SC_AGENCY).issues.find((i) => /statute/i.test(i.title));
    expect(issue?.section).toBe('offenses');
  });
});

/* ------------------------------------------------------------------ */
/* What goes in the file                                               */
/* ------------------------------------------------------------------ */

describe('what goes in the file', () => {
  const base = { agency: AGENCY, people: PEOPLE, locations: LOCATIONS };

  it('includes an approved report with no problems', () => {
    const result = buildExport({ ...base, incidents: [approvedIncident()], errorsByIncident: {} });
    expect(result.included).toEqual(['2026-000101']);
    expect(result.excluded).toHaveLength(0);
  });

  it('holds back a draft', () => {
    const incident = approvedIncident({ status: 'draft' });
    const result = buildExport({ ...base, incidents: [incident], errorsByIncident: {} });
    expect(result.excluded[0].reason).toMatch(/draft/i);
  });

  it('holds back a report still waiting on a supervisor', () => {
    const incident = approvedIncident({ status: 'pending_review' });
    const result = buildExport({ ...base, incidents: [incident], errorsByIncident: {} });
    expect(result.excluded[0].reason).toMatch(/supervisor/i);
  });

  it('holds back an approved report that still has validation errors', () => {
    const incident = approvedIncident();
    const result = buildExport({
      ...base,
      incidents: [incident],
      errorsByIncident: { [incident.id]: 2 },
    });
    expect(result.excluded[0].reason).toMatch(/2 unresolved/);
  });

  it('holds back a report that meets the federal edits but not the state ones', () => {
    const incident = approvedIncident();
    const result = buildExport({
      ...base,
      incidents: [incident],
      errorsByIncident: {},
      stateIssuesByIncident: { [incident.id]: 1 },
    });
    expect(result.included).toHaveLength(0);
    expect(result.excluded[0].reason).toMatch(/1 state requirement/);
  });

  it('holds everything back when the agency has no ORI', () => {
    const result = buildExport({
      ...base,
      agency: { ...AGENCY, ori: '' },
      incidents: [approvedIncident()],
      errorsByIncident: {},
    });
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

  it('produces an empty file rather than a stray header when nothing qualifies', () => {
    const result = buildExport({
      ...base,
      agency: { ...AGENCY, state: 'SC', stateAgencyCode: 'Z9901' },
      incidents: [approvedIncident({ status: 'draft' })],
      errorsByIncident: {},
    });
    expect(result.content).toBe('');
    expect(result.segmentCount).toBe(0);
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
  });
});

describe('file name', () => {
  it('is the ORI and the date', () => {
    expect(exportFilename(AGENCY, new Date(2026, 8, 2))).toBe('AL0010200_20260902.txt');
  });

  it('takes its extension from the transport', () => {
    const nh = { ...AGENCY, ori: 'NH0070200', state: 'NH' };
    expect(exportFilename(nh, new Date(2026, 8, 2))).toBe('NH0070200_20260902.xml');
  });

  it('does not produce a nameless file when there is no ORI', () => {
    expect(exportFilename({ ...AGENCY, ori: '' }, new Date(2026, 8, 2))).toBe('NOORI_20260902.txt');
  });
});
