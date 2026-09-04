import { describe, expect, it } from 'vitest';
import {
  WITHHOLDING_NOTICE,
  addDays,
  buildRelease,
  checkClosure,
  checkExtension,
  checkRequest,
  createRequest,
  defaultPolicy,
  impliedOutcome,
  isClosed,
  pausedDays,
  releaseBlockers,
  sortQueue,
  stage,
  stampAuthorities,
  standing,
} from '../publicRecords';
import type {
  DecidedSpan,
  ItemReview,
  PublicRecordsPolicy,
  PublicRequest,
  ResponsiveItem,
} from '../publicRecords';
import { createRule } from '../exemption';
import { MARKER } from '../redaction';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const policy = (partial: Partial<PublicRecordsPolicy> = {}): PublicRecordsPolicy => ({
  ...defaultPolicy(),
  ...partial,
});

const request = (partial: Partial<PublicRequest> = {}): PublicRequest =>
  createRequest({
    id: 'pr1',
    number: 'PR-2026-0001',
    // A Monday.
    receivedAt: '2026-06-01T09:00:00Z',
    description: 'The report for the burglary on Marion Street.',
    requester: { name: '', organization: '', email: 'r@example.com', phone: '', address: '', collect: '' },
    ...partial,
  });

const review = (partial: Partial<ItemReview> = {}): ItemReview => ({
  spans: [],
  answered: [],
  attachments: [],
  readInFull: true,
  approvedAt: '2026-06-03T10:00:00Z',
  approvedBy: 'u1',
  approvedByName: 'R. Vance',
  ...partial,
});

const item = (partial: Partial<ResponsiveItem> = {}): ResponsiveItem => ({
  id: 'it1',
  kind: 'incident',
  recordId: 'inc1',
  label: '2026-000412',
  addedAt: '2026-06-02T10:00:00Z',
  addedBy: 'u1',
  review: null,
  ...partial,
});

const decided = (partial: Partial<DecidedSpan> = {}): DecidedSpan => ({
  id: 'sp1',
  field: 'narrative',
  start: 0,
  end: 11,
  text: '452-11-9087',
  ruleId: 'id-ssn',
  ruleLabel: 'Social security numbers',
  authority: 'Ala. Code § 36-12-40',
  detector: 'ssn',
  confidence: 'high',
  because: 'Looks like a social security number.',
  decision: 'accepted',
  addedByClerk: false,
  note: '',
  ...partial,
});

/* ------------------------------------------------------------------ */
/* Taking one in                                                       */
/* ------------------------------------------------------------------ */

describe('logging a request', () => {
  it('needs to know what was asked for', () => {
    expect(checkRequest(request({ description: '  ' })).field).toBe('description');
  });

  it('does not require the requester to say who they are', () => {
    /*
      Several states forbid conditioning a release on identifying yourself, and
      a required name field quietly breaks that law on every request.
    */
    const anonymous = request({
      requester: { name: '', organization: '', email: '', phone: '', address: '', collect: 'Collecting at the counter' },
    });
    expect(checkRequest(anonymous).ok).toBe(true);
  });

  it('does require some way to hand the records back', () => {
    const nowhere = request({
      requester: { name: 'A. Requester', organization: '', email: '', phone: '', address: '', collect: '' },
    });
    const check = checkRequest(nowhere);
    expect(check.ok).toBe(false);
    expect(check.advice).toMatch(/not required/i);
  });
});

/* ------------------------------------------------------------------ */
/* Counting days                                                       */
/* ------------------------------------------------------------------ */

