import type { Incident } from '@/domain/types';
import type { IncidentPerson, MasterPerson, PersonIndex, PersonRole } from '@/domain/person';
import type { LocationIndex, MasterLocation } from '@/domain/location';
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
  people: PersonIndex;
  locations: LocationIndex;
} {
  /* ---- Places the agency knows -------------------------------------- */

  const ashwood = place({
    address: '1142 Ashwood Ln',
    city: 'Cedar Falls',
    state: 'AL',
    zip: '35004',
    locationType: '20',
    beat: '3B',
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
          phone: '(205) 555-0193',
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
    reportingOfficer: 'M. Reyes',
    reportingBadge: '4417',
    unit: 'Patrol 12',
    supervisor: 'Sgt. A. Boone',
    clearanceStatus: 'cleared_arrest',
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

  return { incidents: [incomplete, complete, approved], people: PEOPLE, locations: LOCATIONS };
}
