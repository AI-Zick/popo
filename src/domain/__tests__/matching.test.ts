import { describe, expect, it } from 'vitest';
import {
  autoLinkCandidate,
  compareDob,
  findMatches,
  jaroWinkler,
  normalizeAddress,
  normalizePhone,
  scoreMatch,
  soundex,
} from '../matching';
import { emptyMaster, type MasterPerson, type PersonIndex } from '../person';

function master(partial: Partial<MasterPerson>): MasterPerson {
  return { ...emptyMaster(partial.id ?? 'm1'), ...partial };
}

const DANA = master({
  id: 'dana',
  lastName: 'Whitfield',
  firstName: 'Dana',
  middleName: 'Marie',
  dob: '1985-03-14',
  sex: 'F',
  race: 'W',
  address: '1142 Ashwood Lane',
  city: 'Cedar Falls',
  phone: '(205) 555-0148',
  ssn: '412-55-9080',
});

const index = (...people: MasterPerson[]): PersonIndex =>
  Object.fromEntries(people.map((p) => [p.id, p]));

describe('normalisation', () => {
  it('collapses street abbreviations so the same address agrees', () => {
    expect(normalizeAddress('1142 Ashwood Lane')).toBe(normalizeAddress('1142 ASHWOOD LN'));
    expect(normalizeAddress('88 North Perch Street')).toBe(normalizeAddress('88 N Perch St'));
  });

  it('ignores phone formatting and a leading country code', () => {
    expect(normalizePhone('(205) 555-0148')).toBe('2055550148');
    expect(normalizePhone('1-205-555-0148')).toBe('2055550148');
  });
});

describe('string similarity', () => {
  it('rates near-miss names highly and unrelated names low', () => {
    expect(jaroWinkler('WHITFIELD', 'WHITFEILD')).toBeGreaterThan(0.9);
    expect(jaroWinkler('SMITH', 'JOHNSON')).toBeLessThan(0.6);
  });

  it('collides names that sound alike', () => {
    expect(soundex('Smith')).toBe(soundex('Smyth'));
    expect(soundex('Jon')).toBe(soundex('John'));
    expect(soundex('Robert')).not.toBe(soundex('Jennifer'));
  });
});

describe('date of birth comparison', () => {
  it('separates typos from genuinely different dates', () => {
    expect(compareDob('1985-03-14', '1985-03-14')).toBe('exact');
    expect(compareDob('1985-03-14', '1985-03-41')).toBe('typo'); // transposed digits
    expect(compareDob('1985-03-14', '1985-03-15')).toBe('typo'); // one wrong digit
    expect(compareDob('1985-03-14', '1962-11-02')).toBe('different');
    expect(compareDob('', '1985-03-14')).toBe('unknown');
  });
});

describe('automatic linking', () => {
  it('links on a matching SSN', () => {
    const result = scoreMatch({ lastName: 'Whitfield', firstName: 'Dana', ssn: '412559080' }, DANA);
    expect(result?.tier).toBe('certain');
    expect(result?.reasons).toContain('Same SSN');
  });

  it('links on a matching driver licence', () => {
    const withDl = master({ ...DANA, ssn: '', driverLicense: 'AL4471822', driverLicenseState: 'AL' });
    const result = scoreMatch(
      { lastName: 'Whitfield', driverLicense: 'al-4471822', driverLicenseState: 'AL' },
      withDl,
    );
    expect(result?.tier).toBe('certain');
  });

  it('does not link the same licence number issued by a different state', () => {
    const withDl = master({ ...DANA, ssn: '', driverLicense: 'X1234', driverLicenseState: 'AL' });
    const result = scoreMatch(
      { driverLicense: 'X1234', driverLicenseState: 'GA', lastName: 'Whitfield' },
      withDl,
    );
    expect(result?.tier).not.toBe('certain');
  });

  it('refuses to auto-link when two records both look certain', () => {
    const twin = master({ ...DANA, id: 'dana2' });
    const matches = findMatches({ lastName: 'Whitfield', ssn: '412559080' }, index(DANA, twin));
    expect(matches.filter((m) => m.tier === 'certain')).toHaveLength(2);
    expect(autoLinkCandidate(matches)).toBeNull();
  });
});

