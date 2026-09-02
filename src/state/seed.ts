import type { Incident } from '@/domain/types';
import type {
  FieldProvenance,
  FieldSource,
  IncidentPerson,
  MasterPerson,
  PersonIndex,
  PersonRole,
} from '@/domain/person';
import type { LocationIndex, MasterLocation } from '@/domain/location';
import type { AgencyProfile } from '@/domain/agency';
import { createCitation, createTrafficStop, type TrafficStop } from '@/domain/activity';
import { createQueryReturn, type QueryReturn } from '@/domain/inbound';
import { createUser, type User } from '@/domain/auth';

/**
 * Demo logins. The third is the "and those designated" case: a patrol officer
 * who maintains the location index, given the one permission that needs,
 * without being made a supervisor.
 */
const USERS: User[] = [
  createUser({
    id: 'u-reyes',
    name: 'M. Reyes',
    badge: '4417',
    username: 'mreyes',
    role: 'officer',
    createdBy: 'R. Vance',
  }),
  createUser({
    id: 'u-boone',
    name: 'Sgt. A. Boone',
    badge: '2210',
    username: 'aboone',
    role: 'supervisor',
    createdBy: 'R. Vance',
  }),
  createUser({
    id: 'u-tam',
    name: 'D. Tam',
    badge: '3388',
    username: 'dtam',
    role: 'officer',
    grants: ['notes.retract', 'notes.viewRetracted'],
    createdBy: 'R. Vance',
  }),
  createUser({
    id: 'u-vance',
    name: 'R. Vance',
    badge: '1001',
    username: 'rvance',
    role: 'admin',
    // Agency administrators are provisioned by the vendor, not by the agency.
    createdBy: 'Aegis Provisioning',
  }),
  createUser({
    id: 'u-platform',
    name: 'Aegis Provisioning',
    badge: '—',
    username: 'platform',
    role: 'vendor',
  }),
];
import type { GeoFeatureCollection } from '@/domain/geo';

/**
 * A stand-in jurisdiction. A real department loads its own boundary file from
 * county GIS or its CAD vendor; this exists so the map has something to draw.
 */
const WEST = -86.53;
const EAST = -86.45;
const SOUTH = 33.55;
const NORTH = 33.63;
const MID_LON = (WEST + EAST) / 2;
const MID_LAT = (SOUTH + NORTH) / 2;

const box = (w: number, s: number, e: number, n: number): [number, number][] => [
  [w, s],
  [e, s],
  [e, n],
  [w, n],
  [w, s],
];

const BOUNDARY: GeoFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Cedar Falls city limits' },
      geometry: { type: 'Polygon', coordinates: [box(WEST, SOUTH, EAST, NORTH)] },
    },
  ],
};

const ZONES: GeoFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { beat: '1A', ring: box(WEST, MID_LAT, MID_LON, NORTH) },
    { beat: '2C', ring: box(MID_LON, MID_LAT, EAST, NORTH) },
    { beat: '3B', ring: box(WEST, SOUTH, MID_LON, MID_LAT) },
    { beat: '4D', ring: box(MID_LON, SOUTH, EAST, MID_LAT) },
  ].map(({ beat, ring }) => ({
    type: 'Feature' as const,
    properties: { beat },
    geometry: { type: 'Polygon' as const, coordinates: [ring] },
  })),
};

const AGENCY: AgencyProfile = {
  name: 'Cedar Falls Police Department',
  ori: 'AL0010200',
  stateAgencyCode: '',
  city: 'Cedar Falls',
  county: 'St. Clair',
  state: 'AL',
  zip: '35004',
  zoneLabel: 'Beat',
  boundary: BOUNDARY,
  zones: ZONES,
  configured: true,
};
import {
  createLocation,
  createNote,
  createIncident,
  createIncidentPerson,
  createMasterPerson,
  createOffense,
  createProperty,
  createVehicle,
  createCharge,
} from '@/domain/factory';

/**
 * The shared password for the demo accounts. Obviously not a pattern for a real
 * deployment — it exists so the sign-in screen can be tried without a server to
 * issue credentials from.
 */
