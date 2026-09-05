/**
 * When one shift ends and the next begins.
 *
 * Everything else in this system stores times as instants in UTC, which is
 * right. A shift is not an instant — it is a piece of wall clock that the
 * agency named, and the people it belongs to think in it: "nights" means
 * eleven to seven, not an offset. So this converts between the two, and every
 * boundary here is worked out in local time on purpose.
 *
 * Three things this has to get right, because each of them is somebody's whole
 * shift being attributed to the wrong sergeant:
 *
 *   **The one that crosses midnight.** Nights is 2300 to 0700 and spans two
 *   calendar days, which is the case a naive implementation gets wrong and
 *   nobody notices until the busiest eight hours of the week land in the wrong
 *   briefing.
 *
 *   **Half past.** Plenty of agencies change over at 0630 or 1830. Hours are
 *   not enough.
 *
 *   **However many there are.** Three eights, two twelves, and the small
 *   agency that runs one twenty-four hour shift with somebody on call. A
 *   pattern is a list, not a choice of two.
 */

/** Minutes past local midnight. */
const minutesOf = (hhmm: string): number => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return NaN;
  return hours * 60 + minutes;
};

export const isTimeOfDay = (value: string): boolean => Number.isFinite(minutesOf(value));

/** "07:00" → "7:00 am". Agencies say it out loud, and 0700 reads as a number. */
export function sayTime(hhmm: string): string {
  const total = minutesOf(hhmm);
  if (!Number.isFinite(total)) return hhmm;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const suffix = hours < 12 ? 'am' : 'pm';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/* ------------------------------------------------------------------ */
/* The pattern                                                         */
/* ------------------------------------------------------------------ */

export interface ShiftPattern {
  /** Changeover times in local wall clock, "HH:MM". */
  starts: string[];
  /** What the agency calls each one. Same length as `starts`. */
  names: string[];
}

/**
 * Three eights, which is what most departments run.
 *
 * A default rather than a guess left blank: a briefing screen that refuses to
 * draw until somebody has configured shift times is a screen nobody sees, and
 * the cost of the default being wrong is that the boundaries are off by an
 * hour until an administrator says otherwise — visible, and fixable in the one
 * place that fixes it.
 */
export const DEFAULT_PATTERN: ShiftPattern = {
  starts: ['07:00', '15:00', '23:00'],
  names: ['Day', 'Evening', 'Night'],
};

export interface PatternProblem {
  message: string;
  tip?: string;
}

export function checkPattern(pattern: ShiftPattern): PatternProblem[] {
  const problems: PatternProblem[] = [];
  if (pattern.starts.length === 0) {
    problems.push({ message: 'There are no shifts.', tip: 'Add at least one changeover time.' });
    return problems;
  }
  if (pattern.starts.length !== pattern.names.length) {
    problems.push({ message: 'Every shift needs a name.' });
  }
  for (const start of pattern.starts) {
    if (!isTimeOfDay(start)) {
      problems.push({ message: `"${start}" is not a time.`, tip: 'Use 24-hour times like 07:00 or 18:30.' });
    }
  }
  const minutes = pattern.starts.filter(isTimeOfDay).map(minutesOf);
  if (new Set(minutes).size !== minutes.length) {
    problems.push({
      message: 'Two shifts start at the same time.',
      tip: 'One of them would never be reached.',
    });
  }
  if (pattern.names.some((name) => !name.trim())) {
    problems.push({ message: 'A shift has no name.', tip: 'Whatever the shift is called on the roster.' });
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* Boundaries                                                          */
/* ------------------------------------------------------------------ */

export interface Shift {
  name: string;
  /** Inclusive, as an instant. */
  start: string;
  /** Exclusive, as an instant. */
  end: string;
}

/** Local midnight on the day containing `at`. */
function midnight(at: Date): Date {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day;
}

/** Sorted changeovers, dropping anything unusable rather than throwing. */
function ordered(pattern: ShiftPattern): { name: string; minutes: number }[] {
  const rows = pattern.starts
    .map((start, index) => ({ name: pattern.names[index] ?? `Shift ${index + 1}`, minutes: minutesOf(start) }))
    .filter((row) => Number.isFinite(row.minutes));
  rows.sort((a, b) => a.minutes - b.minutes);
  return rows.length > 0 ? rows : [{ name: 'Day', minutes: 0 }];
}

/**
 * The shift that a moment falls inside.
 *
 * Works backwards from the changeovers on the day containing `at`, and where
 * `at` falls before the first one it belongs to the last shift of the day
 * before — which is the overnight case, and the whole reason this is not a
 * two-line function.
 */
export function shiftAt(pattern: ShiftPattern, at: Date): Shift {
  const rows = ordered(pattern);
  const base = midnight(at);
  const minutesIn = (at.getTime() - base.getTime()) / 60_000;

  const startOf = (index: number, dayOffset: number): Date => {
    const when = new Date(base);
    when.setDate(when.getDate() + dayOffset);
    when.setMinutes(when.getMinutes() + rows[index].minutes);
    return when;
  };

  // The last changeover at or before `at`, on this day.
  let index = -1;
  for (let i = 0; i < rows.length; i += 1) if (rows[i].minutes <= minutesIn) index = i;

  if (index === -1) {
    // Before the first changeover: still yesterday's last shift.
    const last = rows.length - 1;
    return {
      name: rows[last].name,
      start: startOf(last, -1).toISOString(),
      end: startOf(0, 0).toISOString(),
    };
  }

  const isLast = index === rows.length - 1;
  return {
    name: rows[index].name,
    start: startOf(index, 0).toISOString(),
    end: isLast ? startOf(0, 1).toISOString() : startOf(index + 1, 0).toISOString(),
  };
}

/** The shift now, and the one that has just handed over to it. */
export function currentShift(pattern: ShiftPattern, now: Date = new Date()): Shift {
  return shiftAt(pattern, now);
}

export function outgoingShift(pattern: ShiftPattern, now: Date = new Date()): Shift {
  const current = shiftAt(pattern, now);
  // One millisecond before this one began is, by definition, inside the last.
  return shiftAt(pattern, new Date(new Date(current.start).getTime() - 1));
}

/** The shift before a given one, for stepping back through the week. */
export function shiftBefore(pattern: ShiftPattern, shift: Shift): Shift {
  return shiftAt(pattern, new Date(new Date(shift.start).getTime() - 1));
}

export function shiftAfter(pattern: ShiftPattern, shift: Shift): Shift {
  return shiftAt(pattern, new Date(shift.end));
}

/** Whether an instant falls inside a shift. Start inclusive, end exclusive. */
export function within(shift: Shift, iso: string): boolean {
  if (!iso) return false;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return false;
  return at >= new Date(shift.start).getTime() && at < new Date(shift.end).getTime();
}

/** "Night, Tuesday 10 March, 11:00 pm to 7:00 am". What a briefing is headed. */
export function describe(shift: Shift): string {
  const start = new Date(shift.start);
  const end = new Date(shift.end);
  const day = start.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const clock = (at: Date) =>
    at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return `${shift.name}, ${day}, ${clock(start)} to ${clock(end)}`;
}
