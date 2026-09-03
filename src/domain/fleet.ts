/**
 * Cruisers, the daily check, and getting something fixed.
 *
 * Two jobs that look like one.
 *
 * **The daily check** is a routine an officer runs at the start of a shift:
 * walk the car, try the lights, look in the boot. It is mostly a formality and
 * that is the danger — a checklist everybody clicks through in four seconds is
 * worse than no checklist, because it produces a signed record saying the car
 * was fine. So a failed item is not a tick that went the other way: it has to
 * be said in words, and the ones that matter take the car out of service on
 * the spot rather than filing a note for somebody to read on Monday.
 *
 * **A maintenance request** is one officer telling the fleet supervisor
 * something is wrong. It can come out of the daily check or on its own, at
 * three in the morning, when the thing that is wrong has just become obvious.
 *
 * What the checklist contains is the agency's business, not this file's. A
 * department with rifles in the cars checks the rifle; one without does not,
 * and a hard-coded list would have every agency ticking a box that means
 * nothing to them. So the items are configuration.
 */

import type { UUID } from './types';

/* ------------------------------------------------------------------ */
/* The cars                                                            */
/* ------------------------------------------------------------------ */

export type CruiserStatus = 'inService' | 'outOfService' | 'inShop' | 'retired';

export const CRUISER_STATUS_LABEL: Record<CruiserStatus, string> = {
  inService: 'In service',
  outOfService: 'Out of service',
  inShop: 'In the shop',
  retired: 'Retired',
};

