import { describe, expect, it } from 'vitest';
import {
  countdown,
  idleCheck,
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_MS,
  KEEPALIVE_AFTER_MS,
} from '@/domain/session';

const NOW = 1_800_000_000_000;
const ago = (ms: number) => NOW - ms;
const minutes = (n: number) => n * 60_000;

describe('how close a browser is to being signed out', () => {
  it('is quiet while somebody is using it', () => {
    const check = idleCheck(ago(minutes(1)), ago(minutes(1)), NOW);
    expect(check.standing).toBe('active');
    expect(check.msLeft).toBe(IDLE_TIMEOUT_MS - minutes(1));
  });

  it('warns two minutes out', () => {
    const check = idleCheck(ago(IDLE_TIMEOUT_MS - IDLE_WARNING_MS), ago(minutes(30)), NOW);
    expect(check.standing).toBe('warning');
  });

  it('is still quiet a second before the warning', () => {
    const check = idleCheck(ago(IDLE_TIMEOUT_MS - IDLE_WARNING_MS - 1000), ago(minutes(30)), NOW);
    expect(check.standing).toBe('active');
  });

  it('says it is over once the time has run out', () => {
    const check = idleCheck(ago(IDLE_TIMEOUT_MS), ago(IDLE_TIMEOUT_MS), NOW);
    expect(check.standing).toBe('over');
    expect(check.msLeft).toBe(0);
  });

  it('never counts below zero', () => {
    expect(idleCheck(ago(minutes(300)), ago(minutes(300)), NOW).msLeft).toBe(0);
  });
});

describe('the two clocks', () => {
  it('takes whichever happened later', () => {
    /*
      Typing keeps somebody signed in even when the app has made no request,
      and a background request keeps them signed in while they read.
    */
    const typing = idleCheck(ago(minutes(1)), ago(minutes(29)), NOW);
    expect(typing.standing).toBe('active');
    const requesting = idleCheck(ago(minutes(29)), ago(minutes(1)), NOW);
    expect(requesting.standing).toBe('active');
  });

  it('warns only when both have gone quiet', () => {
    const check = idleCheck(ago(minutes(29)), ago(minutes(29)), NOW);
    expect(check.standing).toBe('warning');
  });
});

describe('telling the server the browser is still in use', () => {
  it('does not while it has spoken to it recently', () => {
    expect(idleCheck(ago(minutes(1)), ago(minutes(1)), NOW).keepAlive).toBe(false);
  });

  it('does when somebody is working but the app has been quiet', () => {
    // Somebody writing a long narrative that has caused no request.
    const check = idleCheck(ago(minutes(1)), ago(KEEPALIVE_AFTER_MS), NOW);
    expect(check.keepAlive).toBe(true);
  });

  it('does not for a browser left open on a desk', () => {
    /*
      The rule that makes this safe. A keepalive that fired on a timer rather
      than on use would hold every abandoned terminal in the building open,
      which is the control it is meant to support turned inside out.
    */
    const check = idleCheck(ago(minutes(29)), ago(minutes(29)), NOW);
    expect(check.keepAlive).toBe(false);
  });

  it('does not once the session is already over', () => {
    expect(idleCheck(ago(minutes(45)), ago(minutes(45)), NOW).keepAlive).toBe(false);
  });
});

describe('the countdown somebody reads', () => {
  it('is minutes and seconds', () => {
    expect(countdown(118_000)).toBe('1:58');
    expect(countdown(60_000)).toBe('1:00');
    expect(countdown(9_000)).toBe('0:09');
  });

  it('rounds up, so it never shows a time already gone', () => {
    expect(countdown(500)).toBe('0:01');
  });

  it('shows zero rather than a negative', () => {
    expect(countdown(0)).toBe('0:00');
    expect(countdown(-5000)).toBe('0:00');
  });
});
