/**
 * South Carolina — SCIBRS.
 *
 * South Carolina's incident-based program is run by SLED (the State Law
 * Enforcement Division), which collects from agencies statewide and forwards to
 * the FBI. Agencies submit to SLED, not to the FBI directly.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  UNVERIFIED. The column positions below are the national layout with the
 *  differences this system is structured to express. They have NOT been
 *  checked against SLED's published record layout, and `verified: false`
 *  puts that on the export screen rather than leaving it in a comment.
 *
 *  To finish this profile: get the current SCIBRS record layout from SLED and
 *  walk it against the table the export screen prints. What changes is the
 *  numbers in this file. Nothing outside it should need to move — and if
 *  something does, that is the abstraction failing and worth knowing early.
 * ─────────────────────────────────────────────────────────────────────
 */

import type {
  ArresteeField,
  FieldSpec,
  HeaderField,
  OffenseField,
  SegmentLayout,
  StateProfile,
} from '../spec';
import { ADMINISTRATIVE, ARRESTEE, OFFENDER, OFFENSE, PROPERTY, VICTIM } from './national';

/**
 * Wider than the national field. State case-number conventions differ, and a
 * truncated case number is the worst kind of failure: the record still
 * validates, it just silently stops matching the other segments for that
 * incident.
 */
const CASE_NUMBER_WIDTH = 16;

const AGENCY_CODE: FieldSpec<'stateAgencyCode'> = {
  field: 'stateAgencyCode',
  width: 5,
  required: true,
  label: 'SLED agency code',
};

/**
 * South Carolina's two structural differences from the national record, applied
 * to every segment.
 *
 * A transform rather than six hand-edited copies, because a state difference
 * applied to four segments out of six produces a file that looks right in the
 * first two lines — the ones anybody eyeballs — and is wrong in the rest.
 */
function scRecord<K extends string>(
  layout: SegmentLayout<K>,
): SegmentLayout<K | 'stateAgencyCode'> {
  const out: FieldSpec<K | 'stateAgencyCode'>[] = [];
  for (const spec of layout) {
    out.push(spec.field === 'caseNumber' ? { ...spec, width: CASE_NUMBER_WIDTH } : spec);
    // Carried on every record alongside the ORI, not just in the header.
    if (spec.field === 'ori') out.push(AGENCY_CODE);
  }
  return out;
}

/**
 * A submission header, one per file.
 *
 * A program that accepts batched files generally wants to know what the batch
 * is meant to contain, so a truncated transfer is caught on receipt rather than
 * turning up a year later as a quiet undercount in the annual return.
 */
const HEADER: SegmentLayout<HeaderField> = [
  { field: 'recordType', width: 1 },
  { field: 'ori', width: 9, required: true, label: 'agency ORI' },
  AGENCY_CODE,
  { field: 'agencyName', width: 30 },
  { field: 'periodMonth', width: 2, type: 'numeric' },
  { field: 'periodYear', width: 4, type: 'numeric' },
  { field: 'incidentCount', width: 6, type: 'numeric' },
  { field: 'segmentCount', width: 6, type: 'numeric' },
  { field: 'generatedDate', width: 8, type: 'date' },
];

/**
 * The state statute cite is required on an offense.
 *
 * State programs commonly want the local charge alongside the national offense
 * code, because `23F` is a national category and `16-13-30` is what the
 * solicitor actually charges. Declaring it `required` is the whole of adding
 * the check: the officer is told while the report is still open, instead of the
 * records clerk being told six weeks later by a rejection report.
 */
const OFFENSE_SC: SegmentLayout<OffenseField> = scRecord<OffenseField>(
  OFFENSE.flatMap((spec) =>
    spec.field === 'offenseCode'
      ? [
          spec,
          {
            field: 'statute' as const,
            width: 14,
            required: true,
            label: 'South Carolina statute cite',
          },
        ]
      : [spec],
  ),
);

/** As national, plus the statute cite on the arrest charge. */
const ARRESTEE_SC: SegmentLayout<ArresteeField> = scRecord<ArresteeField>(
  ARRESTEE.map((spec) =>
    spec.field === 'arrestTransactionNumber'
      ? { ...spec, width: 14, required: true, label: 'arrest charge statute' }
      : spec,
  ),
);

export const SOUTH_CAROLINA: StateProfile = {
  code: 'SC',
  name: 'South Carolina',
  program: 'SCIBRS — South Carolina Law Enforcement Division (SLED)',
  transport: 'fixed-width',
  fileExtension: 'txt',
  verified: false,
  specReference: 'SLED — SCIBRS record layout and edit specifications',
  specVersion: '',
  header: HEADER,
  segments: {
    administrative: scRecord(ADMINISTRATIVE),
    offense: OFFENSE_SC,
    property: scRecord(PROPERTY),
    victim: scRecord(VICTIM),
    offender: scRecord(OFFENDER),
    arrestee: ARRESTEE_SC,
  },
  rules: [],
};
