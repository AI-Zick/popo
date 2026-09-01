import type { Incident } from '@/domain/types';
import type { PersonIndex } from '@/domain/person';
import type { LocationIndex } from '@/domain/location';
import { emptyAgency, type AgencyProfile } from '@/domain/agency';
import { seedState } from './seed';

const INCIDENTS_KEY = 'aegis.incidents.v2';
const PEOPLE_KEY = 'aegis.people.v2';
const LOCATIONS_KEY = 'aegis.locations.v1';
const AGENCY_KEY = 'aegis.agency.v1';

export interface PersistedState {
  incidents: Incident[];
  people: PersonIndex;
  locations: LocationIndex;
  agency: AgencyProfile;
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
    if (
      !Array.isArray(incidents) ||
      typeof people !== 'object' ||
      people === null ||
      typeof locations !== 'object' ||
      locations === null
    ) {
      return seedState();
    }
    return { incidents, people, locations, agency };
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
  } catch {
    /* quota or private mode — the session still works, it just will not persist */
  }
}
