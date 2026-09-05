/**
 * Who is working, where, and in what.
 *
 * A sergeant briefing a shift is holding two things: what happened, and the
 * line-up. The second one is currently a whiteboard, and everything downstream
 * of it — which beat has nobody on it tonight, which car the new officer took,
 * who to raise when a call drops in the north end — is a question answered by
 * looking up at that whiteboard or by asking on the radio.
 *
 * This is the whiteboard, with three things it could not do.
 *
 * It knows what the agency calls a beat, because departments say beat, zone,
 * district and reporting district and using the wrong word makes software feel
 * foreign on day one. It carries a vehicle number as free text as well as a
 * link to the fleet, because plenty of agencies do not assign cars — an
 * officer takes whatever is on the lot, and a roster that insisted on a
 * permanent assignment would be a roster nobody could fill in. And it says
 * which beats have nobody on them, which is the one thing a whiteboard is bad
 * at: absence does not draw itself.
 *
 * A roster is entered, not derived. That is a departure from the rest of this
 * codebase and it is deliberate: who is actually on tonight is not a function
 * of anything the system knows. People swap, call in sick, get held over on a
 * scene, and take a different car because theirs is in the shop. The parts
 * that *can* be derived — whether a car is out of service, whether two people
 * are down for the same one — are derived, and the rest is somebody typing
 * what is true.
 */

import type { UUID } from './person';
import type { GeoFeatureCollection } from './geo';
import { featureName } from './geo';

/**
 * The beats an agency has, read off the map it already uploaded.
 *
 * Not a second list to maintain. An agency that has loaded its patrol areas
 * has already said what its beats are called, and asking them to type the same
 * names again is how the two lists end up disagreeing — at which point the
 * coverage panel is wrong and nobody can tell which half.
 */
