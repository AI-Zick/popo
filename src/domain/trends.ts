/**
 * Crime trends, for the people who deploy on them.
 *
 * A chief takes this to a council meeting and a captain moves a shift on it,
 * which makes it the most dangerous screen in the system. Every other view
 * shows a record that is either right or wrong and can be checked against the
 * report. This one shows a number nobody can check, standing in for a hundred
 * reports, and it will be read as fact.
 *
 * So the arithmetic is the easy half. The hard half is refusing to say things
 * the data cannot support, and four rules do that work:
 *
 *   **A percentage on small numbers is a lie with a decimal point.** Two
 *   burglaries last month and six this month is "+200%", and it is also four
 *   burglaries — a bad fortnight, not a crime wave. Below a floor this returns
 *   no percentage at all and shows the counts, because "+200%" is what gets
 *   read aloud in the meeting and "2 to 6" is what is true.
 *
 *   **Compare like spans.** Nine days into October against the whole of
 *   September makes every category look like it is collapsing. A comparison
 *   period here is always the same number of days as the period it is
 *   compared with.
 *
 *   **One number is not a trend.** Up against last month says nothing about
 *   whether this month is unusual — most months are up on something. So each
 *   row also carries where it sits against the same span in each of the
 *   preceding periods: inside the ordinary range, or outside it. That is the
 *   difference between noise and a signal, and it needs no assumption about
 *   how crime is distributed.
 *
 *   **Say what was counted.** Occurred-date and reported-date give different
 *   answers — a burglary found on Monday that happened over the weekend lands
 *   in different weeks under each — and a screen that does not say which it
 *   used is a screen that will be argued with. So will one that quietly counts
 *   drafts, or unfounded reports. The basis travels with the numbers.
 */

import type { Incident } from './types';
import type { LocationIndex, MasterLocation } from './location';
import { OFFENSE_BY_CODE } from './codes';

/* ------------------------------------------------------------------ */
/* Spans                                                               */
/* ------------------------------------------------------------------ */

/** A run of days, both ends included. Dates are plain `YYYY-MM-DD`. */
export interface Span {
  from: string;
  to: string;
}

const DAY = 86_400_000;

const asDate = (day: string): Date => new Date(`${day}T00:00:00Z`);
const asDay = (date: Date): string => date.toISOString().slice(0, 10);

/** How many days a span covers, counting both ends. */
export function spanDays(span: Span): number {
  const from = asDate(span.from).getTime();
  const to = asDate(span.to).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 0;
  return Math.round((to - from) / DAY) + 1;
}

/** The last `days` days ending on `asOf`, inclusive of both ends. */
export function spanEnding(asOf: string, days: number): Span {
  const end = asDate(asOf);
  const start = new Date(end.getTime() - (Math.max(1, days) - 1) * DAY);
  return { from: asDay(start), to: asOf };
}

/**
 * The same length of time, immediately before.
 *
 * Not "last month" — the same number of days. Twelve days of October against
 * thirty-one of September is a comparison that always shows a fall, and it is
 * the single easiest way to make a trend screen wrong.
 */
export function previousSpan(span: Span): Span {
  const days = spanDays(span);
  const end = new Date(asDate(span.from).getTime() - DAY);
  return { from: asDay(new Date(end.getTime() - (days - 1) * DAY)), to: asDay(end) };
}

/** The same dates a year earlier, which is how seasonal crime is read. */
export function yearEarlier(span: Span): Span {
  const shift = (day: string) => {
    const date = asDate(day);
    date.setUTCFullYear(date.getUTCFullYear() - 1);
    return asDay(date);
  };
  return { from: shift(span.from), to: shift(span.to) };
}

/** `n` spans of the same length, walking backwards from just before `span`. */
export function precedingSpans(span: Span, count: number): Span[] {
  const spans: Span[] = [];
  let cursor = span;
  for (let i = 0; i < count; i += 1) {
    cursor = previousSpan(cursor);
    spans.push(cursor);
  }
  return spans;
}

/**
 * The same spans, minus any that reach back before the department had records.
 *
 * Without this the usual range is a fiction, and a confident one. Twelve
 * ninety-day periods is nearly three years; an agency that went live in March
 * has ten of those twelve sitting in an era with no reports in it, every one
 * of them scoring zero — so the range starts at 0, this quarter is higher than
 * all of them, and every category on the screen wears a red "above the usual
 * range" badge forever. The screen would be at its most alarming precisely
 * where it knows least.
 *
 * A period is only usable when the records cover the whole of it. Half a
 * period of data is a low number for the same reason: nothing happened,
 * because nobody was writing it down yet.
 */
export function coveredSpans(spans: Span[], recordsFrom: string): Span[] {
  if (!recordsFrom) return [];
  return spans.filter((span) => span.from >= recordsFrom);
}

