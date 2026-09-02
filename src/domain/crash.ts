/**
 * Motor vehicle crash reports.
 *
 * A separate document from an incident report, not a section of one. The two
 * answer different questions, go to different places and are read by different
 * people: an incident report describes a crime for a prosecutor and feeds
 * NIBRS; a crash report describes a collision for a state highway safety office
 * and an insurance adjuster, and feeds the state crash file.
 *
 * They meet when a crash is also a crime — a DUI, a hit and run, a fatality.
 * That produces *both* documents, linked, because the DA needs the elements of
 * the offense and the state needs the roadway data, and squeezing one into the
 * other loses half of each.
 *
 * The structure is built around **units**. A unit is one vehicle plus its
 * driver and occupants, numbered 1, 2, 3 — which is how crash reports are
 * written, diagrammed and talked about ("unit 2 failed to yield"). Pedestrians
 * and cyclists are units too, with no vehicle, because the state form counts
 * them that way and because the alternative is a special case in every rule.
 */

import type { UUID } from './person';
import type { ReportStatus } from './types';
import type { ReviewComment, ReviewEvent } from './review';
import type { Diagram } from './diagram';

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

export type Severity = 'fatal' | 'serious' | 'minor' | 'possible' | 'none';

/**
 * KABCO, the injury scale every state crash form uses in some form. Kept in
 * severity order because the worst injury in the crash drives its
 * classification, its reporting deadline and whether a reconstruction team
 * comes out.
 */
export const SEVERITIES: { value: Severity; label: string; hint?: string }[] = [
  { value: 'fatal', label: 'Fatal (K)', hint: 'Died within 30 days as a result of the crash.' },
  { value: 'serious', label: 'Suspected serious (A)', hint: 'Carried from the scene, unable to walk away.' },
  { value: 'minor', label: 'Suspected minor (B)', hint: 'Visible but not incapacitating.' },
  { value: 'possible', label: 'Possible (C)', hint: 'Complaint of pain, nothing visible.' },
  { value: 'none', label: 'No apparent injury (O)' },
];

export type UnitKind = 'vehicle' | 'pedestrian' | 'cyclist' | 'other';

export const UNIT_KINDS: { value: UnitKind; label: string }[] = [
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'pedestrian', label: 'Pedestrian' },
  { value: 'cyclist', label: 'Cyclist' },
  { value: 'other', label: 'Other' },
];

export const CRASH_MANNERS: { value: string; label: string }[] = [
  { value: 'rear_end', label: 'Rear end' },
  { value: 'angle', label: 'Angle' },
  { value: 'head_on', label: 'Head on' },
  { value: 'sideswipe_same', label: 'Sideswipe — same direction' },
  { value: 'sideswipe_opposite', label: 'Sideswipe — opposite direction' },
  { value: 'rear_to_rear', label: 'Rear to rear' },
  { value: 'single', label: 'Single vehicle' },
  { value: 'other', label: 'Other' },
];

export const LIGHT_CONDITIONS: { value: string; label: string }[] = [
  { value: 'daylight', label: 'Daylight' },
  { value: 'dawn', label: 'Dawn' },
  { value: 'dusk', label: 'Dusk' },
  { value: 'dark_lighted', label: 'Dark — lighted' },
  { value: 'dark_unlighted', label: 'Dark — not lighted' },
  { value: 'unknown', label: 'Unknown' },
];

export const WEATHER: { value: string; label: string }[] = [
  { value: 'clear', label: 'Clear' },
  { value: 'cloudy', label: 'Cloudy' },
  { value: 'rain', label: 'Rain' },
  { value: 'sleet', label: 'Sleet or hail' },
  { value: 'snow', label: 'Snow' },
  { value: 'fog', label: 'Fog or smoke' },
  { value: 'wind', label: 'Severe crosswind' },
];

export const ROAD_SURFACE: { value: string; label: string }[] = [
  { value: 'dry', label: 'Dry' },
  { value: 'wet', label: 'Wet' },
  { value: 'ice', label: 'Ice or frost' },
  { value: 'snow', label: 'Snow or slush' },
  { value: 'mud', label: 'Mud, dirt or gravel' },
  { value: 'oil', label: 'Water, oil or standing liquid' },
];

/** Why it happened, per unit. The state form calls these contributing factors. */
export const CONTRIBUTING_FACTORS: { value: string; label: string }[] = [
  { value: 'speed', label: 'Speed too fast for conditions' },
  { value: 'follow', label: 'Following too closely' },
  { value: 'yield', label: 'Failed to yield right of way' },
  { value: 'signal', label: 'Disregarded traffic signal or sign' },
  { value: 'lane', label: 'Improper lane change or use' },
  { value: 'turn', label: 'Improper turn' },
  { value: 'backing', label: 'Improper backing' },
  { value: 'distracted', label: 'Distracted' },
  { value: 'impaired', label: 'Under the influence' },
  { value: 'fatigue', label: 'Asleep or fatigued' },
  { value: 'defect', label: 'Vehicle defect' },
  { value: 'road', label: 'Road or weather condition' },
  { value: 'animal', label: 'Animal in roadway' },
  { value: 'none', label: 'No contributing factor for this unit' },
];

