/**
 * Record routes: per-record writes with optimistic concurrency, and advisory
 * edit locks.
 *
 * Two mechanisms, doing different jobs:
 *
 *  - **Versions** are correctness. A write carries the version the client was
 *    working from; if the stored version has moved on, the write is refused and
 *    the current record comes back. Nothing is ever silently overwritten.
 *
 *  - **Locks** are courtesy. They tell an officer that somebody else is already
 *    in this report, before both spend twenty minutes writing it. They are
 *    deliberately breakable: a lock nobody can clear is a lock that strands a
 *    case when its holder goes home with the laptop.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, deleteDoc, readDoc, writeDoc } from './db';
import { requireAuth } from './auth';

/** A lock not refreshed within this window is treated as abandoned. */
export const LOCK_TTL_MS = 90_000;

export interface LockHolder {
  userId: string;
  userName: string;
  acquiredAt: string;
  refreshedAt: string;
}

function readLock(db: DatabaseSync, resourceId: string): LockHolder | null {
  const row = db.prepare('SELECT * FROM edit_locks WHERE resource_id = ?').get(resourceId) as
    | Record<string, string>
    | undefined;
  if (!row) return null;
  if (Date.now() - new Date(row.refreshed_at).getTime() > LOCK_TTL_MS) {
    db.prepare('DELETE FROM edit_locks WHERE resource_id = ?').run(resourceId);
    return null;
  }
  return {
    userId: row.user_id,
    userName: row.user_name,
    acquiredAt: row.acquired_at,
    refreshedAt: row.refreshed_at,
  };
}

export function listLocks(db: DatabaseSync): Record<string, LockHolder> {
  const rows = db.prepare('SELECT * FROM edit_locks').all() as unknown as Record<string, string>[];
  const cutoff = Date.now() - LOCK_TTL_MS;
  const held: Record<string, LockHolder> = {};
  for (const row of rows) {
    if (new Date(row.refreshed_at).getTime() < cutoff) continue;
    held[row.resource_id] = {
      userId: row.user_id,
      userName: row.user_name,
      acquiredAt: row.acquired_at,
      refreshedAt: row.refreshed_at,
    };
  }
  return held;
}

export function registerRecordRoutes(app: Express, db: DatabaseSync): void {
  /**
   * Writes one record. `version` is what the client last saw; omit it only
   * when creating something new.
   */
  app.put('/api/records/:collection/:id', requireAuth, (req: Request, res: Response) => {
    const table = DOC_TABLES[req.params.collection];
    if (!table) {
      res.status(404).json({ error: 'Unknown collection.' });
      return;
    }

    const { doc, version } = req.body ?? {};
    if (!doc || typeof doc !== 'object') {
      res.status(400).json({ error: 'Expected { doc, version }.' });
      return;
    }
    if (String(doc.id) !== req.params.id) {
      res.status(400).json({ error: 'Record id does not match the URL.' });
      return;
    }

    const expected = typeof version === 'number' ? version : null;
    const outcome = writeDoc(db, table, doc as Record<string, unknown>, expected);

    if (!outcome.ok) {
      const holder = readLock(db, req.params.id);
      res.status(409).json({
        error: holder
          ? `${holder.userName} saved changes to this record while you were working on it.`
          : 'Someone else saved changes to this record while you were working on it.',
        current: outcome.conflict.doc,
        currentVersion: outcome.conflict.version,
      });
      return;
    }

    res.json({ ok: true, version: outcome.version });
  });

  app.delete('/api/records/:collection/:id', requireAuth, (req: Request, res: Response) => {
    const table = DOC_TABLES[req.params.collection];
    if (!table) {
      res.status(404).json({ error: 'Unknown collection.' });
      return;
    }
    deleteDoc(db, table, req.params.id);
    db.prepare('DELETE FROM edit_locks WHERE resource_id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/records/:collection/:id', requireAuth, (req: Request, res: Response) => {
    const table = DOC_TABLES[req.params.collection];
    if (!table) {
      res.status(404).json({ error: 'Unknown collection.' });
      return;
    }
    const stored = readDoc(db, table, req.params.id);
    if (!stored) {
      res.status(404).json({ error: 'No such record.' });
      return;
    }
    res.json(stored);
  });

  /* ---- Locks --------------------------------------------------------- */

  app.get('/api/locks', requireAuth, (_req: Request, res: Response) => {
    res.json({ locks: listLocks(db) });
  });

  /**
   * Acquires or refreshes a lock. Refreshing your own always succeeds; taking
   * one held by someone else needs `takeover`, so it is a decision rather than
   * an accident.
   */
  app.post('/api/locks/:id', requireAuth, (req: Request, res: Response) => {
    const user = req.user!;
    const now = new Date().toISOString();
    const existing = readLock(db, req.params.id);

    if (existing && existing.userId !== user.id && !req.body?.takeover) {
      res.status(409).json({
        error: `${existing.userName} is editing this record.`,
        holder: existing,
      });
      return;
    }

    db.prepare(
      `INSERT INTO edit_locks (resource_id, user_id, user_name, acquired_at, refreshed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(resource_id) DO UPDATE SET
         user_id = excluded.user_id,
         user_name = excluded.user_name,
         acquired_at = CASE WHEN edit_locks.user_id = excluded.user_id
                            THEN edit_locks.acquired_at ELSE excluded.acquired_at END,
         refreshed_at = excluded.refreshed_at`,
    ).run(req.params.id, user.id, user.name, now, now);

    res.json({ ok: true, tookOver: Boolean(existing && existing.userId !== user.id) });
  });

  app.delete('/api/locks/:id', requireAuth, (req: Request, res: Response) => {
    const user = req.user!;
    // Only the holder releases; otherwise a stale client could free someone
    // else's lock as it shuts down.
    db.prepare('DELETE FROM edit_locks WHERE resource_id = ? AND user_id = ?').run(
      req.params.id,
      user.id,
    );
    res.json({ ok: true });
  });
}
