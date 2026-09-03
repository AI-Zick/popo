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

-- Traffic stops. Most produce no report, so without their own record an
-- officer who spent the night on traffic shows as having done nothing.
CREATE TABLE IF NOT EXISTS stops (
  id          TEXT PRIMARY KEY,
  version     INTEGER NOT NULL DEFAULT 1,
  officer_id  TEXT NOT NULL DEFAULT '',
  at          TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  doc         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stops_officer ON stops(officer_id, at);

-- Crash reports. A separate document from an incident report: different
-- fields, a different state file, and a different reader.
CREATE TABLE IF NOT EXISTS crashes (
  id          TEXT PRIMARY KEY,
  version     INTEGER NOT NULL DEFAULT 1,
  case_number TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft',
  occurred_at TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  doc         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS crashes_case ON crashes(case_number);

-- Returns from CAD, the MDT and the registries. Stored as they arrived: they
-- are evidence of what was known when, not just a convenience.
CREATE TABLE IF NOT EXISTS returns (
  id           TEXT PRIMARY KEY,
  version      INTEGER NOT NULL DEFAULT 1,
  call_number  TEXT NOT NULL DEFAULT '',
  officer_id   TEXT NOT NULL DEFAULT '',
  received_at  TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL,
  doc          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS returns_call ON returns(call_number, received_at);
CREATE INDEX IF NOT EXISTS returns_officer ON returns(officer_id, received_at);

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

-- Feedback and feature suggestions on their way to the vendor. Kept in the
-- agency's own database, not the vendor's, so an agency can always see and
-- audit everything its officers have sent outside the building.
CREATE TABLE IF NOT EXISTS feedback (
  id           TEXT PRIMARY KEY,
  version      INTEGER NOT NULL DEFAULT 1,
  status       TEXT NOT NULL DEFAULT 'new',
  submitted_by TEXT NOT NULL DEFAULT '',
  at           TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL,
  doc          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_status ON feedback(status, at);
-- One person's own items, for the per-day limit on submitting.
CREATE INDEX IF NOT EXISTS feedback_submitter ON feedback(submitted_by, at);

-- Arrests. Its own document rather than a role on a report: an arrest outlives
-- the report it came from, travels to a court, and carries a disposition for
-- years afterwards. The NIBRS arrestee segment is still derived from the
-- incident's own people, so the submission is unchanged by this table.
CREATE TABLE IF NOT EXISTS arrests (
  id            TEXT PRIMARY KEY,
  version       INTEGER NOT NULL DEFAULT 1,
  arrest_number TEXT NOT NULL DEFAULT '',
  case_id       TEXT NOT NULL DEFAULT '',
  master_id     TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'draft',
  arrested_at   TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL,
  doc           TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS arrests_number ON arrests(arrest_number);
CREATE INDEX IF NOT EXISTS arrests_case ON arrests(case_id);
-- One person's history at this agency, which is the other way it is read.
CREATE INDEX IF NOT EXISTS arrests_person ON arrests(master_id, arrested_at);

-- The fleet. A cruiser is not a document — nothing is submitted or approved —
-- so these tables are plain records with their own small rules.
CREATE TABLE IF NOT EXISTS cruisers (
  id         TEXT PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 1,
  unit       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'inService',
  updated_at TEXT NOT NULL,
  doc        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cruisers_unit ON cruisers(unit);

-- One completed daily check. Append-only in practice: there is no route that
-- edits one, because a signed statement that a car was fine is exactly the
-- thing nobody should be able to revise after the crash.
CREATE TABLE IF NOT EXISTS cruiser_checks (
  id         TEXT PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 1,
  cruiser_id TEXT NOT NULL DEFAULT '',
  officer_id TEXT NOT NULL DEFAULT '',
  at         TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  doc        TEXT NOT NULL
);
-- "Has this car been checked today", which is how the list is read.
CREATE INDEX IF NOT EXISTS cruiser_checks_car ON cruiser_checks(cruiser_id, at);

CREATE TABLE IF NOT EXISTS maintenance_requests (
  id         TEXT PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 1,
  number     TEXT NOT NULL DEFAULT '',
  cruiser_id TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open',
  updated_at TEXT NOT NULL,
  doc        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_number ON maintenance_requests(number);
-- The supervisor's queue, and one car's history.
CREATE INDEX IF NOT EXISTS maintenance_status ON maintenance_requests(status);
CREATE INDEX IF NOT EXISTS maintenance_car ON maintenance_requests(cruiser_id);

-- Photographs of a person, hanging off the identity rather than a case: a face
-- outlives the report it was taken on. Bytes live on disk beside the
-- attachments, for the same reason.
CREATE TABLE IF NOT EXISTS person_photos (
  id         TEXT PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 1,
  master_id  TEXT NOT NULL DEFAULT '',
  taken_on   TEXT NOT NULL DEFAULT '',
  removal    TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  doc        TEXT NOT NULL
);
-- Every photograph of one person, newest likeness first.
CREATE INDEX IF NOT EXISTS person_photos_master ON person_photos(master_id, taken_on);
-- The takedown queue, which is read on its own.
CREATE INDEX IF NOT EXISTS person_photos_removal ON person_photos(removal);

-- What is left to do on a case. Deliberately not part of the report document:
-- an approved report is locked, and "still waiting on the video" is exactly the
-- item that outlives approval.
CREATE TABLE IF NOT EXISTS case_tasks (
  id          TEXT PRIMARY KEY,
  version     INTEGER NOT NULL DEFAULT 1,
  case_id     TEXT NOT NULL DEFAULT '',
  assigned_to TEXT NOT NULL DEFAULT '',
  done        TEXT NOT NULL DEFAULT '0',
  updated_at  TEXT NOT NULL,
  doc         TEXT NOT NULL
);
-- The whole list for one case, which is the only way it is read.
CREATE INDEX IF NOT EXISTS case_tasks_case ON case_tasks(case_id, done);
-- One officer's own open items, across every case they are on.
CREATE INDEX IF NOT EXISTS case_tasks_assignee ON case_tasks(assigned_to, done);

-- Physical custody of a thing, from the scene to the shelf to its disposal.
-- Distinct from the property listed on a report, which is the NIBRS view of
-- what was taken; this is the object itself.
CREATE TABLE IF NOT EXISTS evidence (
  id          TEXT PRIMARY KEY,
  version     INTEGER NOT NULL DEFAULT 1,
  tag_number  TEXT NOT NULL DEFAULT '',
  case_id     TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  doc         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS evidence_tag ON evidence(tag_number);
CREATE INDEX IF NOT EXISTS evidence_case ON evidence(case_id);

-- The chain of custody. Its own table rather than a document table, because a
-- document table can be updated and this must not be: every row is appended,
-- hashed against the one before it, and never touched again. A correction is a
-- new row that says what was actually true.
CREATE TABLE IF NOT EXISTS custody (
  id        TEXT PRIMARY KEY,
  item_id   TEXT NOT NULL,
  at        TEXT NOT NULL,
  seq       INTEGER NOT NULL,
  doc       TEXT NOT NULL
);
-- Ordered by seq, not by time: the hash chain has one true order, and a
-- back-dated correction must not be read out of the position it was written in.
CREATE UNIQUE INDEX IF NOT EXISTS custody_item_seq ON custody(item_id, seq);

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
  name:
    | 'incidents'
    | 'people'
    | 'locations'
    | 'supplements'
    | 'stops'
    | 'crashes'
    | 'returns'
    | 'feedback'
    | 'evidence'
    | 'arrests'
    | 'case_tasks'
    | 'person_photos'
    | 'cruisers'
    | 'cruiser_checks'
    | 'maintenance_requests';
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
  crashes: {
    name: 'crashes',
    columns: (doc) => ({
      case_number: String(doc.caseNumber ?? ''),
      status: String(doc.status ?? 'draft'),
      occurred_at: String(doc.occurredAt ?? ''),
    }),
  },
  returns: {
    name: 'returns',
    columns: (doc) => ({
      call_number: String(doc.callNumber ?? ''),
      officer_id: String(doc.officerId ?? ''),
      received_at: String(doc.receivedAt ?? ''),
    }),
  },
  stops: {
    name: 'stops',
    columns: (doc) => ({
      officer_id: String(doc.officerId ?? ''),
      at: String(doc.at ?? ''),
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
  arrests: {
    name: 'arrests',
    columns: (doc) => ({
      arrest_number: String(doc.arrestNumber ?? ''),
      case_id: String(doc.caseId ?? ''),
      master_id: String(doc.masterId ?? ''),
      status: String(doc.status ?? 'draft'),
      arrested_at: String(doc.arrestedAt ?? ''),
    }),
  },
  cruisers: {
    name: 'cruisers',
    columns: (doc) => ({
      unit: String(doc.unit ?? ''),
      status: String(doc.status ?? 'inService'),
    }),
  },
  cruiserChecks: {
    name: 'cruiser_checks',
    columns: (doc) => ({
      cruiser_id: String(doc.cruiserId ?? ''),
      officer_id: String(doc.officerId ?? ''),
      at: String(doc.at ?? ''),
    }),
  },
  maintenanceRequests: {
    name: 'maintenance_requests',
    columns: (doc) => ({
      number: String(doc.number ?? ''),
      cruiser_id: String(doc.cruiserId ?? ''),
      status: String(doc.status ?? 'open'),
    }),
  },
  personPhotos: {
    name: 'person_photos',
    columns: (doc) => ({
      master_id: String(doc.masterId ?? ''),
      taken_on: String(doc.takenOn ?? ''),
      removal: String(doc.removal ?? ''),
    }),
  },
  caseTasks: {
    name: 'case_tasks',
    columns: (doc) => ({
      case_id: String(doc.caseId ?? ''),
      assigned_to: String(doc.assignedToId ?? ''),
      // SQLite has no boolean; the column is text so the index reads the same
      // as every other column lifted out of a document here.
      done: doc.done ? '1' : '0',
    }),
  },
  evidence: {
    name: 'evidence',
    columns: (doc) => ({
      tag_number: String(doc.tagNumber ?? ''),
      case_id: String(doc.caseId ?? ''),
      category: String(doc.category ?? ''),
    }),
  },
  feedback: {
    name: 'feedback',
    columns: (doc) => ({
      status: String(doc.status ?? 'new'),
      submitted_by: String(doc.submittedBy ?? ''),
      at: String(doc.at ?? ''),
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

/* ------------------------------------------------------------------ */
/* Typed access to one table                                           */
/* ------------------------------------------------------------------ */

/**
 * A typed view of a single document table.
 *
 * Every route module used to carry its own three-line `load`, `save` and `all`
 * around the functions above, each with the same pair of casts, because a
 * document comes back as `Record<string, unknown>` and every caller knows
 * better. Fifteen copies of that, and the casts spread across every file that
 * touched storage.
 *
 * They live here now, once. The casts are still unavoidable — SQLite hands back
 * parsed JSON and something has to assert its shape — but there is exactly one
 * place where the assertion is made, and it is the place that did the parsing.
 */
export interface Documents<T> {
  all(db: DatabaseSync): T[];
  /**
   * Only the documents whose lifted columns all match.
   *
   * The point is what it does *not* do: reading every row and parsing every
   * document to throw most of them away. Every column named here is one the
   * table already lifts and indexes, so "this case's supplements" is an index
   * seek rather than a scan of eleven years of them.
   */
  where(db: DatabaseSync, criteria: Record<string, string>): T[];
  /**
   * One lifted column from every row, without parsing any documents.
   *
   * For the questions that are answered by a column alone — the highest case
   * number so far, say — where parsing the documents to reach it is the whole
   * cost.
   */
  columnValues(db: DatabaseSync, column: string): string[];
  find(db: DatabaseSync, id: string): T | null;
  /** The stored version alongside it, for an optimistic write. */
  findWithVersion(db: DatabaseSync, id: string): { doc: T; version: number } | null;
  save(db: DatabaseSync, doc: T, expectedVersion?: number | null): WriteOutcome;
  replaceAll(db: DatabaseSync, docs: T[]): void;
  remove(db: DatabaseSync, id: string): void;
}

export function documents<T>(table: DocTable): Documents<T> {
  const asDoc = (doc: T) => doc as unknown as Record<string, unknown>;

  return {
    all: (db) => readDocs(db, table) as unknown as T[],
    where: (db, criteria) => {
      const columns = Object.keys(criteria);
      if (columns.length === 0) return readDocs(db, table) as unknown as T[];
      /*
        Column names are interpolated, values are bound. The names come from
        this file's own table definitions and never from a request; the values
        are the ones that could carry anything, and they go through the driver.
      */
      const clause = columns.map((column) => `${column} = ?`).join(' AND ');
      const rows = db
        .prepare(`SELECT doc FROM ${table.name} WHERE ${clause}`)
        .all(...columns.map((column) => criteria[column])) as { doc: string }[];
      return rows.map((row) => JSON.parse(row.doc)) as T[];
    },
    columnValues: (db, column) =>
      (db.prepare(`SELECT ${column} AS value FROM ${table.name}`).all() as { value: string }[]).map(
        (row) => String(row.value ?? ''),
      ),
    find: (db, id) => {
      const stored = readDoc(db, table, id);
      return stored ? (stored.doc as unknown as T) : null;
    },
    findWithVersion: (db, id) => {
      const stored = readDoc(db, table, id);
      return stored ? { doc: stored.doc as unknown as T, version: stored.version } : null;
    },
    save: (db, doc, expectedVersion = null) => writeDoc(db, table, asDoc(doc), expectedVersion),
    replaceAll: (db, docs) => writeDocs(db, table, docs.map(asDoc)),
    remove: (db, id) => deleteDoc(db, table, id),
  };
}
