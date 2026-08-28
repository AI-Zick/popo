import { newId } from '@/lib/id';
import type {
  Charge,
  Incident,
  Offense,
  Person,
  PersonRole,
  PropertyItem,
  Vehicle,
} from './types';

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

export function createPerson(role: PersonRole, partial: Partial<Person> = {}): Person {
  return {
    id: newId('per'),
    role,
    offenseIds: [],
    lastName: '',
    firstName: '',
    middleName: '',
    suffix: '',
    businessName: '',
    dob: '',
    ageFrom: '',
    ageTo: '',
    sex: '',
    race: '',
    ethnicity: '',
    height: '',
    weight: '',
    eyeColor: '',
    hairColor: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    phone: '',
    email: '',
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
    address: '',
    apartment: '',
    city: '',
    state: '',
    zip: '',
    beat: '',
    locationType: '',
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
