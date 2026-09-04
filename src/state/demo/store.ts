/**
 * The demo's world, held in one tab.
 *
 * A published demo has no server, so this stands in for the database — and
 * only for the database. Every rule a tester is actually evaluating comes from
 * `src/domain`, the same modules the real server calls: what makes a report
 * submittable, who may approve it, whether a custody chain verifies, what a
 * court order would destroy. This file holds rows and hands them to those.
 *
 * What that buys is a demo that cannot quietly disagree with the product. What
 * it does not buy is a second implementation of the server's route wiring —
 * that part is written twice, here and in `server/`, and the honest statement
 * is that this copy exists to be clicked through rather than to be trusted.
 *
 * Nothing leaves the browser and nothing survives a reload. That is deliberate:
 * a police records system on a public link with no multi-factor authentication
 * should not be able to accumulate anything, and a tester who types something
 * real into it has still typed it only into their own tab.
 */

import { seedState, DEMO_PASSWORD } from '@/state/seed';
import type { Incident } from '@/domain/types';
import type { MasterPerson, PersonIndex } from '@/domain/person';
import type { LocationIndex } from '@/domain/location';
import type { VehicleIndex } from '@/domain/vehicle';
import type { Trespass } from '@/domain/trespass';
import type { Warrant } from '@/domain/warrant';
import type { FieldContact } from '@/domain/fieldContact';
import type { Investigation } from '@/domain/investigation';
import type { Citation } from '@/domain/citation';
import type { AgencyProfile } from '@/domain/agency';
import type { User } from '@/domain/auth';
import type { AuditEntry, AuditDraft } from '@/domain/audit';
import { sealEntry } from '@/domain/audit';
import type { Supplement } from '@/domain/supplement';
import type { TrafficStop } from '@/domain/activity';
import type { CrashReport } from '@/domain/crash';
import type { QueryReturn } from '@/domain/inbound';
import type { Arrest } from '@/domain/arrest';
import type { CaseTask } from '@/domain/caseTask';
import type { PersonPhoto } from '@/domain/photo';
import type { Cruiser, CruiserCheck, MaintenanceRequest } from '@/domain/fleet';
import type { DisposalOrder } from '@/domain/retention';
import type { CustodyEntry, EvidenceItem } from '@/domain/evidence';

export interface Attachment {
  id: string;
  incidentId: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  caption: string;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: string;
  retractedAt: string;
  retractedBy: string;
  retractionReason: string;
}

export interface Seal {
  subjectId: string;
  scope: string;
  orderRef: string;
  sealedAt: string;
  sealedBy: string;
}

export interface DemoState {
  incidents: Incident[];
  supplements: Supplement[];
  crashes: CrashReport[];
  stops: TrafficStop[];
  returns: QueryReturn[];
  arrests: Arrest[];
  caseTasks: CaseTask[];
  photos: PersonPhoto[];
  evidence: EvidenceItem[];
  custody: Record<string, CustodyEntry[]>;
  cruisers: Cruiser[];
  cruiserChecks: CruiserCheck[];
  maintenance: MaintenanceRequest[];
  orders: DisposalOrder[];
  seals: Seal[];
  attachments: Attachment[];
  /** Uploaded bytes, as data URLs, so an <img> can point straight at them. */
  files: Record<string, string>;
  people: PersonIndex;
  locations: LocationIndex;
  vehicles: VehicleIndex;
  trespasses: Trespass[];
  warrants: Warrant[];
  contacts: FieldContact[];
  investigations: Investigation[];
  citations: Citation[];
  agency: AgencyProfile;
  users: User[];
  auditLog: AuditEntry[];
  /** Who is signed in. The demo lets a tester become somebody else. */
  currentUserId: string;
  locks: Record<string, { userId: string; userName: string; acquiredAt: string }>;
}

let state: DemoState = fresh();

