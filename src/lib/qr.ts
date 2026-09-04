/**
 * A QR code, drawn from nothing.
 *
 * There is exactly one thing in this system worth putting in a QR code — the
 * `otpauth:` URI an officer's authenticator app needs — and the alternative to
 * this file is asking that officer to hand-type thirty-two characters of
 * base32 off a monitor and onto a phone. That is the kind of small friction
 * that turns "everyone enrols on Monday" into a fortnight of help calls.
 *
 * It is written out rather than pulled in because of where it has to run: the
 * browser-only demo inlines its whole bundle into one file, and the pages we
 * publish refuse scripts from most origins. A dependency that cannot be loaded
 * is not a dependency.
 *
 * Scope is deliberately narrow — byte mode, error correction level M,
 * versions 1 to 10 (up to 213 bytes, where the longest URI we generate is
 * under 200). Anything outside that throws rather than quietly producing a
 * code that will not scan.
 *
 * Reference: ISO/IEC 18004. The tables below are from it; the arithmetic that
 * checks them is in the tests.
 */

/* ---- Galois field GF(256), primitive polynomial 0x11D ------------------ */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Polynomials are highest-degree-first, the convention the spec uses. */
function polyMul(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) out[i + j] ^= mul(a[i], b[j]);
  }
  return out;
}

/** (x − α⁰)(x − α¹)…, the divisor the error-correction bytes are the remainder of. */
function generatorPoly(degree: number): Uint8Array<ArrayBuffer> {
  let poly: Uint8Array<ArrayBuffer> = Uint8Array.of(1);
  for (let i = 0; i < degree; i++) poly = polyMul(poly, Uint8Array.of(1, EXP[i]));
  return poly;
}

/** Reed–Solomon: the remainder of the data, shifted up, divided by the generator. */
function errorCorrection(data: Uint8Array, count: number): Uint8Array {
  const gen = generatorPoly(count);
  const buf = new Uint8Array(data.length + count);
  buf.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = buf[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) buf[i + j] ^= mul(gen[j], factor);
  }
  return buf.slice(data.length);
}

/* ---- The version tables, level M -------------------------------------- */

interface Blocks {
  /** Error-correction codewords in every block. */
  ec: number;
  /** [block count, data codewords each] for the one or two groups. */
  groups: [number, number][];
}

const BLOCKS: Record<number, Blocks> = {
  1: { ec: 10, groups: [[1, 16]] },
  2: { ec: 16, groups: [[1, 28]] },
  3: { ec: 26, groups: [[1, 44]] },
  4: { ec: 18, groups: [[2, 32]] },
  5: { ec: 24, groups: [[2, 43]] },
  6: { ec: 16, groups: [[4, 27]] },
  7: { ec: 18, groups: [[4, 31]] },
  8: { ec: 22, groups: [[2, 38], [2, 39]] },
  9: { ec: 22, groups: [[3, 36], [2, 37]] },
  10: { ec: 26, groups: [[4, 43], [1, 44]] },
};

/** Centres of the alignment patterns. Version 1 has none. */
const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

export const MAX_VERSION = 10;

const dataCodewords = (version: number): number =>
  BLOCKS[version].groups.reduce((sum, [count, size]) => sum + count * size, 0);

/** The character-count field widens at version 10, which changes what fits. */
const countBits = (version: number): number => (version < 10 ? 8 : 16);

/** How many bytes a version holds in byte mode at level M. */
export function capacity(version: number): number {
  return Math.floor((dataCodewords(version) * 8 - 4 - countBits(version)) / 8);
}

/* ---- Bit stream -------------------------------------------------------- */

class Bits {
  private readonly bits: number[] = [];

  push(value: number, width: number): void {
    for (let i = width - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }

  get length(): number {
    return this.bits.length;
  }

  /** Pads to the version's capacity with the two alternating filler bytes. */
  toCodewords(total: number): Uint8Array {
    const bits = this.bits.slice();
    // Terminator, then up to a byte boundary.
    for (let i = 0; i < 4 && bits.length < total * 8; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const out = new Uint8Array(total);
    for (let i = 0; i < bits.length / 8; i++) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i * 8 + j];
      out[i] = byte;
    }
    for (let i = bits.length / 8; i < total; i++) {
      out[i] = (i - bits.length / 8) % 2 === 0 ? 0xec : 0x11;
    }
    return out;
  }
}

/* ---- Assembly ---------------------------------------------------------- */

