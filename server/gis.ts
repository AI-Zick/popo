/**
 * Talking to the county's GIS on the agency's behalf.
 *
 * The fetch happens here rather than in the browser, and that is the whole
 * reason this file exists. Three things follow from it.
 *
 * An address on an incident is criminal justice information, and an officer
 * typing one is generating a request per keystroke. From the browser those
 * requests leave every workstation in the department, from whatever network
 * that machine is on. From here they leave one known host, which is the one
 * the county put in their agreement and can allowlist.
 *
 * The county's endpoint never reaches the browser either. It is often on an
 * internal network, sometimes with a key in the query string, and neither
 * belongs in a page an officer could read the source of.
 *
 * And the URL is the agency's own configuration rather than anything a request
 * carries — so this cannot be pointed at a new host by asking it to be. What
 * an administrator sets is checked before it is stored and again before it is
 * used, and only http(s) ever gets fetched.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { requireAuth } from './auth';
import type { AgencyProfile } from '../src/domain/agency';
import {
  candidatesFrom,
  checkEndpoint,
  checkSource,
  emptyGisSource,
  fieldNames,
  guessFields,
  searchUrl,
  type GisSource,
} from '../src/domain/gis';

/** How long to wait on a county before giving up and saying so. */
const TIMEOUT_MS = 6000;

/**
 * A ceiling on what will be read back.
 *
 * A plain GeoJSON endpoint is the county's whole address file, and some
 * counties publish a hundred megabytes of it. Reading that on every keystroke
 * is not a feature, and failing loudly at eight megabytes is better than
 * quietly becoming unusable at scale.
 */
const MAX_BYTES = 8 * 1024 * 1024;

function sourceFor(db: DatabaseSync): GisSource {
  const row = db.prepare('SELECT doc FROM agency WHERE id = ?').get('default') as
    | { doc: string }
    | undefined;
  const agency = row ? (JSON.parse(row.doc) as AgencyProfile) : null;
  return agency?.gis ?? emptyGisSource();
}

interface Fetched {
  ok: boolean;
  status: number;
  payload: unknown;
  error: string;
  advice: string;
}

/**
 * One request to the county, with every way it goes wrong named.
 *
 * The messages matter more than usual here. This is a connection between two
 * organisations that somebody has to get working over the telephone, and
 * "could not connect" tells the person on the other end nothing — whereas
 * "the county answered, but not with JSON" tells them they have the wrong URL,
 * and "the county returned an error: invalid field" tells them the mapping is
 * wrong. Naming which half failed is most of the value.
 */
