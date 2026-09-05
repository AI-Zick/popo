/**
 * Roster routes.
 *
 * One sheet per shift, keyed on the instant that shift began. Two rules live
 * here rather than only in the browser.
 *
 *   **One line-up per shift.** The table is unique on the shift's start, and
 *   the write is an upsert against that key rather than an insert. Two
 *   sergeants opening the briefing at changeover is the ordinary case, not the
 *   race condition, and the failure mode without this is two rosters for one
 *   night with nothing to say which is real.
 *
 *   **Reading is open, writing is not.** Everybody signed in can see who else
 *   is out there — that is the fact a briefing exists to convey. Setting it
 *   belongs to whoever holds the line-up, which is a sergeant or dispatch.
 *
 * The domain checks the sheet, and the route saves it anyway unless something
 * makes it meaningless. A roster is filled in at changeover by somebody
 * already late; a form that refuses because two officers are in one car is a
 * form they abandon for the whiteboard it replaced.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, documents } from './db';
import { newId } from './ids';
import { requireAuth } from './auth';
import { recordAudit } from './audit';
import { can } from '../src/domain/auth';
import {
  blockingProblems,
  check,
  createEntry,
  createRoster,
  onDuty,
  startFrom,
  type Roster,
  type RosterEntry,
  type Standing,
} from '../src/domain/roster';
import type { Cruiser } from '../src/domain/fleet';

const rosters = documents<Roster>(DOC_TABLES.rosters);
const cruisers = documents<Cruiser>(DOC_TABLES.cruisers);

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);

const STANDINGS: Standing[] = ['on', 'off', 'leave', 'training', 'court'];

/** An instant, or nothing. A roster keyed on an unparseable string is lost. */
function when(value: unknown): string {
  const raw = text(value, 40);
  if (!raw) return '';
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? '' : at.toISOString();
}

/**
 * What the fleet says is off the road, by unit number.
 *
 * Read here rather than sent by the browser, for the same reason every other
 * check is: a client that tells the server what the fleet says is a client
 * that can tell it anything.
 */
function outOfService(db: DatabaseSync): Record<string, string> {
  const out: Record<string, string> = {};
  for (const cruiser of cruisers.all(db)) {
    if (cruiser.status !== 'inService' && cruiser.unit) {
      out[cruiser.unit] = cruiser.statusNote || 'Marked out of service in the fleet.';
    }
  }
  return out;
}

/** Everything a request may set on one line. Never who saved it, never when. */
function readEntry(raw: unknown): RosterEntry {
  const input = (raw ?? {}) as Record<string, unknown>;
  const standing = text(input.standing, 20) as Standing;
  return createEntry({
    id: text(input.id, 64) || newId('rse'),
    officerId: text(input.officerId, 64),
    officerName: text(input.officerName, 120),
    badge: text(input.badge, 20),
    beat: text(input.beat, 40),
    vehicle: text(input.vehicle, 40),
    cruiserId: text(input.cruiserId, 64),
    callSign: text(input.callSign, 40),
    standing: STANDINGS.includes(standing) ? standing : 'on',
    note: text(input.note, 500),
  });
}

function readEntries(raw: unknown): RosterEntry[] {
  // Capped, because a roster is a shift's worth of people and anything past
  // this is somebody's script rather than an agency.
  return Array.isArray(raw) ? raw.slice(0, 200).map(readEntry) : [];
}

function find(db: DatabaseSync, shiftStart: string): Roster | null {
  return rosters.all(db).find((r) => r.shiftStart === shiftStart) ?? null;
}

export function registerRosterRoutes(app: Express, db: DatabaseSync): void {
  /**
   * The line-up for one shift.
   *
   * Answers with the sheet if there is one, and with the previous sheet for
   * the same shift name as a starting point if there is not — marked as a
   * suggestion, never saved on the strength of a read. A sergeant should open
   * the briefing to last week's squad already filled in and correct three
   * lines, rather than typing twelve into an empty form every eight hours.
   */
  app.get('/api/roster', requireAuth, (req: Request, res: Response) => {
    const shiftStart = when(req.query.shiftStart);
    if (!shiftStart) {
      res.status(400).json({ error: 'Say which shift, as an instant its start falls on.' });
      return;
    }
    const shiftName = text(req.query.shiftName, 40);

    const existing = find(db, shiftStart);
    if (existing) {
      res.json({ roster: existing, suggested: false, problems: check(existing, { outOfService: outOfService(db) }) });
      return;
    }

    /*
      The last sheet written for a shift of this name. By shift start
      descending rather than by when it was saved: a sergeant correcting a
      roster from three days ago must not turn it into the template for
      tonight.
    */
    const previous = rosters
      .all(db)
      .filter((r) => r.shiftName === shiftName && r.shiftStart < shiftStart)
      .sort((a, b) => b.shiftStart.localeCompare(a.shiftStart))[0];

    res.json({
      roster: startFrom(previous ?? null, shiftStart, shiftName),
      suggested: Boolean(previous),
      problems: [],
    });
  });

  /**
   * Writes one, replacing whatever was there.
   *
   * A whole sheet rather than a line at a time, because that is how somebody
   * edits it: they look at twelve rows, change three, and press save once.
   * Patching rows individually would mean a half-applied roster whenever a
   * connection drops in the middle, and half a line-up is worse than none.
   */
  app.put('/api/roster', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    if (!can(user, 'roster.set')) {
      res.status(403).json({ error: 'You cannot set the shift roster.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const shiftStart = when(body.shiftStart);
    if (!shiftStart) {
      res.status(400).json({ error: 'Say which shift this roster is for.' });
      return;
    }

    const existing = find(db, shiftStart);
    const roster = createRoster({
      // Keeps the row's identity so the unique index on the shift is an
      // update rather than a collision.
      id: existing?.id ?? newId('ros'),
      shiftStart,
      shiftName: text(body.shiftName, 40),
      entries: readEntries(body.entries),
      updatedById: user.id,
      updatedByName: user.name,
      updatedAt: new Date().toISOString(),
    });

    const problems = check(roster, { outOfService: outOfService(db) });
    const blocking = blockingProblems(problems);
    if (blocking.length > 0) {
      res.status(400).json({ error: blocking[0].message, problems });
      return;
    }

    rosters.save(db, roster);
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'roster.set',
      target: roster.id,
      detail: `${roster.shiftName || 'Shift'} starting ${roster.shiftStart}: ${
        onDuty(roster).length
      } on duty of ${roster.entries.length} listed`,
    });

    res.json({ roster, suggested: false, problems });
  });
}
