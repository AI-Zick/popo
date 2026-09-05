import { describe, expect, it } from 'vitest';
import {
  BASIS_NOTE,
  buildTrends,
  byHour,
  byOffenseGroup,
  byPlace,
  byWeekday,
  compare,
  counts,
  coveredSpans,
  dateOf,
  ENOUGH_HISTORY,
  hotSpots,
  missingTimes,
  offenseGroupLabel,
  precedingSpans,
  previousSpan,
  recordsFrom,
  SMALL_NUMBER,
  SPARSE_NOTE,
  spanDays,
  spanEnding,
  tally,
  usualRange,
  withinSpan,
  yearEarlier,
  type Span,
} from '../trends';
import type { Incident } from '../types';
import type { LocationIndex, MasterLocation } from '../location';
import { emptyLocation } from '../location';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

let seq = 0;

/**
 * A report reduced to what a trend cares about.
 *
 * Approved and founded by default, because the interesting tests are the ones
 * that take those away.
 */
const report = (partial: {
  on: string;
  reported?: string;
  codes?: string[];
  places?: string[];
  status?: Incident['status'];
  clearance?: Incident['clearanceStatus'];
  locationId?: string;
}): Incident => {
  seq += 1;
  const codes = partial.codes ?? ['220'];
  return {
    id: `inc-${seq}`,
    caseNumber: `2026-${String(seq).padStart(6, '0')}`,
    status: partial.status ?? 'approved',
    reportedAt: partial.reported ?? partial.on,
    occurredFrom: partial.on,
    occurredTo: '',
    occurredIsRange: false,
    locationId: partial.locationId ?? '',
    locationUnit: '',
    reportingOfficer: 'M. Reyes',
    supportingOfficers: [],
    reportingBadge: '4417',
    unit: '',
    supervisor: '',
    isDomestic: false,
    isHateCrime: false,
    isGangRelated: false,
    involvesJuvenile: false,
    clearanceStatus: partial.clearance ?? 'open',
    exceptionalClearanceReason: '',
    clearedAt: '',
    dispositionBeforeSupplement: null,
    offenses: codes.map((code, index) => ({
      id: `off-${seq}-${index}`,
      code,
      statute: '',
      attemptCompleted: 'C',
      locationType: partial.places?.[index] ?? '20',
      premisesEntered: '',
      methodOfEntry: '',
      biasMotivation: '',
      weapons: [],
      offenderSuspectedOfUsing: [],
      criminalActivity: [],
    })),
    persons: [],
    property: [],
    vehicles: [],
  } as unknown as Incident;
};

/** Reports spread evenly through a span, for building a history. */
const many = (count: number, on: string, codes = ['220']): Incident[] =>
  Array.from({ length: count }, () => report({ on, codes }));

const SPAN: Span = { from: '2026-09-01', to: '2026-09-30' };

/* ------------------------------------------------------------------ */
/* Spans                                                               */
/* ------------------------------------------------------------------ */