export const OCCUPANT_SEATS: { value: string; label: string }[] = [
  { value: 'driver', label: 'Driver' },
  { value: 'front_right', label: 'Front — right' },
  { value: 'front_middle', label: 'Front — middle' },
  { value: 'rear_left', label: 'Rear — left' },
  { value: 'rear_middle', label: 'Rear — middle' },
  { value: 'rear_right', label: 'Rear — right' },
  { value: 'other', label: 'Other or unknown' },
];

export const RESTRAINTS: { value: string; label: string }[] = [
  { value: 'belt', label: 'Lap and shoulder belt' },
  { value: 'lap', label: 'Lap belt only' },
  { value: 'child', label: 'Child restraint' },
  { value: 'helmet', label: 'Helmet' },
  { value: 'none', label: 'None used' },
  { value: 'unknown', label: 'Unknown' },
];

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

/** One person in or on a unit. */
export interface Occupant {
  id: UUID;
  /** Points into the Master Name Index, like every other person in the system. */
  masterId: UUID;
  seat: string;
  restraint: string;
  airbagDeployed: boolean;
  ejected: boolean;
  injury: Severity;
  transportedTo: string;
  transportedBy: string;
}

/** One vehicle, pedestrian or cyclist involved. */
export interface CrashUnit {
  id: UUID;
  /** 1, 2, 3 — referred to by number in the narrative and the diagram. */
  number: number;
  kind: UnitKind;

  /** The driver, as an occupant. Absent for a pedestrian unit. */
  driverOccupantId: UUID | '';
  occupants: Occupant[];

  // Vehicle, when there is one. Mirrors `Vehicle` so a registration return
  // fills both the same way.
  year: string;
  make: string;
  model: string;
  style: string;
  color: string;
  vin: string;
  plate: string;
  plateState: string;
  plateYear: string;
  /** Registered owner, which is not necessarily the driver. */
  ownerMasterId: UUID | '';
  ownerIsDriver: boolean;

  insuranceCarrier: string;
  insurancePolicy: string;

  /** Where it was going and how fast, as the officer determined it. */
  direction: string;
  postedSpeed: string;
  estimatedSpeed: string;

  contributingFactors: string[];
  /** Clock points of impact, 1-12, as the state form asks for them. */
  damageAreas: string[];
  damageSeverity: string;
  towed: boolean;
  towedBy: string;
  towedTo: string;

  /** Citations issued to this unit's driver, by statute. */
  citations: string[];
  notes: string;
}

export interface CrashReport {
  id: UUID;
  caseNumber: string;
  /** State crash report number, where the state issues its own series. */
  stateCrashNumber: string;
  status: ReportStatus;

  /** The dispatch call, which is what ties the inbound returns to this scene. */
  callNumber: string;

  occurredAt: string;
  reportedAt: string;

  /** Where, from the location index — shared with every other report there. */
  locationId: UUID | '';
  /** Crash locations are given as intersections and mileposts more than street numbers. */
  onRoad: string;
  crossStreet: string;
  milepost: string;
  latitude: string;
  longitude: string;

  manner: string;
  lightCondition: string;
  weather: string;
  roadSurface: string;
  roadCharacter: string;
  workZone: boolean;
  schoolZone: boolean;

  /** The worst injury in the crash. Drives deadlines and who responds. */
  severity: Severity;
  /**
   * The scene diagram, stored as shapes rather than a picture — so it reopens
   * editable, prints at full resolution and costs kilobytes.
   */
  diagram: Diagram | null;

  units: CrashUnit[];
  narrative: string;

  /** An incident report for the same event, where the crash was also a crime. */
  linkedIncidentId: UUID | '';

  reportingOfficer: string;
  reportingBadge: string;
  createdBy: UUID | '';
  createdAt: string;
  updatedAt: string;

  submittedAt: string;
  reviewedBy: string;
  reviewedAt: string;
  returnedReason: string;
  reviewComments: ReviewComment[];
  reviewHistory: ReviewEvent[];
}

/* ------------------------------------------------------------------ */
/* Factories                                                           */
/* ------------------------------------------------------------------ */

export function createOccupant(partial: Partial<Occupant> = {}): Occupant {
  return {
    id: '',
    masterId: '',
    seat: 'driver',
    restraint: 'unknown',
    airbagDeployed: false,
    ejected: false,
    injury: 'none',
    transportedTo: '',
    transportedBy: '',
    ...partial,
  };
}

