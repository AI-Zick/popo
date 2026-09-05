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
import { createMasterVehicle, type VehicleIndex } from '@/domain/vehicle';
import { createTrespass, type Trespass } from '@/domain/trespass';
import { createWarrant, createWarrantCharge, type Warrant } from '@/domain/warrant';
import { createFieldContact, createSubject, type FieldContact } from '@/domain/fieldContact';
import { createCitation, createViolation, type Citation } from '@/domain/citation';
import { createRequest, type PublicRequest } from '@/domain/publicRecords';
import { emptyAgency, type AgencyProfile } from '@/domain/agency';
import { statutePack } from '@/domain/statutes';
import { createStopCitation, createTrafficStop, type TrafficStop } from '@/domain/activity';
import { createQueryReturn, type QueryReturn } from '@/domain/inbound';
import { createUser, type User } from '@/domain/auth';

/**
 * Demo logins. The third is the "and those designated" case: a patrol officer
 * who maintains the location index, given the one permission that needs,
 * without being made a supervisor. The fourth is the records clerk, who is the
 * only one of them who can decide what leaves the building on a public records
 * request. The fifth is a dispatcher, who runs the board and nothing else —
 * the only non-administrator here who can take a BOLO down.
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
    id: 'u-doyle',
    name: 'K. Doyle',
    badge: '771',
    username: 'kdoyle',
    role: 'dispatch',
    createdBy: 'R. Vance',
  }),
  createUser({
    id: 'u-okafor',
    name: 'J. Okafor',
    badge: '5502',
    username: 'jokafor',
    role: 'records',
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
import { createBulletin, REVIEW_DAYS, type Bulletin } from '@/domain/bulletin';

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
  ...emptyAgency(),
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
  /*
    A demonstration agency partway through setting its exemptions up, which is
    the state a real one is in for its first few weeks.

    Three of the state templates are switched on so the redaction screen has
    something to show. Their citations are left blank on purpose: that is the
    department's research to do, and it is what puts the "name the statute
    before this goes out" gate in front of anybody clicking through the demo.
    Inventing a plausible-looking Alabama citation here would be worse than
    showing an empty field — somebody would believe it.
  */
  /*
    The Alabama statute table, unchecked — which is the state a real agency is
    in on day one. A demo where every cite is already confirmed would hide the
    one thing this screen is for.
  */
  statutes: statutePack('AL'),
  exemptions: emptyAgency().exemptions.map((rule) =>
    ['st-juvenile', 'st-victim-identity', 'st-reporting-party'].includes(rule.id)
      ? { ...rule, enabled: true }
      : rule,
  ),
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
  bulletins: Bulletin[];
  people: PersonIndex;
  locations: LocationIndex;
  vehicles: VehicleIndex;
  trespasses: Trespass[];
  warrants: Warrant[];
  contacts: FieldContact[];
  citations: Citation[];
  publicRequests: PublicRequest[];
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
          createStopCitation({ id: `cit_${index}_${i}`, statute: '32-5A-171', description: 'Speeding' }),
        ),
        ...Array.from({ length: Number(warned) }, (_, i) =>
          createStopCitation({
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

  /* ---- Vehicles of record --------------------------------------------- */
  /*
    Two records that make the index's one rule visible: the plate on the Camry
    today was on the pickup until March, so running 4AC-7821 finds both and the
    screen has to say which is which. A demo where every plate resolves cleanly
    teaches nothing about why a plate is not a car.
  */
  const camry = createMasterVehicle({
    id: 'veh_seed_camry',
    vin: '1HGCM82633A004352',
    plate: '4AC7821',
    plateState: 'AL',
    plateYear: '2026',
    year: '2019',
    make: 'Toyota',
    model: 'Camry',
    style: '4-door sedan',
    color: 'Silver',
    registeredOwnerId: Object.values(PEOPLE)[0]?.id ?? '',
  });
  const pickup = createMasterVehicle({
    id: 'veh_seed_pickup',
    vin: '1M8GDM9AXKP042788',
    plate: 'CF29104',
    plateState: 'AL',
    year: '2012',
    make: 'Ford',
    model: 'F-150',
    color: 'White',
    formerPlates: [{ plate: '4AC7821', state: 'AL', seenUntil: '2026-03-02' }],
    cautions: ['Owner has a caution flag on their name record'],
  });
  const VEHICLES: VehicleIndex = { [camry.id]: camry, [pickup.id]: pickup };

  /* ---- Trespass notices ------------------------------------------------ */
  /*
    Three against the storage facility, chosen to put every state on screen at
    once: one indefinite, one that runs out shortly, and one that already has.
    The expired one is the point — it is still here, because a notice that was
    in force is evidence long after it stops being one.
  */
  const barred = Object.values(PEOPLE).slice(0, 3);
  const TRESPASSES: Trespass[] = barred.map((who, index) =>
    createTrespass({
      id: `tr_seed_${index + 1}`,
      personId: who.id,
      locationId: storage.id,
      servedOn: ['2025-11-04', '2026-02-18', '2024-06-01'][index] ?? '2026-01-01',
      expiresOn: ['', '2026-09-30', '2025-06-01'][index] ?? '',
      requestedBy: 'Renee Ortiz, manager',
      requestedByPhone: '(205) 555-0121',
      issuedByName: index === 1 ? 'Dispatch' : 'M. Reyes',
      source: index === 1 ? 'dispatch' : 'officer',
      notes:
        index === 0
          ? 'Covers the whole site including the drive lanes and the office.'
          : '',
    }),
  );

  /* ---- Warrants -------------------------------------------------------- */
  /*
    Two, arranged so the extradition rule is visible rather than described: a
    felony the court will collect on from anywhere, and a bench warrant for a
    missed court date that they will not leave the county for. An officer
    reading both should be able to see, without being told, that they are not
    the same thing to act on.
  */
  const wantedPerson = Object.values(PEOPLE)[1] ?? Object.values(PEOPLE)[0];
  const WARRANTS: Warrant[] = wantedPerson
    ? [
        createWarrant({
          id: 'war_seed_1',
          personId: wantedPerson.id,
          number: 'CF-2026-0148',
          kind: 'arrest',
          court: 'Cedar Falls Municipal Court',
          docket: 'CR-2026-00311',
          judge: 'Hon. M. Alvarez',
          issuedOn: '2026-02-11',
          extradition: 'national',
          bond: '$25,000 cash or surety',
          cautions: ['Endorsed by the court as a flight risk'],
          charges: [
            createWarrantCharge({
              id: 'wc_seed_1',
              statute: '13A-7-5',
              description: 'Burglary, first degree',
              severity: 'felony',
              counts: '1',
            }),
          ],
          enteredByName: 'Records',
          attempts: [
            {
              id: 'att_seed_1',
              at: '2026-02-20T07:40:00Z',
              address: '1142 Ashwood Ln',
              byId: '',
              byName: 'M. Reyes',
              outcome: 'notHome',
              notes: 'Mother says he works nights and is usually there mornings.',
            },
            {
              id: 'att_seed_2',
              at: '2026-03-04T06:15:00Z',
              address: '1142 Ashwood Ln',
              byId: '',
              byName: 'D. Tam',
              outcome: 'moved',
              notes: 'New tenant. Forwarding address unknown.',
            },
          ],
        }),
        createWarrant({
          id: 'war_seed_2',
          personId: wantedPerson.id,
          number: 'CF-2025-1902',
          kind: 'bench',
          court: 'Cedar Falls Municipal Court',
          issuedOn: '2025-11-30',
          extradition: 'county',
          bond: '$500',
          charges: [
            createWarrantCharge({
              id: 'wc_seed_2',
              statute: '13A-10-40',
              description: 'Failure to appear',
              severity: 'misdemeanor',
              counts: '1',
            }),
          ],
          enteredByName: 'Records',
        }),
      ]
    : [];

  /* ---- Field contacts --------------------------------------------------- */
  /*
    One of each basis, because the distinction is the point. The detention
    carries an account of what the officer saw; the consensual one carries no
    reason at all, and is not missing anything by carrying none.
  */
  const CONTACTS: FieldContact[] = [
    createFieldContact({
      id: 'fc_seed_1',
      number: '2026-FC00001',
      occurredAt: '2026-03-02T02:15:00Z',
      locationId: storage.id,
      address: '612 N Marion St',
      basis: 'detention',
      reason:
        'Walking the drive lanes between buildings C and D at 0215 pulling on unit door handles.',
      disposition: 'released',
      narrative:
        'Said he was looking for a unit he rents. Could not give a unit number. No property on him. Manager confirmed next morning he has no unit here.',
      officerName: 'M. Reyes',
      subjects: [
        createSubject({
          id: 'sub_seed_1',
          givenName: 'Would not give a surname',
          description: 'Grey hooded top, red rucksack, mid-twenties',
          declinedToIdentify: true,
        }),
      ],
    }),
    createFieldContact({
      id: 'fc_seed_2',
      number: '2026-FC00002',
      occurredAt: '2026-02-14T18:40:00Z',
      locationId: storage.id,
      address: '612 N Marion St',
      basis: 'consensual',
      disposition: 'advised',
      narrative:
        'Spoke to the manager about the lighting between C and D. She is chasing the electrician.',
      officerName: 'M. Reyes',
      subjects: [
        createSubject({ id: 'sub_seed_2', givenName: 'Renee Ortiz', description: 'Site manager' }),
      ],
    }),
  ];

  /* ---- Citations -------------------------------------------------------- */
  /*
    Two, arranged so the reconciliation story is visible. One arrived from the
    MDT the same afternoon; the other an officer keyed in from the book four
    days later, which is exactly the case the manual path exists for and
    exactly the gap worth surfacing on screen.
  */
  const cited = Object.values(PEOPLE)[0];
  const CITATIONS: Citation[] = cited
    ? [
        createCitation({
          id: 'cit_seed_1',
          number: 'A-4471902',
          issuedAt: '2026-08-28T15:20:00Z',
          recordedAt: '2026-08-28T15:41:00Z',
          source: 'mdt',
          personId: cited.id,
          subjectName: `${cited.lastName}, ${cited.firstName}`,
          plate: '4AC7821',
          plateState: 'AL',
          location: 'US-411 at Watson Rd',
          court: 'Cedar Falls Municipal Court',
          courtDate: '2026-10-14',
          officerName: 'M. Reyes',
          violations: [
            createViolation({
              id: 'vio_seed_1',
              statute: '32-5A-171',
              description: 'Speeding',
              speed: '52',
              speedLimit: '35',
              fine: '$187',
            }),
          ],
        }),
        createCitation({
          id: 'cit_seed_2',
          number: 'B-0099431',
          issuedAt: '2026-08-14T21:05:00Z',
          recordedAt: '2026-08-18T09:12:00Z',
          source: 'officer',
          personId: cited.id,
          subjectName: `${cited.lastName}, ${cited.firstName}`,
          location: 'N Marion St at Depot',
          officerName: 'D. Tam',
          notes: 'MDT was down for the whole shift. Written from the book.',
          violations: [
            createViolation({
              id: 'vio_seed_2',
              description: 'No proof of insurance',
              statute: '32-7A-16',
            }),
          ],
        }),
      ]
    : [];

  /*
    Two requests waiting, because an empty queue teaches nothing and the clock
    is the most distinctive thing on this screen. One arrived this week and has
    time in hand; the other came in three weeks ago and is past its deadline —
    which is the failure agencies are actually sued for, and the reason the due
    date is worked out on every read rather than stored.

    Neither has any records attached. Finding what is responsive is the clerk's
    first job, and starting from that is what the screen is for.
  */
  /*
    Relative, so the demo reads the same whenever somebody opens it. A seeded
    date typed as a literal is a request that is fourteen days overdue this
    week and four hundred next year.
  */
  const daysAgo = (days: number) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

  const PUBLIC_REQUESTS: PublicRequest[] = [
    createRequest({
      id: 'prr_seed_1',
      number: 'PR-2026-00014',
      receivedAt: `${daysAgo(2)}T09:12:00Z`,
      channel: 'email',
      description:
        'Copies of the incident report and any photographs from the burglary on Ashwood Lane earlier this month.',
      requester: {
        name: 'H. Okonjo',
        organization: 'Cedar Falls Ledger',
        email: 'hokonjo@example.com',
        phone: '',
        address: '',
        collect: '',
      },
    }),
    createRequest({
      id: 'prr_seed_2',
      number: 'PR-2026-00013',
      receivedAt: `${daysAgo(24)}T16:40:00Z`,
      channel: 'counter',
      description:
        'Every traffic citation issued on US-411 in the last twelve months, with the officer who issued each one.',
      requester: {
        name: '',
        organization: '',
        email: '',
        phone: '',
        address: '',
        collect: 'Said they would collect it at the counter. Gave no name.',
      },
    }),
  ];

  /*
    Something on the board, because an empty one demonstrates nothing.

    Three entries chosen to show the three things the board does: a lookout
    that ends by itself, a standing safety warning that does not, and a shift
    notice. The safety warning is dated far enough back that the "still
    current?" prompt is visible, which is the part of this that stops boards
    rotting and the part nobody would otherwise see.
  */
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 36e5).toISOString();
  const inDays = (days: number) => new Date(Date.now() + days * 864e5).toISOString();
  const BULLETINS: Bulletin[] = [
    createBulletin({
      id: 'bul_seed_1',
      kind: 'officerSafety',
      headline: '1142 Ashwood Ln — dog at large, prior assault on officers',
      lookFor: 'Two occupants. The dog is loose in the side yard, not fenced.',
      detail:
        'Flagged after the burglary call. The resident is cooperative; the neighbour at 1140 is not, and was arrested here in 2024 for assaulting an officer.',
      area: 'North end',
      contact: 'Dispatch',
      postedById: 'u-doyle',
      postedByName: 'K. Doyle',
      postedAt: hoursAgo(24 * (REVIEW_DAYS + 4)),
      source: 'dispatch',
      expiresAt: '',
    }),
    createBulletin({
      id: 'bul_seed_2',
      kind: 'bolo',
      headline: 'Silver pickup, burglary on Ashwood',
      lookFor:
        'Silver Ford F-150, older body style, dent in the tailgate. Partial plate 4KJ. Left westbound.',
      area: 'North end, around Ashwood and Third',
      contact: 'Unit 12 (Reyes)',
      caseNumber: '2026-000148',
      postedById: 'u-reyes',
      postedByName: 'M. Reyes',
      postedAt: hoursAgo(9),
      expiresAt: inDays(6),
    }),
    createBulletin({
      id: 'bul_seed_3',
      kind: 'information',
      headline: 'Third Street closed at the bridge until Friday',
      detail: 'County crew on the deck. Marked detour via Vine. Affects response from the south.',
      contact: 'Desk',
      postedById: 'u-doyle',
      postedByName: 'K. Doyle',
      postedAt: hoursAgo(30),
      source: 'dispatch',
      expiresAt: inDays(4),
    }),
  ];

  return {
    incidents: [incomplete, complete, approved],
    bulletins: BULLETINS,
    stops: STOPS,
    returns: RETURNS,
    people: PEOPLE,
    locations: LOCATIONS,
    vehicles: VEHICLES,
    trespasses: TRESPASSES,
    warrants: WARRANTS,
    contacts: CONTACTS,
    citations: CITATIONS,
    publicRequests: PUBLIC_REQUESTS,
    agency: AGENCY,
    users: USERS,
    // Password hashing is async, so demo credentials are provisioned by a
    // bootstrap effect in the store rather than here.
    credentials: {},
    auditLog: [],
  };
}
