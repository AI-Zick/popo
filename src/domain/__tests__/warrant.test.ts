import { describe, expect, it } from 'vitest';
import {
  checkAttempt,
  checkRecall,
  checkWarrant,
  createWarrant,
  createWarrantCharge,
  extraditionWarning,
  headlineCharge,
  isOutstanding,
  outstandingDays,
  sortWarrants,
  warrantAlert,
  warrantState,
} from '../warrant';
import type { Warrant } from '../warrant';

const charge = (severity: string, description = 'Theft of property') =>
  createWarrantCharge({ id: `c-${severity}-${description}`, severity, description, statute: '13A-8-4' });

const warrant = (partial: Partial<Warrant> = {}): Warrant =>
  createWarrant({
    id: 'w1',
    personId: 'p1',
    number: 'CF-2026-0148',
    court: 'Cedar Falls Municipal Court',
    issuedOn: '2026-01-15',
    charges: [charge('felony')],
    ...partial,
  });

describe('where a warrant stands', () => {
  it('is outstanding until something happens to it', () => {
    expect(warrantState(warrant(), '2026-06-01')).toBe('active');
  });

  /*
    Order matters here. A warrant that was served is served, whatever happened
    to it afterwards — a recall recorded later does not un-arrest somebody.
  */
  it('reads as served even when it was later recalled', () => {
    const both = warrant({ servedOn: '2026-02-01', recalledOn: '2026-03-01' });
    expect(warrantState(both, '2026-06-01')).toBe('served');
  });

  it('reads as recalled rather than expired', () => {
    const both = warrant({ recalledOn: '2026-02-01', expiresOn: '2026-01-20' });
    expect(warrantState(both, '2026-06-01')).toBe('recalled');
  });

  it('stands on its last day, and not the day after', () => {
    const ending = warrant({ expiresOn: '2026-06-14' });
    expect(warrantState(ending, '2026-06-14')).toBe('active');
    expect(warrantState(ending, '2026-06-15')).toBe('expired');
  });

  it('stands indefinitely with no end date, which is the common case', () => {
    expect(isOutstanding(warrant({ expiresOn: '' }), '2099-01-01')).toBe(true);
  });

  it('counts how long it has been out', () => {
    expect(outstandingDays(warrant({ issuedOn: '2026-01-15' }), '2026-01-25')).toBe(10);
    expect(outstandingDays(warrant({ issuedOn: 'not a date' }))).toBeNull();
  });
});

describe('what a name search says', () => {
  it('says nothing when nothing is outstanding', () => {
    expect(warrantAlert([warrant({ servedOn: '2026-02-01' })], '2026-06-01')).toBe('');
    expect(warrantAlert([], '2026-06-01')).toBe('');
  });

  /*
    The line has two jobs at once: it must be impossible to miss, and it must
    say it is not the authority. A warrant alert that reads like a settled fact
    is one somebody acts on without ringing the court.
  */
  it('names the count and tells the officer to confirm it', () => {
    const line = warrantAlert([warrant()], '2026-06-01');
    expect(line).toMatch(/Outstanding warrant/);
    expect(line).toMatch(/confirm with the issuing court/i);
  });

  it('pluralises, and flags a nationally extraditable one', () => {
    const line = warrantAlert(
      [warrant({ id: 'a' }), warrant({ id: 'b', extradition: 'national' })],
      '2026-06-01',
    );
    expect(line).toMatch(/^2 outstanding warrants \(one extraditable nationally\)/);
  });
});

describe('extradition', () => {
  it('says plainly when the court will not come', () => {
    expect(extraditionWarning({ extradition: 'none' })).toMatch(/not an arrest authority/);
  });

  it('has nothing to warn about when it is national', () => {
    expect(extraditionWarning({ extradition: 'national' })).toBe('');
  });

  /*
    An unrecorded limit is not the same as no limit, and treating it as one is
    how somebody gets held on a warrant nobody will collect them on.
  */
  it('treats "not recorded" as a warning rather than as permission', () => {
    expect(extraditionWarning({ extradition: '' })).toMatch(/Ask the issuing court/);
  });

  it.each(['county', 'state', 'surrounding'] as const)('states the %s limit', (limit) => {
    expect(extraditionWarning({ extradition: limit })).toMatch(/[Ee]xtraditable/);
  });
});

