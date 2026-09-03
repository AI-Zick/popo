/**
 * The incidents the export is pinned against.
 *
 * A NIBRS file is fixed-width: every field has a column, and a field that moves
 * by one shifts every field after it. A state's loader rejects the file, or
 * worse accepts it and reads the wrong columns, and the agency's published
 * crime figures are wrong in a way nobody notices for a quarter.
 *
 * So the export is not checked by asserting on a handful of values. It is
 * pinned: this corpus is rendered for every profile and compared against
 * committed output, byte for byte. A change that moves one column of one
 * segment fails, loudly, with the diff.
 *
 * Every incident here reaches something the others do not — the comment on each
 * says what. Add to it rather than editing what is here: an existing case is
 * load-bearing for the golden file it produces.
 *
 * Built with the same factories the app uses, so a field added to a record
 * shows up here rather than being quietly absent from what is pinned.
 */

import {
  createIncident,
  createIncidentPerson,
  createLocation,
  createMasterPerson,
  createOffense,
  createProperty,
} from '../../factory';
import { emptyAgency, type AgencyProfile } from '../../agency';
import type { Incident } from '../../types';
import type { MasterLocation } from '../../location';
import type { MasterPerson, PersonIndex } from '../../person';

export const AGENCY: AgencyProfile = {
  ...emptyAgency(),
  name: 'Cedar Falls Police Department',
  ori: 'AL0010200',
  stateAgencyCode: 'Z9901',
  city: 'Cedar Falls',
  county: 'Blount',
  state: 'AL',
  configured: true,
};

export const LOCATION: MasterLocation = createLocation({
  id: 'loc-1',
  commonName: 'Marion Street Self Storage',
  address: '612 N Marion St',
  city: 'Cedar Falls',
  state: 'AL',
  zip: '35004',
  locationType: '20',
  beat: 'Zone 2',
  latitude: 33.61,
  longitude: -86.51,
});

export const LOCATIONS: Record<string, MasterLocation> = { [LOCATION.id]: LOCATION };

const people: MasterPerson[] = [
  createMasterPerson({
    id: 'mp-adult',
    lastName: 'Whitfield',
    firstName: 'Dana',
    dob: '1985-03-14',
    sex: 'F',
    race: 'W',
    ethnicity: 'N',
  }),
  createMasterPerson({
    id: 'mp-juvenile',
    lastName: 'Okafor',
    firstName: 'Samuel',
    dob: '2012-06-01',
    sex: 'M',
    race: 'B',
    ethnicity: 'U',
  }),
  // No date of birth, so age can only come from what the officer estimated.
  createMasterPerson({
    id: 'mp-unknown-age',
    lastName: 'Mercer',
    firstName: 'Travis',
    sex: 'M',
    race: 'U',
  }),
  // Longer than any fixed-width name field, so truncation is pinned.
  createMasterPerson({
    id: 'mp-long',
    lastName: 'Featherstonehaugh-Vandermeerschenko',
    firstName: 'Bartholomew',
    dob: '1970-12-31',
    sex: 'M',
    race: 'A',
    ethnicity: 'H',
  }),
  createMasterPerson({ id: 'mp-business', businessName: 'Marion Street Self Storage LLC' }),
];

export const PEOPLE: PersonIndex = Object.fromEntries(people.map((p) => [p.id, p]));

function incident(partial: Partial<Incident>): Incident {
  return createIncident({
    status: 'approved',
    locationId: LOCATION.id,
    reportedAt: '2026-08-14T21:40',
    occurredFrom: '2026-08-14T20:15',
    reportingOfficer: 'M. Reyes',
    reportingBadge: '4417',
    ...partial,
  });
}

