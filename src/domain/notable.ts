/**
 * The part of a briefing that gets read out.
 *
 * "Six reports, two arrests, eleven traffic stops" is a number a sergeant can
 * announce and nobody can use. The shift going out wants to hear what actually
 * happened: who was arrested and for what, which house the domestic was at,
 * whether the man with the knife is still outstanding. Those are sentences,
 * not counts, and a briefing screen that shows a case number and a timestamp
 * is a call log with better typography.
 *
 * So this picks the things worth saying aloud and says them. Everything else
 * stays in the tallies above it, which is where a number belongs: the shift
 * learns that there were eleven stops without hearing about each one.
 *
 * Two rules decide what makes the list.
 *
 * **Every arrest.** Somebody was taken into custody by this agency in the last
 * eight hours. The next shift inherits the court date, the property, and the
 * person's family at the front counter, and there is no arrest so minor that
 * it should reach them as part of a total.
 *
 * **Cases the next shift may still be standing in.** Violence, a weapon, a
 * burglary, a domestic — the ones where the offender is often still out, the
 * address is going to be called again tonight, or the victim will ring back.
 * A shoplift that was resolved at the store is not on this list, and putting
 * it there would cost the list the only thing that makes it useful, which is
 * that everything on it is worth stopping for.
 *
 * What this is not is a legal classification. Whether an offense is a felony
 * is a question of the statute charged and the state it was charged in, and
 * this file knows neither — arrests carry a real severity because an officer
 * chose one per charge, and incidents carry an NIBRS code, which is a
 * reporting category. So the flags say what the record actually says, and the
 * word "felony" appears only where somebody typed it.
 */

import type { Incident } from './types';
import type { Arrest } from './arrest';
import { leadCharge, describeCharges } from './arrest';
import type { MasterLocation } from './location';
import { locationLabel } from './location';
import { DOMESTIC_RELATIONSHIPS, OFFENSE_BY_CODE, WEAPONS } from './codes';
import type { Happened } from './briefing';

/* ------------------------------------------------------------------ */
/* What counts                                                         */
/* ------------------------------------------------------------------ */

/**
 * Offense codes read out one by one rather than counted, and why.
 *
 * The reason is the badge, so it has to be a word somebody would use at a
 * podium. Drugs and fraud are deliberately absent: both are high-volume, both
 * are usually finished by the time the report is written, and a list that
 * includes every possession charge is a list the shift stops listening to.
 */
export const READ_ALOUD = new Map<string, string>([
  ['09A', 'Homicide'],
  ['09B', 'Homicide'],
  ['100', 'Kidnapping'],
  ['11A', 'Sex offense'],
  ['11B', 'Sex offense'],
  ['11D', 'Sex offense'],
  ['120', 'Robbery'],
  ['13A', 'Aggravated assault'],
  ['200', 'Arson'],
  ['220', 'Burglary'],
  ['240', 'Vehicle theft'],
  ['520', 'Weapons'],
]);

/**
 * Weapon codes that mean somebody was armed.
 *
 * Not every weapon code does. "Personal weapons" is hands and feet, which is
 * how most simple assaults are recorded and tells the next shift nothing;
 * "unknown" and "none" say less than that. A briefing that announced a weapon
 * on every fistfight would be one where the word stopped meaning a gun.
 */
const ARMED = new Set(['11', '12', '13', '14', '15', '20', '30', '60', '65']);

const WEAPON_LABEL = new Map(WEAPONS.map((w) => [w.value, w.label]));

/* ------------------------------------------------------------------ */
/* One line of a briefing                                              */
/* ------------------------------------------------------------------ */

export interface Notable {
  kind: 'arrest' | 'case';
  id: string;
  /** The case or arrest number, for anybody who wants to pull the file. */
  number: string;
  at: string;
  /** Whose it is, so the question goes to the right person in the room. */
  who: string;
  /** What it was, in the words a sergeant would use. */
  headline: string;
  /** Where, and the one or two facts that change what the shift does. */
  detail: string;
  /** Why it is being read out at all. */
  flags: string[];
  /** How loud. Drives the badge and the order. */
  tone: 'danger' | 'warn';
}

/** Somewhere to look an incident's location up. Optional; it only adds detail. */
export type Places = Record<string, MasterLocation>;

/* ------------------------------------------------------------------ */
/* Building one                                                        */
/* ------------------------------------------------------------------ */

/**
 * Whether a case is domestic, asked of the record rather than the checkbox.
 *
 * The flag on the report is the officer's declaration, and the victim-offender
 * relationships are the facts underneath it. They disagree more often than
 * anybody would like — a report is written at four in the morning and the box
 * is missed — and a case that is domestic in fact but not in flag is exactly
 * the one worth reading out. So either is enough.
 */
export function domestic(incident: Incident): boolean {
  if (incident.isDomestic) return true;
  return (incident.persons ?? []).some((person) =>
    (person.relationships ?? []).some((r) => DOMESTIC_RELATIONSHIPS.has(r.relationship)),
  );
}

/** Weapons recorded on any offense, by name, without the ones that mean none. */
export function weaponsOn(incident: Incident): string[] {
  const found = new Set<string>();
  for (const offense of incident.offenses ?? []) {
    for (const weapon of offense.weapons ?? []) {
      if (ARMED.has(weapon)) found.add(WEAPON_LABEL.get(weapon) ?? weapon);
    }
  }
  return [...found];
}

