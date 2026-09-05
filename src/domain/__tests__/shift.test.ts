import { describe, expect, it } from 'vitest';
import {
  checkPattern,
  currentShift,
  DEFAULT_PATTERN,
  describe as describeShift,
  isTimeOfDay,
  outgoingShift,
  sayTime,
  shiftAfter,
  shiftAt,
  shiftBefore,
  within,
  type ShiftPattern,
} from '@/domain/shift';

/*
  Local time throughout, deliberately. A shift is a piece of wall clock the
  agency named, so these tests construct local Dates rather than UTC strings —
  which is also the only way the overnight case can be written honestly.
*/
const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);

const THREE_EIGHTS = DEFAULT_PATTERN;
const TWO_TWELVES: ShiftPattern = { starts: ['06:00', '18:00'], names: ['Days', 'Nights'] };
const HALF_PAST: ShiftPattern = { starts: ['06:30', '14:30', '22:30'], names: ['A', 'B', 'C'] };
const ONE_SHIFT: ShiftPattern = { starts: ['08:00'], names: ['Duty'] };

describe('which shift a moment is in', () => {
  it('finds the middle of a shift', () => {
    const shift = shiftAt(THREE_EIGHTS, local(2026, 3, 10, 12));
    expect(shift.name).toBe('Day');
    expect(new Date(shift.start)).toEqual(local(2026, 3, 10, 7));
    expect(new Date(shift.end)).toEqual(local(2026, 3, 10, 15));
  });

  it('puts the changeover minute in the shift starting, not the one ending', () => {
    expect(shiftAt(THREE_EIGHTS, local(2026, 3, 10, 15)).name).toBe('Evening');
    expect(shiftAt(THREE_EIGHTS, local(2026, 3, 10, 14, 59)).name).toBe('Day');
  });

  it('handles the shift that crosses midnight', () => {
    /*
      The case a naive implementation gets wrong, and the one where getting it
      wrong puts the busiest eight hours of the week in the wrong briefing.
    */
    const beforeMidnight = shiftAt(THREE_EIGHTS, local(2026, 3, 10, 23, 30));
    expect(beforeMidnight.name).toBe('Night');
    expect(new Date(beforeMidnight.start)).toEqual(local(2026, 3, 10, 23));
    expect(new Date(beforeMidnight.end)).toEqual(local(2026, 3, 11, 7));
  });

  it('puts the small hours in the night that began yesterday', () => {
    const afterMidnight = shiftAt(THREE_EIGHTS, local(2026, 3, 11, 2, 15));
    expect(afterMidnight.name).toBe('Night');
    expect(new Date(afterMidnight.start)).toEqual(local(2026, 3, 10, 23));
    expect(new Date(afterMidnight.end)).toEqual(local(2026, 3, 11, 7));
  });

  it('gives one continuous shift either side of midnight, not two', () => {
    // The same shift, asked about from both calendar days.
    const before = shiftAt(THREE_EIGHTS, local(2026, 3, 10, 23, 59));
    const after = shiftAt(THREE_EIGHTS, local(2026, 3, 11, 0, 1));
    expect(after.start).toBe(before.start);
    expect(after.end).toBe(before.end);
  });

  it('works on twelves', () => {
    expect(shiftAt(TWO_TWELVES, local(2026, 3, 10, 5)).name).toBe('Nights');
    expect(shiftAt(TWO_TWELVES, local(2026, 3, 10, 7)).name).toBe('Days');
    expect(shiftAt(TWO_TWELVES, local(2026, 3, 10, 19)).name).toBe('Nights');
  });

  it('respects half past', () => {
    // Plenty of agencies change over at 0630, and hours alone would round it.
    expect(shiftAt(HALF_PAST, local(2026, 3, 10, 6, 15)).name).toBe('C');
    expect(shiftAt(HALF_PAST, local(2026, 3, 10, 6, 30)).name).toBe('A');
  });

  it('handles an agency that runs one shift a day', () => {
    const shift = shiftAt(ONE_SHIFT, local(2026, 3, 10, 12));
    expect(shift.name).toBe('Duty');
    expect(new Date(shift.start)).toEqual(local(2026, 3, 10, 8));
    expect(new Date(shift.end)).toEqual(local(2026, 3, 11, 8));
  });

  it('sorts a pattern given out of order', () => {
    const jumbled: ShiftPattern = { starts: ['23:00', '07:00', '15:00'], names: ['Night', 'Day', 'Evening'] };
    expect(shiftAt(jumbled, local(2026, 3, 10, 12)).name).toBe('Day');
  });

  it('falls back rather than throwing on a pattern with nothing usable in it', () => {
    // A broken setting must not take the briefing screen down with it.
    const broken: ShiftPattern = { starts: ['nonsense'], names: ['?'] };
    expect(() => shiftAt(broken, local(2026, 3, 10, 12))).not.toThrow();
  });
});

