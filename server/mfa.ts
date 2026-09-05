/**
 * Second-factor routes.
 *
 * Everything here is reachable by a session that has passed a password and
 * nothing more, which is the point — a half-signed-in officer has to be able
 * to enrol or present a code, and must not be able to do anything else. Every
 * other route in this system refuses that session; see `requireAuth`.
 *
 * The rules worth reading:
 *
 * **A secret is not live until it is confirmed.** Enrolment writes a secret
 * and does nothing else. It becomes the account's second factor only once a
 * code computed from it has been produced, which proves the officer's app
 * actually holds it. Getting this backwards locks people out of the system
 * with a secret they never successfully scanned.
 *
 * **A used code is refused.** The time step is recorded and a code for that
 * step or earlier is rejected, so somebody who read the six digits over a
 * shoulder cannot use them in the twenty seconds they remain valid.
 *
 * **Recovery codes are spent.** One use, removed, and the use is a security
 * event in the audit log — needing one means something went wrong.
 */

import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { getCredential, getUserById, mfaRequired, saveCredential, upgradeSession, setSessionCookie } from './auth';
import { recordAudit } from './audit';
import { can, canManageUser } from '../src/domain/auth';
import {
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCodes,
  matchRecoveryCode,
  mfaState,
  provisioningUri,
  verifyCode,
} from '../src/domain/mfa';
import {
  isLockedOut,
  lockoutRemainingMs,
  registerFailure,
  type Credential,
} from '../src/domain/session';

const random = (size: number): Uint8Array => new Uint8Array(randomBytes(size));
const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);

/**
 * The agency's name, for the entry an authenticator app shows.
 *
 * An officer with four unlabelled entries is an officer who reads the wrong
 * one at the wrong moment.
 */
function issuerFor(db: DatabaseSync): string {
  const row = db.prepare('SELECT doc FROM agency WHERE id = ?').get('default') as
    | { doc: string }
    | undefined;
  const name = row ? (JSON.parse(row.doc) as { name?: string }).name : '';
  return name?.trim() || 'Aegis RMS';
}

/** A half-session is enough to be here, and not enough to be anywhere else. */
function signedInAtAll(req: Request, res: Response): boolean {
  if (!req.user || !req.session) {
    res.status(401).json({ error: 'Not signed in.' });
    return false;
  }
  return true;
}

