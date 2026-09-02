import { describe, expect, it } from 'vitest';
import { ageForPrint, freshness, freshnessTone, FRESHNESS_DAYS } from '../freshness';

const NOW = new Date('2026-09-02T12:00:00Z').getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe('how old a value is', () => {
  it('reads today as today', () => {
    expect(freshness(daysAgo(0), NOW).label).toBe('Recorded today');
  });

  it('counts days for the first fortnight', () => {
    expect(freshness(daysAgo(3), NOW).label).toBe('3 days ago');
  });

  it('switches to weeks, then months, as precision stops mattering', () => {
    // "Recorded 1,247 days ago" is precision nobody needs; the officer is
    // making a judgement, not a calculation.
    expect(freshness(daysAgo(21), NOW).label).toBe('3 weeks ago');
    expect(freshness(daysAgo(75), NOW).label).toBe('3 months ago');
  });

  it('reports years once it is years', () => {
    expect(freshness(daysAgo(400), NOW).label).toBe('1 year old');
    expect(freshness(daysAgo(800), NOW).label).toBe('2 years old');
  });
});

describe('what is worth checking', () => {
  it('does not nag about anything recent', () => {
    expect(freshness(daysAgo(30), NOW).worthChecking).toBe(false);
    expect(freshness(daysAgo(FRESHNESS_DAYS.current), NOW).worthChecking).toBe(false);
  });

  it('does not nag about the first year either', () => {
    // A phone number from eight months ago is probably still the phone number.
    expect(freshness(daysAgo(240), NOW).worthChecking).toBe(false);
    expect(freshness(daysAgo(240), NOW).level).toBe('aging');
  });

  it('flags anything past a year', () => {
    // A warrant served at a stale address is served on whoever lives there now.
    const result = freshness(daysAgo(FRESHNESS_DAYS.aging + 1), NOW);
    expect(result.level).toBe('stale');
    expect(result.worthChecking).toBe(true);
  });

  it('separates old from very old', () => {
    expect(freshness(daysAgo(2 * 365), NOW).level).toBe('stale');
    expect(freshness(daysAgo(5 * 365), NOW).level).toBe('ancient');
  });
});

describe('when there is no date', () => {
  it('says so rather than implying the value is new', () => {
    // A record migrated from a previous system could be twenty years old.
    // Saying nothing invites the reader to assume it is current.
    const result = freshness('', NOW);
    expect(result.level).toBe('unknown');
    expect(result.label).toBe('Date unknown');
    expect(result.worthChecking).toBe(true);
  });

  it('treats undefined the same as empty', () => {
    expect(freshness(undefined, NOW).level).toBe('unknown');
  });

  it('does not pretend an unparseable date is fresh', () => {
    expect(freshness('not a date', NOW).level).toBe('unknown');
    expect(freshness('not a date', NOW).worthChecking).toBe(true);
  });
});

describe('edges', () => {
  it('treats a future date as zero days rather than negative', () => {
    // Clock skew between a workstation and the server should not produce
    // "recorded -2 days ago".
    const result = freshness(daysAgo(-5), NOW);
    expect(result.days).toBe(0);
    expect(result.worthChecking).toBe(false);
  });

  it('gives every level a tone the UI can use', () => {
    expect(freshnessTone('current')).toBe('ok');
    expect(freshnessTone('aging')).toBe('neutral');
    expect(freshnessTone('stale')).toBe('warn');
    expect(freshnessTone('ancient')).toBe('warn');
    expect(freshnessTone('unknown')).toBe('warn');
  });
});

describe('the paper version', () => {
  it('says "current" rather than a number for anything recent', () => {
    expect(ageForPrint(daysAgo(10), NOW)).toBe('current');
  });

  it('spells out the age when it matters', () => {
    expect(ageForPrint(daysAgo(800), NOW)).toBe('2 years old');
  });

  it('admits an unknown date on paper too', () => {
    // Whoever serves the warrant is reading the sheet, not the screen.
    expect(ageForPrint('', NOW)).toBe('date unknown');
  });
});
