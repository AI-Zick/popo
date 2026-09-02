/**
 * NIBRS submission file.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  Field positions here follow the FBI's NIBRS flat-file layout, but **every
 *  state modifies it.** Alabama, Texas and Virginia all accept different
 *  variants, several require extra state-specific segments, and a growing
 *  number take NIBRS XML instead of fixed width. This module is the right
 *  shape and must be reconciled against the receiving state's own
 *  specification before a single file is submitted.
 * ─────────────────────────────────────────────────────────────────────
 *
 * The structure is six segment levels, one line each:
 *
 *   1  Administrative — one per incident
 *   2  Offense        — one per offense
 *   3  Property       — one per property record
 *   4  Victim         — one per victim
 *   5  Offender       — one per suspect or arrestee
 *   6  Arrestee       — one per arrest
 *
 * Everything is a pure function of the incident so the same code can run in the
 * browser for a preview and on the server for the real file.
 */

import type { Incident } from './types';
import type { AgencyProfile } from './agency';
import type { MasterLocation } from './location';
import type { Person, PersonIndex } from './person';
import { resolvePeople } from './person';
import { OFFENSE_BY_CODE } from './codes';

/* ------------------------------------------------------------------ */
/* Field helpers                                                       */
/* ------------------------------------------------------------------ */

/** Left-justified, space-padded, truncated to width. */
export function alpha(value: string | undefined | null, width: number): string {
  return String(value ?? '')
    .toUpperCase()
    .slice(0, width)
    .padEnd(width, ' ');
}

/** Right-justified, zero-padded. Non-numeric input becomes zeros. */
export function numeric(value: string | number | undefined | null, width: number): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.slice(-width).padStart(width, '0');
}

/**
 * Right-justified, zero-padded — but spaces when there is nothing to say.
 *
 * An age of `00` is a claim that the person is a newborn, and a premises-entered
 * count of `00` on an offense that has no such count is a claim the state's edit
 * checks will reject. Optional numeric fields go out blank.
 */
export function numericOrBlank(value: string | number | undefined | null, width: number): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? digits.slice(-width).padStart(width, '0') : ' '.repeat(width);
}