describe('recording one', () => {
  it('needs a person, a number, a court and a date', () => {
    expect(checkWarrant({}).field).toBe('personId');
    expect(checkWarrant({ personId: 'p1' }).field).toBe('number');
    expect(checkWarrant({ personId: 'p1', number: 'X' }).field).toBe('court');
    expect(checkWarrant({ personId: 'p1', number: 'X', court: 'C' }).field).toBe('issuedOn');
  });

  it('says why the number matters', () => {
    expect(checkWarrant({ personId: 'p1' }).reason).toMatch(/nobody can confirm this/);
  });

  it('refuses an end date before it was issued', () => {
    const check = checkWarrant(warrant({ expiresOn: '2025-12-01' }));
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/never stand/);
  });

  it('wants to know what it is for', () => {
    const check = checkWarrant(warrant({ charges: [] }));
    expect(check.ok).toBe(false);
    expect(check.field).toBe('charges');
  });

  /*
    A search warrant and an arrest warrant get filed on the same screen by
    people in a hurry, and they are not the same authority at all.
  */
  it('catches a search warrant filed as though it were an arrest warrant', () => {
    const check = checkWarrant(warrant({ kind: 'search', charges: [charge('felony')] }));
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/authorises a search, not an arrest/);
  });

  it('lets a search warrant through when it carries no charges', () => {
    expect(checkWarrant(warrant({ kind: 'search', charges: [] })).ok).toBe(true);
  });

  it('accepts a complete one', () => {
    expect(checkWarrant(warrant()).ok).toBe(true);
  });
});

describe('attempts and recalls', () => {
  it('wants to know what happened and where', () => {
    expect(checkAttempt({}).field).toBe('outcome');
    expect(checkAttempt({ outcome: 'notHome' }).field).toBe('address');
    expect(checkAttempt({ outcome: 'notHome', address: '1142 Ashwood Ln' }).ok).toBe(true);
  });

  it('takes a reason before recalling one', () => {
    expect(checkRecall('').ok).toBe(false);
    expect(checkRecall('Quashed by the court').ok).toBe(true);
  });
});

describe('reading a list of them', () => {
  it('summarises to the most serious charge', () => {
    const many = warrant({
      charges: [charge('misdemeanor', 'Criminal trespass'), charge('felony', 'Burglary')],
    });
    expect(headlineCharge(many)).toBe('Burglary and 1 more');
    expect(headlineCharge(warrant({ charges: [charge('felony', 'Burglary')] }))).toBe('Burglary');
  });

  it('falls back to the kind when there are no charges', () => {
    expect(headlineCharge(warrant({ kind: 'search', charges: [] }))).toBe('Search warrant');
  });

  it('puts what is outstanding first, worst first within that', () => {
    const list = [
      warrant({ id: 'servedOld', servedOn: '2025-01-01' }),
      warrant({ id: 'liveMinor', charges: [charge('misdemeanor')] }),
      warrant({ id: 'liveFelony', charges: [charge('felony')] }),
      warrant({ id: 'recalled', recalledOn: '2026-02-01' }),
    ];
    expect(sortWarrants(list, '2026-06-01').map((w) => w.id)).toEqual([
      'liveFelony',
      'liveMinor',
      'servedOld',
      'recalled',
    ]);
  });

  it('does not mutate what it was given', () => {
    const list = [warrant({ id: 'a', recalledOn: '2026-02-01' }), warrant({ id: 'b' })];
    sortWarrants(list, '2026-06-01');
    expect(list.map((w) => w.id)).toEqual(['a', 'b']);
  });
});