export function beatsOf(zones: GeoFeatureCollection | null): string[] {
  if (!zones) return [];
  const names = zones.features.map((f) => featureName(f)).filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/* ------------------------------------------------------------------ */
/* Standing                                                            */
/* ------------------------------------------------------------------ */

/**
 * Why somebody's name is on the sheet.
 *
 * Off, leave, training and court are separate from simply not being listed,
 * because they are different answers to "can I call them in". A name that is
 * absent tells the sergeant nothing; a name marked "court" tells them where
 * that officer is and roughly when they are back.
 */
export type Standing = 'on' | 'off' | 'leave' | 'training' | 'court';

export const STANDING_LABEL: Record<Standing, string> = {
  on: 'On duty',
  off: 'Off',
  leave: 'Leave',
  training: 'Training',
  court: 'Court',
};

/** Standings that put somebody on the street. Only these cover a beat. */
export const WORKING: Standing[] = ['on'];

/* ------------------------------------------------------------------ */
/* The sheet                                                           */
/* ------------------------------------------------------------------ */

export interface RosterEntry {
  id: UUID;
  /** The account, when the person has one. Blank for a reserve or a cadet. */
  officerId: UUID | '';
  /** Denormalised, so a roster reads without resolving every account. */
  officerName: string;
  badge: string;

  /** Beat, zone, district — whatever `agency.zoneLabel` calls it. */
  beat: string;
  /**
   * The unit number on the radio.
   *
   * Free text on purpose. An agency with assigned cars picks one from the
   * fleet and this holds its unit number; an agency without picks whatever is
   * on the lot and types it. Both are the same field because both answer the
   * same question, which is what to say on the radio.
   */
  vehicle: string;
  /** The fleet record, when the vehicle came from there. Empty otherwise. */
  cruiserId: UUID | '';
  /**
   * How they are raised when it is not the car — "Patrol 12", "Sgt 1".
   *
   * Separate from the vehicle because they come apart constantly: two officers
   * in one car, an officer in an unmarked, a supervisor who is a call sign and
   * no car at all.
   */
  callSign: string;

  standing: Standing;
  /** Held over, riding with, back at ten — the thing the sheet exists for. */
  note: string;
}

export interface Roster {
  id: UUID;
  /**
   * The shift this is the line-up for, as the instant it began.
   *
   * The shift itself is derived from the agency's changeover times, so this is
   * the only thing worth storing: a roster keyed by name and date would break
   * the first time an agency changed its pattern.
   */
  shiftStart: string;
  shiftName: string;
  entries: RosterEntry[];
  updatedById: UUID | '';
  updatedByName: string;
  updatedAt: string;
}

export function createEntry(partial: Partial<RosterEntry> = {}): RosterEntry {
  return {
    id: '',
    officerId: '',
    officerName: '',
    badge: '',
    beat: '',
    vehicle: '',
    cruiserId: '',
    callSign: '',
    standing: 'on',
    note: '',
    ...partial,
  };
}

export function createRoster(partial: Partial<Roster> = {}): Roster {
  return {
    id: '',
    shiftStart: '',
    shiftName: '',
    entries: [],
    updatedById: '',
    updatedByName: '',
    updatedAt: '',
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* Reading one                                                         */
/* ------------------------------------------------------------------ */

/** Everybody actually on the street, in the order the sheet lists them. */
export function onDuty(roster: Roster | null): RosterEntry[] {
  if (!roster) return [];
  return roster.entries.filter((e) => WORKING.includes(e.standing));
}

/** "Reyes 4417 · 3B · 12", the line somebody reads out. */
export function describeEntry(entry: RosterEntry): string {
  return [
    entry.officerName || 'Unnamed',
    entry.beat,
    entry.vehicle || entry.callSign,
  ]
    .filter((part) => part && part.trim())
    .join(' · ');
}

export interface Coverage {
  /** Beats with somebody on them, and who. */
  covered: { beat: string; who: string[] }[];
  /** Beats the agency has that nobody is on. The reason this exists. */
  uncovered: string[];
  /** People on duty with no beat written against them. */
  unassigned: RosterEntry[];
}

/**
 * Which beats are covered tonight, and which are not.
 *
 * The uncovered list is the point. A whiteboard shows what somebody wrote on
 * it, so a beat nobody is on is a blank space, and a blank space among eleven
 * other blank spaces is invisible. Naming it is the difference between a
 * sergeant noticing at briefing and noticing when a call drops there.
 *
 * `beats` is what the agency says its beats are. Passed in rather than
 * inferred from the roster, because inferring them would mean a beat is only
 * uncovered if somebody was on it earlier, which is exactly backwards.
 */
export function coverage(roster: Roster | null, beats: string[]): Coverage {
  const working = onDuty(roster);
  const byBeat = new Map<string, string[]>();
  const unassigned: RosterEntry[] = [];

  for (const entry of working) {
    const beat = entry.beat.trim();
    if (!beat) {
      unassigned.push(entry);
      continue;
    }
    const who = byBeat.get(beat) ?? [];
    who.push(entry.officerName || 'Unnamed');
    byBeat.set(beat, who);
  }

  const known = beats.map((b) => b.trim()).filter(Boolean);
  /*
    Beats somebody is on that the agency has never heard of still count as
    covered. Typos happen, and so do temporary beats for an event; either way
    the officer is out there and saying otherwise would be a lie.
  */
  const all = [...new Set([...known, ...byBeat.keys()])];

  return {
    covered: all
      .filter((beat) => byBeat.has(beat))
      .map((beat) => ({ beat, who: byBeat.get(beat)! })),
    uncovered: known.filter((beat) => !byBeat.has(beat)),
    unassigned,
  };
}

/* ------------------------------------------------------------------ */
/* What is wrong with it                                               */
/* ------------------------------------------------------------------ */

export interface RosterProblem {
  /** The entry it is about, or empty when it is about the sheet as a whole. */
  entryId: string;
  title: string;
  message: string;
  /** What to do, in one sentence. */
  tip: string;
  severity: 'error' | 'warning';
}

/** What the fleet says about a car, for the checks that need it. */
export interface FleetView {
  /** Unit numbers that are not on the road, and why. */
  outOfService: Record<string, string>;
}

/**
 * Checks a sheet, without refusing to save it.
 *
 * Everything here is a warning except the two things that make a roster
 * meaningless: the same person listed twice, and an entry with no name. A
 * roster is filled in at changeover by somebody who is already late, and a
 * form that refuses to save because two officers are in one car is a form
 * they stop using — double units are real, and so is a car that came back
 * from the shop an hour ago and the fleet record has not caught up.
 */
export function check(roster: Roster, fleet: FleetView = { outOfService: {} }): RosterProblem[] {
  const problems: RosterProblem[] = [];
  const seenOfficer = new Map<string, string>();
  const seenVehicle = new Map<string, string[]>();

  for (const entry of roster.entries) {
    if (!entry.officerName.trim()) {
      problems.push({
        entryId: entry.id,
        title: 'A line with no name',
        message: 'One of the rows has no officer on it.',
        tip: 'Put a name against it or take the row off the sheet.',
        severity: 'error',
      });
    }

    const key = entry.officerId || entry.officerName.trim().toLowerCase();
    if (key) {
      if (seenOfficer.has(key)) {
        problems.push({
          entryId: entry.id,
          title: `${entry.officerName || 'Somebody'} is on the sheet twice`,
          message: 'The same officer appears on two rows of this roster.',
          tip: 'Take one of the rows off, or correct the name on it.',
          severity: 'error',
        });
      } else {
        seenOfficer.set(key, entry.id);
      }
    }

    const unit = entry.vehicle.trim();
    if (unit && WORKING.includes(entry.standing)) {
      seenVehicle.set(unit, [...(seenVehicle.get(unit) ?? []), entry.officerName || 'Unnamed']);
      const why = fleet.outOfService[unit];
      if (why) {
        problems.push({
          entryId: entry.id,
          title: `Car ${unit} is not on the road`,
          message: `The fleet record says it is out of service: ${why}`,
          tip: 'Give them a different car, or put the fleet record right.',
          severity: 'warning',
        });
      }
    }
  }

  /*
    Two in one car is ordinary — a trainee rides with a field training officer
    for months. It is worth saying once, because it is also what a typo looks
    like, and nothing else on this screen would catch that.
  */
  for (const [unit, who] of seenVehicle) {
    if (who.length > 1) {
      problems.push({
        entryId: '',
        title: `${who.join(' and ')} are both in car ${unit}`,
        message: 'Two officers on duty are down for the same vehicle.',
        tip: 'Fine if they are riding together — otherwise one of them is in a different car.',
        severity: 'warning',
      });
    }
  }

  if (onDuty(roster).length === 0 && roster.entries.length > 0) {
    problems.push({
      entryId: '',
      title: 'Nobody is on duty',
      message: 'Every name on this roster is off, on leave, at training or at court.',
      tip: 'If somebody is working this shift, set their standing to on duty.',
      severity: 'warning',
    });
  }

  return problems;
}

export function blockingProblems(problems: RosterProblem[]): RosterProblem[] {
  return problems.filter((p) => p.severity === 'error');
}

/* ------------------------------------------------------------------ */
/* Starting the next one                                               */
/* ------------------------------------------------------------------ */

/**
 * A sheet for the next shift, started from the last one like it.
 *
 * A roster typed from nothing every eight hours is a roster that gets typed
 * once. The same squad works the same shift with the same beats and mostly
 * the same cars, so the previous sheet for this shift name is very nearly
 * right, and the sergeant's job becomes correcting three lines rather than
 * writing twelve.
 *
 * What does not carry over is the notes and anybody's absence. "Back at ten"
 * was true last Tuesday; carrying it forward would put a stale sentence in
 * front of somebody who has every reason to believe it, and an officer
 * silently still marked on leave is worse — the sheet would show a beat
 * uncovered that somebody is in fact standing on.
 */
export function startFrom(previous: Roster | null, shiftStart: string, shiftName: string): Roster {
  return createRoster({
    shiftStart,
    shiftName,
    entries: (previous?.entries ?? []).map((entry) =>
      createEntry({
        ...entry,
        id: '',
        standing: 'on',
        note: '',
      }),
    ),
  });
}