/*
  Exposed so `lib/assetUrl` can resolve a file synchronously while rendering.
  An <img src> cannot await, and threading an async lookup through every
  component that shows a photograph would change the real app to suit the demo.
*/
function publishFiles(s: DemoState): void {
  (globalThis as { __demoFiles?: Record<string, string> }).__demoFiles = s.files;
}
publishFiles(state);

export function fresh(): DemoState {
  const seed = seedState();
  /*
    A second administrator, which the shipped seed does not have.

    Destroying records needs two people who both hold the authority, and with
    one administrator a tester would hit "somebody else has to carry this out"
    and have nobody to switch to — they would see the rule refuse them and
    never see it work.
  */
  const users = [
    ...seed.users,
    {
      ...seed.users.find((u) => u.role === 'admin')!,
      id: 'u-iyer',
      username: 'kiyer',
      name: 'K. Iyer',
      badge: '2210',
    },
  ];
  return {
    incidents: seed.incidents,
    supplements: [],
    crashes: [],
    stops: seed.stops,
    returns: seed.returns,
    arrests: [],
    caseTasks: [],
    photos: [],
    evidence: [],
    custody: {},
    cruisers: [],
    cruiserChecks: [],
    maintenance: [],
    orders: [],
    seals: [],
    attachments: [],
    files: {},
    people: seed.people,
    locations: seed.locations,
    vehicles: seed.vehicles,
    trespasses: seed.trespasses,
    warrants: seed.warrants,
    contacts: seed.contacts,
    investigations: [],
    citations: seed.citations,
    agency: seed.agency,
    users,
    auditLog: [],
    currentUserId: seed.users[0]?.id ?? '',
    locks: {},
  };
}

/**
 * A little history, so the audit log is not empty on arrival.
 *
 * Entries that name the seeded cases, which is what makes the interesting
 * thing visible: expunge one of those cases and the log reports entries
 * destroyed under the order while still verifying. An empty log would show a
 * green tick and none of the argument.
 */
export async function seedHistory(): Promise<void> {
  if (state.auditLog.length > 0) return;
  const [first, second, third] = state.users;
  const cases = state.incidents.map((i) => i.caseNumber);
  const history: (AuditDraft & { actor: typeof first })[] = [
    { actor: first, action: 'report.submitted', target: cases[1] ?? '', detail: '' },
    { actor: second ?? first, action: 'note.restrictedViewed', target: 'Marion Street Self Storage', detail: 'Gate code' },
    { actor: third ?? first, action: 'report.approved', target: cases[2] ?? '', detail: 'Approved.' },
    { actor: first, action: 'narrative.read', target: cases[1] ?? '', detail: 'Sent for reading' },
    { actor: third ?? first, action: 'attachment.viewed', target: 'scene-01.jpg', detail: cases[2] ?? '' },
  ].map((h) => h as never);

  for (const item of history) {
    const h = item as unknown as { actor: { id: string; name: string }; action: AuditEntry['action']; target: string; detail: string };
    await audit({ actorId: h.actor.id, actorName: h.actor.name, action: h.action, target: h.target, detail: h.detail });
  }
}

export const db = (): DemoState => state;
export const reset = (): void => {
  state = fresh();
  publishFiles(state);
};

export type { AuditDraft };

export const currentUser = (): User =>
  state.users.find((u) => u.id === state.currentUserId) ?? state.users[0];

export const password = DEMO_PASSWORD;

let counter = 0;
export const newId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${(counter += 1).toString(36)}`;

/**
 * Appends to the audit chain, sealed exactly as the server seals it.
 *
 * Worth doing properly rather than faking: the chain and its verification are
 * one of the things a tester is here to look at, and a demo that showed a
 * green tick without computing the hashes would be showing them nothing.
 */
export async function audit(draft: AuditDraft): Promise<void> {
  const log = state.auditLog;
  const entry = await sealEntry({
    ...draft,
    id: newId('aud'),
    at: new Date().toISOString(),
    prevHash: log.length > 0 ? log[log.length - 1].hash : '',
  });
  log.push(entry);
}

/** The people index as an array, which several routes want. */
export const peopleList = (): MasterPerson[] => Object.values(state.people);
