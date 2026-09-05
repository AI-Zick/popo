import { describe, expect, it } from 'vitest';
import { domestic, notable, weaponsOn, type Places } from '@/domain/notable';
import type { Happened } from '@/domain/briefing';
import type { Incident, Offense } from '@/domain/types';
import type { Arrest, ArrestCharge } from '@/domain/arrest';
import type { IncidentPerson } from '@/domain/person';
import type { MasterLocation } from '@/domain/location';

const AT = '2026-03-11T02:15:00.000Z';

const offense = (partial: Partial<Offense>): Offense =>
  ({ id: 'o1', code: '', statute: '', weapons: [], ...partial }) as Offense;

const incident = (partial: Partial<Incident>): Incident =>
  ({
    id: 'i1',
    caseNumber: '2026-000001',
    status: 'approved',
    reportedAt: AT,
    offenses: [],
    persons: [],
    locationId: '',
    locationUnit: '',
    reportingOfficer: 'M. Reyes',
    isDomestic: false,
    isHateCrime: false,
    isGangRelated: false,
    involvesJuvenile: false,
    clearanceStatus: 'open',
    ...partial,
  }) as Incident;

const charge = (partial: Partial<ArrestCharge>): ArrestCharge =>
  ({ id: 'c1', statute: '', description: '', counts: '1', severity: '', ...partial }) as ArrestCharge;

const arrest = (partial: Partial<Arrest>): Arrest =>
  ({
    id: 'a1',
    arrestNumber: '2026-A0001',
    status: 'approved',
    arrestedAt: AT,
    arrestingOfficerName: 'M. Reyes',
    personName: 'J. Doe',
    arrestLocation: '',
    caseNumber: '',
    courtDate: '',
    bondAmount: '',
    releasedAt: '',
    juvenile: false,
    charges: [],
    ...partial,
  }) as Arrest;

const happened = (partial: Partial<Happened> = {}): Happened => ({
  incidents: [],
  arrests: [],
  crashes: [],
  stops: [],
  contacts: [],
  citations: [],
  ...partial,
});

const person = (partial: Partial<IncidentPerson>): IncidentPerson =>
  ({ id: 'p1', role: 'victim', relationships: [], ...partial }) as IncidentPerson;

const PLACES: Places = {
  loc: {
    id: 'loc',
    commonName: '',
    address: '1142 Ashwood Ln',
    city: 'Cedar Falls',
    unitLabel: 'Apt',
  } as MasterLocation,
};

