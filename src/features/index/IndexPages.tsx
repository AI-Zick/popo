import { useMemo, useState } from 'react';
import { Car, ChevronLeft, Search, Users } from 'lucide-react';
import { useStore } from '@/state/store';
import { displayName, type MasterPerson } from '@/domain/person';
import type { MasterVehicle } from '@/domain/vehicle';
import { Badge, Button, EmptyState } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * The master indexes, as pages.
 *
 * There was already a command palette that found people and vehicles, and a
 * button that opened it. Somebody testing this looked for people search and
 * vehicle search and did not find them — twice — which is the only evidence
 * that matters. A palette answers "find me this one thing I can already name";
 * a page answers "show me what the agency knows", and those are different
 * questions asked by different people at different moments.
 *
 * So: two pages, reached by two buttons that say People and Vehicles. The
 * palette stays for the officer who knows the name and wants it in one
 * keystroke.
 */

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

export function PeopleIndex({ onClose }: { onClose: () => void }) {
  const { people, wanted, showFile } = useStore();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const all = Object.values(people) as MasterPerson[];
    const q = query.trim().toLowerCase();
    const matched = q
      ? all.filter((person) =>
          [
            displayName(person),
            person.businessName,
            person.dob,
            person.driverLicense,
            ...(person.aliases ?? []),
          ]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(q)),
        )
      : all;
    /*
      Alphabetical, not by when the record was touched. This is a name index —
      somebody reads it looking for a surname, and "most recently edited" is an
      order nobody can scan.
    */
    return matched.sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }, [people, query]);

  return (
    <IndexScreen
      title="People"
      icon={<Users size={17} aria-hidden />}
      description="Everyone the agency has a record of. One entry per person, however many reports they appear on."
      placeholder="Name, date of birth, licence number…"
      query={query}
      setQuery={setQuery}
      total={Object.keys(people).length}
      shown={rows.length}
      onClose={onClose}
      empty={
        <EmptyState
          icon={<Users size={22} aria-hidden />}
          title={query ? 'Nobody matches that' : 'No people on file yet'}
          body={
            query
              ? 'Try a surname on its own, or part of a date of birth.'
              : 'People are added to the index as they are named on reports.'
          }
        />
      }
    >
      {rows.map((person) => {
        const warrant = wanted[person.id];
        return (
          <li key={person.id}>
            <button
              type="button"
              onClick={() => showFile({ kind: 'person', id: person.id })}
              className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition hover:border-line-strong"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-ink">
                  <span className="truncate">{displayName(person)}</span>
                  {warrant && warrant.count > 0 && (
                    <Badge tone="danger">
                      {warrant.count} {warrant.count === 1 ? 'warrant' : 'warrants'}
                    </Badge>
                  )}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-muted">
                  {[person.dob && `DOB ${person.dob}`, person.driverLicense, person.city]
                    .filter(Boolean)
                    .join(' · ') || 'No identifying detail recorded'}
                </p>
              </div>
            </button>
          </li>
        );
      })}
    </IndexScreen>
  );
}

/* ------------------------------------------------------------------ */
/* Vehicles                                                            */
/* ------------------------------------------------------------------ */

export function VehicleIndex({ onClose }: { onClose: () => void }) {
  const { vehicles, showFile } = useStore();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const all = Object.values(vehicles) as MasterVehicle[];
    const q = query.trim().toLowerCase().replace(/[\s-]/g, '');
    const matched = q
      ? all.filter((vehicle) =>
          [
            vehicle.plate,
            vehicle.vin,
            `${vehicle.year}${vehicle.make}${vehicle.model}`,
            ...vehicle.formerPlates.map((p) => p.plate),
          ]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().replace(/[\s-]/g, '').includes(q)),
        )
      : all;
    // By plate, which is what somebody is holding when they come to this page.
    return matched.sort((a, b) => (a.plate || a.vin).localeCompare(b.plate || b.vin));
  }, [vehicles, query]);

  return (
    <IndexScreen
      title="Vehicles"
      icon={<Car size={17} aria-hidden />}
      description="Every vehicle the agency has a record of, including plates that have since moved to another car."
      placeholder="Plate, VIN, make or model…"
      query={query}
      setQuery={setQuery}
      total={Object.keys(vehicles).length}
      shown={rows.length}
      onClose={onClose}
      empty={
        <EmptyState
          icon={<Car size={22} aria-hidden />}
          title={query ? 'No vehicle matches that' : 'No vehicles on file yet'}
          body={
            query
              ? 'Plates match with or without the dash. A partial VIN works too.'
              : 'Vehicles are added to the index as they are recorded on reports and stops.'
          }
        />
      }
    >
      {rows.map((vehicle) => (
        <li key={vehicle.id}>
          <button
            type="button"
            onClick={() => showFile({ kind: 'vehicle', id: vehicle.id })}
            className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition hover:border-line-strong"
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-ink">
                <span className="font-mono">{vehicle.plate || 'No plate'}</span>
                {vehicle.plateState && (
                  <span className="text-[12px] font-normal text-faint">{vehicle.plateState}</span>
                )}
                {vehicle.formerPlates.length > 0 && (
                  <Badge tone="neutral">
                    {vehicle.formerPlates.length} former{' '}
                    {vehicle.formerPlates.length === 1 ? 'plate' : 'plates'}
                  </Badge>
                )}
              </p>
              <p className="mt-0.5 truncate text-[12px] text-muted">
                {[vehicle.year, vehicle.make, vehicle.model, vehicle.color]
                  .filter(Boolean)
                  .join(' ') || 'Not described'}
                {vehicle.vin && <span className="font-mono"> · {vehicle.vin}</span>}
              </p>
            </div>
          </button>
        </li>
      ))}
    </IndexScreen>
  );
}

/* ------------------------------------------------------------------ */
/* The shell both share                                                */
/* ------------------------------------------------------------------ */

function IndexScreen({
  title,
  icon,
  description,
  placeholder,
  query,
  setQuery,
  total,
  shown,
  onClose,
  empty,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  description: string;
  placeholder: string;
  query: string;
  setQuery: (v: string) => void;
  total: number;
  shown: number;
  onClose: () => void;
  empty: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <Button variant="ghost" onClick={onClose}>
          <ChevronLeft size={16} aria-hidden />
          Reports
        </Button>
        <span className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          {icon}
          {title}
        </span>
        <div className="flex-1" />
        {/*
          The count says what is being looked at, because a filtered list that
          does not say it is filtered is a list somebody concludes is empty.
        */}
        <span className="text-[12px] text-faint tabular">
          {query ? `${shown} of ${total}` : `${total} on file`}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-5">
          <p className="text-[12.5px] leading-relaxed text-muted">{description}</p>

          <div className="relative mt-3">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              aria-label={`Search ${title.toLowerCase()}`}
              className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-[13.5px] text-ink placeholder:text-faint"
            />
          </div>

          <ul className={cn('mt-3 space-y-2', shown === 0 && 'hidden')}>{children}</ul>
          {shown === 0 && <div className="mt-6">{empty}</div>}
        </div>
      </div>
    </div>
  );
}
