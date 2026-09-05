import { describe, expect, it } from 'vitest';
import {
  blocking,
  canPost,
  check,
  createBulletin,
  daysLeft,
  forBriefing,
  isLive,
  needsExpiry,
  needsReview,
  REVIEW_DAYS,
  state,
  type Bulletin,
} from '@/domain/bulletin';
import { can, createUser } from '@/domain/auth';

const NOW = new Date('2026-03-10T08:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

const make = (partial: Partial<Bulletin> = {}): Bulletin =>
  createBulletin({
    id: 'b1',
    headline: 'Silver pickup, burglary on Third Street',
    postedAt: NOW.toISOString(),
    expiresAt: days(7),
    ...partial,
  });

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

describe('what an entry is right now', () => {
  it('is live before its date', () => {
    expect(state(make(), NOW)).toBe('live');
    expect(isLive(make(), NOW)).toBe(true);
  });

  it('expires on its own, with nothing having run', () => {
    /*
      The whole point of deriving it. No job expired this — the date passed and
      every read since has said so.
    */
    const later = new Date(NOW.getTime() + 8 * 86_400_000);
    expect(state(make(), later)).toBe('expired');
    expect(isLive(make(), later)).toBe(false);
  });

  it('expires the instant the date arrives, not the day after', () => {
    const at = new Date(days(7));
    expect(state(make(), at)).toBe('expired');
  });

  it('stands indefinitely when no date was given', () => {
    const standing = make({ kind: 'officerSafety', expiresAt: '' });
    const yearsOn = new Date('2029-01-01T00:00:00Z');
    expect(state(standing, yearsOn)).toBe('live');
  });

  it('reads as cleared even when the date has also passed', () => {
    /*
      "We found the car" is what happened; "the week ran out" is merely when.
      An entry somebody resolved should not read as having merely lapsed.
    */
    const found = make({
      cleared: { at: days(2), byId: 'u1', byName: 'M. Reyes', reason: 'Vehicle recovered' },
    });
    expect(state(found, new Date(days(30)))).toBe('cleared');
  });

  it('reads as withdrawn above everything else', () => {
    const gone = make({
      cleared: { at: days(1), byId: 'u1', byName: 'M. Reyes', reason: 'Found' },
      removed: { at: days(2), byId: 'u3', byName: 'R. Vance', reason: 'Posted in error' },
    });
    expect(state(gone, new Date(days(3)))).toBe('removed');
  });

  it('survives a date nobody can parse rather than vanishing', () => {
    // A bad date must not silently take a live warning off the board.
    expect(state(make({ expiresAt: 'sometime next week' }), NOW)).toBe('live');
  });
});

describe('days left', () => {
  it('counts down', () => {
    expect(daysLeft(make(), NOW)).toBe(7);
  });

  it('is null for something with no end', () => {
    expect(daysLeft(make({ expiresAt: '' }), NOW)).toBe(null);
  });

  it('goes negative once past, rather than clamping at zero', () => {
    expect(daysLeft(make(), new Date(days(9)))).toBeLessThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Rot                                                                 */
/* ------------------------------------------------------------------ */

describe('standing entries get asked about', () => {
  const standing = make({ kind: 'officerSafety', expiresAt: '' });

  it('is left alone while it is young', () => {
    expect(needsReview(standing, new Date(days(30)))).toBe(false);
  });

  it('is raised once nobody has touched it for a quarter', () => {
    expect(needsReview(standing, new Date(days(REVIEW_DAYS + 1)))).toBe(true);
  });

  it('is never raised for something that expires by itself', () => {
    expect(needsReview(make(), new Date(days(REVIEW_DAYS + 1)))).toBe(false);
  });

  it('is never raised for something already off the board', () => {
    const cleared = make({
      kind: 'officerSafety',
      expiresAt: '',
      cleared: { at: days(1), byId: 'u1', byName: 'M. Reyes', reason: 'Resolved' },
    });
    expect(needsReview(cleared, new Date(days(REVIEW_DAYS + 1)))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* What has to be filled in                                            */
/* ------------------------------------------------------------------ */

describe('what blocks a post', () => {
  it('a lookout must say when it stops', () => {
    expect(needsExpiry('bolo')).toBe(true);
    const problems = blocking(make({ expiresAt: '' }));
    expect(problems.map((p) => p.field)).toContain('expiresAt');
  });

  it('an attempt to locate must too', () => {
    expect(needsExpiry('attemptToLocate')).toBe(true);
  });

  it('a standing safety warning need not', () => {
    /*
      Forcing a date onto this kind would mean it quietly stops warning people
      while the reason it was posted is still true.
    */
    expect(needsExpiry('officerSafety')).toBe(false);
    expect(canPost(make({ kind: 'officerSafety', expiresAt: '' }))).toBe(true);
  });

  it('something has to be said in one line', () => {
    expect(blocking(make({ headline: '   ' })).map((p) => p.field)).toContain('headline');
  });

  it('a complete one blocks nothing', () => {
    expect(canPost(make())).toBe(true);
  });
});

describe('what is only worth a look', () => {
  it('warns when nothing says what to look for', () => {
    const problems = check(make({ detail: '', lookFor: '' }));
    const warning = problems.find((p) => p.field === 'lookFor');
    expect(warning?.severity).toBe('warning');
    expect(canPost(make({ detail: '', lookFor: '' }))).toBe(true);
  });

  it('warns when nobody is named to call', () => {
    expect(check(make()).some((p) => p.field === 'contact')).toBe(true);
  });

  it('is quiet once both are answered', () => {
    const full = make({ lookFor: 'Silver Ford F-150, partial plate 4KJ', contact: 'Unit 12' });
    expect(check(full)).toEqual([]);
  });

  it('takes either a description or the detail as saying what to look for', () => {
    const described = make({ detail: 'Left westbound on Third.', lookFor: '', contact: 'Unit 12' });
    expect(described.lookFor).toBe('');
    expect(check(described)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The order a shift reads them in                                     */
/* ------------------------------------------------------------------ */

describe('the briefing order', () => {
  const safety = make({
    id: 'safety',
    kind: 'officerSafety',
    headline: 'Address flagged — dog, previous assault on officers',
    postedAt: days(-40),
    expiresAt: '',
  });
  const oldBolo = make({ id: 'old', postedAt: days(-2), expiresAt: days(5) });
  const newBolo = make({ id: 'new', postedAt: days(-1), expiresAt: days(6) });
  const notice = make({ id: 'notice', kind: 'information', postedAt: NOW.toISOString() });

  it('puts officer safety first however old it is', () => {
    /*
      The one that must never sort below a fortnight of road closures: somebody
      is about to walk into something.
    */
    const order = forBriefing([notice, newBolo, oldBolo, safety], NOW).map((b) => b.id);
    expect(order[0]).toBe('safety');
  });

  it('reads newest first within a kind', () => {
    const order = forBriefing([oldBolo, newBolo], NOW).map((b) => b.id);
    expect(order).toEqual(['new', 'old']);
  });

  it('puts general information last', () => {
    const order = forBriefing([notice, newBolo, safety], NOW).map((b) => b.id);
    expect(order[order.length - 1]).toBe('notice');
  });

  it('leaves out everything not standing', () => {
    const expired = make({ id: 'expired', postedAt: days(-30), expiresAt: days(-1) });
    const cleared = make({
      id: 'cleared',
      cleared: { at: days(-1), byId: 'u1', byName: 'M. Reyes', reason: 'Found' },
    });
    const removed = make({
      id: 'removed',
      removed: { at: days(-1), byId: 'u3', byName: 'R. Vance', reason: 'Duplicate' },
    });
    const board = forBriefing([expired, cleared, removed, newBolo], NOW).map((b) => b.id);
    expect(board).toEqual(['new']);
  });

  it('does not alter the array it was given', () => {
    const board = [notice, safety];
    forBriefing(board, NOW);
    expect(board.map((b) => b.id)).toEqual(['notice', 'safety']);
  });
});

/* ------------------------------------------------------------------ */
/* Who may do what                                                     */
/* ------------------------------------------------------------------ */

describe('who may post and who may take down', () => {
  const officer = createUser({ id: 'u1', name: 'M. Reyes', role: 'officer' });
  const supervisor = createUser({ id: 'u2', name: 'A. Boone', role: 'supervisor' });
  const dispatcher = createUser({ id: 'u4', name: 'K. Doyle', role: 'dispatch' });
  const admin = createUser({ id: 'u3', name: 'R. Vance', role: 'admin' });

  it('every officer may post', () => {
    // The person holding the description is the person who just saw the car.
    expect(can(officer, 'bulletins.post')).toBe(true);
    expect(can(dispatcher, 'bulletins.post')).toBe(true);
    expect(can(supervisor, 'bulletins.post')).toBe(true);
  });

  it('an officer may not take one down', () => {
    expect(can(officer, 'bulletins.remove')).toBe(false);
  });

  it('a supervisor may not either', () => {
    /*
      Deliberate, and the one rule most likely to be argued with: removal is
      not a rank, it is a job. A sergeant who wants one gone asks dispatch or
      an administrator, or clears it, which is what they usually mean.
    */
    expect(can(supervisor, 'bulletins.remove')).toBe(false);
  });

  it('dispatch and administrators may', () => {
    expect(can(dispatcher, 'bulletins.remove')).toBe(true);
    expect(can(admin, 'bulletins.remove')).toBe(true);
  });

  it('a named officer can be designated to, without being promoted', () => {
    const designated = { ...officer, grants: ['bulletins.remove' as const] };
    expect(can(designated, 'bulletins.remove')).toBe(true);
    expect(designated.role).toBe('officer');
  });

  it('a dispatcher runs the board and nothing else', () => {
    expect(can(dispatcher, 'users.manage')).toBe(false);
    expect(can(dispatcher, 'reports.approve')).toBe(false);
    expect(can(dispatcher, 'evidence.manage')).toBe(false);
    expect(can(dispatcher, 'records.expunge')).toBe(false);
  });
});
