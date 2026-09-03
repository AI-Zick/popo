import { describe, expect, it } from 'vitest';
import {
  blankItems,
  blockingProblems,
  checkCheck,
  checkedToday,
  checklistSections,
  checkRequest,
  createCheck,
  createChecklistItem,
  createCruiser,
  createRequest,
  criticalFailures,
  cruiserLabel,
  isOpen,
  nextRequestNumber,
  requestQueue,
  requestsForCruiser,
  sortCruisers,
  takesOffRoad,
  type ChecklistItem,
  type CruiserCheck,
  type MaintenanceRequest,
} from '../fleet';

const items: ChecklistItem[] = [
  createChecklistItem({ id: 'i1', label: 'Tyres', section: 'Walk-around', critical: true }),
  createChecklistItem({ id: 'i2', label: 'Body damage', section: 'Walk-around' }),
  createChecklistItem({ id: 'i3', label: 'Radio', section: 'Equipment', critical: true }),
  createChecklistItem({ id: 'i4', label: 'Old thing', section: 'Retired', active: false }),
];

function check(partial: Partial<CruiserCheck> = {}): CruiserCheck {
  return createCheck({
    id: 'ck-1',
    cruiserId: 'cr-1',
    cruiserUnit: '412',
    officerId: 'u-reyes',
    odometer: '84213',
    items: blankItems(items).map((i) => ({ ...i, result: 'ok' })),
    ...partial,
  });
}

function request(partial: Partial<MaintenanceRequest> = {}): MaintenanceRequest {
  return createRequest({
    id: 'mr-1',
    cruiserId: 'cr-1',
    problem: 'Pulls left under braking, worse when cold.',
    ...partial,
  });
}

describe('naming a car', () => {
  it('leads with the radio number, because that is what people say', () => {
    expect(
      cruiserLabel(createCruiser({ unit: '412', year: '2023', make: 'Ford', model: 'Explorer' })),
    ).toBe('412 — 2023 Ford Explorer');
  });

  it('copes with only a unit number', () => {
    expect(cruiserLabel(createCruiser({ unit: '412' }))).toBe('412');
  });

  it('copes with no unit number at all', () => {
    expect(cruiserLabel(createCruiser({ make: 'Ford' }))).toBe('Ford');
    expect(cruiserLabel(createCruiser())).toBe('Unnamed unit');
  });

  it('sorts radio numbers as people read them, not as strings', () => {
    const order = sortCruisers([
      createCruiser({ unit: '10' }),
      createCruiser({ unit: '9' }),
      createCruiser({ unit: '10A' }),
    ]);
    expect(order.map((c) => c.unit)).toEqual(['9', '10', '10A']);
  });
});

describe('the checklist an agency configures', () => {
  it('builds the form from the items in use', () => {
    expect(blankItems(items).map((i) => i.label)).toEqual(['Tyres', 'Body damage', 'Radio']);
  });

  it('leaves a retired item off the form without deleting it', () => {
    expect(blankItems(items).some((i) => i.label === 'Old thing')).toBe(false);
  });

  it('carries the label onto the completed check', () => {
    // An admin renaming an item later must not rewrite what was signed.
    expect(blankItems(items)[0]).toMatchObject({ itemId: 'i1', label: 'Tyres', critical: true });
  });

  it('lists sections in the order they are walked', () => {
    expect(checklistSections(items)).toEqual(['Walk-around', 'Equipment']);
  });
});

describe('filing a daily check', () => {
  it('takes a complete one', () => {
    expect(blockingProblems(checkCheck(check()))).toEqual([]);
  });

  it('will not take one with items left blank', () => {
    const half = check({ items: blankItems(items) });
    expect(blockingProblems(checkCheck(half)).map((p) => p.path)).toContain('items');
  });

  it('makes a failure be described', () => {
    const failed = check({
      items: blankItems(items).map((i) =>
        i.itemId === 'i1' ? { ...i, result: 'fail' as const } : { ...i, result: 'ok' as const },
      ),
    });
    const paths = blockingProblems(checkCheck(failed)).map((p) => p.path);
    expect(paths).toContain('items.i1');
  });

  it('accepts a described failure', () => {
    const failed = check({
      items: blankItems(items).map((i) =>
        i.itemId === 'i1'
          ? { ...i, result: 'fail' as const, note: 'Nearside rear at 22 psi.' }
          : { ...i, result: 'ok' as const },
      ),
    });
    expect(blockingProblems(checkCheck(failed))).toEqual([]);
  });

  it('treats not-applicable as answered', () => {
    const na = check({ items: blankItems(items).map((i) => ({ ...i, result: 'na' as const })) });
    expect(blockingProblems(checkCheck(na))).toEqual([]);
  });

  it('asks for the mileage without blocking on it', () => {
    const problems = checkCheck(check({ odometer: '' }));
    expect(problems.map((p) => p.path)).toContain('odometer');
    expect(blockingProblems(problems)).toEqual([]);
  });

  it('picks out the failures that take a car off the road', () => {
    const mixed = check({
      items: blankItems(items).map((i) =>
        i.result === undefined || i.itemId === 'i2'
          ? { ...i, result: 'fail' as const, note: 'Scraped wing.' }
          : i.itemId === 'i1'
            ? { ...i, result: 'fail' as const, note: 'Flat.' }
            : { ...i, result: 'ok' as const },
      ),
    });
    expect(criticalFailures(mixed).map((i) => i.label)).toEqual(['Tyres']);
  });
});

