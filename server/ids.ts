import { randomBytes } from 'node:crypto';

/**
 * Identifiers for records the server creates.
 *
 * Random rather than sequential, because a record id that can be guessed is a
 * record that can be asked for by anyone who guesses it — and case numbers,
 * which *are* sequential, are the thing people are meant to quote.
 *
 * Sixty-four bits, which is more than an agency will ever need and cheap enough
 * not to think about. The prefix is for the humans reading a log.
 */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}
