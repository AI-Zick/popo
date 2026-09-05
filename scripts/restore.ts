/**
 * Puts a backup back.
 *
 *   npm run restore -- --from /var/backups/aegis/aegis-2026-09-05T...
 *
 * Verifies before it writes anything, and refuses over an existing database
 * unless told otherwise. The one thing worse than having no backup is a
 * restore that quietly overwrote records somebody was still using.
 */

import { restoreBackup } from '../server/backup';

const argv = process.argv.slice(2);
const flag = (name: string): string => {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] ?? '') : '';
};

const dataDir = process.env.AEGIS_DATA_DIR ?? 'data';
const dbPath = process.env.AEGIS_DB ?? `${dataDir}/aegis.db`;

const USAGE = `
Restores a backup taken with \`npm run backup\`.

  npm run restore -- --from <backup directory>

  --db <path>     Where the database goes. Defaults to $AEGIS_DB.
  --data <path>   Where the files go. Defaults to $AEGIS_DATA_DIR.
  --force         Overwrite data that is already there.

Stop the server first. The backup is verified before anything is written.
`.trim();

async function main(): Promise<number> {
  const from = flag('--from');
  if (!from) {
    console.log(USAGE);
    return 1;
  }

  const result = await restoreBackup({
    from,
    dbPath: flag('--db') || dbPath,
    dataDir: flag('--data') || dataDir,
    force: argv.includes('--force'),
  });

  if (!result.restored) {
    console.error(`\n  Refused. ${result.refusedBecause}\n`);
    for (const problem of result.check.problems) console.error(`    - ${problem}`);
    if (result.check.problems.length > 0) console.error('');
    return 1;
  }

  const manifest = result.check.manifest!;
  const total = Object.values(manifest.rows).reduce((sum, n) => sum + n, 0);
  console.log(`\n  Restored from ${from}`);
  console.log(`  Taken     ${manifest.takenAt}`);
  console.log(`  Rows      ${total}`);
  console.log(`  Audit     ${manifest.audit.entries} entries, chain verified`);
  for (const [dir, info] of Object.entries(manifest.files)) {
    console.log(`  ${dir.padEnd(9)} ${info.count} files`);
  }
  console.log('\n  Start the server. Anybody who was signed in is not any more.\n');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
