/**
 * Geometry for jurisdiction boundaries.
 *
 * Agencies already hold their beat, zone and district boundaries as GIS
 * polygons — county GIS or the CAD vendor produced them years ago. Feeding
 * that same file in here means a location's beat can be *derived* rather than
 * typed from memory, which is where it currently goes wrong.
 *
 * Everything is plain arithmetic on GeoJSON. No mapping library, no tile
 * server, and no request leaving the network — which matters when the thing
 * being plotted is a crime scene.
 */

/** GeoJSON orders coordinates [longitude, latitude]. */
export type Position = [number, number];
export type LinearRing = Position[];
/** Outer ring first, then any holes. */
export type PolygonCoords = LinearRing[];

export interface GeoFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry:
    | { type: 'Polygon'; coordinates: PolygonCoords }
    | { type: 'MultiPolygon'; coordinates: PolygonCoords[] };
}

export interface GeoFeatureCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

export interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/* ------------------------------------------------------------------ */
/* Point in polygon                                                    */
/* ------------------------------------------------------------------ */

/**
 * Ray casting. Counts how many times a ray heading east from the point crosses
 * the ring; an odd count means inside.
 */
export function pointInRing(lon: number, lat: number, ring: LinearRing): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    // Does the edge straddle the point's latitude?
    const straddles = yi > lat !== yj > lat;
    if (!straddles) continue;
    // Longitude where the edge crosses that latitude.
    const crossing = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (lon < crossing) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring and outside every hole. */
export function pointInPolygon(lon: number, lat: number, coords: PolygonCoords): boolean {
  if (coords.length === 0) return false;
  if (!pointInRing(lon, lat, coords[0])) return false;
  for (let i = 1; i < coords.length; i += 1) {
    if (pointInRing(lon, lat, coords[i])) return false;
  }
  return true;
}

export function pointInFeature(lon: number, lat: number, feature: GeoFeature): boolean {
  const { geometry } = feature;
  if (geometry.type === 'Polygon') return pointInPolygon(lon, lat, geometry.coordinates);
  return geometry.coordinates.some((poly) => pointInPolygon(lon, lat, poly));
}

/** The first feature containing the point, or null. */
export function featureAt(
  lon: number,
  lat: number,
  collection: GeoFeatureCollection | null | undefined,
): GeoFeature | null {
  if (!collection) return null;
  for (const feature of collection.features) {
    if (pointInFeature(lon, lat, feature)) return feature;
  }
  return null;
}

/**
 * The name a feature goes by. Agencies label these fields every possible way,
 * so check the usual suspects rather than demanding one schema.
 */
const NAME_KEYS = [
  'beat', 'BEAT', 'Beat',
  'zone', 'ZONE', 'Zone',
  'district', 'DISTRICT', 'District',
  'rd', 'RD', 'reporting_district',
  'name', 'NAME', 'Name',
  'label', 'LABEL',
  'id', 'ID',
];

export function featureName(feature: GeoFeature | null): string {
  if (!feature) return '';
  for (const key of NAME_KEYS) {
    const value = feature.properties?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* Bounds and projection                                               */
/* ------------------------------------------------------------------ */

function eachPosition(collection: GeoFeatureCollection, visit: (p: Position) => void): void {
  for (const feature of collection.features) {
    const polys =
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) for (const position of ring) visit(position);
  }
}

export function bboxOf(collection: GeoFeatureCollection): BBox | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let seen = false;

  eachPosition(collection, ([lon, lat]) => {
    seen = true;
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  });

  return seen ? { minLon, minLat, maxLon, maxLat } : null;
}

export interface Projection {
  toXY: (lon: number, lat: number) => [number, number];
  toLonLat: (x: number, y: number) => [number, number];
  width: number;
  height: number;
}

/**
 * Equirectangular projection fitted *inside* a box, with a cosine correction
 * so a jurisdiction does not come out horizontally stretched. The shape is
 * centred rather than letterboxed to one edge. Fine at the scale of one city;
 * not a substitute for a real projection.
 */