describe('spans', () => {
  it('counts both ends of a span', () => {
    expect(spanDays({ from: '2026-09-01', to: '2026-09-30' })).toBe(30);
    expect(spanDays({ from: '2026-09-04', to: '2026-09-04' })).toBe(1);
  });

  it('refuses a span that runs backwards rather than returning a negative', () => {
    expect(spanDays({ from: '2026-09-30', to: '2026-09-01' })).toBe(0);
  });

  it('builds a span ending on a day', () => {
    expect(spanEnding('2026-09-30', 30)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('compares against the same number of days, not the previous calendar month', () => {
    /*
      The mistake this exists to prevent: nine days of one month against the
      whole of the last makes every category look like it is collapsing.
    */
    const partial = { from: '2026-10-01', to: '2026-10-09' };
    const before = previousSpan(partial);
    expect(spanDays(before)).toBe(spanDays(partial));
    expect(before).toEqual({ from: '2026-09-22', to: '2026-09-30' });
  });

  it('does not overlap the period it is compared with', () => {
    const before = previousSpan(SPAN);
    expect(before.to < SPAN.from).toBe(true);
  });

  it('takes the same dates a year earlier', () => {
    expect(yearEarlier(SPAN)).toEqual({ from: '2025-09-01', to: '2025-09-30' });
  });

  it('walks backwards without gaps or overlaps', () => {
    const spans = precedingSpans({ from: '2026-09-24', to: '2026-09-30' }, 3);
    expect(spans).toEqual([
      { from: '2026-09-17', to: '2026-09-23' },
      { from: '2026-09-10', to: '2026-09-16' },
      { from: '2026-09-03', to: '2026-09-09' },
    ]);
  });

  it('drops history periods from before the department had records', () => {
    /*
      The overstatement this exists to stop, and it is the loud kind. Twelve
      ninety-day periods reach back nearly three years; for an agency that went
      live last spring, ten of them score zero because nobody was writing
      reports yet — so the "usual range" starts at 0, this quarter beats all of
      them, and every category on the screen wears a red badge forever. The
      screen would be most alarming exactly where it knows least.
    */
    const spans = precedingSpans({ from: '2026-07-01', to: '2026-09-28' }, 12);
    expect(spans).toHaveLength(12);
    const usable = coveredSpans(spans, '2026-01-01');
    expect(usable.length).toBeLessThan(12);
    expect(usable.every((span) => span.from >= '2026-01-01')).toBe(true);
  });

  it('drops a period the records only half cover', () => {
    // Half a period of data reads as a quiet period, for the same wrong reason.
    const span = { from: '2026-03-01', to: '2026-03-31' };
    expect(coveredSpans([span], '2026-03-15')).toEqual([]);
    expect(coveredSpans([span], '2026-03-01')).toEqual([span]);
  });

  it('takes nothing on trust when there are no records at all', () => {
    expect(coveredSpans(precedingSpans(SPAN, 12), '')).toEqual([]);
  });

  it('holds a date against a span by the day, ignoring the time', () => {
    expect(withinSpan('2026-09-30T23:45', SPAN)).toBe(true);
    expect(withinSpan('2026-10-01T00:01', SPAN)).toBe(false);
    expect(withinSpan('', SPAN)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* What counts                                                         */
/* ------------------------------------------------------------------ */

describe('what a crime figure is', () => {
  it('leaves out a draft, because it is somebody’s unfinished sentence', () => {
    expect(counts(report({ on: '2026-09-10', status: 'draft' }))).toBe(false);
  });

  it('leaves out a report a supervisor sent back', () => {
    expect(counts(report({ on: '2026-09-10', status: 'returned' }))).toBe(false);
  });

  it('leaves out an unfounded report, which is the department saying it did not happen', () => {
    const unfounded = report({ on: '2026-09-10', clearance: 'unfounded' });
    expect(counts(unfounded)).toBe(false);
    // Still unfounded even though it was approved — approval is not the test.
    expect(unfounded.status).toBe('approved');
  });

  it('counts what is filed and what is waiting on a supervisor', () => {
    expect(counts(report({ on: '2026-09-10' }))).toBe(true);
    expect(counts(report({ on: '2026-09-10', status: 'pending_review' }))).toBe(true);
  });

  it('counts on the date asked for, and the two dates disagree', () => {
    // Happened Friday, reported Monday. Both answers are right; they differ.
    const found = report({ on: '2026-09-04T22:00', reported: '2026-09-07T09:00' });
    expect(dateOf(found, 'occurred')).toBe('2026-09-04');
    expect(dateOf(found, 'reported')).toBe('2026-09-07');
    expect(BASIS_NOTE.occurred).toMatch(/date the offence happened/);
    expect(BASIS_NOTE.reported).toMatch(/told/);
  });
});

/* ------------------------------------------------------------------ */
/* Comparing                                                           */
/* ------------------------------------------------------------------ */

describe('comparing two periods', () => {
  it('withholds the percentage when the base is too small to divide by', () => {
    /*
      The whole point of the floor. Two to six is "+200%", and it is also four
      burglaries. The percentage is the number that gets read aloud.
    */
    const small = compare(6, 2);
    expect(small.percent).toBeNull();
    expect(small.change).toBe(4);
    expect(small.direction).toBe('up');
  });

  it('gives a percentage once the base can carry one', () => {
    const solid = compare(60, 40);
    expect(solid.percent).toBe(50);
    expect(solid.change).toBe(20);
  });

  it('withholds on the size of the base, not the size of the change', () => {
    // A big jump off a tiny base is exactly the case a percentage misleads on.
    expect(compare(400, SMALL_NUMBER - 1).percent).toBeNull();
    expect(compare(11, SMALL_NUMBER).percent).toBe(10);
  });

  it('never divides by zero', () => {
    const fromNothing = compare(5, 0);
    expect(fromNothing.percent).toBeNull();
    expect(Number.isFinite(fromNothing.change)).toBe(true);
  });

  it('calls a fall a fall', () => {
    const down = compare(30, 50);
    expect(down.direction).toBe('down');
    expect(down.percent).toBe(-40);
  });

  it('calls no movement flat rather than up', () => {
    expect(compare(20, 20).direction).toBe('flat');
  });
});

/* ------------------------------------------------------------------ */
/* The usual range                                                     */
/* ------------------------------------------------------------------ */

describe('whether a number is unusual', () => {
  it('says nothing until there is enough history to say it', () => {
    const thin = usualRange(50, [4, 5, 6]);
    expect(thin.verdict).toBe('unknown');
    expect(thin.periods).toBe(3);
  });

  it('calls a count inside the recent range ordinary', () => {
    const history = [8, 12, 9, 11, 10, 13];
    expect(history.length).toBeGreaterThanOrEqual(ENOUGH_HISTORY);
    expect(usualRange(11, history).verdict).toBe('within');
  });

  it('flags a count higher than every recent period', () => {
    const spike = usualRange(21, [8, 12, 9, 11, 10, 13]);
    expect(spike.verdict).toBe('above');
    expect(spike.high).toBe(13);
  });

  it('flags a drop below every recent period, which matters as much', () => {
    expect(usualRange(3, [8, 12, 9, 11, 10, 13]).verdict).toBe('below');
  });

  it('will not call one incident a spike, however empty the history', () => {
    /*
      The overstatement this column exists to prevent, and the one it produced
      until it was caught on screen: a category that has never had an offence
      and now has one is higher than all twelve preceding periods, and putting
      a red badge on that is worse than saying nothing.
    */
    const first = usualRange(1, [0, 0, 0, 0, 0, 0]);
    expect(first.verdict).toBe('sparse');
    expect(SPARSE_NOTE).toMatch(/means nothing|too few/i);
  });

  it('still calls a real spike a spike once the numbers can carry it', () => {
    // The guard withholds on small numbers only — it must not swallow signal.
    expect(usualRange(SMALL_NUMBER, [0, 0, 1, 0, 2, 0]).verdict).toBe('above');
    expect(usualRange(40, [8, 12, 9, 11, 10, 13]).verdict).toBe('above');
  });

  it('withholds on the larger of the two, so a collapse to nothing still reads', () => {
    // Was busy, now zero: small current, but the range is big enough to mean it.
    expect(usualRange(0, [18, 22, 19, 25, 20, 21]).verdict).toBe('below');
  });

  it('is not fooled by an up-tick that is inside ordinary movement', () => {
    /*
      The reason this exists next to the percentage. Ten to thirteen is "up",
      and thirteen has happened in the last six periods — it is a Tuesday, not
      a trend.
    */
    const rise = compare(13, 10);
    expect(rise.direction).toBe('up');
    expect(usualRange(13, [8, 12, 9, 11, 10, 13]).verdict).toBe('within');
  });
});

/* ------------------------------------------------------------------ */
/* Counting                                                            */
/* ------------------------------------------------------------------ */

describe('tallying offences', () => {
  const incidents = [
    // A burglary and an assault on one report: it belongs under both.
    report({ on: '2026-09-10', codes: ['220', '13B'] }),
    report({ on: '2026-09-11', codes: ['220'] }),
    report({ on: '2026-09-12', codes: ['23C'], status: 'draft' }),
    report({ on: '2026-08-15', codes: ['220'] }),
  ];

  it('counts each offence on a report, not each report', () => {
    const totals = tally(incidents, SPAN, 'occurred', byOffenseGroup);
    expect(totals.get('Burglary')).toBe(2);
    expect(totals.get('Assault')).toBe(1);
  });

  it('leaves the draft out', () => {
    expect(tally(incidents, SPAN, 'occurred', byOffenseGroup).get('Larceny / Theft')).toBeUndefined();
  });

  it('leaves out what falls outside the span', () => {
    // The August burglary is real and is not this month's.
    expect(tally(incidents, SPAN, 'occurred', byOffenseGroup).get('Burglary')).toBe(2);
    expect(
      tally(incidents, { from: '2026-08-01', to: '2026-08-31' }, 'occurred', byOffenseGroup).get('Burglary'),
    ).toBe(1);
  });

  it('buckets by kind of place when asked to', () => {
    const atSchool = report({ on: '2026-09-14', codes: ['13B'], places: ['22'] });
    const totals = tally([atSchool], SPAN, 'occurred', byPlace);
    expect(totals.get('22')).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

describe('a built trend report', () => {
  const incidents = [
    ...many(14, '2026-09-10'),
    ...many(20, '2026-08-10'),
    ...many(10, '2025-09-10'),
  ];

  const built = buildTrends(incidents, SPAN, 'occurred', byOffenseGroup, offenseGroupLabel);

  it('compares against the period before and the year before', () => {
    const burglary = built.rows.find((row) => row.key === 'Burglary')!;
    expect(burglary.current).toBe(14);
    expect(burglary.vsPrevious.prior).toBe(20);
    expect(burglary.vsPrevious.percent).toBe(-30);
    expect(burglary.vsYear.prior).toBe(10);
  });

  it('carries a total that adds up', () => {
    expect(built.total.current).toBe(14);
    expect(built.total.current).toBe(built.rows.reduce((sum, row) => sum + row.current, 0));
  });

  it('keeps a category that has fallen to nothing, which is the row worth seeing', () => {
    /*
      Dropping empty rows would hide the most interesting finding on the page:
      the thing that used to happen here and has stopped.
    */
    const stopped = buildTrends(
      [...many(9, '2026-08-10', ['23C'])],
      SPAN,
      'occurred',
      byOffenseGroup,
      offenseGroupLabel,
    );
    const theft = stopped.rows.find((row) => row.key === 'Larceny / Theft');
    expect(theft).toBeDefined();
    expect(theft!.current).toBe(0);
    expect(theft!.vsPrevious.prior).toBe(9);
  });

  it('orders by size, then by name so level rows do not jump about', () => {
    const mixed = buildTrends(
      [...many(5, '2026-09-10', ['220']), ...many(9, '2026-09-11', ['13B']), ...many(5, '2026-09-12', ['200'])],
      SPAN,
      'occurred',
      byOffenseGroup,
      offenseGroupLabel,
    );
    expect(mixed.rows.map((row) => row.label)).toEqual(['Assault', 'Arson & Damage', 'Burglary']);
  });

  it('finds the first day the department has a report for', () => {
    const incidents = [
      report({ on: '2026-05-04' }),
      report({ on: '2026-02-11' }),
      // A draft is not a record of anything yet, so it does not set the start.
      report({ on: '2025-01-01', status: 'draft' }),
    ];
    expect(recordsFrom(incidents, 'occurred')).toBe('2026-02-11');
  });

  it('will not call a young department’s every category a spike', () => {
    /*
      End to end: an agency whose records start eight weeks ago, looking at a
      28-day window. Only one preceding period is covered, which is fewer than
      it takes to say what is usual — so the honest answer is that it does not
      know yet, not a red badge on every row.
    */
    const young = [...many(30, '2026-09-10'), ...many(12, '2026-08-15')];
    const built = buildTrends(young, SPAN, 'occurred', byOffenseGroup, offenseGroupLabel);
    expect(built.rows[0].usual.verdict).toBe('unknown');
  });

  it('says how many days it covered and on what basis', () => {
    expect(built.days).toBe(30);
    expect(built.basis).toBe('occurred');
  });
});

/* ------------------------------------------------------------------ */
/* Time of day                                                         */
/* ------------------------------------------------------------------ */

describe('when offences happen', () => {
  const incidents = [
    report({ on: '2026-09-10T02:30' }),
    report({ on: '2026-09-11T02:45' }),
    report({ on: '2026-09-12T14:00' }),
    // No time on this one at all.
    report({ on: '2026-09-13' }),
  ];

  it('puts an offence in the hour it happened', () => {
    const hours = byHour(incidents, SPAN, 'occurred');
    expect(hours[2].count).toBe(2);
    expect(hours[14].count).toBe(1);
  });

  it('leaves a report with no time out rather than defaulting it to midnight', () => {
    /*
      Defaulting would put a spike at exactly the hour nothing happens, and it
      would be the tallest bar on the graph in a department that leaves the
      time blank.
    */
    expect(byHour(incidents, SPAN, 'occurred')[0].count).toBe(0);
  });

  it('says how much of the data the hour graph is built on', () => {
    const coverage = missingTimes(incidents, SPAN, 'occurred');
    expect(coverage.total).toBe(4);
    expect(coverage.withTime).toBe(3);
  });

  it('puts an offence on the right day of the week', () => {
    // 2026-09-10 is a Thursday.
    const days = byWeekday([report({ on: '2026-09-10T02:30' })], SPAN, 'occurred');
    expect(days[4].label).toBe('Thursday');
    expect(days[4].count).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Hot spots                                                           */
/* ------------------------------------------------------------------ */

describe('hot spots', () => {
  const place = (id: string, address: string, lat: number | null, lon: number | null): MasterLocation => ({
    ...emptyLocation(id),
    address,
    latitude: lat,
    longitude: lon,
  });

  const locations: LocationIndex = {
    'loc-1': place('loc-1', '612 N Marion St', 33.6104, -86.5148),
    'loc-2': place('loc-2', '88 Kestrel Way', 33.621, -86.4771),
    'loc-3': place('loc-3', 'Somewhere nobody pinned', null, null),
  };

  const incidents = [
    ...Array.from({ length: 5 }, () => report({ on: '2026-09-10', locationId: 'loc-1' })),
    ...Array.from({ length: 2 }, () => report({ on: '2026-09-11', locationId: 'loc-2' })),
    ...Array.from({ length: 3 }, () => report({ on: '2026-09-12', locationId: 'loc-3' })),
    // Last month, at the same address — so movement can be shown.
    ...Array.from({ length: 4 }, () => report({ on: '2026-08-10', locationId: 'loc-1' })),
  ];

  it('ranks places by how much happened there', () => {
    const { spots } = hotSpots(incidents, locations, SPAN, 'occurred');
    expect(spots.map((spot) => spot.location.address)).toEqual(['612 N Marion St', '88 Kestrel Way']);
    expect(spots[0].count).toBe(5);
  });

  it('carries what happened there last period, so the pin can say which way it is going', () => {
    const { spots } = hotSpots(incidents, locations, SPAN, 'occurred');
    expect(spots[0].previous).toBe(4);
  });

  it('does not silently drop offences at places nobody has pinned', () => {
    /*
      The map and the table beside it have to agree. Three offences at an
      unpinned address cannot be drawn, and pretending they do not exist makes
      the map quietly wrong.
    */
    const { spots, unplaced } = hotSpots(incidents, locations, SPAN, 'occurred');
    expect(spots.some((spot) => spot.location.id === 'loc-3')).toBe(false);
    expect(unplaced).toBe(3);
  });

  it('takes only as many pins as asked for', () => {
    expect(hotSpots(incidents, locations, SPAN, 'occurred', 1).spots).toHaveLength(1);
  });
});
