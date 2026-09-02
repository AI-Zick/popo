/**
 * The FBI's national NIBRS flat-file layout.
 *
 * Not a state — the baseline the state packs start from and then modify. An
 * agency that submits directly to the FBI rather than through a state program
 * uses it as-is.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  These widths follow the national record layout as implemented in this
 *  system. They have NOT been reconciled column-by-column against the FBI's
 *  published specification, and `verified` says so. Do that before a first
 *  real submission — `columnMap()` prints the table to check against.
 * ─────────────────────────────────────────────────────────────────────
 */

import type {
  AdministrativeField,
  ArresteeField,
  OffenderField,
  OffenseField,
  PropertyField,
  SegmentLayout,
  StateProfile,
  VictimField,
} from '../spec';

export const ADMINISTRATIVE: SegmentLayout<AdministrativeField> = [
  { field: 'segmentLevel', width: 1 },
  { field: 'ori', width: 9, required: true, label: 'agency ORI' },
  { field: 'caseNumber', width: 12, required: true, label: 'case number' },
  { field: 'incidentDate', width: 8, type: 'date', required: true, label: 'incident date' },
  { field: 'reportDateIndicator', width: 1 },
  { field: 'incidentHour', width: 2, type: 'hour' },
  { field: 'clearanceCode', width: 1 },
  { field: 'clearedDate', width: 8, type: 'date' },
  { field: 'actionType', width: 1 },
  { field: 'beat', width: 4 },
];

export const OFFENSE: SegmentLayout<OffenseField> = [
  { field: 'segmentLevel', width: 1 },
  { field: 'ori', width: 9, required: true, label: 'agency ORI' },
  { field: 'caseNumber', width: 12, required: true, label: 'case number' },
  { field: 'offenseCode', width: 3, required: true, label: 'offense code' },
  { field: 'attemptCompleted', width: 1, required: true, label: 'attempted or completed' },
  { field: 'criminalActivity', width: 3 },
  { field: 'locationType', width: 2, required: true, label: 'location type' },
  { field: 'premisesEntered', width: 2, type: 'numericOrBlank' },
  { field: 'methodOfEntry', width: 1 },
  { field: 'weapons', width: 6 },
  { field: 'biasMotivation', width: 2, required: true, label: 'bias motivation' },
];

export const PROPERTY: SegmentLayout<PropertyField> = [
  { field: 'segmentLevel', width: 1 },
  { field: 'ori', width: 9, required: true, label: 'agency ORI' },
  { field: 'caseNumber', width: 12, required: true, label: 'case number' },
  { field: 'lossType', width: 1, required: true, label: 'loss type' },
  { field: 'descriptionCode', width: 2, required: true, label: 'property description' },
  { field: 'value', width: 9, type: 'numericOrBlank' },
  { field: 'dateRecovered', width: 8, type: 'date' },
  { field: 'drugType', width: 1 },
  { field: 'drugQuantity', width: 9, type: 'numericOrBlank' },
  { field: 'drugMeasurement', width: 2 },
];

export const VICTIM: SegmentLayout<VictimField> = [
  { field: 'segmentLevel', width: 1 },
  { field: 'ori', width: 9, required: true, label: 'agency ORI' },
  { field: 'caseNumber', width: 12, required: true, label: 'case number' },
  { field: 'sequence', width: 3, type: 'numeric' },
  { field: 'connectedOffenses', width: 30 },
  { field: 'victimType', width: 1, required: true, label: 'victim type' },
  { field: 'age', width: 2, type: 'numericOrBlank' },
  { field: 'sex', width: 1 },
  { field: 'race', width: 1 },
  { field: 'ethnicity', width: 1 },
  { field: 'injuries', width: 5 },
  { field: 'offenderSequence', width: 3, type: 'numericOrBlank' },
  { field: 'relationship', width: 2 },
];

export const OFFENDER: SegmentLayout<OffenderField> = [
  { field: 'segmentLevel', width: 1 },
  { field: 'ori', width: 9, required: true, label: 'agency ORI' },
  { field: 'caseNumber', width: 12, required: true, label: 'case number' },
  { field: 'sequence', width: 3, type: 'numeric' },
  { field: 'age', width: 2, type: 'numericOrBlank' },
  { field: 'sex', width: 1 },
  { field: 'race', width: 1 },
  { field: 'ethnicity', width: 1 },
];

export const ARRESTEE: SegmentLayout<ArresteeField> = [
  { field: 'segmentLevel', width: 1 },
  { field: 'ori', width: 9, required: true, label: 'agency ORI' },
  { field: 'caseNumber', width: 12, required: true, label: 'case number' },
  { field: 'sequence', width: 3, type: 'numeric' },
  { field: 'arrestTransactionNumber', width: 12 },
  { field: 'arrestDate', width: 8, type: 'date', required: true, label: 'arrest date' },
  { field: 'arrestType', width: 1, required: true, label: 'arrest type' },
  { field: 'multipleArrestIndicator', width: 1 },
  { field: 'arrestOffenseCode', width: 3 },
  { field: 'age', width: 2, type: 'numericOrBlank' },
  { field: 'sex', width: 1 },
  { field: 'race', width: 1 },
  { field: 'ethnicity', width: 1 },
];

export const NATIONAL: StateProfile = {
  code: '',
  name: 'National (FBI direct)',
  program: 'FBI NIBRS — for agencies that submit directly rather than through a state program',
  transport: 'fixed-width',
  fileExtension: 'txt',
  verified: false,
  specReference: 'FBI CJIS — NIBRS Technical Specification',
  specVersion: '',
  segments: {
    administrative: ADMINISTRATIVE,
    offense: OFFENSE,
    property: PROPERTY,
    victim: VICTIM,
    offender: OFFENDER,
    arrestee: ARRESTEE,
  },
  rules: [],
};
