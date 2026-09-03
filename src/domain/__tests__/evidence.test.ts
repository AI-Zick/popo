import { describe, expect, it } from 'vitest';
import {
  NEVER_BOOKED_DAYS,
  OUT_TOO_LONG_DAYS,
  UNAUDITED_DAYS,
  appendCustody,
  canRecord,
  checkCustody,
  checkItem,
  custodyState,
  findingsFor,
  nextTagNumber,
  verifyCustody,
  type CustodyDraft,
  type EvidenceItem,
} from '../evidence';

const NOW = new Date('2026-09-03T12:00:00.000Z');
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function item(partial: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: 'ev-1',
    tagNumber: '2026-000001',
    caseId: 'inc-1',
    caseNumber: '2026-000431',
    propertyItemId: '',
    category: 'general',
    description: 'Black folding knife, 3in blade',
    quantity: '1',
    make: '',
    model: '',
    serialNumber: '',
    foundAt: 'Driver footwell',
    holdReason: '',
    disposalDueAt: '',
    createdAt: daysBefore(10),
    createdBy: 'u-reyes',
    updatedAt: daysBefore(10),
    ...partial,
  };
}

function draft(partial: Partial<CustodyDraft> = {}): CustodyDraft {
  return {
    itemId: 'ev-1',
    action: 'collected',
    at: daysBefore(10),
    actorId: 'u-reyes',
    actorName: 'M. Reyes',
    toParty: 'scene',
    toName: '',
    location: '',
    reason: '',
    witnessId: '',
    witnessName: '',
    ...partial,
  };
}

/** Builds a chain by replaying drafts, the way the server will. */
async function chainOf(...drafts: CustodyDraft[]) {
  let chain: Awaited<ReturnType<typeof appendCustody>> = [];
  for (const [i, d] of drafts.entries()) chain = await appendCustody(chain, d, `c${i}`);
  return chain;
}

const collected = draft();
const booked = draft({
  action: 'booked',
  at: daysBefore(9),
  actorId: 'u-tam',
  actorName: 'D. Tam',
  toParty: 'storage',
  location: 'Room 2 · Shelf C · Bin 14',
});

/* ------------------------------------------------------------------ */

describe('the ledger is the record', () => {
  it('says nothing has happened before the first entry', () => {
    expect(custodyState([])).toMatchObject({ status: 'uncollected', closed: false });
  });

  it('follows an item from the scene to the shelf and out again', async () => {
    const chain = await chainOf(
      collected,
      booked,
      draft({
        action: 'checkedOut',
        at: daysBefore(2),
        actorId: 'u-boone',
        actorName: 'Sgt. A. Boone',
        toParty: 'lab',
        toName: 'Alabama Dept of Forensic Sciences',
        reason: 'Latent print comparison',
      }),
    );

    const state = custodyState(chain);
    expect(state.status).toBe('signedOut');
    expect(state.holder).toBe('Alabama Dept of Forensic Sciences');
    // The shelf it left is still the last place it was stored.
    expect(state.location).toBe('Room 2 · Shelf C · Bin 14');
    expect(state.closed).toBe(false);
  });

  it('does not let a shelf check look like the item moved', async () => {
    /*
      An audit entry records that somebody laid eyes on it. Treating that as a
      position change would quietly overwrite "signed out to the lab" with
      "in the property room", which is the exact lie the ledger exists to
      prevent.
    */
    const chain = await chainOf(
      collected,
      booked,
      draft({ action: 'checkedOut', at: daysBefore(4), toParty: 'court', toName: 'Circuit Court', reason: 'Trial exhibit' }),
      draft({ action: 'audited', at: daysBefore(1), actorName: 'D. Tam', toParty: 'storage' }),
    );

    expect(custodyState(chain)).toMatchObject({ status: 'signedOut', holder: 'Circuit Court' });
  });

  it('names who took a released item, and nobody for a destroyed one', async () => {
    /*
      "Who has it" is the right question for a released item and a meaningless
      one for a destroyed item — naming the clerk who signed the order reads as
      though they took it home.
    */
    const released = await chainOf(
      collected,
      booked,
      draft({ action: 'released', at: daysBefore(1), toParty: 'owner', toName: 'D. Whitfield', reason: 'Returned' }),
    );
    expect(custodyState(released).holder).toBe('D. Whitfield');

    const destroyed = await chainOf(
      collected,
      booked,
      draft({ action: 'destroyed', at: daysBefore(1), toParty: 'destruction', reason: 'Court order' }),
    );
    expect(custodyState(destroyed).holder).toBe('');
  });

  it('does not name a holder for something sitting on a shelf', async () => {
    // It is in the property room. The room is not a person.
    expect(custodyState(await chainOf(collected, booked)).holder).toBe('');
  });

  it('closes the chain once the item has gone for good', async () => {
    const chain = await chainOf(
      collected,
      booked,
      draft({
        action: 'released',
        at: daysBefore(1),
        toParty: 'owner',
        toName: 'D. Whitfield',
        reason: 'Returned to owner, case closed',
      }),
    );
    expect(custodyState(chain)).toMatchObject({ status: 'released', holder: 'D. Whitfield', closed: true });
  });
});

