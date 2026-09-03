/**
 * The authentication boundary.
 *
 * This is the file that makes the permission model real. Everything the client
 * knows about roles and permissions is now advisory — it decides what to *show*
 * — and every request is re-decided here against the session the server issued
 * and the user record the server holds.
 *
 * The domain modules are imported unchanged from the client codebase. They were
 * written as pure functions over explicit state precisely so this move would be
 * a relocation rather than a rewrite.
 */

import type { DatabaseSync } from 'node:sqlite';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { verifyPassword } from '../src/domain/credentials';
import {
  isLockedOut,
  lockoutRemainingMs,
  registerFailure,
  registerSuccess,
  sessionState,
  SIGN_IN_FAILURE_MESSAGE,
  type Credential,
  type Session,
} from '../src/domain/session';
import { can, type Permission, type User } from '../src/domain/auth';
import { recordAudit } from './audit';

export const SESSION_COOKIE = 'aegis.sid';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      session?: Session;
      db: DatabaseSync;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Reading users and credentials                                       */
/* ------------------------------------------------------------------ */

interface UserRow {
  id: string;
  username: string;
  name: string;
  badge: string;
  role: string;
  grants: string;
  revocations: string;
  active: number;
  deactivated_at: string;
  created_at: string;
  created_by: string;
}