export function createUnit(partial: Partial<CrashUnit> = {}): CrashUnit {
  return {
    id: '',
    number: 1,
    kind: 'vehicle',
    driverOccupantId: '',
    occupants: [],
    year: '',
    make: '',
    model: '',
    style: '',
    color: '',
    vin: '',
    plate: '',
    plateState: '',
    plateYear: '',
    ownerMasterId: '',
    ownerIsDriver: false,
    insuranceCarrier: '',
    insurancePolicy: '',
    direction: '',
    postedSpeed: '',
    estimatedSpeed: '',
    contributingFactors: [],
    damageAreas: [],
    damageSeverity: '',
    towed: false,
    towedBy: '',
    towedTo: '',
    citations: [],
    notes: '',
    ...partial,
  };
}

export function createCrashReport(partial: Partial<CrashReport> = {}): CrashReport {
  const now = new Date().toISOString();
  return {
    id: '',
    caseNumber: '',
    stateCrashNumber: '',
    status: 'draft',
    callNumber: '',
    occurredAt: '',
    reportedAt: '',
    locationId: '',
    onRoad: '',
    crossStreet: '',
    milepost: '',
    latitude: '',
    longitude: '',
    manner: '',
    lightCondition: '',
    weather: '',
    roadSurface: '',
    roadCharacter: '',
    workZone: false,
    schoolZone: false,
    severity: 'none',
    diagram: null,
    units: [],
    narrative: '',
    linkedIncidentId: '',
    reportingOfficer: '',
    reportingBadge: '',
    createdBy: '',
    createdAt: now,
    updatedAt: now,
    submittedAt: '',
    reviewedBy: '',
    reviewedAt: '',
    returnedReason: '',
    reviewComments: [],
    reviewHistory: [],
    ...partial,
  };
}

export function nextUnitNumber(units: CrashUnit[]): number {
  return units.reduce((max, u) => Math.max(max, u.number), 0) + 1;
}

/** "Unit 2 — 2011 Chevrolet Silverado" */
export function unitLabel(unit: CrashUnit): string {
  const vehicle = [unit.year, unit.make, unit.model].filter(Boolean).join(' ');
  const kind = UNIT_KINDS.find((k) => k.value === unit.kind)?.label ?? 'Unit';
  return `Unit ${unit.number} — ${vehicle || kind}`;
}

/**
 * The worst injury anywhere in the crash.
 *
 * Derived rather than typed. An officer who marks the crash "minor" and then
 * records a fatality on unit 2 has produced a report the state will reject and,
 * far worse, one that does not trigger the response a fatality requires.
 */
export function worstInjury(report: CrashReport): Severity {
  const order: Severity[] = ['fatal', 'serious', 'minor', 'possible', 'none'];
  for (const level of order) {
    if (report.units.some((u) => u.occupants.some((o) => o.injury === level))) return level;
  }
  return 'none';
}

export function occupantCount(report: CrashReport): number {
  return report.units.reduce((n, u) => n + u.occupants.length, 0);
}

