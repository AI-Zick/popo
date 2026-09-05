/**
 * Takes a backup, and reads it back.
 *
 *   npm run backup -- --to /var/backups/aegis
 *   npm run backup -- --check /var/backups/aegis/aegis-2026-09-05T...
 *
 * Exits non-zero when the copy does not verify, so a scheduled run that has
 * been quietly writing rubbish since March shows up as a failed job rather
 * than as a directory full of files.
 */

import { checkBackup, takeBackup } from '../server/backup';

const argv = process.argv.slice(2);
const flag = (name: string): string => {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] ?? '') : '';
};

const dataDir = process.env.AEGIS_DATA_DIR ?? 'data';
const dbPath = process.env.AEGIS_DB ?? `${dataDir}/aegis.db`;

const USAGE = `
Takes a backup of the database and the files that belong with it, then reads
the copy back and checks it.

  npm run backup -- --to <directory>
      Writes <directory>/aegis-<timestamp>/ and verifies it.

  npm run backup -- --check <backup directory>
      Verifies one that already exists. Do this to the backup you intend to
      restore, before you need it.

  --db <path>        Defaults to $AEGIS_DB, then data/aegis.db.
  --data <path>      Defaults to $AEGIS_DATA_DIR, then data.

Exits non-zero if anything does not check out.
`.trim();

const bytes = (n: number): string =>
  n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;

async function main(): Promise<number> {
  const to = flag('--to');
  const check = flag('--check');
  if (!to && !check) {
    console.log(USAGE);
    return 1;
  }

  const result = check
    ? { path: check, check: await checkBackup(check) }
    : await takeBackup({
        dbPath: flag('--db') || dbPath,
        dataDir: flag('--data') || dataDir,
        into: to,
      });

  console.log(check ? `\n  Checking  ${result.path}` : `\n  Written   ${result.path}`);

  const manifest = result.check.manifest;
  if (manifest) {
    const rows = Object.entries(manifest.rows)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((sum, [, n]) => sum + n, 0);
    console.log(`  Taken     ${manifest.takenAt}`);
    console.log(`  Rows      ${total} across ${rows.length} tables`);
    console.log(`  Audit     ${manifest.audit.entries} entries, chain verified`);
    for (const [dir, info] of Object.entries(manifest.files)) {
      console.log(`  ${dir.padEnd(9)} ${info.count} files, ${bytes(info.bytes)}`);
    }
  }

  if (result.check.ok) {
    console.log('\n  Verified. Every table, every audit entry and every file the database\n  expects is present in the copy.\n');
    return 0;
  }

  console.error('\n  DOES NOT VERIFY:');
  for (const problem of result.check.problems) console.error(`    - ${problem}`);
  console.error('\n  Do not rely on this copy.\n');
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
