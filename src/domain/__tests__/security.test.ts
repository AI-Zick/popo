import { describe, expect, it } from 'vitest';
import {
  checkPassword,
  generateTemporaryPassword,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  needsRehash,
  PBKDF2_ITERATIONS,
  verifyPassword,
} from '../credentials';
import {
  ABSOLUTE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  MAX_FAILED_ATTEMPTS,
  createCredential,
  createSession,
  isLockedOut,
  isSessionValid,
  registerFailure,
  registerSuccess,
  sessionState,
  touchSession,
} from '../session';
import {
  appendEntry,
  filterLog,
  verifyChain,
  type AuditEntry,
} from '../audit';

/* ------------------------------------------------------------------ */
/* Passwords                                                           */
/* ------------------------------------------------------------------ */

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const stored = await hashPassword('anchor-basalt-cedar-14');
    expect(await verifyPassword('anchor-basalt-cedar-14', stored)).toBe(true);
    expect(await verifyPassword('anchor-basalt-cedar-15', stored)).toBe(false);
  });

  it('never stores the password itself', async () => {
    const password = 'granite-harbor-ingot-07';
    const stored = await hashPassword(password);
    expect(stored).not.toContain(password);
  });

  it('salts, so the same password hashes differently each time', async () => {
    const a = await hashPassword('meridian-nimbus-orchard-22');
    const b = await hashPassword('meridian-nimbus-orchard-22');
    expect(a).not.toBe(b);
    // Both still verify.
    expect(await verifyPassword('meridian-nimbus-orchard-22', a)).toBe(true);
    expect(await verifyPassword('meridian-nimbus-orchard-22', b)).toBe(true);
  });

  it('records its parameters so records can be upgraded later', async () => {
    const stored = await hashPassword('quarry-ridge-summit-31');
    expect(stored.startsWith(`pbkdf2$sha256$${PBKDF2_ITERATIONS}$`)).toBe(true);
    expect(needsRehash(stored)).toBe(false);
    expect(needsRehash('pbkdf2$sha256$1000$c2FsdA==$aGFzaA==')).toBe(true);
    expect(needsRehash('garbage')).toBe(true);
  });

  it('rejects a malformed stored hash rather than throwing', async () => {
    expect(await verifyPassword('anything', '')).toBe(false);
    expect(await verifyPassword('anything', 'not$a$valid$hash')).toBe(false);
    expect(await verifyPassword('anything', 'md5$sha256$1$a$b')).toBe(false);
  });
});