function place(incident: Incident, places: Places): string {
  const location = places[incident.locationId];
  if (!location) return '';
  const label = locationLabel(location);
  return incident.locationUnit ? `${label} ${incident.locationUnit}` : label;
}

/**
 * The offenses on a case, named, commonest kind first.
 *
 * Reads the code table rather than the statute, because a briefing is spoken
 * and "Burglary" is what somebody says. The statute is on the report for the
 * people whose job is the statute.
 */
function offenseNames(incident: Incident): string[] {
  const names: string[] = [];
  for (const offense of incident.offenses ?? []) {
    const label = OFFENSE_BY_CODE.get(offense.code ?? '')?.label;
    if (label && !names.includes(label)) names.push(label);
  }
  return names;
}

function caseLine(incident: Incident, places: Places): Notable | null {
  /*
    Why it is on the list at all, kept separate from the badges. A burglary is
    read out because it is a burglary, and the headline already says so — a
    badge repeating the word next to it is noise, and noise is what stops
    badges being read. So these decide inclusion and volume, and the badges
    carry only what the headline does not.
  */
  const reasons: string[] = [];
  for (const offense of incident.offenses ?? []) {
    const reason = READ_ALOUD.get(offense.code ?? '');
    if (reason && !reasons.includes(reason)) reasons.push(reason);
  }

  const flags: string[] = [];
  let tone: Notable['tone'] = 'warn';

  /*
    Homicide, sex offenses and robbery are the ones a shift is told about
    before anything else, so they carry the louder badge on their own. The
    rest earn it by being domestic or armed.
  */
  if (reasons.some((r) => r === 'Homicide' || r === 'Sex offense' || r === 'Robbery')) {
    tone = 'danger';
  }

  const isDomestic = domestic(incident);
  if (isDomestic) {
    flags.push('Domestic');
    tone = 'danger';
  }

  const weapons = weaponsOn(incident);
  if (weapons.length > 0) {
    flags.push(weapons.length === 1 ? weapons[0] : 'Armed');
    tone = 'danger';
  }

  /*
    A hate crime is read out whatever the offense underneath it was. Criminal
    damage to a wall is a tally line; the same damage as a hate crime is the
    thing the shift is going to be asked about, and it belongs in the part of
    the briefing somebody says aloud.
  */
  if (incident.isHateCrime) {
    flags.push('Hate crime');
    tone = 'danger';
  }
  if (incident.isGangRelated) flags.push('Gang related');

  // Nothing about it is worth a sentence; it belongs in the tallies.
  if (reasons.length === 0 && flags.length === 0) return null;

  const names = offenseNames(incident);
  const where = place(incident, places);
  const detail = [
    where,
    /*
      Weapons appear in the flags too, and the repetition is deliberate: a
      badge is read at a glance and a sentence is read aloud, and the shift
      needs the sentence to make sense on its own when somebody repeats it
      over the radio.
    */
    weapons.length > 0 ? `Weapon: ${weapons.join(', ')}.` : '',
    incident.involvesJuvenile ? 'A juvenile is involved.' : '',
    incident.clearanceStatus === 'open' || !incident.clearanceStatus
      ? 'Still open.'
      : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    kind: 'case',
    id: incident.id,
    number: incident.caseNumber || 'No case number yet',
    at: incident.reportedAt,
    who: incident.reportingOfficer ?? '',
    headline: names.length > 0 ? names.join(', ') : 'No offense recorded',
    detail,
    flags,
    tone,
  };
}

function arrestLine(arrest: Arrest): Notable {
  const lead = leadCharge(arrest);
  const felony = arrest.charges.some((c) => c.severity === 'felony');

  const flags: string[] = [];
  if (felony) flags.push('Felony');
  if (arrest.juvenile) flags.push('Juvenile');
  if (!arrest.releasedAt) flags.push('In custody');

  const detail = [
    arrest.arrestLocation,
    arrest.caseNumber ? `Case ${arrest.caseNumber}.` : '',
    arrest.courtDate ? `Court ${arrest.courtDate}.` : '',
    /*
      Bond and the release both belong here for the same reason: the next
      shift is the one who deals with whoever turns up at the counter with
      the money, and with the person themselves if nobody does.
    */
    arrest.bondAmount ? `Bond ${arrest.bondAmount}.` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    kind: 'arrest',
    id: arrest.id,
    number: arrest.arrestNumber || 'No arrest number yet',
    at: arrest.arrestedAt,
    who: arrest.arrestingOfficerName ?? '',
    headline: [arrest.personName || 'Name not recorded', describeCharges(arrest)].join(' — '),
    detail,
    flags,
    tone: felony || (lead?.severity ?? '') === 'felony' ? 'danger' : 'warn',
  };
}

/**
 * What the shift is told about, loudest first and in order within that.
 *
 * Loudest first rather than chronological, because a briefing gets cut short.
 * Somebody's radio goes, half the room walks out, and whatever was at the top
 * is what they heard — so the aggravated assault goes before the shoplift
 * arrest, whatever time each of them happened. Within a tone it runs earliest
 * to latest, which is the order the night actually went.
 */
export function notable(happened: Happened, places: Places = {}): Notable[] {
  const lines: Notable[] = [];
  for (const arrest of happened.arrests) lines.push(arrestLine(arrest));
  for (const incident of happened.incidents) {
    const line = caseLine(incident, places);
    if (line) lines.push(line);
  }
  return lines.sort((a, b) => {
    if (a.tone !== b.tone) return a.tone === 'danger' ? -1 : 1;
    return a.at.localeCompare(b.at);
  });
}