/** The earliest date the department has a countable report for. */
export function recordsFrom(incidents: Incident[], basis: Basis): string {
  let earliest = '';
  for (const incident of incidents) {
    if (!counts(incident)) continue;
    const day = dateOf(incident, basis);
    if (!day) continue;
    if (!earliest || day < earliest) earliest = day;
  }
  return earliest;
}

export function withinSpan(day: string, span: Span): boolean {
  if (!day) return false;
  const date = day.slice(0, 10);
  return date >= span.from && date <= span.to;
}

/* ------------------------------------------------------------------ */
/* What counts                                                         */
/* ------------------------------------------------------------------ */

/**
 * Which date an offence is counted on.
 *
 * Both are defensible and they disagree. Occurred is what happened in the
 * town; reported is what the department was told about. A burglary discovered
 * on Monday morning that happened on Friday night belongs to Friday for a
 * crime analyst and to Monday for a workload analysis, and neither is wrong.
 */
export type Basis = 'occurred' | 'reported';

export const BASIS_NOTE: Record<Basis, string> = {
  occurred:
    'Counted on the date the offence happened. Where a report gives a range, the start of the range is used.',
  reported: 'Counted on the date the department was told, which is the date on the report.',
};

/** The date this incident falls on, under the given basis. */
export function dateOf(incident: Incident, basis: Basis): string {
  const day = basis === 'occurred' ? incident.occurredFrom || incident.reportedAt : incident.reportedAt;
  return day.slice(0, 10);
}

/**
 * Whether this report is a crime figure yet.
 *
 * A draft is somebody's unfinished sentence, and an unfounded report is the
 * department saying the thing did not happen. Counting either inflates the
 * numbers a chief is about to read out. Returned reports are drafts again —
 * the supervisor sent them back — so they wait too.
 */
export function counts(incident: Incident): boolean {
  if (incident.status !== 'approved' && incident.status !== 'pending_review') return false;
  return incident.clearanceStatus !== 'unfounded';
}

export const COUNTS_NOTE =
  'Approved reports and reports waiting on review. Drafts, reports sent back, and anything marked unfounded are left out.';

export const OFFENSE_NOTE =
  'One count per offence recorded, so a report with a burglary and an assault appears under both.';

/* ------------------------------------------------------------------ */
/* Comparing                                                           */
/* ------------------------------------------------------------------ */

/**
 * The floor under which no percentage is offered.
 *
 * Not a statistical constant — a judgement about what a percentage does to a
 * reader. Below roughly this many, a percentage swings wildly on one or two
 * incidents while sounding like a finding, and the counts themselves are small
 * enough to hold in the head anyway. "1 to 3" needs no percentage; "+200%"
 * actively misleads.
 */
export const SMALL_NUMBER = 10;

export const SMALL_NUMBER_NOTE =
  'Too few for a percentage to mean much — one or two incidents would swing it by half. The counts are shown instead.';

export interface Comparison {
  current: number;
  prior: number;
  /** current − prior, always available. */
  change: number;
  /** Null when the base is too small for a percentage to carry meaning. */
  percent: number | null;
  direction: 'up' | 'down' | 'flat';
}

export function compare(current: number, prior: number): Comparison {
  const change = current - prior;
  /*
    The percentage is withheld on the size of the base, not of the change.
    Dividing by 1 is what produces the "+300%" that ends up on a slide, and it
    is exactly the case where the division tells you least.
  */
  const percent = prior >= SMALL_NUMBER ? Math.round((change / prior) * 100) : null;
  return {
    current,
    prior,
    change,
    percent,
    direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
  };
}

/**
 * Where a count sits against the recent past.
 *
 * The answer to "is this actually unusual?", which up-against-last-month
 * cannot give. Deliberately a range rather than a standard deviation: it
 * assumes nothing about how the counts are distributed, and "higher than any
 * of the last twelve weeks" is a sentence a captain can act on and a council
 * member can follow.
 */
export interface UsualRange {
  low: number;
  high: number;
  /** How many earlier spans went into it. */
  periods: number;
  verdict: 'above' | 'below' | 'within' | 'sparse' | 'unknown';
}

/** Six is the fewest that makes "the usual range" a range rather than a guess. */
export const ENOUGH_HISTORY = 6;

export function usualRange(current: number, history: number[]): UsualRange {
  if (history.length < ENOUGH_HISTORY) {
    return { low: 0, high: 0, periods: history.length, verdict: 'unknown' };
  }
  const low = Math.min(...history);
  const high = Math.max(...history);

  /*
    The same discipline the percentage gets, for the same reason. A category
    that has never had an offence and now has one is, arithmetically, higher
    than all twelve preceding periods — and putting a red "above the usual
    range" against a single incident is exactly the overstatement this column
    exists to prevent. Where every number in play is small, being outside the
    range is what small numbers do.
  */
  if (Math.max(current, high) < SMALL_NUMBER) {
    return { low, high, periods: history.length, verdict: 'sparse' };
  }

  return {
    low,
    high,
    periods: history.length,
    verdict: current > high ? 'above' : current < low ? 'below' : 'within',
  };
}