/** `YYYYMMDD`, or spaces when there is no date. A blank date is not zeroes. */
export function dateField(value: string | undefined | null): string {
  if (!value) return ' '.repeat(8);
  const date = new Date(value.length === 10 ? `${value}T00:00` : value);
  if (Number.isNaN(date.getTime())) return ' '.repeat(8);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/** Hour of day as `HH`, or spaces. Used where the time is optional. */
export function hourField(value: string | undefined | null): string {
  if (!value) return '  ';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '  ';
  return String(date.getHours()).padStart(2, '0');
}

/* ------------------------------------------------------------------ */
/* Segments                                                            */
/* ------------------------------------------------------------------ */

export type SegmentLevel = '1' | '2' | '3' | '4' | '5' | '6';

export interface Segment {
  level: SegmentLevel;
  line: string;
}

const ACTION_ADD = 'I'; // Incident report. 'D' would delete a previously sent one.

function clearanceCode(incident: Incident): string {
  switch (incident.clearanceStatus) {
    case 'cleared_exceptional':
      return incident.exceptionalClearanceReason || 'A';
    case 'cleared_arrest':
      return 'N'; // Arrest is reported through the arrestee segment, not here.
    default:
      return 'N';
  }
}

/** Level 1 — one per incident. */
export function administrativeSegment(
  incident: Incident,
  agency: AgencyProfile,
  location: MasterLocation | undefined,
): Segment {
  const line =
    '1' +
    alpha(agency.ori, 9) +
    alpha(incident.caseNumber, 12) +
    dateField(incident.occurredFrom) +
    // "Report indicator": R when the exact date is unknown and this is the
    // date it was reported instead.
    (incident.occurredFrom ? ' ' : 'R') +
    hourField(incident.occurredFrom) +
    alpha(clearanceCode(incident), 1) +
    dateField(incident.clearedAt) +
    alpha(ACTION_ADD, 1) +
    alpha(location?.beat, 4);
  return { level: '1', line };
}

/** Level 2 — one per offense. */
export function offenseSegments(incident: Incident, agency: AgencyProfile): Segment[] {
  return incident.offenses.map((offense) => {
    const def = OFFENSE_BY_CODE.get(offense.code);
    const line =
      '2' +
      alpha(agency.ori, 9) +
      alpha(incident.caseNumber, 12) +
      alpha(offense.code, 3) +
      alpha(offense.attemptCompleted || 'C', 1) +
      // Up to three criminal activity codes, then three weapon codes.
      alpha(offense.criminalActivity.slice(0, 3).join(''), 3) +
      alpha(offense.locationType, 2) +
      numericOrBlank(def?.isBurglary ? offense.premisesEntered : '', 2) +
      alpha(def?.isBurglary ? offense.methodOfEntry : '', 1) +
      alpha(offense.weapons.slice(0, 3).join(''), 6) +
      alpha(offense.biasMotivation || '88', 2);
    return { level: '2' as const, line };
  });
}

/** Level 3 — one per property record. */
export function propertySegments(incident: Incident, agency: AgencyProfile): Segment[] {
  return incident.property.map((item) => {
    const line =
      '3' +
      alpha(agency.ori, 9) +
      alpha(incident.caseNumber, 12) +
      alpha(lossTypeCode(item.lossType), 1) +
      alpha(item.descriptionCode, 2) +
      // Values are whole dollars, right-justified.
      numericOrBlank(item.value ? Math.round(Number(item.value.replace(/[^0-9.]/g, '')) || 0) : '', 9) +
      dateField(item.dateRecovered) +
      alpha(item.drugType, 1) +
      numericOrBlank(item.drugQuantity, 9) +
      alpha(item.drugMeasurement, 2);
    return { level: '3' as const, line };
  });
}

function lossTypeCode(loss: string): string {
  const map: Record<string, string> = {
    none: '1',
    burned: '2',
    counterfeit: '3',
    destroyed: '4',
    recovered: '5',
    seized: '6',
    stolen: '7',
    unknown: '8',
  };
  return map[loss] ?? '8';
}

/** Sequence numbers are per incident and referenced across segments. */
function sequence(index: number): string {
  return numeric(index + 1, 3);
}

/** Level 4 — one per victim. */
export function victimSegments(
  incident: Incident,
  agency: AgencyProfile,
  persons: Person[],
): Segment[] {
  const victims = persons.filter((p) => p.role === 'victim');
  const offenderIndex = new Map(
    persons.filter((p) => p.role === 'suspect' || p.role === 'arrestee').map((p, i) => [p.id, i]),
  );

  return victims.map((victim, index) => {
    // Offense codes this victim is connected to, up to ten.
    const connected = incident.offenses
      .filter((o) => victim.offenseIds.includes(o.id) || victim.offenseIds.length === 0)
      .slice(0, 10)
      .map((o) => alpha(o.code, 3))
      .join('');

    const relationship = victim.relationships[0];
    const line =
      '4' +
      alpha(agency.ori, 9) +
      alpha(incident.caseNumber, 12) +
      sequence(index) +
      alpha(connected, 30) +
      alpha(victim.victimType, 1) +
      // Age is a two-character field: a number, or NN/NB/BB for infants.
      numericOrBlank(ageFrom(victim, incident), 2) +
      alpha(victim.sex, 1) +
      alpha(victim.race, 1) +
      alpha(victim.ethnicity, 1) +
      alpha(victim.injuries.slice(0, 5).join(''), 5) +
      // Relationship is reported against the offender's sequence number.
      numericOrBlank(relationship ? (offenderIndex.get(relationship.offenderId) ?? 0) + 1 : '', 3) +
      alpha(relationship?.relationship, 2);
    return { level: '4' as const, line };
  });
}

function ageFrom(person: Person, incident: Incident): string {
  if (!person.dob) return person.ageFrom || '';
  const reference = new Date(incident.occurredFrom || incident.reportedAt);
  const birth = new Date(person.dob);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(reference.getTime())) return '';
  let age = reference.getFullYear() - birth.getFullYear();
  const m = reference.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && reference.getDate() < birth.getDate())) age -= 1;
  return String(Math.max(0, age));
}

