/**
 * Data that arrived from somewhere else.
 *
 * By the time an officer opens a crash report they have already spoken the
 * plate over the radio, run the registration, run two licences and had dispatch
 * time-stamp the whole call. Every one of those returns is structured data that
 * a records system then asks them to type again, at the roadside, in the rain,
 * from a screen they have to switch away from. That is where the transcription
 * errors come from, and it is most of why the job feels like data entry.
 *
 * So: returns are stored as they arrived, and the report is filled *from* them.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  WHAT THIS IS AND IS NOT.
 *
 *  This defines the shape of an inbound return and the mapping from it into a
 *  person or a vehicle. It does NOT speak any real CAD vendor's protocol, and
 *  it does not talk to NCIC or NLETS — those are vendor-specific, and NCIC
 *  access is federally controlled and certified per agency.
 *
 *  Connecting a real system is therefore writing an adapter that posts to the
 *  ingest endpoint in this shape. That is deliberately the same bet as the
 *  state NIBRS packs: the awkward, vendor-specific part is pushed to the edge,
 *  and nothing in the report module has to know which CAD an agency bought.
 * ─────────────────────────────────────────────────────────────────────
 *
 * The returns are also *evidence of what was known when*. A registration return
 * showing an owner who had sold the car two weeks earlier is not an error in
 * the report — it is what the state's system said at 0230, and the stored
 * return is what proves that later.
 */

import type { FieldProvenance, MasterPerson, ProvenancedField, UUID } from './person';
import type { Vehicle } from './types';

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

/**
 * Where a return came from. Matches `FieldSource` on person provenance, so a
 * field filled from a return carries its origin all the way to the screen.
 */
export type InboundSource = 'cad' | 'mdt' | 'dmv' | 'nlets';

export const SOURCE_LABEL: Record<InboundSource, string> = {
  cad: 'Dispatch (CAD)',
  mdt: 'Mobile data terminal',
  dmv: 'DMV / state registry',
  nlets: 'Interstate query (NLETS)',
};

export type ReturnKind = 'call' | 'registration' | 'license' | 'person';

export const KIND_LABEL: Record<ReturnKind, string> = {
  call: 'Dispatch call',
  registration: 'Registration return',
  license: 'Driver licence return',
  person: 'Person query',
};

/* ------------------------------------------------------------------ */
/* Payloads                                                            */
/* ------------------------------------------------------------------ */

/** What dispatch knows about the call. */
export interface CallPayload {
  callNumber: string;
  nature: string;
  address: string;
  city: string;
  state: string;
  /** Cross street or landmark, which is how a crash location is usually given. */
  crossStreet: string;
  latitude: string;
  longitude: string;
  beat: string;
  receivedAt: string;
  dispatchedAt: string;
  arrivedAt: string;
  clearedAt: string;
  /** Unit call-signs assigned. */
  units: string[];
  /** Dispatcher comments and caller statements, in order. */
  comments: string[];
}

/** A plate or VIN run through the registry. */
export interface RegistrationPayload {
  plate: string;
  plateState: string;
  plateYear: string;
  vin: string;
  year: string;
  make: string;
  model: string;
  style: string;
  color: string;
  /** Registered owner, which is not necessarily the driver. */
  ownerLastName: string;
  ownerFirstName: string;
  ownerMiddleName: string;
  ownerAddress: string;
  ownerCity: string;
  ownerState: string;
  ownerZip: string;
  /** Registration status as the registry reported it. */
  status: string;
  expiresOn: string;
  insuranceCarrier: string;
  insurancePolicy: string;
}

