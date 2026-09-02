/**
 * Database. SQLite through Node's built-in driver, so there is no native
 * dependency to compile and no service to run alongside the app.
 *
 * Records that are read by shape — users, credentials, sessions, audit — get
 * real columns. Records that are only ever fetched whole and searched
 * loosely — incidents, people, locations — are stored as JSON documents with
 * the few columns needed to find them. That is a deliberate stage-appropriate
 * choice: the domain model is still moving, and a schema migration per field
 * would slow that down. The columns to promote are the ones the search queries
 * below already name.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agency (
  id          TEXT PRIMARY KEY,
  doc         TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  badge         TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL,
  grants        TEXT NOT NULL DEFAULT '[]',
  revocations   TEXT NOT NULL DEFAULT '[]',
  active        INTEGER NOT NULL DEFAULT 1,
  deactivated_at TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL DEFAULT ''
);

-- Kept apart from users so a query for a roster cannot accidentally select a
-- password hash into a response body.
CREATE TABLE IF NOT EXISTS credentials (
  user_id             TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash       TEXT NOT NULL DEFAULT '',
  must_change         INTEGER NOT NULL DEFAULT 1,
  failed_attempts     INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT NOT NULL DEFAULT '',
  last_sign_in_at     TEXT NOT NULL DEFAULT '',
  password_changed_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- Append-only. Nothing in the server ever issues UPDATE or DELETE here.
CREATE TABLE IF NOT EXISTS audit_log (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  id         TEXT NOT NULL UNIQUE,
  at         TEXT NOT NULL,
  actor_id   TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '',
  prev_hash  TEXT NOT NULL DEFAULT '',
  hash       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_at ON audit_log(at);

CREATE TABLE IF NOT EXISTS incidents (
  id          TEXT PRIMARY KEY,
  version     INTEGER NOT NULL DEFAULT 1,
  case_number TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft',
  reported_at TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  doc         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS incidents_case ON incidents(case_number);

-- Follow-up reports. A supplement never edits the report it hangs from; it is
-- its own document, with its own author and its own review.
CREATE TABLE IF NOT EXISTS supplements (
  id          TEXT PRIMARY KEY,
  version     INTEGER NOT NULL DEFAULT 1,
  case_id     TEXT NOT NULL DEFAULT '',
  case_number TEXT NOT NULL DEFAULT '',
  number      INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'draft',
  updated_at  TEXT NOT NULL,
  doc         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS supplements_case ON supplements(case_id, number);

CREATE TABLE IF NOT EXISTS people (
  id          TEXT PRIMARY KEY,
  version     INTEGER NOT NULL DEFAULT 1,
  last_name   TEXT NOT NULL DEFAULT '',
  first_name  TEXT NOT NULL DEFAULT '',
  dob         TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  doc         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS people_name ON people(last_name, first_name);

CREATE TABLE IF NOT EXISTS locations (
  id          TEXT PRIMARY KEY,
  version     INTEGER NOT NULL DEFAULT 1,
  address     TEXT NOT NULL DEFAULT '',
  common_name TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  doc         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS locations_address ON locations(address);

-- Attachments. The bytes live on disk; this is the record of custody.
CREATE TABLE IF NOT EXISTS attachments (
  id           TEXT PRIMARY KEY,
  incident_id  TEXT NOT NULL,
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  -- Hashed on ingest. If the stored bytes ever stop matching this, the file
  -- has been altered since it was taken into evidence.
  sha256       TEXT NOT NULL,
  caption      TEXT NOT NULL DEFAULT '',
  uploaded_by  TEXT NOT NULL,
  uploaded_by_name TEXT NOT NULL,
  uploaded_at  TEXT NOT NULL,
  -- Withdrawn, never deleted — same reasoning as location notes.
  retracted_at TEXT NOT NULL DEFAULT '',
  retracted_by TEXT NOT NULL DEFAULT '',
  retraction_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS attachments_incident ON attachments(incident_id);

-- Advisory only. A lock says "somebody is in here" so two officers do not
-- unknowingly work the same report; it does not prevent a write, because a
-- lock that cannot be broken becomes a lock nobody can clear at 3am when its
-- holder has gone home with the laptop.
CREATE TABLE IF NOT EXISTS edit_locks (
  resource_id TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  user_name   TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  refreshed_at TEXT NOT NULL
);
`;

export type Row = Record<string, unknown>;

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

/* ------------------------------------------------------------------ */
/* Document helpers                                                    */
/* ------------------------------------------------------------------ */

export interface DocTable {
  name: 'incidents' | 'people' | 'locations' | 'supplements';
  /** Columns lifted out of the document so they can be indexed. */
  columns: (doc: Record<string, unknown>) => Record<string, string>;
}

