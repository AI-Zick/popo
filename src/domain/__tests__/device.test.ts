import { describe, expect, it } from 'vitest';
import { describeDevice } from '@/domain/session';

/**
 * Real user agent strings, because a hand-written one proves nothing: the
 * whole difficulty here is that every browser claims to be several others.
 */
const AGENTS = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  operaWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
};

describe('telling one signed-in device from another', () => {
  it('names the browser and the platform', () => {
    expect(describeDevice(AGENTS.chromeWindows)).toBe('Chrome on Windows');
    expect(describeDevice(AGENTS.firefoxLinux)).toBe('Firefox on Linux');
  });

  it('does not call Edge "Chrome"', () => {
    // Edge puts Chrome and Safari in its own string. Order of checks matters.
    expect(describeDevice(AGENTS.edgeWindows)).toBe('Edge on Windows');
  });

  it('does not call Opera "Chrome" either', () => {
    expect(describeDevice(AGENTS.operaWindows)).toBe('Opera on Windows');
  });

  it('does not call Chrome "Safari"', () => {
    // Every WebKit browser claims Safari; only real Safari has no other claim.
    expect(describeDevice(AGENTS.chromeMac)).toBe('Chrome on macOS');
    expect(describeDevice(AGENTS.safariMac)).toBe('Safari on macOS');
  });

  it('reads a phone as a phone', () => {
    expect(describeDevice(AGENTS.safariIphone)).toBe('Safari on iOS');
    /*
      Android agents say "Linux; Android", so the Android test has to come
      first or every phone in the agency reads as a Linux desktop.
    */
    expect(describeDevice(AGENTS.chromeAndroid)).toBe('Chrome on Android');
  });

  it('says something rather than nothing for what it cannot place', () => {
    expect(describeDevice('')).toBe('Unknown device');
    expect(describeDevice('   ')).toBe('Unknown device');
    expect(describeDevice('curl/8.4.0')).toBe('Unknown device');
  });

  it('keeps only the browser or only the platform when that is all there is', () => {
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0)')).toBe('Windows');
    expect(describeDevice('Firefox/133.0')).toBe('Firefox');
  });

  it('is coarse on purpose', () => {
    /*
      The point of the whole function: enough to pick a row out of a list,
      never a record of which build of which browser an officer was using.
      Version numbers here would make this a movement log.
    */
    for (const agent of Object.values(AGENTS)) {
      const described = describeDevice(agent);
      expect(described).not.toMatch(/\d/);
      expect(described.length).toBeLessThan(30);
    }
  });

  it('does not choke on a very long or hostile agent', () => {
    const huge = `${'A'.repeat(9000)} Chrome/1 Windows NT`;
    expect(() => describeDevice(huge)).not.toThrow();
    // Truncated before matching, so a megabyte header cannot be scanned in full.
    expect(describeDevice(huge)).toBe('Unknown device');
  });
});