export interface QrCode {
  /** Modules per side, not counting the quiet zone. */
  size: number;
  version: number;
  /** `modules[y][x]` — true is a dark module. */
  modules: boolean[][];
}

/**
 * Encodes text as a QR code.
 *
 * Throws when the text is too long for version 10 or is not representable as
 * ISO-8859-1 bytes, both of which mean a caller is using this for something it
 * was not built for.
 */
export function encodeQr(text: string): QrCode {
  const bytes = new TextEncoder().encode(text);
  const version = Number(
    Object.keys(BLOCKS).find((v) => capacity(Number(v)) >= bytes.length) ?? 0,
  );
  if (!version) {
    throw new Error(
      `${bytes.length} bytes is more than a version ${MAX_VERSION} QR code holds (${capacity(MAX_VERSION)}).`,
    );
  }

  const stream = new Bits();
  stream.push(0b0100, 4); // byte mode
  stream.push(bytes.length, countBits(version));
  for (const byte of bytes) stream.push(byte, 8);

  const codewords = interleave(stream.toCodewords(dataCodewords(version)), version);
  return draw(version, codewords);
}

/**
 * Data and error-correction codewords, interleaved block by block.
 *
 * This is what makes a torn or smudged code recoverable: a run of damage hits
 * one codeword from each block rather than destroying one block outright.
 */
function interleave(data: Uint8Array, version: number): Uint8Array {
  const { ec, groups } = BLOCKS[version];
  const blocks: Uint8Array[] = [];
  const parity: Uint8Array[] = [];

  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++) {
      const block = data.slice(offset, offset + size);
      offset += size;
      blocks.push(block);
      parity.push(errorCorrection(block, ec));
    }
  }

  const out: number[] = [];
  const longest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) {
    for (const block of blocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ec; i++) {
    for (const block of parity) out.push(block[i]);
  }
  return Uint8Array.from(out);
}

/** Everything that is fixed by the version rather than by the data. */
function functionPattern(size: number, version: number): boolean[][] {
  const reserved = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const reserve = (x: number, y: number, w: number, h: number) => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (y + dy < size && x + dx < size && y + dy >= 0 && x + dx >= 0) {
          reserved[y + dy][x + dx] = true;
        }
      }
    }
  };

  // Finders plus their separators and the format-information strips.
  reserve(0, 0, 9, 9);
  reserve(size - 8, 0, 8, 9);
  reserve(0, size - 8, 9, 8);
  // Timing patterns.
  reserve(6, 0, 1, size);
  reserve(0, 6, size, 1);
  // Alignment patterns, except where they would sit on a finder.
  const centres = ALIGNMENT[version];
  for (const cy of centres) {
    for (const cx of centres) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) {
        continue;
      }
      reserve(cx - 2, cy - 2, 5, 5);
    }
  }
  // Version information, on codes big enough to carry it.
  if (version >= 7) {
    reserve(size - 11, 0, 3, 6);
    reserve(0, size - 11, 6, 3);
  }
  return reserved;
}

function draw(version: number, codewords: Uint8Array): QrCode {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const reserved = functionPattern(size, version);

  const set = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
  };

  // Finder patterns: a 7×7 ring with a 3×3 core.
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]] as const) {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const edge = x === 0 || x === 6 || y === 0 || y === 6;
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        set(ox + x, oy + y, edge || core);
      }
    }
  }

  // Timing patterns: alternating modules joining the finders.
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }

  // Alignment patterns: a 5×5 ring with a single dark centre.
  const centres = ALIGNMENT[version];
  for (const cy of centres) {
    for (const cx of centres) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) {
        continue;
      }
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          set(cx + x, cy + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
        }
      }
    }
  }

  // The one module that is always dark, for reasons the spec does not explain.
  set(8, size - 8, true);

  if (version >= 7) placeVersionInfo(modules, size, version);

  placeData(modules, reserved, size, codewords);

  const mask = bestMask(modules, reserved, size);
  applyMask(modules, reserved, size, mask);
  placeFormatInfo(modules, size, mask);

  return { size, version, modules };
}

/** Data is laid in two-module columns, right to left, snaking up and down. */
function placeData(
  modules: boolean[][],
  reserved: boolean[][],
  size: number,
  codewords: Uint8Array,
): void {
  let bit = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern; the pairing steps around it.
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (reserved[y][x]) continue;
        const index = bit >> 3;
        // Past the end of the data are the remainder bits, which are light.
        modules[y][x] = index < codewords.length && ((codewords[index] >> (7 - (bit & 7))) & 1) === 1;
        bit++;
      }
    }
    upward = !upward;
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (y + x) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (y + x) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((y * x) % 2) + ((y * x) % 3) === 0,
  (x, y) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0,
  (x, y) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0,
];

