import type { Incident } from '@/domain/types';
import { seedIncidents } from './seed';

const KEY = 'aegis.incidents.v1';

export function loadIncidents(): Incident[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const seeded = seedIncidents();
      saveIncidents(seeded);
      return seeded;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Incident[]) : [];
  } catch {
    // A corrupt or unavailable store must never take the app down.
    return seedIncidents();
  }
}

export function saveIncidents(incidents: Incident[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(incidents));
  } catch {
    /* quota or private mode — the session still works, it just will not persist */
  }
}

export function clearIncidents(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
