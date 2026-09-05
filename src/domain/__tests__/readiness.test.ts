import { describe, expect, it } from 'vitest';
import { blocking, review, summary, type Context } from '@/domain/readiness';
import { emptyAgency, type AgencyProfile } from '@/domain/agency';
import { createUser, type User } from '@/domain/auth';
import { DEFAULT_PATTERN } from '@/domain/shift';

/** An agency with every blocking answer given, so each test breaks one thing. */
const goodAgency = (): AgencyProfile => ({
  ...emptyAgency(),
  name: 'Cedar Falls Police Department',
  ori: 'AL0370100',
  state: 'AL',
  requireMfa: true,
  boundary: { type: 'FeatureCollection', features: [] } as never,
  zones: { type: 'FeatureCollection', features: [] } as never,
  shifts: { starts: ['06:00', '18:00'], names: ['Days', 'Nights'] },
  mail: {
    host: 'smtp.cedarfalls.gov',
    port: 587,
    secure: false,
    username: '',
    from: 'no-reply@cedarfalls.gov',
    baseUrl: 'https://rms.cedarfalls.gov',
  },
  gis: { ...emptyAgency().gis, kind: 'arcgis', checkedOn: '2026-03-01' },
  encryptionAtRest: { confirmedBy: 'R. Vance', confirmedOn: '2026-03-01', note: 'LUKS on the data volume' },
  statutes: [{ cite: '13A-6-20', verifiedOn: '2026-02-01' } as never],
  exemptions: [],
  retention: [],
});

const roster = (): User[] => [
  createUser({ id: 'u1', name: 'Officer', role: 'officer', email: 'o@x.gov' }),
  createUser({ id: 'u2', name: 'Sergeant', role: 'supervisor', email: 's@x.gov' }),
  createUser({ id: 'u3', name: 'Admin One', role: 'admin', email: 'a@x.gov', grants: ['records.expunge'] }),
  createUser({ id: 'u4', name: 'Admin Two', role: 'admin', email: 'b@x.gov' }),
];

const context = (over: Partial<Context> = {}): Context => ({
  agency: goodAgency(),
  users: roster(),
  hasMailPassword: false,
  ...over,
});

const ids = (c: Context) => review(c).map((f) => f.id);

describe('a fully set-up installation', () => {
  it('reports nothing outstanding', () => {
    expect(review(context())).toEqual([]);
  });

  it('and says so without claiming it is ready', () => {
    /*
      Readiness is a judgement about an agency's circumstances. This can say
      what is outstanding; it cannot say whether to go live.
    */
    const line = summary([]);
    expect(line).toMatch(/Nothing outstanding/);
    expect(line).not.toMatch(/\bready\b/i);
  });
});

describe('what stops an agency working', () => {
  it('no ORI', () => {
    const found = ids(context({ agency: { ...goodAgency(), ori: '  ' } }));
    expect(found).toContain('ori');
    expect(blocking(review(context({ agency: { ...goodAgency(), ori: '' } })))).toHaveLength(1);
  });

  it('no name, and no state', () => {
    expect(ids(context({ agency: { ...goodAgency(), name: '' } }))).toContain('name');
    expect(ids(context({ agency: { ...goodAgency(), state: '' } }))).toContain('state');
  });

  it('nobody who can approve a report', () => {
    // Every submission would sit in the queue permanently.
    const onlyOfficers = [createUser({ id: 'u1', name: 'Officer', role: 'officer' })];
    expect(ids(context({ users: onlyOfficers }))).toContain('no-approver');
  });

  it('nobody having confirmed the disk is encrypted', () => {
    /*
      The one finding nothing in this system can verify. It is blocking anyway:
      until somebody has looked, the records are readable by anybody who can
      read the disk, including anybody holding a backup.
    */
    const unconfirmed = {
      ...goodAgency(),
      encryptionAtRest: { confirmedBy: '', confirmedOn: '', note: '' },
    };
    const found = review(context({ agency: unconfirmed })).find(
      (f) => f.id === 'encryption-at-rest',
    );
    expect(found?.weight).toBe('blocking');
    expect(found?.because).toMatch(/not claiming to/);
  });

  it('the second factor switched off', () => {
    const found = review(context({ agency: { ...goodAgency(), requireMfa: false } }));
    const mfa = found.find((f) => f.id === 'mfa-off');
    expect(mfa?.weight).toBe('blocking');
    expect(mfa?.because).toMatch(/CJIS/);
  });
});

describe('what is worth fixing', () => {
  it('one account that can manage accounts', () => {
    const thin = [
      createUser({ id: 'u1', name: 'Officer', role: 'officer' }),
      createUser({ id: 'u2', name: 'Sergeant', role: 'supervisor' }),
      createUser({ id: 'u3', name: 'Admin', role: 'admin' }),
    ];
    const found = review(context({ users: thin })).find((f) => f.id === 'one-manager');
    expect(found?.weight).toBe('fix');
  });

  it('no jurisdiction boundary', () => {
    expect(ids(context({ agency: { ...goodAgency(), boundary: null } }))).toContain('boundary');
  });

  it('a county service configured but never tested', () => {
    const untested = { ...goodAgency(), gis: { ...goodAgency().gis, checkedOn: '' } };
    const found = review(context({ agency: untested })).find((f) => f.id === 'gis-untested');
    expect(found?.weight).toBe('fix');
  });

  it('an exemption switched on with no citation', () => {
    /*
      It proposes redactions and cannot be signed off, so a release stalls at
      the last step rather than the first.
    */
    const agency = {
      ...goodAgency(),
      exemptions: [{ enabled: true, authority: '  ', id: 'x', label: 'X' } as never],
    };
    expect(ids(context({ agency }))).toContain('uncited-exemptions');
  });

  it('no mail server, so nobody can reset their own password', () => {
    const agency = { ...goodAgency(), mail: { ...goodAgency().mail, host: '' } };
    expect(ids(context({ agency }))).toContain('no-mail');
  });
});

