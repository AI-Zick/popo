/**
 * Making a copy, and proving it is one.
 *
 * The deployment notes have always said what to copy and which command to use.
 * That is not the same as a backup: a procedure written down is a hypothesis,
 * and the moment anybody finds out whether it was true is the moment they need
 * it. So this does three things the note could not.
 *
 * **It takes a consistent copy of a live database.** `VACUUM INTO` writes a
 * new file from a single read transaction, so it cannot catch a write
 * mid-flight the way `cp` can, and it does not need the server stopped.
 *
 * **It takes the files too.** There are two directories, not one — attachments
 * and person photographs — and a database that references files which are not
 * in the backup is worse than no backup at all, because it restores cleanly
 * and is missing evidence.
 *
 * **It reads back what it wrote.** Every check that matters is run against the
 * copy rather than the original: the audit chain still verifies, the row
 * counts match, and every file the database expects is present with the digest
 * it expects. A backup nobody has read is a hypothesis with a filename.
 */

import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './db';
import { readAuditLog } from './audit';
import { verifyChain } from '../src/domain/audit';

/** The directories of files that belong with the database. */
export const FILE_DIRECTORIES = ['attachments', 'photos'] as const;

/** Tables whose row counts are recorded, so a short restore is visible. */
function tableNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

function rowCounts(db: DatabaseSync): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name of tableNames(db)) {
    // The name comes from sqlite_master, never from a request.
    const row = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number };
    counts[name] = row.n;
  }
  return counts;
}

/** Every digest the database expects to find on disk, by directory. */
function expectedDigests(db: DatabaseSync): Record<string, string[]> {
  const read = (table: string): string[] => {
    try {
      const rows = db.prepare(`SELECT doc FROM "${table}"`).all() as { doc: string }[];
      return rows
        .map((row) => {
          try {
            return String((JSON.parse(row.doc) as { sha256?: string }).sha256 ?? '');
          } catch {
            return '';
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  };
  return {
    attachments: (() => {
      try {
        const rows = db.prepare('SELECT sha256 FROM attachments').all() as { sha256: string }[];
        return rows.map((row) => row.sha256).filter(Boolean);
      } catch {
        return [];
      }
    })(),
    photos: read('person_photos'),
  };
}

/** Digests of what is actually in a directory. */
function digestsOnDisk(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  if (!existsSync(dir)) return found;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isFile()) continue;
    found.set(createHash('sha256').update(readFileSync(path)).digest('hex'), name);
  }
  return found;
}

export interface Manifest {
  takenAt: string;
  /** Where it came from, for the person reading this a year later. */
  source: { dbPath: string; dataDir: string };
  rows: Record<string, number>;
  audit: { entries: number; headHash: string };
  files: Record<string, { count: number; bytes: number }>;
}

export interface CheckResult {
  ok: boolean;
  problems: string[];
  manifest: Manifest | null;
}

function directorySize(dir: string): { count: number; bytes: number } {
  if (!existsSync(dir)) return { count: 0, bytes: 0 };
  let count = 0;
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    const stat = statSync(join(dir, name));
    if (!stat.isFile()) continue;
    count += 1;
    bytes += stat.size;
  }
  return { count, bytes };
}

/* ------------------------------------------------------------------ */
/* Taking one                                                          */
/* ------------------------------------------------------------------ */

export async function takeBackup(options: {
  dbPath: string;
  dataDir: string;
  into: string;
}): Promise<{ path: string; check: CheckResult }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = resolve(options.into, `aegis-${stamp}`);
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });

  const live = openDatabase(options.dbPath);
  const rows = rowCounts(live);
  const log = readAuditLog(live);

  /*
    One read transaction, so the copy is the database as it was at a single
    instant. This is the whole reason not to use `cp`, which can catch a page
    written and its partner not.
  */
  live.exec(`VACUUM INTO '${join(path, 'aegis.db').replace(/'/g, "''")}'`);
  live.close();

  const files: Manifest['files'] = {};
  for (const dir of FILE_DIRECTORIES) {
    const from = resolve(options.dataDir, dir);
    if (existsSync(from)) cpSync(from, join(path, dir), { recursive: true });
    else mkdirSync(join(path, dir), { recursive: true });
    files[dir] = directorySize(join(path, dir));
  }

  const manifest: Manifest = {
    takenAt: new Date().toISOString(),
    source: { dbPath: resolve(options.dbPath), dataDir: resolve(options.dataDir) },
    rows,
    audit: { entries: log.length, headHash: log[log.length - 1]?.hash ?? '' },
    files,
  };
  writeFileSync(join(path, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { path, check: await checkBackup(path) };
}

/* ------------------------------------------------------------------ */
/* Reading one back                                                    */
/* ------------------------------------------------------------------ */

/**
 * Everything that can be checked without the original.
 *
 * Run immediately after taking a backup, and again before restoring one. The
 * second is the one that matters: it is the only moment anybody would
 * otherwise discover that the tape has been writing zeroes since March.
 */
export async function checkBackup(path: string): Promise<CheckResult> {
  const problems: string[] = [];
  const manifestPath = join(path, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return { ok: false, problems: [`No manifest in ${path} — this is not a backup directory.`], manifest: null };
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  } catch {
    return { ok: false, problems: ['The manifest is not readable.'], manifest: null };
  }

  const dbPath = join(path, 'aegis.db');
  if (!existsSync(dbPath)) {
    problems.push('There is no database in this backup.');
    return { ok: false, problems, manifest };
  }

  const db = new DatabaseSync(dbPath);
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get() as Record<string, string>;
    const verdict = Object.values(integrity)[0];
    if (verdict !== 'ok') problems.push(`SQLite reports the copy as damaged: ${verdict}`);

    const counts = rowCounts(db);
    for (const [table, expected] of Object.entries(manifest.rows)) {
      const actual = counts[table];
      if (actual === undefined) problems.push(`The table "${table}" is missing from the copy.`);
      else if (actual !== expected) {
        problems.push(`"${table}" holds ${actual} rows; the manifest says ${expected}.`);
      }
    }

    /*
      The audit chain, recomputed. It is the one structure in this system that
      can prove it has not been altered, so a backup that verifies is a backup
      that demonstrably holds the same history rather than a similar one.
    */
    const log = readAuditLog(db);
    const chain = await verifyChain(log);
    if (!chain.intact) {
      problems.push(`The audit chain in the copy does not verify: ${chain.reason ?? 'broken'}.`);
    }
    if (log.length !== manifest.audit.entries) {
      problems.push(`The copy holds ${log.length} audit entries; the manifest says ${manifest.audit.entries}.`);
    }

    // Every file the database expects, present and byte-identical.
    const expected = expectedDigests(db);
    for (const dir of FILE_DIRECTORIES) {
      const present = digestsOnDisk(join(path, dir));
      const missing = (expected[dir] ?? []).filter((digest) => !present.has(digest));
      if (missing.length > 0) {
        problems.push(
          `${missing.length} ${dir} referenced by the database are not in the backup, or do not match their recorded digest.`,
        );
      }
    }
  } finally {
    db.close();
  }

  return { ok: problems.length === 0, problems, manifest };
}

