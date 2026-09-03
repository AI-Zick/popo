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
  /**
   * Entries whose content was destroyed under a court order.
   *
   * Their links still verify, so the chain still proves nothing was inserted
   * or removed. Their content cannot be checked, because it is gone — which
   * is the point of the order, and is reported rather than hidden.
   */
  redacted: number[];
}

/**
 * Recomputes every hash and every link.
 *
 * ## Lawful redaction
 *
 * A hash chain and a court expungement order want opposite things. The chain
 * exists to make quiet edits impossible; the order says destroy. Refusing the
 * order is not available, and silently breaking the chain would leave an
 * agency unable to prove anything about the log ever again — one lawful
 * destruction and every future verification reads "altered".
 *
 * So a redacted entry keeps the hash it was sealed with, which is what the
 * next entry's `prevHash` points at, and loses only its content. Verification
 * skips the content check for that entry and names it in `redacted`.
 *
 * What that costs, stated plainly: the log can no longer prove what a redacted
 * entry said. What it keeps: proof that nothing was inserted, removed or
 * reordered, and an exact list of what was destroyed — which is a far better
 * answer to an auditor than a chain that simply reads "broken".
 *
 * `isRedacted` is passed by the caller rather than assumed, so a chain with no
 * concept of redaction — an evidence item's custody, say — gets the strict
 * check with no way to opt an entry out of it.
 */
export async function verifyLinks<T extends Linked>(
  chain: T[],
  fingerprint: Fingerprint<T>,
  isRedacted: (entry: T) => boolean = () => false,
): Promise<ChainStatus> {
  let prevHash = '';
  const redacted: number[] = [];

  for (let i = 0; i < chain.length; i += 1) {
    const entry = chain[i];

    if (entry.prevHash !== prevHash) {
      return {
        intact: false,
        brokenAt: i,
        reason: 'An entry is missing, or entries have been reordered.',
        checked: chain.length,
        redacted,
      };
    }

    if (isRedacted(entry)) {
      // Its content is gone by order of a court. The link is still checked
      // above and below, so its place in the chain is still proved.
      redacted.push(i);
    } else if ((await sha256Hex(canonical(fingerprint(entry)))) !== entry.hash) {
      return {
        intact: false,
        brokenAt: i,
        reason: 'An entry has been altered since it was written.',
        checked: chain.length,
        redacted,
      };
    }

    prevHash = entry.hash;
  }

  return { intact: true, brokenAt: null, reason: null, checked: chain.length, redacted };
}
