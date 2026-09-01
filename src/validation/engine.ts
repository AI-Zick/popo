import type { Incident, Offense, PropertyItem, SectionId, Vehicle } from '@/domain/types';
import { displayName, resolvePeople, type Person, type PersonIndex } from '@/domain/person';
import type { LocationIndex, MasterLocation } from '@/domain/location';
import { OFFENSE_BY_CODE, type OffenseCode } from '@/domain/codes';

export type Severity = 'error' | 'warning';

export interface QuickFix {
  label: string;
  /**
   * Mutates draft copies of the incident and the Master Name Index. May return
   * a field path to focus once applied, so "add the missing victim" lands the
   * cursor in the new victim's name field instead of dumping the user at the
   * top of a section.
   */
  apply: (draft: Incident, people: PersonIndex) => string | void;
  /** Some fixes only make sense once a location is chosen. */
  requiresLocation?: boolean;
}

export interface Issue {
  /** Stable identity, so an unresolved issue keeps its place in the list. */
  key: string;
  ruleId: string;
  severity: Severity;
  section: SectionId;
  /**
   * Field path used to focus the offending input, e.g.
   * `offenses[<id>].statute`. Section-level issues use the bare section name.
   */
  path: string;
  /** The record the issue belongs to, e.g. "Offense 2 — Burglary". */
  scope?: string;
  /** Short headline shown in the issue list. */
  title: string;
  /** Plain-language description of what is wrong. */
  message: string;
  /** How to fix it. Written for a patrol officer at 3am, not a records clerk. */
  tip?: string;
  quickFix?: QuickFix;
}

export interface RuleContext {
  incident: Incident;
  /** Every participant, joined to their master identity. */
  persons: Person[];
  /** The place this incident happened, from the location index. */
  location: MasterLocation | null;
  /** Offense definitions resolved from the codes table, in report order. */
  offenses: { offense: Offense; def: OffenseCode | undefined; index: number }[];
  victims: Person[];
  suspects: Person[];
  arrestees: Person[];
  /** Anyone who can be treated as an offender for relationship purposes. */
  offenders: Person[];
  property: PropertyItem[];
  vehicles: Vehicle[];
  /** True if any offense on the report carries the given flag. */
  anyOffense: (flag: keyof OffenseCode) => boolean;
  personLabel: (p: Person) => string;
  offenseLabel: (o: Offense, index: number) => string;
}

export type Rule = (ctx: RuleContext) => Issue[];

/* ------------------------------------------------------------------ */
/* Path helpers                                                        */
/* ------------------------------------------------------------------ */

export const path = {
  incident: (field: keyof Incident) => `incident.${String(field)}`,
  offense: (id: string, field: keyof Offense) => `offenses[${id}].${String(field)}`,
  person: (id: string, field: keyof Person | 'ageFrom' | 'ageTo') =>
    `persons[${id}].${String(field)}`,
  property: (id: string, field: keyof PropertyItem) => `property[${id}].${String(field)}`,
  vehicle: (id: string, field: keyof Vehicle) => `vehicles[${id}].${String(field)}`,
  section: (s: SectionId) => s,
};

/** Extracts the record id from a path like `persons[abc].lastName`. */
export function entityIdFromPath(p: string): string | null {
  const m = /\[([^\]]+)\]/.exec(p);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ */
/* Helpers exposed to rules                                            */
/* ------------------------------------------------------------------ */

export const blank = (v: string | undefined | null): boolean =>
  v === undefined || v === null || String(v).trim() === '';

export const personDisplayName = displayName;

export interface RuleData {
  people?: PersonIndex;
  locations?: LocationIndex;
}

export function buildContext(incident: Incident, data: RuleData = {}): RuleContext {
  const persons = resolvePeople(incident.persons, data.people ?? {});
  const location = (incident.locationId && data.locations?.[incident.locationId]) || null;
  const offenses = incident.offenses.map((offense, index) => ({
    offense,
    def: OFFENSE_BY_CODE.get(offense.code),
    index,
  }));

  const byRole = (role: Person['role']) => persons.filter((p) => p.role === role);
  const suspects = byRole('suspect');
  const arrestees = byRole('arrestee');

  const offenseLabel = (o: Offense, index: number) => {
    const def = OFFENSE_BY_CODE.get(o.code);
    return `Offense ${index + 1}${def ? ` — ${def.label}` : ''}`;
  };

  return {
    incident,
    persons,
    location,
    offenses,
    victims: byRole('victim'),
    suspects,
    arrestees,
    offenders: [...suspects, ...arrestees],
    property: incident.property,
    vehicles: incident.vehicles,
    anyOffense: (flag) => offenses.some((o) => Boolean(o.def?.[flag])),
    personLabel: personDisplayName,
    offenseLabel,
  };
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

export interface ValidationResult {
  issues: Issue[];
  errors: Issue[];
  warnings: Issue[];
  bySection: Record<SectionId, Issue[]>;
  byPath: Map<string, Issue[]>;
  errorCountBySection: Record<SectionId, number>;
  warningCountBySection: Record<SectionId, number>;
  /** True when nothing blocks submission. */
  canSubmit: boolean;
}

const EMPTY_SECTIONS = (): Record<SectionId, Issue[]> => ({
  incident: [],
  offenses: [],
  persons: [],
  property: [],
  vehicles: [],
  narrative: [],
  review: [],
});

const ZERO_SECTIONS = (): Record<SectionId, number> => ({
  incident: 0,
  offenses: 0,
  persons: 0,
  property: 0,
  vehicles: 0,
  narrative: 0,
  review: 0,
});

const SEVERITY_WEIGHT: Record<Severity, number> = { error: 0, warning: 1 };

export function runRules(incident: Incident, rules: Rule[], data: RuleData = {}): ValidationResult {
  const ctx = buildContext(incident, data);
  const issues: Issue[] = [];

  for (const rule of rules) {
    try {
      issues.push(...rule(ctx));
    } catch (err) {
      // A broken rule must never block a report from being written.
      console.error('Validation rule threw', err);
    }
  }

  // Stable order: section order, then errors before warnings.
  const sectionRank: Record<SectionId, number> = {
    incident: 0,
    offenses: 1,
    persons: 2,
    property: 3,
    vehicles: 4,
    narrative: 5,
    review: 6,
  };
  issues.sort(
    (a, b) =>
      sectionRank[a.section] - sectionRank[b.section] ||
      SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity] ||
      a.key.localeCompare(b.key),
  );

  const bySection = EMPTY_SECTIONS();
  const byPath = new Map<string, Issue[]>();
  const errorCountBySection = ZERO_SECTIONS();
  const warningCountBySection = ZERO_SECTIONS();

  for (const issue of issues) {
    bySection[issue.section].push(issue);
    const list = byPath.get(issue.path);
    if (list) list.push(issue);
    else byPath.set(issue.path, [issue]);
    if (issue.severity === 'error') errorCountBySection[issue.section] += 1;
    else warningCountBySection[issue.section] += 1;
  }

  const errors = issues.filter((i) => i.severity === 'error');

  return {
    issues,
    errors,
    warnings: issues.filter((i) => i.severity === 'warning'),
    bySection,
    byPath,
    errorCountBySection,
    warningCountBySection,
    canSubmit: errors.length === 0,
  };
}
