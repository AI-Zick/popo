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

/**
 * One column of a section: what it is called, and how to count it.
 *
 * Declared once, which is the point. Every section used to state its columns
 * twice — a list of headings, then the same keys and labels again beside each
 * value — so a label changed in one place and not the other produced a table
 * whose heading did not match its numbers, and nothing would have said so.
 * The heading row and the numbers are now read from the same list.
 */
interface Column<Of> {
  key: string;
  label: string;
  /** Rendered as money rather than a count. */
  currency?: boolean;
  count: (of: Of) => number;
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

  /**
   * Builds one section from its columns.
   *
   * `gather` is run once per officer and hands the columns whatever they need
   * to count — usually the officer's own rows, occasionally something prepared,
   * so that a section with five columns over the same list does not walk it
   * five times.
   */
  function build<Of>(
    key: SectionKey,
    columns: Column<Of>[],
    gather: (officerId: string) => Of,
  ): void {
    if (!wanted.includes(key)) return;

    const rows: OfficerRow[] = officers.map((officer) => {
      const of = gather(officer.id);
      return {
        officerId: officer.id,
        officerName: officer.name,
        badge: officer.badge,
        metrics: columns.map((column) => {
          // Built field by field rather than spread, so `currency` lands after
          // `value` exactly as a hand-written metric did.
          const metric: Metric = { key: column.key, label: column.label, value: column.count(of) };
          if (column.currency) metric.currency = true;
          return metric;
        }),
      };
    });

    sections.push(sectionFrom(key, columns.map(({ count, ...column }) => column), rows));
  }

  /* ---- Traffic stops ---------------------------------------------- */
  const reason = (r: string) => (mine: TrafficStop[]) => mine.filter((s) => s.reason === r).length;

  build<TrafficStop[]>(
    'stops',
    [
      { key: 'total', label: 'Stops', count: (mine) => mine.length },
      { key: 'speed', label: 'Speed', count: reason('speed') },
      { key: 'moving', label: 'Moving', count: reason('moving') },
      { key: 'equipment', label: 'Equipment', count: reason('equipment') },
      { key: 'registration', label: 'Registration', count: reason('registration') },
      {
        key: 'other',
        label: 'Other',
        count: (mine) => mine.filter((s) => ['suspicion', 'bolo', 'other'].includes(s.reason)).length,
      },
      {
        key: 'arrest',
        label: 'Led to arrest',
        count: (mine) => mine.filter((s) => s.outcome === 'arrest').length,
      },
    ],
    (id) => stops.filter((s) => s.officerId === id),
  );

  /* ---- Citations --------------------------------------------------- */
  build<TrafficStop[]>(
    'citations',
    [
      {
        key: 'citations',
        label: 'Citations',
        count: (mine) => mine.reduce((n, s) => n + citationCount(s), 0),
      },
      {
        key: 'warnings',
        label: 'Written warnings',
        count: (mine) => mine.reduce((n, s) => n + warningCount(s), 0),
      },
      {
        key: 'verbal',
        label: 'Verbal warnings',
        // A warning outcome with nothing written down is a verbal one.
        count: (mine) => mine.filter((s) => s.outcome === 'warning' && s.citations.length === 0).length,
      },
      {
        key: 'noAction',
        label: 'No action',
        count: (mine) => mine.filter((s) => s.outcome === 'no_action').length,
      },
    ],
    (id) => stops.filter((s) => s.officerId === id),
  );

  /* ---- Reports ------------------------------------------------------ */
  const status = (s: string) => (mine: Incident[]) => mine.filter((i) => i.status === s).length;

  build<Incident[]>(
    'reports',
    [
      { key: 'total', label: 'Reports', count: (mine) => mine.length },
      { key: 'approved', label: 'Approved', count: status('approved') },
      { key: 'pending', label: 'In review', count: status('pending_review') },
      { key: 'returned', label: 'Returned', count: status('returned') },
      { key: 'draft', label: 'Draft', count: status('draft') },
    ],
    (id) => incidents.filter((i) => i.createdBy === id),
  );

