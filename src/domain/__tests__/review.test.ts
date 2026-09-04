import { describe, expect, it } from 'vitest';
import {
  buildQueue,
  canRecall,
  canReopen,
  canReview,
  canSubmit,
  describeWait,
  isEditable,
  REVIEW_SLA_HOURS,
  unresolvedComments,
  type ReviewComment,
} from '../review';
import { createUser, type User } from '../auth';

const officer = createUser({ id: 'u-officer', name: 'M. Reyes', role: 'officer' });
const supervisor = createUser({ id: 'u-sup', name: 'A. Boone', role: 'supervisor' });
const otherSupervisor = createUser({ id: 'u-sup2', name: 'K. Osei', role: 'supervisor' });

const report = (partial: Partial<Parameters<typeof canReview>[1]> = {}) => ({
  status: 'pending_review' as const,
  createdBy: 'u-officer',
  reportingOfficer: 'M. Reyes',
  ...partial,
});

describe('who may review', () => {
  it('a supervisor may', () => {
    expect(canReview(supervisor, report()).ok).toBe(true);
  });

  it('a patrol officer may not', () => {
    const result = canReview(officer, report({ createdBy: 'someone-else' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/permission/i);
  });

  it('nobody signed in may', () => {
    expect(canReview(null, report()).ok).toBe(false);
  });

  it('a designated officer may, without being promoted', () => {
    const designated: User = { ...officer, id: 'u-tam', grants: ['reports.approve'] };
    expect(canReview(designated, report()).ok).toBe(true);
  });
});

describe('separation of duties', () => {
  it('nobody approves a report they wrote', () => {
    const own = report({ createdBy: supervisor.id });
    const result = canReview(supervisor, own);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/wrote it yourself|yourself/i);
  });

  it('a different supervisor may review it', () => {
    expect(canReview(otherSupervisor, report({ createdBy: supervisor.id })).ok).toBe(true);
  });

  it('falls back to allowing review when authorship was never recorded', () => {
    // Migrated records may have no author id; the check must not block on that.
    expect(canReview(supervisor, report({ createdBy: '' })).ok).toBe(true);
  });
});

describe('status transitions', () => {
  it('only a draft or a returned report is editable', () => {
    expect(isEditable('draft')).toBe(true);
    expect(isEditable('returned')).toBe(true);
    expect(isEditable('pending_review')).toBe(false);
    expect(isEditable('approved')).toBe(false);
  });

  it('refuses a second submission while one is pending', () => {
    expect(canSubmit('pending_review').ok).toBe(false);
    expect(canSubmit('draft').ok).toBe(true);
    expect(canSubmit('returned').ok).toBe(true);
  });

  it('refuses to review anything not submitted', () => {
    expect(canReview(supervisor, report({ status: 'draft' })).ok).toBe(false);
    expect(canReview(supervisor, report({ status: 'approved' })).ok).toBe(false);
  });

  it('only an approved report can be reopened, and only by a reviewer', () => {
    expect(canReopen(supervisor, 'approved').ok).toBe(true);
    expect(canReopen(supervisor, 'draft').ok).toBe(false);
    expect(canReopen(officer, 'approved').ok).toBe(false);
  });
});

describe('the queue', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

  const reports = [
    { ...report(), id: 'fresh', submittedAt: hoursAgo(2) },
    { ...report(), id: 'stale', submittedAt: hoursAgo(REVIEW_SLA_HOURS + 10) },
    { ...report({ status: 'draft' }), id: 'draft', submittedAt: '' },
    { ...report({ status: 'approved' }), id: 'done', submittedAt: hoursAgo(50) },
  ];

  it('holds only what is waiting on a supervisor', () => {
    expect(buildQueue(reports, supervisor).map((e) => e.report.id)).toEqual(['stale', 'fresh']);
  });

  it('puts the longest wait first and flags what has gone stale', () => {
    const queue = buildQueue(reports, supervisor);
    expect(queue[0].report.id).toBe('stale');
    expect(queue[0].overdue).toBe(true);
    expect(queue[1].overdue).toBe(false);
  });

  it("shows a reviewer their own report but marks it unreviewable", () => {
    const own = [{ ...report({ createdBy: supervisor.id }), id: 'mine', submittedAt: hoursAgo(1) }];
    const queue = buildQueue(own, supervisor);
    expect(queue).toHaveLength(1);
    expect(queue[0].reviewable).toBe(false);
  });

  it('tolerates a missing submission time', () => {
    const odd = [{ ...report(), id: 'odd', submittedAt: '' }];
    expect(buildQueue(odd, supervisor)[0].waitingHours).toBe(0);
  });
});

describe('comments', () => {
  const comments: ReviewComment[] = [
    { id: 'c1', path: 'incident.occurredFrom', section: 'incident', message: 'Missing', authorId: 'u-sup', authorName: 'A. Boone', createdAt: '', resolvedAt: '' },
    { id: 'c2', path: 'incident.narrative', section: 'narrative', message: 'Expand', authorId: 'u-sup', authorName: 'A. Boone', createdAt: '', resolvedAt: '2026-01-01' },
  ];

  it('separates what is still outstanding', () => {
    expect(unresolvedComments(comments).map((c) => c.id)).toEqual(['c1']);
  });
});

describe('wait times read naturally', () => {
  it('rounds to something a person would say', () => {
    expect(describeWait(0.2)).toBe('just now');
    expect(describeWait(5)).toBe('5h');
    expect(describeWait(50)).toBe('2d');
  });
});

describe('taking a report back out of the queue', () => {
  const submitted = (partial = {}) => ({
    status: 'pending_review' as const,
    createdBy: 'u-officer',
    reviewComments: [] as { id: string }[],
    ...partial,
  });

  it('the author may, while nobody has acted on it', () => {
    /*
      Without this an officer who remembers the second witness has to ask a
      supervisor to return the report — putting "returned for correction" on a
      report nothing was wrong with — or say nothing. The second is what
      actually happens.
    */
    expect(canRecall(officer, submitted()).ok).toBe(true);
  });

  it('nobody else may', () => {
    expect(canRecall(otherSupervisor, submitted()).ok).toBe(false);
    expect(canRecall(supervisor, submitted()).reason).toMatch(/who wrote it/);
  });

  it('not once a supervisor has left notes on it', () => {
    // Taking it back then would drop what they asked for.
    const withNotes = submitted({ reviewComments: [{ id: 'c1' }] });
    expect(canRecall(officer, withNotes).ok).toBe(false);
    expect(canRecall(officer, withNotes).reason).toMatch(/Answer those/);
  });

  it('not once it is approved — that is a reopen, and a supervisor does it', () => {
    const approved = submitted({ status: 'approved' as const });
    expect(canRecall(officer, approved).ok).toBe(false);
    expect(canRecall(officer, approved).reason).toMatch(/supervisor reopens it/);
  });

  it('not on a draft that was never submitted', () => {
    expect(canRecall(officer, submitted({ status: 'draft' as const })).ok).toBe(false);
  });
});
