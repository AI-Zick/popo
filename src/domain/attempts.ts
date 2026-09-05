/**
 * Counting the attempts that are actually attempts.
 *
 * A fixed window, per source, spent by hand. The reason it is spent by hand
 * rather than by a request arriving is that not every refusal from a route is
 * a guess. Changing a password is the clear case: "too short", "contains your
 * username", "same as the old one" are all somebody reading the rules and
 * picking again, and counting those against a brute-force budget locks out the
 * one person doing it properly. It costs an attacker nothing, because an
 * attacker only ever sends the current password, which is the one failure that
 * does get counted.
 *
 * The window is fixed rather than sliding, so the count resets whole rather
 * than decaying. That is more forgiving at the boundary and much easier to
 * explain to somebody staring at "wait 43 seconds".
 */

export interface Attempts {
  count: number;
  /** When this window ends, in milliseconds since the epoch. */
  resetAt: number;
}

/**
 * How many seconds to wait, or 0 when there is budget left.
 *
 * Rounded up, because saying "wait 0 seconds" to somebody who must in fact
 * wait is worse than making them wait one second longer than they need to.
 */
export function waitSeconds(
  bucket: Attempts | undefined,
  now: number,
  max: number,
): number {
  if (!bucket || bucket.resetAt <= now || bucket.count < max) return 0;
  return Math.ceil((bucket.resetAt - now) / 1000);
}

/**
 * Record one attempt, returning the bucket that replaces the old one.
 *
 * An expired window is not extended, it is started again — otherwise a slow
 * trickle of guesses would hold the window open forever.
 */
export function spend(
  bucket: Attempts | undefined,
  now: number,
  windowMs: number,
): Attempts {
  if (!bucket || bucket.resetAt <= now) return { count: 1, resetAt: now + windowMs };
  return { count: bucket.count + 1, resetAt: bucket.resetAt };
}

/** True once a bucket can no longer refuse anything, so it can be dropped. */
export function expired(bucket: Attempts, now: number): boolean {
  return bucket.resetAt <= now;
}