  /* ---- Supplements -------------------------------------------------- */
  build<{ mine: Supplement[]; officerId: string }>(
    'supplements',
    [
      { key: 'total', label: 'Supplements', count: ({ mine }) => mine.length },
      {
        key: 'assisting',
        label: 'On another officer\u2019s report',
        count: ({ mine, officerId }) =>
          mine.filter((s) => {
            const author = authorOf.get(s.caseId);
            return Boolean(author) && author !== officerId;
          }).length,
      },
      {
        key: 'approved',
        label: 'Approved',
        count: ({ mine }) => mine.filter((s) => s.status === 'approved').length,
      },
    ],
    (officerId) => ({ officerId, mine: supplements.filter((s) => s.createdBy === officerId) }),
  );

  /* ---- Arrests ------------------------------------------------------ */
  /*
    Attribution: the arresting officer where one is recorded, otherwise the
    report's author. Falling back rather than dropping the arrest keeps the
    agency total right on older records; the section's basis line says so.
  */
  type Arrest = { person: Incident['persons'][number]; incident: Incident };
  const arrestType = (t: string) => (mine: Arrest[]) =>
    mine.filter((a) => a.person.arrestType === t).length;

  build<Arrest[]>(
    'arrests',
    [
      { key: 'total', label: 'Arrests', count: (mine) => mine.length },
      { key: 'onView', label: 'On view', count: arrestType('O') },
      { key: 'warrant', label: 'Warrant / custody', count: arrestType('T') },
      { key: 'summons', label: 'Summons', count: arrestType('S') },
      {
        key: 'juvenile',
        label: 'On juvenile cases',
        count: (mine) => mine.filter((a) => a.incident.involvesJuvenile).length,
      },
    ],
    (officerId) =>
      incidents.flatMap((incident) =>
        incident.persons
          .filter((p) => p.role === 'arrestee' && p.arrestDate)
          .filter((p) => (p.arrestingOfficerId || incident.createdBy) === officerId)
          .map((person) => ({ person, incident })),
      ),
  );

  /* ---- Offenses ----------------------------------------------------- */
  type Offenses = { reports: Incident[]; offenses: Incident['offenses'] };
  const category = (c: string) => ({ offenses }: Offenses) =>
    offenses.filter((o) => OFFENSE_BY_CODE.get(o.code)?.category === c).length;

  build<Offenses>(
    'offenses',
    [
      { key: 'total', label: 'Offenses', count: ({ offenses }) => offenses.length },
      { key: 'person', label: 'Against persons', count: category('person') },
      { key: 'property', label: 'Against property', count: category('property') },
      { key: 'society', label: 'Against society', count: category('society') },
      {
        key: 'domestic',
        label: 'Domestic-flagged',
        count: ({ reports }) => reports.filter((i) => i.isDomestic).length,
      },
    ],
    (id) => {
      // Flattened once per officer rather than once per column.
      const reports = incidents.filter((i) => i.createdBy === id);
      return { reports, offenses: reports.flatMap((i) => i.offenses) };
    },
  );

  /* ---- Property ----------------------------------------------------- */
  const money = (v: string) => Math.round(Number(String(v).replace(/[^0-9.]/g, '')) || 0);
  const valueOf = (lossType: string) => (items: Incident['property']) =>
    items.filter((p) => p.lossType === lossType).reduce((n, p) => n + money(p.value), 0);

  build<Incident['property']>(
    'property',
    [
      { key: 'stolen', label: 'Value stolen', currency: true, count: valueOf('stolen') },
      { key: 'recovered', label: 'Value recovered', currency: true, count: valueOf('recovered') },
      { key: 'items', label: 'Items recorded', count: (items) => items.length },
    ],
    (id) => incidents.filter((i) => i.createdBy === id).flatMap((i) => i.property),
  );

  /* ---- Clearance ---------------------------------------------------- */
  const clearance = (c: string) => (mine: Incident[]) =>
    mine.filter((i) => i.clearanceStatus === c).length;

  build<Incident[]>(
    'clearance',
    [
      { key: 'open', label: 'Open', count: clearance('open') },
      { key: 'arrest', label: 'Cleared by arrest', count: clearance('cleared_arrest') },
      { key: 'exceptional', label: 'Cleared exceptionally', count: clearance('cleared_exceptional') },
      { key: 'unfounded', label: 'Unfounded', count: clearance('unfounded') },
      { key: 'inactive', label: 'Inactive', count: clearance('inactive') },
    ],
    (id) => incidents.filter((i) => i.createdBy === id),
  );

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