describe('guarding against false merges', () => {
  it('does not merge two people who share a name but differ in date of birth', () => {
    const other = master({
      id: 'other',
      lastName: 'Whitfield',
      firstName: 'Dana',
      dob: '1962-11-02',
      sex: 'F',
    });
    const result = scoreMatch(
      { lastName: 'Whitfield', firstName: 'Dana', dob: '1985-03-14', sex: 'F' },
      other,
    );
    expect(result?.tier ?? 'none').not.toBe('certain');
    if (result) expect(result.conflicts).toContain('Different date of birth');
  });

  it('treats a differing suffix as evidence of a relative, not a duplicate', () => {
    const senior = master({
      id: 'senior',
      lastName: 'Mercer',
      firstName: 'Travis',
      suffix: 'Sr',
      dob: '1968-04-01',
      sex: 'M',
    });
    const junior = scoreMatch(
      { lastName: 'Mercer', firstName: 'Travis', suffix: 'Jr', dob: '1994-11-02', sex: 'M' },
      senior,
    );
    expect(junior?.tier ?? 'none').not.toBe('certain');
    expect(junior?.tier ?? 'none').not.toBe('strong');
  });

  it('caps the tier at possible when a strong identifier conflicts', () => {
    const conflicting = master({ ...DANA, id: 'conflict', ssn: '999-00-1111' });
    const result = scoreMatch(
      {
        lastName: 'Whitfield',
        firstName: 'Dana',
        dob: '1985-03-14',
        sex: 'F',
        address: '1142 Ashwood Lane',
        ssn: '412-55-9080',
      },
      conflicting,
    );
    // Everything else agrees, so the raw score is high — but the SSN does not.
    expect(result?.tier).toBe('possible');
    expect(result?.conflicts).toContain('Different SSN on file');
  });

  it('never links a business to an individual', () => {
    const business = master({ id: 'biz', businessName: 'Whitfield Auto' });
    expect(scoreMatch({ lastName: 'Whitfield', firstName: 'Dana' }, business)).toBeNull();
  });
});

describe('proposing matches without deciding', () => {
  it('proposes a strong match on name, date of birth and address alone', () => {
    const noSsn = master({ ...DANA, id: 'nossn', ssn: '' });
    const result = scoreMatch(
      {
        lastName: 'Whitfield',
        firstName: 'Dana',
        dob: '1985-03-14',
        sex: 'F',
        address: '1142 Ashwood Ln',
        phone: '2055550148',
      },
      noSsn,
    );
    expect(result?.tier).toBe('strong');
    expect(autoLinkCandidate([result!])).toBeNull();
  });

  it('catches a phonetic misspelling taken down over the radio', () => {
    const noSsn = master({ ...DANA, id: 'nossn', ssn: '' });
    const matches = findMatches(
      { lastName: 'Whitfeild', firstName: 'Dana', dob: '1985-03-14', sex: 'F' },
      index(noSsn),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].reasons).toContain('Similar last name');
  });

  it('returns nothing when there is nothing identifying to match on', () => {
    expect(findMatches({ sex: 'M' }, index(DANA))).toEqual([]);
  });

  it('excludes people already on the report', () => {
    expect(
      findMatches({ lastName: 'Whitfield', ssn: '412559080' }, index(DANA), {
        excludeIds: ['dana'],
      }),
    ).toEqual([]);
  });

  it('ranks the best candidate first', () => {
    const weak = master({
      id: 'weak',
      lastName: 'Whitfield',
      firstName: 'Daniel',
      dob: '1985-03-14',
      sex: 'M',
    });
    const matches = findMatches(
      { lastName: 'Whitfield', firstName: 'Dana', dob: '1985-03-14', sex: 'F', ssn: '412559080' },
      index(weak, DANA),
    );
    expect(matches[0].master.id).toBe('dana');
  });
});
