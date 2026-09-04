import { describe, expect, it } from 'vitest';
import {
  adviseContact,
  checkContact,
  createFieldContact,
  createSubject,
  disposalDue,
  isConclusory,
  MIN_REASON_WORDS,
  nextContactNumber,
  retentionLine,
  sortContacts,
  subjectLine,
} from '../fieldContact';
import type { FieldContact } from '../fieldContact';

const contact = (partial: Partial<FieldContact> = {}): FieldContact =>
  createFieldContact({
    id: 'fc1',
    occurredAt: '2026-03-02T02:15:00Z',
    address: '612 N Marion St',
    basis: 'consensual',
    subjects: [createSubject({ id: 's1', givenName: 'Sam' })],
    ...partial,
  });

describe('numbering', () => {
  it('marks a contact number so nobody reads it as a case number', () => {
    const now = new Date('2026-05-05T00:00:00Z');
    expect(nextContactNumber([], now)).toBe('2026-FC00001');
    expect(nextContactNumber(['2026-FC00001', '2026-FC00014'], now)).toBe('2026-FC00015');
  });

  it('starts again in a new year without tripping over the old ones', () => {
    expect(nextContactNumber(['2025-FC00090'], new Date('2026-01-02T00:00:00Z'))).toBe('2026-FC00001');
  });
});

/*
  The rule this module exists for. A detention is a seizure, and the stated
  basis is what the agency has to stand behind — tonight if somebody asks, and
  in two years if somebody sues.
*/
describe('what counts as a reason', () => {
  it.each([
    'Suspicious',
    'suspicious person',
    'Suspicious activity',
    'loitering',
    'Known to police',
    'gang member',
    'high crime area',
    'Subject appeared nervous',
    'no reason',
  ])('recognises "%s" as a conclusion rather than an observation', (phrase) => {
    expect(isConclusory(phrase)).toBe(true);
  });

  it.each([
    'Trying door handles on parked cars in the storage lot',
    'Carrying a bolt cutter at 0200 behind the closed units',
    'Matched the description from the burglary call ten minutes earlier',
  ])('leaves a real account alone: "%s"', (phrase) => {
    expect(isConclusory(phrase)).toBe(false);
  });

  it('does not flag a real account that happens to contain one of the words', () => {
    expect(
      isConclusory('Walked away from the door he had been trying when he saw me, acting nervous'),
    ).toBe(false);
  });
});

describe('recording a contact', () => {
  it('wants when, what kind, where and who', () => {
    expect(checkContact({}).field).toBe('occurredAt');
    expect(checkContact({ occurredAt: 'x' }).field).toBe('basis');
    expect(checkContact({ occurredAt: 'x', basis: 'consensual' }).field).toBe('address');
    expect(
      checkContact({ occurredAt: 'x', basis: 'consensual', address: 'Marion St' }).field,
    ).toBe('subjects');
  });

  it('accepts a location record instead of a typed address', () => {
    expect(checkContact(contact({ address: '', locationId: 'loc1' })).ok).toBe(true);
  });

  it('asks for no reason at all on a consensual conversation', () => {
    expect(checkContact(contact({ basis: 'consensual', reason: '' })).ok).toBe(true);
  });

  it('asks for no reason on a community contact either', () => {
    expect(checkContact(contact({ basis: 'community', reason: '' })).ok).toBe(true);
  });

  it('insists a detention says what the officer saw', () => {
    const check = checkContact(contact({ basis: 'detention', reason: '' }));
    expect(check.ok).toBe(false);
    expect(check.field).toBe('reason');
    expect(check.reason).toMatch(/read out in court/);
  });

  it('refuses a detention justified by a label, and quotes it back', () => {
    const check = checkContact(contact({ basis: 'detention', reason: 'Suspicious person' }));
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/“Suspicious person” is a conclusion/);
    expect(check.reason).toMatch(/What was happening/);
  });

  it('refuses a detention justified by too few words to be an account', () => {
    const check = checkContact(contact({ basis: 'detention', reason: 'Was by the units' }));
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/A sentence, not a label/);
  });

  it('accepts a detention with an actual account', () => {
    const check = checkContact(
      contact({
        basis: 'detention',
        reason: 'Trying door handles on parked cars in the storage lot at 0215',
      }),
    );
    expect(check.ok).toBe(true);
  });

  it('takes exactly the minimum number of words', () => {
    const words = Array.from({ length: MIN_REASON_WORDS }, (_, i) => `word${i}`).join(' ');
    expect(checkContact(contact({ basis: 'detention', reason: words })).ok).toBe(true);
  });
});

