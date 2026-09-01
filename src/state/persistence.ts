import type { Incident } from '@/domain/types';
import type { PersonIndex } from '@/domain/person';
import type { LocationIndex } from '@/domain/location';
import { emptyAgency, type AgencyProfile } from '@/domain/agency';
import type { User } from '@/domain/auth';
import type { Credential } from '@/domain/session';
import type { AuditEntry } from '@/domain/audit';
import { seedState } from './seed';

const INCIDENTS_KEY = 'aegis.incidents.v2';
const PEOPLE_KEY = 'aegis.people.v2';
const LOCATIONS_KEY = 'aegis.locations.v1';
const AGENCY_KEY = 'aegis.agency.v1';
const USERS_KEY = 'aegis.users.v1';
const CREDENTIALS_KEY = 'aegis.credentials.v1';
const AUDIT_KEY = 'aegis.audit.v1';

export interface PersistedState {
  incidents: Incident[];
  people: PersonIndex;
  locations: LocationIndex;
  agency: AgencyProfile;
  users: User[];
  credentials: Record<string, Credential>;
  auditLog: AuditEntry[];
}

export function loadState(): PersistedState {
  try {
    const rawIncidents = localStorage.getItem(INCIDENTS_KEY);
    const rawPeople = localStorage.getItem(PEOPLE_KEY);
    const rawLocations = localStorage.getItem(LOCATIONS_KEY);
    if (!rawIncidents || !rawPeople || !rawLocations) {
      const seeded = seedState();
      saveState(seeded);
      return seeded;
    }
    const incidents = JSON.parse(rawIncidents);
    const people = JSON.parse(rawPeople);
    const locations = JSON.parse(rawLocations);
    const rawAgency = localStorage.getItem(AGENCY_KEY);
    // Agency config is allowed to be absent — that is just an unconfigured install.
    const agency: AgencyProfile = rawAgency ? { ...emptyAgency(), ...JSON.parse(rawAgency) } : emptyAgency();
    const rawUsers = localStorage.getItem(USERS_KEY);
    const parsedUsers = rawUsers ? JSON.parse(rawUsers) : null;
    const users: User[] = Array.isArray(parsedUsers) && parsedUsers.length ? parsedUsers : seedState().users;

    const rawCredentials = localStorage.getItem(CREDENTIALS_KEY);
    const parsedCredentials = rawCredentials ? JSON.parse(rawCredentials) : null;
    const credentials: Record<string, Credential> =
      parsedCredentials && typeof parsedCredentials === 'object' ? parsedCredentials : {};

    const rawAudit = localStorage.getItem(AUDIT_KEY);
    const parsedAudit = rawAudit ? JSON.parse(rawAudit) : null;
    const auditLog: AuditEntry[] = Array.isArray(parsedAudit) ? parsedAudit : [];
    if (
      !Array.isArray(incidents) ||
      typeof people !== 'object' ||
      people === null ||
      typeof locations !== 'object' ||
      locations === null
    ) {
      return seedState();
    }
    return { incidents, people, locations, agency, users, credentials, auditLog };
  } catch {
    // A corrupt or unavailable store must never take the app down.
    return seedState();
  }
}

export function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(INCIDENTS_KEY, JSON.stringify(state.incidents));
    localStorage.setItem(PEOPLE_KEY, JSON.stringify(state.people));
    localStorage.setItem(LOCATIONS_KEY, JSON.stringify(state.locations));
    localStorage.setItem(AGENCY_KEY, JSON.stringify(state.agency));
    localStorage.setItem(USERS_KEY, JSON.stringify(state.users));
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(state.credentials));
    localStorage.setItem(AUDIT_KEY, JSON.stringify(state.auditLog));
  } catch {
    /* quota or private mode — the session still works, it just will not persist */
  }
}
