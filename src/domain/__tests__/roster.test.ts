import { describe, expect, it } from 'vitest';
import type { GeoFeatureCollection } from '@/domain/geo';
import {
  beatsOf,
  blockingProblems,
  check,
  coverage,
  createEntry,
  createRoster,
  describeEntry,
  onDuty,
  startFrom,
  type Roster,
} from '@/domain/roster';

const sheet = (...entries: Parameters<typeof createEntry>[0][]): Roster =>
  createRoster({
    id: 'r1',
    shiftStart: '2026-03-11T07:00:00.000Z',
    shiftName: 'Day',
    entries: entries.map((e, i) => createEntry({ id: `e${i + 1}`, ...e })),
  });

describe('who is on', () => {
  it('counts only the people actually working', () => {
    const roster = sheet(
      { officerName: 'Reyes', standing: 'on' },
      { officerName: 'Tam', standing: 'court' },
      { officerName: 'Boone', standing: 'leave' },
    );
    expect(onDuty(roster).map((e) => e.officerName)).toEqual(['Reyes']);
  });

  it('reads as a line somebody can say out loud', () => {
    expect(
      describeEntry(createEntry({ officerName: 'M. Reyes', beat: '3B', vehicle: '12' })),
    ).toBe('M. Reyes · 3B · 12');
  });

  it('falls back to the call sign when there is no car', () => {
    expect(
      describeEntry(createEntry({ officerName: 'Sgt. Boone', beat: '', callSign: 'Sgt 1' })),
    ).toBe('Sgt. Boone · Sgt 1');
  });
});

const zones = (...names: string[]): GeoFeatureCollection => ({
  type: 'FeatureCollection',
  features: names.map((beat) => ({
    type: 'Feature' as const,
    properties: { beat },
    geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
  })),
});

describe('the beats an agency has', () => {
  it('reads them off the map it already uploaded', () => {
    expect(beatsOf(zones('3B', '1A', '2C'))).toEqual(['1A', '2C', '3B']);
  });

  it('is empty when no patrol areas have been loaded', () => {
    expect(beatsOf(null)).toEqual([]);
  });

  it('does not repeat a beat drawn as two polygons', () => {
    expect(beatsOf(zones('1A', '1A'))).toEqual(['1A']);
  });
});

describe('coverage', () => {
  it('names the beats nobody is on', () => {
    const roster = sheet({ officerName: 'Reyes', beat: '3B' });
    const result = coverage(roster, ['1A', '2C', '3B']);
    expect(result.uncovered).toEqual(['1A', '2C']);
    expect(result.covered).toEqual([{ beat: '3B', who: ['Reyes'] }]);
  });

  it('does not count somebody who is at court as covering their beat', () => {
    const roster = sheet({ officerName: 'Tam', beat: '1A', standing: 'court' });
    expect(coverage(roster, ['1A']).uncovered).toEqual(['1A']);
  });

  it('keeps a beat the agency has not heard of, rather than dropping the officer', () => {
    const roster = sheet({ officerName: 'Reyes', beat: 'Fairground' });
    const result = coverage(roster, ['1A']);
    expect(result.covered).toEqual([{ beat: 'Fairground', who: ['Reyes'] }]);
    expect(result.uncovered).toEqual(['1A']);
  });

  it('separates out the people on duty with no beat written down', () => {
    const roster = sheet({ officerName: 'Boone', beat: '' });
    const result = coverage(roster, ['1A']);
    expect(result.unassigned.map((e) => e.officerName)).toEqual(['Boone']);
    expect(result.uncovered).toEqual(['1A']);
  });

  it('lists two officers on one beat under that beat', () => {
    const roster = sheet({ officerName: 'Reyes', beat: '3B' }, { officerName: 'Tam', beat: '3B' });
    expect(coverage(roster, ['3B']).covered).toEqual([{ beat: '3B', who: ['Reyes', 'Tam'] }]);
  });
});

describe('what is wrong with the sheet', () => {
  it('refuses a row with nobody on it', () => {
    const problems = check(sheet({ officerName: '' }));
    expect(blockingProblems(problems).map((p) => p.title)).toContain('A line with no name');
  });

  it('refuses the same officer twice', () => {
    const problems = check(
      sheet({ officerId: 'u1', officerName: 'Reyes' }, { officerId: 'u1', officerName: 'Reyes' }),
    );
    expect(blockingProblems(problems)).toHaveLength(1);
    expect(blockingProblems(problems)[0].title).toBe('Reyes is on the sheet twice');
  });

  it('catches the same name twice even without an account behind it', () => {
    const problems = check(sheet({ officerName: 'Reserve Kelly' }, { officerName: 'reserve kelly' }));
    expect(blockingProblems(problems)).toHaveLength(1);
  });

  it('warns about two in one car without refusing it', () => {
    const problems = check(
      sheet({ officerName: 'Reyes', vehicle: '12' }, { officerName: 'Tam', vehicle: '12' }),
    );
    expect(blockingProblems(problems)).toEqual([]);
    expect(problems.map((p) => p.title)).toContain('Reyes and Tam are both in car 12');
  });

  it('does not count a car against somebody who is off', () => {
    const problems = check(
      sheet({ officerName: 'Reyes', vehicle: '12' }, { officerName: 'Tam', vehicle: '12', standing: 'off' }),
    );
    expect(problems).toEqual([]);
  });

  it('says when the fleet has that car off the road', () => {
    const problems = check(sheet({ officerName: 'Reyes', vehicle: '12' }), {
      outOfService: { '12': 'Transmission, in the shop until Friday' },
    });
    expect(problems[0].title).toBe('Car 12 is not on the road');
    expect(problems[0].message).toContain('Transmission');
    expect(problems[0].severity).toBe('warning');
  });

  it('says when a filled-in sheet has nobody working', () => {
    const problems = check(sheet({ officerName: 'Reyes', standing: 'leave' }));
    expect(problems.map((p) => p.title)).toContain('Nobody is on duty');
  });

  it('says nothing about an empty sheet, which is simply not filled in yet', () => {
    expect(check(sheet())).toEqual([]);
  });
});

describe('starting the next sheet', () => {
  it('carries the squad, their beats and their cars', () => {
    const previous = sheet({ officerName: 'Reyes', beat: '3B', vehicle: '12', callSign: 'Patrol 12' });
    const next = startFrom(previous, '2026-03-12T07:00:00.000Z', 'Day');
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]).toMatchObject({
      officerName: 'Reyes',
      beat: '3B',
      vehicle: '12',
      callSign: 'Patrol 12',
    });
    expect(next.shiftStart).toBe('2026-03-12T07:00:00.000Z');
  });

  it('does not carry last week’s notes forward', () => {
    const previous = sheet({ officerName: 'Reyes', note: 'Back at ten' });
    expect(startFrom(previous, 'x', 'Day').entries[0].note).toBe('');
  });

  it('does not carry an absence forward', () => {
    const previous = sheet({ officerName: 'Tam', beat: '1A', standing: 'leave' });
    const next = startFrom(previous, 'x', 'Day');
    expect(next.entries[0].standing).toBe('on');
    // Which is the whole point: 1A is covered again, not silently still dark.
    expect(coverage(next, ['1A']).uncovered).toEqual([]);
  });

  it('starts empty when there is nothing to start from', () => {
    expect(startFrom(null, 'x', 'Night').entries).toEqual([]);
  });
});