describe('counting the days', () => {
  it('knows a weekend when it sees one', () => {
    expect(isClosed('2026-06-06', [])).toBe(true); // Saturday
    expect(isClosed('2026-06-07', [])).toBe(true); // Sunday
    expect(isClosed('2026-06-08', [])).toBe(false); // Monday
    expect(isClosed('2026-06-08', ['2026-06-08'])).toBe(true); // and a day the office is shut
  });

  it('counts business days past the weekend', () => {
    // Friday plus three business days is Wednesday, not Monday.
    expect(addDays('2026-06-05', 3, true, [])).toBe('2026-06-10');
  });

  it('counts calendar days straight through one', () => {
    expect(addDays('2026-06-05', 3, false, [])).toBe('2026-06-08');
  });

  it('never falls due on a day the office is closed', () => {
    // An agency cannot respond on a day it is shut, whichever way it counts.
    expect(addDays('2026-06-04', 2, false, [])).toBe('2026-06-08');
    expect(addDays('2026-06-01', 4, true, ['2026-06-05'])).toBe('2026-06-08');
  });

  it('skips a holiday when counting business days', () => {
    expect(addDays('2026-06-01', 3, true, ['2026-06-03'])).toBe('2026-06-05');
  });
});

describe('the clock', () => {
  it('is worked out from scratch rather than stored', () => {
    const now = standing(request(), policy({ responseDays: 10 }), '2026-06-05');
    expect(now.dueDate).toBe('2026-06-15');
    expect(now.daysLeft).toBe(10);
    expect(now.tone).toBe('ok');
  });

  it('goes late on its own with nothing having to run', () => {
    /*
      The whole reason it is derived. The day a nightly job does not run is the
      day a clerk is told a request is fine when it is four days late.
    */
    const late = standing(request(), policy(), '2026-06-19');
    expect(late.overdue).toBe(true);
    expect(late.line).toMatch(/4 days past/);
    expect(late.tone).toBe('late');
  });

  it('warns before it is late, not after', () => {
    expect(standing(request(), policy(), '2026-06-14').tone).toBe('soon');
    expect(standing(request(), policy(), '2026-06-15').line).toMatch(/Due today/);
  });

  it('stops while the requester is the one being waited on', () => {
    const paused = request({
      pauses: [{ id: 'p1', reason: 'clarification', from: '2026-06-03', until: '', note: '' }],
    });
    const now = standing(paused, policy(), '2026-06-10');
    expect(now.running).toBe(false);
    expect(now.line).toMatch(/clock is stopped/);
  });

  it('gives back exactly the days it was stopped for', () => {
    const paused = request({
      pauses: [{ id: 'p1', reason: 'fee', from: '2026-06-03', until: '2026-06-08', note: '' }],
    });
    // Three business days between the Wednesday and the following Monday.
    expect(pausedDays(paused.pauses, true, [], '2026-06-10')).toBe(3);
    expect(standing(paused, policy(), '2026-06-10').dueDate).toBe('2026-06-18');
  });

  it('does not push the date out for a pause that has only just started', () => {
    // A request paused this morning is due after the pause ends, not five days
    // later than it was yesterday.
    const paused = request({
      pauses: [{ id: 'p1', reason: 'fee', from: '2026-06-05', until: '', note: '' }],
    });
    expect(standing(paused, policy(), '2026-06-05').dueDate).toBe('2026-06-15');
  });

  it('adds an extension to the period', () => {
    const extended = request({
      extensions: [{ id: 'e1', at: '2026-06-10', by: 'u1', days: 5, reason: 'Volume of records to search.' }],
    });
    expect(standing(extended, policy(), '2026-06-10').dueDate).toBe('2026-06-22');
  });

  it('says when a closed request was closed late', () => {
    const closed = request({
      closure: { at: '2026-06-22T10:00:00Z', by: 'u1', byName: 'R. Vance', outcome: 'released', reason: '' },
    });
    const now = standing(closed, policy(), '2026-06-30');
    expect(now.overdue).toBe(true);
    expect(now.line).toMatch(/after the 2026-06-15 deadline/);
  });
});

