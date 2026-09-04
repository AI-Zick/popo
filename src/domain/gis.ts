/**
 * The county's own address points, as the source of truth for where things are.
 *
 * Nearly every department in the country sits inside a county that already
 * maintains an authoritative address layer — the one the 911 centre routes
 * on, the one the assessor bills from. The agency usually has rights to it
 * already, through an agreement that predates any of this software. It is
 * better data than a commercial geocoder for the only job that matters here:
 * the rural route numbers, the new subdivisions and the trailer park lot
 * numbers that a national dataset either does not have or has wrong.
 *
 * **It also never leaves the building.** An address on an incident is
 * criminal justice information. Typing one into a box that fans out to a
 * commercial geocoder on every keystroke is a disclosure to a third party,
 * repeated a few hundred times a shift, and it is the kind of thing that is
 * fine right up until somebody asks about it in discovery. Reading the county's
 * layer through this agency's own server is one known host talking to one
 * known host, under an agreement that already exists.
 *
 * **Every county is different, and that is the whole engineering problem.**
 * One publishes `ADDR_NUM` / `ST_NAME`; the next publishes `FULLADDR`; a third
 * has the house number inside the street field. So this file does not try to
 * know any county — it describes what a county service looks like, an
 * administrator maps the fields once, and everything downstream reads the same
 * shape. Adding the second county is filling in a form, not writing code.
 *
 * **None of this has been run against a live county service.** It is built and
 * tested against recorded responses in the shapes ArcGIS and GeoJSON actually
 * return. The first real county will find something — that is what the test
 * button on the setup screen is for, and why the failure messages say which
 * part failed rather than "could not connect".
 */

/* ------------------------------------------------------------------ */
/* What a county service looks like                                    */
/* ------------------------------------------------------------------ */

/**
 * How the county publishes.
 *
 * ArcGIS is what the overwhelming majority run — a `FeatureServer` or
 * `MapServer` layer with a `/query` endpoint. Plain GeoJSON covers the rest,
 * including a county that will only give the agency a file on a share.
 */
export type GisKind = '' | 'arcgis' | 'geojson';

export const GIS_KIND_LABEL: Record<GisKind, string> = {
  '': 'Not set up',
  arcgis: 'ArcGIS REST service',
  geojson: 'GeoJSON file or endpoint',
};

/**
 * Which attribute holds what.
 *
 * Filled in once by whoever set the connection up, from the county's own
 * field list. `fullAddress` is the shortcut where the county publishes a
 * composed address; otherwise the number and street are assembled here.
 */
export interface GisFields {
  fullAddress: string;
  houseNumber: string;
  street: string;
  unit: string;
  city: string;
  state: string;
  zip: string;
}

export interface GisSource {
  kind: GisKind;

  /**
   * The layer's query endpoint — everything up to and including the layer
   * number, e.g. `https://gis.county.gov/arcgis/rest/services/Addresses/FeatureServer/0`.
   */
  url: string;

  fields: GisFields;

  /**
   * A basemap tile template, `{z}/{x}/{y}`, where the county publishes one.
   *
   * Optional and separate: an agency can have authoritative addresses without
   * a tile service, and the streets-under-the-pin question is not the same
   * question as where-is-this-address.
   */
  basemapUrl: string;

  /** How the county wants to be credited on the map, where they require it. */
  attribution: string;

  /** Who to ring at the county when it stops answering. */
  contact: string;

  /** When somebody last confirmed this connection works. */
  checkedOn: string;
}

export function emptyGisSource(): GisSource {
  return {
    kind: '',
    url: '',
    fields: {
      fullAddress: '',
      houseNumber: '',
      street: '',
      unit: '',
      city: '',
      state: '',
      zip: '',
    },
    basemapUrl: '',
    attribution: '',
    contact: '',
    checkedOn: '',
  };
}

/* ------------------------------------------------------------------ */
/* Whether it is set up enough to try                                  */
/* ------------------------------------------------------------------ */