function applyMask(
  modules: boolean[][],
  reserved: boolean[][],
  size: number,
  mask: number,
): void {
  const rule = MASKS[mask];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!reserved[y][x] && rule(x, y)) modules[y][x] = !modules[y][x];
    }
  }
}

/**
 * Picks the mask that scores worst — that is, best.
 *
 * The four penalties exist to stop a code that looks like its own finder
 * patterns, or that is mostly one colour, either of which is a code a phone
 * cannot lock onto.
 */
function bestMask(modules: boolean[][], reserved: boolean[][], size: number): number {
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(modules, reserved, size, mask);
    placeFormatInfo(modules, size, mask);
    const score = penalty(modules, size);
    applyMask(modules, reserved, size, mask); // masking is its own inverse
    if (score < bestScore) {
      bestScore = score;
      best = mask;
    }
  }
  return best;
}

function penalty(modules: boolean[][], size: number): number {
  let score = 0;

  // Rule 1: runs of five or more of the same colour, in both directions.
  for (let i = 0; i < size; i++) {
    for (const row of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        const here = row ? modules[i][j] : modules[j][i];
        const before = row ? modules[i][j - 1] : modules[j - 1][i];
        if (here === before) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          run = 1;
        }
      }
    }
  }

  // Rule 2: every 2×2 block of one colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const a = modules[y][x];
      if (a === modules[y][x + 1] && a === modules[y + 1][x] && a === modules[y + 1][x + 1]) {
        score += 3;
      }
    }
  }

  // Rule 3: anything that reads like a finder pattern.
  const finder = [true, false, true, true, true, false, true, false, false, false, false];
  const reversed = finder.slice().reverse();
  const matches = (get: (i: number) => boolean, at: number, pattern: boolean[]): boolean =>
    pattern.every((want, i) => get(at + i) === want);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j + 11 <= size; j++) {
      const row = (k: number) => modules[i][k];
      const col = (k: number) => modules[k][i];
      if (matches(row, j, finder) || matches(row, j, reversed)) score += 40;
      if (matches(col, j, finder) || matches(col, j, reversed)) score += 40;
    }
  }

  // Rule 4: how far the balance of dark to light is from even.
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/** Level M is 0b00; the fifteen bits are BCH-protected and then masked. */
function placeFormatInfo(modules: boolean[][], size: number, mask: number): void {
  const data = (0b00 << 3) | mask;
  let bch = data << 10;
  for (let i = 4; i >= 0; i--) {
    if ((bch >> (i + 10)) & 1) bch ^= 0b10100110111 << i;
  }
  const bits = ((data << 10) | bch) ^ 0b101010000010010;

  // Two copies, so a code with one corner damaged is still readable. Indices
  // are [row][column]: the first copy runs down column 8 and along row 8.
  const at = (i: number) => ((bits >> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) modules[i][8] = at(i);
  modules[7][8] = at(6);
  modules[8][8] = at(7);
  modules[8][7] = at(8);
  for (let i = 9; i <= 14; i++) modules[8][14 - i] = at(i);

  for (let i = 0; i <= 7; i++) modules[8][size - 1 - i] = at(i);
  for (let i = 8; i <= 14; i++) modules[size - 15 + i][8] = at(i);
}

/** Version 7 and up repeat the version number in two corners. */
function placeVersionInfo(modules: boolean[][], size: number, version: number): void {
  let bch = version << 12;
  for (let i = 5; i >= 0; i--) {
    if ((bch >> (i + 12)) & 1) bch ^= 0b1111100100101 << i;
  }
  const bits = (version << 12) | bch;

  for (let i = 0; i < 18; i++) {
    const bit = ((bits >> i) & 1) === 1;
    const a = Math.floor(i / 3);
    const b = (i % 3) + size - 11;
    modules[b][a] = bit;
    modules[a][b] = bit;
  }
}

/* ---- Drawing it ------------------------------------------------------- */

/**
 * The dark modules as one SVG path, in a viewBox of `size + 2 * quiet` units.
 *
 * One path rather than a few hundred rects, because a few hundred rects is a
 * few hundred DOM nodes for something that is one shape.
 */
export function qrPath(qr: QrCode, quiet = 2): string {
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y][x]) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
    }
  }
  return parts.join('');
}