export const DOC_TABLES: Record<string, DocTable> = {
  incidents: {
    name: 'incidents',
    columns: (doc) => ({
      case_number: String(doc.caseNumber ?? ''),
      status: String(doc.status ?? 'draft'),
      reported_at: String(doc.reportedAt ?? ''),
    }),
  },
  supplements: {
    name: 'supplements',
    columns: (doc) => ({
      case_id: String(doc.caseId ?? ''),
      case_number: String(doc.caseNumber ?? ''),
      number: String(doc.number ?? 1),
      status: String(doc.status ?? 'draft'),
    }),
  },
  people: {
    name: 'people',
    columns: (doc) => ({
      last_name: String(doc.lastName ?? ''),
      first_name: String(doc.firstName ?? ''),
      dob: String(doc.dob ?? ''),
    }),
  },
  locations: {
    name: 'locations',
    columns: (doc) => ({
      address: String(doc.address ?? ''),
      common_name: String(doc.commonName ?? ''),
    }),
  },
};

export function readDocs(db: DatabaseSync, table: DocTable): Record<string, unknown>[] {
  const rows = db.prepare(`SELECT doc FROM ${table.name}`).all() as { doc: string }[];
  return rows.map((row) => JSON.parse(row.doc));
}

export interface StoredDoc {
  doc: Record<string, unknown>;
  version: number;
}

export function readDocsWithVersions(db: DatabaseSync, table: DocTable): StoredDoc[] {
  const rows = db.prepare(`SELECT doc, version FROM ${table.name}`).all() as unknown as {
    doc: string;
    version: number;
  }[];
  return rows.map((row) => ({ doc: JSON.parse(row.doc), version: row.version }));
}

export function readDoc(db: DatabaseSync, table: DocTable, id: string): StoredDoc | null {
  const row = db.prepare(`SELECT doc, version FROM ${table.name} WHERE id = ?`).get(id) as unknown as
    | { doc: string; version: number }
    | undefined;
  return row ? { doc: JSON.parse(row.doc), version: row.version } : null;
}

export type WriteOutcome =
  | { ok: true; version: number }
  | { ok: false; conflict: StoredDoc };

/**
 * Writes one record, but only if the caller was working from the version that
 * is currently stored. Two officers editing the same report used to mean the
 * slower save silently erased the faster one; now the second writer is told,
 * and gets the current record back to reconcile against.
 */
export function writeDoc(
  db: DatabaseSync,
  table: DocTable,
  doc: Record<string, unknown>,
  expectedVersion: number | null,
): WriteOutcome {
  const id = String(doc.id ?? '');
  const existing = readDoc(db, table, id);

  if (existing && expectedVersion !== null && existing.version !== expectedVersion) {
    return { ok: false, conflict: existing };
  }

  const version = (existing?.version ?? 0) + 1;
  const columns = table.columns(doc);
  const names = Object.keys(columns);
  const assignments = names.map((c) => `${c} = ?`).join(', ');

  if (existing) {
    db.prepare(
      `UPDATE ${table.name} SET version = ?, ${assignments}, updated_at = ?, doc = ? WHERE id = ?`,
    ).run(
      version,
      ...names.map((c) => columns[c] ?? ''),
      String(doc.updatedAt ?? new Date().toISOString()),
      JSON.stringify(doc),
      id,
    );
  } else {
    db.prepare(
      `INSERT INTO ${table.name} (id, version, ${names.join(', ')}, updated_at, doc)
       VALUES (${['?', '?', ...names.map(() => '?'), '?', '?'].join(', ')})`,
    ).run(
      id,
      version,
      ...names.map((c) => columns[c] ?? ''),
      String(doc.updatedAt ?? new Date().toISOString()),
      JSON.stringify(doc),
    );
  }

  return { ok: true, version };
}

export function deleteDoc(db: DatabaseSync, table: DocTable, id: string): void {
  db.prepare(`DELETE FROM ${table.name} WHERE id = ?`).run(id);
}

/**
 * Seed-time bulk insert. Not reachable from the API — every runtime write goes
 * through `writeDoc` so it is version-checked.
 */
/**
 * Replaces the whole collection in one transaction. The client currently
 * writes through whole collections; when it moves to per-record calls this is
 * the function that gets replaced, not the schema.
 */
export function writeDocs(
  db: DatabaseSync,
  table: DocTable,
  docs: Record<string, unknown>[],
): void {
  const now = new Date().toISOString();
  const columnNames = Object.keys(table.columns(docs[0] ?? {}));
  const placeholders = ['?', ...columnNames.map(() => '?'), '?', '?'].join(', ');
  const insert = db.prepare(
    `INSERT INTO ${table.name} (id, ${columnNames.join(', ')}, updated_at, doc) VALUES (${placeholders})`,
  );

  db.exec('BEGIN');
  try {
    db.exec(`DELETE FROM ${table.name}`);
    for (const doc of docs) {
      const columns = table.columns(doc);
      insert.run(
        String(doc.id ?? ''),
        ...columnNames.map((c) => columns[c] ?? ''),
        String(doc.updatedAt ?? now),
        JSON.stringify(doc),
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
