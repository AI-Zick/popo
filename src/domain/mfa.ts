/**
 * The second factor.
 *
 * CJIS requires more than a password to reach criminal justice information,
 * and the reason is not compliance: a password is the credential that gets
 * phished, reused, shoulder-surfed in a squad room and written on the back of
 * a mobile data terminal. The second factor is what makes a stolen password
 * insufficient.
 *
 * This implements time-based one-time passwords — RFC 6238, the six digits an
 * authenticator app shows — because it is the factor an agency can adopt
 * without buying anything, works with no network on the device, and involves
 * no third party at all. Nothing here talks to a vendor: the secret is
 * generated on the agency's own server and verified there.
 *
 * ## What this is not
 *
 * It is not phishing-resistant. Somebody who can convince an officer to read
 * six digits down a telephone can use them within thirty seconds. The answer
 * to that is WebAuthn with a security key, where the browser refuses to sign
 * for the wrong origin, and this file is deliberately shaped so a second
 * method can be added beside it rather than replacing it — a shared cruiser
 * terminal is exactly where a hardware key is awkward and an app is not.
 *
 * ## Verified rather than believed
 *
 * The test file runs the RFC's own vectors. An almost-correct TOTP is the
 * worst possible outcome: it works for the developer, and fails for one
 * officer in a hundred whose clock has drifted, at three in the morning.
 */

import { sha256Hex } from './chain';
import { capacity, MAX_VERSION } from '../lib/qr';

/* ------------------------------------------------------------------ */
/* Base32, because that is what authenticator apps read                */
/* ------------------------------------------------------------------ */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array {
  // Padding and spacing are how people transcribe these; neither is data.
  const clean = input.toUpperCase().replace(/[=\s-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const character of clean) {
    const index = ALPHABET.indexOf(character);
    if (index === -1) throw new Error(`"${character}" is not part of a setup key.`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/* ------------------------------------------------------------------ */
/* The code itself                                                     */
/* ------------------------------------------------------------------ */

/** Seconds per code. Thirty is what every authenticator app assumes. */
export const STEP_SECONDS = 30;
export const DIGITS = 6;

/** A twenty-byte secret, which is what RFC 4226 recommends for HMAC-SHA1. */
export function generateSecret(random: (n: number) => Uint8Array): string {
  return base32Encode(random(20));
}

/** Which time step a moment falls in. */
export const counterFor = (atMs: number): number =>
  Math.floor(atMs / 1000 / STEP_SECONDS);

/**
 * One code, for one counter.
 *
 * HMAC-SHA1 rather than something modern because the algorithm is fixed by
 * what authenticator apps implement. The weakness of SHA-1 as a hash is not
 * the weakness that matters here — an attacker has thirty seconds and six
 * digits, and rate limiting is what stands between them and a guess.
 */
export async function codeFor(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret) as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  // The counter as eight bytes, big-endian. Written by hand because a
  // 64-bit counter does not fit a JavaScript number's bitwise operators.
  const message = new Uint8Array(8);
  let remaining = counter;
  for (let i = 7; i >= 0; i -= 1) {
    message[i] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }

  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, message as unknown as ArrayBuffer),
  );

  // Dynamic truncation, RFC 4226 §5.3.
  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    (signature[offset + 1] << 16) |
    (signature[offset + 2] << 8) |
    signature[offset + 3];

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * How far out of step a clock may be and still work.
 *
 * One step either way — thirty seconds. Wider would be kinder to a badly set
 * clock and would also widen the window an intercepted code stays usable in,
 * and the second consideration wins on a system holding criminal justice
 * information.
 */
export const DRIFT_STEPS = 1;

export interface Verification {
  ok: boolean;
  /** The counter the code matched, so a replay of it can be refused. */
  counter: number | null;
  reason?: string;
}

/**
 * Checks a code, and says which step it was for.
 *
 * `lastCounter` is the last step this account successfully used. A code is
 * refused if it is not newer, which is what stops somebody who watched an
 * officer type it from using the same six digits ten seconds later. RFC 6238
 * asks for exactly this and it is the part implementations skip.
 */
export async function verifyCode(
  secret: string,
  input: string,
  options: { atMs?: number; lastCounter?: number } = {},
): Promise<Verification> {
  const code = String(input ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, counter: null, reason: 'A code is six digits.' };
  }

  const now = counterFor(options.atMs ?? Date.now());
  const last = options.lastCounter ?? -1;

  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift += 1) {
    const counter = now + drift;
    if (counter <= last) continue;
    if (equal(code, await codeFor(secret, counter))) return { ok: true, counter };
  }

  // A code that is right but already used gets its own answer: the officer
  // has typed the right thing and needs to be told to wait, not to try again.
  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift += 1) {
    const counter = now + drift;
    if (counter > last) continue;
    if (equal(code, await codeFor(secret, counter))) {
      return {
        ok: false,
        counter: null,
        reason: 'That code has already been used. Wait for the next one.',
      };
    }
  }

  return { ok: false, counter: null, reason: 'That code is not right.' };
}

/** Length-independent comparison, so a wrong code leaks nothing by timing. */
function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/* ------------------------------------------------------------------ */
/* Getting it into the app                                             */
/* ------------------------------------------------------------------ */

