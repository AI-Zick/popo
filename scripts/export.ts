/**
 * Writes everything the agency has, in a form they can read without us.
 *
 *   npm run export -- --to /tmp/leaving
 *
 * Not the backup. A backup is a SQLite file for putting back into this
 * software; this is JSON and files for reading in something else, or loading
 * into whatever the agency buys next.
 */

import { exportEverything } from '../server/exportAll';

const argv = process.argv.slice(2);
const flag = (name: string): string => {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] ?? '') : '';
};

const dataDir = process.env.AEGIS_DATA_DIR ?? 'data';
const dbPath = process.env.AEGIS_DB ?? `${dataDir}/aegis.db`;

const USAGE = `
Writes every record this installation holds, as JSON, with the files.

  npm run export -- --to <directory>

  --db <path>     Defaults to $AEGIS_DB, then data/aegis.db.
  --data <path>   Defaults to $AEGIS_DATA_DIR, then data.

Authentication state — password hashes, authenticator secrets, live sessions —
is deliberately left out. The README written alongside says so and says why.
`.trim();

const bytes = (n: number): string =>
  n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;

function main(): number {
  const to = flag('--to');
  if (!to) {
    console.log(USAGE);
    return 1;
  }

  const summary = exportEverything({
    dbPath: flag('--db') || dbPath,
    dataDir: flag('--data') || dataDir,
    into: to,
  });

  const written = summary.tables.filter((t) => !t.excluded);
  const held = written.filter((t) => t.rows > 0);
  const total = written.reduce((sum, t) => sum + t.rows, 0);

  console.log(`\n  Written   ${summary.path}`);
  console.log(`  Records   ${total} across ${held.length} collections`);
  for (const [dir, info] of Object.entries(summary.files)) {
    console.log(`  ${dir.padEnd(9)} ${info.count} files, ${bytes(info.bytes)}`);
  }

  const { expected, present } = summary.referenced;
  if (expected > 0) {
    const ok = present === expected;
    console.log(
      `  Referenced ${present} of ${expected} files the records point at are here${ok ? '' : ' — SOME ARE MISSING'}`,
    );
  }

  const left = summary.tables.filter((t) => t.excluded);
  if (left.length > 0) {
    console.log('\n  Left out, on purpose:');
    for (const table of left) console.log(`    ${table.name.padEnd(16)} ${table.excluded}`);
  }

  console.log('\n  README.md explains the shape. checksums.txt covers every file\n  written, so it can be shown to have arrived whole.\n');
  return summary.referenced.present === summary.referenced.expected ? 0 : 1;
}

try {
  process.exit(main());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
