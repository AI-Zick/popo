/**
 * Location model.
 *
 * One record per real-world place, shared by every report that happens there.
 * The point is not tidiness — it is that the gate code an officer worked out at
 * 0300 has somewhere to live that the next officer will actually find.
 *
 * A storage facility, apartment block or motel is ONE location. The unit number
 * belongs to the incident, not to the place. Creating a record per unit is how
 * an index ends up with four hundred entries for one address and no notes on
 * any of them.
 */

import type { UUID } from './person';

export type NoteKind = 'access' | 'hazard' | 'contact' | 'general';

export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  access: 'Access',
  hazard: 'Hazard / caution',
  contact: 'Key holder',
  general: 'General',
};

export const NOTE_KIND_HINT: Record<NoteKind, string> = {
  access: 'Gate codes, lockbox numbers, which entrance actually opens.',
  hazard: 'Dogs, prior violence at this address, structural danger.',
  contact: 'Manager, key holder, alarm company — who to call after hours.',
  general: 'Anything else worth knowing before rolling up.',
};

export interface PremiseNote {
  id: UUID;
  kind: NoteKind;
  text: string;
  author: string;
  createdAt: string;
  /**
   * Access codes are operational security. They are flagged so the UI can mask
   * them by default, and so a real deployment can gate them behind a
   * permission and log every read.
   */
  sensitive: boolean;
  /** Notes go stale — a gate code from 2019 is worse than no gate code. */
  reviewedAt: string;
}

export interface MasterLocation {
  id: UUID;

  /** What officers actually call it: "Marion Street Self Storage". */
  commonName: string;
  /** Other things it gets called on the radio. */
  aliases: string[];

  address: string;
  city: string;
  state: string;
  zip: string;

  /** NIBRS-coded premises type. */
  locationType: string;

  /**
   * True for storage facilities, apartment blocks, motels, office parks —
   * anywhere an incident needs a unit number on top of the address.
   */
  hasUnits: boolean;
  /** What the sub-unit is called here: "Unit", "Apt", "Room", "Suite". */
  unitLabel: string;

  beat: string;
  notes: PremiseNote[];

  createdAt: string;
  updatedAt: string;
}

export type LocationIndex = Record<UUID, MasterLocation>;

export function emptyLocation(id: UUID): MasterLocation {
  const now = new Date().toISOString();
  return {
    id,
    commonName: '',
    aliases: [],
    address: '',
    city: '',
    state: '',
    zip: '',
    locationType: '',
    hasUnits: false,
    unitLabel: 'Unit',
    beat: '',
    notes: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** "Marion Street Self Storage — 612 N Marion St" */
export function locationLabel(location: MasterLocation | undefined): string {
  if (!location) return '';
  if (location.commonName.trim() && location.address.trim()) {
    return `${location.commonName.trim()} — ${location.address.trim()}`;
  }
  return location.commonName.trim() || location.address.trim() || 'Unnamed location';
}

/** The address as it should read on the face of a report. */
export function fullAddress(location: MasterLocation | undefined, unit = ''): string {
  if (!location) return '';
  const line = [location.address, unit ? `${location.unitLabel} ${unit}` : '']
    .filter((s) => s.trim())
    .join(', ');
  return [line, location.city, location.state].filter((s) => s && s.trim()).join(', ');
}

export function activeNotes(location: MasterLocation | undefined): PremiseNote[] {
  if (!location) return [];
  const rank: Record<NoteKind, number> = { hazard: 0, access: 1, contact: 2, general: 3 };
  return [...location.notes].sort(
    (a, b) => rank[a.kind] - rank[b.kind] || b.createdAt.localeCompare(a.createdAt),
  );
}

/** Notes older than this are shown as needing a re-check. */
export const NOTE_STALE_DAYS = 365;

export function isStale(note: PremiseNote, now = Date.now()): boolean {
  const at = new Date(note.reviewedAt || note.createdAt).getTime();
  if (Number.isNaN(at)) return false;
  return now - at > NOTE_STALE_DAYS * 86_400_000;
}