describe('what is only worth knowing', () => {
  it('shift times still on the shipped default', () => {
    const agency = { ...goodAgency(), shifts: DEFAULT_PATTERN };
    const found = review(context({ agency })).find((f) => f.id === 'default-shifts');
    expect(found?.weight).toBe('know');
  });

  it('no county service at all, because plenty of agencies have none', () => {
    const agency = { ...goodAgency(), gis: { ...goodAgency().gis, kind: '' as never } };
    const found = review(context({ agency })).find((f) => f.id === 'no-gis');
    expect(found?.weight).toBe('know');
  });

  it('fewer than two people who can carry out a destruction order', () => {
    /*
      The rule working, not a fault — and it says so. Administrators hold the
      permission by role, so this needs a roster with one of them; the vendor
      deliberately does not hold it.
    */
    const oneAdmin = [
      createUser({ id: 'u1', name: 'Officer', role: 'officer', email: 'o@x.gov' }),
      createUser({ id: 'u2', name: 'Sergeant', role: 'supervisor', email: 's@x.gov' }),
      createUser({ id: 'u3', name: 'Admin', role: 'admin', email: 'a@x.gov' }),
      createUser({ id: 'u4', name: 'Vendor', role: 'vendor', email: 'v@x.gov' }),
    ];
    const found = review(context({ users: oneAdmin })).find((f) => f.id === 'expunge-pair');
    expect(found?.weight).toBe('know');
    expect(found?.because).toMatch(/two people/);
  });

  it('accounts with no email address, once mail works', () => {
    const withMail = context({ hasMailPassword: true, users: [
      createUser({ id: 'u1', name: 'No address', role: 'officer' }),
      createUser({ id: 'u2', name: 'Sergeant', role: 'supervisor', email: 's@x.gov' }),
      createUser({ id: 'u3', name: 'A', role: 'admin', email: 'a@x.gov' }),
      createUser({ id: 'u4', name: 'B', role: 'admin', email: 'b@x.gov' }),
    ] });
    expect(ids(withMail)).toContain('accounts-without-email');
  });

  it('but not while there is no mail server to use', () => {
    // Nobody could use a reset link either way, so the address is not the gap.
    expect(ids(context({ agency: { ...goodAgency(), mail: { ...goodAgency().mail, host: '' } } })))
      .not.toContain('accounts-without-email');
  });
});

describe('the order it reads in', () => {
  it('puts blocking first and worth-knowing last', () => {
    /*
      Deliberately built so the order things are checked in is NOT the order
      they should be read in: the missing boundary is only worth fixing and is
      checked early, while having nobody to approve a report is blocking and is
      checked later. A version that returned findings in check order would pass
      a gentler fixture than this one.
    */
    const broken = { ...goodAgency(), boundary: null, shifts: DEFAULT_PATTERN };
    // Supervisors and administrators approve by role, so neither can be here.
    const noApprover = [
      createUser({ id: 'u1', name: 'Officer', role: 'officer', email: 'o@x.gov' }),
      createUser({ id: 'u2', name: 'Records', role: 'records', email: 'r@x.gov' }),
      createUser({ id: 'u3', name: 'Dispatch', role: 'dispatch', email: 'd@x.gov' }),
    ];
    const found = review(context({ agency: broken, users: noApprover }));
    expect(found.map((f) => f.id)).toContain('no-approver');
    expect(found.map((f) => f.id)).toContain('boundary');
    const weights = found.map((f) => f.weight);
    expect(weights[0]).toBe('blocking');
    expect(weights[weights.length - 1]).toBe('know');
    // Never interleaved.
    expect(weights).toEqual([...weights].sort((a, b) =>
      ({ blocking: 0, fix: 1, know: 2 })[a] - ({ blocking: 0, fix: 1, know: 2 })[b]));
  });

  it('is stable across calls', () => {
    const c = context({ agency: { ...goodAgency(), ori: '', boundary: null } });
    expect(ids(c)).toEqual(ids(c));
  });
});

describe('the line at the top', () => {
  it('counts what would stop the agency working', () => {
    const found = review(context({ agency: { ...goodAgency(), ori: '', name: '' } }));
    expect(summary(found)).toMatch(/^2 things would stop this agency working/);
  });

  it('says when nothing blocks but there is still reading to do', () => {
    const found = review(context({ agency: { ...goodAgency(), shifts: DEFAULT_PATTERN } }));
    expect(summary(found)).toMatch(/^Nothing is blocking/);
  });

  it('uses singular English for one thing', () => {
    const found = review(context({ agency: { ...goodAgency(), ori: '' } }));
    expect(summary(found)).toMatch(/1 thing would stop/);
  });
});
