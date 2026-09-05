/**
 * Getting back in when the password is gone.
 *
 * ## What a reset link is and is not
 *
 * A link mailed to somebody's inbox is a bearer token: whoever holds it can
 * set the password. That makes the mailbox a way into the records system, and
 * it is worth being plain that this is the trade — an officer's county email,
 * which this agency may not run and which is protected by a password of its
 * own, becomes the thing standing between an outsider and an account.
 *
 * So the link is deliberately not enough on its own.
 *
 * **It sets the password. It does not sign you in.** After a reset the officer
 * goes to the sign-in screen and signs in normally, which means the second
 * factor is still asked for. Somebody who has stolen the mailbox has the
 * password and still cannot get in without the phone. This is the single most
 * important line in the feature, and it is why resetting deliberately does not
 * hand back a session the way signing in does.
 *
 * **It dies quickly, and it dies on use.** One password, one link, thirty
 * minutes. A link that still works tomorrow is a link sitting in a mailbox
 * that gets read by the next person to use the terminal.
 *
 * **It is stored hashed.** A database that can be read gives up its tokens
 * otherwise, and the point of a short-lived token is lost if the place it
 * lives is the place an attacker already is.
 *
 * **Every other session ends.** Somebody resetting a password has usually lost
 * control of something, and leaving the sessions that were open on it is
 * leaving the door they came through.
 *
 * ## Saying nothing
 *
 * The request endpoint answers identically whether or not the account exists.
 * A "no such user" is a way to work out who has an account here, which for a
 * police agency is a roster, and rosters are the first thing somebody building
 * a phishing campaign wants.
 */

import type { UUID } from './person';

/** Thirty minutes. Long enough to walk to a computer, short enough to matter. */
export const TOKEN_MINUTES = 30;

/**
 * A reset that has been asked for.
 *
 * The token itself is never here — only its hash. What was mailed exists in
 * exactly one place, which is the officer's inbox.
 */
export interface ResetRequest {
  id: UUID;
  userId: UUID;
  /** SHA-256 of the token that was mailed. */
  tokenHash: string;
  requestedAt: string;
  expiresAt: string;
  /** When it was spent. Empty while unspent. */
  usedAt: string;
  /** Where the request came from, for the audit trail. */
  requestedFrom: string;
}

export type ResetState = 'usable' | 'spent' | 'expired';

/**
 * What this request is, right now. Derived, like every other state here.
 *
 * Spent beats expired: a token somebody used and then re-presented is a
 * different event from one that simply ran out, and the first is worth
 * noticing.
 */
export function resetState(request: ResetRequest, now: Date = new Date()): ResetState {
  if (request.usedAt) return 'spent';
  if (new Date(request.expiresAt).getTime() <= now.getTime()) return 'expired';
  return 'usable';
}

export const isUsable = (request: ResetRequest, now: Date = new Date()): boolean =>
  resetState(request, now) === 'usable';

/**
 * Why a link did not work, in words for the person holding it.
 *
 * Deliberately the same wording for spent and expired. Both mean "ask for
 * another one", and distinguishing them tells somebody who is not the account
 * holder whether they are holding a link that was already used — which is
 * information about the officer, not about the link.
 */
export const LINK_NO_GOOD =
  'This link has expired or has already been used. Ask for another one — they last ' +
  `${TOKEN_MINUTES} minutes.`;

/**
 * What the request screen says, whether or not the account exists.
 *
 * One sentence, said every time. It cannot promise an email was sent, because
 * for most of the addresses somebody types here none was.
 */
export const REQUEST_ACKNOWLEDGED =
  'If that matches an account with an email address on it, a link is on its way. ' +
  'It lasts ' +
  `${TOKEN_MINUTES} minutes. If nothing arrives, your administrator can reset it for you.`;

/* ------------------------------------------------------------------ */
/* Addresses                                                           */
/* ------------------------------------------------------------------ */

/**
 * Good enough to catch a typo, deliberately not a full RFC 5322 parser.
 *
 * The cost of being too strict here is refusing somebody's real address, which
 * is worse than accepting one that bounces: a bounce is visible and fixable,
 * and a refusal at account creation means the officer has no recovery path at
 * all and nobody finds out until they need one.
 */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  const at = trimmed.indexOf('@');
  if (at < 1 || at !== trimmed.lastIndexOf('@')) return false;
  const domain = trimmed.slice(at + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

/**
 * An address with most of it hidden, for saying which one was written to.
 *
 * `m****z@cedarfalls.gov`. Enough for the officer to recognise their own
 * address, not enough to hand somebody else a target.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return '';
  const name = email.slice(0, at);
  const domain = email.slice(at);
  if (name.length <= 2) return `${name[0]}*${domain}`;
  return `${name[0]}${'*'.repeat(Math.min(name.length - 2, 6))}${name[name.length - 1]}${domain}`;
}

/* ------------------------------------------------------------------ */
/* Whether the agency can do this at all                               */
/* ------------------------------------------------------------------ */

/**
 * Where the agency's mail goes out through.
 *
 * Ships empty and stays empty until somebody fills it in — the same honesty
 * the statute and GIS settings use. An unconfigured mail server must read as
 * unconfigured, because the alternative is a sign-in screen offering a reset
 * that silently goes nowhere, which is worse than not offering one.
 */
export interface MailSettings {
  host: string;
  port: number;
  /** STARTTLS on the submission port, or implicit TLS on 465. */
  secure: boolean;
  username: string;
  /** Write-only from the browser's point of view; never sent back out. */
  password: string;
  /** The From: address. Usually a no-reply on the agency's own domain. */
  from: string;
  /**
   * Where reset links point.
   *
   * Held here rather than guessed from the request, because a link built from
   * a Host header is a link an attacker can aim at their own server by sending
   * one. It has to be configuration.
   */
  baseUrl: string;
}

export const emptyMailSettings = (): MailSettings => ({
  host: '',
  port: 587,
  secure: false,
  username: '',
  password: '',
  from: '',
  baseUrl: '',
});

export interface MailCheck {
  ok: boolean;
  /** What is missing, in the order somebody would fill it in. */
  problems: string[];
}

export function checkMail(settings: MailSettings): MailCheck {
  const problems: string[] = [];
  if (!settings.host.trim()) problems.push('No mail server is set.');
  if (!Number.isFinite(settings.port) || settings.port <= 0 || settings.port > 65535) {
    problems.push('The port is not a number between 1 and 65535.');
  }
  if (!settings.from.trim()) problems.push('No From address is set.');
  else if (!looksLikeEmail(settings.from)) problems.push('The From address does not look like an email address.');
  if (!settings.baseUrl.trim()) {
    problems.push('No address is set for this installation, so links cannot be built.');
  } else if (!/^https?:\/\//i.test(settings.baseUrl.trim())) {
    problems.push('The address of this installation must start with http:// or https://.');
  }
  return { ok: problems.length === 0, problems };
}

/** Whether the agency has enough set up for the sign-in screen to offer this. */
export const canSendMail = (settings: MailSettings): boolean => checkMail(settings).ok;

/** The link an officer is mailed. */
export function resetLink(settings: MailSettings, token: string): string {
  const base = settings.baseUrl.trim().replace(/\/+$/, '');
  return `${base}/?reset=${encodeURIComponent(token)}`;
}