describe('stepping between shifts', () => {
  it('the outgoing shift is the one that just ended', () => {
    const now = local(2026, 3, 10, 7, 10);
    expect(currentShift(THREE_EIGHTS, now).name).toBe('Day');
    const outgoing = outgoingShift(THREE_EIGHTS, now);
    expect(outgoing.name).toBe('Night');
    expect(new Date(outgoing.end)).toEqual(local(2026, 3, 10, 7));
  });

  it('the outgoing shift ends exactly where the current one starts', () => {
    const now = local(2026, 3, 10, 16);
    expect(outgoingShift(THREE_EIGHTS, now).end).toBe(currentShift(THREE_EIGHTS, now).start);
  });

  it('steps backwards and forwards without gaps or overlaps', () => {
    const shift = shiftAt(THREE_EIGHTS, local(2026, 3, 10, 12));
    expect(shiftBefore(THREE_EIGHTS, shift).end).toBe(shift.start);
    expect(shiftAfter(THREE_EIGHTS, shift).start).toBe(shift.end);
  });

  it('steps back across midnight', () => {
    const night = shiftAt(THREE_EIGHTS, local(2026, 3, 11, 2));
    const before = shiftBefore(THREE_EIGHTS, night);
    expect(before.name).toBe('Evening');
    expect(new Date(before.start)).toEqual(local(2026, 3, 10, 15));
  });
});

describe('what falls inside a shift', () => {
  const shift = shiftAt(THREE_EIGHTS, local(2026, 3, 10, 12));

  it('includes the first instant', () => {
    expect(within(shift, local(2026, 3, 10, 7).toISOString())).toBe(true);
  });

  it('excludes the last, so nothing is counted twice', () => {
    // The changeover instant belongs to exactly one shift.
    expect(within(shift, local(2026, 3, 10, 15).toISOString())).toBe(false);
  });

  it('ignores an empty or unparseable time rather than counting it', () => {
    expect(within(shift, '')).toBe(false);
    expect(within(shift, 'sometime')).toBe(false);
  });
});

describe('checking a pattern', () => {
  it('is happy with the default', () => {
    expect(checkPattern(DEFAULT_PATTERN)).toEqual([]);
  });

  it('catches two shifts starting at once', () => {
    const clash: ShiftPattern = { starts: ['07:00', '07:00'], names: ['A', 'B'] };
    expect(checkPattern(clash).some((p) => /same time/.test(p.message))).toBe(true);
  });

  it('catches a time that is not one', () => {
    expect(checkPattern({ starts: ['25:00'], names: ['A'] }).length).toBeGreaterThan(0);
    expect(checkPattern({ starts: ['07:60'], names: ['A'] }).length).toBeGreaterThan(0);
  });

  it('catches a nameless shift', () => {
    expect(checkPattern({ starts: ['07:00'], names: ['  '] }).some((p) => /no name/.test(p.message))).toBe(true);
  });

  it('catches having no shifts at all', () => {
    expect(checkPattern({ starts: [], names: [] })[0].message).toMatch(/no shifts/i);
  });
});

describe('saying a time out loud', () => {
  it('reads as a clock rather than a number', () => {
    expect(sayTime('07:00')).toBe('7:00 am');
    expect(sayTime('15:30')).toBe('3:30 pm');
    expect(sayTime('00:00')).toBe('12:00 am');
    expect(sayTime('12:00')).toBe('12:00 pm');
  });

  it('gives back nonsense unchanged rather than inventing a time', () => {
    expect(sayTime('bananas')).toBe('bananas');
  });
});

describe('validating a time of day', () => {
  it('accepts what a changeover looks like', () => {
    expect(isTimeOfDay('07:00')).toBe(true);
    expect(isTimeOfDay('6:30')).toBe(true);
  });

  it('rejects the rest', () => {
    expect(isTimeOfDay('24:00')).toBe(false);
    expect(isTimeOfDay('7')).toBe(false);
    expect(isTimeOfDay('')).toBe(false);
  });
});

describe('heading a briefing', () => {
  it('names the shift, the day and both ends of it', () => {
    const line = describeShift(shiftAt(THREE_EIGHTS, local(2026, 3, 10, 23, 30)));
    expect(line).toMatch(/^Night, /);
    expect(line).toMatch(/March/);
    expect(line).toMatch(/to/);
  });
});
