import { describe, expect, it } from 'vitest';
import {
  adviseCitation,
  awaitingCourt,
  chargeCount,
  checkCitation,
  checkVoid,
  citationLine,
  citationState,
  createCitation,
  createViolation,
  isWarningOnly,
  reconcile,
  recordingDelayDays,
  sortCitations,
  violationLine,
} from '../citation';
import type { Citation } from '../citation';

const NOW = new Date('2026-06-01T12:00:00Z');

const speeding = (partial = {}) =>
  createViolation({
    id: 'v1',
    statute: '32-5A-171',
    description: 'Speeding',
    speed: '42',
    speedLimit: '25',
    ...partial,
  });

const citation = (partial: Partial<Citation> = {}): Citation =>
  createCitation({
    id: 'c1',
    number: 'A-4471902',
    issuedAt: '2026-05-30T15:20:00Z',
    recordedAt: '2026-05-30T18:00:00Z',
    subjectName: 'Whitfield, Dana',
    violations: [speeding()],
    ...partial,
  });

describe('recording one', () => {
  it('insists on the number off the ticket, and says why', () => {
    const check = checkCitation({ ...citation(), number: '' }, NOW);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/how the court, the clerk and the driver all know this one/);
  });

  /*
    This records a ticket that already exists. A future issue time is almost
    always a mistyped year, and it would sit unmatched against the court's
    return for as long as anybody cared to look.
  */
  it('refuses a ticket issued in the future', () => {
    const check = checkCitation({ ...citation(), issuedAt: '2027-01-04T10:00:00Z' }, NOW);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/already been handed over/);
  });

  it('allows a minute of clock skew, so a ticket written just now goes in', () => {
    expect(checkCitation({ ...citation(), issuedAt: '2026-06-01T12:00:30Z' }, NOW).ok).toBe(true);
  });

  it('wants to know what it was for', () => {
    expect(checkCitation({ ...citation(), violations: [] }, NOW).field).toBe('violations');
  });

  it('wants a statute or a description on each line', () => {
    const blank = createViolation({ id: 'v2' });
    expect(checkCitation({ ...citation(), violations: [blank] }, NOW).ok).toBe(false);
  });

  /*
    The whole charge on a speeding ticket is the difference between two
    numbers. One of them alone does not state an offence, and the first person
    to notice is the prosecutor.
  */
  it('refuses a speed with no limit beside it', () => {
    const check = checkCitation(
      { ...citation(), violations: [speeding({ speedLimit: '' })] },
      NOW,
    );
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/What was the limit/);
  });

  it('refuses a limit with no speed', () => {
    const check = checkCitation({ ...citation(), violations: [speeding({ speed: '' })] }, NOW);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/How fast were they going/);
  });

  it('leaves a non-speed charge alone', () => {
    const noSeatbelt = createViolation({ id: 'v3', description: 'No seat belt' });
    expect(checkCitation({ ...citation(), violations: [noSeatbelt] }, NOW).ok).toBe(true);
  });

  it('wants to know who it was issued to', () => {
    expect(checkCitation({ ...citation(), subjectName: '' }, NOW).field).toBe('subjectName');
  });

  it('accepts a person on file instead of a typed name', () => {
    expect(checkCitation({ ...citation(), subjectName: '', personId: 'p1' }, NOW).ok).toBe(true);
  });

  it('refuses a court date before the ticket was written', () => {
    const check = checkCitation({ ...citation(), courtDate: '2026-05-01' }, NOW);
    expect(check.ok).toBe(false);
    expect(check.field).toBe('courtDate');
  });

  it('accepts a complete one', () => {
    expect(checkCitation(citation(), NOW).ok).toBe(true);
  });

  it('takes three words before it will void one', () => {
    expect(checkVoid('mistake').ok).toBe(false);
    expect(checkVoid('Wrong plate transcribed').ok).toBe(true);
  });
});

describe('what it says without refusing', () => {
  it('notices a court date on a ticket that is all warnings', () => {
    const warned = citation({
      violations: [speeding({ warningOnly: true })],
      courtDate: '2026-07-01',
    });
    expect(adviseCitation(warned)).toMatch(/nothing to appear for/);
  });

  it('flags a ticket keyed in long after it was written', () => {
    const late = citation({ issuedAt: '2026-05-01T10:00:00Z', recordedAt: '2026-05-30T10:00:00Z' });
    expect(adviseCitation(late)).toMatch(/written 29 days ago/);
    expect(adviseCitation(late)).toMatch(/may already have processed it/);
  });

  it('says nothing about one entered the same day', () => {
    expect(adviseCitation(citation())).toBe('');
  });

  it('measures the delay, and never reports a negative one', () => {
    expect(recordingDelayDays({ issuedAt: '2026-05-01T10:00:00Z', recordedAt: '2026-05-04T10:00:00Z' })).toBe(3);
    expect(recordingDelayDays({ issuedAt: '2026-05-04T10:00:00Z', recordedAt: '2026-05-01T10:00:00Z' })).toBe(0);
    expect(recordingDelayDays({ issuedAt: '', recordedAt: '' })).toBeNull();
  });
});

