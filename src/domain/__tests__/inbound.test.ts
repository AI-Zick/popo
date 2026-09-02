import { describe, expect, it } from 'vitest';
import {
  alertsOn,
  alreadyApplied,
  createQueryReturn,
  describeReturn,
  ownerFromRegistration,
  personFromLicense,
  recentReturns,
  returnsForCall,
  vehicleFromRegistration,
  type QueryReturn,
} from '../inbound';

const NOW = Date.parse('2026-03-14T03:00:00Z');

const license = (partial = {}): QueryReturn =>
  createQueryReturn({
    id: 'r1',
    source: 'dmv',
    query: 'AL7729140',
    callNumber: 'CF-2026-0417',
    officerId: 'u-reyes',
    receivedAt: '2026-03-14T02:31:00Z',
    payload: {
      kind: 'license',
      licenseNumber: 'AL7729140',
      licenseState: 'AL',
      licenseClass: 'D',
      status: 'Valid',
      expiresOn: '2029-03-14',
      restrictions: 'Corrective lenses',
      lastName: 'Whitfield',
      firstName: 'Dana',
      middleName: 'Marie',
      suffix: '',
      dob: '1985-03-14',
      sex: 'F',
      race: 'W',
      height: '5-05',
      weight: '140',
      eyeColor: 'BRO',
      hairColor: 'BRO',
      address: '1142 Ashwood Ln',
      city: 'Cedar Falls',
      state: 'AL',
      zip: '35004',
      ...partial,
    },
  });

const registration = (partial = {}): QueryReturn =>
  createQueryReturn({
    id: 'r2',
    source: 'dmv',
    query: '4AC7821',
    callNumber: 'CF-2026-0417',
    officerId: 'u-reyes',
    receivedAt: '2026-03-14T02:33:00Z',
    payload: {
      kind: 'registration',
      plate: '4AC7821',
      plateState: 'AL',
      plateYear: '2026',
      vin: '3GCPKSE31BG104457',
      year: '2011',
      make: 'Chevrolet',
      model: 'Silverado',
      style: 'PK',
      color: 'RED',
      ownerLastName: 'Mercer',
      ownerFirstName: 'Travis',
      ownerMiddleName: 'Ray',
      ownerAddress: '88 Depot St',
      ownerCity: 'Cedar Falls',
      ownerState: 'AL',
      ownerZip: '35004',
      status: 'Active',
      expiresOn: '2026-11-30',
      insuranceCarrier: 'Statewide Mutual',
      insurancePolicy: 'SM-448120',
      ...partial,
    },
  });

/* ------------------------------------------------------------------ */
/* Grouping                                                            */
/* ------------------------------------------------------------------ */

