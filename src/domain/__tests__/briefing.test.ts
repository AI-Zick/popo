import { describe, expect, it } from 'vitest';
import { briefing, callCount, officersOn, tallyOffenses, type Records } from '@/domain/briefing';
import { DEFAULT_PATTERN, shiftAt } from '@/domain/shift';
import type { Incident } from '@/domain/types';
import type { Arrest } from '@/domain/arrest';
import type { Booking } from '@/domain/booking';
import { createBulletin } from '@/domain/bulletin';

const local = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString();

/** The night shift of 10 March: 23:00 that day to 07:00 the next. */
const NIGHT = shiftAt(DEFAULT_PATTERN, new Date(2026, 2, 10, 23, 30));
const DURING = local(2026, 3, 11, 2, 15);
const BEFORE = local(2026, 3, 10, 20);
const AFTER = local(2026, 3, 11, 9);

const incident = (partial: Partial<Incident>): Incident =>
  ({
    id: 'i1',
    caseNumber: '2026-000001',
    status: 'approved',
    reportedAt: DURING,
    offenses: [],
    persons: [],
    reportingOfficer: 'M. Reyes',
    ...partial,
  }) as Incident;

const arrest = (partial: Partial<Arrest>): Arrest =>
  ({
    id: 'a1',
    arrestNumber: '2026-A0001',
    status: 'approved',
    arrestedAt: DURING,
    arrestingOfficerName: 'M. Reyes',
    ...partial,
  }) as Arrest;

const booking = (partial: Partial<Booking>): Booking =>
  ({ id: 'b1', bookedAt: DURING, release: null, items: [], concerns: [], ...partial }) as Booking;

const empty = (): Records => ({
  incidents: [],
  arrests: [],
  crashes: [],
  stops: [],
  contacts: [],
  citations: [],
  bookings: [],
  bulletins: [],
});

describe('what the shift picks up', () => {
  it('takes what happened inside it', () => {
    const records = { ...empty(), incidents: [incident({})] };
    expect(briefing(records, NIGHT).happened.incidents).toHaveLength(1);
  });

  it('leaves out what happened before it started', () => {
    const records = { ...empty(), incidents: [incident({ reportedAt: BEFORE })] };
    expect(briefing(records, NIGHT).happened.incidents).toHaveLength(0);
  });

  it('leaves out what happened after it ended', () => {
    const records = { ...empty(), incidents: [incident({ reportedAt: AFTER })] };
    expect(briefing(records, NIGHT).happened.incidents).toHaveLength(0);
  });

  it('says so when nothing happened at all', () => {
    /*
      Said rather than left blank. A briefing screen with nothing on it looks
      broken, and "quiet night" is a fact the sergeant reads out.
    */
    expect(briefing(empty(), NIGHT).quiet).toBe(true);
  });

  it('is not quiet when only a traffic stop happened', () => {
    const records = { ...empty(), stops: [{ id: 's1', at: DURING } as never] };
    expect(briefing(records, NIGHT).quiet).toBe(false);
  });
});

