/**
 * Core report model. Structured after the NIBRS incident/segment model that
 * IMC, CSI and PremierOne all sit on top of, but flattened where the segment
 * layout only ever existed to satisfy a fixed-width export format.
 */

import type { IncidentPerson } from './person';
import type { ReviewComment, ReviewEvent } from './review';

export type { AgencyProfile } from './agency';
export type { ReviewComment, ReviewEvent } from './review';
export type {
  LocationIndex,
  MasterLocation,
  NoteKind,
  PremiseNote,
} from './location';

export type UUID = string;

export type SectionId =
  | 'incident'
  | 'offenses'
  | 'persons'
  | 'property'
  | 'vehicles'
  | 'narrative'
  | 'attachments'
  | 'review';

export const SECTION_ORDER: SectionId[] = [
  'incident',
  'offenses',
  'persons',
  'property',
  'vehicles',
  'narrative',
  'attachments',
  'review',
];

export const SECTION_LABEL: Record<SectionId, string> = {
  incident: 'Incident',
  offenses: 'Offenses',
  persons: 'People',
  property: 'Property',
  vehicles: 'Vehicles',
  narrative: 'Narrative',
  attachments: 'Attachments',
  review: 'Review & Submit',
};

/* ------------------------------------------------------------------ */
/* Offense                                                             */
/* ------------------------------------------------------------------ */

export type AttemptCompleted = 'A' | 'C' | '';

export interface Offense {
  id: UUID;
  /** NIBRS offense code, e.g. "220" */
  code: string;
  /** Local statute cite, e.g. "13A-7-5" */
  statute: string;
  attemptCompleted: AttemptCompleted;
  /** Structure/premises the offense occurred at */
  locationType: string;
  /** Burglary only */
  premisesEntered: string;
  methodOfEntry: string;
  biasMotivation: string;
  weapons: string[];
  offenderSuspectedOfUsing: string[];
  /** Criminal activity type — required for drug/weapon/gambling offenses */
  criminalActivity: string[];
}

/* ------------------------------------------------------------------ */
/* Person                                                             */
/* ------------------------------------------------------------------ */

/**
 * Identity lives in the Master Name Index and is shared across every report;
 * only the involvement is stored on the incident. See `domain/person.ts`.
 */
export type {
  Charge,
  FieldProvenance,
  FieldSource,
  IncidentPerson,
  MasterPerson,
  Person,
  PersonIndex,
  PersonRole,
  ProvenancedField,
  VictimOffenderRelationship,
  VictimType,
} from './person';

/* ------------------------------------------------------------------ */
/* Property & vehicles                                                 */
/* ------------------------------------------------------------------ */

export type LossType =
  | 'none'
  | 'burned'
  | 'counterfeit'
  | 'destroyed'
  | 'recovered'
  | 'seized'
  | 'stolen'
  | 'unknown'
  | '';

export interface PropertyItem {
  id: UUID;
  lossType: LossType;
  /** Property description code, e.g. "03" Automobiles */
  descriptionCode: string;
  value: string;
  quantity: string;
  make: string;
  model: string;
  serialNumber: string;
  description: string;
  dateRecovered: string;
  /** Drug offenses only */
  drugType: string;
  drugQuantity: string;
  drugMeasurement: string;
  ownerPersonId: UUID | '';
}

export interface Vehicle {
  id: UUID;
  involvement: string; // stolen | recovered | suspect | victim | towed | other
  year: string;
  make: string;
  model: string;
  style: string;
  color: string;
  vin: string;
  plate: string;
  plateState: string;
  plateYear: string;
  towedTo: string;
  ownerPersonId: UUID | '';
  notes: string;
}

/* ------------------------------------------------------------------ */
/* Incident                                                            */
/* ------------------------------------------------------------------ */

export type ReportStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'returned';

export type ClearanceStatus =
  | 'open'
  | 'cleared_arrest'
  | 'cleared_exceptional'
  | 'unfounded'
  | 'inactive'
  | '';

export interface Incident {
  id: UUID;
  caseNumber: string;
  status: ReportStatus;

  // When
  reportedAt: string; // ISO local datetime
  occurredFrom: string;
  occurredTo: string;
  occurredIsRange: boolean;

  // Where — the place itself lives in the location index, shared with every
  // other report at that address. Only the unit is specific to this incident.
  locationId: UUID | '';
  locationUnit: string;

  // Who took it
  reportingOfficer: string;
  reportingBadge: string;
  unit: string;
  supervisor: string;

  // Flags that drive downstream rules
  isDomestic: boolean;
  isHateCrime: boolean;
  isGangRelated: boolean;
  involvesJuvenile: boolean;

  // Disposition
  clearanceStatus: ClearanceStatus;
  exceptionalClearanceReason: string;
  clearedAt: string;

  offenses: Offense[];
  persons: IncidentPerson[];
  property: PropertyItem[];
  vehicles: Vehicle[];

  narrative: string;

  createdAt: string;
  updatedAt: string;

  /** The account that wrote it — separate from the officer's display name,
   *  because separation of duties has to compare identities, not strings. */
  createdBy: UUID | '';
  submittedAt: string;
  reviewedBy: string;
  reviewedAt: string;
  returnedReason: string;
  /** Supervisor notes pinned to fields, shown to the officer like validation. */
  reviewComments: ReviewComment[];
  /** Every submit, approval, return and reopen, oldest first. */
  reviewHistory: ReviewEvent[];
}
