import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, KeyRound, MapPin, MapPinned, Plus, Search, X } from 'lucide-react';
import { useStore } from '@/state/store';
import { api, ApiError } from '@/state/api';
import type { AddressCandidate } from '@/domain/gis';
import { locationLabel, type MasterLocation } from '@/domain/location';
import { formatDistance } from '@/domain/geo';
import { LOCATION_TYPES, STATES } from '@/domain/codes';
import { Badge, Button } from '@/components/ui/primitives';
import { SelectField, useFieldIssues } from '@/components/ui/fields';
import { cn } from '@/lib/cn';
import { PremiseNotes } from './PremiseNotes';

/**
 * The address box.
 *
 * Typing an address the agency has been to returns exactly one option — not a
 * fresh blank record and not four near-duplicates — with whatever officers and
 * dispatch have left on it attached.
 */
export function LocationField({ path: fieldPath }: { path: string }) {
  const { location, locationSearch, setLocation, registerField, revealField, locationHistory } =
    useStore();
  const { visible } = useFieldIssues(fieldPath);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const results = useMemo(() => locationSearch(query, 12), [locationSearch, query]);

  return (
    <div ref={(el) => registerField(fieldPath, el)} data-field-path={fieldPath}>
      <label className="mb-1.5 flex items-baseline gap-1.5 text-[13px] font-medium text-ink">
        Location
        <span className="text-danger" aria-label="required">
          *
        </span>
      </label>

      {location ? (
        <SelectedLocation
          location={location}
          priorReports={locationHistory(location.id).length}
          onChange={() => {
            setOpen(true);
            setQuery('');
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          onBlur={() => revealField(fieldPath)}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-lg border bg-surface px-3 py-2 text-left text-[14px] transition hover:border-line-strong',
            visible.length ? 'border-danger/60 bg-danger-soft/40' : 'border-line',
          )}
        >
          <span className="flex items-center gap-2 text-faint">
            <Search size={15} aria-hidden />
            Search an address or place name…
          </span>
          <ChevronDown size={16} className="text-faint" aria-hidden />
        </button>
      )}

      {visible.map((issue) => (
        <div
          key={issue.key}
          className={cn(
            'mt-1.5 rounded-lg border px-2.5 py-2 text-[13px] leading-relaxed',
            issue.severity === 'error'
              ? 'border-danger/35 bg-danger-soft text-danger'
              : 'border-warn/35 bg-warn-soft text-warn',
          )}
        >
          <p className="font-medium">{issue.message}</p>
          {issue.tip && <p className="mt-1 text-ink/75">{issue.tip}</p>}
        </div>
      ))}

      {open && (
        <LocationSearchDialog
          query={query}
          setQuery={setQuery}
          results={results}
          creating={creating}
          setCreating={setCreating}
          onPick={(id) => {
            setLocation(id);
            revealField(fieldPath);
            setOpen(false);
            setCreating(false);
          }}
          onClose={() => {
            setOpen(false);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function SelectedLocation({
  location,
  priorReports,
  onChange,
}: {
  location: MasterLocation;
  priorReports: number;
  onChange: () => void;
}) {
  const accessNotes = location.notes.filter((n) => n.kind === 'access').length;
  const hazardNotes = location.notes.filter((n) => n.kind === 'hazard').length;

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex items-start gap-3 px-3 py-2.5">
        <MapPin size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-ink">{locationLabel(location)}</p>
          <p className="mt-0.5 truncate text-[12px] text-muted">
            {[location.city, location.state, location.zip].filter(Boolean).join(' ')}
            {priorReports > 1 && ` · ${priorReports} reports here`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {accessNotes > 0 && (
            <Badge tone="accent">
              <KeyRound size={11} aria-hidden />
              {accessNotes}
            </Badge>
          )}
          {hazardNotes > 0 && <Badge tone="danger">{hazardNotes} caution</Badge>}
          <Button size="sm" onClick={onChange}>
            Change
          </Button>
        </div>
      </div>
    </div>
  );
}

function LocationSearchDialog({
  query,
  setQuery,
  results,
  creating,
  setCreating,
  onPick,
  onClose,
}: {
  query: string;
  setQuery: (v: string) => void;
  results: { location: MasterLocation; distance: number | null }[];
  creating: boolean;
  setCreating: (v: boolean) => void;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const { locationHistory } = useStore();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-6 pt-[8vh]">
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Find a location"
      >
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="text-[14px] font-semibold text-ink">
            {creating ? 'Add a new location' : 'Where did this happen?'}
          </h2>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-faint transition hover:bg-raised hover:text-ink"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        {creating ? (
          <NewLocationForm initialQuery={query} onDone={onPick} onCancel={() => setCreating(false)} />
        ) : (
          <>
            <div className="border-b border-line px-4 py-3">
              <div className="relative">
                <Search
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-faint"
                  aria-hidden
                />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="612 marion · marion storage · ashwood"
                  className="w-full rounded-lg border border-line bg-canvas py-2 pl-9 pr-3 text-[13.5px] text-ink placeholder:text-faint"
                />
              </div>
              <p className="mt-1.5 text-[11.5px] text-faint">
                Search by address or by what the place is called on the radio.
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {results.length === 0 ? (
                <p className="px-3 py-8 text-center text-[13px] text-faint">
                  Nothing in the index matches{query ? ` “${query}”` : ''}.
                </p>
              ) : (
                <ul className="space-y-1">
                  {results.map(({ location, distance }) => (
                    <li key={location.id}>
                      <LocationRow
                        location={location}
                        distance={distance}
                        priorReports={locationHistory(location.id).length}
                        onPick={() => onPick(location.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {/*
                The county's own address layer, under the agency's index rather
                than mixed into it. A place the department has been before —
                with its gate code, its dog, its history — is a different and
                better answer than a point on a map, so it is never pushed down
                the page by one.
              */}
              <CountyAddresses query={query} onPicked={onPick} />
            </div>

            <footer className="border-t border-line p-3">
              <Button variant="primary" className="w-full" onClick={() => setCreating(true)}>
                <Plus size={15} aria-hidden />
                {query ? `Add “${query}” as a new location` : 'Add a new location'}
              </Button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Addresses from the county, offered under whatever the agency already knows.
 *
 * Picking one makes a location record with the coordinates already set — which
 * is the whole point. Dropping a pin by hand is the one piece of manual work a
 * map was meant to remove, and an officer doing it forty times a week gets it
 * roughly right forty times.
 *
 * Quiet when no county is configured, and quiet while it is thinking. An
 * agency without a county connection sees exactly what it saw before.
 */
function CountyAddresses({ query, onPicked }: { query: string; onPicked: (id: string) => void }) {
  const { createAndSetLocation, agency } = useStore();
  const [found, setFound] = useState<AddressCandidate[]>([]);
  const [attribution, setAttribution] = useState('');
  const [failed, setFailed] = useState('');

  const configured = Boolean(agency.gis?.kind);

  useEffect(() => {
    if (!configured || query.trim().length < 3) {
      setFound([]);
      setFailed('');
      return;
    }
    /*
      Debounced, and the late reply from an abandoned search is thrown away.
      Without that, typing "612 marion" fast enough leaves the results for
      "612 mar" on screen underneath — an officer picking the wrong address
      because a slower request landed second.
    */
    let live = true;
    const timer = window.setTimeout(() => {
      void api
        .gisSearch(query.trim())
        .then((reply) => {
          if (!live) return;
          setFound(reply.candidates);
          setAttribution(reply.attribution ?? '');
          setFailed('');
        })
        .catch((error) => {
          if (!live) return;
          setFound([]);
          setFailed(error instanceof ApiError ? error.message : 'Could not reach the county.');
        });
    }, 250);

    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, configured]);

  if (!configured) return null;
  if (found.length === 0 && !failed) return null;

  return (
    <div className="mt-3 border-t border-line pt-2">
      <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-faint">
        From the county’s address layer
      </p>

      {failed ? (
        <p className="px-3 py-2 text-[12px] leading-relaxed text-warn">
          {failed} The agency index above is unaffected.
        </p>
      ) : (
        <ul className="space-y-1">
          {found.map((candidate, index) => (
            <li key={`${candidate.address}-${index}`}>
              <button
                type="button"
                onClick={() =>
                  /*
                    Closed the same way picking from the agency index closes it.
                    Making the record and leaving the dialog open reads as the
                    click not having worked, and an officer clicks again.
                  */
                  onPicked(
                    createAndSetLocation({
                      address: candidate.address,
                      city: candidate.city || agency.city,
                      state: candidate.state || agency.state,
                      zip: candidate.zip,
                      longitude: candidate.longitude,
                      latitude: candidate.latitude,
                      geoSource: 'gis',
                    }),
                  )
                }
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition hover:bg-raised"
              >
                <MapPinned size={15} className="shrink-0 text-faint" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-ink">
                    {candidate.address}
                    {candidate.unit && ` ${candidate.unit}`}
                  </span>
                  <span className="block truncate text-[11.5px] text-faint">
                    {[candidate.city, candidate.state, candidate.zip].filter(Boolean).join(' ')} ·
                    already placed on the map
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {attribution && <p className="px-3 pt-1 text-[10.5px] text-faint">{attribution}</p>}
    </div>
  );
}

function LocationRow({
  location,
  distance,
  priorReports,
  onPick,
}: {
  location: MasterLocation;
  distance: number | null;
  priorReports: number;
  onPick: () => void;
}) {
  const access = location.notes.filter((n) => n.kind === 'access');
  const hazards = location.notes.filter((n) => n.kind === 'hazard');

  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition hover:border-line hover:bg-raised"
    >
      <MapPin size={15} className="mt-0.5 shrink-0 text-faint" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-ink">
          {location.commonName || location.address}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-muted">
          {location.commonName ? `${location.address} · ` : ''}
          {location.city}
          {location.hasUnits ? ` · has ${location.unitLabel.toLowerCase()}s` : ''}
        </span>
        {(access.length > 0 || hazards.length > 0) && (
          <span className="mt-1 flex flex-wrap gap-1.5">
            {access.length > 0 && (
              <Badge tone="accent">
                <KeyRound size={10} aria-hidden />
                Access notes
              </Badge>
            )}
            {hazards.length > 0 && <Badge tone="danger">Caution on file</Badge>}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right text-[11.5px] text-faint tabular">
        <span className="block">
          {priorReports} {priorReports === 1 ? 'report' : 'reports'}
        </span>
        {distance !== null && <span className="block">{formatDistance(distance)}</span>}
      </span>
    </button>
  );
}

function NewLocationForm({
  initialQuery,
  onDone,
  onCancel,
}: {
  initialQuery: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const { locations, createAndSetLocation, locationMatches } = useStore();
  // A bare number-and-street reads as an address; anything else as a name.
  const looksLikeAddress = /^\d/.test(initialQuery.trim());
  const [draft, setDraft] = useState({
    address: looksLikeAddress ? initialQuery : '',
    commonName: looksLikeAddress ? '' : initialQuery,
    city: 'Cedar Falls',
    state: 'AL',
    zip: '',
    locationType: '',
    hasUnits: false,
    unitLabel: 'Unit',
  });
  const created = useRef(false);

  // Warn before adding something the index probably already has.
  const nearby = useMemo(
    () =>
      locationMatches({
        address: draft.address,
        commonName: draft.commonName,
        city: draft.city,
      }),
    [locationMatches, draft.address, draft.commonName, draft.city],
  );

  const canSave = draft.address.trim() !== '' || draft.commonName.trim() !== '';

  const field = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink placeholder:text-faint';

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {nearby.length > 0 && (
        <div className="mb-4 rounded-xl border border-accent/30 bg-accent-soft/50 p-3">
          <p className="text-[13px] font-medium text-ink">
            The index may already have this place
          </p>
          <ul className="mt-2 space-y-1.5">
            {nearby.map((match) => (
              <li key={match.location.id}>
                <button
                  type="button"
                  onClick={() => onDone(match.location.id)}
                  className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left transition hover:border-accent"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">
                      {locationLabel(locations[match.location.id])}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-muted">
                      {match.reasons.join(' · ')}
                    </span>
                  </span>
                  <Check size={14} className="shrink-0 text-accent" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <label className="col-span-2">
          <span className="mb-1.5 block text-[13px] font-medium text-ink">Street address</span>
          <input
            autoFocus
            value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            placeholder="612 N Marion St"
            className={field}
          />
        </label>
        <label className="col-span-2">
          <span className="mb-1.5 block text-[13px] font-medium text-ink">
            Common name <span className="font-normal text-faint">— optional</span>
          </span>
          <input
            value={draft.commonName}
            onChange={(e) => setDraft({ ...draft, commonName: e.target.value })}
            placeholder="Marion Street Self Storage"
            className={field}
          />
          <span className="mt-1 block text-[12px] text-faint">
            What officers call it on the radio. This is how most people will search for it.
          </span>
        </label>
        <label>
          <span className="mb-1.5 block text-[13px] font-medium text-ink">City</span>
          <input
            value={draft.city}
            onChange={(e) => setDraft({ ...draft, city: e.target.value })}
            className={field}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="mb-1.5 block text-[13px] font-medium text-ink">State</span>
            <select
              value={draft.state}
              onChange={(e) => setDraft({ ...draft, state: e.target.value })}
              className={field}
            >
              {STATES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1.5 block text-[13px] font-medium text-ink">ZIP</span>
            <input
              value={draft.zip}
              onChange={(e) => setDraft({ ...draft, zip: e.target.value })}
              className={field}
            />
          </label>
        </div>
        {/*
          The same typeable picker every other coded field uses. It was the one
          plain <select> left in the app, and it is on the form somebody
          reaches at the end of a search — so the one place the list is longest
          was the one place it could not be typed into.
        */}
        <div className="col-span-2">
          <SelectField
            path="newLocation.locationType"
            label="Premises type"
            showCodes
            options={LOCATION_TYPES}
            value={draft.locationType}
            onChange={(v) => setDraft({ ...draft, locationType: v })}
          />
        </div>

        <div className="col-span-2 rounded-xl border border-line bg-raised p-3">
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={draft.hasUnits}
              onChange={(e) => setDraft({ ...draft, hasUnits: e.target.checked })}
              className="mt-0.5 size-4"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">
                This place has numbered units
              </span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                Storage facilities, apartment blocks, motels, office parks. Keeps the whole site as
                one record — the unit number goes on each report instead of creating hundreds of
                near-identical addresses.
              </span>
            </span>
          </label>
          {draft.hasUnits && (
            <label className="mt-3 block max-w-[12rem]">
              <span className="mb-1.5 block text-[12.5px] text-muted">Units are called</span>
              <select
                value={draft.unitLabel}
                onChange={(e) => setDraft({ ...draft, unitLabel: e.target.value })}
                className={field}
              >
                {['Unit', 'Apt', 'Room', 'Suite', 'Space', 'Lot'].map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onCancel}>Back to search</Button>
        <Button
          variant="primary"
          disabled={!canSave}
          onClick={() => {
            if (created.current) return;
            created.current = true;
            // The id it actually got — passing '' here set the report's
            // location to nothing, immediately after creating the place.
            onDone(createAndSetLocation(draft));
          }}
        >
          Save location
        </Button>
      </div>
    </div>
  );
}

export { PremiseNotes };