describe('where it stands', () => {
  it('is issued until the court says otherwise', () => {
    expect(citationState(citation())).toBe('issued');
    expect(citationState(citation({ disposition: 'pending' }))).toBe('issued');
    expect(citationState(citation({ disposition: 'guilty' }))).toBe('disposed');
  });

  it('reads as voided whatever the court did', () => {
    expect(citationState(citation({ voidedAt: 'x', disposition: 'guilty' }))).toBe('voided');
  });

  it('knows a ticket where nothing is owed', () => {
    expect(isWarningOnly(citation({ violations: [speeding({ warningOnly: true })] }))).toBe(true);
    expect(isWarningOnly(citation())).toBe(false);
    expect(isWarningOnly(citation({ violations: [] }))).toBe(false);
  });

  it('counts only the charges that are charges', () => {
    const mixed = citation({
      violations: [speeding(), createViolation({ id: 'v9', description: 'No belt', warningOnly: true })],
    });
    expect(chargeCount(mixed)).toBe(1);
  });

  it('reads a speeding line the way somebody says it', () => {
    expect(violationLine(speeding())).toBe('Speeding — 42 in a 25');
    expect(violationLine(createViolation({ id: 'v', description: 'No seat belt' }))).toBe('No seat belt');
  });

  it('summarises the whole ticket', () => {
    expect(citationLine(citation())).toBe('Speeding — 42 in a 25');
    const two = citation({ violations: [speeding(), createViolation({ id: 'v2', description: 'No belt' })] });
    expect(citationLine(two)).toBe('Speeding — 42 in a 25 and 1 more');
    expect(citationLine(citation({ violations: [] }))).toBe('No violation recorded');
  });
});

/*
  The reason an officer can enter one by hand at all. When the MDT submission
  arrives it has to fill in the record already here — two rows for one ticket
  is an activity report nobody trusts.
*/
describe('reconciling an MDT submission with a hand-entered ticket', () => {
  const typed = citation({
    source: 'officer',
    driverLicense: '',
    plate: 'GUESS1',
    notes: 'Driver was polite, said the sign was hidden by a branch.',
  });

  it('fills in what the officer could not', () => {
    const merged = reconcile(typed, { driverLicense: 'AL4471902', driverLicenseState: 'AL' });
    expect(merged.driverLicense).toBe('AL4471902');
    expect(merged.driverLicenseState).toBe('AL');
  });

  it('corrects a machine-readable field the officer got wrong', () => {
    expect(reconcile(typed, { plate: '4AC7821' }).plate).toBe('4AC7821');
  });

  it('never touches what a person wrote', () => {
    const merged = reconcile(typed, { notes: 'Automated note' } as never);
    expect(merged.notes).toBe('Driver was polite, said the sign was hidden by a branch.');
  });

  it('marks the record as having come from the MDT in the end', () => {
    expect(reconcile(typed, { plate: '4AC7821' }).source).toBe('mdt');
  });

  it('replaces the charges whole rather than merging them', () => {
    const merged = reconcile(typed, {
      violations: [createViolation({ id: 'mdt1', description: 'Speeding', speed: '44', speedLimit: '25' })],
    });
    expect(merged.violations).toHaveLength(1);
    expect(merged.violations[0].speed).toBe('44');
  });

  it('links the person and vehicle it resolved, without unlinking ours', () => {
    const linked = citation({ personId: 'ours' });
    expect(reconcile(linked, { personId: 'theirs', vehicleId: 'v1' }).personId).toBe('ours');
    expect(reconcile(linked, { personId: 'theirs', vehicleId: 'v1' }).vehicleId).toBe('v1');
  });

  it('returns the same object when there is nothing to add', () => {
    expect(reconcile(typed, {})).toBe(typed);
    expect(reconcile(typed, { plate: 'GUESS1' })).toBe(typed);
  });
});

describe('reading a list of them', () => {
  it('reads newest first', () => {
    const list = [
      citation({ id: 'old', issuedAt: '2026-01-01T00:00:00Z' }),
      citation({ id: 'new', issuedAt: '2026-05-01T00:00:00Z' }),
    ];
    expect(sortCitations(list).map((c) => c.id)).toEqual(['new', 'old']);
  });

  it('chases the court oldest first, and leaves warnings out of it', () => {
    const list = [
      citation({ id: 'recent', issuedAt: '2026-05-01T00:00:00Z' }),
      citation({ id: 'stale', issuedAt: '2026-01-01T00:00:00Z' }),
      citation({ id: 'warning', issuedAt: '2025-01-01T00:00:00Z', violations: [speeding({ warningOnly: true })] }),
      citation({ id: 'done', issuedAt: '2025-06-01T00:00:00Z', disposition: 'guilty' }),
      citation({ id: 'void', issuedAt: '2025-02-01T00:00:00Z', voidedAt: 'x' }),
    ];
    expect(awaitingCourt(list).map((c) => c.id)).toEqual(['stale', 'recent']);
  });
});
