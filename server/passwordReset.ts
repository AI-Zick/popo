/**
 * Forgotten-password routes.
 *
 * The three rules that make a mailed reset link tolerable in a system holding
 * criminal justice information are all enforced here, and none of them is in
 * the browser:
 *
 *   **A link sets the password. It does not sign you in.** Nothing here issues
 *   a session. The officer resets, then signs in, which means the second
 *   factor is still asked for. Somebody who has stolen the mailbox ends up
 *   holding a password and still cannot get in. This is the whole reason it is
 *   acceptable to mail a link at all, and it is one line: no session is
 *   created.
 *
 *   **Saying nothing.** The request route answers identically whether the
 *   account exists, has an email, or is deactivated, and takes the same rough
 *   time either way. A different answer is a way to enumerate the roster of a
 *   police agency.
 *
 *   **The link dies on use and on time.** Single use, thirty minutes, stored
 *   as a hash. Requesting a new one kills the ones before it, so a mailbox
 *   with four old links in it has four dead links in it.
 *
 * Resetting also ends every session the account had open. Somebody resetting a
 * password has usually lost control of something, and leaving those sessions
 * up is leaving the door they came through.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { newId } from './ids';
import { getCredential, getUserById, rowToUser, saveCredential } from './auth';
import { recordAudit } from './audit';
import { send, MailNotConfigured } from './mail';
import { checkPassword, hashPassword, verifyPassword } from '../src/domain/credentials';
import { emptyAgency, type AgencyProfile } from '../src/domain/agency';
import {
  canSendMail,
  LINK_NO_GOOD,
  maskEmail,
  REQUEST_ACKNOWLEDGED,
  resetLink,
  TOKEN_MINUTES,
} from '../src/domain/passwordReset';
import { createAttemptGuard } from './hardening';

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);

/** The agency profile, or an unconfigured one — never a throw on a sign-in path. */
function readAgency(db: DatabaseSync): AgencyProfile {
  const row = db.prepare('SELECT doc FROM agency WHERE id = ?').get('default') as
    | { doc: string }
    | undefined;
  if (!row) return emptyAgency();
  try {
    return { ...emptyAgency(), ...(JSON.parse(row.doc) as Partial<AgencyProfile>) };
  } catch {
    return emptyAgency();
  }
}

/** SHA-256, hex. The token is high-entropy random, so no salt or stretching. */
const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

interface RequestRow {
  id: string;
  user_id: string;
  token_hash: string;
  requested_at: string;
  expires_at: string;
  used_at: string;
  requested_from: string;
}

/**
 * Constant-time compare of two hex digests.
 *
 * The lookup below is by indexed hash, so this is belt and braces — but the
 * cost is nothing and the failure it guards against is the one nobody notices
 * in review.
 */
