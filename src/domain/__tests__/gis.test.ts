import { describe, expect, it } from 'vitest';
import {
  candidatesFrom,
  checkEndpoint,
  checkSource,
  emptyGisSource,
  fieldNames,
  guessFields,
  isConfigured,
  matchesTyped,
  searchUrl,
  splitAddress,
  UNTESTED_NOTICE,
  WHY_COUNTY,
  type GisSource,
} from '../gis';

/**
 * The two shapes a county actually answers in.
 *
 * `f=geojson` gives `properties` and a GeoJSON geometry; `f=json` — which is
 * what an older ArcGIS server hands back whether or not geojson was asked for
 * — gives `attributes` and `{x, y}`. Which one a county's server honours is
 * not something an administrator should have to know before it works.
 */
const geojsonReply = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { ADDR_NUM: '612', ST_NAME: 'N MARION ST', CITY: 'Cedar Falls', ZIP: '35004', UNIT: '' },
      geometry: { type: 'Point', coordinates: [-86.5148, 33.6104] },
    },
    {
      type: 'Feature',
      properties: { ADDR_NUM: '614', ST_NAME: 'N MARION ST', CITY: 'Cedar Falls', ZIP: '35004', UNIT: 'B' },
      geometry: { type: 'Point', coordinates: [-86.5149, 33.6106] },
    },
  ],
};

const esriJsonReply = {
  features: [
    {
      attributes: { FULLADDR: '612 N Marion St', CITY: 'Cedar Falls', ZIP: '35004' },
      geometry: { x: -86.5148, y: 33.6104 },
    },
  ],
};

const source = (partial: Partial<GisSource> = {}): GisSource => ({
  ...emptyGisSource(),
  kind: 'arcgis',
  url: 'https://gis.stclairco.gov/arcgis/rest/services/Addresses/FeatureServer/0',
  fields: { ...emptyGisSource().fields, houseNumber: 'ADDR_NUM', street: 'ST_NAME', city: 'CITY', zip: 'ZIP', unit: 'UNIT' },
  ...partial,
});

/* ------------------------------------------------------------------ */
/* Setting it up                                                       */
/* ------------------------------------------------------------------ */

describe('setting a county up', () => {
  it('asks nothing of an agency that has not started', () => {
    expect(checkSource(emptyGisSource()).ok).toBe(true);
    expect(isConfigured(emptyGisSource())).toBe(false);
  });

  it('needs somewhere to ask', () => {
    expect(checkSource(source({ url: '' })).field).toBe('url');
  });

  it('refuses a URL that is not a web address', () => {
    /*
      The server fetches whatever is put here on behalf of a signed-in user, so
      a file: URL is not a typo to correct quietly — it is the shape of a
      request to read something else.
    */
    expect(checkSource(source({ url: 'file:///etc/passwd' })).ok).toBe(false);
    expect(checkSource(source({ url: 'not a url' })).ok).toBe(false);
    expect(checkSource(source({ url: 'http://gis.county.local/x/FeatureServer/0' })).ok).toBe(true);
  });

  it('needs to know which fields hold the address', () => {
    const blank = source({ fields: { ...emptyGisSource().fields } });
    const check = checkSource(blank);
    expect(check.ok).toBe(false);
    expect(check.field).toBe('fields');
  });

  it('takes either a composed field or a number and a street', () => {
    const composed = source({ fields: { ...emptyGisSource().fields, fullAddress: 'FULLADDR' } });
    expect(checkSource(composed).ok).toBe(true);
    // A house number with no street is not enough to build a line from.
    const half = source({ fields: { ...emptyGisSource().fields, houseNumber: 'ADDR_NUM' } });
    expect(checkSource(half).ok).toBe(false);
  });

  it('lets the connection be tested before the fields are mapped', () => {
    /*
      The deadlock this exists to prevent: the test request is how somebody
      learns what the county calls its fields, so gating it on the mapping
      makes the button unusable on the one day it is needed. An unmapped
      source is not ready to search and is ready to probe, and those are
      different questions.
    */
    const unmapped = source({ fields: { ...emptyGisSource().fields } });
    expect(checkEndpoint(unmapped).ok).toBe(true);
    expect(checkSource(unmapped).ok).toBe(false);
  });

  it('names the unreachable URL before the unmapped fields', () => {
    // Both wrong: the one to fix first is the one the other depends on.
    const both = source({ url: 'file:///etc/passwd', fields: { ...emptyGisSource().fields } });
    expect(checkSource(both).field).toBe('url');
    expect(checkEndpoint(both).ok).toBe(false);
  });

  it('checks a tile template is one', () => {
    expect(checkSource(source({ basemapUrl: 'https://tiles.county.gov/roads' })).field).toBe('basemapUrl');
    expect(checkEndpoint(source({ basemapUrl: 'https://tiles.county.gov/roads' })).field).toBe('basemapUrl');
    expect(checkSource(source({ basemapUrl: 'https://tiles.county.gov/{z}/{x}/{y}.png' })).ok).toBe(true);
  });

  it('says why the county rather than a commercial geocoder', () => {
    expect(WHY_COUNTY).toMatch(/never reaches a third party|reaches a third party/);
    expect(UNTESTED_NOTICE).toMatch(/not been tested/);
  });
});

