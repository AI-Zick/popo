import { describe, expect, it } from 'vitest';
import {
  canRelease,
  CLEARING_NEEDS_A_REASON,
  createBooking,
  createConcern,
  createItem,
  custody,
  hoursHeld,
  isUrgent,
  keepApart,
  moneyHeld,
  nextBookingNumber,
  pastReview,
  releaseBlockers,
  REVIEW_HOURS,
  REVIEW_NOTE,
  roster,
  sortConcerns,
  stillHeld,
  untraceable,
  type Booking,
  type Concern,
  type HeldItem,
} from '../booking';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const NOW = new Date('2026-09-05T12:00:00Z');

const booked = (partial: Partial<Booking> = {}): Booking =>
  createBooking({
    id: 'bk-1',
    bookingNumber: '2026-B00001',
    arrestId: 'ar-1',
    arrestNumber: '2026-A00001',
    masterId: 'p-1',
    personName: 'D. Hallett',
    bookedAt: '2026-09-05T06:00:00Z',
    bookedByName: 'Sgt. A. Boone',
    facility: 'County detention centre',
    ...partial,
  });

const item = (partial: Partial<HeldItem> = {}): HeldItem =>
  createItem({ id: `it-${Math.random()}`, description: 'Wallet', storedAt: 'Bag 14', ...partial });

const concern = (partial: Partial<Concern> = {}): Concern =>
  createConcern({
    id: `cn-${Math.random()}`,
    raisedAt: '2026-09-05T06:10:00Z',
    raisedByName: 'Sgt. A. Boone',
    ...partial,
  });

/* ------------------------------------------------------------------ */
/* Numbering                                                           */
/* ------------------------------------------------------------------ */

describe('booking numbers', () => {
  it('runs its own series, so it cannot be read as an arrest number', () => {
    expect(nextBookingNumber([], NOW)).toBe('2026-B00001');
    expect(nextBookingNumber(['2026-B00001', '2026-B00007'], NOW)).toBe('2026-B00008');
  });

  it('ignores last year’s numbers', () => {
    expect(nextBookingNumber(['2025-B00099'], NOW)).toBe('2026-B00001');
  });

  it('is not derived from the arrest number', () => {
    /*
      One arrest can be booked twice — released, then brought back on a warrant
      the same week. A number borrowed from the arrest would collide the first
      time that happened, and it is the number a jail's own paperwork uses.
    */
    const first = nextBookingNumber([], NOW);
    const second = nextBookingNumber([first], NOW);
    expect(first).not.toBe(second);
  });
});

/* ------------------------------------------------------------------ */
/* Custody                                                             */
/* ------------------------------------------------------------------ */