export function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    badge: row.badge,
    role: row.role as User['role'],
    grants: JSON.parse(row.grants),
    revocations: JSON.parse(row.revocations),
    active: row.active === 1,
    deactivatedAt: row.deactivated_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export function getUserById(db: DatabaseSync, id: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function getUserByUsername(db: DatabaseSync, username: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as unknown as
    | UserRow
    | undefined;
  return row ? rowToUser(row) : null;
}

export function listUsers(db: DatabaseSync): User[] {
  const rows = db.prepare('SELECT * FROM users ORDER BY name').all() as unknown as UserRow[];
  return rows.map(rowToUser);
}

function getCredential(db: DatabaseSync, userId: string): Credential | null {
  const row = db.prepare('SELECT * FROM credentials WHERE user_id = ?').get(userId) as
    | Record<string, string | number>
    | undefined;
  if (!row) return null;
  return {
    userId: String(row.user_id),
    passwordHash: String(row.password_hash),
    mustChangePassword: Number(row.must_change) === 1,
    failedAttempts: Number(row.failed_attempts),
    lockedUntil: String(row.locked_until),
    lastSignInAt: String(row.last_sign_in_at),
    passwordChangedAt: String(row.password_changed_at),
  };
}

function saveCredential(db: DatabaseSync, credential: Credential): void {
  db.prepare(
    `INSERT INTO credentials (user_id, password_hash, must_change, failed_attempts, locked_until, last_sign_in_at, password_changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       password_hash = excluded.password_hash,
       must_change = excluded.must_change,
       failed_attempts = excluded.failed_attempts,
       locked_until = excluded.locked_until,
       last_sign_in_at = excluded.last_sign_in_at,
       password_changed_at = excluded.password_changed_at`,
  ).run(
    credential.userId,
    credential.passwordHash,
    credential.mustChangePassword ? 1 : 0,
    credential.failedAttempts,
    credential.lockedUntil,
    credential.lastSignInAt,
    credential.passwordChangedAt,
  );
}

export { getCredential, saveCredential };

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

/**
 * 256 bits from the OS CSPRNG. Session ids are the credential for every
 * request after sign-in, so they get the same treatment as one.
 */
function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function createServerSession(db: DatabaseSync, userId: string): Session {
  const at = new Date().toISOString();
  const session: Session = { id: newSessionId(), userId, startedAt: at, lastSeenAt: at };
  db.prepare(
    'INSERT INTO sessions (id, user_id, started_at, last_seen_at) VALUES (?, ?, ?, ?)',
  ).run(session.id, session.userId, session.startedAt, session.lastSeenAt);
  return session;
}

export function destroySession(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

function readSession(db: DatabaseSync, id: string): Session | null {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
    | Record<string, string>
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function setSessionCookie(res: Response, id: string): void {
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true, // unreachable from JavaScript, so XSS cannot lift it
    sameSite: 'strict', // no cross-site requests carry it, which blocks CSRF
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/**
 * Resolves the session on every request and enforces both timeouts. An expired
 * session is deleted rather than merely rejected, so a stolen id stops working
 * everywhere at once.
 */
export function sessionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = req.cookies?.[SESSION_COOKIE];
  if (!id) return next();

  const session = readSession(req.db, id);
  if (!session) {
    clearSessionCookie(res);
    return next();
  }

  if (sessionState(session) !== 'active') {
    destroySession(req.db, session.id);
    clearSessionCookie(res);
    return next();
  }

  const user = getUserById(req.db, session.userId);
  if (!user || !user.active) {
    // Deactivating an account ends its sessions immediately.
    destroySession(req.db, session.id);
    clearSessionCookie(res);
    return next();
  }

  const lastSeenAt = new Date().toISOString();
  req.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(lastSeenAt, session.id);

  req.session = { ...session, lastSeenAt };
  req.user = user;
  next();
}

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }
  next();
}

/**
 * Server-side permission check. The client hides what a user cannot do; this
 * is what stops them doing it anyway.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    if (!can(req.user, permission)) {
      res.status(403).json({ error: 'You do not have permission to do that.' });
      return;
    }
    next();
  };
}

/* ------------------------------------------------------------------ */
/* Sign-in                                                             */
/* ------------------------------------------------------------------ */

/**
 * A hash of a value nobody knows, used to spend comparable time on a username
 * that does not exist. Without it, a missing account answers noticeably faster
 * than a wrong password and the response time enumerates the user list.
 */
const DUMMY_HASH =
  'pbkdf2$sha256$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export interface SignInResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

export async function attemptSignIn(
  db: DatabaseSync,
  usernameRaw: string,
  password: string,
): Promise<SignInResult & { session?: Session }> {
  const username = String(usernameRaw ?? '').trim();
  const user = username ? getUserByUsername(db, username) : null;
  const credential = user ? getCredential(db, user.id) : null;

  if (!user || !user.active || !credential?.passwordHash) {
    await verifyPassword(String(password ?? ''), DUMMY_HASH);
    await recordAudit(db, {
      actorId: '',
      actorName: username || 'unknown',
      action: 'auth.signInFailed',
      target: '',
      detail: 'No matching active account',
    });
    return { ok: false, status: 401, body: { error: SIGN_IN_FAILURE_MESSAGE } };
  }

  if (isLockedOut(credential)) {
    const minutes = Math.ceil(lockoutRemainingMs(credential) / 60_000);
    return {
      ok: false,
      status: 429,
      body: {
        error: `This account is locked after too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask an administrator to unlock it.`,
      },
    };
  }

  const valid = await verifyPassword(String(password ?? ''), credential.passwordHash);

  if (!valid) {
    const failed = registerFailure(credential);
    saveCredential(db, failed);
    await recordAudit(db, {
      actorId: '',
      actorName: user.username,
      action: 'auth.signInFailed',
      target: '',
      detail: `Attempt ${failed.failedAttempts}`,
    });
    if (isLockedOut(failed)) {
      await recordAudit(db, {
        actorId: '',
        actorName: user.username,
        action: 'auth.lockout',
        target: '',
        detail: 'Locked after repeated failures',
      });
    }
    return { ok: false, status: 401, body: { error: SIGN_IN_FAILURE_MESSAGE } };
  }

  saveCredential(db, registerSuccess(credential));
  // A new session id on every sign-in, so a pre-set one cannot be fixated.
  const session = createServerSession(db, user.id);
  await recordAudit(db, {
    actorId: user.id,
    actorName: user.name,
    action: 'auth.signIn',
    target: '',
    detail: user.role,
  });

  return {
    ok: true,
    status: 200,
    session,
    body: { user, mustChangePassword: credential.mustChangePassword },
  };
}
