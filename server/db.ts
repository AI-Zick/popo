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
-- Deleted content is overwritten with zeros instead of being left in a free
-- page for a hex editor to find. It costs a little on every write and it is
-- the difference between a court-ordered destruction that happened and one
-- that only happened as far as the query planner is concerned.
PRAGMA secure_delete = ON;

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
  password_changed_at TEXT NOT NULL DEFAULT '',
  -- The second factor. The secret is live only once confirmed_at is set:
  -- enrolment that was started and abandoned must not lock anybody out.
  mfa_secret          TEXT NOT NULL DEFAULT '',
  mfa_confirmed_at    TEXT NOT NULL DEFAULT '',
  -- The last time step this account used, so the same six digits cannot be
  -- replayed by somebody who watched them being typed.
  mfa_last_counter    INTEGER NOT NULL DEFAULT -1,
  mfa_failed          INTEGER NOT NULL DEFAULT 0,
  -- Hashed, single-use, and spent as they are used.
  recovery_codes      TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  -- How far this session got. A password alone buys nothing but the right to
  -- present a second factor: 'password' reaches the enrolment and verification
  -- routes and nothing else, 'full' is a signed-in session.
  factor       TEXT NOT NULL DEFAULT 'full'
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
  hash       TEXT NOT NULL,
  -- Set when a court order destroyed this entry's content. The hash above is
  -- deliberately left as it was sealed, so the chain still links either side
  -- of the hole. See the note on verifyLinks in domain/chain.
  redacted_by TEXT NOT NULL DEFAULT '',
  redacted_at TEXT NOT NULL DEFAULT ''
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