/* ------------------------------------------------------------------ */
/* Asking                                                              */
/* ------------------------------------------------------------------ */

describe('the question it asks the county', () => {
  it('anchors the house number and lets the street name float', () => {
    /*
      The asymmetry is the whole thing, and it is not what looks obviously
      right. Officers type "612 marion"; the county holds "612 N MARION ST".
      Anchoring the street too matches nothing, because the directional nobody
      types sits between the number and the name. Anchoring the number is what
      stops the list filling with 6120 and 61200.
    */
    const composed = source({ fields: { ...emptyGisSource().fields, fullAddress: 'FULLADDR' } });
    const where = new URL(searchUrl(composed, '612 marion')).searchParams.get('where')!;
    expect(where).toBe("UPPER(FULLADDR) LIKE '612%' AND UPPER(FULLADDR) LIKE '%MARION%'");
  });

  it('asks the two columns separately where the county keeps them apart', () => {
    const where = new URL(searchUrl(source(), '612 marion')).searchParams.get('where')!;
    expect(where).toBe("ADDR_NUM LIKE '612%' AND UPPER(ST_NAME) LIKE '%MARION%'");
  });

  it('copes with a street name alone, and a number alone', () => {
    expect(new URL(searchUrl(source(), 'marion')).searchParams.get('where')).toBe(
      "UPPER(ST_NAME) LIKE '%MARION%'",
    );
    expect(new URL(searchUrl(source(), '612')).searchParams.get('where')).toBe(
      "ADDR_NUM LIKE '612%'",
    );
  });

  it('splits what was typed the way a county stores it', () => {
    expect(splitAddress('612 N Marion St')).toEqual({ number: '612', street: 'N Marion St' });
    expect(splitAddress('  1142  ashwood ')).toEqual({ number: '1142', street: 'ashwood' });
    expect(splitAddress('marion')).toEqual({ number: '', street: 'marion' });
    expect(splitAddress('612')).toEqual({ number: '612', street: '' });
  });

  it('asks for coordinates in the projection everything else here uses', () => {
    const params = new URL(searchUrl(source(), 'marion')).searchParams;
    expect(params.get('outSR')).toBe('4326');
    expect(params.get('returnGeometry')).toBe('true');
  });

  it('escapes a quote rather than building a broken query', () => {
    const where = new URL(searchUrl(source(), "9 o'brien")).searchParams.get('where')!;
    expect(where).toContain("O''BRIEN");
  });

  it('asks for nothing on an empty search', () => {
    expect(new URL(searchUrl(source(), '   ')).searchParams.get('where')).toBe('1=0');
  });

  it('leaves a plain GeoJSON endpoint alone — it has no query language', () => {
    const plain = source({ kind: 'geojson', url: 'https://gis.county.gov/addresses.geojson' });
    expect(searchUrl(plain, 'marion')).toBe('https://gis.county.gov/addresses.geojson');
  });
});

/* ------------------------------------------------------------------ */
/* Reading the answer                                                  */
/* ------------------------------------------------------------------ */