export interface Check {
  ok: boolean;
  reason: string;
  field: string;
  advice: string;
}

const good: Check = { ok: true, reason: '', field: '', advice: '' };

/**
 * Enough to knock on the county's door.
 *
 * Deliberately less than a working configuration. Asking the county what it
 * calls its fields is how somebody finds out what to put in the mapping, so
 * requiring the mapping first would make the test button unusable on exactly
 * the day it is needed — the mapping cannot be filled in until the county has
 * been asked, and the county cannot be asked until the mapping is filled in.
 *
 * A probe needs somewhere to send the request, and nothing else.
 */
export function checkEndpoint(source: GisSource): Check {
  if (!source.kind) return good;

  if (!source.url.trim()) {
    return {
      ok: false,
      reason: 'Where is the county’s layer?',
      field: 'url',
      advice:
        'The layer’s query endpoint — for ArcGIS that is everything up to and including the layer number, ending in something like /FeatureServer/0.',
    };
  }

  /*
    Only http(s), and said plainly. The server fetches whatever is put here on
    behalf of a signed-in user, so a `file:` or `gopher:` URL is not a typo to
    be corrected quietly — it is the shape of a request to read something else.
  */
  let parsed: URL;
  try {
    parsed = new URL(source.url);
  } catch {
    return { ok: false, reason: 'That is not a URL.', field: 'url', advice: '' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      reason: 'A county service is reached over http or https.',
      field: 'url',
      advice: '',
    };
  }

  if (source.basemapUrl.trim() && !/\{z\}|\{x\}|\{y\}/.test(source.basemapUrl)) {
    return {
      ok: false,
      reason: 'A tile template needs {z}, {x} and {y} in it.',
      field: 'basemapUrl',
      advice: 'That is how the map asks for one tile rather than the whole county.',
    };
  }

  return good;
}

/**
 * Everything a search needs: somewhere to ask, and which columns hold what.
 *
 * The endpoint checks first, so the message names the earlier problem when
 * both are wrong — a URL nobody can reach is the thing to fix before the
 * field names it would have published.
 */
export function checkSource(source: GisSource): Check {
  if (!source.kind) return good;

  const endpoint = checkEndpoint(source);
  if (!endpoint.ok) return endpoint;

  const { fullAddress, houseNumber, street } = source.fields;
  if (!fullAddress.trim() && !(houseNumber.trim() && street.trim())) {
    return {
      ok: false,
      reason: 'Which fields hold the address?',
      field: 'fields',
      advice:
        'Either the county’s composed address field, or the house number and street separately. The county’s own field list has the names — they differ everywhere.',
    };
  }

  return good;
}

export const isConfigured = (source: GisSource): boolean =>
  Boolean(source.kind) && checkSource(source).ok;

/* ------------------------------------------------------------------ */
/* Asking it a question                                               */
/* ------------------------------------------------------------------ */

/**
 * What an officer typed, split the way a county stores it.
 *
 * "612 marion" is a house number and part of a street name, and those live in
 * different columns in most county layers. Splitting on the leading digits is
 * crude and right: an address that starts with a number starts with its house
 * number, everywhere.
 */
export function splitAddress(text: string): { number: string; street: string } {
  const trimmed = text.trim();
  const match = trimmed.match(/^(\d+)\s+(.*)$/);
  if (match) return { number: match[1], street: match[2].trim() };
  if (/^\d+$/.test(trimmed)) return { number: trimmed, street: '' };
  return { number: '', street: trimmed };
}

/**
 * The request that finds what an officer typed.
 *
 * The house number is anchored to the start and the street name is matched
 * anywhere in the field, and that asymmetry is the whole of it. Officers type
 * "612 marion"; the county holds "612 N MARION ST". Anchoring the street too
 * — which is what this did first, and what looks obviously right — matches
 * nothing at all, because the directional the officer did not type sits
 * between the number and the name. Nobody types "612 n marion st".
 *
 * Anchoring the *number* is what stops the list filling with 6120 and 61200.
 *
 * The value is escaped for SQL because that is what ArcGIS speaks; the caller
 * still sends it as a query parameter, so this is defence against a broken
 * query rather than the only thing standing between a county and an injection.
 */
