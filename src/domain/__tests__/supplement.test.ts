import { describe, expect, it } from 'vitest';
import {
  canSupplement,
  checkSupplement,
  createSupplement,
  effectiveDisposition,
  isReadyToSubmit,
  MIN_NARRATIVE_WORDS,
  nextNumber,
  supplementLabel,
  supplementsFor,
  type Supplement,
} from '../supplement';
import { buildQueue, canReview } from '../review';
import { createUser } from '../auth';

const officer = createUser({ id: 'u-officer', name: 'M. Reyes', role: 'officer' });
const detective = createUser({ id: 'u-det', name: 'K. Osei', role: 'officer' });
const supervisor = createUser({ id: 'u-sup', name: 'A. Boone', role: 'supervisor' });

const NARRATIVE =
  'On 20 March I received the latent print comparison from the state lab, which identified one of the prints lifted from the door frame.';

function supp(partial: Partial<Supplement> = {}): Supplement {
  return createSupplement({
    id: 's1',
    caseId: 'inc-1',
    caseNumber: '2026-000418',
    narrative: NARRATIVE,
    createdBy: 'u-det',
    reportingOfficer: 'K. Osei',
    ...partial,
  });
}

const openCase = { clearanceStatus: 'open' as const, hasArrestee: false, status: 'approved' as const };

/* ------------------------------------------------------------------ */
/* When a supplement is allowed                                        */
/* ------------------------------------------------------------------ */

