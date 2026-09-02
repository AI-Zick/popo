/**
 * Person model.
 *
 * Identity is stored once, in the Master Name Index, and referenced by every
 * incident that involves that person. What changes case to case — the role they
 * played, what they were wearing, what they were charged with — lives on the
 * incident, not on the identity.
 *
 * Legacy systems that copy the whole person into each report are why the same
 * human ends up in the database eleven times with four spellings.
 */

export type UUID = string;

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

/**
 * Where a field's value came from. A registered owner is not necessarily the
 * driver and an address on file is not necessarily current, so a report has to
 * be able to distinguish what an officer observed from what the state had on
 * file.
 */
export type FieldSource =
  | 'officer'   // typed by an officer from direct contact
  | 'dmv'       // returned by a licence or registration query
  | 'nlets'     // returned by an interstate query
  | 'import'    // migrated from a previous records system
  | 'unknown';

export interface FieldProvenance {
  source: FieldSource;
  /** Did an officer confirm this against the person in front of them? */
  verified: boolean;
  at: string;
}

export const SOURCE_LABEL: Record<FieldSource, string> = {
  officer: 'Officer entered',
  dmv: 'DMV return',
  nlets: 'Interstate query',
  import: 'Migrated record',
  unknown: 'Unknown source',
};

/* ------------------------------------------------------------------ */
/* Master identity                                                     */
/* ------------------------------------------------------------------ */

/** Identity fields that carry provenance. */
export const PROVENANCED_FIELDS = [
  'lastName',
  'firstName',
  'middleName',
  'dob',
  'sex',
  'race',
  'address',
  'city',
  'state',
  'zip',
  'phone',
  'ssn',
  'driverLicense',
] as const;

export type ProvenancedField = (typeof PROVENANCED_FIELDS)[number];

export interface MasterPerson {
  id: UUID;

  // Name
  lastName: string;
  firstName: string;
  middleName: string;
  suffix: string;
  businessName: string;
  aliases: string[];

  // Descriptors
  dob: string;
  sex: string;
  race: string;
  ethnicity: string;
  height: string;
  weight: string;
  eyeColor: string;
  hairColor: string;
  scarsMarksTattoos: string;

  // Contact
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;

  /**
   * Strong identifiers. A match on any of these is decisive; a *conflict* on
   * any of them means these are different people regardless of how alike the
   * names look.
   */
  ssn: string;
  driverLicense: string;
  driverLicenseState: string;
  stateId: string;

  /** Officer-safety flags surfaced wherever this person appears. */
  cautions: string[];

  provenance: Partial<Record<ProvenancedField, FieldProvenance>>;

  /** Master ids absorbed into this record by a merge. */
  mergedFrom: UUID[];

  createdAt: string;
  updatedAt: string;
}

export type PersonIndex = Record<UUID, MasterPerson>;

/* ------------------------------------------------------------------ */
/* Per-incident participation                                          */
/* ------------------------------------------------------------------ */

export type PersonRole =
  | 'victim'
  | 'suspect'
  | 'arrestee'
  | 'witness'
  | 'complainant'
  | 'other';

export type VictimType = 'I' | 'B' | 'F' | 'G' | 'L' | 'R' | 'S' | 'O' | '';

export interface VictimOffenderRelationship {
  /** The incident-person id of the offender. */
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

/** One person's involvement in one incident. */
export interface IncidentPerson {
  id: UUID;
  /** Points into the Master Name Index. */
  masterId: UUID;

  role: PersonRole;
  offenseIds: UUID[];

  victimType: VictimType;
  injuries: string[];
  relationships: VictimOffenderRelationship[];

  armedWith: string[];
  /** What they looked like *that day* — clothing, demeanour. Not identity. */
  description: string;
  isUnknown: boolean;

  arrestDate: string;
  arrestType: string;
  charges: Charge[];

  notes: string;
}

/* ------------------------------------------------------------------ */
/* Resolved view                                                       */
/* ------------------------------------------------------------------ */

/**
 * An incident participation joined to its master identity. Rules and form
 * components read this flat shape, so neither has to know that identity is
 * stored separately.
 */
export type Person = Omit<MasterPerson, 'id' | 'createdAt' | 'updatedAt'> &
  IncidentPerson & {
    /** Estimated age range, used when no date of birth is known. */
    ageFrom: string;
    ageTo: string;
  };

export function resolvePerson(link: IncidentPerson, master: MasterPerson | undefined): Person {
  const identity = master ?? emptyMaster(link.masterId);
  const { id: _id, createdAt: _c, updatedAt: _u, ...identityFields } = identity;
  return {
    ...identityFields,
    ...link,
    ageFrom: '',
    ageTo: '',
  };
}

export function resolvePeople(links: IncidentPerson[], index: PersonIndex): Person[] {
  return links.map((link) => resolvePerson(link, index[link.masterId]));
}

/** Placeholder used when a link points at a master record that is missing. */
export function emptyMaster(id: UUID): MasterPerson {
  const now = new Date().toISOString();
  return {
    id,
    lastName: '',
    firstName: '',
    middleName: '',
    suffix: '',
    businessName: '',
    aliases: [],
    dob: '',
    sex: '',
    race: '',
    ethnicity: '',
    height: '',
    weight: '',
    eyeColor: '',
    hairColor: '',
    scarsMarksTattoos: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    phone: '',
    email: '',
    ssn: '',
    driverLicense: '',
    driverLicenseState: '',
    stateId: '',
    cautions: [],
    provenance: {},
    mergedFrom: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function displayName(p: { businessName: string; firstName: string; lastName: string; suffix?: string; isUnknown?: boolean }): string {
  if (p.businessName.trim()) return p.businessName.trim();
  const name = [p.firstName, p.lastName].filter((s) => s.trim()).join(' ').trim();
  const full = p.suffix?.trim() ? `${name} ${p.suffix.trim()}` : name;
  if (full) return full;
  if (p.isUnknown) return 'Unknown person';
  return 'Unnamed person';
}

/**
 * "Whitfield, Dana M" — the form records staff read.
 *
 * Typed on the name fields rather than on `MasterPerson` so the resolved
 * `Person` view can be passed straight in.
 */
export function formalName(p: {
  businessName: string;
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
}): string {
  if (p.businessName.trim()) return p.businessName.trim();
  const first = [p.firstName, p.middleName].filter((s) => s.trim()).join(' ');
  const last = [p.lastName, p.suffix].filter((s) => s.trim()).join(' ');
  if (!last) return first || 'Unnamed person';
  return first ? `${last}, ${first}` : last;
}