describe('every arrest is read out', () => {
  it('lists an arrest whatever it was for', () => {
    const lines = notable(
      happened({ arrests: [arrest({ charges: [charge({ description: 'Shoplifting' })] })] }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe('arrest');
    expect(lines[0].headline).toBe('J. Doe — Shoplifting');
  });

  it('names the person and the lead charge rather than a number', () => {
    const lines = notable(
      happened({
        arrests: [
          arrest({
            personName: 'R. Kestrel',
            charges: [
              charge({ description: 'Simple assault', severity: 'misdemeanor' }),
              charge({ id: 'c2', description: 'Burglary', severity: 'felony' }),
            ],
          }),
        ],
      }),
    );
    expect(lines[0].headline).toBe('R. Kestrel — Burglary and 1 other charge');
  });

  it('flags a felony, and says so only when a charge says so', () => {
    const felony = notable(
      happened({ arrests: [arrest({ charges: [charge({ severity: 'felony' })] })] }),
    );
    expect(felony[0].flags).toContain('Felony');
    expect(felony[0].tone).toBe('danger');

    const misdemeanour = notable(
      happened({ arrests: [arrest({ charges: [charge({ severity: 'misdemeanor' })] })] }),
    );
    expect(misdemeanour[0].flags).not.toContain('Felony');
    expect(misdemeanour[0].tone).toBe('warn');
  });

  it('says who is still in the building', () => {
    const held = notable(happened({ arrests: [arrest({})] }));
    expect(held[0].flags).toContain('In custody');
    const gone = notable(happened({ arrests: [arrest({ releasedAt: AT })] }));
    expect(gone[0].flags).not.toContain('In custody');
  });

  it('carries the court date and the bond, which the next shift inherits', () => {
    const lines = notable(
      happened({
        arrests: [
          arrest({
            arrestLocation: 'Third St at Vine',
            caseNumber: '2026-000009',
            courtDate: '2026-04-02',
            bondAmount: '$2,500',
          }),
        ],
      }),
    );
    expect(lines[0].detail).toBe(
      'Third St at Vine · Case 2026-000009. · Court 2026-04-02. · Bond $2,500.',
    );
  });
});

describe('which cases are worth a sentence', () => {
  it('leaves out an ordinary case', () => {
    const lines = notable(
      happened({ incidents: [incident({ offenses: [offense({ code: '23C' })] })] }),
    );
    expect(lines).toEqual([]);
  });

  it('reads out a burglary', () => {
    const lines = notable(
      happened({ incidents: [incident({ offenses: [offense({ code: '220' })] })] }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].headline).toBe('Burglary / Breaking & Entering');
    /*
      No badge. The headline already says burglary, and a badge repeating the
      word beside it is the thing that stops badges being read.
    */
    expect(lines[0].flags).toEqual([]);
  });

  it('reads out a domestic whatever the offense was', () => {
    const lines = notable(
      happened({
        incidents: [incident({ isDomestic: true, offenses: [offense({ code: '13B' })] })],
      }),
    );
    expect(lines[0].flags).toContain('Domestic');
    expect(lines[0].tone).toBe('danger');
  });

  it('reads out a domestic the officer did not tick', () => {
    const lines = notable(
      happened({
        incidents: [
          incident({
            isDomestic: false,
            offenses: [offense({ code: '13B' })],
            persons: [person({ relationships: [{ offenderId: 'p2', relationship: 'SE' }] })],
          }),
        ],
      }),
    );
    expect(lines[0].flags).toContain('Domestic');
  });

  it('does not treat a stranger as a domestic', () => {
    expect(
      domestic(
        incident({ persons: [person({ relationships: [{ offenderId: 'p2', relationship: 'ST' }] })] }),
      ),
    ).toBe(false);
  });

  it('names the weapon, and ignores the codes that mean none', () => {
    expect(weaponsOn(incident({ offenses: [offense({ weapons: ['12'] })] }))).toEqual(['Handgun']);
    expect(weaponsOn(incident({ offenses: [offense({ weapons: ['40', '95', '99'] })] }))).toEqual([]);
  });

  it('raises a case to the loud badge when somebody was armed', () => {
    const lines = notable(
      happened({
        incidents: [incident({ offenses: [offense({ code: '220', weapons: ['12'] })] })],
      }),
    );
    expect(lines[0].tone).toBe('danger');
    expect(lines[0].flags).toContain('Handgun');
    expect(lines[0].detail).toContain('Weapon: Handgun.');
  });

  it('gives the address when the location index is passed in', () => {
    const lines = notable(
      happened({
        incidents: [
          incident({ locationId: 'loc', locationUnit: '3B', offenses: [offense({ code: '220' })] }),
        ],
      }),
      PLACES,
    );
    expect(lines[0].detail).toContain('1142 Ashwood Ln 3B');
  });

  it('works without one, and simply says less', () => {
    const lines = notable(
      happened({ incidents: [incident({ locationId: 'loc', offenses: [offense({ code: '220' })] })] }),
    );
    expect(lines[0].detail).toBe('Still open.');
  });

  it('says a case is still open, because that is what changes tonight', () => {
    const open = notable(
      happened({ incidents: [incident({ offenses: [offense({ code: '220' })] })] }),
    );
    expect(open[0].detail).toContain('Still open.');
    const closed = notable(
      happened({
        incidents: [
          incident({ clearanceStatus: 'cleared_arrest', offenses: [offense({ code: '220' })] }),
        ],
      }),
    );
    expect(closed[0].detail).not.toContain('Still open.');
  });
});

describe('what else earns a sentence', () => {
  it('reads out a hate crime whatever the offense was', () => {
    const lines = notable(
      happened({
        incidents: [incident({ isHateCrime: true, offenses: [offense({ code: '290' })] })],
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].flags).toContain('Hate crime');
    expect(lines[0].tone).toBe('danger');
  });

  it('marks a gang case without promoting it on its own', () => {
    const lines = notable(
      happened({
        incidents: [incident({ isGangRelated: true, offenses: [offense({ code: '290' })] })],
      }),
    );
    expect(lines[0].flags).toEqual(['Gang related']);
    expect(lines[0].tone).toBe('warn');
  });
});

describe('the order it is read in', () => {
  it('puts the loud ones first however late they happened', () => {
    const lines = notable(
      happened({
        arrests: [
          arrest({ id: 'quiet', arrestedAt: '2026-03-11T00:10:00.000Z', charges: [charge({})] }),
        ],
        incidents: [
          incident({
            id: 'loud',
            reportedAt: '2026-03-11T06:50:00.000Z',
            offenses: [offense({ code: '120' })],
          }),
        ],
      }),
    );
    expect(lines.map((l) => l.id)).toEqual(['loud', 'quiet']);
  });

  it('runs earliest to latest inside one tone', () => {
    const lines = notable(
      happened({
        arrests: [
          arrest({ id: 'late', arrestedAt: '2026-03-11T05:00:00.000Z' }),
          arrest({ id: 'early', arrestedAt: '2026-03-11T01:00:00.000Z' }),
        ],
      }),
    );
    expect(lines.map((l) => l.id)).toEqual(['early', 'late']);
  });
});