export function registerMfaRoutes(app: Express, db: DatabaseSync): void {
  /** What this account has, and what the agency insists on. */
  app.get('/api/auth/mfa', (req: Request, res: Response) => {
    if (!signedInAtAll(req, res)) return;
    const credential = getCredential(db, req.user!.id);
    res.json({
      ...mfaState(credential ?? {}),
      required: mfaRequired(db),
      // Never the secret. A confirmed account has no reason to see it again,
      // and an unconfirmed one gets it from the enrolment route.
    });
  });

  /**
   * Starts enrolment. Issues a secret; changes nothing about how sign-in works.
   *
   * Re-enrolling while already enrolled is allowed and deliberate — an officer
   * replacing a phone does exactly that — but the existing factor stays live
   * until the new one is confirmed.
   */
  app.post('/api/auth/mfa/begin', async (req: Request, res: Response) => {
    if (!signedInAtAll(req, res)) return;
    const user = req.user!;
    const credential = getCredential(db, user.id);
    if (!credential) {
      res.status(400).json({ error: 'No credential on file.' });
      return;
    }

    const secret = generateSecret(random);
    saveCredential(db, { ...credential, mfaSecret: secret, mfaConfirmedAt: '' });

    res.json({
      secret,
      uri: provisioningUri(secret, user.username, issuerFor(db)),
    });
  });

  /**
   * Confirms it, by asking for a code the secret produces.
   *
   * This is where the account actually gains a second factor, and where the
   * recovery codes are issued — once, in this response, and never again. They
   * are hashed before they are stored, so a database that leaks does not leak
   * a way past the factor it is protecting.
   */
  app.post('/api/auth/mfa/confirm', async (req: Request, res: Response) => {
    if (!signedInAtAll(req, res)) return;
    const user = req.user!;
    const credential = getCredential(db, user.id);
    if (!credential?.mfaSecret) {
      res.status(400).json({ error: 'Start setting it up first.' });
      return;
    }

    const result = await verifyCode(credential.mfaSecret, text(req.body?.code, 10), {
      lastCounter: credential.mfaLastCounter,
    });
    if (!result.ok) {
      res.status(400).json({ error: result.reason ?? 'That code is not right.' });
      return;
    }

    const codes = generateRecoveryCodes(random);
    const now = new Date().toISOString();
    saveCredential(db, {
      ...credential,
      mfaConfirmedAt: now,
      mfaLastCounter: result.counter ?? -1,
      mfaFailed: 0,
      recoveryCodes: await hashRecoveryCodes(codes),
    });

    /*
      Confirming enrolment finishes the sign-in it happened during. The officer
      has just proved the second factor; asking for it again immediately would
      be theatre, and the session is upgraded to a new id either way.
    */
    const upgraded = upgradeSession(db, req.session!);
    setSessionCookie(res, upgraded.id);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'auth.mfaEnrolled',
      target: '',
      detail: 'Authenticator app',
    });

    // The only time these are ever readable.
    res.json({ recoveryCodes: codes });
  });

  /** The second step of signing in. */
  app.post('/api/auth/mfa/verify', async (req: Request, res: Response) => {
    if (!signedInAtAll(req, res)) return;
    const user = req.user!;
    const credential = getCredential(db, user.id);
    const state = mfaState(credential ?? {});
    if (!credential || !state.enrolled) {
      res.status(400).json({ error: 'There is no second factor on this account.' });
      return;
    }
    const locked = lockedOut(credential, res);
    if (locked) return;

    const result = await verifyCode(credential.mfaSecret, text(req.body?.code, 10), {
      lastCounter: credential.mfaLastCounter,
    });

    if (!result.ok) {
      await refuse(db, credential, user, result.reason ?? 'That code is not right.', res);
      return;
    }

    saveCredential(db, {
      ...credential,
      mfaLastCounter: result.counter ?? credential.mfaLastCounter,
      mfaFailed: 0,
    });
    finish(db, req, res, user, 'Authenticator app');
  });

  /**
   * The way back in when the phone is gone.
   *
   * Spends the code, and says how many are left — an officer down to their
   * last one needs to know before it is their last one.
   */
  app.post('/api/auth/mfa/recovery', async (req: Request, res: Response) => {
    if (!signedInAtAll(req, res)) return;
    const user = req.user!;
    const credential = getCredential(db, user.id);
    if (!credential || !mfaState(credential).enrolled) {
      res.status(400).json({ error: 'There is no second factor on this account.' });
      return;
    }
    const locked = lockedOut(credential, res);
    if (locked) return;

    const index = await matchRecoveryCode(credential.recoveryCodes, text(req.body?.code, 40));
    if (index === -1) {
      await refuse(db, credential, user, 'That recovery code is not one of yours.', res);
      return;
    }

    const remaining = credential.recoveryCodes.filter((_, i) => i !== index);
    saveCredential(db, { ...credential, recoveryCodes: remaining, mfaFailed: 0 });

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'auth.mfaRecoveryUsed',
      target: '',
      detail: `${remaining.length} left`,
    });

    finish(db, req, res, user, 'Recovery code', { recoveryRemaining: remaining.length });
  });

  /**
   * An administrator clears somebody's second factor.
   *
   * The unavoidable back door: an officer whose phone is at the bottom of a
   * lake and whose recovery codes are in a drawer at home still has to be able
   * to write a report. What makes it survivable is that it is loud — it needs
   * account management authority, it is a security event in the audit log, and
   * the officer must enrol again at their next sign-in.
   */
  app.post('/api/users/:id/mfa/reset', async (req: Request, res: Response) => {
    if (!signedInAtAll(req, res)) return;
    const actor = req.user!;
    if (req.session!.factor !== 'full') {
      res.status(401).json({ error: 'Finish signing in.' });
      return;
    }
    if (!can(actor, 'users.manage')) {
      res.status(403).json({ error: 'You do not have permission to do that.' });
      return;
    }

    const credential = getCredential(db, text(req.params.id, 64));
    if (!credential) {
      res.status(404).json({ error: 'No such account.' });
      return;
    }
    const target = getUserById(db, credential.userId);
    if (!target) {
      res.status(404).json({ error: 'No such account.' });
      return;
    }
    /*
      The same ceiling every other account operation has, and missing here
      until now: an agency administrator could clear the vendor's second
      factor, which is reaching above their own authority by exactly the route
      that authority is supposed to close.
    */
    if (!canManageUser(actor, target)) {
      res.status(403).json({ error: 'This account has more authority than yours.' });
      return;
    }

    const reason = text(req.body?.reason, 500).trim();
    if (!reason) {
      res.status(400).json({
        error: 'Say why. Clearing somebody’s second factor is the one way past it.',
      });
      return;
    }

    saveCredential(db, {
      ...credential,
      mfaSecret: '',
      mfaConfirmedAt: '',
      mfaLastCounter: -1,
      mfaFailed: 0,
      recoveryCodes: [],
    });
    // Their sessions go too: a signed-in device must not outlive the factor.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(credential.userId);

    await recordAudit(db, {
      actorId: actor.id,
      actorName: actor.name,
      action: 'auth.mfaReset',
      target: target.name,
      detail: reason,
    });

    res.json({ ok: true });
  });
}

/* ------------------------------------------------------------------ */

function lockedOut(credential: Credential, res: Response): boolean {
  if (!isLockedOut(credential)) return false;
  const minutes = Math.ceil(lockoutRemainingMs(credential) / 60_000);
  res.status(429).json({
    error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask an administrator.`,
  });
  return true;
}

/**
 * A wrong code, counted.
 *
 * On the same lockout the password uses, because an attacker who has the
 * password and is guessing six digits is exactly who this is for: a million
 * guesses is nothing, five is.
 */
async function refuse(
  db: DatabaseSync,
  credential: Credential,
  user: { id: string; name: string },
  message: string,
  res: Response,
): Promise<void> {
  const failed = registerFailure({ ...credential, failedAttempts: credential.mfaFailed });
  saveCredential(db, {
    ...credential,
    mfaFailed: failed.failedAttempts,
    lockedUntil: failed.lockedUntil,
  });

  await recordAudit(db, {
    actorId: user.id,
    actorName: user.name,
    action: 'auth.mfaFailed',
    target: '',
    detail: `Attempt ${failed.failedAttempts}`,
  });
  if (isLockedOut(failed)) {
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'auth.lockout',
      target: '',
      detail: 'Locked after repeated second-factor failures',
    });
  }

  res.status(401).json({ error: message });
}

/** Upgrades the session and answers. The only place a half-session grows up. */
function finish(
  db: DatabaseSync,
  req: Request,
  res: Response,
  user: { id: string; name: string; role: string },
  how: string,
  extra: Record<string, unknown> = {},
): void {
  const upgraded = upgradeSession(db, req.session!);
  setSessionCookie(res, upgraded.id);
  void recordAudit(db, {
    actorId: user.id,
    actorName: user.name,
    action: 'auth.signIn',
    target: '',
    detail: `${user.role} · ${how}`,
  });
  res.json({ ok: true, user, ...extra });
}