/*
  Advice, kept apart from refusal on purpose. A form that blocks filing over a
  judgement call is one officers learn to route around, and a contact that
  never gets written helps nobody.
*/
describe('what it says without refusing', () => {
  it('notices a consensual conversation that ended in an arrest', () => {
    expect(adviseContact(contact({ basis: 'consensual', disposition: 'arrest' }))).toMatch(
      /probably a detention by the end/,
    );
  });

  it('says that declining to give a name is not grounds for anything', () => {
    const advice = adviseContact(
      contact({
        basis: 'detention',
        reason: 'Trying door handles on parked cars in the lot',
        subjects: [createSubject({ id: 's1', declinedToIdentify: true })],
      }),
    );
    expect(advice).toMatch(/lawful in most places/);
  });

  it('has nothing to say about an ordinary contact', () => {
    expect(adviseContact(contact({ basis: 'consensual', disposition: 'advised' }))).toBe('');
  });
});

describe('how long it is kept', () => {
  it('works out the disposal date from when it happened', () => {
    expect(disposalDue({ occurredAt: '2026-03-02T02:15:00Z' }, 2)).toBe('2028-03-02');
  });

  it('honours a schedule the agency changed', () => {
    expect(disposalDue({ occurredAt: '2026-03-02T02:15:00Z' }, 5)).toBe('2031-03-02');
  });

  it('says nothing rather than guessing at an unusable date', () => {
    expect(disposalDue({ occurredAt: '' })).toBe('');
    expect(retentionLine({ occurredAt: '' })).toBe('');
  });

  it('says it in words, not just a date', () => {
    expect(retentionLine({ occurredAt: '2026-03-02T02:15:00Z' }, 2)).toBe(
      'Kept until 2028-03-02, then it comes up for disposal like any other record.',
    );
  });
});

describe('reading them back', () => {
  const nameFor = (id: string) => ({ p1: 'Dana Whitfield', p2: 'Samuel Okafor' })[id] ?? '';

  it('names who was spoken to', () => {
    expect(
      subjectLine(contact({ subjects: [createSubject({ id: 's', masterId: 'p1' })] }), nameFor),
    ).toBe('Dana Whitfield');
  });

  it('marks somebody who is not in the index as not in the index', () => {
    expect(subjectLine(contact({ subjects: [createSubject({ id: 's', givenName: 'Sam' })] }), nameFor)).toBe(
      'Sam (not on file)',
    );
  });

  it('says plainly when somebody declined to identify themselves', () => {
    expect(
      subjectLine(
        contact({ subjects: [createSubject({ id: 's', declinedToIdentify: true })] }),
        nameFor,
      ),
    ).toBe('Declined to identify');
  });

  it('stops naming people after two', () => {
    const many = contact({
      subjects: [
        createSubject({ id: 'a', masterId: 'p1' }),
        createSubject({ id: 'b', masterId: 'p2' }),
        createSubject({ id: 'c', givenName: 'Third' }),
        createSubject({ id: 'd', givenName: 'Fourth' }),
      ],
    });
    expect(subjectLine(many, nameFor)).toBe('Dana Whitfield, Samuel Okafor and 2 more');
  });

  it('reads newest first', () => {
    const list = [
      contact({ id: 'old', occurredAt: '2026-01-01T00:00:00Z' }),
      contact({ id: 'new', occurredAt: '2026-06-01T00:00:00Z' }),
    ];
    expect(sortContacts(list).map((c) => c.id)).toEqual(['new', 'old']);
  });
});
