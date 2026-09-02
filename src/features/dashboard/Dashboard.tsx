import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Car,
  CheckCircle2,
  ClipboardList,
  CornerUpLeft,
  FileEdit,
  FilePlus2,
  Search,
  Send,
  Settings,
  Shield,
} from 'lucide-react';
import { useStore } from '@/state/store';
import { runRules } from '@/validation/engine';
import { ALL_RULES } from '@/validation/rules';
import { OFFENSE_BY_CODE } from '@/domain/codes';
import { formatDateTime, relativeTime } from '@/lib/format';
import { Badge, Button, EmptyState } from '@/components/ui/primitives';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { UserMenu } from '@/components/layout/UserMenu';
import { buildQueue, describeWait, STATUS_LABEL } from '@/domain/review';
import { supplementLabel, type Supplement } from '@/domain/supplement';
import type { CrashReport } from '@/domain/crash';
import type { Incident, ReportStatus } from '@/domain/types';
import { fullAddress, locationLabel, type MasterLocation } from '@/domain/location';
import { cn } from '@/lib/cn';

const STATUS_TONE: Record<ReportStatus, 'neutral' | 'accent' | 'ok' | 'warn'> = {
  draft: 'neutral',
  pending_review: 'accent',
  approved: 'ok',
  returned: 'warn',
};

/**
 * Filters an officer actually thinks in. "Mine, unfinished" is the first
 * question at the start of a shift; "what is waiting on me" is the first
 * question for a supervisor.
 */
type Filter = 'mine_open' | 'mine_returned' | 'mine_all' | 'pending' | 'approved' | 'all';

const FILTER_LABEL: Record<Filter, string> = {
  mine_open: 'My open cases',
  mine_returned: 'Sent back',
  mine_all: 'All mine',
  pending: 'Awaiting review',
  approved: 'Approved',
  all: 'Everything',
};

type Sort = 'updated' | 'oldest' | 'case';

