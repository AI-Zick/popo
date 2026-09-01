import { describe, expect, it } from 'vitest';
import {
  bboxOf,
  featureAt,
  featureName,
  parseGeoJSON,
  pointInPolygon,
  pointInRing,
  project,
  type GeoFeature,
  type GeoFeatureCollection,
} from '../geo';

/** A square from (0,0) to (10,10), in [lon, lat] order. */
const SQUARE: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];

function feature(name: string, ring: [number, number][], holes: [number, number][][] = []): GeoFeature {
  return {
    type: 'Feature',
    properties: { beat: name },
    geometry: { type: 'Polygon', coordinates: [ring, ...holes] },
  };
}

const collection = (...features: GeoFeature[]): GeoFeatureCollection => ({
  type: 'FeatureCollection',
  features,
});

describe('point in polygon', () => {
  it('finds points inside and outside', () => {
    expect(pointInRing(5, 5, SQUARE)).toBe(true);
    expect(pointInRing(15, 5, SQUARE)).toBe(false);
    expect(pointInRing(5, -1, SQUARE)).toBe(false);
  });

  it('excludes points inside a hole', () => {
    const hole: [number, number][] = [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
      [4, 4],
    ];
    expect(pointInPolygon(5, 5, [SQUARE, hole])).toBe(false);
    expect(pointInPolygon(2, 2, [SQUARE, hole])).toBe(true);
  });

  it('handles a concave shape', () => {
    // An L, missing its top-right quadrant.
    const ell: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 5],
      [5, 5],
      [5, 10],
      [0, 10],
      [0, 0],
    ];
    expect(pointInRing(2, 8, ell)).toBe(true);
    expect(pointInRing(8, 8, ell)).toBe(false);
  });
});

describe('locating a beat', () => {
  const zones = collection(
    feature('1A', [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 5],
      [0, 0],
    ]),
    feature('2B', [
      [5, 0],
      [10, 0],
      [10, 5],
      [5, 5],
      [5, 0],
    ]),
  );

  it('returns the zone a point falls in', () => {
    expect(featureName(featureAt(2, 2, zones))).toBe('1A');
    expect(featureName(featureAt(7, 2, zones))).toBe('2B');
  });

  it('returns nothing for a point outside every zone', () => {
    expect(featureAt(20, 20, zones)).toBeNull();
  });

  it('reads the zone name from whichever property the agency used', () => {
    const named: GeoFeature = {
      type: 'Feature',
      properties: { DISTRICT: 'North' },
      geometry: { type: 'Polygon', coordinates: [SQUARE] },
    };
    expect(featureName(named)).toBe('North');
  });
});

describe('bounds and projection', () => {
  const zones = collection(feature('1A', SQUARE));

  it('computes a bounding box', () => {
    expect(bboxOf(zones)).toEqual({ minLon: 0, minLat: 0, maxLon: 10, maxLat: 10 });
  });

  it('round-trips a coordinate through the projection', () => {
    const projection = project(bboxOf(zones)!, 400, 400);
    const [x, y] = projection.toXY(5, 5);
    const [lon, lat] = projection.toLonLat(x, y);
    expect(lon).toBeCloseTo(5, 6);
    expect(lat).toBeCloseTo(5, 6);
  });

  it('centres a shape that does not fill the box', () => {
    // A square in a wide box should sit in the middle, not against the edge.
    const projection = project(bboxOf(zones)!, 800, 400);
    const [xWest] = projection.toXY(0, 5);
    const [xEast] = projection.toXY(10, 5);
    expect(xWest).toBeGreaterThan(100);
    expect(xEast).toBeLessThan(700);
    expect((xWest + xEast) / 2).toBeCloseTo(400, 0);
  });

  it('puts north at the top', () => {
    const projection = project(bboxOf(zones)!, 400, 400);
    const [, yNorth] = projection.toXY(5, 9);
    const [, ySouth] = projection.toXY(5, 1);
    expect(yNorth).toBeLessThan(ySouth);
  });
});

describe('parsing what an agency pastes', () => {
  it('accepts a FeatureCollection', () => {
    const result = parseGeoJSON(JSON.stringify(collection(feature('1A', SQUARE))));
    expect(result.error).toBeNull();
    expect(result.names).toEqual(['1A']);
  });

  it('accepts a bare feature or a bare geometry', () => {
    expect(parseGeoJSON(JSON.stringify(feature('1A', SQUARE))).collection?.features).toHaveLength(1);
    expect(
      parseGeoJSON(JSON.stringify({ type: 'Polygon', coordinates: [SQUARE] })).collection?.features,
    ).toHaveLength(1);
  });

  it('explains bad JSON rather than throwing', () => {
    expect(parseGeoJSON('{ not json').error).toMatch(/not valid JSON/i);
  });

  it('rejects a layer with no polygons in it', () => {
    const points = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } }],
    };
    expect(parseGeoJSON(JSON.stringify(points)).error).toMatch(/no polygons/i);
  });

  it('treats empty input as nothing loaded, not an error', () => {
    expect(parseGeoJSON('   ')).toEqual({ collection: null, error: null, names: [] });
  });
});