describe('what is still live is true now, not then', () => {
  it('lists somebody still in a cell', () => {
    const records = { ...empty(), bookings: [booking({})] };
    expect(briefing(records, NIGHT).live.inCustody).toHaveLength(1);
  });

  it('drops somebody who has since been released', () => {
    const released = booking({ release: { at: AFTER, reason: 'bond' } as never });
    expect(briefing({ ...empty(), bookings: [released] }, NIGHT).live.inCustody).toHaveLength(0);
  });

  it('lists somebody booked on an earlier shift who is still here', () => {
    /*
      The point of separating "live" from "happened": a person booked two days
      ago is not part of last night, and is absolutely part of the briefing.
    */
    const old = booking({ bookedAt: local(2026, 3, 8, 14) });
    const result = briefing({ ...empty(), bookings: [old] }, NIGHT);
    expect(result.live.inCustody).toHaveLength(1);
    expect(result.happened.arrests).toHaveLength(0);
  });

  it('puts the longest held first', () => {
    const records = {
      ...empty(),
      bookings: [booking({ id: 'new' }), booking({ id: 'old', bookedAt: local(2026, 3, 9, 10) })],
    };
    expect(briefing(records, NIGHT).live.inCustody.map((b) => b.id)).toEqual(['old', 'new']);
  });

  it('carries the board, officer safety first', () => {
    const records = {
      ...empty(),
      bulletins: [
        createBulletin({ id: 'notice', kind: 'information', headline: 'Road closed', postedAt: DURING }),
        createBulletin({ id: 'safety', kind: 'officerSafety', headline: 'Dog', postedAt: BEFORE }),
      ],
    };
    expect(briefing(records, NIGHT).live.board.map((b) => b.id)).toEqual(['safety', 'notice']);
  });

  it('leaves a cleared BOLO off it', () => {
    const cleared = createBulletin({
      id: 'done',
      headline: 'Found',
      postedAt: DURING,
      cleared: { at: DURING, byId: 'u1', byName: 'M. Reyes', reason: 'Recovered' },
    });
    expect(briefing({ ...empty(), bulletins: [cleared] }, NIGHT).live.board).toHaveLength(0);
  });
});

describe('what nobody finished', () => {
  it('names a report still in draft, and who it belongs to', () => {
    // A number the sergeant cannot act on versus a conversation they can have.
    const records = { ...empty(), incidents: [incident({ status: 'draft' })] };
    const [loose] = briefing(records, NIGHT).loose;
    expect(loose.kind).toBe('draft');
    expect(loose.who).toBe('M. Reyes');
    expect(loose.label).toBe('2026-000001');
  });

  it('leaves an approved report alone', () => {
    expect(briefing({ ...empty(), incidents: [incident({})] }, NIGHT).loose).toHaveLength(0);
  });

  it('names an arrest whose paperwork has not gone up', () => {
    const records = { ...empty(), arrests: [arrest({ status: 'draft' })] };
    expect(briefing(records, NIGHT).loose.map((l) => l.kind)).toContain('unsubmittedArrest');
  });

  it('carries a sent-back report from any shift, not only this one', () => {
    /*
      Deliberately not filtered to the shift. A report returned three days ago
      and still sitting there is more overdue, not less — and this list is the
      one place anybody would notice it.
    */
    const old = incident({ id: 'old', status: 'returned', reportedAt: local(2026, 3, 7, 10) });
    const result = briefing({ ...empty(), incidents: [old] }, NIGHT);
    expect(result.loose.map((l) => l.kind)).toEqual(['sentBack']);
    expect(result.happened.incidents).toHaveLength(0);
  });

  it('does not list the same draft twice', () => {
    const records = { ...empty(), incidents: [incident({ status: 'draft' })] };
    expect(briefing(records, NIGHT).loose).toHaveLength(1);
  });
});

describe('reading the shift at a glance', () => {
  it('counts everything that happened as one number', () => {
    const records = {
      ...empty(),
      incidents: [incident({})],
      arrests: [arrest({})],
      stops: [{ id: 's1', at: DURING } as never],
    };
    expect(callCount(briefing(records, NIGHT).happened)).toBe(3);
  });

  it('tallies offenses commonest first', () => {
    const withOffense = (id: string, code: string) =>
      incident({ id, offenses: [{ code }] as never });
    const tally = tallyOffenses([
      withOffense('a', '220'),
      withOffense('b', '220'),
      withOffense('c', '23F'),
    ]);
    expect(tally[0].code).toBe('220');
    expect(tally[0].count).toBe(2);
  });

  it('names the officers who did anything, without repeating them', () => {
    const records = {
      ...empty(),
      incidents: [incident({ id: 'a' }), incident({ id: 'b' })],
      arrests: [arrest({ arrestingOfficerName: 'D. Tam' })],
    };
    expect(officersOn(briefing(records, NIGHT).happened)).toEqual(['D. Tam', 'M. Reyes']);
  });
});
