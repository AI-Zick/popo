/**
 * Traffic stops.
 *
 * The one kind of police activity that produces no report most of the time. An
 * officer runs twenty stops a shift, writes two reports, and every existing
 * record of the other eighteen lives in CAD or in their own notebook. A shift
 * activity report built only from incident reports therefore shows an officer
 * who spent the night on traffic as having done nothing, which is both wrong
 * and the fastest way to make supervisors distrust the numbers.
 *
 * So a stop is its own lightweight record. It has to be fast to file — an
 * officer standing at a car door in the rain will not fill in a form — which is
 * why it is a handful of fields and not a second report.
 */

import type { UUID } from './person';

export type StopReason =
  | 'speed'
  | 'equipment'
  | 'registration'
  | 'moving'
  | 'suspicion'
  | 'bolo'
  | 'other';

export const STOP_REASONS: { value: StopReason; label: string }[] = [
  { value: 'speed', label: 'Speed' },
  { value: 'moving', label: 'Other moving violation' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'registration', label: 'Registration or licence' },
  { value: 'suspicion', label: 'Reasonable suspicion' },
  { value: 'bolo', label: 'BOLO / wanted' },
  { value: 'other', label: 'Other' },
];

export type StopOutcome = 'warning' | 'citation' | 'arrest' | 'no_action';

export const STOP_OUTCOMES: { value: StopOutcome; label: string; hint?: string }[] = [
  { value: 'warning', label: 'Verbal or written warning' },
  { value: 'citation', label: 'Citation issued' },
  { value: 'arrest', label: 'Arrest' },
  { value: 'no_action', label: 'No action taken' },
];

/** One citation written on a stop. A stop can produce several. */
export interface Citation {
  id: UUID;
  /** Statute or ordinance cited. */
  statute: string;
  description: string;
  /** True where the state distinguishes a written warning from a citation. */
  warningOnly: boolean;
}

export interface TrafficStop {
  id: UUID;
  /** The officer who made the stop. Not a display name — an account id. */
  officerId: UUID;
  officerName: string;

  /** When the stop was made, not when it was typed. */
  at: string;
  /** Free text: officers describe stop locations by landmark, not by address. */
  location: string;
  /** Patrol area, where the agency uses them. */
  beat: string;

  reason: StopReason;
  outcome: StopOutcome;
  citations: Citation[];

  plate: string;
  plateState: string;

  /**
   * Linked when the stop turned into something with a report — a DUI, a
   * warrant arrest. Empty on the great majority of stops.
   */
  incidentId: UUID | '';

  notes: string;
  createdAt: string;
  updatedAt: string;
}

export function createCitation(partial: Partial<Citation> = {}): Citation {
  return { id: '', statute: '', description: '', warningOnly: false, ...partial };
}

export function createTrafficStop(partial: Partial<TrafficStop> = {}): TrafficStop {
  const now = new Date().toISOString();
  return {
    id: '',
    officerId: '',
    officerName: '',
    at: now,
    location: '',
    beat: '',
    reason: 'moving',
    outcome: 'warning',
    citations: [],
    plate: '',
    plateState: '',
    incidentId: '',
    notes: '',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

/** Citations that actually count as citations, not written warnings. */
export function citationCount(stop: TrafficStop): number {
  return stop.citations.filter((c) => !c.warningOnly).length;
}

export function warningCount(stop: TrafficStop): number {
  return stop.citations.filter((c) => c.warningOnly).length;
}

/** What has to be true before a stop can be filed. Deliberately very little. */
export function checkStop(stop: TrafficStop): string[] {
  const problems: string[] = [];
  if (!stop.at) problems.push('A stop needs the time it happened.');
  if (!stop.location.trim()) problems.push('Say where the stop was made.');
  if (stop.outcome === 'citation' && stop.citations.length === 0) {
    problems.push('The outcome says a citation was issued, but none is listed.');
  }
  return problems;
}
