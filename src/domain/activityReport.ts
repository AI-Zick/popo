/**
 * Officer activity reports.
 *
 * What a sergeant runs before a shift review, what a chief runs before a
 * council meeting, and what an officer runs when their evaluation is coming up.
 * One or more officers, a date or a date range, and only the sections that were
 * asked for.
 *
 * Two rules run through the whole thing:
 *
 *   **A zero is a fact, not a gap.** An officer who wrote no reports on Tuesday
 *   shows a 0, not an empty row. A report that silently omits people makes
 *   every number in it unverifiable.
 *
 *   **Say where a number came from.** "Arrests" counted off report authorship
 *   and "arrests" counted off the arresting officer are different numbers, and
 *   a report that does not say which it used is a report that will be argued
 *   with. Each section carries its own basis, in words.
 */

import type { Incident } from './types';
import type { Supplement } from './supplement';
import type { TrafficStop } from './activity';
import { citationCount, warningCount } from './activity';
import type { User } from './auth';
import { OFFENSE_BY_CODE } from './codes';

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

export type SectionKey =
  | 'stops'
  | 'citations'
  | 'reports'
  | 'supplements'
  | 'arrests'
  | 'offenses'
  | 'property'
  | 'clearance';

export const SECTION_META: Record<
  SectionKey,
  { label: string; description: string; basis: string }
> = {
  stops: {
    label: 'Traffic stops',
    description: 'Stops made, by reason and outcome.',
    basis: 'Counted from stop records, by the officer who made the stop, on the date of the stop.',
  },
  citations: {
    label: 'Citations and warnings',
    description: 'What came out of those stops.',
    basis: 'Counted from citations attached to stops. Written warnings are counted separately from citations.',
  },
  reports: {
    label: 'Reports',
    description: 'Incident reports written, and where they stand.',
    basis: 'Counted by the account that authored the report, on the date the incident was reported.',
  },
  supplements: {
    label: 'Supplements',
    description: 'Follow-ups and assisting-officer reports.',
    basis: 'Counted by the account that authored the supplement, on the date it was created.',
  },
  arrests: {
    label: 'Arrests',
    description: 'People taken into custody.',
    basis: 'Counted by the arresting officer where one is recorded, otherwise by the author of the report the arrest appears on.',
  },
  offenses: {
    label: 'Offenses',
    description: 'What the reports were for, by category.',
    basis: 'Counted from offenses on reports authored by the officer.',
  },
  property: {
    label: 'Property',
    description: 'Value stolen and recovered.',
    basis: 'Summed from property records on reports authored by the officer. Values are as entered.',
  },
  clearance: {
    label: 'Case status',
    description: 'How the officer’s cases stand.',
    basis: 'The current status of reports authored by the officer, including any change made by an approved supplement.',
  },
};

export const ALL_SECTIONS: SectionKey[] = [
  'stops',
  'citations',
  'reports',
  'supplements',
  'arrests',
  'offenses',
  'property',
  'clearance',
];

/* ------------------------------------------------------------------ */
/* Range                                                               */
/* ------------------------------------------------------------------ */

export interface DateRange {
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  /** `YYYY-MM-DD`, inclusive. Same as `from` for a single day. */
  to: string;
}

/**
 * Whether a timestamp falls in the range.
 *
 * Compared as calendar dates, on the local day. A range is inclusive at both
 * ends because "the 3rd to the 7th" means five days to everyone who is not a
 * programmer, and an activity report that quietly drops the last day is a
 * report that undercounts every shift on it.
 */
export function inRange(iso: string, range: DateRange): boolean {
  if (!iso) return false;
  const day = localDay(iso);
  if (!day) return false;
  return day >= range.from && day <= range.to;
}

