import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, FilePlus2, Search, Shield } from 'lucide-react';
import { useStore } from '@/state/store';
import { runRules } from '@/validation/engine';
import { ALL_RULES } from '@/validation/rules';
import { OFFENSE_BY_CODE } from '@/domain/codes';
import { formatDateTime, relativeTime } from '@/lib/format';
import { Badge, Button, EmptyState } from '@/components/ui/primitives';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import type { Incident, ReportStatus } from '@/domain/types';
import { cn } from '@/lib/cn';

const STATUS: Record<ReportStatus, { label: string; tone: 'neutral' | 'accent' | 'ok' | 'warn' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  pending_review: { label: 'Pending review', tone: 'accent' },
  approved: { label: 'Approved', tone: 'ok' },
  returned: { label: 'Returned', tone: 'warn' },
};

export function Dashboard() {
  const { incidents, openIncident, createNew } = useStore();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return incidents
      .map((incident) => ({
        incident,
        errors: runRules(incident, ALL_RULES).errors.length,
      }))
      .filter(({ incident }) => {
        if (!q) return true;
        return (
          incident.caseNumber.toLowerCase().includes(q) ||
          incident.address.toLowerCase().includes(q) ||
          incident.reportingOfficer.toLowerCase().includes(q) ||
          incident.offenses.some((o) => (OFFENSE_BY_CODE.get(o.code)?.label ?? '').toLowerCase().includes(q)) ||
          incident.persons.some((p) => `${p.firstName} ${p.lastName} ${p.businessName}`.toLowerCase().includes(q))
        );
      });
  }, [incidents, query]);

  const openCount = incidents.filter((i) => i.status === 'draft' || i.status === 'returned').length;
  const blockedCount = rows.filter((r) => r.errors > 0 && r.incident.status === 'draft').length;

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex shrink-0 items-center gap-4 border-b border-line bg-surface px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-white">
            <Shield size={17} aria-hidden />
          </span>
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight text-ink">Aegis RMS</h1>
            <p className="text-[11.5px] text-faint">Cedar Falls Police Department</p>
          </div>
        </div>

        <div className="flex-1" />

        <div className="relative w-80">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search case number, name, address, offense…"
            className="w-full rounded-lg border border-line bg-canvas py-2 pl-9 pr-3 text-[13.5px] text-ink placeholder:text-faint"
          />
        </div>

        <ThemeToggle />

        <Button variant="primary" onClick={createNew}>
          <FilePlus2 size={15} aria-hidden />
          New report
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <div className="mb-5 grid grid-cols-3 gap-3">
            <Stat label="Reports" value={String(incidents.length)} />
            <Stat label="Open drafts" value={String(openCount)} />
            <Stat
              label="Drafts with blocking issues"
              value={String(blockedCount)}
              tone={blockedCount > 0 ? 'danger' : 'ok'}
            />
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={<Search size={20} />}
              title={query ? 'No reports match that search' : 'No reports yet'}
              body={
                query
                  ? 'Try a case number, a last name, a street, or an offense like “burglary”.'
                  : 'Start a new report and the form will adapt to the offenses you choose.'
              }
              action={!query ? <Button variant="primary" onClick={createNew}>New report</Button> : undefined}
            />
          ) : (
            <ul className="space-y-2">
              {rows.map(({ incident, errors }) => (
                <li key={incident.id}>
                  <ReportRow incident={incident} errors={errors} onOpen={() => openIncident(incident.id)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'ok' }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-[11.5px] uppercase tracking-wide text-faint">{label}</p>
      <p
        className={cn(
          'mt-1 text-[24px] font-semibold tracking-tight tabular',
          tone === 'danger' ? 'text-danger' : tone === 'ok' ? 'text-ok' : 'text-ink',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ReportRow({
  incident,
  errors,
  onOpen,
}: {
  incident: Incident;
  errors: number;
  onOpen: () => void;
}) {
  const status = STATUS[incident.status];
  const offenses = incident.offenses
    .map((o) => OFFENSE_BY_CODE.get(o.code)?.label)
    .filter(Boolean)
    .join(', ');

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3 text-left transition hover:border-line-strong hover:shadow-sm"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13.5px] font-semibold text-ink">{incident.caseNumber}</span>
          <Badge tone={status.tone}>{status.label}</Badge>
          {incident.isDomestic && <Badge tone="danger">Domestic</Badge>}
        </div>
        <p className="mt-1 truncate text-[13.5px] text-ink">{offenses || 'No offense listed'}</p>
        <p className="mt-0.5 truncate text-[12px] text-faint">
          {[incident.address, incident.city].filter(Boolean).join(', ') || 'No location'} ·{' '}
          {formatDateTime(incident.reportedAt)} · {incident.reportingOfficer || 'Unassigned'}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {errors > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-danger-soft px-2 py-1 text-[12px] font-medium text-danger">
            <AlertCircle size={13} aria-hidden />
            {errors} to fix
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-ok-soft px-2 py-1 text-[12px] font-medium text-ok">
            <CheckCircle2 size={13} aria-hidden />
            Complete
          </span>
        )}
        <span className="text-[11.5px] text-faint">Updated {relativeTime(incident.updatedAt)}</span>
      </div>
    </button>
  );
}