export function project(bbox: BBox, width: number, height: number, padding = 8): Projection {
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180) || 1;

  const spanLon = Math.max(bbox.maxLon - bbox.minLon, 1e-9) * lonScale;
  const spanLat = Math.max(bbox.maxLat - bbox.minLat, 1e-9);

  const innerW = Math.max(width - padding * 2, 1);
  const innerH = Math.max(height - padding * 2, 1);
  // One scale for both axes keeps the aspect honest.
  const scale = Math.min(innerW / spanLon, innerH / spanLat);

  const offsetX = (width - spanLon * scale) / 2;
  const offsetY = (height - spanLat * scale) / 2;

  const toXY = (lon: number, lat: number): [number, number] => [
    offsetX + (lon - bbox.minLon) * lonScale * scale,
    // Latitude increases northward; SVG y increases downward.
    offsetY + (bbox.maxLat - lat) * scale,
  ];

  const toLonLat = (x: number, y: number): [number, number] => [
    bbox.minLon + (x - offsetX) / (lonScale * scale),
    bbox.maxLat - (y - offsetY) / scale,
  ];

  return { toXY, toLonLat, width, height };
}

/** An SVG path for one feature under a projection. */
export function featurePath(feature: GeoFeature, projection: Projection): string {
  const polys =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;

  const parts: string[] = [];
  for (const poly of polys) {
    for (const ring of poly) {
      if (ring.length === 0) continue;
      const points = ring.map(([lon, lat]) => projection.toXY(lon, lat));
      parts.push(
        `M ${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ')} Z`,
      );
    }
  }
  return parts.join(' ');
}

/** Rough centroid of a feature's outer ring — good enough to place a label. */
export function featureCentroid(feature: GeoFeature): Position | null {
  const polys =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  const ring = polys[0]?.[0];
  if (!ring || ring.length === 0) return null;

  let lon = 0;
  let lat = 0;
  for (const [x, y] of ring) {
    lon += x;
    lat += y;
  }
  return [lon / ring.length, lat / ring.length];
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

export interface ParseResult {
  collection: GeoFeatureCollection | null;
  error: string | null;
  /** Names found, so setup can show what was actually loaded. */
  names: string[];
}

/**
 * Accepts what an agency is likely to paste: a FeatureCollection, a bare
 * Feature, or a bare geometry. Rejects anything without polygons rather than
 * silently loading an empty map.
 */
export function parseGeoJSON(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { collection: null, error: null, names: [] };

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { collection: null, error: 'That is not valid JSON. Paste the contents of a .geojson file.', names: [] };
  }

  const asRecord = raw as Record<string, unknown>;
  let features: unknown[];

  if (asRecord?.type === 'FeatureCollection' && Array.isArray(asRecord.features)) {
    features = asRecord.features;
  } else if (asRecord?.type === 'Feature') {
    features = [asRecord];
  } else if (asRecord?.type === 'Polygon' || asRecord?.type === 'MultiPolygon') {
    features = [{ type: 'Feature', properties: {}, geometry: asRecord }];
  } else {
    return {
      collection: null,
      error: 'No GeoJSON features found. Expected a FeatureCollection of polygons.',
      names: [],
    };
  }

  const valid: GeoFeature[] = [];
  for (const candidate of features) {
    const feature = candidate as GeoFeature;
    const type = feature?.geometry?.type;
    if (type !== 'Polygon' && type !== 'MultiPolygon') continue;
    if (!Array.isArray(feature.geometry.coordinates)) continue;
    valid.push({
      type: 'Feature',
      properties: feature.properties ?? {},
      geometry: feature.geometry,
    });
  }

  if (valid.length === 0) {
    return {
      collection: null,
      error:
        'The file loaded but held no polygons. Boundary layers must be Polygon or MultiPolygon — point or line layers will not work.',
      names: [],
    };
  }

  const collection: GeoFeatureCollection = { type: 'FeatureCollection', features: valid };
  return {
    collection,
    error: null,
    names: valid.map((f, i) => featureName(f) || `Area ${i + 1}`),
  };
}
