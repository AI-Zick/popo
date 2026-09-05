import { describe, expect, it } from 'vitest';
import { expired, spend, waitSeconds, type Attempts } from '@/domain/attempts';

const WINDOW = 60_000;
const MAX = 5;

/** Spend `times` attempts starting from nothing, all at the same instant. */
const after = (times: number, now = 0): Attempts | undefined => {
  let bucket: Attempts | undefined;
  for (let i = 0; i < times; i += 1) bucket = spend(bucket, now, WINDOW);
  return bucket;
};

describe('waitSeconds', () => {
  it('lets an untouched source through', () => {
    expect(waitSeconds(undefined, 0, MAX)).toBe(0);
  });

  it('lets the source through right up to the limit', () => {
    expect(waitSeconds(after(MAX - 1), 0, MAX)).toBe(0);
  });

  it('refuses once the limit is reached', () => {
    expect(waitSeconds(after(MAX), 0, MAX)).toBe(60);
  });

  it('counts down as the window runs out', () => {
    expect(waitSeconds(after(MAX), 42_300, MAX)).toBe(18);
  });

  it('never says to wait no time at all', () => {
    // 1ms left is still a wait, and "wait 0 seconds" reads as a bug.
    expect(waitSeconds(after(MAX), WINDOW - 1, MAX)).toBe(1);
  });

  it('forgives everything once the window has passed', () => {
    expect(waitSeconds(after(MAX * 10), WINDOW, MAX)).toBe(0);
  });
});

describe('spend', () => {
  it('opens a window on the first attempt', () => {
    expect(spend(undefined, 1_000, WINDOW)).toEqual({ count: 1, resetAt: 61_000 });
  });

  it('adds to a window that is still open without extending it', () => {
    const bucket = spend({ count: 2, resetAt: 61_000 }, 30_000, WINDOW);
    expect(bucket).toEqual({ count: 3, resetAt: 61_000 });
  });

  it('starts a new window rather than extending an expired one', () => {
    /*
      The point of the fixed window: a guess every 61 seconds must not hold the
      old window open forever, and must not inherit its count either.
    */
    const bucket = spend({ count: 99, resetAt: 61_000 }, 61_000, WINDOW);
    expect(bucket).toEqual({ count: 1, resetAt: 121_000 });
  });

  it('lets a source back in one window after being refused', () => {
    let bucket = after(MAX);
    expect(waitSeconds(bucket, 0, MAX)).toBe(60);
    bucket = spend(bucket, WINDOW, WINDOW);
    expect(bucket!.count).toBe(1);
    expect(waitSeconds(bucket, WINDOW, MAX)).toBe(0);
  });
});

describe('expired', () => {
  it('is false while the window is open', () => {
    expect(expired({ count: 1, resetAt: 61_000 }, 60_999)).toBe(false);
  });

  it('is true the instant it closes', () => {
    expect(expired({ count: 1, resetAt: 61_000 }, 61_000)).toBe(true);
  });
});