describe('the chain is sealed', () => {
  it('links each entry to the one before it', async () => {
    const chain = await chainOf(collected, booked);
    expect(chain[0].prevHash).toBe('');
    expect(chain[1].prevHash).toBe(chain[0].hash);
    expect(await verifyCustody(chain)).toMatchObject({ intact: true });
  });

  it('catches a transfer rewritten after the fact', async () => {
    const chain = await chainOf(collected, booked);
    // Somebody decides the shelf should have said something else.
    const tampered = [chain[0], { ...chain[1], location: 'Room 9 · Shelf A' }];
    const status = await verifyCustody(tampered);
    expect(status).toMatchObject({ intact: false, brokenAt: 1 });
    expect(status.reason).toMatch(/altered/i);
  });

  it('catches a transfer removed from the middle', async () => {
    const chain = await chainOf(
      collected,
      booked,
      draft({ action: 'checkedOut', at: daysBefore(2), toParty: 'officer', toName: 'Sgt. A. Boone', reason: 'Review' }),
    );
    const status = await verifyCustody([chain[0], chain[2]]);
    expect(status).toMatchObject({ intact: false, brokenAt: 1 });
  });

  it('covers the witness, so one cannot be added later', async () => {
    const chain = await chainOf(collected);
    const withWitness = [{ ...chain[0], witnessId: 'u-tam', witnessName: 'D. Tam' }];
    expect(await verifyCustody(withWitness)).toMatchObject({ intact: false, brokenAt: 0 });
  });
});

describe('what may happen next', () => {
  it('will not sign out something already signed out', async () => {
    const chain = await chainOf(
      collected,
      booked,
      draft({ action: 'checkedOut', at: daysBefore(2), toParty: 'lab', toName: 'ADFS', reason: 'Analysis' }),
    );
    const check = canRecord('checkedOut', item(), chain);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/signed out/i);
  });

  it('will not reopen a chain that has ended', async () => {
    const chain = await chainOf(
      collected,
      booked,
      draft({ action: 'destroyed', at: daysBefore(1), toParty: 'destruction', reason: 'Court order' }),
    );
    expect(canRecord('checkedOut', item(), chain).ok).toBe(false);
    // A mistake is fixed by saying so, not by pretending it did not happen.
    expect(canRecord('corrected', item(), chain).ok).toBe(true);
  });

  it('refuses to dispose of anything under a hold', async () => {
    const chain = await chainOf(collected, booked);
    const held = item({ holdReason: 'Appeal pending until 2028' });
    const check = canRecord('destroyed', held, chain);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/appeal pending/i);
  });

  it('needs a second signature for a firearm, drugs or cash', async () => {
    const chain = await chainOf(collected, booked);
    for (const category of ['firearm', 'drug', 'currency'] as const) {
      expect(canRecord('destroyed', item({ category }), chain).ok).toBe(false);
      expect(canRecord('destroyed', item({ category }), chain, true).ok).toBe(true);
    }
    // Everything else is one signature.
    expect(canRecord('destroyed', item({ category: 'general' }), chain).ok).toBe(true);
  });

  it('will not book in something that was never collected', () => {
    expect(canRecord('booked', item(), []).ok).toBe(false);
  });
});

