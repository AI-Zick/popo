import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Car, MapPin, TriangleAlert, User, X } from 'lucide-react';
import { useStore } from '@/state/store';
import { displayName, formalName } from '@/domain/person';
import { vehicleName, vehicleTag } from '@/domain/vehicle';
import { PersonPhotos } from '@/components/person/PersonPhotos';
import { PersonTrespasses } from '@/features/trespass/PersonTrespasses';
import { PersonWarrants } from '@/features/warrants/PersonWarrants';
import { PersonContacts } from '@/features/contacts/PersonContacts';
import { PersonCitations } from '@/features/citations/PersonCitations';
import { LocationTrespassList } from '@/features/trespass/LocationTrespassList';

/**
 * Looking a record up.
 *
 * The Master Name Index, the location index and the vehicle index have held
 * real records for a while with nowhere to read one — a search hit opened the
 * most recent report the record appeared on, which answers a different
 * question from the one being asked. This is the record itself.
 *
 * It sits over whatever is on screen rather than replacing it, because looking
 * somebody up is almost always something done *while* writing about somebody
 * else, and a lookup that navigates away from a half-written narrative is a
 * lookup officers stop using.
 */
export function RecordFile() {
  const { openFile, closeFile, people, locations, vehicles } = useStore();

  useEffect(() => {
    if (!openFile) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeFile();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openFile, closeFile]);

  const person = openFile?.kind === 'person' ? people[openFile.id] : undefined;
  const place = openFile?.kind === 'location' ? locations[openFile.id] : undefined;
  const vehicle = openFile?.kind === 'vehicle' ? vehicles[openFile.id] : undefined;

  const owner = useMemo(
    () => (vehicle?.registeredOwnerId ? people[vehicle.registeredOwnerId] : undefined),
    [vehicle, people],
  );

  if (!openFile) return null;

  const missing = !person && !place && !vehicle;

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/35"
      role="dialog"
      aria-modal="true"
      aria-label="Record"
      onClick={(event) => {
        if (event.target === event.currentTarget) closeFile();
      }}
    >
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-line bg-canvas shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-line bg-surface px-5 py-4">
          <span className="mt-0.5 text-faint" aria-hidden>
            {openFile.kind === 'person' ? (
              <User size={18} />
            ) : openFile.kind === 'location' ? (
              <MapPin size={18} />
            ) : (
              <Car size={18} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[16px] font-semibold text-ink">
              {person
                ? formalName(person)
                : place
                  ? place.commonName || place.address
                  : vehicle
                    ? vehicleName(vehicle)
                    : 'Not on file'}
            </h1>
            <p className="mt-0.5 text-[12.5px] text-muted">
              {person
                ? [person.dob && `DOB ${person.dob}`, person.address].filter(Boolean).join(' · ') ||
                  'Master name record'
                : place
                  ? place.commonName
                    ? place.address
                    : 'Location record'
                  : vehicle
                    ? vehicleTag(vehicle) || 'Vehicle record'
                    : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={closeFile}
            aria-label="Close"
            className="rounded-lg p-1.5 text-faint transition hover:bg-canvas hover:text-ink"
          >
            <X size={17} aria-hidden />
          </button>
        </header>

        <div className="flex-1 space-y-4 px-5 py-5">
          {missing && (
            <p className="text-[13px] leading-relaxed text-muted">
              That record is not in what this browser has loaded. It may have been sealed, or
              destroyed under a court order.
            </p>
          )}

          {person && (
            <>
              {person.cautions.length > 0 && (
                <p className="flex items-start gap-2 rounded-xl border border-warn/45 bg-warn/5 p-3 text-[13px] leading-relaxed text-warn">
                  <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
                  <span>{person.cautions.join(' · ')}</span>
                </p>
              )}

              {/*
                Ordered by how urgently somebody standing in front of this
                person needs it. Whether they are wanted comes first and is
                never folded away; whether they are barred from where you are
                standing comes next; what they look like and who has spoken to
                them can wait for a click.
              */}
              <PersonWarrants masterId={person.id} personName={displayName(person)} />

              <PersonTrespasses masterId={person.id} personName={displayName(person)} />

              <PersonPhotos masterId={person.id} personName={displayName(person)} />

              <PersonCitations masterId={person.id} personName={displayName(person)} />

              <PersonContacts masterId={person.id} personName={displayName(person)} />
            </>
          )}

          {place && (
            <>
              <div className="rounded-xl border border-line bg-surface p-4">
                <p className="text-[13px] leading-relaxed text-ink">{place.address}</p>
                <p className="mt-0.5 text-[12.5px] text-muted">
                  {[place.city, place.state, place.zip].filter(Boolean).join(' ')}
                  {place.beat && ` · Beat ${place.beat}`}
                </p>
                {place.aliases.length > 0 && (
                  <p className="mt-1.5 text-[12.5px] text-faint">
                    Also called {place.aliases.join(', ')}
                  </p>
                )}
              </div>

              <section>
                <h2 className="mb-2 flex items-center gap-2 text-[14px] font-medium text-ink">
                  <Ban size={15} className="text-faint" aria-hidden />
                  Trespassed from here
                </h2>
                <LocationTrespassList
                  locationId={place.id}
                  locationName={place.commonName || place.address}
                />
              </section>
            </>
          )}

          {vehicle && (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-line bg-surface p-4 text-[13px]">
                <Detail label="VIN" value={vehicle.vin} mono />
                <Detail
                  label="Plate"
                  value={
                    vehicle.plate
                      ? `${vehicle.plate}${vehicle.plateState ? ` (${vehicle.plateState})` : ''}`
                      : ''
                  }
                  mono
                />
                <Detail label="Year" value={vehicle.year} />
                <Detail label="Make" value={vehicle.make} />
                <Detail label="Model" value={vehicle.model} />
                <Detail label="Colour" value={vehicle.color} />
                <Detail label="Body" value={vehicle.style} />
                <Detail label="Registered owner" value={owner ? displayName(owner) : ''} />
              </dl>

              {vehicle.cautions.length > 0 && (
                <p className="flex items-start gap-2 rounded-xl border border-warn/45 bg-warn/5 p-3 text-[13px] leading-relaxed text-warn">
                  <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
                  <span>{vehicle.cautions.join(' · ')}</span>
                </p>
              )}

              {/*
                Plate history, which is the whole reason this index treats a
                plate as a registration rather than as the car. An officer
                looking at a record that does not match the plate they ran
                needs the explanation on the same screen.
              */}
              {vehicle.formerPlates.length > 0 && (
                <section className="rounded-xl border border-line bg-surface p-4">
                  <h2 className="text-[13px] font-medium text-ink">Plates it used to carry</h2>
                  <ul className="mt-2 space-y-1">
                    {vehicle.formerPlates.map((former, index) => (
                      <li
                        key={`${former.plate}-${index}`}
                        className="font-mono text-[12.5px] text-muted"
                      >
                        {former.plate}
                        {former.state && ` (${former.state})`}
                        <span className="font-sans text-faint">
                          {' '}
                          until {former.seenUntil.slice(0, 10)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {vehicle.notes && (
                <p className="rounded-xl border border-line bg-surface p-4 text-[13px] leading-relaxed text-muted">
                  {vehicle.notes}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11.5px] uppercase tracking-wide text-faint">{label}</dt>
      <dd className={mono ? 'mt-0.5 font-mono text-ink' : 'mt-0.5 text-ink'}>
        {value || <span className="text-faint">Not known</span>}
      </dd>
    </div>
  );
}
