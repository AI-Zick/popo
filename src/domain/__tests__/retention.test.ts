import { describe, expect, it } from 'vitest';
import {
  blockingProblems,
  canExecute,
  certificateFor,
  certificates,
  checkOrder,
  createOrder,
  DEFAULT_SCHEDULE,
  isLive,
  manifestTotal,
  needsTwoPeople,
  nextOrderReference,
  ordersFor,
  ordersWaiting,
  retentionDue,
  ruleFor,
  type DisposalOrder,
  type ManifestLine,
} from '../retention';

const NOW = new Date('2026-09-03T12:00:00Z');

function order(partial: Partial<DisposalOrder> = {}): DisposalOrder {
  return createOrder({
    id: 'ord-1',
    reference: 'X-000001',
    kind: 'expunge',
    court: 'St. Clair County Circuit Court',
    docket: 'CC-2026-118',
    orderedOn: '2026-08-20',
    instruction: 'All records of the arrest are to be destroyed within 30 days.',
    subjectId: 'inc-1',
    subjectLabel: '2026-000431',
    ...partial,
  });
}

describe('when a record may be destroyed', () => {
  it('counts the years from the date the rule names', () => {
    const rule = ruleFor(DEFAULT_SCHEDULE, 'stop')!;
    const result = retentionDue(rule, '2022-09-03', NOW);
    expect(result.dueOn).toBe('2025-09-03');
    expect(result.due).toBe(true);
  });

  it('is not due before its date', () => {
    const rule = ruleFor(DEFAULT_SCHEDULE, 'stop')!;
    expect(retentionDue(rule, '2025-01-01', NOW).due).toBe(false);
  });

  it('never makes a permanent record due', () => {
    const rule = ruleFor(DEFAULT_SCHEDULE, 'evidence')!;
    const result = retentionDue(rule, '1990-01-01', NOW);
    expect(result.permanent).toBe(true);
    expect(result.due).toBe(false);
  });

  it('refuses to guess when the clock never started', () => {
    // A missing closing date must not become a destruction order.
    const rule = ruleFor(DEFAULT_SCHEDULE, 'incident')!;
    const result = retentionDue(rule, '', NOW);
    expect(result.due).toBe(false);
    expect(result.reason).toContain('the date the case was closed');
  });

  it('treats an unparseable date the same way', () => {
    const rule = ruleFor(DEFAULT_SCHEDULE, 'incident')!;
    expect(retentionDue(rule, 'last tuesday', NOW).due).toBe(false);
  });

  it('says so when nothing in the schedule covers a record', () => {
    expect(retentionDue(null, '2000-01-01', NOW).reason).toContain('No rule');
  });

  it('ships a schedule with no authority filled in, because it is not law', () => {
    expect(DEFAULT_SCHEDULE.every((r) => r.authority === '')).toBe(true);
  });
});

describe('what an order has to say', () => {
  it('takes a complete one', () => {
    expect(blockingProblems(checkOrder(order()))).toEqual([]);
  });

  it('will not act without a court, a docket and a date', () => {
    const bare = order({ court: '', docket: '', orderedOn: '' });
    const paths = blockingProblems(checkOrder(bare)).map((p) => p.path);
    expect(paths).toEqual(expect.arrayContaining(['court', 'docket', 'orderedOn']));
  });

  it('refuses an order dated in the future', () => {
    const ahead = order({ orderedOn: '2030-01-01' });
    expect(blockingProblems(checkOrder(ahead)).map((p) => p.title)).toContain(
      'The order is dated in the future',
    );
  });

  it('wants a destruction order written out in words', () => {
    const vague = order({ instruction: 'expunge' });
    expect(blockingProblems(checkOrder(vague)).map((p) => p.path)).toContain('instruction');
  });

  it('does not demand the same of a sealing order', () => {
    expect(blockingProblems(checkOrder(order({ kind: 'seal', instruction: '' })))).toEqual([]);
  });

  it('needs something to act on', () => {
    expect(blockingProblems(checkOrder(order({ subjectId: '' }))).map((p) => p.path)).toContain(
      'subjectId',
    );
  });
});

