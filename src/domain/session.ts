/**
 * Sessions and sign-in attempt handling.
 *
 * As with `credentials.ts`, this is the correct mechanism in the wrong place:
 * a session the client can edit is not a session. It is written as pure
 * functions over explicit state so the same logic can run behind an API
 * unchanged, with the session id in an httpOnly cookie where it belongs.
 */

import type { UUID } from './person';

/** A shift, roughly. Signing in should not last past the end of one. */
export const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
/**
 * Idle timeout. CJIS asks for no more than 30 minutes on a device that could be
 * left unattended, which a car laptop certainly can.
 */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * How far a session got.
 *
 * A password alone buys the right to present a second factor and nothing
 * else. Keeping that in the session rather than inferring it from the user
 * means a half-finished sign-in cannot reach a report by taking a different
 * route through the API.
 */
export type SessionFactor = 'password' | 'full';

export interface Session {
  id: UUID;
  userId: UUID;
  startedAt: string;
  lastSeenAt: string;
  factor: SessionFactor;
}

/** Per-account sign-in state. Separate from the user record on purpose. */
export interface Credential {
  userId: UUID;
  /** Encoded hash from `credentials.ts`. Empty until a password is set. */
  passwordHash: string;
  /** Forces a change at next sign-in — set on any password an admin issued. */
  mustChangePassword: boolean;
  failedAttempts: number;
  /** ISO time the current lockout ends, or empty. */
  lockedUntil: string;
  lastSignInAt: string;
  passwordChangedAt: string;

  /* ---- Second factor ------------------------------------------------ */
  /** Base32 TOTP secret. Live only once `mfaConfirmedAt` is set. */
  mfaSecret: string;
  mfaConfirmedAt: string;
  /** The last time step used, so the same code cannot be replayed. */
  mfaLastCounter: number;
  /** Failed second-factor attempts, locked on the same terms as a password. */
  mfaFailed: number;
  /** Hashed recovery codes, removed as they are spent. */
  recoveryCodes: string[];
}

export function createCredential(userId: UUID, partial: Partial<Credential> = {}): Credential {
  return {
    userId,
    passwordHash: '',
    mustChangePassword: true,
    failedAttempts: 0,
    lockedUntil: '',
    lastSignInAt: '',
    passwordChangedAt: '',
    mfaSecret: '',
    mfaConfirmedAt: '',
    mfaLastCounter: -1,
    mfaFailed: 0,
    recoveryCodes: [],
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* Lockout                                                             */
/* ------------------------------------------------------------------ */

export function isLockedOut(credential: Credential, now = Date.now()): boolean {
  if (!credential.lockedUntil) return false;
  return new Date(credential.lockedUntil).getTime() > now;
}

export function lockoutRemainingMs(credential: Credential, now = Date.now()): number {
  if (!credential.lockedUntil) return 0;
  return Math.max(0, new Date(credential.lockedUntil).getTime() - now);
}

/**
 * Records a failed attempt, locking the account once the threshold is reached.
 * Throttling is per-account rather than per-password so that guessing is slowed
 * regardless of which password was tried.
 */
export function registerFailure(credential: Credential, now = Date.now()): Credential {
  const failedAttempts = credential.failedAttempts + 1;
  const locked = failedAttempts >= MAX_FAILED_ATTEMPTS;
  return {
    ...credential,
    failedAttempts,
    lockedUntil: locked ? new Date(now + LOCKOUT_MS).toISOString() : credential.lockedUntil,
  };
}

export function registerSuccess(credential: Credential, now = Date.now()): Credential {
  return {
    ...credential,
    failedAttempts: 0,
    lockedUntil: '',
    lastSignInAt: new Date(now).toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Session lifetime                                                    */
/* ------------------------------------------------------------------ */

export function createSession(
  userId: UUID,
  id: UUID,
  now = Date.now(),
  factor: SessionFactor = 'full',
): Session {
  const at = new Date(now).toISOString();
  return { id, userId, startedAt: at, lastSeenAt: at, factor };
}

export type SessionState = 'active' | 'idle-expired' | 'expired';

export function sessionState(session: Session | null, now = Date.now()): SessionState {
  if (!session) return 'expired';
  const started = new Date(session.startedAt).getTime();
  const seen = new Date(session.lastSeenAt).getTime();

  if (now - started >= ABSOLUTE_TIMEOUT_MS) return 'expired';
  if (now - seen >= IDLE_TIMEOUT_MS) return 'idle-expired';
  return 'active';
}

export function isSessionValid(session: Session | null, now = Date.now()): boolean {
  return sessionState(session, now) === 'active';
}

/** Extends the idle window. Never extends the absolute one. */
export function touchSession(session: Session, now = Date.now()): Session {
  return { ...session, lastSeenAt: new Date(now).toISOString() };
}

export function msUntilIdleTimeout(session: Session | null, now = Date.now()): number {
  if (!session) return 0;
  const seen = new Date(session.lastSeenAt).getTime();
  return Math.max(0, IDLE_TIMEOUT_MS - (now - seen));
}

export const SIGN_IN_FAILURE_MESSAGE =
  'That username and password do not match an active account.';

/**
 * One message for every failure mode — wrong username, wrong password,
 * deactivated account. Saying which was wrong tells an attacker which usernames
 * exist, which is the first thing they want to know. Lockout is the exception:
 * the account holder needs to understand why they cannot get in.
 */
export interface SignInOutcome {
  ok: boolean;
  reason?: string;
  mustChangePassword?: boolean;
}