export function Dashboard({ onOpenSetup }: { onOpenSetup: () => void }) {
  const {
    incidents,
    supplements,
    people,
    locations,
    agency,
    can,
    currentUser,
    lockOn,
    openIncident,
    openSupplement,
    crashes,
    openCrash,
    startCrash,
    createNew,
  } = useStore();
  const [tab, setTab] = useState<'cases' | 'queue'>('cases');
  const [filter, setFilter] = useState<Filter>('mine_open');
  const [sort, setSort] = useState<Sort>('updated');
  const [query, setQuery] = useState('');

  const mayReview = can('reports.approve');

  /*
    Reports and supplements queue together. A supervisor asks "what is waiting
    on me", not "what reports are waiting on me" — and a supplement that sits
    unreviewed for a week is a case whose clearance never reached the state.
  */
  const queue = useMemo(
    () => buildQueue([...incidents, ...supplements, ...crashes], currentUser),
    [incidents, supplements, crashes, currentUser],
  );

  const mine = (i: Incident) => i.createdBy === currentUser.id;

  /** Counts for the tiles, computed once over the whole set. */
  const counts = useMemo(
    () => ({
      mineOpen: incidents.filter((i) => mine(i) && (i.status === 'draft' || i.status === 'returned'))
        .length,
      returned: incidents.filter((i) => mine(i) && i.status === 'returned').length,
      /*
        A reviewer's "waiting on review" is the whole department's; an officer's
        "my submitted" is their own. Counting everyone's under a label that says
        "my" is how a tile stops being trusted.
      */
      pending: incidents.filter(
        (i) => i.status === 'pending_review' && (mayReview || mine(i)),
      ).length,
      approved: incidents.filter((i) => i.status === 'approved').length,
    }),
    [incidents, currentUser.id, mayReview],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();

    const matchesFilter = (i: Incident) => {
      switch (filter) {
        case 'mine_open':
          return mine(i) && (i.status === 'draft' || i.status === 'returned');
        case 'mine_returned':
          return mine(i) && i.status === 'returned';
        case 'mine_all':
          return mine(i);
        case 'pending':
          return i.status === 'pending_review' && (mayReview || mine(i));
        case 'approved':
          return i.status === 'approved';
        case 'all':
          return true;
      }
    };

    const matchesSearch = (i: Incident) => {
      if (!q) return true;
      return (
        i.caseNumber.toLowerCase().includes(q) ||
        locationLabel(locations[i.locationId]).toLowerCase().includes(q) ||
        i.reportingOfficer.toLowerCase().includes(q) ||
        i.offenses.some((o) => (OFFENSE_BY_CODE.get(o.code)?.label ?? '').toLowerCase().includes(q)) ||
        i.persons.some((link) => {
          const master = people[link.masterId];
          if (!master) return false;
          return `${master.firstName} ${master.lastName} ${master.businessName}`
            .toLowerCase()
            .includes(q);
        })
      );
    };

    return incidents
      .filter((i) => matchesFilter(i) && matchesSearch(i))
      .map((incident) => ({
        incident,
        errors: runRules(incident, ALL_RULES, { people, locations, agency }).errors.length,
      }))
      .sort((a, b) => {
        if (sort === 'case') return a.incident.caseNumber.localeCompare(b.incident.caseNumber);
        if (sort === 'oldest') return a.incident.reportedAt.localeCompare(b.incident.reportedAt);
        return b.incident.updatedAt.localeCompare(a.incident.updatedAt);
      });
  }, [incidents, people, locations, agency, query, filter, sort, currentUser.id, mayReview]);

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex shrink-0 items-center gap-4 border-b border-line bg-surface px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-white">
            <Shield size={17} aria-hidden />
          </span>
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight text-ink">Aegis RMS</h1>
            <p className="text-[11.5px] text-faint">{agency.name || 'Agency not configured'}</p>
          </div>
        </div>

        <div className="flex-1" />

        <div className="relative w-80">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter these reports…"
            className="w-full rounded-lg border border-line bg-canvas py-2 pl-9 pr-16 text-[13.5px] text-ink placeholder:text-faint"
          />
          {/*
            This box filters the list in front of you. Searching everything the
            agency knows is a different job, so it says where that lives.
          */}
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[10.5px] text-faint">
            ⌘K all
          </kbd>
        </div>

        <UserMenu />

        {/* Open to everyone: it holds the stop log and the activity report,
            which an officer runs on their own numbers. */}
        <button
            type="button"
            onClick={onOpenSetup}
            aria-label="Setup"
            className="flex size-9 items-center justify-center rounded-lg border border-line text-muted transition hover:bg-raised hover:text-ink"
          >
            <Settings size={16} aria-hidden />
          </button>

        <ThemeToggle />

        <Button onClick={() => void startCrash('')}>
          <Car size={15} aria-hidden />
          New crash
        </Button>

        <Button variant="primary" onClick={createNew}>
          <FilePlus2 size={15} aria-hidden />
          New report
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-6">
          {/* Tiles double as filters — the number and the way in are the same
              thing, so there is nothing to hunt for after reading it. */}
          <div className="mb-5 grid grid-cols-4 gap-3">
            <Tile
              icon={<FileEdit size={15} />}
              label="My open cases"
              value={counts.mineOpen}
              active={tab === 'cases' && filter === 'mine_open'}
              onClick={() => {
                setTab('cases');
                setFilter('mine_open');
              }}
            />
            <Tile
              icon={<CornerUpLeft size={15} />}
              label="Sent back to me"
              value={counts.returned}
              tone={counts.returned > 0 ? 'warn' : undefined}
              active={tab === 'cases' && filter === 'mine_returned'}
              onClick={() => {
                setTab('cases');
                setFilter('mine_returned');
              }}
            />
            <Tile
              icon={<Send size={15} />}
              label={mayReview ? 'Waiting on review' : 'My submitted'}
              value={counts.pending}
              tone={mayReview && counts.pending > 0 ? 'accent' : undefined}
              active={tab === 'cases' && filter === 'pending'}
              onClick={() => {
                if (mayReview) setTab('queue');
                else {
                  setTab('cases');
                  setFilter('pending');
                }
              }}
            />
            <Tile
              icon={<CheckCircle2 size={15} />}
              label="Approved"
              value={counts.approved}
              active={tab === 'cases' && filter === 'approved'}
              onClick={() => {
                setTab('cases');
                setFilter('approved');
              }}
            />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {(Object.keys(FILTER_LABEL) as Filter[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setTab('cases');
                  setFilter(key);
                }}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-[13px] font-medium transition',
                  tab === 'cases' && filter === key
                    ? 'bg-surface text-ink ring-1 ring-line'
                    : 'text-muted hover:bg-surface/60',
                )}
              >
                {FILTER_LABEL[key]}
              </button>
            ))}

            {mayReview && (
              <button
                type="button"
                onClick={() => setTab('queue')}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition',
                  tab === 'queue' ? 'bg-surface text-ink ring-1 ring-line' : 'text-muted hover:bg-surface/60',
                )}
              >
                <ClipboardList size={14} aria-hidden />
                Review queue
                {queue.length > 0 && (
                  <span className="rounded bg-accent px-1.5 text-[11px] font-semibold text-white tabular">
                    {queue.length}
                  </span>
                )}
              </button>
            )}

            <div className="flex-1" />

            {tab === 'cases' && (
              <label className="flex items-center gap-2 text-[12.5px] text-muted">
                Sort
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] text-ink"
                >
                  <option value="updated">Recently worked on</option>
                  <option value="oldest">Oldest incident first</option>
                  <option value="case">Case number</option>
                </select>
              </label>
            )}
          </div>

          {tab === 'queue' && mayReview ? (
            queue.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 size={20} />}
                title="Nothing waiting"
                body="Every submitted report has been dealt with."
              />
            ) : (
              <ul className="space-y-2">
                {queue.map((entry) => {
                  // A supplement carries the case it hangs from; a report does
                  // not. That is what tells the two apart in one queue.
                  const asSupplement = entry.report as Partial<Supplement>;
                  const isSupplement = Boolean(asSupplement.caseId);
                  // A crash report carries units; neither of the others does.
                  const isCrash = Array.isArray((entry.report as Partial<CrashReport>).units);

                  return (
                  <li key={entry.report.id}>
                    <button
                      type="button"
                      onClick={() =>
                        isCrash
                          ? openCrash(entry.report.id)
                          : isSupplement
                            ? (openIncident(asSupplement.caseId!), openSupplement(entry.report.id))
                            : openIncident(entry.report.id)
                      }
                      className="flex w-full items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3 text-left transition hover:border-line-strong"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[13.5px] font-semibold text-ink">
                            {isSupplement
                              ? supplementLabel(entry.report as Supplement)
                              : entry.report.caseNumber}
                          </span>
                          {isCrash && <Badge tone="accent">Crash</Badge>}
                          {isSupplement && <Badge tone="accent">Supplement</Badge>}
                          {asSupplement.disposition && <Badge tone="warn">Changes case status</Badge>}
                          {entry.overdue && <Badge tone="danger">Overdue</Badge>}
                          {!entry.reviewable && <Badge tone="neutral">Your own report</Badge>}
                        </div>
                        <p className="mt-0.5 truncate text-[12.5px] text-muted">
                          {entry.report.reportingOfficer || 'Unassigned'} · waiting{' '}
                          {describeWait(entry.waitingHours)}
                        </p>
                      </div>
                      <ArrowRight size={15} className="shrink-0 text-faint" aria-hidden />
                    </button>
                  </li>
                  );
                })}
              </ul>
            )
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Search size={20} />}
              title={query ? 'Nothing matches that search' : `Nothing under “${FILTER_LABEL[filter]}”`}
              body={
                query
                  ? 'Try a case number, a last name, a street, or an offense like “burglary”.'
                  : 'Start a new report, or widen the filter to see everyone’s.'
              }
              action={
                !query ? (
                  <Button variant="primary" onClick={createNew}>
                    New report
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="space-y-2">
              {rows.map(({ incident, errors }) => (
                <li key={incident.id}>
                  <ReportRow
                    incident={incident}
                    location={locations[incident.locationId]}
                    lockedBy={lockOn(incident.id)?.userName ?? null}
                    errors={errors}
                    onOpen={() => openIncident(incident.id)}
                  />
                </li>
              ))}
            </ul>
          )}

          {/*
            Crash reports are a separate document with their own numbering, so
            they get their own list rather than being mixed into the incident
            rows where the columns would mean different things.
          */}
          {tab === 'cases' && crashes.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-faint">
                <Car size={13} aria-hidden />
                Crash reports ({crashes.length})
              </p>
              <ul className="space-y-2">
                {[...crashes]
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => openCrash(c.id)}
                        className="flex w-full items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3 text-left transition hover:border-line-strong"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[13.5px] font-semibold text-ink">
                              {c.caseNumber}
                            </span>
                            <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                            {c.severity === 'fatal' && <Badge tone="danger">Fatal</Badge>}
                            {c.units.length > 0 && (
                              <span className="text-[12px] text-faint">
                                {c.units.length} {c.units.length === 1 ? 'unit' : 'units'}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-[12.5px] text-muted">
                            {[c.onRoad, c.crossStreet].filter(Boolean).join(' at ') || 'Location not set'}
                            {' · '}
                            {c.reportingOfficer || 'Unassigned'}
                          </p>
                        </div>
                        <span className="shrink-0 text-[12px] text-faint">
                          {relativeTime(c.updatedAt)}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  tone,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: 'warn' | 'accent';
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border bg-surface px-4 py-3 text-left transition hover:border-line-strong',
        active ? 'border-accent/50 ring-1 ring-accent/25' : 'border-line',
      )}
    >
      <p className="flex items-center gap-1.5 text-[11.5px] uppercase tracking-wide text-faint">
        <span className={cn(tone === 'warn' ? 'text-warn' : tone === 'accent' ? 'text-accent' : '')}>
          {icon}
        </span>
        {label}
      </p>
      <p
        className={cn(
          'mt-1 text-[24px] font-semibold tracking-tight tabular',
          tone === 'warn' ? 'text-warn' : tone === 'accent' ? 'text-accent' : 'text-ink',
        )}
      >
        {value}
      </p>
    </button>
  );
}

