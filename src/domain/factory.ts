import { newId } from '@/lib/id';
import type { Incident, Offense, PropertyItem, UUID, Vehicle } from './types';
import { emptyLocation, type MasterLocation as MasterLocationType, type NoteKind, type PremiseNote } from './location';
import {
  emptyMaster,
  type Charge,
  type IncidentPerson,
  type MasterPerson,
  type PersonRole,
} from './person';

export function nowLocalISO(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function newCaseNumber(sequence: number): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(sequence).padStart(6, '0')}`;
}

export function createOffense(partial: Partial<Offense> = {}): Offense {
  return {
    id: newId('off'),
    code: '',
    statute: '',
    attemptCompleted: 'C',
    locationType: '',
    premisesEntered: '',
    methodOfEntry: '',
    biasMotivation: '88',
    weapons: [],
    offenderSuspectedOfUsing: [],
    criminalActivity: [],
    ...partial,
  };
}

export function createMasterPerson(partial: Partial<MasterPerson> = {}): MasterPerson {
  const now = new Date().toISOString();
  return { ...emptyMaster(newId('mp')), createdAt: now, updatedAt: now, ...partial };
}

export function createIncidentPerson(
  role: PersonRole,
  masterId: UUID,
  partial: Partial<IncidentPerson> = {},
): IncidentPerson {
  return {
    id: newId('ip'),
    masterId,
    role,
    offenseIds: [],
    victimType: role === 'victim' ? 'I' : '',
    injuries: [],
    relationships: [],
    armedWith: [],
    description: '',
    isUnknown: false,
    arrestDate: '',
    arrestType: '',
    charges: [],
    notes: '',
    ...partial,
  };
}

export function createCharge(partial: Partial<Charge> = {}): Charge {
  return {
    id: newId('chg'),
    statute: '',
    description: '',
    counts: '1',
    degree: '',
    ...partial,
  };
}

export function createProperty(partial: Partial<PropertyItem> = {}): PropertyItem {
  return {
    id: newId('prp'),
    lossType: '',
    descriptionCode: '',
    value: '',
    quantity: '1',
    make: '',
    model: '',
    serialNumber: '',
    description: '',
    dateRecovered: '',
    drugType: '',
    drugQuantity: '',
    drugMeasurement: '',
    ownerPersonId: '',
    ...partial,
  };
}

export function createVehicle(partial: Partial<Vehicle> = {}): Vehicle {
  return {
    id: newId('veh'),
    involvement: '',
    year: '',
    make: '',
    model: '',
    style: '',
    color: '',
    vin: '',
    plate: '',
    plateState: '',
    plateYear: '',
    towedTo: '',
    ownerPersonId: '',
    notes: '',
    ...partial,
  };
}

export function createLocation(partial: Partial<MasterLocationType> = {}): MasterLocationType {
  const now = new Date().toISOString();
  return { ...emptyLocation(newId('loc')), createdAt: now, updatedAt: now, ...partial };
}

export function createNote(partial: Partial<PremiseNote> = {}): PremiseNote {
  const now = new Date().toISOString();
  return {
    id: newId('note'),
    kind: 'general' as NoteKind,
    text: '',
    author: '',
    createdAt: now,
    reviewedAt: now,
    sensitive: false,
    retractedAt: '',
    retractedBy: '',
    retractionReason: '',
    ...partial,
  };
}

export function createIncident(partial: Partial<Incident> = {}): Incident {
  const now = new Date().toISOString();
  return {
    id: newId('inc'),
    caseNumber: '',
    status: 'draft',
    reportedAt: nowLocalISO(),
    occurredFrom: '',
    occurredTo: '',
    occurredIsRange: false,
    locationId: '',
    locationUnit: '',
    reportingOfficer: '',
    reportingBadge: '',
    unit: '',
    supervisor: '',
    isDomestic: false,
    isHateCrime: false,
    isGangRelated: false,
    involvesJuvenile: false,
    clearanceStatus: 'open',
    exceptionalClearanceReason: '',
    clearedAt: '',
    offenses: [],
    persons: [],
    property: [],
    vehicles: [],
    narrative: '',
    createdAt: now,
    updatedAt: now,
    submittedAt: '',
    returnedReason: '',
    ...partial,
  };
}

/**
 * Adds a brand-new person to a report, creating the master identity and the
 * incident link together. Used by validation quick fixes, which mutate drafts
 * of both the incident and the index.
 */
export function attachNewPerson(
  incident: Incident,
  people: Record<UUID, MasterPerson>,
  role: PersonRole,
  identity: Partial<MasterPerson> = {},
  involvement: Partial<IncidentPerson> = {},
): IncidentPerson {
  const master = createMasterPerson(identity);
  people[master.id] = master;
  const link = createIncidentPerson(role, master.id, involvement);
  incident.persons.push(link);
  return link;
}