describe('whether somebody is still here', () => {
  it('is worked out from the times, not stored', () => {
    expect(custody(booked())).toBe('held');
    expect(custody(createBooking())).toBe('pending');
  });

  it('follows the release the moment one is recorded', () => {
    /*
      The reason there is no stored flag. A release recorded with a checkbox
      missed leaves somebody on the roster who went home yesterday, and the
      roster is what the next shift briefs from.
    */
    const out = booked({
      release: { at: '2026-09-05T11:00:00Z', reason: 'bond', to: '', releasedByName: 'D. Tam', note: '' },
    });
    expect(custody(out)).toBe('released');
  });

  it('counts the hours somebody has been held so far', () => {
    expect(hoursHeld(booked(), NOW)).toBe(6);
  });

  it('counts to the release, not to now, once they are out', () => {
    const out = booked({
      release: { at: '2026-09-05T09:00:00Z', reason: 'bond', to: '', releasedByName: '', note: '' },
    });
    expect(hoursHeld(out, NOW)).toBe(3);
  });

  it('says nothing rather than guessing when there is no booking time', () => {
    expect(hoursHeld(createBooking(), NOW)).toBeNull();
    expect(hoursHeld(booked({ bookedAt: 'not a date' }), NOW)).toBeNull();
  });

  it('raises the first-appearance clock, and says whose number it is', () => {
    const long = booked({ bookedAt: '2026-09-03T06:00:00Z' });
    expect(hoursHeld(long, NOW)).toBeGreaterThan(REVIEW_HOURS);
    expect(pastReview(long, NOW)).toBe(true);
    expect(pastReview(booked(), NOW)).toBe(false);
    // It offers a prompt, not a legal opinion.
    expect(REVIEW_NOTE).toMatch(/counsel|not advice/i);
  });

  it('does not run the clock on somebody who has gone', () => {
    const out = booked({
      bookedAt: '2026-09-01T06:00:00Z',
      release: { at: '2026-09-02T06:00:00Z', reason: 'bond', to: '', releasedByName: '', note: '' },
    });
    expect(pastReview(out, NOW)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Property                                                            */
/* ------------------------------------------------------------------ */

describe('the property bag', () => {
  it('treats a line with no outcome as still held', () => {
    expect(stillHeld(item())).toBe(true);
    expect(stillHeld(item({ outcome: 'returned' }))).toBe(false);
  });

  it('adds up the money still in the bag', () => {
    const items = [
      item({ kind: 'money', amount: '340' }),
      item({ kind: 'money', amount: '20', outcome: 'returned' }),
      item({ kind: 'valuables', description: 'Ring', amount: '900' }),
    ];
    // Only money, only what is still held — a returned note is not in the bag.
    expect(moneyHeld(items)).toBe(340);
  });

  it('catches an item that left the bag with nothing to trace it by', () => {
    /*
      "Taken into evidence" with no tag number reads the same as missing when
      somebody asks six months later, which is exactly when they ask.
    */
    const lost = [item({ description: 'Knife', outcome: 'toEvidence' })];
    expect(untraceable(lost)).toHaveLength(1);

    const traced = [item({ description: 'Knife', outcome: 'toEvidence', reference: 'E-2026-114' })];
    expect(untraceable(traced)).toEqual([]);
  });

  it('asks for no reference on something handed back to the person', () => {
    // They took it and signed for it; there is nowhere else for it to have gone.
    expect(untraceable([item({ outcome: 'returned' })])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Release                                                             */
/* ------------------------------------------------------------------ */

describe('what stops a release', () => {
  it('refuses while anything is still in the property bag', () => {
    /*
      Not a warning that can be clicked through. Property nobody accounted for
      becomes unrecoverable the moment the person walks out of the door, and it
      is always discovered weeks later by a solicitor.
    */
    const held = booked({ items: [item({ description: 'Phone' })] });
    expect(canRelease(held)).toBe(false);
    expect(releaseBlockers(held)[0].field).toBe('items');
    expect(releaseBlockers(held)[0].reason).toMatch(/still in the property bag/);
  });

  it('refuses while an item that left has nothing to trace it by', () => {
    const untraceableItem = booked({ items: [item({ outcome: 'contraband' })] });
    expect(canRelease(untraceableItem)).toBe(false);
    expect(releaseBlockers(untraceableItem).some((b) => /trace/.test(b.reason))).toBe(true);
  });

  it('counts in words that read, singular and plural', () => {
    // "1 item left the bag with nothing to trace them by" is what a hurried
    // template produces, and somebody reads every one of these messages.
    const one = booked({ items: [item({ outcome: 'contraband' })] });
    expect(releaseBlockers(one).map((b) => b.reason).join(' ')).toMatch(
      /One item left the property bag with nothing to trace it by/,
    );
    const two = booked({ items: [item({ outcome: 'contraband' }), item({ outcome: 'destroyed' })] });
    expect(releaseBlockers(two).map((b) => b.reason).join(' ')).toMatch(/2 items left .* trace them by/);
  });

  it('lets a release through once every line is answered', () => {
    const settled = booked({
      items: [
        item({ description: 'Wallet', outcome: 'returned' }),
        item({ description: 'Knife', outcome: 'toEvidence', reference: 'E-2026-114' }),
        item({ description: 'Pills', outcome: 'destroyed', reference: 'DO-2026-3' }),
      ],
    });
    expect(releaseBlockers(settled)).toEqual([]);
    expect(canRelease(settled)).toBe(true);
  });

  it('lets a release through when nothing was taken in the first place', () => {
    // An empty bag is answered. Requiring a line would invent one.
    expect(canRelease(booked())).toBe(true);
  });

  it('refuses to release somebody who was never booked in', () => {
    const never = createBooking({ id: 'bk-2' });
    expect(canRelease(never)).toBe(false);
    expect(releaseBlockers(never)[0].field).toBe('bookedAt');
  });

  it('says what to do, not just what is wrong', () => {
    const held = booked({ items: [item()] });
    expect(releaseBlockers(held)[0].tip).toMatch(/hand each one back|say where it went/i);
  });
});

/* ------------------------------------------------------------------ */
/* Concerns                                                            */
/* ------------------------------------------------------------------ */

describe('what the next shift has to know', () => {
  it('marks the ones that mean somebody must do something differently', () => {
    expect(isUrgent(concern({ kind: 'suicideRisk' }))).toBe(true);
    expect(isUrgent(concern({ kind: 'withdrawal' }))).toBe(true);
    expect(isUrgent(concern({ kind: 'communication' }))).toBe(false);
  });

  it('stops treating a cleared concern as urgent', () => {
    const cleared = concern({ kind: 'suicideRisk', clearedAt: '2026-09-05T10:00:00Z' });
    expect(isUrgent(cleared)).toBe(false);
  });

  it('puts live concerns above cleared ones, and urgent above the rest', () => {
    const sorted = sortConcerns([
      concern({ id: 'a', kind: 'mobility' }),
      concern({ id: 'b', kind: 'suicideRisk', clearedAt: '2026-09-05T09:00:00Z' }),
      concern({ id: 'c', kind: 'medical' }),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps a cleared concern rather than losing it', () => {
    /*
      The question after somebody is hurt in a cell is who knew and when it
      stopped being acted on. A concern that can be deleted cannot answer it,
      so clearing is a field on the concern rather than a removal.
    */
    const cleared = concern({
      kind: 'suicideRisk',
      detail: 'Said something on the way in',
      clearedAt: '2026-09-05T10:00:00Z',
      clearedByName: 'Sgt. A. Boone',
      clearedReason: 'Seen by the nurse, no longer assessed as at risk',
    });
    expect(cleared.detail).toBe('Said something on the way in');
    expect(cleared.raisedByName).toBe('Sgt. A. Boone');
    expect(cleared.clearedByName).toBe('Sgt. A. Boone');
    expect(CLEARING_NEEDS_A_REASON).toMatch(/why/i);
  });
});

/* ------------------------------------------------------------------ */
/* The roster                                                          */
/* ------------------------------------------------------------------ */

describe('who is in the building', () => {
  const held = booked({ id: 'bk-held', personName: 'D. Hallett' });
  const longer = booked({
    id: 'bk-long',
    personName: 'K. Iyer',
    bookedAt: '2026-09-03T06:00:00Z',
    concerns: [concern({ kind: 'withdrawal', detail: 'Coming off alcohol' })],
  });
  const gone = booked({
    id: 'bk-gone',
    personName: 'S. Cole',
    release: { at: '2026-09-05T10:00:00Z', reason: 'bond', to: '', releasedByName: '', note: '' },
  });
  const notYet = createBooking({ id: 'bk-pending', personName: 'R. Nunez' });

  it('holds only the people who are actually here', () => {
    const rows = roster([held, longer, gone, notYet], NOW);
    expect(rows.map((r) => r.booking.id)).toEqual(['bk-long', 'bk-held']);
  });

  it('puts the longest-held at the top, not the newest arrival', () => {
    /*
      The person nineteen hours into a cell is what a shift briefing is about.
      Sorting by booking time buries them under whoever just came through the
      door.
    */
    const rows = roster([held, longer], NOW);
    expect(rows[0].booking.personName).toBe('K. Iyer');
    expect(rows[0].hours).toBeGreaterThan(rows[1].hours!);
  });

  it('carries the live concerns onto the row, and not the cleared ones', () => {
    const mixed = booked({
      id: 'bk-mixed',
      concerns: [
        concern({ kind: 'medical', detail: 'Diabetic' }),
        concern({ kind: 'mentalHealth', clearedAt: '2026-09-05T08:00:00Z' }),
      ],
    });
    const [row] = roster([mixed], NOW);
    expect(row.concerns).toHaveLength(1);
    expect(row.concerns[0].detail).toBe('Diabetic');
  });

  it('flags the first-appearance clock on the roster', () => {
    const rows = roster([longer], NOW);
    expect(rows[0].pastReview).toBe(true);
  });

  it('reads keep-separate off the people who are actually here', () => {
    /*
      Derived from the live roster rather than stored as a pairing, because the
      pairing only matters while both are in the building — a stored one would
      still be warning about somebody who left on Tuesday.
    */
    const a = booked({
      id: 'bk-a',
      personName: 'D. Hallett',
      concerns: [concern({ kind: 'keepSeparate', keepSeparateFrom: 'K. Iyer' })],
    });
    const pairs = keepApart(roster([a, longer], NOW));
    expect(pairs).toHaveLength(1);
    expect(pairs[0].from).toBe('K. Iyer');

    // Once that person is released, the pairing stops being on the roster.
    const released = booked({
      ...a,
      release: { at: '2026-09-05T11:00:00Z', reason: 'bond', to: '', releasedByName: '', note: '' },
    });
    expect(keepApart(roster([released, longer], NOW))).toEqual([]);
  });
});
