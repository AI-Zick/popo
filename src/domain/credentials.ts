/**
 * Password storage and verification.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  THIS IS NOT YET A SECURITY BOUNDARY.
 *
 *  Everything here runs in the browser, where the person being checked
 *  controls the code doing the checking. Anyone can open dev tools and set
 *  whatever state they like. What this module provides is a *correct* auth
 *  mechanism — the right algorithm, parameters, comparisons and failure
 *  handling — deliberately written with no browser-specific assumptions, so
 *  that moving verification behind an API is a relocation rather than a
 *  rewrite.
 *
 *  Until that move happens, treat the sign-in screen as a workflow, not a lock.
 * ─────────────────────────────────────────────────────────────────────
 *
 * PBKDF2-HMAC-SHA256 is used because it is available through WebCrypto in both
 * the browser and Node with no dependency. Argon2id is the better choice and
 * is what the server-side implementation should use; the stored format carries
 * its algorithm so records can be upgraded in place on next sign-in.
 */

/** OWASP's floor for PBKDF2-HMAC-SHA256. */
export const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('WebCrypto unavailable');
  return c.subtle;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await subtle().importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** `pbkdf2$sha256$<iterations>$<salt>$<hash>` */
export async function hashPassword(password: string): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/**
 * Comparison is constant-time with respect to the digest contents. A plain
 * `===` on the encoded strings would leak, through timing, how much of a
 * guessed hash was correct.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 5) return false;
  const [scheme, digest, iterationsRaw, saltRaw, hashRaw] = parts;
  if (scheme !== 'pbkdf2' || digest !== 'sha256') return false;

  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations < 1) return false;

  try {
    const expected = fromBase64(hashRaw);
    const actual = await derive(password, fromBase64(saltRaw), iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** True when a stored hash was made with weaker parameters than we now use. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 5) return true;
  if (parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return true;
  return Number(parts[2]) < PBKDF2_ITERATIONS;
}

/* ------------------------------------------------------------------ */
/* Policy                                                              */
/* ------------------------------------------------------------------ */

export const MIN_PASSWORD_LENGTH = 12;

/**
 * Passwords that turn up immediately in any real credential-stuffing list.
 * A deployment should check against a proper breach corpus; this is a floor,
 * not a substitute.
 */
const OBVIOUS = new Set([
  'password', 'password1', 'password123', 'passw0rd',
  'qwerty', 'qwerty123', '111111', '123456', '12345678', '123456789', '1234567890',
  'letmein', 'welcome', 'admin', 'administrator', 'iloveyou', 'monkey', 'dragon',
  'police', 'police123', 'sheriff', 'dispatch', 'badge', 'lawenforcement',
  'changeme', 'temp1234', 'trustno1',
]);

export interface PasswordCheck {
  ok: boolean;
  problems: string[];
}

/**
 * Length is what actually matters, so the rules stay few and explain
 * themselves. Composition mandates ("one of each character class") push people
 * towards Passw0rd! and are not required here.
 */
export function checkPassword(
  password: string,
  context: { username?: string; name?: string } = {},
): PasswordCheck {
  const problems: string[] = [];
  const value = password.trim();

  if (value.length < MIN_PASSWORD_LENGTH) {
    problems.push(
      `Use at least ${MIN_PASSWORD_LENGTH} characters. Length beats complexity — three or four unrelated words is stronger than P@ssw0rd and easier to type on a car keyboard.`,
    );
  }

  if (OBVIOUS.has(value.toLowerCase())) {
    problems.push('This is one of the first passwords any attacker tries. Pick something else.');
  }

  const username = context.username?.trim().toLowerCase();
  if (username && username.length > 2 && value.toLowerCase().includes(username)) {
    problems.push('The password cannot contain the username.');
  }

  const surname = context.name?.trim().split(/\s+/).pop()?.toLowerCase();
  if (surname && surname.length > 2 && value.toLowerCase().includes(surname)) {
    problems.push('The password cannot contain your name.');
  }

  if (/^(.)\1+$/.test(value) && value.length > 0) {
    problems.push('The password cannot be a single repeated character.');
  }

  return { ok: problems.length === 0, problems };
}

/** A readable temporary password for an account being handed to someone. */
export function generateTemporaryPassword(): string {
  const words = [
    'anchor', 'basalt', 'cedar', 'domino', 'ember', 'fathom', 'granite', 'harbor',
    'ingot', 'juniper', 'kestrel', 'lantern', 'meridian', 'nimbus', 'orchard', 'pewter',
    'quarry', 'ridge', 'summit', 'tundra', 'umber', 'valley', 'willow', 'zephyr',
  ];
  const pick = () => {
    const index = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % words.length;
    return words[index];
  };
  const digits = String(globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % 100).padStart(2, '0');
  return `${pick()}-${pick()}-${pick()}-${digits}`;
}