export function searchUrl(source: GisSource, text: string, limit = 8): string {
  const term = text.trim();
  if (source.kind === 'geojson') {
    /*
      A plain GeoJSON endpoint has no query language. It is fetched whole and
      filtered here — which is fine for a county file of a few tens of
      thousands of points and hopeless beyond that, and the setup screen says
      so rather than letting somebody discover it at scale.
    */
    return source.url;
  }

  const params = new URLSearchParams({
    where: whereFor(source.fields, term),
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(limit),
    f: 'geojson',
  });
  return `${source.url.replace(/\/+$/, '')}/query?${params.toString()}`;
}

function whereFor(fields: GisFields, term: string): string {
  if (!term) return '1=0';
  const { number, street } = splitAddress(term);
  const composed = fields.fullAddress.trim();

  if (composed) {
    /*
      One field holding the lot. The number anchors, the street floats — so
      "612 marion" finds "612 N MARION ST" and does not find "1612 MARION".
    */
    const clauses = [
      number && `UPPER(${composed}) LIKE '${escapeSql(number)}%'`,
      street && `UPPER(${composed}) LIKE '%${escapeSql(street.toUpperCase())}%'`,
    ].filter(Boolean);
    return clauses.length > 0 ? clauses.join(' AND ') : '1=0';
  }

  const clauses = [
    number && fields.houseNumber.trim() && `${fields.houseNumber} LIKE '${escapeSql(number)}%'`,
    street &&
      fields.street.trim() &&
      `UPPER(${fields.street}) LIKE '%${escapeSql(street.toUpperCase())}%'`,
  ].filter(Boolean);
  return clauses.length > 0 ? clauses.join(' AND ') : '1=0';
}

/** ArcGIS escapes a quote by doubling it, as SQL does. */
const escapeSql = (value: string): string => value.replace(/'/g, "''");

/* ------------------------------------------------------------------ */
/* Reading the answer                                                  */
/* ------------------------------------------------------------------ */

export interface AddressCandidate {
  /** The street line, assembled or taken whole. */
  address: string;
  unit: string;
  city: string;
  state: string;
  zip: string;
  longitude: number;
  latitude: number;
}

interface Feature {
  properties?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown; x?: unknown; y?: unknown } | null;
}

/**
 * Candidates from whatever the county sent back.
 *
 * Tolerant on purpose about the two shapes ArcGIS answers in — `f=geojson`
 * gives `properties` and a GeoJSON geometry, `f=json` gives `attributes` and
 * `{x, y}` — because which one a county's server actually honours is not
 * something an administrator should have to know before the connection works.
 *
 * A feature with no usable point is dropped rather than returned at 0,0. An
 * address in the Gulf of Guinea is worse than an address that did not come
 * back, because somebody would take the first one.
 */
export function candidatesFrom(
  source: GisSource,
  payload: unknown,
  filter = '',
): AddressCandidate[] {
  const features = featureList(payload);
  const wanted = filter.trim().toUpperCase();

  const out: AddressCandidate[] = [];
  for (const feature of features) {
    const attrs = feature.properties ?? feature.attributes ?? {};
    const point = pointOf(feature);
    if (!point) continue;

    const address = addressOf(source.fields, attrs);
    if (!address) continue;
    if (wanted && !matchesTyped(address, wanted)) continue;

    out.push({
      address,
      unit: text(attrs[source.fields.unit]),
      city: text(attrs[source.fields.city]),
      state: text(attrs[source.fields.state]),
      zip: text(attrs[source.fields.zip]),
      longitude: point[0],
      latitude: point[1],
    });
  }
  return out;
}

/**
 * Whether a composed address answers what somebody typed.
 *
 * The same asymmetry the query uses, for the whole-file case where the
 * filtering happens here: the number anchors, the street name floats.
 */
