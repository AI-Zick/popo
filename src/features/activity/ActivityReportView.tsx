import { useMemo, useState } from 'react';
import { BarChart3, Calendar, Printer, Users } from 'lucide-react';
import { useStore } from '@/state/store';
import {
  ALL_SECTIONS,
  buildActivityReport,
  describeRange,
  SECTION_META,
  type DateRange,
  type SectionKey,
} from '@/domain/activityReport';
import { Button, Panel } from '@/components/ui/primitives';
import { currency } from '@/lib/format';
import { cn } from '@/lib/cn';
import { PrintableActivityReport } from './PrintableActivityReport';

const today = () => new Date().toISOString().slice(0, 10);

/** Ranges a supervisor actually asks for, rather than a calendar widget. */
const PRESETS: { label: string; range: () => DateRange }[] = [
  { label: 'Today', range: () => ({ from: today(), to: today() }) },
  {
    label: 'Yesterday',
    range: () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const day = d.toISOString().slice(0, 10);
      return { from: day, to: day };
    },
  },
  {
    label: 'Last 7 days',
    range: () => {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      return { from: d.toISOString().slice(0, 10), to: today() };
    },
  },
  {
    label: 'Last 30 days',
    range: () => {
      const d = new Date();
      d.setDate(d.getDate() - 29);
      return { from: d.toISOString().slice(0, 10), to: today() };
    },
  },
];

/**
 * The activity report.
 *
 * What a sergeant runs before a shift review and an officer runs before their
 * evaluation. Officers, a date or a range, and only the sections asked for —
 * because "traffic stops alone" and "everything" are both real requests and a
 * report that always shows everything is one nobody reads.
 */
export function ActivityReportView() {
  const { users, incidents, supplements, stops, currentUser, can } = useStore();

  const [range, setRange] = useState<DateRange>({ from: today(), to: today() });
  const [sections, setSections] = useState<SectionKey[]>(['stops', 'citations', 'reports', 'arrests']);
  const [printing, setPrinting] = useState(false);

  // An officer without review permission sees only their own numbers. This is
  // a personnel record: who else's activity you may read is not a UI decision.
  const mayReadOthers = can('reports.approve') || can('users.manage');
  const selectable = useMemo(
    () => (mayReadOthers ? users.filter((u) => u.active) : users.filter((u) => u.id === currentUser.id)),
    [users, mayReadOthers, currentUser.id],
  );

  const [officerIds, setOfficerIds] = useState<string[]>([currentUser.id]);

  const report = useMemo(
    () =>
      buildActivityReport({
        officerIds: officerIds.filter((id) => selectable.some((u) => u.id === id)),
        range,
        sections,
        users,
        incidents,
        supplements,
        stops,
      }),
    [officerIds, range, sections, users, incidents, supplements, stops, selectable],
  );

  const toggleOfficer = (id: string) =>
    setOfficerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleSection = (key: SectionKey) =>
    // Kept in the canonical order however they are clicked, so the report reads
    // the same way every time it is run.
    setSections((prev) =>
      prev.includes(key)
        ? prev.filter((x) => x !== key)
        : ALL_SECTIONS.filter((s) => s === key || prev.includes(s)),
    );

  return (
    <>
      {printing && <PrintableActivityReport report={report} onClose={() => setPrinting(false)} />}

      <Panel
        title="Who and when"
        description="One officer or several, a single date or a range."
        aside={<Users size={17} className="text-faint" aria-hidden />}
      >
        {!mayReadOthers && (
          <p className="mb-3 rounded-lg bg-raised px-3 py-2 text-[12px] leading-relaxed text-muted">
            You can run this on your own activity. Another officer’s figures are a personnel record
            and need review permission.
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {selectable.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => toggleOfficer(user.id)}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium transition',
                officerIds.includes(user.id)
                  ? 'border-accent bg-accent-soft text-ink'
                  : 'border-line text-muted hover:border-line-strong',
              )}
            >
              {user.name}
              {user.badge && <span className="ml-1.5 text-[11px] text-faint">#{user.badge}</span>}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <label className="text-[12.5px] text-muted">
            <span className="mb-1 block">From</span>
            <input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
              className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink"
            />
          </label>
          <label className="text-[12.5px] text-muted">
            <span className="mb-1 block">To</span>
            <input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
              className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink"
            />
          </label>

          <div className="flex flex-wrap gap-1.5 pb-0.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setRange(preset.range())}
                className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-muted transition hover:bg-surface hover:text-ink"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      <Panel
        title="What to include"
        description="Only the sections you pick appear, on screen and on paper."
        aside={<BarChart3 size={17} className="text-faint" aria-hidden />}
      >
        <div className="grid grid-cols-2 gap-2">
          {ALL_SECTIONS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleSection(key)}
              className={cn(
                'rounded-xl border px-3 py-2 text-left transition',
                sections.includes(key)
                  ? 'border-accent bg-accent-soft'
                  : 'border-line bg-canvas hover:border-line-strong',
              )}
            >
              <span className="block text-[13px] font-medium text-ink">{SECTION_META[key].label}</span>
              <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted">
                {SECTION_META[key].description}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex gap-3 border-t border-line pt-3">
          <button
            type="button"
            onClick={() => setSections(ALL_SECTIONS)}
            className="text-[12.5px] font-medium text-accent hover:underline"
          >
            Everything
          </button>
          <button
            type="button"
            onClick={() => setSections([])}
            className="text-[12.5px] text-muted hover:text-ink"
          >
            Clear
          </button>
        </div>
      </Panel>

      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Calendar size={14} aria-hidden />
          {describeRange(range)} · {report.days} {report.days === 1 ? 'day' : 'days'} ·{' '}
          {report.officers.length} {report.officers.length === 1 ? 'officer' : 'officers'}
        </p>
        <Button
          variant="primary"
          onClick={() => setPrinting(true)}
          disabled={sections.length === 0 || report.officers.length === 0}
        >
          <Printer size={15} aria-hidden />
          Print
        </Button>
      </div>

      {sections.length === 0 ? (
        <Panel title="Nothing selected">
          <p className="text-[12.5px] text-muted">Pick at least one section above.</p>
        </Panel>
      ) : report.officers.length === 0 ? (
        <Panel title="Nobody selected">
          <p className="text-[12.5px] text-muted">Pick at least one officer above.</p>
        </Panel>
      ) : (
        report.sections.map((section) => (
          <Panel key={section.key} title={section.label} description={section.basis}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wider text-faint">
                    <th className="py-1.5 pr-3 font-medium">Officer</th>
                    {section.columns.map((c) => (
                      <th key={c.key} className="px-2 py-1.5 text-right font-medium">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row) => (
                    <tr key={row.officerId} className="border-b border-line/60">
                      <td className="py-1.5 pr-3 text-ink">
                        {row.officerName}
                        {row.badge && <span className="ml-1.5 text-[11.5px] text-faint">#{row.badge}</span>}
                      </td>
                      {section.columns.map((c) => {
                        const m = row.metrics.find((x) => x.key === c.key);
                        return (
                          <td key={c.key} className="px-2 py-1.5 text-right tabular text-ink">
                            {c.currency ? currency(m?.value ?? 0) : (m?.value ?? 0)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {section.rows.length > 1 && (
                    <tr className="font-semibold">
                      <td className="py-1.5 pr-3 text-ink">Total</td>
                      {section.totals.map((t) => (
                        <td key={t.key} className="px-2 py-1.5 text-right tabular text-ink">
                          {t.currency ? currency(t.value) : t.value}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        ))
      )}
    </>
  );
}
