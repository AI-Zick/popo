import { useMemo, useRef } from 'react';
import {
  bboxOf,
  featureAt,
  featureCentroid,
  featureName,
  featurePath,
  project,
  type GeoFeatureCollection,
} from '@/domain/geo';
import { cn } from '@/lib/cn';

/**
 * The jurisdiction drawn from the agency's own boundary file.
 *
 * Deliberately not a tile map. There is no basemap request, no API key and no
 * address leaving the network — the geometry the agency already owns is enough
 * to place a pin and read off a patrol area, and it keeps crime-scene
 * coordinates from being sent to a third party on every keystroke.
 */
export function ZoneMap({
  boundary,
  zones,
  point,
  onPick,
  zoneLabel = 'Beat',
  height = 260,
  className,
}: {
  boundary: GeoFeatureCollection | null;
  zones: GeoFeatureCollection | null;
  point?: { lon: number; lat: number } | null;
  onPick?: (lon: number, lat: number) => void;
  zoneLabel?: string;
  height?: number;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const WIDTH = 600;

  const layout = useMemo(() => {
    const combined: GeoFeatureCollection = {
      type: 'FeatureCollection',
      features: [...(boundary?.features ?? []), ...(zones?.features ?? [])],
    };
    const bbox = bboxOf(combined);
    if (!bbox) return null;

    // Shape the viewBox to the jurisdiction's own proportions, then let CSS
    // size it by height. A square county in a wide box would otherwise sit as
    // a small island in the middle, and clicks either side of it go nowhere.
    const midLat = (bbox.minLat + bbox.maxLat) / 2;
    const lonScale = Math.cos((midLat * Math.PI) / 180) || 1;
    const spanLon = Math.max(bbox.maxLon - bbox.minLon, 1e-9) * lonScale;
    const spanLat = Math.max(bbox.maxLat - bbox.minLat, 1e-9);
    const viewHeight = Math.round(WIDTH * (spanLat / spanLon));

    return { projection: project(bbox, WIDTH, viewHeight, 12) };
  }, [boundary, zones]);

  if (!layout) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-xl border border-dashed border-line px-6 text-center',
          className,
        )}
        style={{ height }}
      >
        <p className="max-w-sm text-[12.5px] leading-relaxed text-faint">
          No boundary loaded. Add your jurisdiction and {zoneLabel.toLowerCase()} files in setup and
          the map appears here.
        </p>
      </div>
    );
  }

  const { projection } = layout;
  const activeZone =
    point && zones ? featureName(featureAt(point.lon, point.lat, zones)) : '';
  const pinXY = point ? projection.toXY(point.lon, point.lat) : null;

  const handleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!onPick || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    // Map the click through the rendered size back into viewBox units.
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * projection.height;
    const [lon, lat] = projection.toLonLat(x, y);
    onPick(lon, lat);
  };

  return (
    <div
      className={cn(
        'flex justify-center overflow-hidden rounded-xl border border-line bg-raised',
        className,
      )}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${projection.height}`}
        onClick={handleClick}
        role={onPick ? 'button' : 'img'}
        aria-label={onPick ? 'Jurisdiction map — click to place a pin' : 'Jurisdiction map'}
        className={cn('block max-w-full', onPick && 'cursor-crosshair')}
        style={{ height, width: 'auto' }}
      >
        {boundary?.features.map((feature, i) => (
          <path
            key={`b${i}`}
            d={featurePath(feature, projection)}
            className="fill-surface stroke-line-strong"
            strokeWidth={1.5}
          />
        ))}

        {zones?.features.map((feature, i) => {
          const name = featureName(feature);
          const isActive = Boolean(name) && name === activeZone;
          const centroid = featureCentroid(feature);
          const labelXY = centroid ? projection.toXY(centroid[0], centroid[1]) : null;
          return (
            <g key={`z${i}`}>
              <path
                d={featurePath(feature, projection)}
                className={cn(
                  'stroke-line-strong transition',
                  isActive ? 'fill-accent/25' : 'fill-accent/5 hover:fill-accent/10',
                )}
                strokeWidth={1}
              />
              {labelXY && name && (
                <text
                  x={labelXY[0]}
                  y={labelXY[1]}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={cn(
                    'pointer-events-none select-none text-[15px] font-bold',
                    isActive ? 'fill-accent' : 'fill-muted',
                  )}
                >
                  {name}
                </text>
              )}
            </g>
          );
        })}

        {pinXY && (
          <g className="pointer-events-none">
            <circle cx={pinXY[0]} cy={pinXY[1]} r={9} className="fill-danger/25" />
            <circle cx={pinXY[0]} cy={pinXY[1]} r={4} className="fill-danger stroke-surface" strokeWidth={1.5} />
          </g>
        )}
      </svg>
    </div>
  );
}
