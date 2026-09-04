import { describe, expect, it } from 'vitest';
import {
  ASSIGN_THRESHOLD,
  DEFAULT_LIMITATIONS,
  FACTORS,
  MAX_SCORE,
  checkAssignment,
  checkReview,
  checkSuspension,
  createInvestigation,
  investigationStatus,
  limitationDate,
  limitationStanding,
  limitationYears,
  mustBeWorked,
  reviewDue,
  reviewOverdueBy,
  scoringFactors,
  solvabilityScore,
  sortCaseload,
  suspensionAdvice,
} from '../investigation';
import type { Investigation } from '../investigation';

const investigation = (partial: Partial<Investigation> = {}): Investigation =>
  createInvestigation({ id: 'i1', caseId: 'c1', caseNumber: '2026-000418', ...partial });

describe('solvability', () => {
  it('adds up what the case has to go on', () => {
    expect(solvabilityScore({})).toBe(0);
    expect(solvabilityScore({ suspectNamed: true })).toBe(10);
    expect(solvabilityScore({ suspectNamed: true, cameraCoverage: true })).toBe(18);
  });

  it('ignores answers for factors that do not exist', () => {
    expect(solvabilityScore({ somethingElse: true })).toBe(0);
  });

  it('scores everything to the stated maximum', () => {
    const all = Object.fromEntries(FACTORS.map((factor) => [factor.key, true]));
    expect(solvabilityScore(all)).toBe(MAX_SCORE);
  });

  it('weighs a name above a description, because a name leads somewhere', () => {
    expect(solvabilityScore({ suspectNamed: true })).toBeGreaterThan(
      solvabilityScore({ suspectDescribed: true }),
    );
  });

  it('lists what carried the weight, best first', () => {
    const factors = scoringFactors({ suspectDescribed: true, suspectNamed: true });
    expect(factors.map((f) => f.key)).toEqual(['suspectNamed', 'suspectDescribed']);
  });

  it('reaches the assign threshold on two strong factors', () => {
    expect(solvabilityScore({ suspectNamed: true, witness: true })).toBeGreaterThanOrEqual(
      ASSIGN_THRESHOLD,
    );
  });
});

/*
  The constraint the score exists to be bounded by. A sexual assault with no
  witness, no camera and no forensics scores near zero on a checklist built for
  burglaries — and an agency that suspends on the number alone suspends exactly
  the cases it can least afford to.
*/
describe('cases that are worked whatever the number says', () => {
  it.each([
    ['09A', 'homicide'],
    ['11A', 'sexual assault'],
    ['120', 'robbery'],
    ['13A', 'aggravated assault'],
    ['36B', 'an offence against a child'],
    ['64A', 'human trafficking'],
  ])('recognises %s (%s)', (code) => {
    expect(mustBeWorked([code])).toBe(true);
  });

  it('does not sweep in ordinary property crime', () => {
    expect(mustBeWorked(['220', '23D'])).toBe(false);
  });

  it('catches one qualifying offence among several', () => {
    expect(mustBeWorked(['23D', '11A'])).toBe(true);
  });

  it('refuses to suspend one on a sentence', () => {
    const check = checkSuspension('No leads.', ['11A']);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/regardless of solvability/);
  });

  it('allows it on a real account, and says it will be marked', () => {
    const check = checkSuspension(
      'Victim declined to proceed after two contacts, no forensic result from the kit, and the named suspect has been excluded by phone records.',
      ['11A'],
    );
    expect(check.ok).toBe(true);
    expect(check.advice).toMatch(/against policy/);
  });

  it('asks much less of an ordinary property case', () => {
    expect(checkSuspension('No leads at all', ['220']).ok).toBe(true);
    expect(checkSuspension('None', ['220']).ok).toBe(false);
  });

  it('says what is still unworked rather than just refusing', () => {
    const advice = suspensionAdvice({ suspectNamed: true, cameraCoverage: true }, ['220']);
    expect(advice).toMatch(/Can a suspect be named/i);
    expect(advice).toMatch(/camera footage/i);
  });

  it('has nothing to add when there was nothing to go on', () => {
    expect(suspensionAdvice({}, ['220'])).toBe('');
  });
});

describe('where an investigation stands', () => {
  it('is unassigned until somebody has it', () => {
    expect(investigationStatus(investigation())).toBe('unassigned');
    expect(investigationStatus(investigation({ assignedToId: 'd1' }))).toBe('assigned');
  });

  it('reads as closed even when it was also suspended', () => {
    const both = investigation({ assignedToId: 'd1', suspendedAt: 'x', closedAt: 'y' });
    expect(investigationStatus(both)).toBe('closed');
  });

  it('reads as suspended over assigned', () => {
    expect(investigationStatus(investigation({ assignedToId: 'd1', suspendedAt: 'x' }))).toBe(
      'suspended',
    );
  });

  it('wants somebody named before it will assign', () => {
    expect(checkAssignment('').ok).toBe(false);
    expect(checkAssignment('d1').ok).toBe(true);
  });
});

