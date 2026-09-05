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

/**
 * How long before the end an officer is warned.
 *
 * Two minutes is enough to reach for the mouse and not enough to be worth
 * ignoring. The warning exists because the alternative — a session that ends
 * silently — means somebody comes back to a sign-in screen with no idea
 * whether what they had typed survived.
 */
export const IDLE_WARNING_MS = 2 * 60 * 1000;

/**
 * How long the browser may be busy without telling the server.
 *
 * The two clocks are separate: the server marks a session used when a request
 * arrives, and an officer typing a long narrative may not cause one for half
 * an hour. Without this they would be warned by their own browser at
 * twenty-eight minutes, press "stay signed in", and find the server had
 * already given up. So local activity sends a cheap request when it has been
 * this long since the last one, which keeps the two in step.
 */
export const KEEPALIVE_AFTER_MS = 5 * 60 * 1000;

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
  /** "Chrome on Windows", so somebody can pick their own row out of a list. */
  device: string;
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
  device = '',
): Session {
  const at = new Date(now).toISOString();
  return { id, userId, startedAt: at, lastSeenAt: at, factor, device };
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

/* ------------------------------------------------------------------ */
/* Telling one session from another                                    */
/* ------------------------------------------------------------------ */

/**
 * A short description of the thing a session was started from.
 *
 * Deliberately coarse — "Chrome on Windows", not the user agent string and not
 * an address. Two things follow from that.
 *
 * It has to be enough to choose by. A list of four identical rows saying
 * "signed in" is a list nobody can act on, and the whole point of showing
 * somebody their sessions is so they can end the one on the phone they left in
 * a patrol car.
 *
 * It must not become a movement record. An agency's own officers are the
 * subjects here, and a per-session log of exact browser builds and IP
 * addresses is a record of where each officer was and when — kept for no
 * operational reason, discoverable, and nobody's business. The browser and the
 * platform are enough to pick a row; anything finer is surveillance of staff
 * dressed as a security feature.
 */
export function describeDevice(userAgent: string): string {
  const agent = userAgent.slice(0, 400);
  if (!agent.trim()) return 'Unknown device';

  const platform = /Windows NT/i.test(agent)
    ? 'Windows'
    : /iPhone|iPad|iPod/i.test(agent)
      ? 'iOS'
      : /Android/i.test(agent)
        ? 'Android'
        : /Mac OS X/i.test(agent)
          ? 'macOS'
          : /Linux/i.test(agent)
            ? 'Linux'
            : '';

  /*
    Order matters: every one of these puts "Safari" in its agent string, and
    most put "Chrome" there too, so the specific ones have to be asked first.
  */
  const browser = /Edg\//i.test(agent)
    ? 'Edge'
    : /OPR\/|Opera/i.test(agent)
      ? 'Opera'
      : /Firefox\//i.test(agent)
        ? 'Firefox'
        : /Chrome\//i.test(agent)
          ? 'Chrome'
          : /Safari\//i.test(agent)
            ? 'Safari'
            : '';

  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;
  return 'Unknown device';
}

/* ------------------------------------------------------------------ */
/* Being about to be signed out                                        */
/* ------------------------------------------------------------------ */

export type IdleStanding = 'active' | 'warning' | 'over';

export interface IdleCheck {
  standing: IdleStanding;
  /** Milliseconds until the session ends. Zero once it has. */
  msLeft: number;
  /** Whether the server should be told the browser is still in use. */
  keepAlive: boolean;
}

/**
 * How close this browser is to being signed out, and whether to say so.
 *
 * Takes both clocks because there are two. `lastActivity` is the last time the
 * person did something — a key, a click. `lastContact` is the last time the
 * browser spoke to the server, which is what the server's own idle timer
 * measures.
 *
 * What counts as activity is a real decision. Mouse movement does not, and
 * must not: a laptop bolted into a car gets jogged at every pothole, and a
 * timeout that any vibration defeats is not a timeout. A key or a deliberate
 * press is somebody using the machine; movement is the machine being moved.
 */
export function idleCheck(
  lastActivity: number,
  lastContact: number,
  now: number,
): IdleCheck {
  const idleFor = now - Math.max(lastActivity, lastContact);
  const msLeft = Math.max(0, IDLE_TIMEOUT_MS - idleFor);
  const standing: IdleStanding =
    msLeft === 0 ? 'over' : msLeft <= IDLE_WARNING_MS ? 'warning' : 'active';
  return {
    standing,
    msLeft,
    /*
      Only while somebody is actually using it. A browser left open on a
      desk must be allowed to time out — a keepalive that fired regardless
      would keep every abandoned terminal in the building signed in.
    */
    keepAlive:
      standing !== 'over' &&
      // Recently, not merely at some point in the last half hour: a terminal
      // last touched 29 minutes ago is one somebody walked away from.
      now - lastActivity < KEEPALIVE_AFTER_MS &&
      now - lastContact >= KEEPALIVE_AFTER_MS,
  };
}

/** "1:58" — a countdown somebody reads at a glance. */
export function countdown(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