export const INCIDENTS: Incident[] = [
  // A burglary with property, an adult victim, a named offender and an
  // arrestee: the ordinary case, and the one that produces every segment.
  incident({
    id: 'inc-full',
    caseNumber: '2026-000401',
    offenses: [
      createOffense({
        id: 'off-1',
        code: '220',
        statute: '13A-7-5',
        attemptCompleted: 'C',
        locationType: '20',
        methodOfEntry: 'F',
        premisesEntered: '3',
        biasMotivation: '88',
      }),
    ],
    property: [
      createProperty({
        id: 'prop-1',
        lossType: 'stolen',
        descriptionCode: '03',
        value: '2400',
        quantity: '1',
      }),
      createProperty({
        id: 'prop-2',
        lossType: 'recovered',
        descriptionCode: '04',
        value: '150',
        quantity: '2',
        dateRecovered: '2026-08-20',
      }),
    ],
    persons: [
      createIncidentPerson('victim', 'mp-adult', {
        id: 'v-1',
        victimType: 'I',
        offenseIds: ['off-1'],
        injuries: ['N'],
      }),
      createIncidentPerson('suspect', 'mp-long', { id: 'o-1', offenseIds: ['off-1'] }),
      createIncidentPerson('arrestee', 'mp-unknown-age', {
        id: 'a-1',
        arrestDate: '2026-08-15',
        arrestType: 'O',
        armedWith: ['01'],
        offenseIds: ['off-1'],
      }),
    ],
  }),

  // A society victim on a drug offence — the shape a wrong organisation check
  // once blocked outright, which is why victim type is pinned.
  incident({
    id: 'inc-society',
    caseNumber: '2026-000402',
    clearanceStatus: 'cleared_arrest',
    offenses: [
      createOffense({
        id: 'off-drug',
        code: '35A',
        statute: '13A-12-212',
        attemptCompleted: 'C',
        locationType: '13',
        biasMotivation: '88',
        criminalActivity: ['P'],
      }),
    ],
    property: [
      createProperty({
        id: 'prop-drug',
        lossType: 'seized',
        descriptionCode: '10',
        value: '0',
        quantity: '1',
        drugType: 'E',
        drugQuantity: '12.5',
        drugMeasurement: 'GM',
      }),
    ],
    persons: [
      createIncidentPerson('victim', '', {
        id: 'v-soc',
        victimType: 'S',
        offenseIds: ['off-drug'],
      }),
      createIncidentPerson('arrestee', 'mp-juvenile', {
        id: 'a-juv',
        arrestDate: '2026-08-16',
        arrestType: 'T',
        armedWith: ['99'],
        offenseIds: ['off-drug'],
      }),
    ],
    involvesJuvenile: true,
  }),

  // A business victim, an attempted offence with a weapon and a bias
  // motivation, an exceptional clearance, and no offender at all — which still
  // has to report one, unknown.
  incident({
    id: 'inc-business',
    caseNumber: '2026-000403',
    clearanceStatus: 'cleared_exceptional',
    exceptionalClearanceReason: 'B',
    clearedAt: '2026-08-30',
    offenses: [
      createOffense({
        id: 'off-attempt',
        code: '23F',
        statute: '13A-8-4',
        attemptCompleted: 'A',
        locationType: '20',
        weapons: ['12'],
        biasMotivation: '11',
      }),
    ],
    persons: [
      createIncidentPerson('victim', 'mp-business', {
        id: 'v-biz',
        victimType: 'B',
        offenseIds: ['off-attempt'],
      }),
    ],
    isDomestic: true,
  }),

  // Nothing but the minimum: no offences, no people, no property, no location,
  // and no occurrence time, so the reported time has to stand in for it.
  incident({
    id: 'inc-bare',
    caseNumber: '2026-000404',
    locationId: '',
    occurredFrom: '',
    offenses: [],
    persons: [],
    property: [],
  }),

  // Held back, one per reason, so the exclusion list is pinned as well.
  incident({ id: 'inc-draft', caseNumber: '2026-000405', status: 'draft' }),
  incident({ id: 'inc-review', caseNumber: '2026-000406', status: 'pending_review' }),
  incident({ id: 'inc-returned', caseNumber: '2026-000407', status: 'returned' }),
  incident({ id: 'inc-invalid', caseNumber: '2026-000408' }),
  incident({ id: 'inc-state-issue', caseNumber: '2026-000409' }),
];

/** Two of the incidents above are held back by counts rather than by status. */
export const ERRORS_BY_INCIDENT: Record<string, number> = { 'inc-invalid': 2 };
export const STATE_ISSUES_BY_INCIDENT: Record<string, number> = { 'inc-state-issue': 1 };

/** Fixed, so the header's generated-at stamp does not move between runs. */
export const AT = new Date('2026-09-03T14:25:00.000Z');
