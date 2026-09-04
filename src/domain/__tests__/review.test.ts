import { describe, expect, it } from 'vitest';
import {
  buildQueue,
  canDiscard,
  canHandOff,
  canRecall,
  canReopen,
  canReview,
  canSubmit,
  describeWait,
  handOffPatch,
  isUntouched,
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

describe('handing a report to another officer', () => {
  const draft = (partial = {}) => ({
    status: 'draft' as const,
    createdBy: 'u-officer',
    reportingOfficer: 'M. Reyes',
    reportingBadge: '4417',
    supportingOfficers: [] as { id: string; name: string; badge: string; role: string }[],
    ...partial,
  });

  const dtam = { id: 'u-tam', name: 'D. Tam', badge: '3388' };
  let n = 0;
  const ids = () => `sof_${(n += 1)}`;

  it('the officer holding it may', () => {
    expect(canHandOff(officer, draft()).ok).toBe(true);
  });

  it('a supervisor may reassign somebody else’s', () => {
    expect(canHandOff(supervisor, draft({ createdBy: 'u-someone' })).ok).toBe(true);
  });

  it('another officer may not', () => {
    const other = createUser({ id: 'u-other', name: 'K. Lang', role: 'officer' });
    expect(canHandOff(other, draft()).ok).toBe(false);
  });

  it('not while a supervisor has it', () => {
    const check = canHandOff(officer, draft({ status: 'pending_review' as const }));
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/Take it back first/);
  });

  it('a report sent back is still the officer’s to hand on', () => {
    expect(canHandOff(officer, draft({ status: 'returned' as const })).ok).toBe(true);
  });

  it('keeps the officer who started it, as a supporting officer', () => {
    /*
      The whole point. A report that ends up with one name on it when two
      people worked it misleads everybody who reads it afterwards — including
      the first officer, when somebody asks them two years later what they saw.
    */
    const patch = handOffPatch(draft(), dtam, ids);
    expect(patch.reportingOfficer).toBe('D. Tam');
    expect(patch.reportingBadge).toBe('3388');
    expect(patch.createdBy).toBe('u-tam');
    expect(patch.supportingOfficers).toHaveLength(1);
    expect(patch.supportingOfficers[0]).toMatchObject({
      name: 'M. Reyes',
      badge: '4417',
      role: 'Started the report',
    });
  });

  it('takes the incoming officer off the supporting list', () => {
    /*
      Reports get handed back. Without this, an officer who gives one up and
      later takes it again is listed twice — once as the author, once as their
      own assistant.
    */
    const once = draft(handOffPatch(draft(), dtam, ids));
    expect(once.supportingOfficers.map((o) => o.name)).toEqual(['M. Reyes']);

    const back = handOffPatch(once, { id: 'u-officer', name: 'M. Reyes', badge: '4417' }, ids);
    expect(back.reportingOfficer).toBe('M. Reyes');
    expect(back.supportingOfficers.map((o) => o.name)).toEqual(['D. Tam']);
  });

  it('does not list the same officer twice', () => {
    const messy = draft({
      supportingOfficers: [{ id: 'x', name: 'M. Reyes', badge: '4417', role: 'Assisted' }],
    });
    const patch = handOffPatch(messy, dtam, ids);
    expect(patch.supportingOfficers.filter((o) => o.name === 'M. Reyes')).toHaveLength(1);
  });

  it('adds nobody when the report had no officer on it yet', () => {
    const patch = handOffPatch(draft({ reportingOfficer: '' }), dtam, ids);
    expect(patch.supportingOfficers).toHaveLength(0);
  });
});

describe('throwing away a report nobody wrote on', () => {
  const empty = (partial = {}) => ({
    status: 'draft' as const,
    createdBy: 'u-officer',
    offenses: [] as unknown[],
    persons: [] as unknown[],
    property: [] as unknown[],
    vehicles: [] as unknown[],
    narrative: '',
    locationId: '',
    occurredFrom: '',
    ...partial,
  });

  it('lets the officer who started it be rid of it', () => {
    /*
      A report is created by pressing a button, and pressing it by mistake is
      ordinary. Making somebody file it to be rid of it puts a case number on
      nothing and teaches them to submit junk.
    */
    expect(canDiscard(officer, empty()).ok).toBe(true);
  });

  it('refuses once anything real is on it', () => {
    // Then it is a record, and records are destroyed under a court order.
    const written = empty({ narrative: 'On the above date I was dispatched to' });
    expect(canDiscard(officer, written).ok).toBe(false);
    expect(canDiscard(officer, written).reason).toMatch(/court order/);

    for (const patch of [
      { offenses: [{}] },
      { persons: [{}] },
      { property: [{}] },
      { vehicles: [{}] },
      { locationId: 'loc-1' },
      { occurredFrom: '2026-01-01T09:00' },
    ]) {
      expect(canDiscard(officer, empty(patch)).ok).toBe(false);
    }
  });

  it('counts an attachment as something real', () => {
    expect(canDiscard(officer, empty(), 1).ok).toBe(false);
  });

  it('does not count the case number and the officer’s own name', () => {
    // Both are filled in automatically. Neither is a record of anything.
    expect(isUntouched(empty())).toBe(true);
  });

  it('refuses somebody else’s', () => {
    const other = createUser({ id: 'u-other', name: 'K. Lang', role: 'officer' });
    expect(canDiscard(other, empty()).ok).toBe(false);
  });

  it('refuses one that has been through review', () => {
    const back = empty({ status: 'returned' as const });
    expect(canDiscard(officer, back).ok).toBe(false);
    expect(canDiscard(officer, back).reason).toMatch(/send it back up/);
  });
});