-- Court orders to seal or destroy records, and the certificates left behind.
-- Not a document in the review sense: an order is proposed by one person and
-- carried out by another, and once carried out it keeps only what a court
-- needs to see that it was obeyed.
CREATE TABLE IF NOT EXISTS disposal_orders (
  id         TEXT PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 1,
  reference  TEXT NOT NULL DEFAULT '',
  subject_id TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'draft',
  updated_at TEXT NOT NULL,
  doc        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS disposal_reference ON disposal_orders(reference);
-- Orders about one case, and the queue waiting on a second person.
CREATE INDEX IF NOT EXISTS disposal_subject ON disposal_orders(subject_id);
CREATE INDEX IF NOT EXISTS disposal_status ON disposal_orders(status);

-- Which records are sealed, and under which order. Its own table rather than a
-- flag on each document: a sealed record must stay hidden even if the document
-- itself is rewritten by an import or a migration.
CREATE TABLE IF NOT EXISTS seals (
  subject_id TEXT PRIMARY KEY,
  scope      TEXT NOT NULL DEFAULT 'case',
  order_ref  TEXT NOT NULL DEFAULT '',
  sealed_at  TEXT NOT NULL,
  sealed_by  TEXT NOT NULL DEFAULT ''
);

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
-- One investigation per case. Separate from the report so that assigning,
-- reviewing and suspending keep working after the report is approved, which
-- is when investigative work actually starts.
CREATE TABLE IF NOT EXISTS investigations (
  id           TEXT PRIMARY KEY,
  version      INTEGER NOT NULL DEFAULT 1,
  case_id      TEXT NOT NULL DEFAULT '',
  assigned_to  TEXT NOT NULL DEFAULT '',
  suspended_at TEXT NOT NULL DEFAULT '',
  closed_at    TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL,
  doc          TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS investigations_case ON investigations(case_id);
-- One detective's caseload, which is the read this exists for.
CREATE INDEX IF NOT EXISTS investigations_assignee ON investigations(assigned_to, suspended_at, closed_at);

-- Citations. The number is the court's, not ours, and it is unique because
-- one ticket is one record however many paths it arrives by — the officer
-- keying it in and the MDT submitting it must not produce two rows.
CREATE TABLE IF NOT EXISTS citations (
  id         TEXT PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 1,
  number     TEXT NOT NULL DEFAULT '',
  issued_at  TEXT NOT NULL DEFAULT '',
  person_id  TEXT NOT NULL DEFAULT '',
  officer_id TEXT NOT NULL DEFAULT '',
  stop_id    TEXT NOT NULL DEFAULT '',
  voided_at  TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  doc        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS citations_number ON citations(number);
CREATE INDEX IF NOT EXISTS citations_person ON citations(person_id, issued_at);
CREATE INDEX IF NOT EXISTS citations_officer ON citations(officer_id, issued_at);

-- Public records requests.
--
-- The statutory clock is not a column here, and that is deliberate: it is
-- worked out from the received date, the agency's period, the extensions and
-- the pauses every time anybody looks. A stored due date is one a nightly job
-- has to keep honest, and the day that job does not run is the day a clerk is
-- told a late request is fine.
--
-- What is lifted out is what a queue is filtered by: closed_at empty means
-- open, which is the only read this table gets in volume.
CREATE TABLE IF NOT EXISTS public_requests (
  id          TEXT PRIMARY KEY,
  version     INTEGER NOT NULL DEFAULT 1,
  number      TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT '',
  assigned_to TEXT NOT NULL DEFAULT '',
  closed_at   TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  doc         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS public_requests_number ON public_requests(number);
-- The open queue, oldest first, which is the screen this exists for.
CREATE INDEX IF NOT EXISTS public_requests_open ON public_requests(closed_at, received_at);

-- What was actually released, kept apart from the request.
--
-- The released text is stored rather than rebuilt on demand, because the
-- question a year later is "what did we send them", and rebuilding it from
-- today's record would answer a different question: the record may have been
-- supplemented, corrected or sealed since. This is the copy that went out.
CREATE TABLE IF NOT EXISTS public_releases (
  id          TEXT PRIMARY KEY,
  version     INTEGER NOT NULL DEFAULT 1,
  request_id  TEXT NOT NULL DEFAULT '',
  released_at TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  doc         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS public_releases_request ON public_releases(request_id, released_at);

-- Warrants. Indexed by person because "is this person wanted" is the question
-- asked of it, and by number because confirming a hit starts from the number
-- the court gave it.
--
-- The served, recalled and expiry columns are empty while a warrant stands,
-- which is what makes "outstanding" answerable in SQL without a status column
-- somebody has to remember to update.
CREATE TABLE IF NOT EXISTS warrants (
  id          TEXT PRIMARY KEY,
  version     INTEGER NOT NULL DEFAULT 1,
  person_id   TEXT NOT NULL DEFAULT '',
  number      TEXT NOT NULL DEFAULT '',
  issued_on   TEXT NOT NULL DEFAULT '',
  expires_on  TEXT NOT NULL DEFAULT '',
  served_on   TEXT NOT NULL DEFAULT '',
  recalled_on TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  doc         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS warrants_person ON warrants(person_id, served_on, recalled_on);
CREATE INDEX IF NOT EXISTS warrants_number ON warrants(number);

-- Field contacts. The subjects live inside the document because a contact is
-- read whole, but the officer and the date are lifted out: "what did I write
-- last night" and "what is due for disposal" are both column scans.
CREATE TABLE IF NOT EXISTS field_contacts (
  id          TEXT PRIMARY KEY,
  version     INTEGER NOT NULL DEFAULT 1,
  number      TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL DEFAULT '',
  officer_id  TEXT NOT NULL DEFAULT '',
  basis       TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  doc         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS field_contacts_when ON field_contacts(occurred_at);
CREATE INDEX IF NOT EXISTS field_contacts_officer ON field_contacts(officer_id, occurred_at);

-- The Master Vehicle Index. One row per vehicle of record, not per sighting.
-- Plate is indexed but deliberately not unique: plates move between cars, and
-- a uniqueness constraint here would reject the second car to wear one.
CREATE TABLE IF NOT EXISTS vehicles (
  id          TEXT PRIMARY KEY,
  version     INTEGER NOT NULL DEFAULT 1,
  vin         TEXT NOT NULL DEFAULT '',
  plate       TEXT NOT NULL DEFAULT '',
  plate_state TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  doc         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vehicles_vin ON vehicles(vin);
CREATE INDEX IF NOT EXISTS vehicles_plate ON vehicles(plate, plate_state);

-- Trespass notices. Read from both ends — everything one person is barred
-- from, and everybody barred from one place — so both directions are indexed.
--
-- The expiry column is empty for an indefinite notice, and the lifted column
-- is empty until somebody withdraws one. That is what makes "in force"
-- answerable in SQL without a job that walks the table rewriting a status.
CREATE TABLE IF NOT EXISTS trespasses (
  id          TEXT PRIMARY KEY,
  version     INTEGER NOT NULL DEFAULT 1,
  person_id   TEXT NOT NULL DEFAULT '',
  location_id TEXT NOT NULL DEFAULT '',
  served_on   TEXT NOT NULL DEFAULT '',
  expires_on  TEXT NOT NULL DEFAULT '',
  lifted_at   TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  doc         TEXT NOT NULL
);
-- The list for one place, which is the read that has to stay fast when a
-- shopping centre has eight hundred of these.
CREATE INDEX IF NOT EXISTS trespasses_location ON trespasses(location_id, lifted_at, expires_on);
-- Everything one person is barred from, for their record.
CREATE INDEX IF NOT EXISTS trespasses_person ON trespasses(person_id, lifted_at, expires_on);

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

/**
 * Columns added to a table that already exists somewhere.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a database created by an
 * earlier build, so a new column on an old table needs saying twice: once in
 * the schema above for a fresh install, and once here for everybody else.
 * Keep both in step — a column only in the schema is a column that is missing
 * from every database that already exists.
 */
const ADDED_COLUMNS: [table: string, column: string, definition: string][] = [
  ['audit_log', 'redacted_by', "TEXT NOT NULL DEFAULT ''"],
  ['audit_log', 'redacted_at', "TEXT NOT NULL DEFAULT ''"],
  ['credentials', 'mfa_secret', "TEXT NOT NULL DEFAULT ''"],
  ['credentials', 'mfa_confirmed_at', "TEXT NOT NULL DEFAULT ''"],
  ['credentials', 'mfa_last_counter', 'INTEGER NOT NULL DEFAULT -1'],
  ['credentials', 'mfa_failed', 'INTEGER NOT NULL DEFAULT 0'],
  ['credentials', 'recovery_codes', "TEXT NOT NULL DEFAULT '[]'"],
  /*
    Existing sessions default to 'full' rather than 'password'. They were
    issued before there was a second factor and their holders are signed in;
    invalidating them on upgrade would sign out an entire department at once
    with no explanation. New sessions are issued under the new rules.
  */
  ['sessions', 'factor', "TEXT NOT NULL DEFAULT 'full'"],
];

function addMissingColumns(db: DatabaseSync): void {
  for (const [table, column, definition] of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.length === 0 || columns.some((c) => c.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  addMissingColumns(db);
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
    | 'maintenance_requests'
    | 'disposal_orders'
    | 'vehicles'
    | 'trespasses'
    | 'warrants'
    | 'field_contacts'
    | 'investigations'
    | 'citations'
    | 'public_requests'
    | 'public_releases';
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
  disposalOrders: {
    name: 'disposal_orders',
    columns: (doc) => ({
      reference: String(doc.reference ?? ''),
      subject_id: String(doc.subjectId ?? ''),
      status: String(doc.status ?? 'draft'),
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
  investigations: {
    name: 'investigations',
    columns: (doc) => ({
      case_id: String(doc.caseId ?? ''),
      assigned_to: String(doc.assignedToId ?? ''),
      suspended_at: String(doc.suspendedAt ?? ''),
      closed_at: String(doc.closedAt ?? ''),
    }),
  },
  citations: {
    name: 'citations',
    columns: (doc) => ({
      number: String(doc.number ?? ''),
      issued_at: String(doc.issuedAt ?? ''),
      person_id: String(doc.personId ?? ''),
      officer_id: String(doc.officerId ?? ''),
      stop_id: String(doc.stopId ?? ''),
      voided_at: String(doc.voidedAt ?? ''),
    }),
  },
  publicRequests: {
    name: 'public_requests',
    columns: (doc) => ({
      number: String(doc.number ?? ''),
      received_at: String(doc.receivedAt ?? ''),
      assigned_to: String(doc.assignedTo ?? ''),
      closed_at: String((doc.closure as { at?: string } | null)?.at ?? ''),
    }),
  },
  publicReleases: {
    name: 'public_releases',
    columns: (doc) => ({
      request_id: String(doc.requestId ?? ''),
      released_at: String(doc.releasedAt ?? ''),
    }),
  },
  warrants: {
    name: 'warrants',
    columns: (doc) => ({
      person_id: String(doc.personId ?? ''),
      number: String(doc.number ?? ''),
      issued_on: String(doc.issuedOn ?? ''),
      expires_on: String(doc.expiresOn ?? ''),
      served_on: String(doc.servedOn ?? ''),
      recalled_on: String(doc.recalledOn ?? ''),
    }),
  },
  fieldContacts: {
    name: 'field_contacts',
    columns: (doc) => ({
      number: String(doc.number ?? ''),
      occurred_at: String(doc.occurredAt ?? ''),
      officer_id: String(doc.officerId ?? ''),
      basis: String(doc.basis ?? ''),
    }),
  },
  vehicles: {
    name: 'vehicles',
    columns: (doc) => ({
      vin: String(doc.vin ?? ''),
      plate: String(doc.plate ?? ''),
      plate_state: String(doc.plateState ?? ''),
    }),
  },
  trespasses: {
    name: 'trespasses',
    columns: (doc) => ({
      person_id: String(doc.personId ?? ''),
      location_id: String(doc.locationId ?? ''),
      served_on: String(doc.servedOn ?? ''),
      expires_on: String(doc.expiresOn ?? ''),
      lifted_at: String(doc.liftedAt ?? ''),
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
