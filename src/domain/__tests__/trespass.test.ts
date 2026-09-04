import { describe, expect, it } from 'vitest';
import {
  checkLift,
  checkTrespass,
  createTrespass,
  daysRemaining,
  existingFor,
  isActive,
  isIndefinite,
  sortForPerson,
  trespassStanding,
  trespassState,
} from '../trespass';
import type { Trespass } from '../trespass';

const notice = (partial: Partial<Trespass> = {}): Trespass =>
  createTrespass({
    id: 'tr1',
    personId: 'p1',
    locationId: 'l1',
    servedOn: '2026-01-15',
    requestedBy: 'D. Okafor, store manager',
    ...partial,
  });

describe('whether a notice is in force', () => {
  it('holds with no end date', () => {
    const forever = notice({ expiresOn: '' });
    expect(isIndefinite(forever)).toBe(true);
    expect(trespassState(forever, '2099-01-01')).toBe('active');
  });

  /*
    The boundary that matters. An officer told "expires the 14th" reads that as
    the notice holding on the 14th, and being one day out here is the difference
    between a lawful arrest and an unlawful one.
  */
  it('holds on the last day, and not the day after', () => {
    const until = notice({ expiresOn: '2026-06-14' });
    expect(trespassState(until, '2026-06-13')).toBe('active');
    expect(trespassState(until, '2026-06-14')).toBe('active');
    expect(trespassState(until, '2026-06-15')).toBe('expired');
  });

  it('reads as lifted rather than expired when it was withdrawn', () => {
    const lifted = notice({ expiresOn: '2026-06-14', liftedAt: '2026-03-02T10:00:00Z' });
    expect(trespassState(lifted, '2026-12-01')).toBe('lifted');
    expect(isActive(lifted, '2026-04-01')).toBe(false);
  });

  it('counts the days left, and keeps counting past the end', () => {
    const until = notice({ expiresOn: '2026-06-14' });
    expect(daysRemaining(until, '2026-06-04')).toBe(10);
    expect(daysRemaining(until, '2026-06-14')).toBe(0);
    expect(daysRemaining(until, '2026-06-20')).toBe(-6);
    expect(daysRemaining(notice({ expiresOn: '' }))).toBeNull();
  });

  it('counts across a month end and a leap day', () => {
    expect(daysRemaining(notice({ expiresOn: '2028-03-01' }), '2028-02-28')).toBe(2);
  });
});

describe('what it says on screen', () => {
  it('says there is no end date rather than leaving it blank', () => {
    expect(trespassStanding(notice({ expiresOn: '' }))).toBe('In force, with no end date.');
  });

  it('warns as the end approaches, with the date rather than a countdown alone', () => {
    const soon = notice({ expiresOn: '2026-06-14' });
    expect(trespassStanding(soon, '2026-06-04')).toBe('In force until 2026-06-14 — 10 days left.');
    expect(trespassStanding(soon, '2026-06-13')).toMatch(/1 day left/);
    expect(trespassStanding(soon, '2026-06-14')).toBe('In force. Today is the last day.');
  });

  it('does not nag about an end date months away', () => {
    expect(trespassStanding(notice({ expiresOn: '2027-06-14' }), '2026-06-04')).toBe(
      'In force until 2027-06-14.',
    );
  });

  it('says plainly when it has run out', () => {
    expect(trespassStanding(notice({ expiresOn: '2026-06-14' }), '2026-08-01')).toBe(
      'Ran out 2026-06-14. Not in force.',
    );
  });

  it('names who lifted it', () => {
    const lifted = notice({ liftedAt: '2026-03-02T10:00:00Z', liftedBy: 'Sgt A. Boone' });
    expect(trespassStanding(lifted, '2026-04-01')).toBe('Lifted 2026-03-02 by Sgt A. Boone.');
  });
});

describe('recording one', () => {
  it('needs a person and a place', () => {
    expect(checkTrespass({ locationId: 'l1' }).field).toBe('personId');
    expect(checkTrespass({ personId: 'p1' }).field).toBe('locationId');
  });

  it('needs the day it was served', () => {
    expect(checkTrespass({ personId: 'p1', locationId: 'l1' }).field).toBe('servedOn');
    expect(
      checkTrespass({ personId: 'p1', locationId: 'l1', servedOn: '15/01/2026' }).field,
    ).toBe('servedOn');
  });

  it('refuses an end date that is before it was served', () => {
    const check = checkTrespass({
      personId: 'p1',
      locationId: 'l1',
      servedOn: '2026-01-15',
      expiresOn: '2025-12-01',
      requestedBy: 'A manager',
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/never be in force/);
    expect(check.field).toBe('expiresOn');
  });

  it('accepts an end date on the day it was served — a one-day notice is a notice', () => {
    expect(
      checkTrespass({
        personId: 'p1',
        locationId: 'l1',
        servedOn: '2026-01-15',
        expiresOn: '2026-01-15',
        requestedBy: 'A manager',
      }).ok,
    ).toBe(true);
  });

  it('insists on who asked for it', () => {
    const check = checkTrespass({
      personId: 'p1',
      locationId: 'l1',
      servedOn: '2026-01-15',
      requestedBy: '   ',
    });
    expect(check.ok).toBe(false);
    expect(check.field).toBe('requestedBy');
  });

  it('accepts a blank end date, which is the common case', () => {
    expect(checkTrespass(notice({ expiresOn: '' })).ok).toBe(true);
  });

  it('takes a reason before it will lift one', () => {
    expect(checkLift('').ok).toBe(false);
    expect(checkLift('  ').ok).toBe(false);
    expect(checkLift('Owner withdrew it').ok).toBe(true);
  });
});

describe('spotting a renewal', () => {
  const list = [
    notice({ id: 'a', personId: 'p1', locationId: 'l1', expiresOn: '2026-12-31' }),
    notice({ id: 'b', personId: 'p1', locationId: 'l2', expiresOn: '' }),
    notice({ id: 'c', personId: 'p2', locationId: 'l1', expiresOn: '' }),
  ];

  it('finds the notice already in force for this person and place', () => {
    expect(existingFor(list, 'p1', 'l1', '2026-06-01')?.id).toBe('a');
  });

  it('ignores one that has run out, because that is a renewal not a duplicate', () => {
    expect(existingFor(list, 'p1', 'l1', '2027-06-01')).toBeNull();
  });

  it('does not confuse another person at the same place', () => {
    expect(existingFor(list, 'p3', 'l1', '2026-06-01')).toBeNull();
  });
});

describe('the order a person’s own list reads in', () => {
  it('puts what bites today first, then what runs out soonest', () => {
    const list = [
      notice({ id: 'lifted', liftedAt: '2026-02-01T00:00:00Z' }),
      notice({ id: 'forever', expiresOn: '' }),
      notice({ id: 'expired', expiresOn: '2026-02-01' }),
      notice({ id: 'soon', expiresOn: '2026-06-20' }),
      notice({ id: 'later', expiresOn: '2027-01-01' }),
    ];
    expect(sortForPerson(list, '2026-06-01').map((t) => t.id)).toEqual([
      'soon',
      'later',
      'forever',
      'expired',
      'lifted',
    ]);
  });

  it('does not mutate what it was given', () => {
    const list = [notice({ id: 'a', expiresOn: '2027-01-01' }), notice({ id: 'b', expiresOn: '' })];
    sortForPerson(list, '2026-06-01');
    expect(list.map((t) => t.id)).toEqual(['a', 'b']);
  });
});