function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function registerPasswordResetRoutes(app: Express, db: DatabaseSync): void {
  /*
    Rate limited by source, and spent on every request — unlike the change
    route, every request here really is an attempt at somebody's account, and
    there is no legitimate reason to ask for ten links in a minute.
  */
  const guard = createAttemptGuard({ windowMs: 15 * 60_000, max: 8 });

  /** Whether the sign-in screen should offer this at all. */
  app.get('/api/auth/forgot', (_req: Request, res: Response) => {
    const agency = readAgency(db);
    res.json({ available: canSendMail(agency.mail), minutes: TOKEN_MINUTES });
  });

  /**
   * "I cannot sign in."
   *
   * Always 200, always the same words. Everything interesting that can go
   * wrong here — no such user, no address on the account, the account is
   * deactivated — is invisible on purpose.
   */
  app.post('/api/auth/forgot', async (req: Request, res: Response) => {
    const wait = guard.waitSeconds(req);
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      res.status(429).json({
        error: `Too many requests. Wait ${wait} second${wait === 1 ? '' : 's'} and try again.`,
      });
      return;
    }
    guard.spend(req);

    const acknowledged = { ok: true, message: REQUEST_ACKNOWLEDGED };
    const agency = readAgency(db);
    if (!canSendMail(agency.mail)) {
      /*
        Refused rather than acknowledged. This one case is safe to be honest
        about, because it is a fact about the installation rather than about
        any account, and the person reading it needs to stop waiting for an
        email that cannot come.
      */
      res.status(503).json({
        error:
          'This installation cannot send email yet, so there is no link to send. Your administrator can reset your password for you.',
      });
      return;
    }

    // A username, or the address itself — somebody locked out will try both.
    const typed = text(req.body?.who, 200).trim().toLowerCase();
    if (!typed) {
      res.json(acknowledged);
      return;
    }

    const row = db
      .prepare('SELECT * FROM users WHERE username = ? OR (email <> ? AND email = ?)')
      .get(typed, '', typed) as unknown as Parameters<typeof rowToUser>[0] | undefined;
    const user = row ? rowToUser(row) : null;

    if (!user || !user.active || !user.email) {
      res.json(acknowledged);
      return;
    }

    // Any link already outstanding for this account stops working now.
    db.prepare("UPDATE reset_requests SET used_at = ? WHERE user_id = ? AND used_at = ''").run(
      new Date().toISOString(),
      user.id,
    );

    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    db.prepare(
      `INSERT INTO reset_requests (id, user_id, token_hash, requested_at, expires_at, used_at, requested_from)
       VALUES (?, ?, ?, ?, ?, '', ?)`,
    ).run(
      newId('rst'),
      user.id,
      hashToken(token),
      now.toISOString(),
      new Date(now.getTime() + TOKEN_MINUTES * 60_000).toISOString(),
      String(req.ip ?? ''),
    );

    try {
      await send(agency.mail, {
        to: user.email,
        subject: `${agency.name || 'Aegis RMS'}: setting a new password`,
        text: [
          `${user.name},`,
          '',
          'Somebody asked to set a new password on your account. Open this to do it:',
          '',
          resetLink(agency.mail, token),
          '',
          `The link works once and stops working after ${TOKEN_MINUTES} minutes.`,
          '',
          'Setting a new password does not sign you in — you will still be asked for',
          'your authenticator code when you sign in afterwards.',
          '',
          'If this was not you, your password has not changed and nothing has happened',
          'to your account. Tell your administrator.',
        ].join('\n'),
      });
    } catch (problem) {
      /*
        A send that fails is said out loud. The officer is standing at a
        terminal waiting, and "check your email" when the mail server refused
        the message is twenty minutes of somebody's shift.
      */
      const why =
        problem instanceof MailNotConfigured
          ? 'This installation cannot send email yet.'
          : 'The mail server would not take the message.';
      await recordAudit(db, {
        actorId: user.id,
        actorName: user.name,
        action: 'auth.resetRequested',
        target: '',
        detail: `Send failed: ${problem instanceof Error ? problem.message.slice(0, 120) : 'unknown'}`,
      });
      res.status(502).json({
        error: `${why} Your administrator can reset your password for you.`,
      });
      return;
    }

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'auth.resetRequested',
      target: '',
      detail: `Link sent to ${maskEmail(user.email)}`,
    });
    res.json(acknowledged);
  });

  /**
   * Is this link any good?
   *
   * Asked before the form is drawn, so somebody holding a dead link is told so
   * rather than typing a password twice and then being refused.
   */
  app.get('/api/auth/reset', (req: Request, res: Response) => {
    const found = usable(db, text(req.query.token, 200));
    res.json(found ? { ok: true, name: found.user.name } : { ok: false, error: LINK_NO_GOOD });
  });

  /**
   * Sets the password. Deliberately does not sign anybody in.
   */
  app.post('/api/auth/reset', async (req: Request, res: Response) => {
    const wait = guard.waitSeconds(req);
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      res.status(429).json({ error: `Too many attempts. Wait ${wait} seconds and try again.` });
      return;
    }

    const token = text(req.body?.token, 200);
    const found = usable(db, token);
    if (!found) {
      guard.spend(req);
      res.status(400).json({ error: LINK_NO_GOOD });
      return;
    }

    const next = String(req.body?.next ?? '');
    const policy = checkPassword(next, {
      username: found.user.username,
      name: found.user.name,
    });
    if (!policy.ok) {
      // Not a spend: choosing a password is not guessing at one.
      res.status(400).json({ error: policy.problems.join(' ') });
      return;
    }

    const credential = getCredential(db, found.user.id);
    if (credential?.passwordHash && (await verifyPassword(next, credential.passwordHash))) {
      res.status(400).json({ error: 'That is the password you already have. Choose a different one.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE reset_requests SET used_at = ? WHERE id = ?').run(now, found.row.id);
    saveCredential(db, {
      ...(credential ?? { userId: found.user.id }),
      userId: found.user.id,
      passwordHash: await hashPassword(next),
      mustChangePassword: false,
      passwordChangedAt: now,
    } as Parameters<typeof saveCredential>[1]);

    /*
      Every session on this account ends, including any the person who took it
      over was holding. There is no exception for "the current one" because
      there is no current one: this route issues nothing.
    */
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(found.user.id);

    await recordAudit(db, {
      actorId: found.user.id,
      actorName: found.user.name,
      action: 'auth.resetCompleted',
      target: '',
      detail: 'Signed out everywhere',
    });

    res.json({ ok: true });
  });
}

/** The request behind a token, if there is a live one. */
function usable(
  db: DatabaseSync,
  token: string,
): { row: RequestRow; user: NonNullable<ReturnType<typeof getUserById>> } | null {
  if (!token) return null;
  const digest = hashToken(token);
  const row = db
    .prepare("SELECT * FROM reset_requests WHERE token_hash = ? AND used_at = ''")
    .get(digest) as unknown as RequestRow | undefined;
  if (!row || !sameDigest(row.token_hash, digest)) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  const user = getUserById(db, row.user_id);
  if (!user || !user.active) return null;
  return { row, user };
}
