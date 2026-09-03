import { describe, expect, it } from 'vitest';
import {
  arrestsForCase,
  arrestsForPerson,
  awaitingCourt,
  blockingProblems,
  checkArrest,
  createArrest,
  createCharge,
  describeCharges,
  leadCharge,
  nextArrestNumber,
  type Arrest,
  type ArrestCharge,
} from '../arrest';

const NOW = new Date('2026-09-03T12:00:00.000Z');
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();

function charge(partial: Partial<ArrestCharge> = {}): ArrestCharge {
  return createCharge({
    id: 'ch-1',
    statute: '13A-8-4',
    description: 'Theft of property, second degree',
    severity: 'felony',
    degree: 'C',
    counts: '1',
    ...partial,
  });
}

/** A complete arrest — every check below is one thing taken away from this. */
function arrest(partial: Partial<Arrest> = {}): Arrest {
  return createArrest({
    id: 'ar-1',
    arrestNumber: '2026-A00001',
    caseId: 'inc-1',
    caseNumber: '2026-000431',
    incidentPersonId: 'ip-1',
    masterId: 'mp-1',
    personName: 'Whitfield, Dana',
    arrestedAt: hoursAgo(6),
    arrestLocation: '612 N Marion St',
    arrestType: 'O',
    arrestingOfficerId: 'u-reyes',
    arrestingOfficerName: 'M. Reyes',
    charges: [charge()],
    disposition: 'jail',
    bookingNumber: 'BK-88213',
    bookedAt: hoursAgo(5),
    narrative: 'Observed leaving the unit with the property in hand.',
    createdBy: 'u-reyes',
    ...partial,
  });
}

/* ------------------------------------------------------------------ */