describe('extending', () => {
  it('refuses where the state gives no extension', () => {
    // Not every act allows one, and taking one anyway is not a warning.
    const check = checkExtension(request(), policy({ extensionDays: 0 }), 5, 'Volume of records to search.');
    expect(check.ok).toBe(false);
    expect(check.advice).toMatch(/due on the date it is due/);
  });

  it('refuses more than the statute allows', () => {
    const taken = request({
      extensions: [{ id: 'e1', at: '2026-06-10', by: 'u1', days: 5, reason: 'Volume of records.' }],
    });
    const check = checkExtension(taken, policy({ extensionDays: 5, maxExtensions: 1 }), 5, 'More volume of records.');
    expect(check.ok).toBe(false);
  });

  it('refuses one longer than the statute allows', () => {
    expect(checkExtension(request(), policy({ extensionDays: 5 }), 9, 'Volume of records to search.').ok).toBe(false);
  });

  it('refuses a reason nobody can check', () => {
    const check = checkExtension(request(), policy({ extensionDays: 5 }), 5, 'Volume');
    expect(check.ok).toBe(false);
    expect(check.field).toBe('reason');
  });

  it('allows a proper one', () => {
    expect(checkExtension(request(), policy({ extensionDays: 5 }), 5, 'Four hundred pages to search and review.').ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* The queue                                                           */
/* ------------------------------------------------------------------ */

describe('the queue', () => {
  it('works out where a request has got to from what has happened to it', () => {
    expect(stage(request())).toBe('logged');
    expect(stage(request({ assignedTo: 'u1' }))).toBe('searching');
    expect(stage(request({ items: [item()] }))).toBe('review');
    expect(stage(request({ items: [item({ review: review() })] }))).toBe('ready');
    expect(
      stage(request({ closure: { at: '2026-06-10', by: 'u1', byName: 'V', outcome: 'released', reason: '' } })),
    ).toBe('closed');
  });

  it('puts the one that is nearly due above the one that arrived first', () => {
    /*
      A queue sorted by arrival is a queue where the request that came in
      yesterday and is due tomorrow sits under thirty older ones.
    */
    const old = request({ id: 'old', receivedAt: '2026-06-01T09:00:00Z' });
    const urgent = request({
      id: 'urgent',
      receivedAt: '2026-05-20T09:00:00Z',
      pauses: [],
    });
    const sorted = sortQueue([old, urgent], policy(), '2026-06-02');
    expect(sorted[0].id).toBe('urgent');
  });

  it('sinks the ones that are closed or stopped', () => {
    const open = request({ id: 'open' });
    const closed = request({
      id: 'closed',
      receivedAt: '2026-05-01T09:00:00Z',
      closure: { at: '2026-05-10', by: 'u1', byName: 'V', outcome: 'released', reason: '' },
    });
    expect(sortQueue([closed, open], policy(), '2026-06-02')[0].id).toBe('open');
  });
});

/* ------------------------------------------------------------------ */
/* Approving one record                                                */
/* ------------------------------------------------------------------ */

const cited = createRule({ id: 'id-ssn', label: 'Social security numbers', detector: 'ssn', enabled: true, authority: 'Ala. Code § 36-12-40' });
const uncited = createRule({ id: 'id-dob', label: 'Dates of birth', detector: 'dob', enabled: true });

describe('what stands between a record and the door', () => {
  it('is nothing, once a person has been through it', () => {
    expect(releaseBlockers(review({ spans: [decided()] }), [], [], [cited])).toEqual([]);
  });

  it('lists everything at once rather than one thing at a time', () => {
    // A clerk who fixes one thing and is immediately told about the next has
    // been made to do the same work four times.
    const blockers = releaseBlockers(
      review({
        readInFull: false,
        spans: [decided({ ruleId: 'id-dob', ruleLabel: 'Dates of birth', authority: '' })],
      }),
      [{ ruleId: 'st-medical', ruleLabel: 'Medical information', authority: '§ M', action: 'flag', message: 'Read it.' }],
      [{ kind: 'attachment', label: 'scene.jpg', why: 'Nothing here reads inside a file.' }],
      [uncited],
    );
    expect(blockers).toHaveLength(4);
  });

  it('raises one problem per rule, not one per passage', () => {
    /*
      One rule with nothing named against it is one problem and one fix,
      however many passages it reached. Eleven copies of the same sentence is
      a screen a clerk stops reading.
    */
    const many = [0, 1, 2, 3].map((n) =>
      decided({ id: `sp${n}`, start: n * 12, end: n * 12 + 11, text: '', ruleId: 'id-dob', authority: '' }),
    );
    const blockers = releaseBlockers(review({ spans: many }), [], [], [uncited]);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].reason).toMatch(/4 passages/);
  });

  it('stops a redaction with no statute named against it', () => {
    /*
      The citation gate, which sits here rather than at the detector. Two ways
      out and both are legitimate: name the statute, or release the passage.
    */
    const blockers = releaseBlockers(
      review({ spans: [decided({ ruleId: 'id-dob', authority: '' })] }),
      [], [], [uncited],
    );
    expect(blockers).toHaveLength(1);
    expect(blockers[0].reason).toMatch(/one passage/);
    expect(blockers[0].advice).toMatch(/statute/i);
  });

  it('does not stop one the clerk rejected under an uncited rule', () => {
    // Nothing is being withheld, so there is nothing to defend.
    const blockers = releaseBlockers(
      review({ spans: [decided({ ruleId: 'id-dob', authority: '', decision: 'rejected' })] }),
      [], [], [uncited],
    );
    expect(blockers).toEqual([]);
  });

  it('makes a clerk answer a notice rather than letting it scroll past', () => {
    const notice = { ruleId: 'st-medical', ruleLabel: 'Medical information', authority: '§ M', action: 'flag' as const, message: 'Read it.' };
    expect(releaseBlockers(review(), [notice], [], [])).toHaveLength(1);
    expect(releaseBlockers(review({ answered: ['st-medical'] }), [notice], [], [])).toEqual([]);
  });

  it('makes somebody decide about a file nothing could read inside', () => {
    const photo = [{ kind: 'attachment', label: 'scene.jpg', why: 'Nothing here reads inside a file.' }];
    expect(releaseBlockers(review(), [], photo, [])).toHaveLength(1);
    expect(
      releaseBlockers(
        review({ attachments: [{ attachmentId: 'a1', filename: 'scene.jpg', outcome: 'released', authority: '', note: '' }] }),
        [], photo, [],
      ),
    ).toEqual([]);
  });

  it('holds a withheld attachment to the same citation rule as a span', () => {
    const photo = [{ kind: 'attachment', label: 'scene.jpg', why: 'Nothing here reads inside a file.' }];
    const blockers = releaseBlockers(
      review({ attachments: [{ attachmentId: 'a1', filename: 'scene.jpg', outcome: 'withheld', authority: '', note: '' }] }),
      [], photo, [],
    );
    expect(blockers).toHaveLength(1);
  });

  it('will not let anything out that nobody has read whole', () => {
    /*
      The automatic pass will not find "the neighbour with the blue truck who
      called it in", and that sentence identifies somebody as surely as a name.
    */
    const blockers = releaseBlockers(review({ readInFull: false }), [], [], []);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].field).toBe('readInFull');
  });
});

/* ------------------------------------------------------------------ */
/* Closing it out                                                      */
/* ------------------------------------------------------------------ */

describe('closing a request', () => {
  const ready = request({ items: [item({ review: review() })] });

  it('will not release a record nobody reviewed', () => {
    const half = request({ items: [item({ review: review() }), item({ id: 'it2' })] });
    const check = checkClosure(half, 'released', '');
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/1 of 2/);
  });

  it('will not close as released when the search found nothing', () => {
    // "No records held" is a different answer, and one a requester may appeal.
    const check = checkClosure(request(), 'released', '');
    expect(check.ok).toBe(false);
    expect(check.advice).toMatch(/no records held/i);
  });

  it('lets a withdrawal close whatever state it was in', () => {
    expect(checkClosure(request({ items: [item()] }), 'withdrawn', '').ok).toBe(true);
  });

  it('refuses a denial with nothing written on it', () => {
    // In most states this text is what an appeal is decided on.
    expect(checkClosure(ready, 'denied', 'Exempt').ok).toBe(false);
    expect(checkClosure(ready, 'denied', 'Withheld in full under the ongoing investigation exemption.').ok).toBe(true);
  });

  it('refuses a partial release with nothing written on it', () => {
    expect(checkClosure(ready, 'partial', 'Redacted').ok).toBe(false);
  });

  it('does not require a statement for a release in full', () => {
    expect(checkClosure(ready, 'released', '').ok).toBe(true);
  });

  it('will not close the same request twice', () => {
    const closed = request({ closure: { at: '2026-06-10', by: 'u1', byName: 'V', outcome: 'released', reason: '' } });
    expect(checkClosure(closed, 'released', '').ok).toBe(false);
  });
});