function ReportRow({
  incident,
  location,
  lockedBy,
  errors,
  onOpen,
}: {
  incident: Incident;
  location: MasterLocation | undefined;
  lockedBy: string | null;
  errors: number;
  onOpen: () => void;
}) {
  const offenses = incident.offenses
    .map((o) => OFFENSE_BY_CODE.get(o.code)?.label)
    .filter(Boolean)
    .join(', ');
  const editable = incident.status === 'draft' || incident.status === 'returned';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3 text-left transition hover:border-line-strong hover:shadow-sm"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13.5px] font-semibold text-ink">{incident.caseNumber}</span>
          <Badge tone={STATUS_TONE[incident.status]}>{STATUS_LABEL[incident.status]}</Badge>
          {incident.isDomestic && <Badge tone="danger">Domestic</Badge>}
          {lockedBy && <Badge tone="warn">{lockedBy} is editing</Badge>}
        </div>
        <p className="mt-1 truncate text-[13.5px] text-ink">{offenses || 'No offense listed'}</p>
        <p className="mt-0.5 truncate text-[12px] text-faint">
          {fullAddress(location, incident.locationUnit) || 'No location'} ·{' '}
          {formatDateTime(incident.reportedAt)} · {incident.reportingOfficer || 'Unassigned'}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {/* Blocking problems only matter while the report is still the
            officer's to fix; on a submitted one they would be noise. */}
        {editable && errors > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-danger-soft px-2 py-1 text-[12px] font-medium text-danger">
            <AlertCircle size={13} aria-hidden />
            {errors} to fix
          </span>
        ) : editable ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-ok-soft px-2 py-1 text-[12px] font-medium text-ok">
            <CheckCircle2 size={13} aria-hidden />
            Ready
          </span>
        ) : null}
        <span className="text-[11.5px] text-faint">Updated {relativeTime(incident.updatedAt)}</span>
      </div>
    </button>
  );
}
