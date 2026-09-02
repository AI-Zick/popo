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
  case_number TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft',
  reported_at TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  doc         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS incidents_case ON incidents(case_number);

CREATE TABLE IF NOT EXISTS people (
  id          TEXT PRIMARY KEY,
  last_name   TEXT NOT NULL DEFAULT '',
  first_name  TEXT NOT NULL DEFAULT '',
  dob         TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  doc         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS people_name ON people(last_name, first_name);

CREATE TABLE IF NOT EXISTS locations (
  id          TEXT PRIMARY KEY,
  address     TEXT NOT NULL DEFAULT '',
  common_name TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  doc         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS locations_address ON locations(address);
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
  name: 'incidents' | 'people' | 'locations';
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
