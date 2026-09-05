import { describe, expect, it } from 'vitest';
import {
  canSendMail,
  checkMail,
  emptyMailSettings,
  isUsable,
  LINK_NO_GOOD,
  looksLikeEmail,
  maskEmail,
  REQUEST_ACKNOWLEDGED,
  resetLink,
  resetState,
  TOKEN_MINUTES,
  type MailSettings,
  type ResetRequest,
} from '@/domain/passwordReset';

const NOW = new Date('2026-03-10T08:00:00Z');
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

const request = (partial: Partial<ResetRequest> = {}): ResetRequest => ({
  id: 'r1',
  userId: 'u1',
  tokenHash: 'abc',
  requestedAt: NOW.toISOString(),
  expiresAt: at(TOKEN_MINUTES),
  usedAt: '',
  requestedFrom: '',
  ...partial,
});

describe('whether a link still works', () => {
  it('works inside its window', () => {
    expect(resetState(request(), NOW)).toBe('usable');
    expect(isUsable(request(), NOW)).toBe(true);
  });

  it('stops working the moment it runs out', () => {
    expect(resetState(request(), new Date(at(TOKEN_MINUTES)))).toBe('expired');
  });

  it('stops working once it has been spent', () => {
    expect(resetState(request({ usedAt: at(2) }), NOW)).toBe('spent');
  });

  it('reads as spent rather than expired when it is both', () => {
    /*
      A token somebody used and then presented again is a different event from
      one that merely ran out, and the first is the one worth noticing.
    */
    expect(resetState(request({ usedAt: at(2) }), new Date(at(90)))).toBe('spent');
  });

  it('says the same thing to the holder either way', () => {
    // Which of the two it was is information about the officer, not the link.
    expect(LINK_NO_GOOD).toMatch(/expired or has already been used/);
    expect(LINK_NO_GOOD).not.toMatch(/\bspent\b/);
  });
});

describe('what the request screen says', () => {
  it('never promises an email was sent', () => {
    /*
      The wording has to be true for an address that matches nothing, which is
      most of what gets typed here.
    */
    expect(REQUEST_ACKNOWLEDGED).toMatch(/^If that matches an account/);
    expect(REQUEST_ACKNOWLEDGED).not.toMatch(/we have sent|check your inbox/i);
  });

  it('says how long it lasts and what to do if nothing comes', () => {
    expect(REQUEST_ACKNOWLEDGED).toContain(String(TOKEN_MINUTES));
    expect(REQUEST_ACKNOWLEDGED).toMatch(/administrator/);
  });
});

describe('addresses', () => {
  it('accepts ordinary ones', () => {
    expect(looksLikeEmail('m.reyes@cedarfalls.gov')).toBe(true);
    expect(looksLikeEmail('officer+alerts@pd.example.co.uk')).toBe(true);
  });

  it('catches the typos worth catching', () => {
    expect(looksLikeEmail('')).toBe(false);
    expect(looksLikeEmail('mreyes')).toBe(false);
    expect(looksLikeEmail('mreyes@')).toBe(false);
    expect(looksLikeEmail('@cedarfalls.gov')).toBe(false);
    expect(looksLikeEmail('m reyes@cedarfalls.gov')).toBe(false);
    expect(looksLikeEmail('a@b@c.gov')).toBe(false);
    expect(looksLikeEmail('mreyes@localhost')).toBe(false);
    expect(looksLikeEmail('mreyes@.gov')).toBe(false);
  });
});

describe('masking an address', () => {
  it('leaves enough to recognise your own', () => {
    expect(maskEmail('mreyes@cedarfalls.gov')).toBe('m****s@cedarfalls.gov');
  });

  it('does not lengthen a short name into a guess about it', () => {
    expect(maskEmail('jo@cedarfalls.gov')).toBe('j*@cedarfalls.gov');
  });

  it('never leaks the length of a long name', () => {
    const masked = maskEmail('averyveryverylongaddress@cedarfalls.gov');
    expect(masked).toBe('a******s@cedarfalls.gov');
  });

  it('gives nothing back for something that is not an address', () => {
    expect(maskEmail('nonsense')).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* Whether the agency can do this at all                               */
/* ------------------------------------------------------------------ */

const configured = (): MailSettings => ({
  host: 'smtp.cedarfalls.gov',
  port: 587,
  secure: false,
  username: 'rms',
  password: 'secret',
  from: 'no-reply@cedarfalls.gov',
  baseUrl: 'https://rms.cedarfalls.gov',
});

describe('mail settings', () => {
  it('ship empty and say so', () => {
    /*
      The honesty marker. An unconfigured mail server must read as
      unconfigured, because a sign-in screen offering a reset that silently
      goes nowhere is worse than one offering none.
    */
    expect(canSendMail(emptyMailSettings())).toBe(false);
    expect(checkMail(emptyMailSettings()).problems.length).toBeGreaterThan(0);
  });

  it('are complete once filled in', () => {
    expect(checkMail(configured())).toEqual({ ok: true, problems: [] });
  });

  it('need somewhere for links to point', () => {
    const problems = checkMail({ ...configured(), baseUrl: '' }).problems;
    expect(problems.some((p) => /links cannot be built/.test(p))).toBe(true);
  });

  it('refuse an installation address with no scheme', () => {
    // Without one the link is relative and lands nowhere from a mail client.
    const problems = checkMail({ ...configured(), baseUrl: 'rms.cedarfalls.gov' }).problems;
    expect(problems.some((p) => /http/.test(p))).toBe(true);
  });

  it('catch a From address that is not one', () => {
    expect(checkMail({ ...configured(), from: 'no-reply' }).ok).toBe(false);
  });

  it('catch an impossible port', () => {
    expect(checkMail({ ...configured(), port: 0 }).ok).toBe(false);
    expect(checkMail({ ...configured(), port: 70_000 }).ok).toBe(false);
  });

  it('do not insist on a username, because plenty of relays have none', () => {
    expect(checkMail({ ...configured(), username: '', password: '' }).ok).toBe(true);
  });
});

describe('the link itself', () => {
  it('is built from configuration, never from the request', () => {
    /*
      A link built from a Host header is a link an attacker aims at their own
      server by sending one. It has to come from settings.
    */
    expect(resetLink(configured(), 'abc123')).toBe('https://rms.cedarfalls.gov/?reset=abc123');
  });

  it('survives a trailing slash on the configured address', () => {
    const settings = { ...configured(), baseUrl: 'https://rms.cedarfalls.gov/' };
    expect(resetLink(settings, 'abc')).toBe('https://rms.cedarfalls.gov/?reset=abc');
  });

  it('escapes the token rather than pasting it in raw', () => {
    expect(resetLink(configured(), 'a b&c')).toBe('https://rms.cedarfalls.gov/?reset=a%20b%26c');
  });
});