export interface Cruiser {
  id: UUID;
  /** What it is called on the radio. The only identifier anybody says aloud. */
  unit: string;
  year: string;
  make: string;
  model: string;
  plate: string;
  vin: string;
  /** Last odometer reading seen, from whichever check reported it. */
  odometer: string;
  status: CruiserStatus;
  /** Why it is off the road, when it is. */
  statusNote: string;
  assignedToId: UUID | '';
  assignedToName: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export function createCruiser(partial: Partial<Cruiser> = {}): Cruiser {
  const at = partial.createdAt ?? new Date().toISOString();
  return {
    id: '',
    unit: '',
    year: '',
    make: '',
    model: '',
    plate: '',
    vin: '',
    odometer: '',
    status: 'inService',
    statusNote: '',
    assignedToId: '',
    assignedToName: '',
    notes: '',
    createdAt: at,
    updatedAt: at,
    ...partial,
  };
}

/** "412 — 2023 Ford Explorer", or just the unit when that is all there is. */
export function cruiserLabel(cruiser: Cruiser): string {
  const description = [cruiser.year, cruiser.make, cruiser.model].filter(Boolean).join(' ');
  if (!cruiser.unit) return description || 'Unnamed unit';
  return description ? `${cruiser.unit} — ${description}` : cruiser.unit;
}

export function availableCruisers(cruisers: Cruiser[]): Cruiser[] {
  return cruisers.filter((c) => c.status === 'inService');
}

/** Radio numbers are not numbers: 9 comes before 10, and 10A after 10. */
export function sortCruisers(cruisers: Cruiser[]): Cruiser[] {
  return [...cruisers].sort((a, b) =>
    a.unit.localeCompare(b.unit, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

/* ------------------------------------------------------------------ */
/* What gets checked                                                   */
/* ------------------------------------------------------------------ */

/**
 * One line on the daily check.
 *
 * `critical` is the whole point of having the field. Most items are worth
 * knowing about; a few mean the car does not leave the lot, and the difference
 * has to be decided in advance by somebody thinking about it rather than at
 * 5am by somebody who wants to get going.
 */
export interface ChecklistItem {
  id: UUID;
  label: string;
  /** Grouped on the form so a walk-around reads in the order it is walked. */
  section: string;
  /** Failing this one takes the car out of service straight away. */
  critical: boolean;
  /** Shown under the label. For the item whose meaning is not obvious. */
  hint: string;
  active: boolean;
}

export function createChecklistItem(partial: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: '',
    label: '',
    section: 'Walk-around',
    critical: false,
    hint: '',
    active: true,
    ...partial,
  };
}

/**
 * What an agency starts with.
 *
 * A starting point, not a standard — every item here is one an admin can
 * delete. It exists because an empty checklist on the first day is a feature
 * nobody turns on, and because these are the ones that come up in every
 * agency's version of this form.
 */
export const DEFAULT_CHECKLIST: Omit<ChecklistItem, 'id'>[] = [
  { label: 'Body damage', section: 'Walk-around', critical: false, hint: 'Anything new since your last shift.', active: true },
  { label: 'Tyres and pressure', section: 'Walk-around', critical: true, hint: 'Including the spare.', active: true },
  { label: 'Headlights, brake lights, indicators', section: 'Walk-around', critical: true, hint: '', active: true },
  { label: 'Emergency lights and siren', section: 'Walk-around', critical: true, hint: '', active: true },
  { label: 'Fluid levels', section: 'Under the bonnet', critical: false, hint: 'Oil, coolant, washer.', active: true },
  { label: 'Fuel above half', section: 'Under the bonnet', critical: false, hint: 'Hand it over full where you can.', active: true },
  { label: 'Radio and MDT', section: 'Equipment', critical: true, hint: 'Both powered and on the right channel.', active: true },
  { label: 'Camera system', section: 'Equipment', critical: false, hint: 'Recording and with space left.', active: true },
  { label: 'First aid kit and AED', section: 'Equipment', critical: false, hint: 'Present, sealed, in date.', active: true },
  { label: 'Fire extinguisher', section: 'Equipment', critical: false, hint: 'Charged and in date.', active: true },
  { label: 'Long gun secure', section: 'Equipment', critical: true, hint: 'Locked, and the count is right.', active: true },
  { label: 'Cage and rear seat clear', section: 'Prisoner area', critical: true, hint: 'Search it. Anything found goes in a report before you leave.', active: true },
  { label: 'Rear door releases work', section: 'Prisoner area', critical: true, hint: '', active: true },
  { label: 'Interior clean', section: 'Prisoner area', critical: false, hint: '', active: true },
];

/** Sections in the order they were declared, so the form reads as a walk. */
export function checklistSections(items: ChecklistItem[]): string[] {
  const seen: string[] = [];
  for (const item of items) if (item.active && !seen.includes(item.section)) seen.push(item.section);
  return seen;
}

/* ------------------------------------------------------------------ */
/* One completed check                                                 */
/* ------------------------------------------------------------------ */

export type ItemResult = '' | 'ok' | 'fail' | 'na';

export interface CheckedItem {
  itemId: UUID;
  /** Kept alongside the id: an admin renaming an item must not rewrite history. */
  label: string;
  critical: boolean;
  result: ItemResult;
  note: string;
}

export interface CruiserCheck {
  id: UUID;
  cruiserId: UUID;
  cruiserUnit: string;
  officerId: UUID;
  officerName: string;
  at: string;
  shift: string;
  odometer: string;
  items: CheckedItem[];
  notes: string;
  /** Requests this check raised, so the two are not two separate stories. */
  raisedRequestIds: UUID[];
}

export function createCheck(partial: Partial<CruiserCheck> = {}): CruiserCheck {
  return {
    id: '',
    cruiserId: '',
    cruiserUnit: '',
    officerId: '',
    officerName: '',
    at: partial.at ?? new Date().toISOString(),
    shift: '',
    odometer: '',
    items: [],
    notes: '',
    raisedRequestIds: [],
    ...partial,
  };
}

/** Builds the blank form from whatever the agency currently checks. */
export function blankItems(items: ChecklistItem[]): CheckedItem[] {
  return items
    .filter((i) => i.active)
    .map((i) => ({ itemId: i.id, label: i.label, critical: i.critical, result: '', note: '' }));
}

export const failures = (check: CruiserCheck): CheckedItem[] =>
  check.items.filter((i) => i.result === 'fail');

/** A failure on an item the agency decided is critical. */
export const criticalFailures = (check: CruiserCheck): CheckedItem[] =>
  failures(check).filter((i) => i.critical);

export interface Problem {
  path: string;
  title: string;
  message: string;
  tip?: string;
  severity: 'error' | 'warning';
}

/**
 * What stops a check being filed.
 *
 * The rule that carries the weight: a failure has to be described. A checklist
 * where "fail" is one click produces records saying a car was broken with
 * nothing about how, which is no more useful than the tick it replaced.
 */
export function checkCheck(check: CruiserCheck): Problem[] {
  const problems: Problem[] = [];

  if (!check.cruiserId) {
    problems.push({
      path: 'cruiserId',
      title: 'No car chosen',
      message: 'Say which unit this is.',
      severity: 'error',
    });
  }

  const unanswered = check.items.filter((i) => i.result === '').length;
  if (unanswered > 0) {
    problems.push({
      path: 'items',
      title: `${unanswered} ${unanswered === 1 ? 'item is' : 'items are'} unanswered`,
      message: 'Go through the rest before filing it.',
      tip: 'Anything that does not apply to this car can be marked not applicable.',
      severity: 'error',
    });
  }

  for (const item of failures(check)) {
    if (!item.note.trim()) {
      problems.push({
        path: `items.${item.itemId}`,
        title: `Say what is wrong with the ${item.label.toLowerCase()}`,
        message: 'A failure with no description tells the garage nothing.',
        tip: 'One line is enough — "nearside rear tyre at 22 psi".',
        severity: 'error',
      });
    }
  }

  if (!check.odometer.trim()) {
    problems.push({
      path: 'odometer',
      title: 'No mileage',
      message: 'The odometer reading is what schedules the next service.',
      severity: 'warning',
    });
  }

  return problems;
}

export const blockingProblems = (problems: Problem[]): Problem[] =>
  problems.filter((p) => p.severity === 'error');

/** Whether this car has been checked today, by anyone. */
export function checkedToday(checks: CruiserCheck[], cruiserId: string, now = new Date()): boolean {
  const today = localDay(now);
  return checks.some((c) => c.cruiserId === cruiserId && localDay(new Date(c.at)) === today);
}

/* ------------------------------------------------------------------ */
/* Getting it fixed                                                    */
/* ------------------------------------------------------------------ */

/**
 * How bad it is, in the words an officer would use.
 *
 * Three levels, not five. The only question a fleet supervisor actually asks
 * on being handed one of these is whether the car can be driven, and a scale
 * fine enough to argue about is a scale that gets picked at random.
 */
export type Urgency = 'routine' | 'soon' | 'unsafe';

export const URGENCY_LABEL: Record<Urgency, string> = {
  routine: 'Whenever it is convenient',
  soon: 'Before it gets worse',
  unsafe: 'Not safe to drive',
};

export type RequestStatus = 'open' | 'acknowledged' | 'scheduled' | 'resolved' | 'declined';

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  open: 'Waiting on a supervisor',
  acknowledged: 'Seen',
  scheduled: 'Booked in',
  resolved: 'Fixed',
  declined: 'Not being done',
};

/** Statuses that mean nobody is waiting on this any more. */
export const CLOSED_STATUSES: RequestStatus[] = ['resolved', 'declined'];

export interface RequestEvent {
  id: UUID;
  at: string;
  actorName: string;
  status: RequestStatus;
  note: string;
}

export interface MaintenanceRequest {
  id: UUID;
  /** `M-000042`. Its own series, so a garage can quote it back. */
  number: string;
  cruiserId: UUID;
  cruiserUnit: string;

  reportedBy: UUID;
  reportedByName: string;
  reportedAt: string;

  /** What is wrong, in the officer's words. */
  problem: string;
  urgency: Urgency;
  odometer: string;
  /** The daily check this came out of, when it did. */
  fromCheckId: UUID | '';

  status: RequestStatus;
  history: RequestEvent[];
  /** Where it went — garage name, work order number, whatever is known. */
  assignedTo: string;
  resolvedAt: string;
  resolution: string;
}

export function createRequest(partial: Partial<MaintenanceRequest> = {}): MaintenanceRequest {
  return {
    id: '',
    number: '',
    cruiserId: '',
    cruiserUnit: '',
    reportedBy: '',
    reportedByName: '',
    reportedAt: partial.reportedAt ?? new Date().toISOString(),
    problem: '',
    urgency: 'routine',
    odometer: '',
    fromCheckId: '',
    status: 'open',
    history: [],
    assignedTo: '',
    resolvedAt: '',
    resolution: '',
    ...partial,
  };
}

/** `M-000042`. */
export function nextRequestNumber(existing: string[]): string {
  const used = existing
    .filter((n) => n.startsWith('M-'))
    .map((n) => Number(n.slice(2)))
    .filter((n) => Number.isFinite(n));
  return `M-${String((used.length > 0 ? Math.max(...used) : 0) + 1).padStart(6, '0')}`;
}

export const isOpen = (request: MaintenanceRequest): boolean =>
  !CLOSED_STATUSES.includes(request.status);

/**
 * The supervisor's queue.
 *
 * Anything unsafe to drive first, whatever its age — a car nobody should be
 * driving is not a queue position, it is the next thing that happens. Within
 * that, oldest first, so nothing rots at the bottom.
 */
export function requestQueue(requests: MaintenanceRequest[]): MaintenanceRequest[] {
  const rank: Record<Urgency, number> = { unsafe: 0, soon: 1, routine: 2 };
  return requests
    .filter(isOpen)
    .sort(
      (a, b) =>
        rank[a.urgency] - rank[b.urgency] || a.reportedAt.localeCompare(b.reportedAt),
    );
}

export function requestsForCruiser(
  requests: MaintenanceRequest[],
  cruiserId: string,
): MaintenanceRequest[] {
  return requests
    .filter((r) => r.cruiserId === cruiserId)
    .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
}

export function checkRequest(request: MaintenanceRequest): Problem[] {
  const problems: Problem[] = [];

  if (!request.cruiserId) {
    problems.push({
      path: 'cruiserId',
      title: 'No car chosen',
      message: 'Say which unit this is about.',
      severity: 'error',
    });
  }

  /*
    Counted in words rather than characters, because words are what is
    actually being asked for. "Brakes bad" is two words and tells a mechanic
    nothing; "AC not working" is three and tells them everything they need.
  */
  if (request.problem.trim().split(/\s+/).filter(Boolean).length < 3) {
    problems.push({
      path: 'problem',
      title: 'Say what is wrong',
      message: 'Enough that a mechanic knows what to look at without ringing you.',
      tip: '"Pulls left under braking, worse when cold" beats "brakes bad".',
      severity: 'error',
    });
  }

  return problems;
}

/**
 * Whether reporting this should take the car off the road now.
 *
 * The officer's own judgement, not a supervisor's. They are standing next to
 * it; nobody else is, and a car that gets driven for two more shifts while a
 * request sits in a queue is the failure this whole feature exists to stop.
 */
export const takesOffRoad = (urgency: Urgency): boolean => urgency === 'unsafe';

/* ------------------------------------------------------------------ */

/** Today where the officer is, not in UTC. Night shifts run past midnight. */
function localDay(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
