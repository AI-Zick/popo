import { describe, expect, it } from 'vitest';
import {
  ALL_SECTIONS,
  buildActivityReport,
  daysInRange,
  describeRange,
  inRange,
  localDay,
  SECTION_META,
  type ActivityInput,
} from '../activityReport';
import { createTrafficStop, createCitation, citationCount, warningCount } from '../activity';
import { createIncident, createIncidentPerson, createProperty } from '../factory';
import { createSupplement } from '../supplement';
import { createUser } from '../auth';

const reyes = createUser({ id: 'u-reyes', name: 'M. Reyes', badge: '4417', role: 'officer' });
const tam = createUser({ id: 'u-tam', name: 'D. Tam', badge: '4482', role: 'officer' });

const DAY = { from: '2026-03-14', to: '2026-03-14' };
const WEEK = { from: '2026-03-10', to: '2026-03-16' };

function build(partial: Partial<ActivityInput> = {}) {
  return buildActivityReport({
    officerIds: [reyes.id],
    range: DAY,
    sections: ALL_SECTIONS,
    users: [reyes, tam],
    incidents: [],
    supplements: [],
    stops: [],
    ...partial,
  });
}

const metric = (report: ReturnType<typeof build>, section: string, key: string, officer = 0) =>
  report.sections.find((s) => s.key === section)!.rows[officer].metrics.find((m) => m.key === key)!
    .value;

const total = (report: ReturnType<typeof build>, section: string, key: string) =>
  report.sections.find((s) => s.key === section)!.totals.find((t) => t.key === key)!.value;

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

