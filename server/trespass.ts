/**
 * Trespass notice routes.
 *
 * These are deliberately not part of the bulk state payload. A person's own
 * list is small and travels with them; a *place's* list is not — a shopping
 * centre, a transit station or a hospital accumulates hundreds of notices over
 * a few years, and shipping every one of them to every signed-in browser on
 * every load, so that one officer can look up one address once a week, is how
 * a records system becomes slow in its second year rather than its fifth.
 *
 * So the place's list is answered here: filtered, sorted, counted and paged in
 * SQL, over an index that covers exactly this query.
 *
 * Sorting and searching join to the people table rather than copying names
 * onto the notice. A copied name is a name that is wrong after somebody
 * marries, and a search that silently misses the person you are looking for is
 * worse than a slower one.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, documents } from './db';
import { newId } from './ids';
import { requireAuth, requirePermission } from './auth';
import { recordAudit } from './audit';
import { can } from '../src/domain/auth';
import {
  checkLift,
  checkTrespass,
  createTrespass,
  existingFor,
  sortForPerson,
  today,
  trespassState,
  type Trespass,
  type TrespassSource,
} from '../src/domain/trespass';
import { displayName, type MasterPerson } from '../src/domain/person';
import type { MasterLocation } from '../src/domain/location';

const notices = documents<Trespass>(DOC_TABLES.trespasses);
const people = documents<MasterPerson>(DOC_TABLES.people);
const locations = documents<MasterLocation>(DOC_TABLES.locations);

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);

const day = (value: unknown): string => {
  const raw = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
};

const SOURCES: TrespassSource[] = ['officer', 'dispatch', 'import'];
const sourceOf = (value: unknown): TrespassSource => {
  const raw = text(value, 20);
  return (SOURCES as string[]).includes(raw) ? (raw as TrespassSource) : 'officer';
};

/** What a row on the place's list needs, without shipping a whole person. */
interface Row {
  trespass: Trespass;
  person: {
    id: string;
    name: string;
    dob: string;
    cautions: string[];
  } | null;
}

const summarise = (person: MasterPerson | null): Row['person'] =>
  person
    ? {
        id: person.id,
        name: displayName(person),
        dob: person.dob,
        cautions: person.cautions ?? [],
      }
    : null;

/*
  The state filter, in SQL.

  Written once and shared by the count and the page so the two can never
  disagree — a footer saying "showing 25 of 312" over a list filtered
  differently from the count is a bug nobody reports and everybody notices.
*/
const IN_FORCE = "lifted_at = '' AND (expires_on = '' OR expires_on >= ?)";

type StateFilter = 'active' | 'all';

function stateClause(filter: StateFilter, on: string): { sql: string; params: string[] } {
  return filter === 'active' ? { sql: ` AND ${IN_FORCE}`, params: [on] } : { sql: '', params: [] };
}