export function injuredCount(report: CrashReport): number {
  return report.units.reduce(
    (n, u) => n + u.occupants.filter((o) => o.injury !== 'none').length,
    0,
  );
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface CrashProblem {
  field: string;
  unitId?: string;
  message: string;
  tip: string;
  severity: 'error' | 'warning';
}

/** Words that are not a crash narrative. */
export const MIN_NARRATIVE_WORDS = 25;

/**
 * What has to be true before a crash report goes up.
 *
 * Modelled on the edits a state crash file actually rejects on, because a
 * report returned by the state six weeks later costs an officer far more than
 * a message on the screen now.
 */
export function checkCrash(report: CrashReport): CrashProblem[] {
  const problems: CrashProblem[] = [];
  const error = (field: string, message: string, tip: string, unitId?: string) =>
    problems.push({ field, message, tip, unitId, severity: 'error' });
  const warn = (field: string, message: string, tip: string, unitId?: string) =>
    problems.push({ field, message, tip, unitId, severity: 'warning' });

  if (!report.occurredAt) {
    error('occurredAt', 'When the crash happened is required.', 'The time drives the light condition and the state file.');
  }
  if (report.occurredAt && report.reportedAt && report.occurredAt > report.reportedAt) {
    error(
      'occurredAt',
      'The crash cannot have happened after it was reported.',
      'Check whether the times were entered the wrong way round.',
    );
  }
  if (!report.onRoad.trim()) {
    error('onRoad', 'The road the crash happened on is required.', 'Crashes are located by road and cross street, not by street number.');
  }
  if (!report.lightCondition) {
    warn('lightCondition', 'Light condition is missing.', 'The state crash file uses it for every night-time analysis.');
  }
  if (!report.weather) {
    warn('weather', 'Weather is missing.', 'One of the most-used fields in the state file.');
  }
  if (!report.manner) {
    warn('manner', 'Manner of collision is missing.', 'Rear end, angle, head on — how the units came together.');
  }

  /* ---- Units ------------------------------------------------------- */
  if (report.units.length === 0) {
    error('units', 'A crash report needs at least one unit.', 'A unit is a vehicle, a pedestrian or a cyclist involved in the crash.');
  }
  if (report.units.length === 1 && report.manner && report.manner !== 'single') {
    warn(
      'manner',
      'One unit is recorded but the manner of collision is not "single vehicle".',
      'Either add the other unit or change the manner.',
    );
  }

  for (const unit of report.units) {
    const label = `Unit ${unit.number}`;

    if (unit.kind === 'vehicle') {
      if (!unit.plate.trim() && !unit.vin.trim()) {
        warn(
          'plate',
          `${label} has no plate or VIN.`,
          'One or the other is what lets an insurer and the state identify the vehicle.',
          unit.id,
        );
      }
      if (!unit.driverOccupantId && unit.occupants.length > 0) {
        error(
          'driver',
          `${label} has occupants but nobody marked as the driver.`,
          'Mark which occupant was driving. A vehicle unit with no driver is rejected by the state file.',
          unit.id,
        );
      }
      if (unit.occupants.length === 0) {
        warn(
          'occupants',
          `${label} has no occupants recorded.`,
          'Even an unattended parked car should say so in the narrative.',
          unit.id,
        );
      }
    }

    if (unit.contributingFactors.length === 0) {
      warn(
        'contributingFactors',
        `${label} has no contributing factor.`,
        'Pick "no contributing factor for this unit" if that is the finding — leaving it blank reads as unfinished.',
        unit.id,
      );
    }

    if (unit.towed && !unit.towedTo.trim()) {
      warn('towedTo', `${label} is marked towed with no destination.`, 'The owner will ring tomorrow asking where the car is.', unit.id);
    }

    for (const occupant of unit.occupants) {
      if (!occupant.masterId) {
        error(
          'occupant',
          `${label} has an occupant with no identity.`,
          'Every occupant needs a name, or to be recorded as unknown.',
          unit.id,
        );
      }
      if (occupant.injury !== 'none' && !occupant.transportedTo.trim()) {
        warn(
          'transportedTo',
          `${label}: an injured occupant has no destination recorded.`,
          'Where they were taken, or that they refused transport.',
          unit.id,
        );
      }
    }
  }

  /* ---- Severity ----------------------------------------------------- */
  const worst = worstInjury(report);
  if (worst !== report.severity) {
    error(
      'severity',
      `The crash is marked "${SEVERITIES.find((s) => s.value === report.severity)?.label}" but the worst injury recorded is "${SEVERITIES.find((s) => s.value === worst)?.label}".`,
      'The crash severity has to match the worst injury on it. Fix whichever is wrong.',
    );
  }

  /*
    A fatal crash without a linked incident report is worth stopping on. A
    fatality is investigated, and in most states it is a criminal
    investigation until it is ruled otherwise.
  */
  if (worst === 'fatal' && !report.linkedIncidentId) {
    warn(
      'linkedIncidentId',
      'A fatal crash with no linked incident report.',
      'Start an incident report for the investigation and link it, or say in the narrative why one is not needed.',
    );
  }

  /*
    A diagram is the part of the report a jury actually looks at, and the state
    form has a box for it. Not a blocker — a single-vehicle deer strike does not
    need one — but worth asking about on anything with two units.
  */
  if (report.units.length > 1 && (!report.diagram || report.diagram.shapes.length === 0)) {
    warn(
      'diagram',
      'No scene diagram.',
      'Two units means somebody will want to see how they came together. The units are already on the report, so placing them takes a moment.',
    );
  }

  /* ---- Narrative ---------------------------------------------------- */
  const words = report.narrative.trim() ? report.narrative.trim().split(/\s+/).length : 0;
  if (words === 0) {
    error('narrative', 'A crash report needs a narrative.', 'Describe how the units came together, in unit numbers.');
  } else if (words < MIN_NARRATIVE_WORDS) {
    warn(
      'narrative',
      `The narrative is ${words} words.`,
      'An adjuster and possibly a jury will read this. Say what each unit was doing and how they met.',
    );
  }

  return problems;
}

export function crashErrors(report: CrashReport): CrashProblem[] {
  return checkCrash(report).filter((p) => p.severity === 'error');
}

export function canSubmitCrash(report: CrashReport): boolean {
  return crashErrors(report).length === 0;
}