export const DEMO_PASSWORD = 'cedar-falls-2026';

const PEOPLE: PersonIndex = {};
const LOCATIONS: LocationIndex = {};

function place(partial: Partial<MasterLocation>): MasterLocation {
  const location = createLocation(partial);
  LOCATIONS[location.id] = location;
  return location;
}

/** Registers a master identity and returns the incident link for it. */
function person(
  role: PersonRole,
  identity: Partial<MasterPerson>,
  involvement: Partial<IncidentPerson> = {},
): IncidentPerson {
  const master = createMasterPerson(identity);
  PEOPLE[master.id] = master;
  return createIncidentPerson(role, master.id, involvement);
}

/** Adds a second involvement for an identity already in the index. */
function samePerson(
  link: IncidentPerson,
  role: PersonRole,
  involvement: Partial<IncidentPerson> = {},
): IncidentPerson {
  return createIncidentPerson(role, link.masterId, involvement);
}

/**
 * A provenance stamp, N days back.
 *
 * The seed carries a realistic spread on purpose: an address confirmed at the
 * scene, a phone number nobody has touched in years, and one record migrated
 * from the previous system with no provenance at all. All three states show up
 * differently, which is the point — a system where everything reads "current"
 * teaches officers not to look.
 */
function stampedDaysAgo(days: number, source: FieldSource = 'officer'): FieldProvenance {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return { source, verified: source === 'officer', at: d.toISOString() };
}

function isoDaysAgo(days: number, hour = 14, minute = 30): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Demo data. The second report is deliberately incomplete — it is the fastest
 * way to see how the validation surface behaves on a real, half-written case.
 */