describe('when a case can be supplemented', () => {
  // "author" is the officer who wrote the report; "detective" is anyone else.
  const own = (status: 'draft' | 'pending_review' | 'approved' | 'returned') => ({
    status,
    createdBy: officer.id,
  });

  it('lets the author supplement once their report is approved', () => {
    expect(canSupplement(officer, own('approved')).ok).toBe(true);
  });

  it('refuses the author on their own draft, and says to edit the report', () => {
    // Otherwise there is a way to route material around review: file a thin
    // report, get it approved, put the substance in a supplement.
    const result = canSupplement(officer, own('draft'));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/report itself/i);
  });

  it('refuses the author while their report is with a supervisor', () => {
    const result = canSupplement(officer, own('pending_review'));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/supervisor/i);
  });

  it('lets a secondary officer supplement a report still in draft', () => {
    // Three units respond; one writes the report and the others document what
    // they did. They cannot edit the primary's sworn statement, and making
    // them wait means writing it from memory a week later.
    expect(canSupplement(detective, own('draft')).ok).toBe(true);
  });

  it('lets a secondary officer supplement while the report is in review', () => {
    expect(canSupplement(detective, own('pending_review')).ok).toBe(true);
  });

  it('lets a secondary officer supplement an approved report', () => {
    expect(canSupplement(detective, own('approved')).ok).toBe(true);
  });

  it('refuses when nobody is signed in', () => {
    expect(canSupplement(null, own('approved')).ok).toBe(false);
  });

  it('treats a report with no recorded author as the asker\'s own', () => {
    // Migrated records may have no createdBy. Falling open would let anyone
    // supplement an unapproved report, which is the case the rule exists for.
    expect(canSupplement(officer, { status: 'draft', createdBy: '' }).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Numbering                                                           */
/* ------------------------------------------------------------------ */

describe('numbering', () => {
  it('starts at one', () => {
    expect(nextNumber([], 'inc-1')).toBe(1);
  });

  it('counts within the case, not across cases', () => {
    const existing = [
      supp({ id: 'a', caseId: 'inc-1', number: 1 }),
      supp({ id: 'b', caseId: 'inc-1', number: 2 }),
      supp({ id: 'c', caseId: 'inc-2', number: 1 }),
    ];
    expect(nextNumber(existing, 'inc-1')).toBe(3);
    expect(nextNumber(existing, 'inc-2')).toBe(2);
  });

  it('does not reuse a number after one is withdrawn', () => {
    // Numbers are referred to in court. S2 must always mean the same document.
    const existing = [supp({ id: 'a', number: 1 }), supp({ id: 'c', number: 3 })];
    expect(nextNumber(existing, 'inc-1')).toBe(4);
  });

  it('reads the way an officer says it', () => {
    expect(supplementLabel(supp({ number: 2 }))).toBe('2026-000418 S2');
  });

  it('lists a case in order', () => {
    const all = [
      supp({ id: 'b', number: 2 }),
      supp({ id: 'a', number: 1 }),
      supp({ id: 'x', caseId: 'other', number: 1 }),
    ];
    expect(supplementsFor(all, 'inc-1').map((s) => s.id)).toEqual(['a', 'b']);
  });
});

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

describe('what a supplement must say', () => {
  it('accepts a real follow-up narrative', () => {
    expect(checkSupplement(supp(), openCase)).toEqual([]);
    expect(isReadyToSubmit(supp(), openCase)).toBe(true);
  });

  it('requires a narrative', () => {
    const problems = checkSupplement(supp({ narrative: '' }), openCase);
    expect(problems[0].field).toBe('narrative');
  });

  it('rejects one too short to mean anything later', () => {
    const problems = checkSupplement(supp({ narrative: 'Lab came back.' }), openCase);
    expect(problems[0].field).toBe('narrative');
    expect(problems[0].message).toMatch(/3 words/);
  });

  it('accepts exactly the minimum', () => {
    const words = Array.from({ length: MIN_NARRATIVE_WORDS }, (_, i) => `word${i}`).join(' ');
    expect(checkSupplement(supp({ narrative: words }), openCase)).toEqual([]);
  });
});

describe('changing the case disposition', () => {
  const change = (partial = {}) => ({
    clearanceStatus: 'cleared_exceptional' as const,
    exceptionalClearanceReason: 'B',
    clearedAt: '2026-03-20',
    ...partial,
  });

  it('accepts a well-formed exceptional clearance', () => {
    expect(checkSupplement(supp({ disposition: change() }), openCase)).toEqual([]);
  });

  it('rejects a change to the status the case is already in', () => {
    const problems = checkSupplement(
      supp({ disposition: change({ clearanceStatus: 'open', clearedAt: '' }) }),
      openCase,
    );
    expect(problems.some((p) => /already in that status/.test(p.message))).toBe(true);
  });

  it('requires a reason for an exceptional clearance', () => {
    const problems = checkSupplement(
      supp({ disposition: change({ exceptionalClearanceReason: '' }) }),
      openCase,
    );
    expect(problems.some((p) => /needs a reason/.test(p.message))).toBe(true);
  });

  it('requires the date the case reached the status', () => {
    // The clearance date drives the statistics, and it is rarely today.
    const problems = checkSupplement(
      supp({ disposition: change({ clearedAt: '' }) }),
      openCase,
    );
    expect(problems.some((p) => /what date/.test(p.message))).toBe(true);
  });

  it('will not clear by arrest with nobody arrested', () => {
    const problems = checkSupplement(
      supp({ disposition: change({ clearanceStatus: 'cleared_arrest' }) }),
      openCase,
    );
    expect(problems.some((p) => p.field === 'arrest')).toBe(true);
  });

  it('accepts a clearance by arrest that names the arrest', () => {
    // The arrest is usually booked under its own case number months later, so
    // a reference is what is actually available — not an arrestee on the
    // original report.
    const problems = checkSupplement(
      supp({
        disposition: change({ clearanceStatus: 'cleared_arrest' }),
        arrest: {
          personName: 'Travis Mercer',
          arrestDate: '2026-03-19',
          arrestCaseNumber: '2026-000902',
        },
      }),
      openCase,
    );
    expect(problems).toEqual([]);
  });

  it('does not ask again when the original report already has an arrestee', () => {
    const problems = checkSupplement(
      supp({ disposition: change({ clearanceStatus: 'cleared_arrest' }) }),
      { clearanceStatus: 'open', hasArrestee: true, status: 'approved' },
    );
    expect(problems).toEqual([]);
  });

  it('says nothing about disposition when the supplement carries none', () => {
    expect(checkSupplement(supp({ disposition: null }), openCase)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Which disposition wins                                              */
/* ------------------------------------------------------------------ */

describe('the case disposition a supplement produces', () => {
  const cleared = {
    clearanceStatus: 'cleared_arrest' as const,
    exceptionalClearanceReason: '',
    clearedAt: '2026-03-19',
  };
  const inactive = {
    clearanceStatus: 'inactive' as const,
    exceptionalClearanceReason: '',
    clearedAt: '2026-04-02',
  };

  it('is nothing when no supplement carries one', () => {
    expect(effectiveDisposition([supp()], 'inc-1')).toBeNull();
  });

  it('ignores a disposition on a supplement nobody approved', () => {
    // An unapproved supplement has been checked by no one. It must not move
    // the case, or the review step means nothing.
    const draft = supp({ status: 'draft', disposition: cleared });
    expect(effectiveDisposition([draft], 'inc-1')).toBeNull();
  });

  it('takes the change from an approved supplement', () => {
    const approved = supp({ status: 'approved', disposition: cleared, reviewedAt: '2026-03-20' });
    expect(effectiveDisposition([approved], 'inc-1')?.change).toEqual(cleared);
  });

  it('lets the most recent approved decision stand', () => {
    // Two detectives filing conflicting dispositions a week apart is real. The
    // answer is the latest decision, with both in the history.
    const first = supp({ id: 'a', number: 1, status: 'approved', disposition: cleared, reviewedAt: '2026-03-20' });
    const second = supp({ id: 'b', number: 2, status: 'approved', disposition: inactive, reviewedAt: '2026-04-03' });
    const result = effectiveDisposition([second, first], 'inc-1');
    expect(result?.change).toEqual(inactive);
    expect(result?.from.id).toBe('b');
  });

  it('does not read a supplement belonging to another case', () => {
    const other = supp({ id: 'x', caseId: 'inc-2', status: 'approved', disposition: cleared });
    expect(effectiveDisposition([other], 'inc-1')).toBeNull();
  });
});

describe('taking a disposition back off a case', () => {
  const cleared = {
    clearanceStatus: 'cleared_exceptional' as const,
    exceptionalClearanceReason: 'B',
    clearedAt: '2026-03-20',
  };

  it('stops winning once the supplement is returned', () => {
    // The decision was withdrawn. Leaving the case cleared would keep counting
    // the crime as solved on the strength of paperwork that says otherwise —
    // and nobody would notice until the annual return.
    const returned = supp({ status: 'returned', disposition: cleared });
    expect(effectiveDisposition([returned], 'inc-1')).toBeNull();
  });

  it('stops winning once the supplement is reopened', () => {
    // Reopening puts a supplement back to 'returned'.
    const reopened = supp({ status: 'returned', disposition: cleared });
    expect(effectiveDisposition([reopened], 'inc-1')).toBeNull();
  });

  it('falls back to an older approved supplement rather than to nothing', () => {
    const older = supp({
      id: 'a', number: 1, status: 'approved',
      disposition: { clearanceStatus: 'inactive', exceptionalClearanceReason: '', clearedAt: '2026-02-01' },
      reviewedAt: '2026-02-02',
    });
    const withdrawn = supp({ id: 'b', number: 2, status: 'returned', disposition: cleared, reviewedAt: '2026-03-20' });
    const result = effectiveDisposition([older, withdrawn], 'inc-1');
    expect(result?.from.id).toBe('a');
    expect(result?.change.clearanceStatus).toBe('inactive');
  });
});

/* ------------------------------------------------------------------ */
/* Review reuses the report machinery                                  */
/* ------------------------------------------------------------------ */

describe('reviewing a supplement', () => {
  const submitted = supp({ status: 'pending_review', submittedAt: '2026-03-20T09:00:00Z' });

  it('is reviewed by the same rules as a report', () => {
    expect(canReview(supervisor, submitted).ok).toBe(true);
  });

  it('still refuses to let the author approve their own', () => {
    // A supplement is a sworn statement too. Separation of duties does not
    // relax because the document is shorter.
    const self = createUser({ id: 'u-det', name: 'K. Osei', role: 'supervisor' });
    const result = canReview(self, submitted);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/yourself/i);
  });

  it('appears in the supervisor queue alongside reports', () => {
    const queue = buildQueue([submitted], supervisor, Date.parse('2026-03-21T09:00:00Z'));
    expect(queue).toHaveLength(1);
    expect(queue[0].waitingHours).toBe(24);
  });

  it('ages to overdue on the same clock as a report', () => {
    const queue = buildQueue([submitted], supervisor, Date.parse('2026-03-25T09:00:00Z'));
    expect(queue[0].overdue).toBe(true);
  });
});