/** Level 5 — one per suspect or arrestee. */
export function offenderSegments(
  incident: Incident,
  agency: AgencyProfile,
  persons: Person[],
): Segment[] {
  const offenders = persons.filter((p) => p.role === 'suspect' || p.role === 'arrestee');

  // An incident with no known offender still reports one "unknown" offender.
  if (offenders.length === 0) {
    return [
      {
        level: '5',
        line:
          '5' +
          alpha(agency.ori, 9) +
          alpha(incident.caseNumber, 12) +
          '000' +
          '  ' +
          ' ' +
          ' ' +
          ' ',
      },
    ];
  }

  return offenders.map((offender, index) => ({
    level: '5' as const,
    line:
      '5' +
      alpha(agency.ori, 9) +
      alpha(incident.caseNumber, 12) +
      sequence(index) +
      numericOrBlank(ageFrom(offender, incident), 2) +
      alpha(offender.sex, 1) +
      alpha(offender.race, 1) +
      alpha(offender.ethnicity, 1),
  }));
}

/** Level 6 — one per arrest. */
export function arresteeSegments(
  incident: Incident,
  agency: AgencyProfile,
  persons: Person[],
): Segment[] {
  return persons
    .filter((p) => p.role === 'arrestee')
    .map((arrestee, index) => ({
      level: '6' as const,
      line:
        '6' +
        alpha(agency.ori, 9) +
        alpha(incident.caseNumber, 12) +
        sequence(index) +
        alpha(arrestee.charges[0]?.statute, 12) +
        dateField(arrestee.arrestDate) +
        alpha(arrestee.arrestType, 1) +
        // Multiple-arrest indicator: N when this is the only arrest.
        alpha(persons.filter((p) => p.role === 'arrestee').length > 1 ? 'M' : 'N', 1) +
        alpha(incident.offenses[0]?.code, 3) +
        numericOrBlank(ageFrom(arrestee, incident), 2) +
        alpha(arrestee.sex, 1) +
        alpha(arrestee.race, 1) +
        alpha(arrestee.ethnicity, 1),
    }));
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

export interface ExportResult {
  /** The file contents, one segment per line. */
  content: string;
  /** Incidents written. */
  included: string[];
  /** Incidents held back, with the reason. */
  excluded: { caseNumber: string; reason: string }[];
  segmentCount: number;
}

export interface ExportInput {
  incidents: Incident[];
  agency: AgencyProfile;
  people: PersonIndex;
  locations: Record<string, MasterLocation>;
  /** Blocking validation problems, keyed by incident id. */
  errorsByIncident: Record<string, number>;
}

/**
 * Builds the submission.
 *
 * Only approved reports go in. A draft is by definition unfinished, and a
 * report still in review has not been checked by anyone — submitting either to
 * the state would mean the agency's published crime figures include work
 * nobody has signed off.
 */
export function buildExport(input: ExportInput): ExportResult {
  const lines: string[] = [];
  const included: string[] = [];
  const excluded: { caseNumber: string; reason: string }[] = [];

  for (const incident of input.incidents) {
    if (incident.status !== 'approved') {
      excluded.push({
        caseNumber: incident.caseNumber,
        reason:
          incident.status === 'pending_review'
            ? 'Still waiting on a supervisor'
            : incident.status === 'returned'
              ? 'Sent back for correction'
              : 'Still a draft',
      });
      continue;
    }

    const errors = input.errorsByIncident[incident.id] ?? 0;
    if (errors > 0) {
      excluded.push({
        caseNumber: incident.caseNumber,
        reason: `${errors} unresolved validation ${errors === 1 ? 'problem' : 'problems'}`,
      });
      continue;
    }

    if (!input.agency.ori) {
      excluded.push({ caseNumber: incident.caseNumber, reason: 'The agency has no ORI set' });
      continue;
    }

    const persons = resolvePeople(incident.persons, input.people);
    const location = input.locations[incident.locationId];

    const segments = [
      administrativeSegment(incident, input.agency, location),
      ...offenseSegments(incident, input.agency),
      ...propertySegments(incident, input.agency),
      ...victimSegments(incident, input.agency, persons),
      ...offenderSegments(incident, input.agency, persons),
      ...arresteeSegments(incident, input.agency, persons),
    ];

    for (const segment of segments) lines.push(segment.line);
    included.push(incident.caseNumber);
  }

  return {
    content: lines.join('\n') + (lines.length ? '\n' : ''),
    included,
    excluded,
    segmentCount: lines.length,
  };
}

/** `AL0010200_20260902.txt` — ORI and date, which is what states expect. */
export function exportFilename(agency: AgencyProfile, at = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  return `${agency.ori || 'NOORI'}_${stamp}.txt`;
}