describe('password policy', () => {
  it('requires length over complexity', () => {
    expect(checkPassword('Sh0rt!').ok).toBe(false);
    expect(checkPassword('correct horse battery staple').ok).toBe(true);
    expect(checkPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1)).ok).toBe(false);
  });

  it('rejects the passwords attackers try first', () => {
    expect(checkPassword('password123').ok).toBe(false);
    expect(checkPassword('lawenforcement').ok).toBe(false);
  });

  it('rejects a password containing the username or name', () => {
    const byUsername = checkPassword('mreyes-is-my-password', { username: 'mreyes' });
    expect(byUsername.ok).toBe(false);
    expect(byUsername.problems.join(' ')).toMatch(/username/i);

    const byName = checkPassword('whitfield-forever-2026', { name: 'Dana Whitfield' });
    expect(byName.ok).toBe(false);
  });

  it('rejects a single repeated character', () => {
    expect(checkPassword('aaaaaaaaaaaaaaaa').ok).toBe(false);
  });

  it('explains every problem it found', () => {
    const result = checkPassword('admin', { username: 'admin' });
    expect(result.problems.length).toBeGreaterThan(1);
  });

  it('generates temporary passwords that pass the policy', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(checkPassword(generateTemporaryPassword()).ok).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Lockout                                                             */
/* ------------------------------------------------------------------ */

describe('sign-in throttling', () => {
  const now = Date.UTC(2026, 0, 10, 9, 0, 0);

  it('locks the account after the threshold', () => {
    let credential = createCredential('u1');
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i += 1) {
      credential = registerFailure(credential, now);
      expect(isLockedOut(credential, now)).toBe(false);
    }
    credential = registerFailure(credential, now);
    expect(isLockedOut(credential, now)).toBe(true);
  });

  it('releases the lock once it expires', () => {
    let credential = createCredential('u1');
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) credential = registerFailure(credential, now);
    expect(isLockedOut(credential, now + 60_000)).toBe(true);
    expect(isLockedOut(credential, now + 16 * 60_000)).toBe(false);
  });

  it('clears the count on a successful sign-in', () => {
    let credential = registerFailure(createCredential('u1'), now);
    credential = registerFailure(credential, now);
    credential = registerSuccess(credential, now);
    expect(credential.failedAttempts).toBe(0);
    expect(credential.lockedUntil).toBe('');
    expect(credential.lastSignInAt).not.toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

describe('session lifetime', () => {
  const now = Date.UTC(2026, 0, 10, 9, 0, 0);
  const session = createSession('u1', 's1', now);

  it('is active immediately', () => {
    expect(isSessionValid(session, now)).toBe(true);
  });

  it('expires after the idle timeout', () => {
    expect(sessionState(session, now + IDLE_TIMEOUT_MS - 1000)).toBe('active');
    expect(sessionState(session, now + IDLE_TIMEOUT_MS)).toBe('idle-expired');
  });

  it('activity pushes the idle timeout back', () => {
    const later = now + IDLE_TIMEOUT_MS - 1000;
    const touched = touchSession(session, later);
    expect(sessionState(touched, later + IDLE_TIMEOUT_MS - 1000)).toBe('active');
  });

  it('activity does not extend the absolute timeout', () => {
    // Kept alive by constant use, right up to the shift limit.
    let active = session;
    for (let t = now; t < now + ABSOLUTE_TIMEOUT_MS; t += IDLE_TIMEOUT_MS / 2) {
      active = touchSession(active, t);
    }
    expect(sessionState(active, now + ABSOLUTE_TIMEOUT_MS)).toBe('expired');
  });

  it('treats a missing session as expired', () => {
    expect(sessionState(null, now)).toBe('expired');
    expect(isSessionValid(null, now)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Audit chain                                                         */
/* ------------------------------------------------------------------ */

async function buildLog(): Promise<AuditEntry[]> {
  let log: AuditEntry[] = [];
  log = await appendEntry(
    log,
    { actorId: 'u1', actorName: 'M. Reyes', action: 'auth.signIn', target: '', detail: '' },
    'a1',
    '2026-01-10T09:00:00.000Z',
  );
  log = await appendEntry(
    log,
    {
      actorId: 'u1',
      actorName: 'M. Reyes',
      action: 'note.restrictedViewed',
      target: 'Marion Street Self Storage',
      detail: 'Access note',
    },
    'a2',
    '2026-01-10T09:05:00.000Z',
  );
  log = await appendEntry(
    log,
    {
      actorId: 'u3',
      actorName: 'D. Tam',
      action: 'note.retracted',
      target: 'Marion Street Self Storage',
      detail: 'Gate code changed',
    },
    'a3',
    '2026-01-10T10:00:00.000Z',
  );
  return log;
}

describe('audit log', () => {
  it('chains each entry to the one before it', async () => {
    const log = await buildLog();
    expect(log[0].prevHash).toBe('');
    expect(log[1].prevHash).toBe(log[0].hash);
    expect(log[2].prevHash).toBe(log[1].hash);
    expect(await verifyChain(log)).toMatchObject({ intact: true, brokenAt: null });
  });

  it('detects an altered entry', async () => {
    const log = await buildLog();
    // Someone quietly rewrites why they withdrew a note.
    const tampered = [...log];
    tampered[2] = { ...tampered[2], detail: 'Routine cleanup' };
    const status = await verifyChain(tampered);
    expect(status.intact).toBe(false);
    expect(status.brokenAt).toBe(2);
    expect(status.reason).toMatch(/altered/i);
  });

  it('detects a removed entry', async () => {
    const log = await buildLog();
    // Someone deletes the record of having read the gate code.
    const status = await verifyChain([log[0], log[2]]);
    expect(status.intact).toBe(false);
    expect(status.brokenAt).toBe(1);
    expect(status.reason).toMatch(/missing|reordered/i);
  });

  it('detects reordering', async () => {
    const log = await buildLog();
    const status = await verifyChain([log[1], log[0], log[2]]);
    expect(status.intact).toBe(false);
  });

  it('treats an empty log as intact', async () => {
    expect(await verifyChain([])).toMatchObject({ intact: true, checked: 0 });
  });

  it('cannot be confused by field contents that look like separators', async () => {
    // Length prefixing means "ab|c" and "a|bc" cannot collide.
    let a: AuditEntry[] = [];
    a = await appendEntry(a, { actorId: 'u1', actorName: 'ab', action: 'auth.signIn', target: 'c', detail: '' }, 'x', '2026-01-01T00:00:00.000Z');
    let b: AuditEntry[] = [];
    b = await appendEntry(b, { actorId: 'u1', actorName: 'a', action: 'auth.signIn', target: 'bc', detail: '' }, 'x', '2026-01-01T00:00:00.000Z');
    expect(a[0].hash).not.toBe(b[0].hash);
  });
});

describe('reading the log', () => {
  it('returns the most recent first', async () => {
    const log = await buildLog();
    expect(filterLog(log).map((e) => e.id)).toEqual(['a3', 'a2', 'a1']);
  });

  it('narrows by action, actor and free text', async () => {
    const log = await buildLog();
    expect(filterLog(log, { actions: ['note.retracted'] }).map((e) => e.id)).toEqual(['a3']);
    expect(filterLog(log, { actorId: 'u1' }).map((e) => e.id)).toEqual(['a2', 'a1']);
    expect(filterLog(log, { search: 'gate code' }).map((e) => e.id)).toEqual(['a3']);
  });
});