/**
 * How much agency name the label carries.
 *
 * The whole URI has to fit in a QR code somebody can scan off a monitor, and
 * every character of it costs modules. Consolidated agencies really are named
 * things like "Wapsipinicon Valley Regional Communications Commission", and
 * URL-encoding a name like that twice is most of the budget. Trimming it costs
 * nothing that matters — this is a line in a list on a phone, and the officer
 * who reads it needs to tell it from their bank, not from another agency.
 */
export const LABEL_LIMIT = 42;

const shortened = (name: string): string =>
  name.length <= LABEL_LIMIT ? name : `${name.slice(0, LABEL_LIMIT - 1).trimEnd()}…`;

/**
 * What a version 10 QR code holds, which is the real ceiling on this URI.
 *
 * Taken from the encoder rather than written down here, so that raising one
 * cannot silently disagree with the other.
 */
export const URI_BUDGET = capacity(MAX_VERSION);

/**
 * The `otpauth://` URL an authenticator app reads from a QR code.
 *
 * The issuer appears twice by convention — once in the label and once as a
 * parameter — because apps disagree about which they read, and an officer
 * with four entries all called "Aegis" is an officer who picks the wrong one.
 *
 * SHA-1, six digits and thirty seconds are the defaults every app assumes, so
 * they are left out: naming them costs thirty-eight characters of QR code and
 * buys nothing.
 */
export function provisioningUri(secret: string, account: string, issuer: string): string {
  const build = (name: string, who: string): string =>
    `otpauth://totp/${encodeURIComponent(`${name}:${who}`)}?${new URLSearchParams({ secret, issuer: name }).toString()}`;
  const fits = (uri: string): boolean => new TextEncoder().encode(uri).length <= URI_BUDGET;

  let name = shortened(issuer.trim());
  let who = account.trim();

  /*
    The character limit above is about readability; this is about whether the
    thing encodes at all. Accented characters cost three bytes each once they
    are percent-encoded — nine characters of URI — so a name well inside the
    label limit can still be too long to draw. The agency name gives ground
    first: it is written twice, so every character removed is worth two, and
    the account name is the half that says whose entry this is.
  */
  while (name.length > 1 && !fits(build(name, who))) name = name.slice(0, -1);
  while (who.length > 1 && !fits(build(name, who))) who = who.slice(0, -1);

  return build(name, who);
}

/** The setup key in readable groups, for somebody typing it by hand. */
export const formatSecret = (secret: string): string =>
  secret.replace(/(.{4})/g, '$1 ').trim();

/* ------------------------------------------------------------------ */
/* Recovery codes                                                      */
/* ------------------------------------------------------------------ */

export const RECOVERY_CODE_COUNT = 10;

/**
 * The way back in when the phone is gone.
 *
 * A second factor with no recovery path is a way to lock an officer out of the
 * system they need at three in the morning, and the workaround an agency
 * invents for that is worse than anything here. These are the sanctioned
 * version: long enough not to be guessed, single-use, and their use is
 * recorded as a security event because using one means something went wrong.
 */
export function generateRecoveryCodes(random: (n: number) => Uint8Array): string[] {
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
    // Ten base32 characters — about fifty bits, which no online guesser gets
    // through and no officer minds copying down.
    const raw = base32Encode(random(7)).slice(0, 10);
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

export const normaliseRecoveryCode = (code: string): string =>
  String(code ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '');

/**
 * Stored hashed, but with a plain hash rather than a password hash.
 *
 * A password is short and human-chosen, so it needs a slow hash to survive
 * somebody who steals the database. A recovery code is fifty random bits;
 * there is nothing to brute-force, and a slow hash would only mean checking
 * ten of them takes a visible moment on every attempt.
 */
export const hashRecoveryCode = (code: string): Promise<string> =>
  sha256Hex(normaliseRecoveryCode(code));

export async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map(hashRecoveryCode));
}

/**
 * Finds which stored code this is, if any. Returns the index so the caller can
 * spend it — a recovery code that survives its own use is not a recovery code.
 */
export async function matchRecoveryCode(hashes: string[], input: string): Promise<number> {
  const normalised = normaliseRecoveryCode(input);
  if (normalised.length < 8) return -1;
  const candidate = await hashRecoveryCode(normalised);
  return hashes.findIndex((stored) => equal(stored, candidate));
}

/* ------------------------------------------------------------------ */
/* What the screens need to know                                       */
/* ------------------------------------------------------------------ */

export interface MfaState {
  /** A confirmed second factor is on this account. */
  enrolled: boolean;
  /** Enrolment started and was never confirmed — the secret is not live. */
  pending: boolean;
  confirmedAt: string;
  recoveryRemaining: number;
}

export function mfaState(credential: {
  mfaSecret?: string;
  mfaConfirmedAt?: string;
  recoveryCodes?: string[];
}): MfaState {
  const secret = credential.mfaSecret ?? '';
  const confirmedAt = credential.mfaConfirmedAt ?? '';
  return {
    enrolled: Boolean(secret && confirmedAt),
    pending: Boolean(secret && !confirmedAt),
    confirmedAt,
    recoveryRemaining: (credential.recoveryCodes ?? []).length,
  };
}

/** Worth telling somebody about before they are locked out by it. */
export const LOW_RECOVERY_CODES = 3;