async function ask(url: string): Promise<Fetched> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });

    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_BYTES) {
      return {
        ok: false,
        status: 413,
        payload: null,
        error: 'The county sent back more than this will read in one go.',
        advice:
          'That usually means the endpoint is the whole address file rather than a queryable layer. An ArcGIS FeatureServer layer answers a query; a static GeoJSON file does not.',
      };
    }

    const body = await response.text();
    if (body.length > MAX_BYTES) {
      return {
        ok: false,
        status: 413,
        payload: null,
        error: 'The county sent back more than this will read in one go.',
        advice: 'Point this at a queryable layer rather than the whole file.',
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: 502,
        payload: null,
        error: `The county's service answered ${response.status}.`,
        advice:
          response.status === 404
            ? 'Check the layer number on the end of the URL — a FeatureServer with no layer number answers 404.'
            : 'This is the county’s end. Their GIS contact is on the setup screen.',
      };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return {
        ok: false,
        status: 502,
        payload: null,
        error: 'The county answered, but not with JSON.',
        advice:
          'That is usually a URL pointing at the service’s web page rather than its query endpoint. The endpoint ends in a layer number.',
      };
    }

    /*
      ArcGIS answers 200 with an error object inside it, which is a habit worth
      knowing about: without this check a bad field mapping looks like a county
      with no addresses in it.
    */
    const esriError = (payload as { error?: { message?: string; details?: string[] } }).error;
    if (esriError) {
      return {
        ok: false,
        status: 502,
        payload: null,
        error: `The county's service returned an error: ${esriError.message ?? 'no message'}`,
        advice:
          (esriError.details ?? []).join(' ') ||
          'An "invalid field" here means the field mapping below does not match what this layer publishes.',
      };
    }

    return { ok: true, status: 200, payload, error: '', advice: '' };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      status: 504,
      payload: null,
      error: aborted
        ? `The county did not answer within ${TIMEOUT_MS / 1000} seconds.`
        : 'Could not reach the county’s service.',
      advice: aborted
        ? 'If it is on an internal network, check this server can see it — the browser reaching it is not the same thing.'
        : 'Check the address, and that this server is allowed out to it.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export function registerGisRoutes(app: Express, db: DatabaseSync): void {
  /**
   * Addresses matching what an officer is typing.
   *
   * Open to any signed-in user, because looking an address up is what writing
   * a report is. Silent when no county is configured — an agency without one
   * is the ordinary case and should not see an error on every keystroke.
   */
  app.get('/api/gis/search', requireAuth, async (req: Request, res: Response) => {
    const source = sourceFor(db);
    const check = checkSource(source);
    if (!source.kind || !check.ok) {
      res.json({ candidates: [], configured: false });
      return;
    }

    const query = String(req.query.q ?? '').slice(0, 120).trim();
    if (query.length < 3) {
      // Two characters matches half a county. The screen says nothing yet.
      res.json({ candidates: [], configured: true });
      return;
    }

    const reply = await ask(searchUrl(source, query));
    if (!reply.ok) {
      res.status(reply.status).json({ error: reply.error, advice: reply.advice, configured: true });
      return;
    }

    /*
      The filter is passed through for the GeoJSON case, where the whole file
      came back because a static endpoint has no query language. For ArcGIS the
      county already applied it and this is a no-op.
    */
    res.json({
      candidates: candidatesFrom(source, reply.payload, source.kind === 'geojson' ? query : ''),
      configured: true,
      attribution: source.attribution,
    });
  });

  /**
   * What the county publishes, so somebody can map the fields to it.
   *
   * The point of the test button: it answers "does this connection work" and
   * "what are the field names" in one request, because those are the same
   * question at the moment somebody is setting it up.
   */
  app.post('/api/gis/test', requireAuth, async (req: Request, res: Response) => {
    const draft = (req.body?.source ?? {}) as Partial<GisSource>;
    const source: GisSource = { ...emptyGisSource(), ...draft, fields: { ...emptyGisSource().fields, ...(draft.fields ?? {}) } };

    /*
      Only the endpoint, not the mapping. This request is how somebody finds
      out what the county calls its fields, so refusing it until the fields are
      named would be refusing to answer the question that is being asked.
    */
    const check = checkEndpoint(source);
    if (!source.kind) {
      res.status(400).json({ error: 'Choose how the county publishes first.' });
      return;
    }
    if (!check.ok) {
      res.status(400).json({ error: check.reason, advice: check.advice, field: check.field });
      return;
    }

    /*
      Asked with no search term at all. What is wanted is a sample of whatever
      the layer holds, and a layer that answers this answers everything else.
    */
    const probe =
      source.kind === 'geojson'
        ? source.url
        : `${source.url.replace(/\/+$/, '')}/query?${new URLSearchParams({
            where: '1=1',
            outFields: '*',
            returnGeometry: 'true',
            outSR: '4326',
            resultRecordCount: '5',
            f: 'geojson',
          }).toString()}`;

    const reply = await ask(probe);
    if (!reply.ok) {
      res.status(reply.status).json({ error: reply.error, advice: reply.advice });
      return;
    }

    const names = fieldNames(reply.payload);
    const guess = guessFields(names);

    /*
      The sample is read with the guess filling whatever is still blank — the
      same rule the setup screen applies when it offers the guess. On a first
      test the mapping is empty by definition, and "the county answered" with
      three blank rows underneath reads as a failure rather than a success.
    */
    const shown: GisSource = {
      ...source,
      fields: Object.fromEntries(
        Object.entries(source.fields).map(([key, value]) => [
          key,
          value || guess[key as keyof GisSource['fields']],
        ]),
      ) as GisSource['fields'],
    };

    res.json({
      ok: true,
      fields: names,
      /* Filled in so somebody can correct it, which beats an empty form. */
      guess,
      sample: candidatesFrom(shown, reply.payload).slice(0, 3),
      reached: names.length > 0,
    });
  });
}