/** The local calendar day of a timestamp, as `YYYY-MM-DD`. */
export function localDay(iso: string): string | null {
  // Already a plain date, or a local datetime with no zone: take it as written.
  if (/^\d{4}-\d{2}-\d{2}/.test(iso) && !iso.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(iso)) {
    return iso.slice(0, 10);
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function describeRange(range: DateRange): string {
  const pretty = (day: string) => {
    const d = new Date(`${day}T00:00`);
    return Number.isNaN(d.getTime())
      ? day
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  return range.from === range.to ? pretty(range.from) : `${pretty(range.from)} to ${pretty(range.to)}`;
}

/** Whole days covered, inclusive. */
export function daysInRange(range: DateRange): number {
  const from = new Date(`${range.from}T00:00`).getTime();
  const to = new Date(`${range.to}T00:00`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 0;
  return Math.round((to - from) / 86_400_000) + 1;
}

/* ------------------------------------------------------------------ */
/* The result                                                          */
/* ------------------------------------------------------------------ */

/** One number, for one officer, in one section. */
export interface Metric {
  key: string;
  label: string;
  value: number;
  /** Rendered as currency rather than a count. */
  currency?: boolean;
}

export interface OfficerRow {
  officerId: string;
  officerName: string;
  badge: string;
  metrics: Metric[];
}

export interface ReportSection {
  key: SectionKey;
  label: string;
  description: string;
  basis: string;
  /** Column order, shared by every row and by the totals. */
  columns: { key: string; label: string; currency?: boolean }[];
  rows: OfficerRow[];
  totals: Metric[];
}

export interface ActivityReport {
  range: DateRange;
  days: number;
  officers: { id: string; name: string; badge: string }[];
  sections: ReportSection[];
  /** True when nothing at all fell in the range, for any officer. */
  empty: boolean;
  generatedAt: string;
}

export interface ActivityInput {
  officerIds: string[];
  range: DateRange;
  sections: SectionKey[];
  users: User[];
  incidents: Incident[];
  supplements: Supplement[];
  stops: TrafficStop[];
  now?: Date;
}

/* ------------------------------------------------------------------ */
/* Building                                                            */
/* ------------------------------------------------------------------ */

function sum(rows: OfficerRow[], key: string): number {
  return rows.reduce((total, row) => total + (row.metrics.find((m) => m.key === key)?.value ?? 0), 0);
}

function sectionFrom(
  key: SectionKey,
  columns: { key: string; label: string; currency?: boolean }[],
  rows: OfficerRow[],
): ReportSection {
  const meta = SECTION_META[key];
  return {
    key,
    label: meta.label,
    description: meta.description,
    basis: meta.basis,
    columns,
    rows,
    totals: columns.map((c) => ({
      key: c.key,
      label: c.label,
      value: sum(rows, c.key),
      currency: c.currency,
    })),
  };
}

export function buildActivityReport(input: ActivityInput): ActivityReport {
  const { range, officerIds, sections: wanted } = input;

  const officers = officerIds
    .map((id) => input.users.find((u) => u.id === id))
    .filter((u): u is User => Boolean(u))
    .map((u) => ({ id: u.id, name: u.name, badge: u.badge }));

  // Narrowed once, then reused by every section.
  const stops = input.stops.filter((s) => inRange(s.at, range));
  const incidents = input.incidents.filter((i) => inRange(i.reportedAt, range));
  const supplements = input.supplements.filter((s) => inRange(s.createdAt, range));

  const authorOf = new Map(input.incidents.map((i) => [i.id, i.createdBy]));

  const sections: ReportSection[] = [];

  const forEachOfficer = (build: (officerId: string) => Metric[]): OfficerRow[] =>
    officers.map((o) => ({
      officerId: o.id,
      officerName: o.name,
      badge: o.badge,
      metrics: build(o.id),
    }));

  /* ---- Traffic stops ---------------------------------------------- */
  if (wanted.includes('stops')) {
    const columns = [
      { key: 'total', label: 'Stops' },
      { key: 'speed', label: 'Speed' },
      { key: 'moving', label: 'Moving' },
      { key: 'equipment', label: 'Equipment' },
      { key: 'registration', label: 'Registration' },
      { key: 'other', label: 'Other' },
      { key: 'arrest', label: 'Led to arrest' },
    ];
    sections.push(
      sectionFrom(
        'stops',
        columns,
        forEachOfficer((id) => {
          const mine = stops.filter((s) => s.officerId === id);
          const byReason = (r: string) => mine.filter((s) => s.reason === r).length;
          return [
            { key: 'total', label: 'Stops', value: mine.length },
            { key: 'speed', label: 'Speed', value: byReason('speed') },
            { key: 'moving', label: 'Moving', value: byReason('moving') },
            { key: 'equipment', label: 'Equipment', value: byReason('equipment') },
            { key: 'registration', label: 'Registration', value: byReason('registration') },
            {
              key: 'other',
              label: 'Other',
              value: mine.filter((s) => ['suspicion', 'bolo', 'other'].includes(s.reason)).length,
            },
            {
              key: 'arrest',
              label: 'Led to arrest',
              value: mine.filter((s) => s.outcome === 'arrest').length,
            },
          ];
        }),
      ),
    );
  }

  /* ---- Citations --------------------------------------------------- */
  if (wanted.includes('citations')) {
    const columns = [
      { key: 'citations', label: 'Citations' },
      { key: 'warnings', label: 'Written warnings' },
      { key: 'verbal', label: 'Verbal warnings' },
      { key: 'noAction', label: 'No action' },
    ];
    sections.push(
      sectionFrom(
        'citations',
        columns,
        forEachOfficer((id) => {
          const mine = stops.filter((s) => s.officerId === id);
          return [
            {
              key: 'citations',
              label: 'Citations',
              value: mine.reduce((n, s) => n + citationCount(s), 0),
            },
            {
              key: 'warnings',
              label: 'Written warnings',
              value: mine.reduce((n, s) => n + warningCount(s), 0),
            },
            {
              key: 'verbal',
              label: 'Verbal warnings',
              // A warning outcome with nothing written down is a verbal one.
              value: mine.filter((s) => s.outcome === 'warning' && s.citations.length === 0).length,
            },
            {
              key: 'noAction',
              label: 'No action',
              value: mine.filter((s) => s.outcome === 'no_action').length,
            },
          ];
        }),
      ),
    );
  }

  /* ---- Reports ------------------------------------------------------ */
  if (wanted.includes('reports')) {
    const columns = [
      { key: 'total', label: 'Reports' },
      { key: 'approved', label: 'Approved' },
      { key: 'pending', label: 'In review' },
      { key: 'returned', label: 'Returned' },
      { key: 'draft', label: 'Draft' },
    ];
    sections.push(
      sectionFrom(
        'reports',
        columns,
        forEachOfficer((id) => {
          const mine = incidents.filter((i) => i.createdBy === id);
          const byStatus = (s: string) => mine.filter((i) => i.status === s).length;
          return [
            { key: 'total', label: 'Reports', value: mine.length },
            { key: 'approved', label: 'Approved', value: byStatus('approved') },
            { key: 'pending', label: 'In review', value: byStatus('pending_review') },
            { key: 'returned', label: 'Returned', value: byStatus('returned') },
            { key: 'draft', label: 'Draft', value: byStatus('draft') },
          ];
        }),
      ),
    );
  }

  /* ---- Supplements -------------------------------------------------- */
  if (wanted.includes('supplements')) {
    const columns = [
      { key: 'total', label: 'Supplements' },
      { key: 'assisting', label: 'On another officer’s report' },
      { key: 'approved', label: 'Approved' },
    ];
    sections.push(
      sectionFrom(
        'supplements',
        columns,
        forEachOfficer((id) => {
          const mine = supplements.filter((s) => s.createdBy === id);
          return [
            { key: 'total', label: 'Supplements', value: mine.length },
            {
              key: 'assisting',
              label: 'On another officer’s report',
              value: mine.filter((s) => {
                const author = authorOf.get(s.caseId);
                return Boolean(author) && author !== id;
              }).length,
            },
            {
              key: 'approved',
              label: 'Approved',
              value: mine.filter((s) => s.status === 'approved').length,
            },
          ];
        }),
      ),
    );
  }

  /* ---- Arrests ------------------------------------------------------ */
  if (wanted.includes('arrests')) {
    const columns = [
      { key: 'total', label: 'Arrests' },
      { key: 'onView', label: 'On view' },
      { key: 'warrant', label: 'Warrant / custody' },
      { key: 'summons', label: 'Summons' },
      { key: 'juvenile', label: 'On juvenile cases' },
    ];

    /*
      Attribution: the arresting officer where one is recorded, otherwise the
      report's author. Falling back rather than dropping the arrest keeps the
      agency total right on older records; the section's basis line says so.
    */
    const arrestsFor = (officerId: string) =>
      incidents.flatMap((incident) =>
        incident.persons
          .filter((p) => p.role === 'arrestee' && p.arrestDate)
          .filter((p) => (p.arrestingOfficerId || incident.createdBy) === officerId)
          .map((p) => ({ person: p, incident })),
      );

    sections.push(
      sectionFrom(
        'arrests',
        columns,
        forEachOfficer((id) => {
          const mine = arrestsFor(id);
          const byType = (t: string) => mine.filter((a) => a.person.arrestType === t).length;
          return [
            { key: 'total', label: 'Arrests', value: mine.length },
            { key: 'onView', label: 'On view', value: byType('O') },
            { key: 'warrant', label: 'Warrant / custody', value: byType('T') },
            { key: 'summons', label: 'Summons', value: byType('S') },
            {
              key: 'juvenile',
              label: 'On juvenile cases',
              value: mine.filter((a) => a.incident.involvesJuvenile).length,
            },
          ];
        }),
      ),
    );
  }

  /* ---- Offenses ----------------------------------------------------- */
  if (wanted.includes('offenses')) {
    const columns = [
      { key: 'total', label: 'Offenses' },
      { key: 'person', label: 'Against persons' },
      { key: 'property', label: 'Against property' },
      { key: 'society', label: 'Against society' },
      { key: 'domestic', label: 'Domestic-flagged' },
    ];
    sections.push(
      sectionFrom(
        'offenses',
        columns,
        forEachOfficer((id) => {
          const mine = incidents.filter((i) => i.createdBy === id);
          const offenses = mine.flatMap((i) => i.offenses);
          const byCategory = (c: string) =>
            offenses.filter((o) => OFFENSE_BY_CODE.get(o.code)?.category === c).length;
          return [
            { key: 'total', label: 'Offenses', value: offenses.length },
            { key: 'person', label: 'Against persons', value: byCategory('person') },
            { key: 'property', label: 'Against property', value: byCategory('property') },
            { key: 'society', label: 'Against society', value: byCategory('society') },
            {
              key: 'domestic',
              label: 'Domestic-flagged',
              value: mine.filter((i) => i.isDomestic).length,
            },
          ];
        }),
      ),
    );
  }

  /* ---- Property ----------------------------------------------------- */
  if (wanted.includes('property')) {
    const columns = [
      { key: 'stolen', label: 'Value stolen', currency: true },
      { key: 'recovered', label: 'Value recovered', currency: true },
      { key: 'items', label: 'Items recorded' },
    ];
    const money = (v: string) => Math.round(Number(String(v).replace(/[^0-9.]/g, '')) || 0);
    sections.push(
      sectionFrom(
        'property',
        columns,
        forEachOfficer((id) => {
          const items = incidents.filter((i) => i.createdBy === id).flatMap((i) => i.property);
          return [
            {
              key: 'stolen',
              label: 'Value stolen',
              value: items.filter((p) => p.lossType === 'stolen').reduce((n, p) => n + money(p.value), 0),
              currency: true,
            },
            {
              key: 'recovered',
              label: 'Value recovered',
              value: items
                .filter((p) => p.lossType === 'recovered')
                .reduce((n, p) => n + money(p.value), 0),
              currency: true,
            },
            { key: 'items', label: 'Items recorded', value: items.length },
          ];
        }),
      ),
    );
  }

  /* ---- Clearance ---------------------------------------------------- */
  if (wanted.includes('clearance')) {
    const columns = [
      { key: 'open', label: 'Open' },
      { key: 'arrest', label: 'Cleared by arrest' },
      { key: 'exceptional', label: 'Cleared exceptionally' },
      { key: 'unfounded', label: 'Unfounded' },
      { key: 'inactive', label: 'Inactive' },
    ];
    sections.push(
      sectionFrom(
        'clearance',
        columns,
        forEachOfficer((id) => {
          const mine = incidents.filter((i) => i.createdBy === id);
          const by = (c: string) => mine.filter((i) => i.clearanceStatus === c).length;
          return [
            { key: 'open', label: 'Open', value: by('open') },
            { key: 'arrest', label: 'Cleared by arrest', value: by('cleared_arrest') },
            { key: 'exceptional', label: 'Cleared exceptionally', value: by('cleared_exceptional') },
            { key: 'unfounded', label: 'Unfounded', value: by('unfounded') },
            { key: 'inactive', label: 'Inactive', value: by('inactive') },
          ];
        }),
      ),
    );
  }

  const empty = sections.every((s) => s.totals.every((t) => t.value === 0));

  return {
    range,
    days: daysInRange(range),
    officers,
    sections,
    empty,
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}