describe('what the property room is told', () => {
  it('flags an item collected and never booked in', async () => {
    const chain = await chainOf(draft({ at: daysBefore(NEVER_BOOKED_DAYS + 1) }));
    const findings = findingsFor(item(), chain, { now: NOW });
    expect(findings.map((f) => f.kind)).toContain('neverBooked');
    expect(findings.find((f) => f.kind === 'neverBooked')?.severity).toBe('critical');
  });

  it('does not flag one collected this morning', async () => {
    const chain = await chainOf(draft({ at: daysBefore(0) }));
    expect(findingsFor(item(), chain, { now: NOW })).toEqual([]);
  });

  it('flags something signed out and not returned', async () => {
    const chain = await chainOf(
      collected,
      booked,
      draft({
        action: 'checkedOut',
        at: daysBefore(OUT_TOO_LONG_DAYS + 5),
        toParty: 'officer',
        toName: 'Sgt. A. Boone',
        reason: 'Follow-up',
      }),
    );
    const finding = findingsFor(item(), chain, { now: NOW }).find((f) => f.kind === 'outTooLong');
    expect(finding?.detail).toMatch(/Sgt\. A\. Boone/);
  });

  it('flags a broken chain above everything else', async () => {
    const chain = await chainOf(collected, booked);
    const findings = findingsFor(item(), chain, { now: NOW, chainIntact: false });
    expect(findings[0]).toMatchObject({ kind: 'brokenChain', severity: 'critical' });
  });

  it('flags what is overdue for disposal, unless it is on hold', async () => {
    const chain = await chainOf(collected, booked);
    const due = item({ disposalDueAt: daysBefore(30) });
    expect(findingsFor(due, chain, { now: NOW }).map((f) => f.kind)).toContain('overdue');

    const onHold = item({ disposalDueAt: daysBefore(30), holdReason: 'Appeal pending' });
    expect(findingsFor(onHold, chain, { now: NOW }).map((f) => f.kind)).not.toContain('overdue');
  });

  it('flags what nobody has laid eyes on in a year', async () => {
    const chain = await chainOf(
      draft({ at: daysBefore(UNAUDITED_DAYS + 20) }),
      draft({ ...booked, at: daysBefore(UNAUDITED_DAYS + 10) }),
    );
    expect(findingsFor(item(), chain, { now: NOW }).map((f) => f.kind)).toContain('unaudited');
  });

  it('stops flagging it once somebody checks the shelf', async () => {
    const chain = await chainOf(
      draft({ at: daysBefore(UNAUDITED_DAYS + 20) }),
      draft({ ...booked, at: daysBefore(UNAUDITED_DAYS + 10) }),
      draft({ action: 'audited', at: daysBefore(5), toParty: 'storage', location: 'Room 2 · Shelf C · Bin 14' }),
    );
    expect(findingsFor(item(), chain, { now: NOW }).map((f) => f.kind)).not.toContain('unaudited');
  });
});

describe('tag numbers', () => {
  it('starts a year at one and never repeats within it', () => {
    expect(nextTagNumber([], NOW)).toBe('2026-000001');
    expect(nextTagNumber(['2026-000001', '2026-000002'], NOW)).toBe('2026-000003');
  });

  it('ignores other years and anything unreadable', () => {
    expect(nextTagNumber(['2025-009999', 'FOUND-12', '2026-000004'], NOW)).toBe('2026-000005');
  });

  it('does not reuse a number after a gap', () => {
    // Tags are written on bags that still exist. Reuse is never right.
    expect(nextTagNumber(['2026-000001', '2026-000007'], NOW)).toBe('2026-000008');
  });
});

describe('checking what was typed', () => {
  it('wants a description and a place it was found', () => {
    const problems = checkItem(item({ description: '  ', foundAt: '' }));
    expect(problems.map((p) => p.field)).toEqual(['description', 'foundAt']);
  });

  it('wants a serial number on a firearm and a weight on drugs', () => {
    expect(checkItem(item({ category: 'firearm' })).map((p) => p.field)).toContain('serialNumber');
    expect(checkItem(item({ category: 'drug', quantity: '' })).map((p) => p.field)).toContain('quantity');
    // Not on anything else.
    expect(checkItem(item({ category: 'general' }))).toEqual([]);
  });

  it('wants a reason for anything that lets the item move or leave', () => {
    expect(checkCustody(draft({ action: 'checkedOut' })).map((p) => p.field)).toContain('reason');
    expect(checkCustody(draft({ action: 'released', toName: 'D. Whitfield' })).map((p) => p.field)).toContain('reason');
    // Booking it in is self-explanatory; where it went is not.
    expect(checkCustody(draft({ action: 'booked' })).map((p) => p.field)).toEqual(['location']);
  });

  it('wants to know who took it when it is released', () => {
    const problems = checkCustody(draft({ action: 'released', reason: 'Owner collected' }));
    expect(problems.map((p) => p.field)).toContain('toName');
  });
});
