import { describe, expect, it } from 'vitest';
import {
  describePlan,
  guessMapping,
  importProvenance,
  LOCATION_FIELDS,
  normalizeDate,
  normalizeSex,
  parseCsv,
  PEOPLE_FIELDS,
  planImport,
  unreadableValues,
  type ColumnMap,
} from '../migration';
import { createLocation, createMasterPerson } from '../factory';
import type { PersonIndex } from '../person';
import type { LocationIndex } from '../location';

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

describe('reading a legacy export', () => {
  it('reads a plain file', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    // A naive split corrupts an export the first time an address has a comma,
    // and does it quietly.
    expect(parseCsv('name,address\n"Whitfield, Dana","1142 Ashwood Ln, Apt 2"')).toEqual([
      ['name', 'address'],
      ['Whitfield, Dana', '1142 Ashwood Ln, Apt 2'],
    ]);
  });

  it('handles escaped quotes', () => {
    expect(parseCsv('note\n"He said ""nothing"" happened"')).toEqual([
      ['note'],
      ['He said "nothing" happened'],
    ]);
  });

  it('handles newlines inside a quoted narrative', () => {
    const rows = parseCsv('id,narrative\n1,"Line one\nLine two"');
    expect(rows[1][1]).toBe('Line one\nLine two');
  });

  it('survives Windows line endings', () => {
    // Legacy exports arrive from Windows more often than not, and a stray \r
    // ends up inside the last field of every row.
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('drops a trailing blank row nobody meant to import', () => {
    expect(parseCsv('a\n1\n\n')).toEqual([['a'], ['1']]);
  });

  it('copes with an empty file', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

describe('guessing the columns', () => {
  it('recognises the vocabulary legacy systems actually use', () => {
    const map = guessMapping(['LNAME', 'FNAME', 'DOB', 'OLN', 'ADDR'], 'people');
    expect(map.lastName).toBe(0);
    expect(map.firstName).toBe(1);
    expect(map.dob).toBe(2);
    expect(map.driverLicense).toBe(3);
    expect(map.address).toBe(4);
  });

  it('ignores punctuation and case in a header', () => {
    expect(guessMapping(['Last_Name', 'First Name'], 'people').lastName).toBe(0);
    expect(guessMapping(['Last_Name', 'First Name'], 'people').firstName).toBe(1);
  });

  it('marks a field it cannot find', () => {
    expect(guessMapping(['lname'], 'people').phone).toBe(-1);
  });

  it('maps location headers too', () => {
    const map = guessMapping(['STREET', 'CITY', 'RD'], 'locations');
    expect(map.address).toBe(0);
    expect(map.city).toBe(1);
    expect(map.beat).toBe(2);
  });

  it('offers a required field for both kinds', () => {
    expect(PEOPLE_FIELDS.some((f) => f.required)).toBe(true);
    expect(LOCATION_FIELDS.some((f) => f.required)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Normalising                                                         */
/* ------------------------------------------------------------------ */

describe('normalising values', () => {
  it('reads the American format that dominates these exports', () => {
    expect(normalizeDate('03/14/1985')).toBe('1985-03-14');
    expect(normalizeDate('3/4/1985')).toBe('1985-03-04');
  });

  it('reads ISO', () => {
    expect(normalizeDate('1985-03-14')).toBe('1985-03-14');
  });

  it('windows a two-digit year into the past', () => {
    // A two-digit year in a police file is a date of birth far more often than
    // a future date.
    expect(normalizeDate('03/14/85')).toBe('1985-03-14');
    expect(normalizeDate('03/14/05')).toBe('2005-03-14');
  });

  it('returns nothing rather than guessing at nonsense', () => {
    // A wrong date of birth is worse than a missing one: it silently defeats
    // the duplicate matching that depends on it.
    expect(normalizeDate('not a date')).toBe('');
    expect(normalizeDate('13/45/1985')).toBe('');
    expect(normalizeDate('')).toBe('');
  });

  it('normalises the several ways a legacy system spells sex', () => {
    expect(normalizeSex('MALE')).toBe('M');
    expect(normalizeSex('f')).toBe('F');
    expect(normalizeSex('1')).toBe('M');
    expect(normalizeSex('unknown')).toBe('U');
    expect(normalizeSex('banana')).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* Planning                                                            */
/* ------------------------------------------------------------------ */

const existing = createMasterPerson({
  id: 'mp-1',
  lastName: 'Whitfield',
  firstName: 'Dana',
  middleName: 'Marie',
  dob: '1985-03-14',
  address: '1142 Ashwood Ln',
  city: 'Cedar Falls',
  phone: '(205) 555-0148',
});

const PEOPLE: PersonIndex = { 'mp-1': existing };
const LOCATIONS: LocationIndex = {
  'loc-1': createLocation({
    id: 'loc-1',
    address: '612 N Marion St',
    city: 'Cedar Falls',
    commonName: 'Marion Street Self Storage',
  }),
};

const HEADER = 'LNAME,FNAME,DOB,ADDR,CITY';
const plan = (csv: string, kind: 'people' | 'locations' = 'people', mapping?: ColumnMap) => {
  const rows = parseCsv(csv);
  return planImport({
    kind,
    rows,
    hasHeader: true,
    mapping: mapping ?? guessMapping(rows[0], kind),
    people: PEOPLE,
    locations: LOCATIONS,
  });
};

describe('planning an import', () => {
  it('creates a row that is new to the index', () => {
    const result = plan(`${HEADER}\nOkafor,Samuel,11/04/1988,88 Marion St,Cedar Falls`);
    expect(result.create).toHaveLength(1);
    expect(result.create[0].values.lastName).toBe('Okafor');
    expect(result.create[0].values.dob).toBe('1988-11-04');
  });

  it('matches a row against somebody already in the index', () => {
    // The whole point: importing eleven years of history must not create the
    // same human eleven times.
    const result = plan(`${HEADER}\nWhitfield,Dana,03/14/1985,1142 Ashwood Ln,Cedar Falls`);
    expect(result.merge).toHaveLength(1);
    expect(result.merge[0].matchedId).toBe('mp-1');
  });

  it('sends a near-miss to a human rather than deciding', () => {
    // Same surname and date of birth, different first name — a sibling, or a
    // typo. Both wrong answers are expensive: a merged pair of different
    // people, or a duplicated one.
    const result = plan(`${HEADER}\nWhitfield,Diana,03/14/1985,,`);
    expect(result.review).toHaveLength(1);
    expect(result.merge).toHaveLength(0);
  });

  it('sends a bare name that collides with someone on file to a human', () => {
    /*
      Plenty of people share a first and last name, so this is not evidence
      enough to merge. But it is not evidence enough to create, either — and
      the two mistakes are not symmetrical here. Interactively, a spurious new
      person is visible and fixable in the moment. In an import it is silent,
      permanent, and found years later. So neither: a human looks.
    */
    const result = plan(`${HEADER}\nWhitfield,Dana,,,`);
    expect(result.create).toHaveLength(0);
    expect(result.review).toHaveLength(1);
    expect(result.review[0].matchedId).toBe('mp-1');
  });

  it('creates a bare name that collides with nobody', () => {
    const result = plan(`${HEADER}\nAbernathy,Colm,,,`);
    expect(result.create).toHaveLength(1);
    expect(result.review).toHaveLength(0);
  });

  it('merges on an exact name and date of birth, which review would drown', () => {
    /*
      The interactive threshold is more cautious on purpose. But an eleven-year
      export lists the same person once per report, and sending every one of
      those to review produces tens of thousands of rows nobody works through —
      at which point the clerk approves the lot unread and the review step has
      made things worse.
    */
    const result = plan(`${HEADER}\nWhitfield,Dana,03/14/1985,,`);
    expect(result.merge).toHaveLength(1);
    expect(result.merge[0].matchedId).toBe('mp-1');
  });

  it('will not sweep a contradicting identifier into an automatic merge', () => {
    /*
      Exact name and exact date of birth is normally enough to merge on import
      — but not on top of a licence number that says otherwise. That pair is
      rare, unlike the clean duplicates the rule exists to absorb, so asking
      costs a clerk almost nothing and the wrong answer costs a great deal.
    */
    const licensed = createMasterPerson({
      id: 'mp-2',
      lastName: 'Brennan',
      firstName: 'Colm',
      dob: '1978-12-01',
      driverLicense: 'AL7729140',
      driverLicenseState: 'AL',
    });
    const csv = 'LNAME,FNAME,DOB,OLN,OLNSTATE\nBrennan,Colm,12/01/1978,4412887,AL';
    const rows = parseCsv(csv);
    const result = planImport({
      kind: 'people',
      rows,
      hasHeader: true,
      mapping: guessMapping(rows[0], 'people'),
      people: { 'mp-2': licensed },
      locations: {},
    });
    expect(result.merge).toHaveLength(0);
    expect(result.review).toHaveLength(1);
    expect(result.review[0].reason).toMatch(/licence/i);
  });

  it('does not merge on a date of birth alone when the name differs', () => {
    const result = plan(`${HEADER}\nOkafor,Samuel,03/14/1985,,`);
    expect(result.merge).toHaveLength(0);
  });

  it('says which values it could not read rather than dropping them quietly', () => {
    /*
      A legacy export contains dates like 13/45/1988. Leaving the field blank is
      the honest answer — guessing a date of birth is not an option — but doing
      it silently is how an agency finds out two years on that four hundred
      dates never made it across.
    */
    const result = plan(`${HEADER}\nPruitt,Wanda,13/45/1988,9 Hollow Rd,Cedar Falls`);
    const row = [...result.create, ...result.review][0];
    expect(row.values.dob).toBe('');
    expect(row.warnings).toEqual([
      expect.stringContaining('13/45/1988'),
    ]);
    expect(unreadableValues(result).count).toBe(1);
  });

  it('does not warn about a column that was simply empty', () => {
    const result = plan(`${HEADER}\nPruitt,Wanda,,9 Hollow Rd,Cedar Falls`);
    expect(unreadableValues(result).count).toBe(0);
  });

  it('rejects a row with no last name', () => {
    const result = plan(`${HEADER}\n,Samuel,11/04/1988,88 Marion St,Cedar Falls`);
    expect(result.reject).toHaveLength(1);
    expect(result.reject[0].reason).toMatch(/no last name/i);
  });

  it('numbers rows the way the file does, so a clerk can find them', () => {
    const result = plan(`${HEADER}\n,A,,,\n,B,,,`);
    // Header is row 1.
    expect(result.reject.map((r) => r.row)).toEqual([2, 3]);
  });

  it('counts the data rows, not the header', () => {
    expect(plan(`${HEADER}\nOkafor,Samuel,,,\nRuiz,Tomas,,,`).rows).toBe(2);
  });

  it('does not import the same person twice from within one file', () => {
    // A legacy export routinely lists the same person once per report they
    // appeared on. Matching only against the database would import them all.
    const result = plan(
      `${HEADER}\nOkafor,Samuel,11/04/1988,88 Marion St,Cedar Falls\nOkafor,Samuel,11/04/1988,88 Marion St,Cedar Falls`,
    );
    expect(result.create).toHaveLength(1);
    expect(result.merge).toHaveLength(1);
  });

  it('writes nothing — a plan is only a plan', () => {
    const before = JSON.stringify(PEOPLE);
    plan(`${HEADER}\nOkafor,Samuel,11/04/1988,88 Marion St,Cedar Falls`);
    expect(JSON.stringify(PEOPLE)).toBe(before);
  });
});

describe('planning a location import', () => {
  const header = 'STREET,CITY,NAME';

  it('creates a place that is new', () => {
    const result = plan(`${header}\n100 Oak Ave,Cedar Falls,`, 'locations');
    expect(result.create).toHaveLength(1);
  });

  it('matches a place already known', () => {
    const result = plan(`${header}\n612 N Marion St,Cedar Falls,Marion Street Self Storage`, 'locations');
    expect(result.merge.length + result.review.length).toBe(1);
  });

  it('rejects a row with no address', () => {
    const result = plan(`${header}\n,Cedar Falls,Somewhere`, 'locations');
    expect(result.reject).toHaveLength(1);
  });
});

describe('what an import says about itself', () => {
  it('stamps every field as imported and unverified', () => {
    // An address out of a system nobody has audited must not read as something
    // an officer confirmed at a scene.
    const provenance = importProvenance('2026-09-02T00:00:00Z');
    expect(provenance.address?.source).toBe('import');
    expect(provenance.address?.verified).toBe(false);
    expect(provenance.dob?.at).toBe('2026-09-02T00:00:00Z');
  });

  it('summarises the plan in one line', () => {
    const result = plan(`${HEADER}\nOkafor,Samuel,11/04/1988,88 Marion St,Cedar Falls\n,B,,,`);
    expect(describePlan(result)).toMatch(/1 new/);
    expect(describePlan(result)).toMatch(/1 rejected/);
  });
});
