/**
 * Break-glass: getting an administrator back into a locked-out installation.
 *
 * The disaster this exists for is small and entirely plausible. An agency has
 * one administrator. They forget their password. The installation has no mail
 * server, or their address was never filled in, so no reset link can reach
 * them. Nobody can create accounts, grant permissions or approve anything ever
 * again, and the only remaining fix is somebody editing the database by hand —
 * which is worse than this in every way, because it leaves no record.
 *
 * ## What authenticates this
 *
 * Access to the machine. There is no network path here: it reads the database
 * file directly, so whoever runs it already has the records. That is the whole
 * security model, and it is the right one — anybody who could reach this could
 * already read every report on the disk. What matters is not that it is hard to
 * run but that running it is *visible*.
 *
 * ## Why it writes to the audit log
 *
 * Break-glass that leaves no trace is a back door. The entry is sealed into the
 * same hash chain as everything else, so it cannot be removed afterwards
 * without the chain reporting a break, and it names the reason given on the
 * command line. An administrator who comes back to a working account and finds
 * an entry saying somebody used the console to reset it is being told something
 * they need to know.
 *
 * ## What it deliberately will not do
 *
 * Create an account, change a role, or grant a permission. Those would make
 * this a way to manufacture authority rather than to restore access to
 * authority that already exists. It resets the password of an account that
 * already manages accounts, and nothing else. Deactivating the last such
 * account is already refused in the application, so there is always one to
 * name.
 *
 * ## Running it
 *
 *   npm run recover -- --list
 *   npm run recover -- --user rvance --reason "Sole admin locked out, ticket 412"
 */

import { openDatabase } from '../server/db';
import { getUserById, saveCredential, getCredential, listUsers } from '../server/auth';
import { recordAudit } from '../server/audit';
import { createCredential } from '../src/domain/session';
import { generateTemporaryPassword, hashPassword } from '../src/domain/credentials';
import { can } from '../src/domain/auth';

interface Options {
  list: boolean;
  user: string;
  reason: string;
  dbPath: string;
}

function parse(argv: string[]): Options {
  const options: Options = {
    list: false,
    user: '',
    reason: '',
    dbPath: process.env.AEGIS_DB ?? `${process.env.AEGIS_DATA_DIR ?? 'data'}/aegis.db`,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--list') options.list = true;
    else if (flag === '--user') options.user = String(argv[++i] ?? '').trim().toLowerCase();
    else if (flag === '--reason') options.reason = String(argv[++i] ?? '').trim();
    else if (flag === '--db') options.dbPath = String(argv[++i] ?? '');
  }
  return options;
}

const USAGE = `
Break-glass account recovery. Run on the server, by whoever holds the machine.

  npm run recover -- --list
      Names the accounts that can manage accounts.

  npm run recover -- --user <username> --reason "<why>"
      Issues that account a temporary password, ends its sessions, and writes
      an audit entry saying so. The password is printed once.

  --db <path>   The database. Defaults to $AEGIS_DB, then data/aegis.db.

This cannot create an account, change a role, or grant a permission. It
restores access to authority that already exists, and nothing else.
`.trim();

async function main(): Promise<number> {
  const options = parse(process.argv.slice(2));

  if (!options.list && !options.user) {
    console.log(USAGE);
    return options.user || options.list ? 0 : 1;
  }

  const db = openDatabase(options.dbPath);
  const managers = listUsers(db).filter((user) => user.active && can(user, 'users.manage'));

  if (options.list) {
    console.log(`Accounts that can manage accounts, in ${options.dbPath}:\n`);
    if (managers.length === 0) {
      // Should be unreachable: the application refuses to deactivate the last.
      console.log('  (none — this installation cannot be administered at all)');
    }
    for (const user of managers) {
      console.log(`  ${user.username.padEnd(16)} ${user.name}  · ${user.role}`);
    }
    return 0;
  }

  if (!options.reason) {
    console.error(
      'Refusing without --reason. This goes in the audit log, and an entry that\n' +
        'does not say why is the one somebody will be asked about later.',
    );
    return 1;
  }

  const target = managers.find((user) => user.username === options.user);
  if (!target) {
    const known = listUsers(db).find((user) => user.username === options.user);
    if (!known) console.error(`No account with the username "${options.user}".`);
    else if (!known.active) console.error(`"${options.user}" is deactivated.`);
    else {
      console.error(
        `"${options.user}" cannot manage accounts, so resetting it would not\n` +
          'unlock this installation. Run with --list to see the ones that can.',
      );
    }
    return 1;
  }

  const temporary = generateTemporaryPassword();
  const existing = getCredential(db, target.id);
  saveCredential(db, {
    ...(existing ?? createCredential(target.id)),
    userId: target.id,
    passwordHash: await hashPassword(temporary),
    mustChangePassword: true,
    passwordChangedAt: new Date().toISOString(),
    failedAttempts: 0,
    lockedUntil: '',
  });

  // Sessions go, and so does any reset link that was outstanding.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  db.prepare("UPDATE reset_requests SET used_at = ? WHERE user_id = ? AND used_at = ''").run(
    new Date().toISOString(),
    target.id,
  );

  /*
    Attributed to the console rather than to a person, because nobody signed
    in — that is the honest actor, and pretending otherwise would put a name
    against something that name did not do.
  */
  await recordAudit(db, {
    actorId: '',
    actorName: 'Server console',
    action: 'user.passwordReset',
    target: target.name,
    detail: `Break-glass recovery: ${options.reason}`,
  });

  console.log(`\n  Account   ${target.name} (${target.username})`);
  console.log(`  Password  ${temporary}`);
  console.log(
    '\n  Shown once. They must change it at their next sign-in, their sessions\n' +
      '  have ended, and the audit log now records that this was done.\n',
  );
  if (getCredential(db, target.id)?.mfaSecret) {
    /*
      Said, because it is the next thing that goes wrong. Somebody who has lost
      the password has often lost the phone with it, and this command
      deliberately does not touch the second factor.
    */
    console.log(
      '  Their second factor is untouched, and is still required. If the phone is\n' +
        '  gone too, they will need a recovery code — or another administrator to\n' +
        '  clear the factor once this one is back in.\n',
    );
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