export const HISTORY_NOTE =
  'Compared with the same length of time in each of the preceding periods. "Outside the usual range" means higher or lower than every one of them, which is worth a look; inside it is ordinary movement.';

export const THIN_HISTORY_NOTE =
  'Not enough history behind this period to say what is usual yet. It builds up as reports accumulate.';

export const SPARSE_NOTE =
  'Too few either way to call it unusual. One incident in a category that rarely has any is outside every range there is, and means nothing.';

/* ------------------------------------------------------------------ */
/* Counting                                                            */
/* ------------------------------------------------------------------ */

/**
 * How an offence is bucketed into a row.
 *
 * Returns however many keys that offence belongs under — usually one, and
 * none for an offence the caller is not interested in.
 */
export type KeyOf = (offense: Incident['offenses'][number], incident: Incident) => string[];

/** Offences in a span, tallied by whatever key the caller picks. */
export function tally(
  incidents: Incident[],
  span: Span,
  basis: Basis,
  keyOf: KeyOf,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const incident of incidents) {
    if (!counts(incident)) continue;
    if (!withinSpan(dateOf(incident, basis), span)) continue;
    for (const offense of incident.offenses) {
      for (const key of keyOf(offense, incident)) {
        totals.set(key, (totals.get(key) ?? 0) + 1);
      }
    }
  }
  return totals;
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

export interface TrendRow {
  key: string;
  label: string;
  current: number;
  vsPrevious: Comparison;
  vsYear: Comparison;
  usual: UsualRange;
}

export interface TrendReport {
  span: Span;
  days: number;
  basis: Basis;
  rows: TrendRow[];
  total: TrendRow;
}

/**
 * Every row of a breakdown, with both comparisons and the usual range.
 *
 * Rows with nothing anywhere are dropped, but a row that had crime before and
 * has none now is kept and shows a zero — that is the most interesting row on
 * the screen, and dropping it would hide the one thing a chief most wants to
 * see.
 */
export function buildTrends(
  incidents: Incident[],
  span: Span,
  basis: Basis,
  keyOf: KeyOf,
  labelOf: (key: string) => string,
  historyPeriods = 12,
): TrendReport {
  const current = tally(incidents, span, basis, keyOf);
  const previous = tally(incidents, previousSpan(span), basis, keyOf);
  const lastYear = tally(incidents, yearEarlier(span), basis, keyOf);

  /*
    Only periods the records actually cover. A period from before the
    department's first report is not a quiet period, it is an absent one, and
    counting it as zero is what turns "we have no history" into "everything is
    up".
  */
  const history = coveredSpans(precedingSpans(span, historyPeriods), recordsFrom(incidents, basis)).map(
    (earlier) => tally(incidents, earlier, basis, keyOf),
  );

  const keys = new Set<string>([...current.keys(), ...previous.keys(), ...lastYear.keys()]);

  const rows: TrendRow[] = [...keys].map((key) => {
    const now = current.get(key) ?? 0;
    return {
      key,
      label: labelOf(key),
      current: now,
      vsPrevious: compare(now, previous.get(key) ?? 0),
      vsYear: compare(now, lastYear.get(key) ?? 0),
      usual: usualRange(
        now,
        history.map((period) => period.get(key) ?? 0),
      ),
    };
  });

  /*
    Most first, then alphabetically so a row does not jump about between two
    categories that are level. A stable order is what makes a screen somebody
    reads every Monday readable.
  */
  rows.sort((a, b) => b.current - a.current || a.label.localeCompare(b.label));

  const sum = (totals: Map<string, number>) => [...totals.values()].reduce((a, b) => a + b, 0);
  const nowTotal = sum(current);

  return {
    span,
    days: spanDays(span),
    basis,
    rows,
    total: {
      key: '',
      label: 'All offences',
      current: nowTotal,
      vsPrevious: compare(nowTotal, sum(previous)),
      vsYear: compare(nowTotal, sum(lastYear)),
      usual: usualRange(nowTotal, history.map(sum)),
    },
  };
}

/* ------------------------------------------------------------------ */
/* The breakdowns command staff ask for                                */
/* ------------------------------------------------------------------ */

/** By what kind of crime it was — the grouping a chief already thinks in. */
export const byOffenseGroup: KeyOf = (offense) => {
  const code = OFFENSE_BY_CODE.get(offense.code);
  return [code?.group || 'Unclassified'];
};

export const offenseGroupLabel = (key: string): string => key;

