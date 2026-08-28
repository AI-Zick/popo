/**
 * Core report model. Structured after the NIBRS incident/segment model that
 * IMC, CSI and PremierOne all sit on top of, but flattened where the segment
 * layout only ever existed to satisfy a fixed-width export format.
 */

export type UUID = string;

export type SectionId =
  | 'incident'
  | 'offenses'
  | 'persons'
  | 'property'
  | 'vehicles'
  | 'narrative'
  | 'review';

export const SECTION_ORDER: SectionId[] = [
  'incident',
  'offenses',
  'persons',
  'property',
  'vehicles',
  'narrative',
  'review',
];

export const SECTION_LABEL: Record<SectionId, string> = {
  incident: 'Incident',
  offenses: 'Offenses',
  persons: 'People',
  property: 'Property',
  vehicles: 'Vehicles',
  narrative: 'Narrative',
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
/* Person                                                              */
/* ------------------------------------------------------------------ */

export type PersonRole =
  | 'victim'
  | 'suspect'
  | 'arrestee'
  | 'witness'
  | 'complainant'
  | 'other';

export type VictimType =
  | 'I' // Individual
  | 'B' // Business
  | 'F' // Financial institution
  | 'G' // Government
  | 'L' // Law enforcement officer
  | 'R' // Religious organization
  | 'S' // Society / public
  | 'O' // Other
  | '';

export interface Person {
  id: UUID;
  role: PersonRole;
  /** Which offenses this person is tied to (offense ids). */
  offenseIds: UUID[];

  // Identity
  lastName: string;
  firstName: string;
  middleName: string;
  suffix: string;
  businessName: string;
  dob: string; // yyyy-mm-dd
  ageFrom: string; // used when DOB unknown
  ageTo: string;
  sex: string; // M F U
  race: string;
  ethnicity: string;
  height: string;
  weight: string;
  eyeColor: string;
  hairColor: string;

  // Contact
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;

  // Victim-specific
  victimType: VictimType;
  injuries: string[];
  /** Offender ids this victim has a relationship with */
  relationships: VictimOffenderRelationship[];

  // Suspect/arrestee-specific
  armedWith: string[];
  /** Free-text description used when identity is unknown */
  description: string;
  isUnknown: boolean;

  // Arrestee-specific
  arrestDate: string;
  arrestType: string;
  charges: Charge[];

  notes: string;
}

export interface VictimOffenderRelationship {
  offenderId: UUID;
  relationship: string;
}

export interface Charge {
  id: UUID;
  statute: string;
  description: string;
  counts: string;
  degree: string;
}

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

  // Where
  address: string;
  apartment: string;
  city: string;
  state: string;
  zip: string;
  beat: string;
  locationType: string;

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
  persons: Person[];
  property: PropertyItem[];
  vehicles: Vehicle[];

  narrative: string;

  createdAt: string;
  updatedAt: string;
  submittedAt: string;
  returnedReason: string;
}
