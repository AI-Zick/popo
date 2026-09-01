import type { Incident } from '@/domain/types';
import type { PersonIndex } from '@/domain/person';
import { seedState } from './seed';

const INCIDENTS_KEY = 'aegis.incidents.v2';
const PEOPLE_KEY = 'aegis.people.v2';

export interface PersistedState {
  incidents: Incident[];
  people: PersonIndex;
}

export function loadState(): PersistedState {
  try {
    const rawIncidents = localStorage.getItem(INCIDENTS_KEY);
    const rawPeople = localStorage.getItem(PEOPLE_KEY);
    if (!rawIncidents || !rawPeople) {
      const seeded = seedState();
      saveState(seeded);
      return seeded;
    }
    const incidents = JSON.parse(rawIncidents);
    const people = JSON.parse(rawPeople);
    if (!Array.isArray(incidents) || typeof people !== 'object' || people === null) {
      return seedState();
    }
    return { incidents, people };
  } catch {
    // A corrupt or unavailable store must never take the app down.
    return seedState();
  }
}

export function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(INCIDENTS_KEY, JSON.stringify(state.incidents));
    localStorage.setItem(PEOPLE_KEY, JSON.stringify(state.people));
  } catch {
    /* quota or private mode — the session still works, it just will not persist */
  }
}