describe('what the outcome actually was', () => {
  it('is a partial release once anything was accepted', () => {
    /*
      A clerk who redacted four passages and closed it as released in full has
      misdescribed it, probably by clicking the first option.
    */
    const withheld = request({ items: [item({ review: review({ spans: [decided()] }) })] });
    expect(impliedOutcome(withheld)).toBe('partial');
  });

  it('is a full release where nothing was', () => {
    const clean = request({ items: [item({ review: review({ spans: [decided({ decision: 'rejected' })] }) })] });
    expect(impliedOutcome(clean)).toBe('released');
  });

  it('is a partial release where an attachment was held back', () => {
    const held = request({
      items: [
        item({
          review: review({
            attachments: [{ attachmentId: 'a1', filename: 'scene.jpg', outcome: 'withheld', authority: '§ X', note: '' }],
          }),
        }),
      ],
    });
    expect(impliedOutcome(held)).toBe('partial');
  });

  it('is no records held where nothing was found', () => {
    expect(impliedOutcome(request())).toBe('noRecords');
  });
});

/* ------------------------------------------------------------------ */
/* What goes out                                                       */
/* ------------------------------------------------------------------ */

describe('building the release', () => {
  const fields = {
    narrative: 'Whitfield gave 452-11-9087 at the counter.',
    summary: 'Theft report.',
  };

  it('applies only what was accepted', () => {
    const built = buildRelease('it1', '2026-000412', fields, review({ spans: [decided({ start: 15, end: 26 })] }));
    expect(built.fields.narrative).toBe(`Whitfield gave ${MARKER.repeat(11)} at the counter.`);
    expect(built.fields.summary).toBe('Theft report.');
  });

  it('leaves a rejected span in the text', () => {
    const built = buildRelease('it1', '2026-000412', fields, review({ spans: [decided({ start: 15, end: 26, decision: 'rejected' })] }));
    expect(built.fields.narrative).toBe(fields.narrative);
  });

  it('does not apply one field’s spans to another', () => {
    const built = buildRelease(
      'it1', '2026-000412', fields,
      review({ spans: [decided({ field: 'summary', start: 0, end: 5, text: 'Theft' })] }),
    );
    expect(built.fields.narrative).toBe(fields.narrative);
    expect(built.fields.summary).toBe(`${MARKER.repeat(5)} report.`);
  });

  it('records the authority as it stands when a person approves it', () => {
    /*
      The failure this catches went all the way to the requester. A span
      carries the citation its rule had when the proposal was drawn; an
      administrator naming the statute in between — which is exactly what the
      release gate asks them to do — leaves every span on the clerk's screen
      carrying the blank it was born with, and the log goes out empty.
    */
    const stale = [decided({ ruleId: 'id-ssn', ruleLabel: 'Social security numbers', authority: '' })];
    const now = [{ ...cited, authority: 'Ala. Code § 36-12-40' }];
    expect(stampAuthorities(stale, now)[0].authority).toBe('Ala. Code § 36-12-40');
  });

  it('leaves a span the clerk drew themselves alone', () => {
    // It belongs to no rule, so the citation they typed is the only one there is.
    const own = [decided({ ruleId: '', addedByClerk: true, authority: 'Ala. Code § 12-21-3.1' })];
    expect(stampAuthorities(own, [cited])[0].authority).toBe('Ala. Code § 12-21-3.1');
  });

  it('comes with the log of what was withheld and under what law', () => {
    const built = buildRelease('it1', '2026-000412', fields, review({ spans: [decided({ start: 15, end: 26 })] }));
    expect(built.withholding).toEqual([
      { authority: 'Ala. Code § 36-12-40', ruleLabel: 'Social security numbers', count: 1, fields: ['narrative'] },
    ]);
  });

  it('tells a requester they can appeal', () => {
    expect(WITHHOLDING_NOTICE).toMatch(/appeal/);
  });
});
