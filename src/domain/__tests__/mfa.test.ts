import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  codeFor,
  counterFor,
  formatSecret,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCodes,
  matchRecoveryCode,
  mfaState,
  normaliseRecoveryCode,
  LABEL_LIMIT,
  provisioningUri,
  verifyCode,
} from '../mfa';

/**
 * The RFC's own secret: the ASCII string "12345678901234567890", which is
 * what every published TOTP test vector is computed against.
 */
const RFC_SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'));

/** Deterministic bytes, so a generated secret can be asserted on. */
const counting = (start = 0) => {
  let n = start;
  return (size: number) => Uint8Array.from({ length: size }, () => (n += 1) & 0xff);
};

describe('base32', () => {
  it('round-trips', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect([...base32Decode(base32Encode(bytes))]).toEqual([...bytes]);
  });

  it('encodes the RFC’s secret the way authenticator apps expect', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('reads a key back however somebody transcribed it', () => {
    const spaced = 'gezd gnbv-gy3t qojq GEZDGNBVGY3TQOJQ==';
    expect([...base32Decode(spaced)]).toEqual([...base32Decode(RFC_SECRET)]);
  });

  it('refuses a character that is not part of the alphabet', () => {
    expect(() => base32Decode('GEZD1NBV')).toThrow(/not part of a setup key/);
  });
});

/*
  RFC 6238, Appendix B. The published vectors are eight digits; a six-digit
  code is the last six of the same number, which is what the algorithm
  produces at DIGITS = 6.
*/
describe('RFC 6238 test vectors', () => {
  const vectors: [seconds: number, eightDigits: string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  for (const [seconds, expected] of vectors) {
    it(`matches at T=${seconds}`, async () => {
      const code = await codeFor(RFC_SECRET, counterFor(seconds * 1000));
      expect(code).toBe(expected.slice(-6));
    });
  }
});

describe('checking a code', () => {
  const at = 1111111109 * 1000;

  it('accepts the code for right now', async () => {
    const result = await verifyCode(RFC_SECRET, '081804', { atMs: at });
    expect(result.ok).toBe(true);
    expect(result.counter).toBe(counterFor(at));
  });

  it('forgives a clock one step out either way', async () => {
    const previous = await codeFor(RFC_SECRET, counterFor(at) - 1);
    const next = await codeFor(RFC_SECRET, counterFor(at) + 1);
    expect((await verifyCode(RFC_SECRET, previous, { atMs: at })).ok).toBe(true);
    expect((await verifyCode(RFC_SECRET, next, { atMs: at })).ok).toBe(true);
  });

  it('does not forgive two steps', async () => {
    const distant = await codeFor(RFC_SECRET, counterFor(at) + 2);
    expect((await verifyCode(RFC_SECRET, distant, { atMs: at })).ok).toBe(false);
  });

  it('refuses a code that has already been used', async () => {
    // The whole point of tracking the counter: somebody who watched the
    // officer type it cannot use the same six digits ten seconds later.
    const used = counterFor(at);
    const result = await verifyCode(RFC_SECRET, '081804', { atMs: at, lastCounter: used });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/already been used/);
  });

  it('says something useful when the code is simply wrong', async () => {
    const result = await verifyCode(RFC_SECRET, '000000', { atMs: at });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('That code is not right.');
  });

  it('rejects anything that is not six digits', async () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5']) {
      expect((await verifyCode(RFC_SECRET, bad, { atMs: at })).ok).toBe(false);
    }
  });

  it('ignores spacing, because apps show the digits in groups', async () => {
    expect((await verifyCode(RFC_SECRET, '081 804', { atMs: at })).ok).toBe(true);
  });

  it('still accepts a newer code after an older one was used', async () => {
    const counter = counterFor(at);
    const next = await codeFor(RFC_SECRET, counter + 1);
    const result = await verifyCode(RFC_SECRET, next, { atMs: at, lastCounter: counter });
    expect(result.ok).toBe(true);
    expect(result.counter).toBe(counter + 1);
  });
});

