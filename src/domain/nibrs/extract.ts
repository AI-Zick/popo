/**
 * Incident to values.
 *
 * This is the half of the export that is the same in all fifty states: what a
 * victim's age is, which offenses a victim is connected to, that an incident
 * with no named offender still reports one unknown offender. None of that is a
 * state's opinion — it is what the data means.
 *
 * Each function returns a bag of named values. A state layout then decides
 * which of them appear, in what order and how wide.
 */

import type { Incident } from '../types';
import type { AgencyProfile } from '../agency';
import type { MasterLocation } from '../location';
import type { Person } from '../person';
import { OFFENSE_BY_CODE } from '../codes';
import type {
  SegmentName,
  AdministrativeField,
  ArresteeField,
  HeaderField,
  OffenderField,
  OffenseField,
  PropertyField,
  VictimField,
} from './spec';

export type Values<K extends string> = Partial<Record<K, string>>;

const ACTION_ADD = 'I'; // Incident report. 'D' would delete a previously sent one.

/**
 * The fields every segment repeats.
 *
 * A NIBRS file is a flat list of lines with no nesting, so each one has to say
 * for itself what kind of record it is, whose agency wrote it and which
 * incident it belongs to. Six builders were each spelling that out; a state
 * that carries one more identifier on every record — South Carolina already
 * does — is now one edit rather than six.
 */
function recordKey(
  segmentLevel: string,
  incident: Incident,
  agency: AgencyProfile,
): { segmentLevel: string; ori: string; stateAgencyCode: string; caseNumber: string } {
  return {
    segmentLevel,
    ori: agency.ori,
    stateAgencyCode: agency.stateAgencyCode,
    caseNumber: incident.caseNumber,
  };
}

/**
 * Who NIBRS counts as an offender.
 *
 * Somebody arrested is an offender too — the arrestee segment is additional to
 * the offender segment, not instead of it. Stated once because the victim
 * segment needs the same set, to number its relationships against.
 */
const isOffender = (p: Person) => p.role === 'suspect' || p.role === 'arrestee';

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

export function ageFrom(person: Person, incident: Incident): string {
  if (!person.dob) return person.ageFrom || '';
  const reference = new Date(incident.occurredFrom || incident.reportedAt);
  const birth = new Date(person.dob);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(reference.getTime())) return '';
  let age = reference.getFullYear() - birth.getFullYear();
  const m = reference.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && reference.getDate() < birth.getDate())) age -= 1;
  return String(Math.max(0, age));
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
  return String(index + 1);
}

/* ------------------------------------------------------------------ */
/* Segments                                                            */
/* ------------------------------------------------------------------ */

export function headerValues(
  agency: AgencyProfile,
  counts: { incidents: number; segments: number },
  at: Date,
): Values<HeaderField> {
  return {
    recordType: 'H',
    ori: agency.ori,
    stateAgencyCode: agency.stateAgencyCode,
    agencyName: agency.name,
    stateCode: agency.state,
    periodMonth: String(at.getMonth() + 1),
    periodYear: String(at.getFullYear()),
    incidentCount: String(counts.incidents),
    segmentCount: String(counts.segments),
    generatedDate: at.toISOString().slice(0, 10),
  };
}

export function administrativeValues(
  incident: Incident,
  agency: AgencyProfile,
  location: MasterLocation | undefined,
): Values<AdministrativeField> {
  return {
    ...recordKey('1', incident, agency),
    incidentDate: incident.occurredFrom,
    // 'R' when the exact date is unknown and this is the report date instead.
    reportDateIndicator: incident.occurredFrom ? '' : 'R',
    incidentHour: incident.occurredFrom,
    clearanceCode: clearanceCode(incident),
    clearedDate: incident.clearedAt,
    actionType: ACTION_ADD,
    beat: location?.beat,
  };
}

export function offenseValues(incident: Incident, agency: AgencyProfile): Values<OffenseField>[] {
  return incident.offenses.map((offense) => {
    const def = OFFENSE_BY_CODE.get(offense.code);
    return {
      ...recordKey('2', incident, agency),
      offenseCode: offense.code,
      attemptCompleted: offense.attemptCompleted || 'C',
      criminalActivity: offense.criminalActivity.slice(0, 3).join(''),
      locationType: offense.locationType,
      // Only a burglary carries these two; on anything else they are absent,
      // which is not the same as zero.
      premisesEntered: def?.isBurglary ? offense.premisesEntered : '',
      methodOfEntry: def?.isBurglary ? offense.methodOfEntry : '',
      weapons: offense.weapons.slice(0, 3).join(''),
      biasMotivation: offense.biasMotivation || '88',
      statute: offense.statute,
    };
  });
}

export function propertyValues(incident: Incident, agency: AgencyProfile): Values<PropertyField>[] {
  return incident.property.map((item) => ({
    ...recordKey('3', incident, agency),
    lossType: lossTypeCode(item.lossType),
    descriptionCode: item.descriptionCode,
    // Whole dollars. An item with no value entered goes out blank, not as zero.
    value: item.value ? String(Math.round(Number(item.value.replace(/[^0-9.]/g, '')) || 0)) : '',
    dateRecovered: item.dateRecovered,
    drugType: item.drugType,
    drugQuantity: item.drugQuantity,
    drugMeasurement: item.drugMeasurement,
  }));
}