/** By the kind of place, which is what drives where cars get put. */
export const byPlace: KeyOf = (offense) => [offense.locationType || 'Not recorded'];

/* ------------------------------------------------------------------ */
/* Time of day and day of week                                         */
/* ------------------------------------------------------------------ */

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface Slot {
  key: string;
  label: string;
  count: number;
}

/**
 * When offences happen, in the shape a watch commander schedules against.
 *
 * Always occurred-time: a shift is deployed against when crime happens, not
 * when somebody rings in about it. A report with no usable time is left out
 * of this one rather than defaulted to midnight, which would put a spike on
 * the graph at exactly the hour nothing happens.
 */
export function byHour(incidents: Incident[], span: Span, basis: Basis): Slot[] {
  const hours = new Array(24).fill(0);
  for (const incident of incidents) {
    if (!counts(incident)) continue;
    if (!withinSpan(dateOf(incident, basis), span)) continue;
    const time = (incident.occurredFrom || '').slice(11, 16);
    if (!/^\d{2}:\d{2}$/.test(time)) continue;
    const hour = Number(time.slice(0, 2));
    if (hour < 0 || hour > 23) continue;
    hours[hour] += incident.offenses.length || 1;
  }
  return hours.map((count, hour) => ({
    key: String(hour),
    label: `${String(hour).padStart(2, '0')}:00`,
    count,
  }));
}

export function byWeekday(incidents: Incident[], span: Span, basis: Basis): Slot[] {
  const days = new Array(7).fill(0);
  for (const incident of incidents) {
    if (!counts(incident)) continue;
    const day = dateOf(incident, basis);
    if (!withinSpan(day, span)) continue;
    const index = asDate(day).getUTCDay();
    if (Number.isNaN(index)) continue;
    days[index] += incident.offenses.length || 1;
  }
  return days.map((count, index) => ({
    key: String(index),
    label: WEEKDAYS[index],
    count,
  }));
}

/**
 * How many reports in the span carry no usable time of day.
 *
 * Shown next to the hour graph, because a graph built on two thirds of the
 * data is a different object from one built on all of it, and the reader has
 * to be told which they are looking at.
 */
export function missingTimes(incidents: Incident[], span: Span, basis: Basis): { withTime: number; total: number } {
  let withTime = 0;
  let total = 0;
  for (const incident of incidents) {
    if (!counts(incident)) continue;
    if (!withinSpan(dateOf(incident, basis), span)) continue;
    total += 1;
    if (/^\d{2}:\d{2}$/.test((incident.occurredFrom || '').slice(11, 16))) withTime += 1;
  }
  return { withTime, total };
}

/* ------------------------------------------------------------------ */
/* Hot spots                                                           */
/* ------------------------------------------------------------------ */

export interface HotSpot {
  location: MasterLocation;
  count: number;
  previous: number;
  latitude: number;
  longitude: number;
}

/**
 * Places with the most offences in the span, for the map.
 *
 * By location record rather than by grid square, deliberately. A department
 * polices addresses — a bar, a petrol station, a block of flats — and "the
 * corner of 3rd and Marion" is something a sergeant can brief; a heat blob is
 * not. Only places that have been put on the map appear, because a hot spot
 * without coordinates cannot be drawn and silently dropping it would make the
 * map disagree with the table beside it.
 */
export function hotSpots(
  incidents: Incident[],
  locations: LocationIndex,
  span: Span,
  basis: Basis,
  limit = 12,
): { spots: HotSpot[]; unplaced: number } {
  const now = new Map<string, number>();
  const before = new Map<string, number>();

  const previous = previousSpan(span);
  for (const incident of incidents) {
    if (!counts(incident) || !incident.locationId) continue;
    const day = dateOf(incident, basis);
    const weight = incident.offenses.length || 1;
    if (withinSpan(day, span)) now.set(incident.locationId, (now.get(incident.locationId) ?? 0) + weight);
    else if (withinSpan(day, previous))
      before.set(incident.locationId, (before.get(incident.locationId) ?? 0) + weight);
  }

  const spots: HotSpot[] = [];
  let unplaced = 0;
  for (const [id, count] of now) {
    const location = locations[id];
    if (!location) continue;
    if (location.latitude === null || location.longitude === null) {
      unplaced += count;
      continue;
    }
    spots.push({
      location,
      count,
      previous: before.get(id) ?? 0,
      latitude: location.latitude,
      longitude: location.longitude,
    });
  }

  spots.sort((a, b) => b.count - a.count || a.location.address.localeCompare(b.location.address));
  return { spots: spots.slice(0, limit), unplaced };
}

export const UNPLACED_NOTE =
  'Offences at places that have never been put on the map. They are in every count on this page and on none of the pins — set a location’s point once and it appears here from then on.';
