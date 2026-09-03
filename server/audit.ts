/**
 * Server-side audit writing.
 *
 * The client can no longer write to the log. Entries are produced here, from
 * the session the server resolved, so an actor name is something the server
 * knows rather than something the request claimed.
 *
 * Appends are serialised through a single promise chain because the hash of
 * each entry depends on the one before it: two concurrent requests appending
 * from the same tail would fork the chain and every later verification would
 * fail.
 */

import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { sealEntry, verifyChain, type AuditDraft, type AuditEntry } from '../src/domain/audit';

let queue: Promise<unknown> = Promise.resolve();

function readTailHash(db: DatabaseSync): string {
  const row = db.prepare('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1').get() as
    | { hash: string }
    | undefined;
  return row?.hash ?? '';
}

export function readAuditLog(db: DatabaseSync, limit = 1000): AuditEntry[] {
  const rows = db
    .prepare('SELECT * FROM audit_log ORDER BY seq ASC LIMIT ?')
    .all(limit) as Record<string, string>[];
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action as AuditEntry['action'],
    target: row.target,
    detail: row.detail,
    prevHash: row.prev_hash,
    hash: row.hash,
    // Absent on every ordinary entry, so `isRedacted` stays false rather than
    // reading an empty string as a redaction.
    ...(row.redacted_by ? { redactedBy: row.redacted_by, redactedAt: row.redacted_at } : {}),
  }));
}

export function recordAudit(db: DatabaseSync, draft: AuditDraft): Promise<AuditEntry> {
  const run = queue.then(async () => {
    const entry = await sealEntry({
      ...draft,
      id: randomBytes(12).toString('hex'),
      at: new Date().toISOString(),
      prevHash: readTailHash(db),
    });

    db.prepare(
      `INSERT INTO audit_log (id, at, actor_id, actor_name, action, target, detail, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.id,
      entry.at,
      entry.actorId,
      entry.actorName,
      entry.action,
      entry.target,
      entry.detail,
      entry.prevHash,
      entry.hash,
    );

    return entry;
  });

  // Keep the chain going even if one append fails.
  queue = run.catch(() => undefined);
  return run;
}

export function verifyAuditLog(db: DatabaseSync) {
  return verifyChain(readAuditLog(db, 100_000));
}