describe('setting it up', () => {
  it('makes a twenty-byte secret', () => {
    expect(base32Decode(generateSecret(counting())).length).toBe(20);
  });

  it('builds a URL an authenticator app understands', () => {
    const uri = provisioningUri('ABCDEFGH', 'mreyes', 'Cedar Falls PD');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain(encodeURIComponent('Cedar Falls PD:mreyes'));
    expect(uri).toContain('secret=ABCDEFGH');
    expect(uri).toContain('issuer=Cedar+Falls+PD');
  });

  /*
    SHA-1, six digits and a thirty-second step are what every authenticator
    assumes when it is told nothing, and what this system computes. Spelling
    them out costs thirty-eight characters of QR code, which is the difference
    between a code that scans off a monitor and one that does not.
  */
  it('leaves out what every app already defaults to', () => {
    const uri = provisioningUri('ABCDEFGH', 'mreyes', 'Cedar Falls PD');
    expect(uri).not.toContain('digits');
    expect(uri).not.toContain('period');
    expect(uri).not.toContain('algorithm');
  });

  it('shortens an agency name that would not fit on a phone', () => {
    const uri = provisioningUri('ABCDEFGH', 'mreyes', 'A'.repeat(LABEL_LIMIT + 20));
    expect(uri).toContain(encodeURIComponent('A'.repeat(LABEL_LIMIT - 1)));
    expect(uri).not.toContain(encodeURIComponent('A'.repeat(LABEL_LIMIT + 1)));
  });

  it('groups the key for somebody typing it in', () => {
    expect(formatSecret('ABCDEFGHIJ')).toBe('ABCD EFGH IJ');
  });
});

describe('recovery codes', () => {
  it('makes ten of them', () => {
    expect(generateRecoveryCodes(counting())).toHaveLength(10);
  });

  it('are all different', () => {
    const codes = generateRecoveryCodes(counting());
    expect(new Set(codes).size).toBe(10);
  });

  it('reads one back however it was typed', () => {
    expect(normaliseRecoveryCode('abcde-fghij')).toBe('ABCDEFGHIJ');
    expect(normaliseRecoveryCode('ABCDE FGHIJ')).toBe('ABCDEFGHIJ');
  });

  it('finds a real one and says which', async () => {
    const codes = generateRecoveryCodes(counting());
    const hashes = await hashRecoveryCodes(codes);
    expect(await matchRecoveryCode(hashes, codes[4])).toBe(4);
    expect(await matchRecoveryCode(hashes, codes[4].toLowerCase())).toBe(4);
  });

  it('does not find one that was never issued', async () => {
    const hashes = await hashRecoveryCodes(generateRecoveryCodes(counting()));
    expect(await matchRecoveryCode(hashes, 'ZZZZZ-ZZZZZ')).toBe(-1);
  });

  it('does not match a fragment', async () => {
    const codes = generateRecoveryCodes(counting());
    const hashes = await hashRecoveryCodes(codes);
    expect(await matchRecoveryCode(hashes, codes[0].slice(0, 6))).toBe(-1);
  });

  it('never stores the code itself', async () => {
    const codes = generateRecoveryCodes(counting());
    const hashes = await hashRecoveryCodes(codes);
    for (const code of codes) {
      expect(hashes.join(' ')).not.toContain(normaliseRecoveryCode(code));
    }
  });
});

describe('what the screen shows', () => {
  it('is not enrolled with nothing set up', () => {
    expect(mfaState({})).toMatchObject({ enrolled: false, pending: false });
  });

  it('is pending while a secret exists but was never confirmed', () => {
    expect(mfaState({ mfaSecret: 'ABC' })).toMatchObject({ enrolled: false, pending: true });
  });

  it('is enrolled once confirmed', () => {
    const state = mfaState({
      mfaSecret: 'ABC',
      mfaConfirmedAt: '2026-09-03T00:00:00.000Z',
      recoveryCodes: ['a', 'b'],
    });
    expect(state).toMatchObject({ enrolled: true, pending: false, recoveryRemaining: 2 });
  });
});