export function registerTrespassRoutes(app: Express, db: DatabaseSync): void {
  /**
   * Everywhere one person is barred from.
   *
   * Returned whole. Somebody with more than a page of these is rare enough,
   * and important enough, that truncating the list would be the wrong answer.
   */
  app.get('/api/people/:id/trespasses', requireAuth, (req: Request, res: Response) => {
    const personId = text(req.params.id, 64);
    const list = notices.where(db, { person_id: personId });
    const on = today();

    res.json({
      trespasses: sortForPerson(list, on).map((trespass) => ({
        trespass,
        location: locations.find(db, trespass.locationId),
        state: trespassState(trespass, on),
      })),
    });
  });

  /**
   * Everybody barred from one place.
   *
   * Paged, searched and ordered by the database. `q` matches a name; `sort`
   * is name, served or expires; `dir` reverses it; `state` is the in-force
   * filter, which defaults to in-force because that is the question being
   * asked ninety-nine times in a hundred.
   */
  app.get('/api/locations/:id/trespasses', requireAuth, (req: Request, res: Response) => {
    const locationId = text(req.params.id, 64);
    const query = text(req.query.q, 80).trim();
    const filter: StateFilter = req.query.state === 'all' ? 'all' : 'active';
    const direction = req.query.dir === 'desc' ? 'DESC' : 'ASC';
    const on = today();

    /*
      Column names are chosen from this list, never taken from the request.
      The direction is one of two literals for the same reason.
    */
    const ORDERS: Record<string, string> = {
      name: `p.last_name ${direction}, p.first_name ${direction}, t.served_on DESC`,
      served: `t.served_on ${direction}, p.last_name ASC`,
      // An indefinite notice has no date to sort by. Empty string sorts before
      // every real date, so it is pushed to the end explicitly rather than
      // appearing as though it ran out in the year zero.
      expires: `(t.expires_on = '') ASC, t.expires_on ${direction}, p.last_name ASC`,
    };
    const order = ORDERS[text(req.query.sort, 20)] ?? ORDERS.name;

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const state = stateClause(filter, on);
    const search = query
      ? {
          sql: ' AND (p.last_name LIKE ? OR p.first_name LIKE ? OR p.dob LIKE ?)',
          // A prefix match, so the index on the name is usable. Officers type
          // the start of a surname, not the middle of one.
          params: [`${query}%`, `${query}%`, `${query}%`],
        }
      : { sql: '', params: [] as string[] };

    /*
      A left join, not an inner one. A notice whose person has since been
      expunged under a court order must still be counted and shown as a notice
      with no name attached — dropping the row would quietly change the total
      and make the list disagree with itself.
    */
    const from = `FROM trespasses t LEFT JOIN people p ON p.id = t.person_id WHERE t.location_id = ?${state.sql}${search.sql}`;
    const params = [locationId, ...state.params, ...search.params];

    const total = (
      db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...params) as { n: number }
    ).n;

    const rows = db
      .prepare(`SELECT t.doc AS doc, p.doc AS person ${from} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as { doc: string; person: string | null }[];

    // How many are in force, whatever the caller is currently looking at, so
    // the screen can offer the other view without a second round trip.
    const active = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM trespasses WHERE location_id = ? AND ${IN_FORCE}`)
        .get(locationId, on) as { n: number }
    ).n;

    res.json({
      total,
      active,
      limit,
      offset,
      rows: rows.map((row): Row & { state: string } => {
        const trespass = JSON.parse(row.doc) as Trespass;
        return {
          trespass,
          person: summarise(row.person ? (JSON.parse(row.person) as MasterPerson) : null),
          state: trespassState(trespass, on),
        };
      }),
    });
  });

  /**
   * Recording one.
   *
   * Open to anyone who writes reports, because the person who needs to record
   * it is whoever took the call — an officer at the scene or a dispatcher on
   * the phone to a shop manager. Making this a supervisor's job is how notices
   * end up on a sticky note instead.
   */
  app.post('/api/trespasses', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const body = req.body ?? {};

    const draft = {
      personId: text(body.personId, 64),
      locationId: text(body.locationId, 64),
      servedOn: day(body.servedOn),
      expiresOn: day(body.expiresOn),
      requestedBy: text(body.requestedBy, 120).trim(),
      requestedByPhone: text(body.requestedByPhone, 40).trim(),
      caseNumber: text(body.caseNumber, 40).trim(),
      notes: text(body.notes, 2000).trim(),
      source: sourceOf(body.source),
    };

    /*
      A blank expiry means indefinite, and a *badly typed* expiry also arrives
      here blank because `day` rejects it. Those are not the same thing, so the
      raw value is checked before it is thrown away — otherwise a mistyped date
      silently becomes a notice that never ends.
    */
    const rawExpiry = text(body.expiresOn, 20).trim();
    if (rawExpiry && !draft.expiresOn) {
      res.status(400).json({
        error: 'That end date is not a date. Use YYYY-MM-DD, or leave it blank for no end date.',
        field: 'expiresOn',
      });
      return;
    }

    const check = checkTrespass(draft);
    if (!check.ok) {
      res.status(400).json({ error: check.reason, field: check.field });
      return;
    }

    if (!people.find(db, draft.personId)) {
      res.status(404).json({ error: 'No such person on file.', field: 'personId' });
      return;
    }
    const place = locations.find(db, draft.locationId);
    if (!place) {
      res.status(404).json({ error: 'No such location on file.', field: 'locationId' });
      return;
    }

    const trespass = createTrespass({
      ...draft,
      id: newId('tr'),
      issuedById: user.id,
      issuedByName: user.name,
    });
    notices.save(db, trespass);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'trespass.recorded',
      target: place.commonName || place.address,
      detail: draft.expiresOn ? `Until ${draft.expiresOn}` : 'No end date',
    });

    /*
      Whether this renewed one already in force. Reported rather than refused:
      a property owner re-serving a notice is normal, and a system that rejects
      the second one sends the dispatcher hunting for the first.
    */
    const existing = existingFor(
      notices.where(db, { person_id: draft.personId }).filter((item) => item.id !== trespass.id),
      draft.personId,
      draft.locationId,
    );

    res.status(201).json({ trespass, renewalOf: existing });
  });

  /**
   * Lifting one early.
   *
   * The same line drawn around withdrawing a location note, for the same
   * reason: an officer records what happened, and undoing somebody else's
   * record is a supervisor's decision. Expiry needs none of this — a notice
   * running out is not a decision anybody makes.
   */
  app.post(
    '/api/trespasses/:id/lift',
    requirePermission('trespass.lift'),
    async (req: Request, res: Response) => {
      const user = req.user!;
      const trespass = notices.find(db, text(req.params.id, 64));
      if (!trespass) {
        res.status(404).json({ error: 'No such notice.' });
        return;
      }
      if (trespass.liftedAt) {
        res.status(409).json({ error: 'That notice has already been lifted.' });
        return;
      }

      const reason = text(req.body?.reason, 500).trim();
      const check = checkLift(reason);
      if (!check.ok) {
        res.status(400).json({ error: check.reason, field: check.field });
        return;
      }

      const now = new Date().toISOString();
      const lifted: Trespass = {
        ...trespass,
        liftedAt: now,
        liftedBy: user.name,
        liftReason: reason,
        updatedAt: now,
      };
      notices.save(db, lifted);

      const place = locations.find(db, trespass.locationId);
      await recordAudit(db, {
        actorId: user.id,
        actorName: user.name,
        action: 'trespass.lifted',
        target: place?.commonName || place?.address || trespass.locationId,
        detail: reason,
      });

      res.json({ trespass: lifted });
    },
  );

  /**
   * Correcting one.
   *
   * Only the fields that are somebody's clerical error — dates, who asked,
   * the note. Never who it is against or where, because changing those turns
   * one person's notice into another's rather than fixing a typo; that is a
   * lift and a fresh notice, which leaves both facts on the record.
   */
  app.patch('/api/trespasses/:id', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const trespass = notices.find(db, text(req.params.id, 64));
    if (!trespass) {
      res.status(404).json({ error: 'No such notice.' });
      return;
    }

    const mine = trespass.issuedById === user.id;
    if (!mine && !can(user, 'trespass.lift')) {
      res.status(403).json({
        error: 'Only the person who recorded this, or a supervisor, can correct it.',
      });
      return;
    }

    const body = req.body ?? {};
    const rawExpiry = text(body.expiresOn, 20).trim();
    const next: Trespass = {
      ...trespass,
      servedOn: body.servedOn === undefined ? trespass.servedOn : day(body.servedOn),
      expiresOn: body.expiresOn === undefined ? trespass.expiresOn : day(body.expiresOn),
      requestedBy:
        body.requestedBy === undefined ? trespass.requestedBy : text(body.requestedBy, 120).trim(),
      requestedByPhone:
        body.requestedByPhone === undefined
          ? trespass.requestedByPhone
          : text(body.requestedByPhone, 40).trim(),
      notes: body.notes === undefined ? trespass.notes : text(body.notes, 2000).trim(),
      updatedAt: new Date().toISOString(),
    };

    if (rawExpiry && !next.expiresOn) {
      res.status(400).json({
        error: 'That end date is not a date. Use YYYY-MM-DD, or leave it blank for no end date.',
        field: 'expiresOn',
      });
      return;
    }

    const check = checkTrespass(next);
    if (!check.ok) {
      res.status(400).json({ error: check.reason, field: check.field });
      return;
    }

    notices.save(db, next);
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'trespass.corrected',
      target: trespass.id,
      detail: next.expiresOn ? `Until ${next.expiresOn}` : 'No end date',
    });

    res.json({ trespass: next });
  });
}