export function seedState(): {
  incidents: Incident[];
  stops: TrafficStop[];
  returns: QueryReturn[];
  people: PersonIndex;
  locations: LocationIndex;
  agency: AgencyProfile;
  users: User[];
  credentials: Record<string, never>;
  auditLog: never[];
} {
  /* ---- Places the agency knows -------------------------------------- */

  const ashwood = place({
    address: '1142 Ashwood Ln',
    city: 'Cedar Falls',
    state: 'AL',
    zip: '35004',
    locationType: '20',
    beat: '3B',
    latitude: 33.5715,
    longitude: -86.5102,
    geoSource: 'pin',
  });

  // The case this whole feature exists for: one facility, many units, and the
  // gate code written down where the next officer will find it.
  const storage = place({
    commonName: 'Marion Street Self Storage',
    aliases: ['Marion Storage', 'the storage place on Marion'],
    address: '612 N Marion St',
    city: 'Cedar Falls',
    state: 'AL',
    zip: '35004',
    locationType: '25',
    beat: '1A',
    latitude: 33.6104,
    longitude: -86.5148,
    geoSource: 'pin',
    hasUnits: true,
    unitLabel: 'Unit',
    notes: [
      createNote({
        kind: 'access',
        text: 'Police gate code 4417# on the keypad at the Marion St entrance. Rear gate on Depot is chained after 1800 — do not try it.',
        author: 'Sgt. A. Boone',
        sensitive: true,
      }),
      createNote({
        kind: 'contact',
        text: 'Manager Renee Ortiz, (205) 555-0121. Will come out after hours for a burglary. Office hours 0900-1700 Mon-Sat.',
        author: 'M. Reyes',
      }),
      createNote({
        kind: 'hazard',
        text: 'Cameras cover the drive lanes only, not inside the buildings. Aisle lighting between buildings C and D has been out since spring.',
        author: 'M. Reyes',
      }),
    ],
  });

  const highway = place({
    address: 'US-411 at Watson Rd',
    city: 'Cedar Falls',
    state: 'AL',
    zip: '35004',
    locationType: '13',
    beat: '2C',
    latitude: 33.6008,
    longitude: -86.4703,
    geoSource: 'pin',
  });

  /* ---- 1. A complete, submitted residential burglary ------------------ */
  const burglary = createOffense({
    code: '220',
    statute: '13A-7-6',
    attemptCompleted: 'C',
    locationType: '20',
    methodOfEntry: 'F',
    premisesEntered: '1',
    biasMotivation: '88',
  });
  const larceny = createOffense({
    code: '23D',
    statute: '13A-8-4',
    attemptCompleted: 'C',
    locationType: '20',
    biasMotivation: '88',
  });

  const victim1 = person(
    'victim',
    {
      lastName: 'Whitfield',
      firstName: 'Dana',
      middleName: 'Marie',
      dob: '1985-03-14',
      sex: 'F',
      race: 'W',
      ethnicity: 'N',
      address: '1142 Ashwood Ln',
      city: 'Cedar Falls',
      state: 'AL',
      zip: '35004',
      phone: '(205) 555-0148',
      driverLicense: 'AL7729140',
      driverLicenseState: 'AL',
      provenance: {
        // Confirmed with her at the scene two days ago.
        address: stampedDaysAgo(2),
        // The number has been in the index since a call in 2022 and nobody has
        // checked it since. This is the case the feature exists for.
        phone: stampedDaysAgo(1400),
      },
    },
    { victimType: 'I', injuries: ['N'], offenseIds: [burglary.id, larceny.id] },
  );

  const complete = createIncident({
    caseNumber: '2026-000418',
    status: 'pending_review',
    reportedAt: isoDaysAgo(2, 8, 12),
    occurredFrom: isoDaysAgo(3, 22, 0),
    occurredTo: isoDaysAgo(2, 7, 45),
    occurredIsRange: true,
    locationId: ashwood.id,
    createdBy: 'u-reyes',
    reportingOfficer: 'M. Reyes',
    reportingBadge: '4417',
    unit: 'Patrol 12',
    supervisor: 'Sgt. A. Boone',
    clearanceStatus: 'open',
    offenses: [burglary, larceny],
    persons: [victim1],
    property: [
      createProperty({
        lossType: 'stolen',
        descriptionCode: '07',
        value: '1450',
        quantity: '1',
        make: 'Apple',
        model: 'MacBook Pro 14',
        serialNumber: 'C02XL0THJGH7',
        description: 'Space grey laptop, cracked lower right bezel',
        ownerPersonId: victim1.id,
      }),
      createProperty({
        lossType: 'stolen',
        descriptionCode: '17',
        value: '2200',
        quantity: '3',
        description: "Two gold rings and a pearl necklace from the bedroom dresser",
        ownerPersonId: victim1.id,
      }),
    ],
    narrative:
      'On the above date and time I was dispatched to 1142 Ashwood Ln in reference to a burglary that had already occurred. ' +
      'I made contact with the homeowner, Dana Whitfield, in the driveway. Whitfield stated she left the residence at approximately 2200 hours the previous evening to stay with family and returned at 0745 hours this morning to find the rear sliding door standing open.\n\n' +
      'I observed fresh pry marks on the exterior frame of the rear sliding door, consistent with a flat bar. The interior latch was bent outward and the door would no longer secure. No other point of entry showed damage.\n\n' +
      'Whitfield walked me through the residence. The master bedroom dresser drawers were open and their contents disturbed. Whitfield reported a MacBook Pro laptop missing from the kitchen counter and three pieces of jewelry missing from the dresser. She provided the laptop serial number from her original receipt.\n\n' +
      'I photographed the point of entry and the disturbed rooms, and lifted two latent prints from the exterior door frame. Latents were submitted to the lab under this case number. No witnesses were located during a canvass of the four adjacent residences. Whitfield was provided a case card and advised of the follow-up process.',
  });

  /* ---- 2. A half-written vehicle theft, full of gaps ------------------ */
  const mvt = createOffense({
    code: '240',
    statute: '',
    attemptCompleted: 'C',
    locationType: '',
    biasMotivation: '88',
  });

  const incomplete = createIncident({
    caseNumber: '2026-000431',
    status: 'draft',
    reportedAt: isoDaysAgo(0, 9, 5),
    occurredFrom: '',
    occurredIsRange: false,
    locationId: storage.id,
    locationUnit: '',
    createdBy: 'u-reyes',
    reportingOfficer: 'M. Reyes',
    reportingBadge: '4417',
    unit: 'Patrol 12',
    clearanceStatus: 'open',
    offenses: [mvt],
    persons: [
      person(
        'victim',
        {
          lastName: 'Okafor',
          firstName: 'Samuel',
          sex: 'M',
          race: 'B',
          address: '88 Marion St',
          city: 'Cedar Falls',
          state: 'AL',
          phone: '(205) 555-0193',
          provenance: {
            // Carried over from a 2022 case. Nobody has confirmed either of
            // these since, and the officer taking this report needs to know
            // that before trying to reach him.
            address: stampedDaysAgo(1580),
            phone: stampedDaysAgo(1580),
          },
        },
        { victimType: 'I' },
      ),
    ],
    property: [],
    vehicles: [],
    narrative: 'Victim reports his truck was taken from the lot overnight.',
  });

  /* ---- 3. An approved DUI arrest -------------------------------------- */
  const dui = createOffense({
    code: '90D',
    statute: '32-5A-191',
    attemptCompleted: 'C',
    locationType: '13',
    biasMotivation: '88',
  });
  const arrestee = person(
    'arrestee',
    {
      lastName: 'Mercer',
      firstName: 'Travis',
      middleName: 'Ray',
      dob: '1994-11-02',
      sex: 'M',
      race: 'W',
      ethnicity: 'N',
      address: '88 Perch St',
      city: 'Cedar Falls',
      state: 'AL',
      driverLicense: 'AL5518203',
      driverLicenseState: 'AL',
      cautions: ['Known to resist'],
      // The address came back on the licence query and was never confirmed
      // with him at the roadside — the report should not imply otherwise.
      provenance: {
        address: { source: 'dmv', verified: false, at: new Date().toISOString() },
        driverLicense: { source: 'dmv', verified: true, at: new Date().toISOString() },
      },
    },
    {
      arrestDate: isoDaysAgo(6).slice(0, 10),
      arrestType: 'O',
      offenseIds: [dui.id],
      charges: [
        createCharge({
          statute: '32-5A-191',
          description: 'DUI — Alcohol',
          counts: '1',
          degree: 'Misdemeanor',
        }),
      ],
    },
  );
  const societyVictim = person('victim', {}, { victimType: 'S', offenseIds: [dui.id] });

  const approved = createIncident({
    caseNumber: '2026-000402',
    status: 'approved',
    reportedAt: isoDaysAgo(6, 23, 40),
    occurredFrom: isoDaysAgo(6, 23, 35),
    locationId: highway.id,
    createdBy: 'u-reyes',
    reportingOfficer: 'M. Reyes',
    reportingBadge: '4417',
    unit: 'Patrol 12',
    supervisor: 'Sgt. A. Boone',
    clearanceStatus: 'cleared_arrest',
    dispositionBeforeSupplement: null,
    offenses: [dui],
    persons: [arrestee, societyVictim],
    vehicles: [
      createVehicle({
        involvement: 'towed',
        year: '2011',
        make: 'Chevrolet',
        model: 'Silverado',
        color: 'Red',
        plate: '4AC7821',
        plateState: 'AL',
        vin: '3GCPKSE31BG104457',
        towedTo: "Halloran's Towing, 400 Depot St",
        ownerPersonId: arrestee.id,
      }),
    ],
    narrative:
      'While on routine patrol I observed a red Chevrolet pickup traveling northbound on US-411 cross the fog line three times over approximately a quarter mile. I initiated a traffic stop at Watson Rd.\n\n' +
      'On contact the driver, identified by Alabama license as Travis Ray Mercer, had bloodshot watery eyes and slurred speech, and I detected a strong odor of an alcoholic beverage coming from the vehicle. Mercer stated he had consumed "a couple" of beers.\n\n' +
      'Mercer consented to standardized field sobriety testing. I observed six of six clues on the horizontal gaze nystagmus test, five clues on the walk and turn, and three clues on the one leg stand. Mercer was placed under arrest for DUI and advised of his Miranda rights, which he acknowledged he understood.\n\n' +
      'Mercer submitted to a breath test on the departmental instrument with a result of 0.14. The vehicle was towed by Halloran\'s Towing and Mercer was transported to the county jail without incident.',
    submittedAt: new Date(Date.now() - 5 * 864e5).toISOString(),
  });

  // Travis Mercer turns up again as a suspect, which is the point of a shared
  // index: one identity, many reports.
  const priorSuspect = samePerson(arrestee, 'suspect', { offenseIds: [] });
  incomplete.persons.push(priorSuspect);

  /* ---- Traffic stops --------------------------------------------------- */

  /*
    A shift's worth of stops, so the activity report has something real to
    count. Most produce nothing but a warning, which is the point — an officer
    who ran twenty stops and wrote two reports should not read as idle.
  */
  const STOPS: TrafficStop[] = [
    ['u-reyes', 0, 21, 'US-411 at Watson Rd', 'speed', 'citation', 1, 0],
    ['u-reyes', 0, 22, 'US-411 near mile 14', 'speed', 'warning', 0, 0],
    ['u-reyes', 0, 22, 'Depot St at 3rd', 'equipment', 'warning', 0, 1],
    ['u-reyes', 0, 23, 'US-411 at Watson Rd', 'registration', 'citation', 2, 0],
    ['u-reyes', 1, 20, 'N Marion St', 'moving', 'warning', 0, 0],
    ['u-reyes', 1, 23, 'US-411 at the county line', 'suspicion', 'arrest', 0, 0],
    ['u-tam', 0, 19, 'Cedar Ave at Willow', 'speed', 'citation', 1, 0],
    ['u-tam', 0, 20, 'Cedar Ave at Willow', 'speed', 'citation', 1, 0],
    ['u-tam', 0, 21, 'Old Mill Rd', 'equipment', 'no_action', 0, 0],
    ['u-tam', 2, 18, 'Depot St at 3rd', 'bolo', 'warning', 0, 0],
  ].map(([officerId, daysBack, hour, location, reason, outcome, cited, warned], index) => {
    const officer = USERS.find((u) => u.id === officerId)!;
    const at = new Date();
    at.setDate(at.getDate() - Number(daysBack));
    at.setHours(Number(hour), 15 + index, 0, 0);
    return createTrafficStop({
      id: `stop_seed_${index}`,
      officerId: String(officerId),
      officerName: officer.name,
      at: at.toISOString(),
      location: String(location),
      beat: index % 2 === 0 ? '2C' : '3B',
      reason: reason as TrafficStop['reason'],
      outcome: outcome as TrafficStop['outcome'],
      citations: [
        ...Array.from({ length: Number(cited) }, (_, i) =>
          createCitation({ id: `cit_${index}_${i}`, statute: '32-5A-171', description: 'Speeding' }),
        ),
        ...Array.from({ length: Number(warned) }, (_, i) =>
          createCitation({
            id: `warn_${index}_${i}`,
            statute: '32-5-240',
            description: 'Defective equipment',
            warningOnly: true,
          }),
        ),
      ],
    });
  });

  /* ---- What dispatch and the registries already know -------------------- */

  /*
    A crash call and the queries that came back on it, so the autofill panel has
    something real to offer. This is the shape a CAD or MDT adapter posts to the
    ingest endpoint — one call record and the returns the officer ran at the
    scene, tied together by the call number.
  */
  const CALL_NUMBER = 'CF-2026-0417';
  const crashHour = (minutes: number) => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(23, minutes, 0, 0);
    return d.toISOString();
  };

  const RETURNS: QueryReturn[] = [
    createQueryReturn({
      id: 'ret_seed_call',
      source: 'cad',
      query: CALL_NUMBER,
      callNumber: CALL_NUMBER,
      officerId: 'u-reyes',
      officerName: 'M. Reyes',
      receivedAt: crashHour(12),
      payload: {
        kind: 'call',
        callNumber: CALL_NUMBER,
        nature: 'Motor vehicle crash — injuries unknown',
        address: 'US-411',
        city: 'Cedar Falls',
        state: 'AL',
        crossStreet: 'Watson Rd',
        latitude: '33.5992',
        longitude: '-86.4881',
        beat: '2C',
        receivedAt: crashHour(12),
        dispatchedAt: crashHour(13),
        arrivedAt: crashHour(19),
        clearedAt: '',
        units: ['12', '14'],
        comments: [
          'Caller reports two vehicles, one in the roadway blocking the northbound lane.',
          'Second caller states occupants are out and walking.',
        ],
      },
    }),
    createQueryReturn({
      id: 'ret_seed_reg1',
      source: 'dmv',
      query: '4AC7821',
      callNumber: CALL_NUMBER,
      officerId: 'u-reyes',
      officerName: 'M. Reyes',
      receivedAt: crashHour(24),
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
      },
    }),
    createQueryReturn({
      id: 'ret_seed_reg2',
      source: 'dmv',
      query: 'JHK4402',
      callNumber: CALL_NUMBER,
      officerId: 'u-reyes',
      officerName: 'M. Reyes',
      receivedAt: crashHour(26),
      payload: {
        kind: 'registration',
        plate: 'JHK4402',
        plateState: 'AL',
        plateYear: '2025',
        vin: '1N4AL3AP7JC232210',
        year: '2018',
        make: 'Nissan',
        model: 'Altima',
        style: '4D',
        color: 'SIL',
        ownerLastName: 'Okafor',
        ownerFirstName: 'Samuel',
        ownerMiddleName: '',
        ownerAddress: '88 Marion St',
        ownerCity: 'Cedar Falls',
        ownerState: 'AL',
        ownerZip: '35004',
        // The reason the query was worth running.
        status: 'EXPIRED',
        expiresOn: '2025-12-31',
        insuranceCarrier: '',
        insurancePolicy: '',
      },
    }),
    createQueryReturn({
      id: 'ret_seed_dl1',
      source: 'dmv',
      query: 'AL5512890',
      callNumber: CALL_NUMBER,
      officerId: 'u-reyes',
      officerName: 'M. Reyes',
      receivedAt: crashHour(28),
      payload: {
        kind: 'license',
        licenseNumber: 'AL5512890',
        licenseState: 'AL',
        licenseClass: 'D',
        status: 'Valid',
        expiresOn: '2030-04-18',
        restrictions: '',
        lastName: 'Mercer',
        firstName: 'Travis',
        middleName: 'Ray',
        suffix: '',
        dob: '1994-07-22',
        sex: 'M',
        race: 'W',
        height: '6-01',
        weight: '205',
        eyeColor: 'BLU',
        hairColor: 'BRO',
        address: '88 Depot St',
        city: 'Cedar Falls',
        state: 'AL',
        zip: '35004',
      },
    }),
    createQueryReturn({
      id: 'ret_seed_dl2',
      source: 'nlets',
      query: 'GA9930114',
      callNumber: CALL_NUMBER,
      officerId: 'u-reyes',
      officerName: 'M. Reyes',
      receivedAt: crashHour(31),
      payload: {
        kind: 'license',
        licenseNumber: 'GA9930114',
        licenseState: 'GA',
        licenseClass: 'C',
        // The other reason the query was worth running.
        status: 'SUSPENDED',
        expiresOn: '2027-02-02',
        restrictions: 'Corrective lenses',
        lastName: 'Okafor',
        firstName: 'Samuel',
        middleName: 'A',
        suffix: '',
        dob: '1988-11-04',
        sex: 'M',
        race: 'B',
        height: '5-10',
        weight: '180',
        eyeColor: 'BRO',
        hairColor: 'BLK',
        address: '88 Marion St',
        city: 'Cedar Falls',
        state: 'AL',
        zip: '35004',
      },
    }),
  ];

  return {
    incidents: [incomplete, complete, approved],
    stops: STOPS,
    returns: RETURNS,
    people: PEOPLE,
    locations: LOCATIONS,
    agency: AGENCY,
    users: USERS,
    // Password hashing is async, so demo credentials are provisioned by a
    // bootstrap effect in the store rather than here.
    credentials: {},
    auditLog: [],
  };
}