export function matchesTyped(address: string, typed: string): boolean {
  const { number, street } = splitAddress(typed);
  const upper = address.toUpperCase();
  if (number && !upper.startsWith(number)) return false;
  if (street && !upper.includes(street.toUpperCase())) return false;
  return Boolean(number || street);
}

function featureList(payload: unknown): Feature[] {
  const body = (payload ?? {}) as { features?: unknown };
  return Array.isArray(body.features) ? (body.features as Feature[]) : [];
}

/** The street line, composed or taken whole. */
function addressOf(fields: GisFields, attrs: Record<string, unknown>): string {
  const whole = text(attrs[fields.fullAddress]);
  if (whole) return whole;
  return [text(attrs[fields.houseNumber]), text(attrs[fields.street])]
    .filter(Boolean)
    .join(' ')
    .trim();
}

/**
 * The point, from either shape, as [longitude, latitude].
 *
 * Rejects anything outside the possible range rather than passing it on. A
 * county service misconfigured to answer in state-plane feet returns numbers
 * in the hundreds of thousands, and those are not coordinates — they are a
 * setup problem, and they should look like one.
 */
function pointOf(feature: Feature): [number, number] | null {
  const geometry = feature.geometry;
  if (!geometry) return null;

  let lon: unknown;
  let lat: unknown;
  if (Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
    [lon, lat] = geometry.coordinates as unknown[];
  } else {
    lon = geometry.x;
    lat = geometry.y;
  }

  const longitude = Number(lon);
  const latitude = Number(lat);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  if (Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null;
  if (longitude === 0 && latitude === 0) return null;
  return [longitude, latitude];
}

const text = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).trim();

/* ------------------------------------------------------------------ */
/* What the field names on offer are                                   */
/* ------------------------------------------------------------------ */

/**
 * The attribute names a county's layer publishes, for the mapping form.
 *
 * Read from a sample response rather than asked for, because nobody knows
 * their county's field names off the top of their head and the whole point of
 * the test button is to find out.
 */
export function fieldNames(payload: unknown): string[] {
  const features = featureList(payload);
  const names = new Set<string>();
  for (const feature of features.slice(0, 20)) {
    for (const key of Object.keys(feature.properties ?? feature.attributes ?? {})) {
      names.add(key);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * A guess at the mapping, from the names the county uses.
 *
 * A guess, and offered as one — it fills the form in so somebody can correct
 * it, which is faster than an empty form and more honest than pretending the
 * connection is configured.
 */
export function guessFields(names: string[]): GisFields {
  const pick = (...patterns: RegExp[]): string =>
    patterns.reduce<string>(
      (found, pattern) => found || (names.find((name) => pattern.test(name)) ?? ''),
      '',
    );

  return {
    fullAddress: pick(/^full_?addr/i, /^site_?addr/i, /^address$/i, /^addr_?label/i),
    houseNumber: pick(/^addr_?num/i, /^house_?num/i, /^add_?number/i, /^stnum/i),
    street: pick(/^st_?name$/i, /^street_?name/i, /^street$/i, /^road/i),
    unit: pick(/^unit/i, /^apt/i, /^suite/i, /^sub_?addr/i),
    city: pick(/^city/i, /^municipal/i, /^place/i, /^post_?comm/i),
    state: pick(/^state/i, /^st$/i),
    zip: pick(/^zip/i, /^postal/i, /^post_?code/i),
  };
}

/* ------------------------------------------------------------------ */
/* What the setup screen says                                          */
/* ------------------------------------------------------------------ */

export const WHY_COUNTY =
  'The county already maintains the address layer the 911 centre routes on, and this agency almost certainly has rights to it. It is better data than a commercial geocoder for the addresses that matter — rural routes, new subdivisions, trailer lots — and reading it through this server means an address on an incident never reaches a third party.';

export const UNTESTED_NOTICE =
  'This connection has not been tested yet. Every county publishes differently, so the field mapping below is a guess until something comes back.';
