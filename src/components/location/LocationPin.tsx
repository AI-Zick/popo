import { useState } from 'react';
import { Crosshair, MapPin } from 'lucide-react';
import { useStore } from '@/state/store';
import { hasCoordinates, type MasterLocation } from '@/domain/location';
import { Badge, Button } from '@/components/ui/primitives';
import { ZoneMap } from './ZoneMap';

/**
 * Places a location on the jurisdiction map. Dropping the pin is what settles
 * the patrol area — the field officers most often guess at, and the one a
 * boundary file can simply answer.
 */
export function LocationPin({ location }: { location: MasterLocation }) {
  const { agency, setLocationPoint, updateLocation, zoneAt, insideJurisdiction } = useStore();
  const [open, setOpen] = useState(false);

  if (!agency.boundary && !agency.zones) return null;

  const placed = hasCoordinates(location);
  const derivedZone = placed ? zoneAt(location.longitude, location.latitude) : '';
  const outside = placed && !insideJurisdiction(location.longitude, location.latitude);

  return (
    <div className="rounded-xl border border-line bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-ink">On the map</h3>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {placed
              ? `${location.latitude!.toFixed(5)}, ${location.longitude!.toFixed(5)}`
              : `Not placed yet — the ${agency.zoneLabel.toLowerCase()} cannot be worked out without it.`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {derivedZone && (
            <Badge tone="accent">
              {agency.zoneLabel} {derivedZone}
            </Badge>
          )}
          {outside && <Badge tone="warn">Outside jurisdiction</Badge>}
          <Button size="sm" onClick={() => setOpen((o) => !o)}>
            <Crosshair size={13} aria-hidden />
            {placed ? 'Move pin' : 'Drop pin'}
          </Button>
        </div>
      </header>

      {open && (
        <div className="p-3">
          <p className="mb-2 flex items-center gap-1.5 text-[12.5px] text-muted">
            <MapPin size={13} className="text-accent" aria-hidden />
            Click the map to place this address. Saved on the location record, so it only has to be
            done once.
          </p>
          <ZoneMap
            boundary={agency.boundary}
            zones={agency.zones}
            zoneLabel={agency.zoneLabel}
            point={placed ? { lon: location.longitude, lat: location.latitude } : null}
            onPick={(lon, lat) => setLocationPoint(location.id, lon, lat)}
            height={400}
          />
          {placed && (
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-[12px] text-faint">
                {derivedZone
                  ? `${agency.zoneLabel} ${derivedZone} was set from the boundary file.`
                  : `This point falls outside every ${agency.zoneLabel.toLowerCase()}.`}
              </p>
              <Button
                size="sm"
                variant="danger"
                onClick={() =>
                  updateLocation(location.id, { latitude: null, longitude: null, geoSource: '' })
                }
              >
                Clear pin
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
