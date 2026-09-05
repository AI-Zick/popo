import { beforeEach, describe, expect, it } from 'vitest';
import { handle } from '../router';
import { reset } from '../store';

/**
 * What the demo says about your password.
 *
 * The demo runs entirely in one browser tab with one shared account, so there
 * is no password to change and nothing that could remember a new one. The
 * settings panel still has to render, and it has to render honestly: reading
 * when the password last changed is a fair question with a true answer
 * (never), while changing it is not something the demo can pretend to do.
 */

describe('the demo and the password panel', () => {
  beforeEach(reset);

  it('answers when it last changed, so the panel can render', async () => {
    const r = await handle('GET', '/api/auth/password', undefined);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ changedAt: '', mustChange: false });
  });

  it('claims no date it could not have', async () => {
    /*
      An invented "last changed" would be the one thing on this screen that is
      a lie, on a screen whose whole subject is your account.
    */
    const r = await handle('GET', '/api/auth/password', undefined);
    expect((r.body as { changedAt: string }).changedAt).toBe('');
  });

  it('refuses to change it, and says why', async () => {
    const r = await handle('POST', '/api/auth/password', {
      current: 'anything',
      next: 'quarry bramble hazel pitcher',
    });
    expect(r.status).toBe(400);
    expect(String((r.body as { error: string }).error)).toMatch(/everyone shares one/i);
  });

  it('does not quietly succeed', async () => {
    // The failure that would matter: an officer told it worked when it did not.
    const r = await handle('POST', '/api/auth/password', { current: 'a', next: 'b' });
    expect(r.status).not.toBe(200);
  });
});
