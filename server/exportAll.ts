/**
 * Everything the agency has, in a form they can read without us.
 *
 * Asked at two moments: while an agency is deciding whether to buy, and while
 * they are leaving. Being unable to answer the second is a reason not to buy,
 * and the architecture notes already argue that a records system somebody
 * cannot leave is a records system that has captured them.
 *
 * This is not the backup. A backup is a SQLite file for putting back into this
 * software; an export is JSON and files for reading in something else, or for
 * loading into whatever the agency buys next.
 *
 * ## It cannot silently miss anything
 *
 * The table list comes from the database itself, not from a list somebody
 * maintains. Everything is exported unless it is named in EXCLUDED below, so a
 * collection added next year is in the export the day it exists — the failure
 * mode is exporting something unnecessary, which is visible, rather than
 * quietly leaving a table behind, which is not.
 */

import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './db';
import { FILE_DIRECTORIES } from './backup';

/**
 * Left out, and why.
 *
 * All authentication state. Password hashes, authenticator secrets, recovery
 * codes, live sessions and outstanding reset links are not records about
 * anybody — they are how this particular installation knows who is at the
 * keyboard. They are worthless in another system, and writing them to a
 * directory somebody will email themselves is the one way this export could
 * make an agency less safe rather than more free.
 */
const EXCLUDED: Record<string, string> = {
  credentials: 'Password hashes, authenticator secrets and recovery codes.',
  sessions: 'Who is signed in right now.',
  reset_requests: 'Outstanding password-reset links.',
  edit_locks: 'Who had a report open at the moment this was taken.',
};

export interface ExportSummary {
  path: string;
  tables: { name: string; rows: number; excluded?: string }[];
  files: Record<string, { count: number; bytes: number }>;
  /** Files the records point at, and how many of them arrived. */
  referenced: { expected: number; present: number };
  takenAt: string;
}

function allTables(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

/**
 * One table as an array of records.
 *
 * A column named `doc` holds a JSON document and is unwrapped, so the export
 * reads as records rather than as rows with a string inside them. The other
 * columns beside it are indexes lifted out of that same document for the
 * database to search on — `case_number` beside `caseNumber` — so they are
 * dropped rather than emitted twice under two spellings, which would leave
 * whoever receives this wondering which one to trust. `id`, `version` and
 * `updated_at` are not in the document and are kept.
 */
function readTable(db: DatabaseSync, name: string): unknown[] {
  const rows = db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[];
  return rows.map((row) => {
    if (typeof row.doc !== 'string') return row;
    try {
      const document = JSON.parse(row.doc) as Record<string, unknown>;
      return {
        id: row.id,
        version: row.version,
        updatedAt: row.updated_at,
        ...document,
      };
    } catch {
      // A document that will not parse is emitted as it is stored, rather
      // than dropped: unreadable is recoverable, missing is not.
      return row;
    }
  });
}

/** Every SHA-256 a record points at, so the export can say the files are there. */
function referencedDigests(records: unknown[]): string[] {
  return records
    .map((record) => String((record as { sha256?: unknown }).sha256 ?? ''))
    .filter(Boolean);
}

const README = (summary: ExportSummary): string =>
  [
    '# What is in here',
    '',
    `Everything this Aegis RMS installation held, as at ${summary.takenAt}.`,
    '',
    'One JSON file per collection, each an array of records. Where a record was',
    'stored as a document, the document is unwrapped so the file reads as records',
    'rather than as database rows with a string inside them.',
    '',
    '## Files',
    '',
    'Attachments and person photographs are in `attachments/` and `photos/`,',
    'named by the id the records refer to. Every record that points at a file',
    'also carries the SHA-256 of that file, so you can prove the two match.',
    '',
    '## The audit log',
    '',
    '`audit_log.json` is hash-chained: each entry carries the hash of the one',
    'before it. That is what lets you show nothing was inserted or removed. The',
    'chain is only meaningful in order — keep the `seq` column.',
    '',
    '## What is deliberately not here',
    '',
    ...Object.entries(EXCLUDED).map(([table, why]) => `- \`${table}\` — ${why}`),
    '',
    'None of it describes anybody. It is how this installation recognised people',
    'at the keyboard, it is worthless anywhere else, and a directory of password',
    'hashes is the one thing this export could do to make you less safe.',
    '',
    '## Counts',
    '',
    ...summary.tables
      .filter((table) => !table.excluded && table.rows > 0)
      .map((table) => `- ${table.name}: ${table.rows}`),
    '',
  ].join('\n');

export function exportEverything(options: {
  dbPath: string;
  dataDir: string;
  into: string;
}): ExportSummary {
  const takenAt = new Date().toISOString();
  const path = resolve(options.into, `aegis-export-${takenAt.replace(/[:.]/g, '-')}`);
  mkdirSync(path, { recursive: true });

  const db = openDatabase(options.dbPath);
  const tables: ExportSummary['tables'] = [];
  const wanted: string[] = [];

  for (const name of allTables(db)) {
    const excluded = EXCLUDED[name];
    if (excluded) {
      tables.push({ name, rows: 0, excluded });
      continue;
    }
    const records = readTable(db, name);
    wanted.push(...referencedDigests(records));
    writeFileSync(join(path, `${name}.json`), `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    tables.push({ name, rows: records.length });
  }
  db.close();

  const files: ExportSummary['files'] = {};
  for (const dir of FILE_DIRECTORIES) {
    const from = resolve(options.dataDir, dir);
    const to = join(path, dir);
    if (existsSync(from)) cpSync(from, to, { recursive: true });
    else mkdirSync(to, { recursive: true });
    let count = 0;
    let bytes = 0;
    for (const name of readdirSync(to)) {
      const stat = statSync(join(to, name));
      if (!stat.isFile()) continue;
      count += 1;
      bytes += stat.size;
    }
    files[dir] = { count, bytes };
  }

  /*
    Every file a record points at, checked to be in the export by digest. An
    agency receiving a directory of JSON that references photographs which are
    not in it has been given something worse than nothing — it reads as
    complete and is not.
  */
  const present = new Set<string>();
  for (const dir of FILE_DIRECTORIES) {
    const from = join(path, dir);
    for (const name of readdirSync(from)) {
      const full = join(from, name);
      if (!statSync(full).isFile()) continue;
      present.add(createHash('sha256').update(readFileSync(full)).digest('hex'));
    }
  }
  const referenced = {
    expected: wanted.length,
    present: wanted.filter((digest) => present.has(digest)).length,
  };

  const summary: ExportSummary = { path, tables, files, referenced, takenAt };
  writeFileSync(join(path, 'README.md'), README(summary), 'utf8');

  /*
    A digest of every file written, so somebody receiving this on a disk can
    show it arrived whole. Written last, and covering everything but itself.
  */
  const digests: Record<string, string> = {};
  const walk = (dir: string, prefix = '') => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else if (`${prefix}${name}` !== 'checksums.txt') {
        digests[`${prefix}${name}`] = createHash('sha256')
          .update(readFileSync(full))
          .digest('hex');
      }
    }
  };
  walk(path);
  writeFileSync(
    join(path, 'checksums.txt'),
    `${Object.entries(digests)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, digest]) => `${digest}  ${name}`)
      .join('\n')}\n`,
    'utf8',
  );

  return summary;
}
