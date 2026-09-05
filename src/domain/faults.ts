/**
 * Keeping record identifiers out of the error log.
 *
 * The error log lives on the same disk as the records and — this is the part
 * that matters — it is not in the purge registry. Nothing in it is removed
 * when a court orders a record destroyed, so anything about a person that
 * reaches it outlives the expungement of the record it came from.
 *
 * The shape of a request is recorded rather than its contents, which handles
 * paths and bodies. What it cannot handle is a message somebody wrote by
 * interpolating a value into it — `could not read the record for per_0f8a...`
 * — and that pattern is common enough that it turned up the first time this
 * was tested for.
 */

/**
 * Replaces anything that looks like a record identifier with `[id]`.
 *
 * Three shapes: the prefixed ids this system mints, bare hex runs long enough
 * to be one, and long opaque tokens. Deliberately eager — over-redacting an
 * error log costs somebody a minute of debugging, and under-redacting one
 * leaves a name in a file no court order can reach.
 *
 * It does not catch everything, and no pattern will. An error that
 * interpolates somebody's name is still an error with a name in it. The fix
 * for that is not writing names into error messages; this is the net
 * underneath.
 */
export function scrub(text: string): string {
  return (
    text
      /*
        Prefixed ids: per_..., inc_..., usr_... — and the seeded ones carry a
        second segment, `bul_seed_1x9k2m`, so the tail admits underscores too.
        The six-character floor is what keeps `rule_1` and `port_80` out of it.
      */
      .replace(/\b[a-z]{2,6}_[A-Za-z0-9_]{6,}\b/g, '[id]')
      // Bare hex runs long enough to be an identifier rather than a number.
      .replace(/\b[0-9a-f]{16,}\b/gi, '[id]')
      // Opaque tokens: session ids, reset tokens, base64url of any kind.
      .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[id]')
  );
}