describe('whether a car has been looked at today', () => {
  const NOW = new Date('2026-09-03T06:00:00');

  it('finds a check from this morning', () => {
    const today = [check({ at: new Date('2026-09-03T05:30:00').toISOString() })];
    expect(checkedToday(today, 'cr-1', NOW)).toBe(true);
  });

  it('does not count yesterday', () => {
    const old = [check({ at: new Date('2026-09-02T23:30:00').toISOString() })];
    expect(checkedToday(old, 'cr-1', NOW)).toBe(false);
  });

  it('does not count another car', () => {
    const other = [check({ cruiserId: 'cr-2', at: NOW.toISOString() })];
    expect(checkedToday(other, 'cr-1', NOW)).toBe(false);
  });
});

describe('reporting a fault', () => {
  it('takes a described one', () => {
    expect(blockingProblems(checkRequest(request()))).toEqual([]);
  });

  it('refuses one with nothing useful in it', () => {
    expect(blockingProblems(checkRequest(request({ problem: 'brakes bad' }))).length).toBe(1);
  });

  it('refuses one with no car', () => {
    expect(blockingProblems(checkRequest(request({ cruiserId: '' }))).map((p) => p.path)).toContain(
      'cruiserId',
    );
  });

  it('lets the officer standing next to it take the car off the road', () => {
    expect(takesOffRoad('unsafe')).toBe(true);
    expect(takesOffRoad('soon')).toBe(false);
  });

  it('numbers them in their own series', () => {
    expect(nextRequestNumber([])).toBe('M-000001');
    expect(nextRequestNumber(['M-000001', 'M-000007'])).toBe('M-000008');
  });

  it('ignores anything that is not one of its own numbers', () => {
    expect(nextRequestNumber(['2026-000431', ''])).toBe('M-000001');
  });
});

describe('the supervisor’s queue', () => {
  it('puts an unsafe car first however new the report is', () => {
    const queue = requestQueue([
      request({ id: 'old', urgency: 'routine', reportedAt: '2026-01-01T00:00:00.000Z' }),
      request({ id: 'unsafe', urgency: 'unsafe', reportedAt: '2026-09-03T00:00:00.000Z' }),
    ]);
    expect(queue.map((r) => r.id)).toEqual(['unsafe', 'old']);
  });

  it('is oldest first within an urgency, so nothing rots at the bottom', () => {
    const queue = requestQueue([
      request({ id: 'newer', urgency: 'soon', reportedAt: '2026-09-02T00:00:00.000Z' }),
      request({ id: 'older', urgency: 'soon', reportedAt: '2026-09-01T00:00:00.000Z' }),
    ]);
    expect(queue.map((r) => r.id)).toEqual(['older', 'newer']);
  });

  it('drops what has been dealt with', () => {
    const queue = requestQueue([
      request({ id: 'done', status: 'resolved' }),
      request({ id: 'no', status: 'declined' }),
      request({ id: 'live', status: 'acknowledged' }),
    ]);
    expect(queue.map((r) => r.id)).toEqual(['live']);
  });

  it('counts a declined request as closed, not ignored', () => {
    expect(isOpen(request({ status: 'declined' }))).toBe(false);
    expect(isOpen(request({ status: 'scheduled' }))).toBe(true);
  });

  it('shows one car’s history newest first', () => {
    const history = requestsForCruiser(
      [
        request({ id: 'old', reportedAt: '2026-01-01T00:00:00.000Z' }),
        request({ id: 'new', reportedAt: '2026-09-01T00:00:00.000Z' }),
        request({ id: 'other', cruiserId: 'cr-2' }),
      ],
      'cr-1',
    );
    expect(history.map((r) => r.id)).toEqual(['new', 'old']);
  });
});

describe('how much description is enough', () => {
  it('takes three words that say something', () => {
    expect(blockingProblems(checkRequest(request({ problem: 'AC not working' })))).toEqual([]);
  });

  it('refuses two words that do not', () => {
    expect(blockingProblems(checkRequest(request({ problem: 'brakes bad' }))).length).toBe(1);
  });

  it('is not fooled by whitespace', () => {
    expect(blockingProblems(checkRequest(request({ problem: '   broken   ' }))).length).toBe(1);
  });
});
