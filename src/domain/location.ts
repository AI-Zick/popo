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

  /**
   * Withdrawal rather than deletion. A note that turned out to be wrong still
   * happened, and "who removed the gate code, and when" is a question that
   * gets asked after something goes wrong at an address.
   */
  retractedAt: string;
  retractedBy: string;
  retractionReason: string;
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

  /**
   * Where this is on the ground. Set by dropping a pin on the jurisdiction map
   * or typed in; there is no automatic geocoding, deliberately — see the
   * README on why an agency's own address points beat a third-party service.
   */
  latitude: number | null;
  longitude: number | null;
  /** How the coordinates were arrived at. */
  geoSource: 'pin' | 'typed' | 'import' | '';

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
    latitude: null,
    longitude: null,
    geoSource: '',
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

export function hasCoordinates(
  location: MasterLocation | null | undefined,
): location is MasterLocation & { latitude: number; longitude: number } {
  return (
    !!location && typeof location.latitude === 'number' && typeof location.longitude === 'number'
  );
}

export function isRetracted(note: PremiseNote): boolean {
  return Boolean(note.retractedAt);
}

/** Notes still in force, most serious first. */
export function activeNotes(location: MasterLocation | undefined): PremiseNote[] {
  if (!location) return [];
  const rank: Record<NoteKind, number> = { hazard: 0, access: 1, contact: 2, general: 3 };
  return location.notes
    .filter((n) => !isRetracted(n))
    .sort((a, b) => rank[a.kind] - rank[b.kind] || b.createdAt.localeCompare(a.createdAt));
}

/** Withdrawn notes, most recently withdrawn first. */
export function retractedNotes(location: MasterLocation | undefined): PremiseNote[] {
  if (!location) return [];
  return location.notes
    .filter(isRetracted)
    .sort((a, b) => b.retractedAt.localeCompare(a.retractedAt));
}

/** Notes older than this are shown as needing a re-check. */
export const NOTE_STALE_DAYS = 365;

export function isStale(note: PremiseNote, now = Date.now()): boolean {
  const at = new Date(note.reviewedAt || note.createdAt).getTime();
  if (Number.isNaN(at)) return false;
  return now - at > NOTE_STALE_DAYS * 86_400_000;
}
