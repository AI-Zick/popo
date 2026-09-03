/**
 * Hash-chained records.
 *
 * Two things in this system are append-only and have to stay that way: the
 * audit log, and an evidence item's chain of custody. Both answer a question
 * asked long afterwards, by someone who is not inclined to take the answer on
 * trust — an auditor, or defence counsel.
 *
 * Each entry carries the hash of the one before it, so removing or editing an
 * entry breaks every hash after it and `verifyLinks` says exactly where. That
 * does not make either log unfalsifiable: anyone who can rewrite the whole
 * chain can rewrite history. It does mean quiet, selective edits stop being
 * possible, which is the realistic threat — the entry somebody wishes were not
 * there.
 */

export interface Linked {
  /** Hash of the preceding entry — empty for the first. */
  prevHash: string;
  hash: string;
}

/**
 * Which fields of an entry are covered by its hash, in a fixed order.
 *
 * Everything that matters must be in here. A field left out can be changed
 * afterwards without breaking anything, which is worse than not hashing at
 * all — it looks sealed and is not.
 */
export type Fingerprint<T> = (entry: T) => unknown[];

/**
 * Fields joined with each one length-prefixed.
 *
 * Length prefixing removes the ambiguity a plain separator has when the
 * separator turns up inside a field: `"ab" + "c"` and `"a" + "bc"` must not
 * hash alike, or two different entries could be swapped for each other.
 */
export function canonical(parts: unknown[]): string {
  return parts
    .map((part) => {
      const value = String(part ?? '');
      return `${value.length}:${value}`;
    })
    .join('|');
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Seals one entry, given everything but its hash. */
export async function sealLink<T extends { prevHash: string }>(
  entry: T,
  fingerprint: Fingerprint<T>,
): Promise<T & { hash: string }> {
  return { ...entry, hash: await sha256Hex(canonical(fingerprint(entry))) };
}

/** The hash the next entry should carry, given the chain so far. */
export function headHash(chain: Linked[]): string {
  return chain.length > 0 ? chain[chain.length - 1].hash : '';
}

export interface ChainStatus {
  intact: boolean;
  /** Index of the first entry that does not verify. */
  brokenAt: number | null;
  reason: string | null;
  checked: number;
}

/** Recomputes every hash and every link. */
export async function verifyLinks<T extends Linked>(
  chain: T[],
  fingerprint: Fingerprint<T>,
): Promise<ChainStatus> {
  let prevHash = '';

  for (let i = 0; i < chain.length; i += 1) {
    const entry = chain[i];

    if (entry.prevHash !== prevHash) {
      return {
        intact: false,
        brokenAt: i,
        reason: 'An entry is missing, or entries have been reordered.',
        checked: chain.length,
      };
    }

    if ((await sha256Hex(canonical(fingerprint(entry)))) !== entry.hash) {
      return {
        intact: false,
        brokenAt: i,
        reason: 'An entry has been altered since it was written.',
        checked: chain.length,
      };
    }

    prevHash = entry.hash;
  }

  return { intact: true, brokenAt: null, reason: null, checked: chain.length };
}