describe('the date range', () => {
  it('is inclusive at both ends', () => {
    // "The 10th to the 16th" is seven days to everyone who is not a
    // programmer, and dropping the last day undercounts a whole shift.
    expect(inRange('2026-03-10T00:05', WEEK)).toBe(true);
    expect(inRange('2026-03-16T23:55', WEEK)).toBe(true);
    expect(inRange('2026-03-17T00:05', WEEK)).toBe(false);
    expect(inRange('2026-03-09T23:55', WEEK)).toBe(false);
  });

  it('counts a single day as one day', () => {
    expect(daysInRange(DAY)).toBe(1);
    expect(daysInRange(WEEK)).toBe(7);
  });

  it('counts a backwards range as nothing rather than a negative', () => {
    expect(daysInRange({ from: '2026-03-16', to: '2026-03-10' })).toBe(0);
  });

  it('reads a local datetime as the day it is written, not as UTC', () => {
    // The form stores '2026-03-14T23:30' with no zone. Parsing that as UTC
    // moves a late-shift stop onto the next day in half the world.
    expect(localDay('2026-03-14T23:30')).toBe('2026-03-14');
  });

  it('handles a plain date and a zoned timestamp', () => {
    expect(localDay('2026-03-14')).toBe('2026-03-14');
    expect(localDay('not a date')).toBeNull();
  });

  it('describes a single day differently from a range', () => {
    expect(describeRange(DAY)).not.toMatch(/ to /);
    expect(describeRange(WEEK)).toMatch(/ to /);
  });

  it('treats a missing timestamp as out of range', () => {
    expect(inRange('', DAY)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Sections are opt-in                                                 */
/* ------------------------------------------------------------------ */

describe('choosing sections', () => {
  it('returns only what was asked for', () => {
    const report = build({ sections: ['stops'] });
    expect(report.sections.map((s) => s.key)).toEqual(['stops']);
  });

  it('keeps the order the caller asked for the set in', () => {
    const report = build({ sections: ['reports', 'stops', 'arrests'] });
    expect(report.sections).toHaveLength(3);
  });

  it('can return everything', () => {
    expect(build().sections).toHaveLength(ALL_SECTIONS.length);
  });

  it('says what each number is counted from', () => {
    // "Arrests by report author" and "arrests by arresting officer" are
    // different numbers; a report that does not say which will be argued with.
    for (const key of ALL_SECTIONS) {
      expect(SECTION_META[key].basis.length).toBeGreaterThan(20);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Traffic stops                                                       */
/* ------------------------------------------------------------------ */

describe('traffic stops', () => {
  const stop = (partial = {}) =>
    createTrafficStop({
      id: Math.random().toString(36),
      officerId: reyes.id,
      officerName: reyes.name,
      at: '2026-03-14T21:30',
      location: 'US-411 at Watson Rd',
      ...partial,
    });

  it('counts stops in the range for the officer', () => {
    const report = build({ stops: [stop(), stop(), stop({ officerId: tam.id })] });
    expect(metric(report, 'stops', 'total')).toBe(2);
  });

  it('leaves out stops on another day', () => {
    const report = build({ stops: [stop(), stop({ at: '2026-03-15T10:00' })] });
    expect(metric(report, 'stops', 'total')).toBe(1);
  });

  it('breaks them down by reason', () => {
    const report = build({
      stops: [stop({ reason: 'speed' }), stop({ reason: 'speed' }), stop({ reason: 'equipment' })],
    });
    expect(metric(report, 'stops', 'speed')).toBe(2);
    expect(metric(report, 'stops', 'equipment')).toBe(1);
  });

  it('rolls suspicion, BOLO and other into one column', () => {
    const report = build({
      stops: [stop({ reason: 'suspicion' }), stop({ reason: 'bolo' }), stop({ reason: 'other' })],
    });
    expect(metric(report, 'stops', 'other')).toBe(3);
  });

  it('counts the stops that turned into an arrest', () => {
    const report = build({ stops: [stop({ outcome: 'arrest' }), stop({ outcome: 'warning' })] });
    expect(metric(report, 'stops', 'arrest')).toBe(1);
  });
});

describe('citations', () => {
  const cited = (n: number, warningOnly = false) =>
    createTrafficStop({
      officerId: reyes.id,
      at: '2026-03-14T21:30',
      outcome: 'citation',
      citations: Array.from({ length: n }, (_, i) =>
        createCitation({ id: `c${i}`, statute: '32-5A-171', warningOnly }),
      ),
    });

  it('counts every citation, not every stop', () => {
    // One stop can produce three citations, and a report that counts stops
    // instead undercounts the officer by two.
    const report = build({ stops: [cited(3)] });
    expect(metric(report, 'citations', 'citations')).toBe(3);
  });

  it('counts written warnings apart from citations', () => {
    const report = build({ stops: [cited(2, true), cited(1)] });
    expect(metric(report, 'citations', 'warnings')).toBe(2);
    expect(metric(report, 'citations', 'citations')).toBe(1);
  });

  it('treats a warning outcome with nothing written as a verbal warning', () => {
    const report = build({
      stops: [createTrafficStop({ officerId: reyes.id, at: '2026-03-14T20:00', outcome: 'warning' })],
    });
    expect(metric(report, 'citations', 'verbal')).toBe(1);
  });

  it('agrees with the per-stop helpers', () => {
    const stop = cited(2);
    expect(citationCount(stop)).toBe(2);
    expect(warningCount(stop)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Reports, supplements, arrests                                       */
/* ------------------------------------------------------------------ */

describe('reports', () => {
  const report_ = (partial = {}) =>
    createIncident({ createdBy: reyes.id, reportedAt: '2026-03-14T08:00', ...partial });

  it('counts by author and by status', () => {
    const report = build({
      incidents: [report_(), report_({ status: 'approved' }), report_({ createdBy: tam.id })],
    });
    expect(metric(report, 'reports', 'total')).toBe(2);
    expect(metric(report, 'reports', 'approved')).toBe(1);
  });

  it('uses the date the incident was reported, not the date it was typed', () => {
    const late = report_({ reportedAt: '2026-03-13T23:00', createdAt: '2026-03-14T02:00' });
    expect(metric(build({ incidents: [late] }), 'reports', 'total')).toBe(0);
  });
});

describe('supplements', () => {
  const supp = (partial = {}) =>
    createSupplement({ caseId: 'inc-1', createdBy: reyes.id, createdAt: '2026-03-14T10:00', ...partial });

  it('counts them by author', () => {
    const report = build({ supplements: [supp(), supp({ createdBy: tam.id })] });
    expect(metric(report, 'supplements', 'total')).toBe(1);
  });

  it('separates the ones written on another officer’s report', () => {
    // This is the assisting-officer number a sergeant actually wants.
    const incident = createIncident({ id: 'inc-1', createdBy: tam.id, reportedAt: '2026-03-14T08:00' });
    const own = createIncident({ id: 'inc-2', createdBy: reyes.id, reportedAt: '2026-03-14T08:00' });
    const report = build({
      incidents: [incident, own],
      supplements: [supp({ caseId: 'inc-1' }), supp({ caseId: 'inc-2' })],
    });
    expect(metric(report, 'supplements', 'total')).toBe(2);
    expect(metric(report, 'supplements', 'assisting')).toBe(1);
  });
});

describe('arrests', () => {
  const arrestee = (partial = {}) =>
    createIncidentPerson('arrestee', 'mp-1', { arrestDate: '2026-03-14', arrestType: 'O', ...partial });

  it('credits the arresting officer when one is recorded', () => {
    // An assisting unit makes the arrest and the primary writes it up all the
    // time. Counting by report author would credit the wrong person.
    const incident = createIncident({
      createdBy: tam.id,
      reportedAt: '2026-03-14T08:00',
      persons: [arrestee({ arrestingOfficerId: reyes.id })],
    });
    expect(metric(build({ incidents: [incident] }), 'arrests', 'total')).toBe(1);
  });

  it('falls back to the report author when no arresting officer is recorded', () => {
    const incident = createIncident({
      createdBy: reyes.id,
      reportedAt: '2026-03-14T08:00',
      persons: [arrestee()],
    });
    expect(metric(build({ incidents: [incident] }), 'arrests', 'total')).toBe(1);
  });

  it('does not count a person marked arrestee with no arrest date', () => {
    const incident = createIncident({
      createdBy: reyes.id,
      reportedAt: '2026-03-14T08:00',
      persons: [arrestee({ arrestDate: '' })],
    });
    expect(metric(build({ incidents: [incident] }), 'arrests', 'total')).toBe(0);
  });

  it('breaks arrests down by type', () => {
    const incident = createIncident({
      createdBy: reyes.id,
      reportedAt: '2026-03-14T08:00',
      persons: [arrestee(), arrestee({ arrestType: 'S' }), arrestee({ arrestType: 'T' })],
    });
    const report = build({ incidents: [incident] });
    expect(metric(report, 'arrests', 'onView')).toBe(1);
    expect(metric(report, 'arrests', 'summons')).toBe(1);
    expect(metric(report, 'arrests', 'warrant')).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Property and totals                                                 */
/* ------------------------------------------------------------------ */

describe('property', () => {
  it('sums stolen and recovered separately, in whole dollars', () => {
    const incident = createIncident({
      createdBy: reyes.id,
      reportedAt: '2026-03-14T08:00',
      property: [
        createProperty({ lossType: 'stolen', value: '1,450.75' }),
        createProperty({ lossType: 'stolen', value: '200' }),
        createProperty({ lossType: 'recovered', value: '900' }),
      ],
    });
    const report = build({ incidents: [incident] });
    expect(metric(report, 'property', 'stolen')).toBe(1651);
    expect(metric(report, 'property', 'recovered')).toBe(900);
    expect(metric(report, 'property', 'items')).toBe(3);
  });
});

describe('several officers at once', () => {
  const stop = (officerId: string) =>
    createTrafficStop({ officerId, at: '2026-03-14T21:30', location: 'x' });

  it('gives every officer a row, in the order asked for', () => {
    const report = build({ officerIds: [tam.id, reyes.id], stops: [stop(reyes.id)] });
    expect(report.sections[0].rows.map((r) => r.officerId)).toEqual([tam.id, reyes.id]);
  });

  it('shows a zero rather than dropping an officer who did nothing', () => {
    // A report that silently omits people makes every number in it
    // unverifiable — the reader cannot tell absence from omission.
    const report = build({ officerIds: [reyes.id, tam.id], stops: [stop(reyes.id)] });
    expect(metric(report, 'stops', 'total', 1)).toBe(0);
  });

  it('totals across the officers on the report', () => {
    const report = build({
      officerIds: [reyes.id, tam.id],
      stops: [stop(reyes.id), stop(reyes.id), stop(tam.id)],
    });
    expect(total(report, 'stops', 'total')).toBe(3);
  });

  it('ignores an officer id that matches no account', () => {
    const report = build({ officerIds: [reyes.id, 'u-ghost'] });
    expect(report.officers).toHaveLength(1);
  });
});

describe('an empty result', () => {
  it('is flagged, so the screen can say so rather than showing a wall of zeroes', () => {
    expect(build().empty).toBe(true);
  });

  it('is not flagged when anything at all was found', () => {
    const report = build({
      stops: [createTrafficStop({ officerId: reyes.id, at: '2026-03-14T09:00', location: 'x' })],
    });
    expect(report.empty).toBe(false);
  });
});
