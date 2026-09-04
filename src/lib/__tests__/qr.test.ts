import { describe, expect, it } from 'vitest';
import { capacity, encodeQr, MAX_VERSION, qrPath } from '../qr';
import { generateSecret, provisioningUri, URI_BUDGET } from '@/domain/mfa';

const fixed = (n: number): Uint8Array => new Uint8Array(n).fill(7);

/**
 * These do not decode anything — a decoder is a second implementation to get
 * wrong. They check the properties a QR code has to have for a decoder to
 * stand a chance, and pin the invariants a careless edit would break.
 * Correctness against a real decoder was established separately, with jsQR,
 * over every version and the URIs this system actually produces.
 */
describe('QR encoding', () => {
  it('picks the smallest version the text fits in', () => {
    for (let version = 1; version <= MAX_VERSION; version++) {
      expect(encodeQr('A'.repeat(capacity(version))).version).toBe(version);
    }
  });

  it('refuses text no version holds, rather than drawing a code that cannot be read', () => {
    expect(() => encodeQr('A'.repeat(capacity(MAX_VERSION) + 1))).toThrow(/more than a version/);
  });

  it('sizes the grid to the version', () => {
    for (let version = 1; version <= MAX_VERSION; version++) {
      const qr = encodeQr('A'.repeat(capacity(version)));
      expect(qr.size).toBe(version * 4 + 17);
      expect(qr.modules).toHaveLength(qr.size);
      expect(qr.modules.every((row) => row.length === qr.size)).toBe(true);
    }
  });

  it('draws all three finder patterns', () => {
    const qr = encodeQr('otpauth://totp/x');
    const ring = (ox: number, oy: number): string =>
      Array.from({ length: 7 }, (_, y) =>
        Array.from({ length: 7 }, (_, x) => (qr.modules[oy + y][ox + x] ? '1' : '0')).join(''),
      ).join('/');
    const expected = '1111111/1000001/1011101/1011101/1011101/1000001/1111111';
    expect(ring(0, 0)).toBe(expected);
    expect(ring(qr.size - 7, 0)).toBe(expected);
    expect(ring(0, qr.size - 7)).toBe(expected);
  });

  it('separates the finders from the data with a light border', () => {
    const qr = encodeQr('otpauth://totp/x');
    for (let i = 0; i <= 7; i++) {
      expect(qr.modules[7][i]).toBe(false);
      expect(qr.modules[i][7]).toBe(false);
      expect(qr.modules[7][qr.size - 1 - i]).toBe(false);
      expect(qr.modules[qr.size - 1 - i][7]).toBe(false);
    }
  });

  it('alternates the timing patterns', () => {
    const qr = encodeQr('otpauth://totp/x');
    for (let i = 8; i < qr.size - 8; i++) {
      expect(qr.modules[6][i]).toBe(i % 2 === 0);
      expect(qr.modules[i][6]).toBe(i % 2 === 0);
    }
  });

  it('keeps the module that is always dark', () => {
    const qr = encodeQr('otpauth://totp/x');
    expect(qr.modules[qr.size - 8][8]).toBe(true);
  });

  it('is not lopsidedly one colour, whatever the input', () => {
    for (const text of ['', 'A', 'A'.repeat(120), ' '.repeat(100), 'cafe nachste']) {
      const qr = encodeQr(text);
      const share = qr.modules.flat().filter(Boolean).length / (qr.size * qr.size);
      expect(share).toBeGreaterThan(0.3);
      expect(share).toBeLessThan(0.7);
    }
  });

  it('encodes bytes, not characters', () => {
    // Two bytes per character, so the version has to be chosen on bytes.
    const twoByte = String.fromCharCode(0xe9);
    expect(() => encodeQr(twoByte.repeat(capacity(MAX_VERSION) / 2 + 1))).toThrow();
  });

  it('draws one square per dark module', () => {
    const qr = encodeQr('otpauth://totp/x');
    const dark = qr.modules.flat().filter(Boolean).length;
    expect(qrPath(qr).match(/M/g) ?? []).toHaveLength(dark);
  });

  /*
    The bug this pins was a real one: the format-information modules were
    written transposed, which every pattern test above sails past — the
    modules involved are all inside the reserved area — and which makes every
    code unreadable by every decoder. The positions below are transcribed from
    the spec independently of the code that writes them, and the fifteen-bit
    values are the spec's own table for error-correction level M.
  */
  it('writes the format information where a decoder looks for it', () => {
    const LEVEL_M = [
      0b101010000010010, 0b101000100100101, 0b101111001111100, 0b101101101001011,
      0b100010111111001, 0b100000011001110, 0b100111110010111, 0b100101010100000,
    ];

    for (const text of ['x', 'A'.repeat(120), 'A'.repeat(200)]) {
      const qr = encodeQr(text);
      const last = qr.size - 1;
      const read = (places: [number, number][]): number =>
        places.reduce((bits, [row, col], i) => bits | (qr.modules[row][col] ? 1 << i : 0), 0);

      const first = read([
        [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
        [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
      ]);
      const second = read([
        [8, last], [8, last - 1], [8, last - 2], [8, last - 3],
        [8, last - 4], [8, last - 5], [8, last - 6], [8, last - 7],
        [last - 6, 8], [last - 5, 8], [last - 4, 8], [last - 3, 8],
        [last - 2, 8], [last - 1, 8], [last, 8],
      ]);

      expect(second).toBe(first);
      expect(LEVEL_M).toContain(first);
    }
  });

  it('is stable — the same text draws the same code', () => {
    expect(qrPath(encodeQr('otpauth://totp/x'))).toBe(qrPath(encodeQr('otpauth://totp/x')));
  });
});

describe('the provisioning URI always fits in a QR code', () => {
  const secret = generateSecret(fixed);
  const accented = String.fromCharCode(0xed);
  const dash = String.fromCharCode(0x2014);

  it.each([
    ['Aegis RMS', 'mreyes'],
    ['Cedar Falls Police Department', 'mreyes'],
    ['Wapsipinicon Valley Regional Consolidated Law Enforcement Agency', 'd.vandermolen-fitzgerald'],
    [`Comisar${accented}a Municipal de Pe${accented}asco ${dash} Distrito 3`, `jos${accented}.gonzalez`],
    ['', ''],
    ['A'.repeat(400), 'x'.repeat(200)],
  ])('%s / %s', (agency, who) => {
    const uri = provisioningUri(secret, who, agency);
    expect(new TextEncoder().encode(uri).length).toBeLessThanOrEqual(URI_BUDGET);
    expect(() => encodeQr(uri)).not.toThrow();
  });

  it('keeps the secret intact however much else is trimmed away', () => {
    const uri = provisioningUri(secret, 'x'.repeat(200), 'A'.repeat(400));
    expect(new URL(uri).searchParams.get('secret')).toBe(secret);
  });

  it('leaves out the parameters every app already defaults to', () => {
    const uri = provisioningUri(secret, 'mreyes', 'Aegis RMS');
    expect(uri).not.toContain('algorithm');
    expect(uri).not.toContain('period');
    expect(uri).not.toContain('digits');
  });
});