/** A licence run through the registry. */
export interface LicensePayload {
  licenseNumber: string;
  licenseState: string;
  licenseClass: string;
  status: string;
  expiresOn: string;
  restrictions: string;
  lastName: string;
  firstName: string;
  middleName: string;
  suffix: string;
  dob: string;
  sex: string;
  race: string;
  height: string;
  weight: string;
  eyeColor: string;
  hairColor: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export type ReturnPayload =
  | ({ kind: 'call' } & CallPayload)
  | ({ kind: 'registration' } & RegistrationPayload)
  | ({ kind: 'license' } & LicensePayload)
  | ({ kind: 'person' } & Partial<LicensePayload>);

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

export interface QueryReturn {
  id: UUID;
  source: InboundSource;
  kind: ReturnKind;
  /** What was asked — the plate, the licence number, the call number. */
  query: string;
  /** When the external system answered. Not when we stored it. */
  receivedAt: string;
  /** The officer whose terminal ran it, where the source says. */
  officerId: UUID | '';
  officerName: string;
  /** Dispatch call this belongs to, which is how returns group to a scene. */
  callNumber: string;
  payload: ReturnPayload;
  /**
   * Reports this return has already been applied to, so the same licence is
   * not offered twice on the same document.
   */
  appliedTo: UUID[];
  createdAt: string;
}

export function createQueryReturn(partial: Partial<QueryReturn> & { payload: ReturnPayload }): QueryReturn {
  const now = new Date().toISOString();
  return {
    id: '',
    source: 'mdt',
    kind: partial.payload.kind,
    query: '',
    receivedAt: now,
    officerId: '',
    officerName: '',
    callNumber: '',
    appliedTo: [],
    createdAt: now,
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* Grouping                                                            */
/* ------------------------------------------------------------------ */

/**
 * The returns that belong to one scene.
 *
 * Matched on the dispatch call number where there is one, because that is what
 * ties a registration run at 0231 to the crash at the same intersection. Where
 * there is no call number the officer picks from a recent list instead — a
 * fallback that exists because plenty of stops and crashes are self-initiated
 * and never get a call number at all.
 */
export function returnsForCall(all: QueryReturn[], callNumber: string): QueryReturn[] {
  if (!callNumber.trim()) return [];
  return all
    .filter((r) => r.callNumber === callNumber)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
}

/** Recent returns run by one officer, for the no-call-number case. */
export function recentReturns(
  all: QueryReturn[],
  officerId: string,
  withinHours = 12,
  now = Date.now(),
): QueryReturn[] {
  const cutoff = now - withinHours * 3_600_000;
  return all
    .filter((r) => r.officerId === officerId)
    .filter((r) => {
      const at = new Date(r.receivedAt).getTime();
      return !Number.isNaN(at) && at >= cutoff;
    })
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

/** True when this return has already been used on this document. */
export function alreadyApplied(ret: QueryReturn, documentId: string): boolean {
  return ret.appliedTo.includes(documentId);
}

/* ------------------------------------------------------------------ */
/* Mapping into the report                                             */
/* ------------------------------------------------------------------ */

/**
 * Provenance for every field a return fills.
 *
 * `verified: false` is the important half. A licence return says what the state
 * has on file, which is not the same as what the officer confirmed with the
 * person in front of them — the address may be three moves out of date, and the
 * photo may not be the person holding it. The existing provenance strip renders
 * exactly this, with an "I confirmed this" action, so a filled field is fast
 * *and* honest about how much weight it carries.
 */
function stamp(source: InboundSource, at: string): FieldProvenance {
  return {
    source: source === 'cad' || source === 'mdt' ? 'unknown' : source,
    verified: false,
    at,
  };
}

const LICENSE_FIELDS: ProvenancedField[] = [
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
  'driverLicense',
];

/** A licence return as identity fields, ready to create or update a person. */
export function personFromLicense(ret: QueryReturn): Partial<MasterPerson> | null {
  if (ret.payload.kind !== 'license' && ret.payload.kind !== 'person') return null;
  const p = ret.payload as LicensePayload;
  if (!p.lastName && !p.firstName) return null;

  const provenance: Partial<Record<ProvenancedField, FieldProvenance>> = {};
  const mark = stamp(ret.source, ret.receivedAt);
  for (const field of LICENSE_FIELDS) provenance[field] = mark;

  return {
    lastName: p.lastName ?? '',
    firstName: p.firstName ?? '',
    middleName: p.middleName ?? '',
    suffix: p.suffix ?? '',
    dob: p.dob ?? '',
    sex: p.sex ?? '',
    race: p.race ?? '',
    height: p.height ?? '',
    weight: p.weight ?? '',
    eyeColor: p.eyeColor ?? '',
    hairColor: p.hairColor ?? '',
    address: p.address ?? '',
    city: p.city ?? '',
    state: p.state ?? '',
    zip: p.zip ?? '',
    driverLicense: p.licenseNumber ?? '',
    driverLicenseState: p.licenseState ?? '',
    provenance,
  };
}

/** A registration return as vehicle fields. */
export function vehicleFromRegistration(ret: QueryReturn): Partial<Vehicle> | null {
  if (ret.payload.kind !== 'registration') return null;
  const r = ret.payload;
  return {
    plate: r.plate ?? '',
    plateState: r.plateState ?? '',
    plateYear: r.plateYear ?? '',
    vin: r.vin ?? '',
    year: r.year ?? '',
    make: r.make ?? '',
    model: r.model ?? '',
    style: r.style ?? '',
    color: r.color ?? '',
  };
}

/**
 * The registered owner as identity fields.
 *
 * Separate from the vehicle on purpose. The registered owner is a fact about
 * the *car*; who was driving it is a fact about the crash, and a system that
 * quietly files the owner as the driver produces reports that name people who
 * were asleep at home. Applying the owner adds a person; saying they were
 * driving is a separate act by the officer.
 */
export function ownerFromRegistration(ret: QueryReturn): Partial<MasterPerson> | null {
  if (ret.payload.kind !== 'registration') return null;
  const r = ret.payload;
  if (!r.ownerLastName && !r.ownerFirstName) return null;

  const mark = stamp(ret.source, ret.receivedAt);
  const provenance: Partial<Record<ProvenancedField, FieldProvenance>> = {};
  for (const field of ['lastName', 'firstName', 'middleName', 'address', 'city', 'state', 'zip'] as ProvenancedField[]) {
    provenance[field] = mark;
  }

  return {
    lastName: r.ownerLastName ?? '',
    firstName: r.ownerFirstName ?? '',
    middleName: r.ownerMiddleName ?? '',
    address: r.ownerAddress ?? '',
    city: r.ownerCity ?? '',
    state: r.ownerState ?? '',
    zip: r.ownerZip ?? '',
    provenance,
  };
}

/** A one-line description of a return, for the panel that offers it. */
export function describeReturn(ret: QueryReturn): string {
  switch (ret.payload.kind) {
    case 'call':
      return `${ret.payload.callNumber} · ${ret.payload.nature || 'Call'}`;
    case 'registration': {
      const r = ret.payload;
      return `${[r.year, r.make, r.model].filter(Boolean).join(' ') || 'Vehicle'} · ${r.plate}`;
    }
    case 'license':
    case 'person': {
      const p = ret.payload as LicensePayload;
      return `${[p.firstName, p.lastName].filter(Boolean).join(' ') || 'Person'}${
        p.dob ? ` · DOB ${p.dob}` : ''
      }`;
    }
  }
}

/**
 * Flags on a return worth showing before it is applied.
 *
 * A suspended licence or an expired registration is the reason the officer ran
 * the query in the first place, and burying it inside a field the report fills
 * silently would waste the one piece of information they actually needed.
 */
export function alertsOn(ret: QueryReturn): string[] {
  const alerts: string[] = [];
  const status = String((ret.payload as { status?: string }).status ?? '').toLowerCase();

  if (ret.payload.kind === 'license') {
    if (/suspend|revok|cancel|expired|disqualif/.test(status)) {
      alerts.push(`Licence status: ${(ret.payload as LicensePayload).status}`);
    }
  }
  if (ret.payload.kind === 'registration') {
    if (/expired|suspend|revok|cancel|stolen/.test(status)) {
      alerts.push(`Registration status: ${ret.payload.status}`);
    }
    if (!ret.payload.insuranceCarrier) {
      alerts.push('No insurance carrier on the return');
    }
  }
  return alerts;
}