/* ------------------------------------------------------------------ */
/* Putting one back                                                    */
/* ------------------------------------------------------------------ */

export async function restoreBackup(options: {
  from: string;
  dbPath: string;
  dataDir: string;
  force: boolean;
}): Promise<{ check: CheckResult; restored: boolean; refusedBecause?: string }> {
  const check = await checkBackup(options.from);
  if (!check.ok) {
    return {
      check,
      restored: false,
      refusedBecause: 'The backup does not verify. Restoring it would replace good records with bad ones.',
    };
  }

  /*
    Refused over anything already there unless somebody says otherwise on the
    command line. The one thing worse than having no backup is a restore that
    quietly overwrote a database somebody was still using.
  */
  const occupied =
    existsSync(options.dbPath) ||
    FILE_DIRECTORIES.some((dir) => {
      const path = resolve(options.dataDir, dir);
      return existsSync(path) && readdirSync(path).length > 0;
    });
  if (occupied && !options.force) {
    return {
      check,
      restored: false,
      refusedBecause: `There is already data at ${resolve(options.dataDir)}. Move it aside, or pass --force to overwrite it.`,
    };
  }

  mkdirSync(resolve(options.dataDir), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const stale = `${options.dbPath}${suffix}`;
    if (existsSync(stale)) rmSync(stale);
  }
  cpSync(join(options.from, 'aegis.db'), options.dbPath);
  for (const dir of FILE_DIRECTORIES) {
    const to = resolve(options.dataDir, dir);
    if (existsSync(to)) rmSync(to, { recursive: true, force: true });
    cpSync(join(options.from, dir), to, { recursive: true });
  }

  return { check, restored: true };
}
