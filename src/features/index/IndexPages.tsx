import { useMemo, useState } from 'react';
import { Car, ChevronLeft, MapPin, Search, Users } from 'lucide-react';
import { useStore } from '@/state/store';
import { displayName, type MasterPerson } from '@/domain/person';
import type { MasterVehicle } from '@/domain/vehicle';
import type { MasterLocation } from '@/domain/location';
import { Badge, Button, EmptyState } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * The master indexes, as one screen with three tabs.
 *
 * There was already a command palette that found people and vehicles, and a
 * button that opened it. Somebody testing this looked for people search and
 * vehicle search and did not find them — twice — which is the only evidence
 * that matters. A palette answers "find me this one thing I can already name";
 * a page answers "show me what the agency knows", and those are different
 * questions asked by different people at different moments.
 *
 * They began as two separate pages reached by two buttons. Three buttons in a
 * row of eleven is three chances to pick the wrong one, and the question
 * behind all of them is the same — "what does the agency know about this?" —
 * so they are one screen now, under one button, with the answer split by what
 * kind of thing is being asked about. The palette stays for the officer who
 * knows the name and wants it in one keystroke.
 */

export type MasterTab = 'people' | 'vehicles' | 'locations';

const TABS: { key: MasterTab; label: string; icon: React.ReactNode }[] = [
  { key: 'people', label: 'People', icon: <Users size={14} aria-hidden /> },
  { key: 'vehicles', label: 'Vehicles', icon: <Car size={14} aria-hidden /> },
  { key: 'locations', label: 'Places', icon: <MapPin size={14} aria-hidden /> },
];

/**
 * One screen, three indexes.
 *
 * The tab is held here rather than in each index so that switching keeps the
 * screen and only changes what is being searched — somebody who typed a
 * street name into People and found nothing should be one click from asking
 * the same question of Places.
 */
export function MasterSearch({
  start = 'people',
  onClose,
}: {
  start?: MasterTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<MasterTab>(start);
  const strip = (
    <div className="flex gap-1" role="tablist" aria-label="What to search">
      {TABS.map((entry) => (
        <button
          key={entry.key}
          type="button"
          role="tab"
          aria-selected={tab === entry.key}
          onClick={() => setTab(entry.key)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium transition',
            tab === entry.key ? 'bg-raised text-ink ring-1 ring-line' : 'text-muted hover:bg-raised/60',
          )}
        >
          {entry.icon}
          {entry.label}
        </button>
      ))}
    </div>
  );

  if (tab === 'vehicles') return <VehicleIndex onClose={onClose} tabs={strip} />;
  if (tab === 'locations') return <LocationIndex onClose={onClose} tabs={strip} />;
  return <PeopleIndex onClose={onClose} tabs={strip} />;
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

export function PeopleIndex({ onClose, tabs }: { onClose: () => void; tabs?: React.ReactNode }) {
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
      tabs={tabs}
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

export function VehicleIndex({ onClose, tabs }: { onClose: () => void; tabs?: React.ReactNode }) {
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
      tabs={tabs}
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
/* Places                                                              */
/* ------------------------------------------------------------------ */

/**
 * The location index, which was the one master index with no way in.
 *
 * People and vehicles had pages; places had only the picker inside a report,
 * which meant the accumulated knowledge of a shift — the notes on the address
 * with the dog, the storage yard with sixty units — could be read only by
 * somebody already writing a report about it. That is exactly backwards: the
 * officer who needs it most is the one on the way there.
 *
 * So it searches what an officer would actually have: what the place is
 * called, what it gets called on the radio, and the address. And every row
 * says whether there is anything on file about it, because a list of addresses
 * with no indication of which ones carry a warning is a list that gets
 * skimmed.
 */
export function LocationIndex({ onClose, tabs }: { onClose: () => void; tabs?: React.ReactNode }) {
  const { locations, showFile } = useStore();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const all = Object.values(locations) as MasterLocation[];
    const q = query.trim().toLowerCase();
    const matched = q
      ? all.filter((location) =>
          [location.commonName, location.address, location.city, location.beat, ...(location.aliases ?? [])]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(q)),
        )
      : all;
    /*
      By what it is called, falling back to the address. An officer scanning
      this is looking for a name they heard on the radio.
    */
    return matched.sort((a, b) =>
      (a.commonName || a.address).localeCompare(b.commonName || b.address),
    );
  }, [locations, query]);

  return (
    <IndexScreen
      title="Places"
      icon={<MapPin size={17} aria-hidden />}
      description="Every address the agency has a record of, with whatever officers have learned about it."
      placeholder="Address, what it is called, or what it gets called on the radio…"
      query={query}
      setQuery={setQuery}
      total={Object.keys(locations).length}
      shown={rows.length}
      onClose={onClose}
      tabs={tabs}
      empty={
        <EmptyState
          icon={<MapPin size={22} aria-hidden />}
          title={query ? 'No place matches that' : 'No places on file yet'}
          body={
            query
              ? 'Try the street on its own, or what the place is called rather than its address.'
              : 'Places are added to the index as reports are written about them.'
          }
        />
      }
    >
      {rows.map((location) => {
        const live = (location.notes ?? []).filter((note) => !note.retractedAt);
        // Hazards only. An access note is a gate code, not a warning.
        const warnings = live.filter((note) => note.kind === 'hazard');
        return (
          <li key={location.id}>
            <button
              type="button"
              onClick={() => showFile({ kind: 'location', id: location.id })}
              className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition hover:border-line-strong"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-ink">
                  <span className="truncate">{location.commonName || location.address}</span>
                  {/*
                    Said on the row. A place with a hazard note on it is the
                    whole reason to have looked, and making somebody open each
                    one to find out is how the warning gets missed.
                  */}
                  {warnings.length > 0 && (
                    <Badge tone="danger">
                      {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
                    </Badge>
                  )}
                  {live.length > warnings.length && (
                    <Badge tone="neutral">
                      {live.length - warnings.length} {live.length - warnings.length === 1 ? 'note' : 'notes'}
                    </Badge>
                  )}
                  {location.hasUnits && (
                    <span className="text-[11.5px] font-normal text-faint">
                      has {location.unitLabel.toLowerCase() || 'unit'}s
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-muted">
                  {location.commonName ? `${location.address} · ` : ''}
                  {[location.city, location.state].filter(Boolean).join(', ')}
                  {location.beat && ` · ${location.beat}`}
                  {(location.aliases ?? []).length > 0 && ` · also "${location.aliases[0]}"`}
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
  tabs,
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
  tabs?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <Button variant="ghost" onClick={onClose}>
          <ChevronLeft size={16} aria-hidden />
          Home
        </Button>
        <span className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          {icon}
          {tabs ? 'Master search' : title}
        </span>
        {tabs}
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
