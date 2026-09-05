/**
 * Board routes.
 *
 * Three rules live here rather than only in the browser, because each is one
 * that a screen alone cannot promise.
 *
 *   **Anybody signed in may post; only some may take down.** The browser hides
 *   the button, which is a courtesy, not a control. This is the control.
 *
 *   **Taking one down is a withdrawal.** The route writes who and why and
 *   leaves the row where it is. There is no delete here, on purpose: the one
 *   occasion anybody asks what a removed BOLO said is after something has gone
 *   wrong, and a row that is gone cannot answer.
 *
 *   **State is never written.** Live, cleared, expired and withdrawn are worked
 *   out from the entry on every read. Nothing here sets a status column and
 *   nothing expires anything on a timer.
 *
 * The posting route is also the seam for the dispatch software. A dispatcher
 * signing in from CAD posts through the same endpoint under their own account,
 * so an entry that arrives from dispatch carries a real name rather than
 * "system", and everything that applies to an officer's post applies to it.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, documents } from './db';
import { newId } from './ids';
import { requireAuth } from './auth';
import { recordAudit } from './audit';
import { can } from '../src/domain/auth';
import {
  blocking,
  createBulletin,
  forBriefing,
  KIND_LABEL,
  state,
  type Bulletin,
  type BulletinKind,
  type BulletinSource,
} from '../src/domain/bulletin';

const bulletins = documents<Bulletin>(DOC_TABLES.bulletins);

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);
const when = (value: unknown): string => {
  const raw = text(value, 40);
  return raw && !Number.isNaN(new Date(raw).getTime()) ? new Date(raw).toISOString() : '';
};

const KINDS: BulletinKind[] = ['bolo', 'attemptToLocate', 'officerSafety', 'information'];
const SOURCES: BulletinSource[] = ['officer', 'dispatch', 'external'];

function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Everything a request is allowed to set. Never the state, never the poster. */
function readInput(body: unknown): Partial<Bulletin> {
  const input = (body ?? {}) as Record<string, unknown>;
  return {
    kind: oneOf(input.kind, KINDS, 'bolo'),
    headline: text(input.headline, 200),
    detail: text(input.detail, 5000),
    lookFor: text(input.lookFor, 2000),
    personId: text(input.personId, 64),
    vehicleId: text(input.vehicleId, 64),
    caseNumber: text(input.caseNumber, 40),
    area: text(input.area, 200),
    contact: text(input.contact, 200),
    originatingAgency: text(input.originatingAgency, 120),
    expiresAt: when(input.expiresAt),
  };
}