describe('finding the returns for a scene', () => {
  it('groups them by the dispatch call number', () => {
    const other = license({ lastName: 'Other' });
    other.id = 'r9';
    other.callNumber = 'CF-2026-9999';
    const found = returnsForCall([license(), registration(), other], 'CF-2026-0417');
    expect(found.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('orders them the way they came back', () => {
    const found = returnsForCall([registration(), license()], 'CF-2026-0417');
    expect(found[0].id).toBe('r1');
  });

  it('returns nothing for a blank call number rather than everything', () => {
    // A blank call number matching every return would offer the officer the
    // whole shift's queries on an unrelated report.
    expect(returnsForCall([license()], '')).toEqual([]);
  });

  it('falls back to what the officer ran recently', () => {
    // Plenty of crashes and stops are self-initiated and never get a call
    // number at all.
    const found = recentReturns([license(), registration()], 'u-reyes', 12, NOW);
    expect(found).toHaveLength(2);
    // Newest first, because that is what they just ran.
    expect(found[0].id).toBe('r2');
  });

  it('leaves out another officer’s queries', () => {
    expect(recentReturns([license()], 'u-tam', 12, NOW)).toEqual([]);
  });

  it('leaves out anything older than the window', () => {
    const old = license();
    old.receivedAt = '2026-03-10T02:31:00Z';
    expect(recentReturns([old], 'u-reyes', 12, NOW)).toEqual([]);
  });

  it('knows what has already been used on a document', () => {
    const ret = license();
    ret.appliedTo = ['crash-1'];
    expect(alreadyApplied(ret, 'crash-1')).toBe(true);
    expect(alreadyApplied(ret, 'crash-2')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

describe('a licence return becomes a person', () => {
  it('carries the identity across without retyping', () => {
    const person = personFromLicense(license())!;
    expect(person.lastName).toBe('Whitfield');
    expect(person.dob).toBe('1985-03-14');
    expect(person.driverLicense).toBe('AL7729140');
    expect(person.address).toBe('1142 Ashwood Ln');
  });

  it('marks every field it filled as unverified DMV data', () => {
    // The state's address may be three moves out of date, and the photo may
    // not be the person holding it. Fast is fine; claiming the officer
    // confirmed it is not.
    const person = personFromLicense(license())!;
    expect(person.provenance?.address?.source).toBe('dmv');
    expect(person.provenance?.address?.verified).toBe(false);
    expect(person.provenance?.dob?.verified).toBe(false);
  });

  it('stamps the time the registry answered, not the time it was filed', () => {
    expect(personFromLicense(license())!.provenance?.lastName?.at).toBe('2026-03-14T02:31:00Z');
  });

  it('refuses a return with no name', () => {
    expect(personFromLicense(license({ lastName: '', firstName: '' }))).toBeNull();
  });

  it('refuses a registration return', () => {
    expect(personFromLicense(registration())).toBeNull();
  });
});

describe('a registration return becomes a vehicle', () => {
  it('carries the vehicle across', () => {
    const vehicle = vehicleFromRegistration(registration())!;
    expect(vehicle.vin).toBe('3GCPKSE31BG104457');
    expect(vehicle.make).toBe('Chevrolet');
    expect(vehicle.plate).toBe('4AC7821');
  });

  it('gives the registered owner separately from the vehicle', () => {
    // The registered owner is a fact about the car. Who was driving is a fact
    // about the crash, and filing the owner as the driver produces reports
    // that name people who were asleep at home.
    const owner = ownerFromRegistration(registration())!;
    expect(owner.lastName).toBe('Mercer');
    expect(owner.address).toBe('88 Depot St');
    expect(owner.provenance?.lastName?.verified).toBe(false);
  });

  it('gives no owner when the return names none', () => {
    expect(ownerFromRegistration(registration({ ownerLastName: '', ownerFirstName: '' }))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* What the officer needs to see before applying                       */
/* ------------------------------------------------------------------ */

describe('alerts on a return', () => {
  it('surfaces a suspended licence', () => {
    // This is usually the reason the query was run. Burying it inside a field
    // the report fills silently wastes the one thing the officer needed.
    const alerts = alertsOn(license({ status: 'SUSPENDED' }));
    expect(alerts.some((a) => /SUSPENDED/.test(a))).toBe(true);
  });

  it('says nothing about a valid licence', () => {
    expect(alertsOn(license())).toEqual([]);
  });

  it('surfaces an expired registration', () => {
    expect(alertsOn(registration({ status: 'EXPIRED' })).length).toBeGreaterThan(0);
  });

  it('surfaces a registration with no insurance on it', () => {
    const alerts = alertsOn(registration({ insuranceCarrier: '' }));
    expect(alerts.some((a) => /insurance/i.test(a))).toBe(true);
  });
});

describe('describing a return in a list', () => {
  it('names the person on a licence', () => {
    expect(describeReturn(license())).toContain('Dana Whitfield');
  });

  it('names the vehicle on a registration', () => {
    expect(describeReturn(registration())).toContain('2011 Chevrolet Silverado');
  });
});