export function victimValues(
  incident: Incident,
  agency: AgencyProfile,
  persons: Person[],
): Values<VictimField>[] {
  const victims = persons.filter((p) => p.role === 'victim');
  const offenderIndex = new Map(persons.filter(isOffender).map((p, i) => [p.id, i]));

  return victims.map((victim, index) => {
    // Offense codes this victim is connected to, up to ten.
    const connected = incident.offenses
      .filter((o) => victim.offenseIds.includes(o.id) || victim.offenseIds.length === 0)
      .slice(0, 10)
      .map((o) => alphaPad(o.code, 3))
      .join('');

    const relationship = victim.relationships[0];
    return {
      ...recordKey('4', incident, agency),
      sequence: sequence(index),
      connectedOffenses: connected,
      victimType: victim.victimType,
      age: ageFrom(victim, incident),
      sex: victim.sex,
      race: victim.race,
      ethnicity: victim.ethnicity,
      residentStatus: '',
      injuries: victim.injuries.slice(0, 5).join(''),
      // Relationship is reported against the offender's sequence number.
      offenderSequence: relationship
        ? String((offenderIndex.get(relationship.offenderId) ?? 0) + 1)
        : '',
      relationship: relationship?.relationship,
    };
  });
}

/** Connected-offense codes are a packed list, so each entry is padded here. */
function alphaPad(value: string, width: number): string {
  return value.toUpperCase().slice(0, width).padEnd(width, ' ');
}

export function offenderValues(
  incident: Incident,
  agency: AgencyProfile,
  persons: Person[],
): Values<OffenderField>[] {
  const offenders = persons.filter(isOffender);

  // An incident with no known offender still reports one "unknown" offender:
  // NIBRS counts the crime either way, and a submission with no offender
  // segment at all is rejected.
  if (offenders.length === 0) {
    return [
      {
        ...recordKey('5', incident, agency),
        sequence: '0',
        age: '',
        sex: '',
        race: '',
        ethnicity: '',
      },
    ];
  }

  return offenders.map((offender, index) => ({
    ...recordKey('5', incident, agency),
    sequence: sequence(index),
    age: ageFrom(offender, incident),
    sex: offender.sex,
    race: offender.race,
    ethnicity: offender.ethnicity,
  }));
}

export function arresteeValues(
  incident: Incident,
  agency: AgencyProfile,
  persons: Person[],
): Values<ArresteeField>[] {
  const arrestees = persons.filter((p) => p.role === 'arrestee');

  return arrestees.map((arrestee, index) => ({
    ...recordKey('6', incident, agency),
    sequence: sequence(index),
    arrestTransactionNumber: arrestee.charges[0]?.statute,
    arrestDate: arrestee.arrestDate,
    arrestType: arrestee.arrestType,
    multipleArrestIndicator: arrestees.length > 1 ? 'M' : 'N',
    arrestOffenseCode: incident.offenses[0]?.code,
    age: ageFrom(arrestee, incident),
    sex: arrestee.sex,
    race: arrestee.race,
    ethnicity: arrestee.ethnicity,
    residentStatus: '',
    dispositionUnder18: '',
  }));
}

/* ------------------------------------------------------------------ */
/* The segments an incident produces                                   */
/* ------------------------------------------------------------------ */

/** Everything the builders above read, gathered once per incident. */
export interface SegmentSource {
  incident: Incident;
  agency: AgencyProfile;
  persons: Person[];
  location: MasterLocation | undefined;
}

export interface SegmentKind {
  name: Exclude<SegmentName, 'header'>;
  /** Every record of this kind, in file order. */
  values: (of: SegmentSource) => Values<string>[];
}

/**
 * One list of the segments, in the order they go in the file.
 *
 * Two places need it, and they used to enumerate it separately: the exporter
 * renders each segment, and the validator checks each one's required fields
 * against the very same values. Kept apart, adding a segment to one and
 * forgetting the other means a state's required-field checks silently do not
 * cover it — and the way anybody finds out is a rejection notice from the
 * state, six weeks after the officer could have fixed it.
 */
export const SEGMENT_KINDS: SegmentKind[] = [
  {
    name: 'administrative',
    values: ({ incident, agency, location }) => [administrativeValues(incident, agency, location)],
  },
  { name: 'offense', values: ({ incident, agency }) => offenseValues(incident, agency) },
  { name: 'property', values: ({ incident, agency }) => propertyValues(incident, agency) },
  {
    name: 'victim',
    values: ({ incident, agency, persons }) => victimValues(incident, agency, persons),
  },
  {
    name: 'offender',
    values: ({ incident, agency, persons }) => offenderValues(incident, agency, persons),
  },
  {
    name: 'arrestee',
    values: ({ incident, agency, persons }) => arresteeValues(incident, agency, persons),
  },
];