export function registerBulletinRoutes(app: Express, db: DatabaseSync): void {
  /**
   * The board.
   *
   * Live by default, because that is what a board is. Everything else is
   * behind `?include=all`, which is how somebody answers "what did that BOLO
   * actually say" three months later.
   */
  app.get('/api/bulletins', requireAuth, (req: Request, res: Response) => {
    const all = bulletins.all(db);
    const now = new Date();
    const include = text(req.query.include, 10);

    if (include === 'all') {
      const sorted = [...all].sort((a, b) => b.postedAt.localeCompare(a.postedAt));
      res.json({
        bulletins: sorted.map((b) => ({ ...b, state: state(b, now) })),
        asOf: now.toISOString(),
      });
      return;
    }

    res.json({
      bulletins: forBriefing(all, now).map((b) => ({ ...b, state: state(b, now) })),
      asOf: now.toISOString(),
    });
  });

  /**
   * Posts one.
   *
   * Refused when the domain says it is not postable, for the same reason a
   * report is refused on the server: the browser is one way in and will not be
   * the only one once dispatch is posting here.
   */
  app.post('/api/bulletins', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    if (!can(user, 'bulletins.post')) {
      res.status(403).json({ error: 'You cannot post to the board.' });
      return;
    }

    const bulletin = createBulletin({
      id: newId('bul'),
      ...readInput(req.body),
      postedById: user.id,
      postedByName: user.name,
      postedAt: new Date().toISOString(),
      source: oneOf(
        (req.body as Record<string, unknown>)?.source,
        SOURCES,
        user.role === 'dispatch' ? 'dispatch' : 'officer',
      ),
    });

    const problems = blocking(bulletin);
    if (problems.length > 0) {
      res.status(400).json({ error: problems[0].message, problems });
      return;
    }

    bulletins.save(db, bulletin);
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'bulletin.posted',
      target: bulletin.id,
      detail: `${KIND_LABEL[bulletin.kind]}: ${bulletin.headline}`,
    });
    res.status(201).json({ bulletin });
  });

  /**
   * Edits one, while it is still yours to edit.
   *
   * The poster, or somebody who could take it down anyway. A description that
   * turns out to have been a blue van rather than a black one has to be
   * fixable by the officer who posted it, in the ten minutes when it matters,
   * without finding a supervisor.
   */
  app.patch('/api/bulletins/:id', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const existing = bulletins.find(db, req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'No such bulletin.' });
      return;
    }
    if (existing.postedById !== user.id && !can(user, 'bulletins.remove')) {
      res.status(403).json({ error: 'Only whoever posted this can change it.' });
      return;
    }
    if (existing.removed) {
      res.status(400).json({ error: 'This has been taken off the board.' });
      return;
    }

    const updated: Bulletin = { ...existing, ...readInput(req.body) };
    const problems = blocking(updated);
    if (problems.length > 0) {
      res.status(400).json({ error: problems[0].message, problems });
      return;
    }

    bulletins.save(db, updated);
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'bulletin.edited',
      target: updated.id,
      detail: updated.headline,
    });
    res.json({ bulletin: updated });
  });

  /**
   * It is over — the car was found, the child came home.
   *
   * Open to whoever posted it and to anybody who may take one down. Clearing
   * is not an administrative act: it is the outcome, and the officer who found
   * the car is the person who knows. It says who and why, and the entry stays
   * readable as a thing that happened.
   */
  app.post('/api/bulletins/:id/clear', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const existing = bulletins.find(db, req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'No such bulletin.' });
      return;
    }
    if (existing.postedById !== user.id && !can(user, 'bulletins.remove')) {
      res.status(403).json({ error: 'Only whoever posted this, or dispatch, can clear it.' });
      return;
    }
    if (existing.cleared) {
      res.status(400).json({ error: 'This has already been cleared.' });
      return;
    }

    const reason = text((req.body as Record<string, unknown>)?.reason, 400).trim();
    if (!reason) {
      res.status(400).json({
        error: 'Say what happened — found, arrested, called off. The next person to read this needs to know how it ended.',
      });
      return;
    }

    const updated: Bulletin = {
      ...existing,
      cleared: { at: new Date().toISOString(), byId: user.id, byName: user.name, reason },
    };
    bulletins.save(db, updated);
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'bulletin.cleared',
      target: updated.id,
      detail: `${updated.headline} — ${reason}`,
    });
    res.json({ bulletin: updated });
  });

  /**
   * Takes it off the board.
   *
   * Administrators and dispatch. Withdrawal, not deletion — the row stays, with
   * a name and a reason against it, and the audit entry records that it
   * happened. Nobody asks about a removed BOLO until something has gone wrong.
   */
  app.post('/api/bulletins/:id/remove', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    if (!can(user, 'bulletins.remove')) {
      res.status(403).json({
        error: 'Only an administrator or dispatch can take something off the board. You can clear it if it is over.',
      });
      return;
    }

    const existing = bulletins.find(db, req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'No such bulletin.' });
      return;
    }
    if (existing.removed) {
      res.status(400).json({ error: 'This is already off the board.' });
      return;
    }

    const reason = text((req.body as Record<string, unknown>)?.reason, 400).trim();
    if (!reason) {
      res.status(400).json({ error: 'Say why this is coming down.' });
      return;
    }

    const updated: Bulletin = {
      ...existing,
      removed: { at: new Date().toISOString(), byId: user.id, byName: user.name, reason },
    };
    bulletins.save(db, updated);
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'bulletin.removed',
      target: updated.id,
      detail: `${updated.headline} — ${reason}`,
    });
    res.json({ bulletin: updated });
  });
}