describe('two people', () => {
  it('stops the person who proposed it carrying it out', () => {
    const proposed = order({ status: 'proposed', proposedBy: 'u-vance' });
    const check = canExecute(proposed, 'u-vance');
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('two people');
  });

  it('lets somebody else carry it out', () => {
    const proposed = order({ status: 'proposed', proposedBy: 'u-vance' });
    expect(canExecute(proposed, 'u-boone').ok).toBe(true);
  });

  it('refuses one nobody has proposed', () => {
    expect(canExecute(order({ status: 'draft' }), 'u-boone').ok).toBe(false);
  });

  it('refuses one already carried out', () => {
    const done = order({ status: 'executed', proposedBy: 'u-vance' });
    expect(canExecute(done, 'u-boone').reason).toContain('already');
  });

  it('refuses a withdrawn one', () => {
    expect(canExecute(order({ status: 'withdrawn' }), 'u-boone').ok).toBe(false);
  });

  it('does not ask for a second person to unseal, which destroys nothing', () => {
    expect(needsTwoPeople('unseal')).toBe(false);
    expect(needsTwoPeople('seal')).toBe(true);
    expect(needsTwoPeople('expunge')).toBe(true);
  });
});

describe('the certificate', () => {
  const lines: ManifestLine[] = [
    { kind: 'Incident reports', count: 1, examples: ['2026-000431'] },
    { kind: 'Arrest records', count: 2, examples: ['2026-A00001', '2026-A00002'] },
  ];

  it('counts what went', () => {
    const cert = certificateFor(
      order({ executedByName: 'Sgt. A. Boone', proposedByName: 'R. Vance' }),
      lines,
      7,
    );
    expect(cert.destroyed).toBe(3);
    expect(cert.auditRedacted).toBe(7);
  });

  it('carries none of what it destroyed', () => {
    // The whole point: a certificate holding case numbers is a copy of the
    // record it was supposed to have destroyed.
    const cert = certificateFor(order(), lines, 0);
    expect(cert.lines.every((l) => l.examples.length === 0)).toBe(true);
    expect(JSON.stringify(cert)).not.toContain('2026-000431');
  });

  it('keeps the court’s reference, which is public record', () => {
    const cert = certificateFor(order(), lines, 0);
    expect(cert.docket).toBe('CC-2026-118');
    expect(cert.court).toContain('St. Clair');
  });

  it('names both people', () => {
    const cert = certificateFor(
      order({ executedByName: 'Sgt. A. Boone', proposedByName: 'R. Vance' }),
      lines,
      0,
    );
    expect(cert.executedByName).toBe('Sgt. A. Boone');
    expect(cert.proposedByName).toBe('R. Vance');
  });

  it('adds up a manifest', () => {
    expect(manifestTotal(lines)).toBe(3);
    expect(manifestTotal([])).toBe(0);
  });
});

describe('the list of orders', () => {
  it('numbers them in their own series', () => {
    expect(nextOrderReference([])).toBe('X-000001');
    expect(nextOrderReference(['X-000001', 'X-000004'])).toBe('X-000005');
    expect(nextOrderReference(['2026-000431'])).toBe('X-000001');
  });

  it('queues what is waiting on a second person, oldest first', () => {
    const waiting = ordersWaiting([
      order({ id: 'new', status: 'proposed', proposedAt: '2026-09-02T00:00:00.000Z' }),
      order({ id: 'old', status: 'proposed', proposedAt: '2026-09-01T00:00:00.000Z' }),
      order({ id: 'done', status: 'executed' }),
    ]);
    expect(waiting.map((o) => o.id)).toEqual(['old', 'new']);
  });

  it('knows which orders are still live', () => {
    expect(isLive(order({ status: 'draft' }))).toBe(true);
    expect(isLive(order({ status: 'proposed' }))).toBe(true);
    expect(isLive(order({ status: 'executed' }))).toBe(false);
    expect(isLive(order({ status: 'withdrawn' }))).toBe(false);
  });

  it('finds every order about one subject, newest first', () => {
    const found = ordersFor(
      [
        order({ id: 'a', subjectId: 'inc-1', createdAt: '2026-01-01T00:00:00.000Z' }),
        order({ id: 'b', subjectId: 'inc-1', createdAt: '2026-09-01T00:00:00.000Z' }),
        order({ id: 'c', subjectId: 'inc-2' }),
      ],
      'inc-1',
    );
    expect(found.map((o) => o.id)).toEqual(['b', 'a']);
  });

  it('collects the certificates, newest first', () => {
    const list = certificates([
      order({ certificate: certificateFor(order(), [], 0, '2026-01-01T00:00:00.000Z') }),
      order({ certificate: certificateFor(order(), [], 0, '2026-09-01T00:00:00.000Z') }),
      order({ certificate: null }),
    ]);
    expect(list.map((c) => c.executedAt)).toEqual([
      '2026-09-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
  });
});
