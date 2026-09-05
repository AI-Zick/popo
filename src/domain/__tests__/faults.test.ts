import { describe, expect, it } from 'vitest';
import { scrub } from '@/domain/faults';

/**
 * The reason this exists: the error log is not in the purge registry, so an
 * identifier that reaches it outlives the expungement of the record it names.
 */
describe('keeping identifiers out of the error log', () => {
  it('takes out the prefixed ids this system mints', () => {
    expect(scrub('could not read the record for per_0f8a1c2b3d4e5f60')).toBe(
      'could not read the record for [id]',
    );
    expect(scrub('inc_mtojgr4yh missing')).toBe('[id] missing');
    expect(scrub('usr_abc123def456 and bul_seed_1x9k2m')).toBe('[id] and [id]');
  });

  it('takes out bare hex long enough to be one', () => {
    expect(scrub('hash 4f3a9c8e1b7d2056af')).toBe('hash [id]');
  });

  it('takes out opaque tokens', () => {
    // A session id or a reset token in a message would be worse than a name.
    expect(scrub('token IoXgil7cA3qbx9WBa6VuzePxzFXjsmFT0GzY7ZBUCA failed')).toBe(
      'token [id] failed',
    );
  });

  it('leaves ordinary prose alone', () => {
    const message = 'The mail server would not take the message.';
    expect(scrub(message)).toBe(message);
  });

  it('leaves short words and numbers alone', () => {
    // Over-redacting to the point of uselessness is its own failure.
    expect(scrub('failed after 3 attempts on port 587')).toBe('failed after 3 attempts on port 587');
    expect(scrub('rule_1 did not match')).toBe('rule_1 did not match');
  });

  it('keeps the line of code, which is what anybody fixing this needs', () => {
    const stack = 'Error: boom\n    at handler (/home/user/popo/server/index.ts:109:11)';
    expect(scrub(stack)).toContain('server/index.ts:109:11');
  });

  it('does not choke on empty or enormous text', () => {
    expect(scrub('')).toBe('');
    expect(() => scrub('x'.repeat(50_000))).not.toThrow();
  });

  it('errs towards redacting too much rather than too little', () => {
    /*
      The trade this makes on purpose: over-redacting costs somebody a minute
      of debugging, under-redacting leaves an identifier in a file no court
      order can reach.
    */
    expect(scrub('handle_request threw')).toBe('[id] threw');
  });
});