describe('reading what came back', () => {
  it('reads the geojson shape', () => {
    const found = candidatesFrom(source(), geojsonReply);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({
      address: '612 N MARION ST',
      city: 'Cedar Falls',
      zip: '35004',
      longitude: -86.5148,
      latitude: 33.6104,
    });
    expect(found[1].unit).toBe('B');
  });

  it('reads the older esri shape without being told', () => {
    // `attributes` and `{x, y}` rather than `properties` and `coordinates`.
    const composed = source({ fields: { ...emptyGisSource().fields, fullAddress: 'FULLADDR', city: 'CITY', zip: 'ZIP' } });
    const found = candidatesFrom(composed, esriJsonReply);
    expect(found).toHaveLength(1);
    expect(found[0].address).toBe('612 N Marion St');
    expect(found[0].longitude).toBe(-86.5148);
  });

  it('drops a point it cannot use rather than returning it at nowhere', () => {
    /*
      An address in the Gulf of Guinea is worse than an address that did not
      come back, because somebody would take the first one.
    */
    const broken = {
      features: [
        { properties: { ADDR_NUM: '1', ST_NAME: 'A ST' }, geometry: { type: 'Point', coordinates: [0, 0] } },
        { properties: { ADDR_NUM: '2', ST_NAME: 'B ST' }, geometry: null },
        { properties: { ADDR_NUM: '3', ST_NAME: 'C ST' } },
      ],
    };
    expect(candidatesFrom(source(), broken)).toEqual([]);
  });

  it('drops coordinates that are not coordinates', () => {
    // A county answering in state-plane feet returns hundreds of thousands.
    // Those are a setup problem and should look like one.
    const feet = {
      features: [
        {
          properties: { ADDR_NUM: '612', ST_NAME: 'N MARION ST' },
          geometry: { type: 'Point', coordinates: [2189456.2, 1394882.7] },
        },
      ],
    };
    expect(candidatesFrom(source(), feet)).toEqual([]);
  });

  it('drops a feature with no address in it', () => {
    const nameless = { features: [{ properties: { OBJECTID: 4 }, geometry: { coordinates: [-86.5, 33.6] } }] };
    expect(candidatesFrom(source(), nameless)).toEqual([]);
  });

  it('survives a reply that is not what was expected at all', () => {
    for (const junk of [null, undefined, {}, { features: 'no' }, { error: { code: 400 } }]) {
      expect(candidatesFrom(source(), junk)).toEqual([]);
    }
  });

  it('filters a whole-file GeoJSON down to what was typed', () => {
    // A plain endpoint has no query language, so the filtering happens here —
    // and it has to understand an address the same way the query does.
    const plain = source({ kind: 'geojson' });
    expect(candidatesFrom(plain, geojsonReply, '614').map((c) => c.address)).toEqual([
      '614 N MARION ST',
    ]);
    // The case that was broken: a number and a street name with the county's
    // directional in between.
    expect(candidatesFrom(plain, geojsonReply, '612 marion').map((c) => c.address)).toEqual([
      '612 N MARION ST',
    ]);
    // The number is a prefix while somebody is still typing it, so "61" finds
    // 612 — but it anchors, so nothing finds it from the middle.
    expect(candidatesFrom(plain, geojsonReply, '61 marion').map((c) => c.address)).toEqual([
      '612 N MARION ST',
      '614 N MARION ST',
    ]);
    expect(candidatesFrom(plain, geojsonReply, '12 marion')).toEqual([]);
  });

  it('knows whether a composed address answers what was typed', () => {
    expect(matchesTyped('612 N MARION ST', '612 marion')).toBe(true);
    expect(matchesTyped('612 N MARION ST', 'marion')).toBe(true);
    expect(matchesTyped('612 N MARION ST', '612')).toBe(true);
    expect(matchesTyped('1612 MARION ST', '612 marion')).toBe(false);
    expect(matchesTyped('612 N MARION ST', 'ashwood')).toBe(false);
    expect(matchesTyped('612 N MARION ST', '   ')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Working out the mapping                                             */
/* ------------------------------------------------------------------ */

describe('helping somebody map the fields', () => {
  it('reads the names the county publishes', () => {
    expect(fieldNames(geojsonReply)).toEqual(['ADDR_NUM', 'CITY', 'ST_NAME', 'UNIT', 'ZIP']);
    expect(fieldNames(esriJsonReply)).toEqual(['CITY', 'FULLADDR', 'ZIP']);
  });

  it('guesses the common namings, as a guess', () => {
    const guess = guessFields(fieldNames(geojsonReply));
    expect(guess.houseNumber).toBe('ADDR_NUM');
    expect(guess.street).toBe('ST_NAME');
    expect(guess.city).toBe('CITY');
    expect(guess.zip).toBe('ZIP');
    expect(guess.fullAddress).toBe('');
  });

  it('prefers a composed field where the county has one', () => {
    expect(guessFields(fieldNames(esriJsonReply)).fullAddress).toBe('FULLADDR');
  });

  it('leaves what it cannot recognise blank rather than guessing wrong', () => {
    const odd = guessFields(['OBJECTID', 'SHAPE', 'GLOBALID']);
    expect(odd).toEqual({
      fullAddress: '',
      houseNumber: '',
      street: '',
      unit: '',
      city: '',
      state: '',
      zip: '',
    });
  });
});