describe('coming back to look at it', () => {
  const assigned = investigation({
    assignedToId: 'd1',
    assignedAt: '2026-01-01T00:00:00Z',
    reviewEveryDays: 30,
  });

  it('falls due a review period after it was assigned', () => {
    expect(reviewDue(assigned)).toBe('2026-01-31');
  });

  it('counts from the last review once there has been one', () => {
    const reviewed = investigation({
      ...assigned,
      reviews: [
        { id: 'r1', at: '2026-02-10T00:00:00Z', byId: '', byName: 'Sgt', decision: 'continue', note: 'x' },
      ],
    });
    expect(reviewDue(reviewed)).toBe('2026-03-12');
  });

  it('has no due date for a case nobody is working', () => {
    expect(reviewDue(investigation())).toBe('');
    expect(reviewDue(investigation({ ...assigned, suspendedAt: 'x' }))).toBe('');
  });

  it('counts how overdue it is, and does not go negative', () => {
    expect(reviewOverdueBy(assigned, '2026-02-10')).toBe(10);
    expect(reviewOverdueBy(assigned, '2026-01-20')).toBe(0);
  });

  it('wants a decision, and wants to know what moved', () => {
    expect(checkReview('', '').field).toBe('decision');
    expect(checkReview('continue', '').field).toBe('note');
    expect(checkReview('continue', 'Prints came back, chasing the match.').ok).toBe(true);
    // A suspension carries its own reason elsewhere, so this does not double up.
    expect(checkReview('suspend', '').ok).toBe(true);
  });
});

/*
  The one clock nobody can extend. A case worked past it was work that could
  never have gone anywhere, and the first person to notice is a prosecutor.
*/
describe('the statute of limitations', () => {
  it('reads a period for a named offence, and falls back for the rest', () => {
    expect(limitationYears(DEFAULT_LIMITATIONS, '220')).toBe(3);
    expect(limitationYears(DEFAULT_LIMITATIONS, '13A')).toBe(5);
    expect(limitationYears(DEFAULT_LIMITATIONS, '90Z')).toBe(3);
  });

  it('takes the shortest period on the case, because that runs out first', () => {
    expect(limitationDate(['13A', '220'], '2026-01-15T00:00:00Z')).toBe('2029-01-15');
  });

  it('gives no date when everything on it is unlimited', () => {
    expect(limitationDate(['09A'], '2026-01-15T00:00:00Z')).toBe('');
  });

  it('still dates the limited offence charged alongside an unlimited one', () => {
    expect(limitationDate(['09A', '220'], '2026-01-15T00:00:00Z')).toBe('2029-01-15');
  });

  it('says nothing rather than guessing at an unusable date', () => {
    expect(limitationDate(['220'], 'not a date')).toBe('');
    expect(limitationDate([], '2026-01-15T00:00:00Z')).toBe('');
  });

  it('warns as it approaches, with the date rather than a bare countdown', () => {
    const standing = limitationStanding('2029-01-15', '2028-09-01');
    expect(standing.soon).toBe(true);
    expect(standing.expired).toBe(false);
    expect(standing.line).toMatch(/136 days left to charge/);
  });

  it('does not nag years out', () => {
    const standing = limitationStanding('2029-01-15', '2026-06-01');
    expect(standing.soon).toBe(false);
    expect(standing.line).toBe('Chargeable until 2029-01-15.');
  });

  it('says plainly once it has gone', () => {
    const standing = limitationStanding('2029-01-15', '2029-06-01');
    expect(standing.expired).toBe(true);
    expect(standing.line).toMatch(/can no longer be charged/);
  });

  it('holds on the last day', () => {
    expect(limitationStanding('2029-01-15', '2029-01-15').expired).toBe(false);
    expect(limitationStanding('2029-01-15', '2029-01-16').expired).toBe(true);
  });

  it('is honest about having no period recorded', () => {
    expect(limitationStanding('').line).toMatch(/No limitation period recorded/);
  });
});

describe('the order a caseload reads in', () => {
  it('puts what cannot be recovered first', () => {
    const list = [
      investigation({ id: 'ordinary', assignedToId: 'd1', assignedAt: '2026-06-01T00:00:00Z', createdAt: '2026-06-01' }),
      investigation({ id: 'unassigned', createdAt: '2026-05-01' }),
      investigation({ id: 'overdue', assignedToId: 'd1', assignedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01' }),
      investigation({ id: 'expiring', assignedToId: 'd1', assignedAt: '2026-06-01T00:00:00Z', limitationDate: '2026-08-01', createdAt: '2026-02-01' }),
      investigation({ id: 'expired', assignedToId: 'd1', assignedAt: '2026-06-01T00:00:00Z', limitationDate: '2026-03-01', createdAt: '2026-03-01' }),
    ];
    expect(sortCaseload(list, '2026-06-15').map((i) => i.id)).toEqual([
      'expired',
      'expiring',
      'overdue',
      'unassigned',
      'ordinary',
    ]);
  });

  it('does not mutate what it was given', () => {
    const list = [investigation({ id: 'a' }), investigation({ id: 'b', assignedToId: 'd1' })];
    sortCaseload(list, '2026-06-15');
    expect(list.map((i) => i.id)).toEqual(['a', 'b']);
  });
});
