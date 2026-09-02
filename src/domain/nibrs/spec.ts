/**
 * What a state's submission layout looks like, as data.
 *
 * The reason this is a specification rather than fifty copies of a renderer:
 * what varies between states is *where the fields go*, not how to work out what
 * goes in them. Deriving a victim's age from a date of birth is the same
 * arithmetic in Columbia and in Concord. Writing that age into columns 56-57
 * versus 58-59 is a table.
 *
 * So extraction is national and shared (`extract.ts`), layout is per-state and
 * declarative (`states/`), and rendering walks one against the other
 * (`format.ts`). Adding a state is a file of numbers, not a fork.
 */

import type { Rule } from '@/validation/engine';

/* ------------------------------------------------------------------ */
/* Fields                                                              */
/* ------------------------------------------------------------------ */

/**
 * How a value is written into its columns.
 *
 * `numeric` and `numericOrBlank` are deliberately separate. A zero is a claim
 * — an age of `00` says newborn — so a field that is merely absent must go out
 * as spaces, and the layout is where that distinction gets made.
 */
export type FieldType = 'alpha' | 'numeric' | 'numericOrBlank' | 'date' | 'hour';

export interface FieldSpec<K extends string> {
  field: K;
  width: number;
  /** Defaults to `alpha`. */
  type?: FieldType;
  /**
   * The state's edit checks reject the submission when this is blank.
   *
   * Marking it here rather than in a hand-written rule means the officer is
   * told about it in the report, weeks before the state would have told the
   * records clerk about it in a rejection report.
   */
  required?: boolean;
  /** Human wording for the validation message and the layout table. */
  label?: string;
}

export type SegmentLayout<K extends string> = readonly FieldSpec<K>[];

/* ------------------------------------------------------------------ */
/* Field names                                                         */
/* ------------------------------------------------------------------ */

/*
  These are the canonical names extraction produces. A layout may order them
  freely, size them freely and omit them freely — but it cannot invent one,
  because the union is what the compiler checks a state pack against. A typo in
  a state's layout is a build error, not a silently blank column in a file
  somebody submits.
*/

export type HeaderField =
  | 'recordType'
  | 'stateAgencyCode'
  | 'ori'
  | 'agencyName'
  | 'stateCode'
  | 'periodMonth'
  | 'periodYear'
  | 'incidentCount'
  | 'segmentCount'
  | 'generatedDate';

export type AdministrativeField =
  | 'segmentLevel'
  | 'ori'
  | 'caseNumber'
  | 'incidentDate'
  | 'reportDateIndicator'
  | 'incidentHour'
  | 'clearanceCode'
  | 'clearedDate'
  | 'actionType'
  | 'beat'
  | 'stateAgencyCode';

export type OffenseField =
  | 'segmentLevel'
  | 'stateAgencyCode'
  | 'ori'
  | 'caseNumber'
  | 'offenseCode'
  | 'attemptCompleted'
  | 'criminalActivity'
  | 'locationType'
  | 'premisesEntered'
  | 'methodOfEntry'
  | 'weapons'
  | 'biasMotivation'
  | 'statute';

export type PropertyField =
  | 'segmentLevel'
  | 'stateAgencyCode'
  | 'ori'
  | 'caseNumber'
  | 'lossType'
  | 'descriptionCode'
  | 'value'
  | 'dateRecovered'
  | 'drugType'
  | 'drugQuantity'
  | 'drugMeasurement';

export type VictimField =
  | 'segmentLevel'
  | 'stateAgencyCode'
  | 'ori'
  | 'caseNumber'
  | 'sequence'
  | 'connectedOffenses'
  | 'victimType'
  | 'age'
  | 'sex'
  | 'race'
  | 'ethnicity'
  | 'residentStatus'
  | 'injuries'
  | 'offenderSequence'
  | 'relationship';

export type OffenderField =
  | 'segmentLevel'
  | 'stateAgencyCode'
  | 'ori'
  | 'caseNumber'
  | 'sequence'
  | 'age'
  | 'sex'
  | 'race'
  | 'ethnicity';

export type ArresteeField =
  | 'segmentLevel'
  | 'stateAgencyCode'
  | 'ori'
  | 'caseNumber'
  | 'sequence'
  | 'arrestTransactionNumber'
  | 'arrestDate'
  | 'arrestType'
  | 'multipleArrestIndicator'
  | 'arrestOffenseCode'
  | 'age'
  | 'sex'
  | 'race'
  | 'ethnicity'
  | 'residentStatus'
  | 'dispositionUnder18';

/** Every segment name, used to label issues and count output. */
export type SegmentName =
  | 'header'
  | 'administrative'
  | 'offense'
  | 'property'
  | 'victim'
  | 'offender'
  | 'arrestee';

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

/** How the state wants the file. Not a fork — a renderer. */
export type Transport = 'fixed-width' | 'xml';

export interface StateProfile {
  /** Two-letter postal code. Matches `AgencyProfile.state`. */
  code: string;
  /** The state, spelled out. */
  name: string;
  /** What the state calls its program, and who runs it. */
  program: string;
  transport: Transport;
  fileExtension: string;

  /**
   * False until somebody has sat down with the state's published record layout
   * and checked this file against it, column by column.
   *
   * This is surfaced in the export screen rather than kept in a comment,
   * because the failure it prevents — a file that is the right shape in the
   * wrong dialect, rejected in bulk six weeks later — is silent at the moment
   * of export and expensive afterwards.
   */
  verified: boolean;
  /** Where the authoritative layout comes from. */
  specReference: string;
  /** The revision this profile was written against, once it has been. */
  specVersion: string;

  segments: {
    administrative: SegmentLayout<AdministrativeField>;
    offense: SegmentLayout<OffenseField>;
    property: SegmentLayout<PropertyField>;
    victim: SegmentLayout<VictimField>;
    offender: SegmentLayout<OffenderField>;
    arrestee: SegmentLayout<ArresteeField>;
  };

  /** Emitted once at the head of the file, where the state wants one. */
  header?: SegmentLayout<HeaderField>;

  /**
   * Rules this state's program adds beyond the national edits.
   *
   * Empty for most states: required-field checks are generated from the
   * layouts above, so a pack only needs code here when the state's rule is
   * genuinely conditional rather than "this column may not be blank".
   */
  rules: Rule[];
}
