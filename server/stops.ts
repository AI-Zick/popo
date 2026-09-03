/**
 * Traffic stop routes.
 *
 * A stop is a record of what one officer did, so authorship comes from the
 * session and an officer edits only their own. Supervisors can read everyone's,
 * because that is the entire point of the activity report.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, documents } from './db';
import { newId } from './ids';
import { requireAuth } from './auth';
import { checkStop, createTrafficStop, type TrafficStop } from '../src/domain/activity';

const stops = documents<TrafficStop>(DOC_TABLES.stops);

/** Only the fields an officer owns. Authorship is not among them. */
function merge(current: TrafficStop, patch: Partial<TrafficStop>): TrafficStop {
  return {
    ...current,
    at: typeof patch.at === 'string' ? patch.at : current.at,
    location: String(patch.location ?? current.location).slice(0, 300),
    beat: String(patch.beat ?? current.beat).slice(0, 40),
    reason: patch.reason ?? current.reason,
    outcome: patch.outcome ?? current.outcome,
    citations: Array.isArray(patch.citations)
      ? patch.citations.slice(0, 20).map((c, i) => ({
          id: c.id || newId(`cit${i}`),
          statute: String(c.statute ?? '').slice(0, 60),
          description: String(c.description ?? '').slice(0, 200),
          warningOnly: Boolean(c.warningOnly),
        }))
      : current.citations,
    plate: String(patch.plate ?? current.plate).toUpperCase().slice(0, 12),
    plateState: String(patch.plateState ?? current.plateState).slice(0, 2),
    incidentId: typeof patch.incidentId === 'string' ? patch.incidentId : current.incidentId,
    notes: String(patch.notes ?? current.notes).slice(0, 2000),
    updatedAt: new Date().toISOString(),
  };
}

export function registerStopRoutes(app: Express, db: DatabaseSync): void {
  app.post('/api/stops', requireAuth, (req: Request, res: Response) => {
    const user = req.user!;
    const doc = merge(
      createTrafficStop({
        id: newId('stop'),
        // From the session, never from the request.
        officerId: user.id,
        officerName: user.name,
      }),
      (req.body ?? {}) as Partial<TrafficStop>,
    );

    const problems = checkStop(doc);
    if (problems.length > 0) {
      res.status(400).json({ error: problems[0], problems });
      return;
    }

    stops.save(db, doc);
    res.json({ ok: true, stop: doc });
  });

  app.put('/api/stops/:id', requireAuth, (req: Request, res: Response) => {
    const user = req.user!;
    const current = stops.find(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: 'No such stop.' });
      return;
    }
    if (current.officerId !== user.id) {
      // A stop is a statement about what one officer did. Nobody else edits it.
      res.status(403).json({ error: 'That stop belongs to another officer.' });
      return;
    }

    const doc = merge(current, (req.body ?? {}) as Partial<TrafficStop>);
    const problems = checkStop(doc);
    if (problems.length > 0) {
      res.status(400).json({ error: problems[0], problems });
      return;
    }
    stops.save(db, doc);
    res.json({ ok: true, stop: doc });
  });

  app.delete('/api/stops/:id', requireAuth, (req: Request, res: Response) => {
    const user = req.user!;
    const current = stops.find(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: 'No such stop.' });
      return;
    }
    if (current.officerId !== user.id) {
      res.status(403).json({ error: 'That stop belongs to another officer.' });
      return;
    }
    db.prepare('DELETE FROM stops WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });
}
