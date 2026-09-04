import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Ban,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react';
import { api, type TrespassPage, type TrespassPageRow } from '@/state/api';
import { useStore } from '@/state/store';
import { STATE_LABEL, trespassStanding, type TrespassSort } from '@/domain/trespass';
import { Button, EmptyState } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { LiftTrespass } from './LiftTrespass';

/**
 * Everybody barred from one place.
 *
 * A page rather than a section, because the places that need this most are the
 * ones with the longest lists — a shopping centre, a transit station, a
 * hospital — and a list that long inside a panel is one nobody scrolls to the
 * end of.
 *
 * Nothing here is filtered or sorted in the browser. The search, the order,
 * the count and the page all come from the server over an index built for
 * exactly this query, so a place holding eight hundred notices costs the same
 * to open as one holding eight.
 */

const PAGE = 50;

export function LocationTrespassList({
  locationId,
  locationName,
}: {
  locationId: string;
  locationName: string;
}) {
  const { can } = useStore();
  const [query, setQuery] = useState('');
  /*
    The query the server has actually been asked about, which lags what is in
    the box by a beat. Typing "anderson" should not be eight round trips.
  */
  const [applied, setApplied] = useState('');
  const [sort, setSort] = useState<TrespassSort>('name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [showAll, setShowAll] = useState(false);
  const [offset, setOffset] = useState(0);

  const [page, setPage] = useState<TrespassPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lifting, setLifting] = useState<TrespassPageRow | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setApplied(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Any change to what is being asked for starts again at the first page.
  useEffect(() => setOffset(0), [applied, sort, dir, showAll]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPage(
        await api.locationTrespasses(locationId, {
          q: applied,
          sort,
          dir,
          state: showAll ? 'all' : 'active',
          limit: PAGE,
          offset,
        }),
      );
    } catch {
      setError('That list could not be loaded. It is still there — try again.');
    } finally {
      setLoading(false);
    }
  }, [locationId, applied, sort, dir, showAll, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const heading = useMemo(() => {
    if (!page) return '';
    const scope = showAll ? 'on record' : 'in force';
    if (applied) return `${page.total} matching “${applied}” ${scope}`;
    return `${page.total} ${page.total === 1 ? 'notice' : 'notices'} ${scope}`;
  }, [page, applied, showAll]);

  const toggleSort = (next: TrespassSort) => {
    if (sort === next) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(next);
      // Names read A–Z; dates read newest first, which is what people mean by
      // "sort by when it was served".
      setDir(next === 'name' ? 'asc' : 'desc');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[14rem] flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this list by name"
            aria-label={`Search the trespass list for ${locationName}`}
            className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-8 text-[14px] text-ink placeholder:text-faint"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear the search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint transition hover:text-ink"
            >
              <X size={13} aria-hidden />
            </button>
          )}
        </label>

        <div className="flex items-center gap-1">
          <SortButton active={sort === 'name'} dir={dir} onClick={() => toggleSort('name')}>
            Name
          </SortButton>
          <SortButton active={sort === 'served'} dir={dir} onClick={() => toggleSort('served')}>
            Served
          </SortButton>
          <SortButton active={sort === 'expires'} dir={dir} onClick={() => toggleSort('expires')}>
            Ends
          </SortButton>
        </div>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] text-muted">
          {loading && !page ? 'Loading…' : heading}
          {page && !showAll && page.active !== page.total && applied === '' && (
            <span className="text-faint"> · {page.active} in force</span>
          )}
        </p>
        <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-muted">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          Include expired and lifted
        </label>
      </div>

      {error && (
        <p className="flex items-start gap-1.5 rounded-lg border border-danger/40 bg-danger/5 p-3 text-[13px] text-danger">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {page && page.rows.length === 0 && !loading && (
        <EmptyState
          icon={<Ban size={18} aria-hidden />}
          title={applied ? `Nobody matching “${applied}”` : 'Nobody is barred from here'}
          body={
            applied
              ? 'Try a surname, or the start of one.'
              : showAll
                ? 'No notice has ever been recorded for this place.'
                : 'No notice is currently in force. Expired and lifted ones are hidden.'
          }
        />
      )}

      {page && page.rows.length > 0 && (
        <ul className={cn('divide-y divide-line rounded-xl border border-line bg-surface', loading && 'opacity-60')}>
          {page.rows.map((row) => (
            <TrespassRowView
              key={row.trespass.id}
              row={row}
              onLift={can('trespass.lift') ? () => setLifting(row) : undefined}
            />
          ))}
        </ul>
      )}

      {page && page.total > PAGE && (
        <div className="flex items-center justify-between gap-3 text-[13px] text-muted">
          <span>
            {page.offset + 1}–{Math.min(page.offset + PAGE, page.total)} of {page.total}
          </span>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              disabled={offset === 0 || loading}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
            >
              <ChevronLeft size={14} aria-hidden />
              Back
            </Button>
            <Button
              size="sm"
              disabled={offset + PAGE >= page.total || loading}
              onClick={() => setOffset((o) => o + PAGE)}
            >
              Next
              <ChevronRight size={14} aria-hidden />
            </Button>
          </div>
        </div>
      )}

      {lifting && (
        <LiftTrespass
          trespass={lifting.trespass}
          who={lifting.person?.name ?? 'this person'}
          where={locationName}
          onClose={() => setLifting(null)}
          onLifted={() => {
            setLifting(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SortButton({
  active,
  dir,
  onClick,
  children,
}: {
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? `Sorted by ${children.toLowerCase()}, ${dir === 'asc' ? 'ascending' : 'descending'} — click to reverse` : `Sort by ${children.toLowerCase()}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border px-2.5 py-2 text-[12.5px] transition',
        active
          ? 'border-accent/50 bg-accent/10 text-ink'
          : 'border-line bg-surface text-muted hover:text-ink',
      )}
    >
      {children}
      {active &&
        (dir === 'asc' ? (
          <ArrowDownAZ size={13} aria-hidden />
        ) : (
          <ArrowUpAZ size={13} aria-hidden />
        ))}
    </button>
  );
}

function TrespassRowView({ row, onLift }: { row: TrespassPageRow; onLift?: () => void }) {
  const { trespass, person, state } = row;

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[14px] font-medium text-ink">
            {/*
              A notice whose person was destroyed under a court order still
              counts, and still shows. Silently dropping the row would make
              the list disagree with its own total.
            */}
            {person?.name ?? 'Record no longer held'}
          </span>
          {person?.dob && <span className="text-[12.5px] text-faint">DOB {person.dob}</span>}
          {state !== 'active' && (
            <span className="rounded border border-line px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-muted">
              {STATE_LABEL[state]}
            </span>
          )}
        </div>

        {person?.cautions?.length ? (
          <p className="mt-1 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-warn">
            <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
            {person.cautions.join(' · ')}
          </p>
        ) : null}

        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          Served {trespass.servedOn}
          {trespass.requestedBy && ` at the request of ${trespass.requestedBy}`}. {trespassStanding(trespass)}
        </p>
        {trespass.notes && (
          <p className="mt-1 text-[12.5px] leading-relaxed text-faint">{trespass.notes}</p>
        )}
      </div>

      {onLift && state === 'active' && (
        <Button size="sm" onClick={onLift}>
          Lift
        </Button>
      )}
    </li>
  );
}

/** Shown while a first page is on its way, so the panel is never blank. */
export function TrespassListSkeleton() {
  return (
    <p className="flex items-center gap-2 py-6 text-[13px] text-muted">
      <Loader2 size={15} className="animate-spin" aria-hidden />
      Loading the list…
    </p>
  );
}