describe('what stops an arrest being submitted', () => {
  it('passes a complete one', () => {
    expect(blockingProblems(checkArrest(arrest()))).toEqual([]);
  });

  it('will not take an arrest with no charge on it', () => {
    const problems = blockingProblems(checkArrest(arrest({ charges: [] })));
    expect(problems.map((p) => p.path)).toContain('charges');
  });

  it('needs who, when, how, and who made it', () => {
    const bare = arrest({
      masterId: '',
      arrestedAt: '',
      arrestType: '',
      arrestingOfficerId: '',
      disposition: '',
    });
    expect(blockingProblems(checkArrest(bare)).map((p) => p.path).sort()).toEqual([
      'arrestType',
      'arrestedAt',
      'arrestingOfficerId',
      'disposition',
      'masterId',
    ]);
  });

  it('refuses an arrest recorded before it happened', () => {
    const future = arrest({ arrestedAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(blockingProblems(checkArrest(future)).map((p) => p.title)).toContain(
      'The arrest time is in the future',
    );
  });

  it('refuses a release earlier than the booking', () => {
    const muddled = arrest({ bookedAt: hoursAgo(2), releasedAt: hoursAgo(5) });
    expect(blockingProblems(checkArrest(muddled)).map((p) => p.path)).toContain('releasedAt');
  });
});

describe('charges', () => {
  it('wants a cite or a description, and a severity', () => {
    const problems = blockingProblems(
      checkArrest(arrest({ charges: [charge({ statute: '', description: '', severity: '' })] })),
    );
    expect(problems.map((p) => p.path)).toEqual(['charges.0.statute', 'charges.0.severity']);
  });

  it('accepts a description with no statute cite', () => {
    // An officer knows what somebody did before they know the cite for it.
    const problems = blockingProblems(
      checkArrest(arrest({ charges: [charge({ statute: '', description: 'Shoplifting' })] })),
    );
    expect(problems).toEqual([]);
  });

  it('refuses a count below one', () => {
    const problems = blockingProblems(checkArrest(arrest({ charges: [charge({ counts: '0' })] })));
    expect(problems.map((p) => p.path)).toContain('charges.0.counts');
  });

  it('asks about a felony with no class, without blocking it', () => {
    const problems = checkArrest(arrest({ charges: [charge({ degree: '' })] }));
    expect(problems.some((p) => p.severity === 'warning' && p.path === 'charges.0.degree')).toBe(true);
    expect(blockingProblems(problems)).toEqual([]);
  });
});

describe('juveniles', () => {
  it('will not let a juvenile arrest go without its handling recorded', () => {
    /*
      Not paperwork. A juvenile arrest is reported differently, sealed
      differently and released to different people, and an unanswered flag is
      how a juvenile record ends up in an adult file.
    */
    const problems = blockingProblems(checkArrest(arrest({ juvenile: true })));
    expect(problems.map((p) => p.path)).toContain('juvenileHandling');
  });

  it('accepts one that has it', () => {
    const ok = arrest({
      juvenile: true,
      juvenileHandling: 'Referred to juvenile probation',
      disposition: 'releasedToGuardian',
    });
    expect(blockingProblems(checkArrest(ok))).toEqual([]);
  });

  it('refuses a juvenile disposition on an adult', () => {
    const problems = blockingProblems(checkArrest(arrest({ disposition: 'juvenileFacility' })));
    expect(problems.map((p) => p.title)).toContain('That disposition is for a juvenile');
  });
});

describe('what it asks about without blocking', () => {
  it('mentions a missing booking number when somebody went to jail', () => {
    const problems = checkArrest(arrest({ bookingNumber: '' }));
    expect(problems.some((p) => p.path === 'bookingNumber' && p.severity === 'warning')).toBe(true);
  });

  it('queries a felony released on a citation', () => {
    const problems = checkArrest(arrest({ disposition: 'citedReleased' }));
    expect(problems.some((p) => p.title === 'A felony released on a citation')).toBe(true);
    expect(blockingProblems(problems)).toEqual([]);
  });

  it('queries an arrest dated well before the report it hangs off', () => {
    const problems = checkArrest(arrest({ arrestedAt: '2026-08-01T10:00' }), {
      incidentReportedAt: '2026-08-14T21:40',
    });
    expect(problems.some((p) => p.title.includes('before the report'))).toBe(true);
    // Legitimate for a warrant on an old case, so it asks rather than blocks.
    expect(blockingProblems(problems)).toEqual([]);
  });

  it('does not query one on the same day as the report', () => {
    const problems = checkArrest(arrest({ arrestedAt: '2026-08-14T23:00' }), {
      incidentReportedAt: '2026-08-14T21:40',
    });
    expect(problems.some((p) => p.title.includes('before the report'))).toBe(false);
  });

  it('mentions a missing narrative, because probable cause is read off it', () => {
    const problems = checkArrest(arrest({ narrative: '' }));
    expect(problems.some((p) => p.path === 'narrative' && p.severity === 'warning')).toBe(true);
  });
});

describe('numbering', () => {
  it('runs a series of its own, marked so nobody reads it as a case number', () => {
    expect(nextArrestNumber([], NOW)).toBe('2026-A00001');
    expect(nextArrestNumber(['2026-A00001', '2026-A00002'], NOW)).toBe('2026-A00003');
  });

  it('ignores other years and case numbers', () => {
    expect(nextArrestNumber(['2025-A09999', '2026-000431', '2026-A00004'], NOW)).toBe('2026-A00005');
  });

  it('never reuses a number after a gap', () => {
    expect(nextArrestNumber(['2026-A00001', '2026-A00009'], NOW)).toBe('2026-A00010');
  });
});

describe('reading it back', () => {
  it('leads with the most serious charge', () => {
    const mixed = arrest({
      charges: [
        charge({ id: 'a', severity: 'misdemeanor', description: 'Resisting' }),
        charge({ id: 'b', severity: 'felony', description: 'Burglary' }),
        charge({ id: 'c', severity: 'ordinance', description: 'Open container' }),
      ],
    });
    expect(leadCharge(mixed)?.description).toBe('Burglary');
    expect(describeCharges(mixed)).toBe('Burglary and 2 other charges');
  });

  it('counts multiples of one charge', () => {
    const many = arrest({ charges: [charge({ counts: '3', description: 'Forgery' })] });
    expect(describeCharges(many)).toBe('3 counts of Forgery');
  });

  it('falls back to the cite when there is no description', () => {
    const cited = arrest({ charges: [charge({ description: '', statute: '13A-8-4' })] });
    expect(describeCharges(cited)).toBe('13A-8-4');
  });

  it('says so when there are none', () => {
    expect(describeCharges(arrest({ charges: [] }))).toBe('No charges');
    expect(leadCharge(arrest({ charges: [] }))).toBeNull();
  });
});

describe('finding them again', () => {
  const rows: Arrest[] = [
    arrest({ id: 'a1', caseId: 'inc-1', masterId: 'mp-1', arrestedAt: '2026-08-01T10:00' }),
    arrest({ id: 'a2', caseId: 'inc-1', masterId: 'mp-2', arrestedAt: '2026-08-09T10:00' }),
    arrest({ id: 'a3', caseId: 'inc-2', masterId: 'mp-1', arrestedAt: '2026-08-05T10:00' }),
  ];

  it('gathers every arrest on one case, newest first', () => {
    expect(arrestsForCase(rows, 'inc-1').map((a) => a.id)).toEqual(['a2', 'a1']);
  });

  it('gathers one person’s history across cases', () => {
    expect(arrestsForPerson(rows, 'mp-1').map((a) => a.id)).toEqual(['a3', 'a1']);
  });

  it('lists what is still waiting on a court, oldest first', () => {
    const queue = [
      arrest({ id: 'old', status: 'approved', arrestedAt: '2026-01-05T10:00' }),
      arrest({ id: 'new', status: 'approved', arrestedAt: '2026-08-05T10:00' }),
      // Already answered, so not waiting.
      arrest({
        id: 'done',
        status: 'approved',
        arrestedAt: '2026-02-05T10:00',
        charges: [charge({ outcome: 'convicted' })],
      }),
      // Not approved yet, so not the court's problem.
      arrest({ id: 'draft', status: 'draft', arrestedAt: '2026-01-01T10:00' }),
    ];
    expect(awaitingCourt(queue).map((a) => a.id)).toEqual(['old', 'new']);
  });
});
