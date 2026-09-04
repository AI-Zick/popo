/**
 * API client.
 *
 * The session lives in an httpOnly cookie, so there is no token to attach and
 * nothing for this module to hold. `credentials: 'same-origin'` is what carries
 * it; the browser will not hand it to any other origin.
 */

import type { Incident } from '@/domain/types';
import type { Supplement } from '@/domain/supplement';
import type { TrafficStop } from '@/domain/activity';
import type { CrashReport } from '@/domain/crash';
import type { Arrest, Problem as ArrestProblem } from '@/domain/arrest';
import type { CaseTask } from '@/domain/caseTask';
import type { PersonPhoto } from '@/domain/photo';
import type { Certificate, DisposalOrder, ManifestLine, Problem as OrderProblem } from '@/domain/retention';
import type {
  Cruiser,
  CruiserCheck,
  MaintenanceRequest,
  Problem as FleetProblem,
} from '@/domain/fleet';
import type { QueryReturn } from '@/domain/inbound';
import type { PersonIndex } from '@/domain/person';
import type { LocationIndex, MasterLocation } from '@/domain/location';
import type { MasterVehicle, VehicleIndex } from '@/domain/vehicle';
import type { VehicleMatchResult, VehicleQuery } from '@/domain/vehicleMatching';
import type { Trespass, TrespassState } from '@/domain/trespass';
import type { ServiceAttempt, Warrant, WarrantState } from '@/domain/warrant';
import type { FieldContact } from '@/domain/fieldContact';
import type { Investigation, LimitationStanding, InvestigationStatus, ReviewDecision } from '@/domain/investigation';
import type { Citation } from '@/domain/citation';
import type { AddressCandidate, GisSource } from '@/domain/gis';
import type { Proposal } from '@/domain/redaction';
import type {
  AttachmentDecision,
  Blocker,
  DecidedSpan,
  ItemReview,
  Outcome,
  PublicRecordsPolicy,
  PublicRequest,
  ReleasedRecord,
  Requester,
  ResponsiveItem,
  Stage,
  Standing,
} from '@/domain/publicRecords';
import type { AgencyProfile } from '@/domain/agency';
import type { User } from '@/domain/auth';
import type { AuditEntry, ChainStatus } from '@/domain/audit';
import type { Feedback, FeedbackDraft } from '@/domain/feedback';
import type {
  CustodyEntry,
  CustodyState,
  EvidenceItem,
  Finding as EvidenceFinding,
} from '@/domain/evidence';
import type { ChainStatus as CustodyStatus } from '@/domain/chain';

/** An investigation with everything derived from it, worked out server-side. */
export interface CaseWork {
  investigation: Investigation;
  status: InvestigationStatus;
  score: number;
  reviewDue: string;
  reviewOverdueBy: number;
  limitation: LimitationStanding;
  /** True for the offences this agency works whatever the checklist says. */
  mustBeWorked: boolean;
  caseNumber: string;
}

/** One warrant, with the state worked out on the server. */
export interface WarrantRow {
  warrant: Warrant;
  state: WarrantState;
}

export interface WarrantPage {
  rows: (WarrantRow & {
    person: { id: string; name: string; dob: string; cautions: string[] } | null;
  })[];
  total: number;
  /** Outstanding across the agency, whatever is currently being looked at. */
  outstanding: number;
  limit: number;
  offset: number;
  notice: string;
}

export interface ContactList {
  contacts: FieldContact[];
  /** How many this reader is not being shown. Absent on the officer's own list. */
  hidden?: number;
  retentionYears: number;
  notice: string;
}

/** One notice on a person's record, with the place it names. */
export interface TrespassRow {
  trespass: Trespass;
  location: MasterLocation | null;
  state: TrespassState;
}

/** One row of a place's list — a notice and just enough of the person. */
export interface TrespassPageRow {
  trespass: Trespass;
  person: { id: string; name: string; dob: string; cautions: string[] } | null;
  state: TrespassState;
}

export interface TrespassPage {
  rows: TrespassPageRow[];
  /** Matching the current filter and search. */
  total: number;
  /** In force at this place, whatever is currently being looked at. */
  active: number;
  limit: number;
  offset: number;
}

export interface TrespassDraft {
  personId: string;
  locationId: string;
  servedOn: string;
  /** Blank means indefinite. */
  expiresOn: string;
  requestedBy: string;
  requestedByPhone: string;
  caseNumber: string;
  notes: string;
  source: 'officer' | 'dispatch';
}

/** An item plus everything a list needs, computed on the server. */
export interface PublicRequestRow {
  request: PublicRequest;
  standing: Standing;
  stage: Stage;
}

export interface PublicRequestPage {
  requests: PublicRequestRow[];
  total: number;
  limit: number;
  offset: number;
  policy: PublicRecordsPolicy;
}

/** What the review screen is drawn from: the record, and what was found in it. */
export interface ProposalView {
  item: ResponsiveItem;
  label: string;
  fields: Record<string, string>;
  proposal: Proposal;
  review: ItemReview | null;
  blockers: Blocker[];
}

export interface ReleaseBundle {
  id: string;
  requestId: string;
  requestNumber: string;
  releasedAt: string;
  releasedBy: string;
  releasedByName: string;
  outcome: Outcome;
  records: ReleasedRecord[];
}

export interface EvidenceSummary {
  item: EvidenceItem;
  state: CustodyState;
  entries: number;
  findings: EvidenceFinding[];
}

export interface EvidenceDetail extends EvidenceSummary {
  chain: CustodyEntry[];
  integrity: CustodyStatus;
}

export type Collection = 'incidents' | 'people' | 'locations';

export interface LockHolder {
  userId: string;
  userName: string;
  acquiredAt: string;
  refreshedAt: string;
}

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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /**
     * What the server actually sent back.
     *
     * Routes here have long returned more than a message — the `field` to put
     * the cursor in, and sometimes the record that caused the refusal, like
     * the citation already on file under a number somebody is trying to enter.
     * None of it could be read until this existed, so every caller could do
     * was print the sentence.
     */
    readonly body?: unknown,
  ) {
    super(message);
  }
}

/**
 * True in the published demo build, false in the real app.
 *
 * The one switch. Everything below it talks to an in-browser stand-in instead
 * of a server; nothing above it knows the difference, which is the point —
 * the screens a tester clicks are the screens, not a mock-up of them.
 */
export const DEMO = import.meta.env.VITE_DEMO === '1';

async function demoRequest<T>(path: string, init: RequestInit): Promise<T> {
  const { handle } = await import('@/state/demo/router');
  const body = init.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
  const reply = await handle(init.method ?? 'GET', path, body);
  if (reply.status >= 400) {
    throw new ApiError(
      (reply.body as { error?: string } | null)?.error ?? `Request failed (${reply.status}).`,
      reply.status,
      structuredClone(reply.body),
    );
  }
  /*
    Copied on the way out, because a real response always is.

    Without this the demo hands back the live arrays it is holding, and the
    client ends up sharing objects with the store behind it — a list the client
    appends to grows twice, once from its own update and once because the array
    it copied was the same array. Serialising is not a formality of HTTP; it is
    the boundary, and the demo has to have it too.
  */
  return structuredClone(reply.body) as T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (DEMO) return demoRequest<T>(path, init);
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
      ...init,
    });
  } catch {
    // A dead server should read as a dead server, not as a mystery.
    throw new ApiError('Cannot reach the server. Check that the API is running.', 0);
  }

  if (response.status === 204) return undefined as T;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      (body as { error?: string } | null)?.error ?? `Request failed (${response.status}).`;
    throw new ApiError(message, response.status, body);
  }

  return body as T;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

/** Where a sign-in has got to, as the server sees it. */
export interface SecondFactor {
  /** This session is not finished until a code is presented. */
  required: boolean;
  /** Whether there is an authenticator to present one from. */
  enrolled: boolean;
  recoveryRemaining: number;
}

export interface Identity {
  user: User;
  mustChangePassword: boolean;
  secondFactor?: SecondFactor;
}

export const api = {
  /** Resolves the signed-in user, or null when there is no valid session. */
  async me(): Promise<Identity | null> {
    try {
      return await request<Identity>('/api/auth/me');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },

  signIn(username: string, password: string): Promise<Identity> {
    return request<Identity>('/api/auth/sign-in', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  /* ---- The second factor --------------------------------------------- */

  mfaStatus(): Promise<{
    enrolled: boolean;
    pending: boolean;
    confirmedAt: string;
    recoveryRemaining: number;
    required: boolean;
  }> {
    return request('/api/auth/mfa');
  },

  beginMfa(): Promise<{ secret: string; uri: string }> {
    return request('/api/auth/mfa/begin', { method: 'POST' });
  },

  confirmMfa(code: string): Promise<{ recoveryCodes: string[] }> {
    return request('/api/auth/mfa/confirm', { method: 'POST', body: JSON.stringify({ code }) });
  },

  verifyMfa(code: string): Promise<{ ok: true; user: User }> {
    return request('/api/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ code }) });
  },

  useRecoveryCode(code: string): Promise<{ ok: true; user: User; recoveryRemaining: number }> {
    return request('/api/auth/mfa/recovery', { method: 'POST', body: JSON.stringify({ code }) });
  },

  resetMfa(userId: string, reason: string): Promise<{ ok: true }> {
    return request(`/api/users/${userId}/mfa/reset`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  /** Whether the model-backed narrative read is switched on for this install. */
  extractionStatus(): Promise<{ enabled: boolean; reason: string }> {
    return request('/api/extract/status');
  },

  /**
   * Sends a narrative to be read by the model.
   *
   * Only reached when the officer asks for it and the agency has turned it on
   * — the offline extractor covers everything else.
   */
  readNarrative(input: {
    narrative: string;
    context: string;
    caseNumber: string;
  }): Promise<{ findings: unknown[]; refused?: boolean }> {
    return request('/api/extract', { method: 'POST', body: JSON.stringify(input) });
  },

  /* ---- Migration ---------------------------------------------------- */

  commitImport(
    kind: 'people' | 'locations',
    rows: { values: Record<string, string> }[],
  ): Promise<{ created: number }> {
    return request('/api/migration/commit', {
      method: 'POST',
      body: JSON.stringify({ kind, rows }),
    });
  },

  /* ---- Property and evidence ---------------------------------------- */

  evidence(): Promise<{ evidence: EvidenceSummary[] }> {
    return request('/api/evidence');
  },

  evidenceItem(id: string): Promise<EvidenceDetail> {
    return request(`/api/evidence/${id}`);
  },

  bookEvidence(input: Record<string, string>): Promise<{
    item: EvidenceItem;
    chain: CustodyEntry[];
    state: CustodyState;
  }> {
    return request('/api/evidence', { method: 'POST', body: JSON.stringify(input) });
  },

  recordCustody(
    id: string,
    input: Record<string, string>,
  ): Promise<{ entry: CustodyEntry; chain: CustodyEntry[]; state: CustodyState }> {
    return request(`/api/evidence/${id}/custody`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updateEvidence(id: string, patch: Partial<EvidenceItem>): Promise<{ item: EvidenceItem }> {
    return request(`/api/evidence/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },

  witnesses(): Promise<{ witnesses: { id: string; name: string; badge: string }[] }> {
    return request('/api/evidence/meta/witnesses');
  },

  /* ---- Arrests ------------------------------------------------------ */

  createArrest(input: {
    caseId?: string;
    masterId?: string;
    arrestedAt?: string;
  }): Promise<{ arrest: Arrest }> {
    return request('/api/arrests', { method: 'POST', body: JSON.stringify(input) });
  },

  saveArrest(id: string, patch: Partial<Arrest>): Promise<{ arrest: Arrest; problems: ArrestProblem[] }> {
    return request(`/api/arrests/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
  },

  arrestAction(
    id: string,
    action: 'submit' | 'approve' | 'return' | 'reopen',
    body: Record<string, unknown> = {},
  ): Promise<{ arrest: Arrest; problems: ArrestProblem[] }> {
    return request(`/api/arrests/${id}/${action}`, { method: 'POST', body: JSON.stringify(body) });
  },

  /* ---- Case to-do list ---------------------------------------------- */

  addTask(
    caseId: string,
    input: { text: string; assignedToId?: string; dueOn?: string },
  ): Promise<{ task: CaseTask }> {
    return request(`/api/cases/${caseId}/tasks`, { method: 'POST', body: JSON.stringify(input) });
  },

  updateTask(id: string, patch: Partial<CaseTask>): Promise<{ task: CaseTask }> {
    return request(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },

  removeTask(id: string): Promise<{ ok: true }> {
    return request(`/api/tasks/${id}`, { method: 'DELETE' });
  },

  /* ---- Photographs of a person --------------------------------------- */

  async addPhoto(
    masterId: string,
    file: File,
    details: { takenOn: string; kind: string; caption: string },
  ): Promise<{ photo: PersonPhoto }> {
    if (DEMO) {
      const { addPhoto } = await import('@/state/demo/uploads');
      return { photo: await addPhoto(masterId, file, details) };
    }
    const form = new FormData();
    form.append('file', file);
    form.append('takenOn', details.takenOn);
    form.append('kind', details.kind);
    form.append('caption', details.caption);
    // No Content-Type header — the browser sets the multipart boundary.
    const response = await fetch(`/api/people/${masterId}/photos`, {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(
        (body as { error?: string } | null)?.error ?? 'The photograph was not accepted.',
        response.status,
      );
    }
    return body as { photo: PersonPhoto };
  },

  requestPhotoRemoval(id: string, reason: string): Promise<{ photo: PersonPhoto }> {
    return request(`/api/photos/${id}/request-removal`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  decidePhoto(id: string, remove: boolean, note: string): Promise<{ photo: PersonPhoto }> {
    return request(`/api/photos/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ remove, note }),
    });
  },

  /* ---- The fleet ------------------------------------------------------ */

  fleet(): Promise<{
    cruisers: Cruiser[];
    checks: CruiserCheck[];
    requests: MaintenanceRequest[];
  }> {
    return request('/api/fleet');
  },

  addCruiser(input: Partial<Cruiser>): Promise<{ cruiser: Cruiser }> {
    return request('/api/fleet/cruisers', { method: 'POST', body: JSON.stringify(input) });
  },

  updateCruiser(id: string, patch: Partial<Cruiser>): Promise<{ cruiser: Cruiser }> {
    return request(`/api/fleet/cruisers/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },

  fileCheck(input: {
    cruiserId: string;
    shift: string;
    odometer: string;
    notes: string;
    items: { itemId: string; result: string; note: string }[];
  }): Promise<{
    check: CruiserCheck;
    requests: MaintenanceRequest[];
    offRoad: boolean;
    problems?: FleetProblem[];
  }> {
    return request('/api/fleet/checks', { method: 'POST', body: JSON.stringify(input) });
  },

  reportFault(input: {
    cruiserId: string;
    problem: string;
    urgency: string;
    odometer: string;
  }): Promise<{ request: MaintenanceRequest; offRoad: boolean }> {
    return request('/api/fleet/requests', { method: 'POST', body: JSON.stringify(input) });
  },

  moveRequest(
    id: string,
    input: { status: string; note?: string; assignedTo?: string },
  ): Promise<{ request: MaintenanceRequest; backOnRoad: boolean }> {
    return request(`/api/fleet/requests/${id}/status`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  /* ---- Retention, sealing and destruction ----------------------------- */

  retention(): Promise<{
    orders: DisposalOrder[];
    seals: { subjectId: string; scope: string; orderRef: string; sealedAt: string; sealedBy: string }[];
  }> {
    return request('/api/retention');
  },

  createOrder(input: {
    kind: string;
    scope: string;
    subjectId: string;
    court: string;
    docket: string;
    orderedOn: string;
    instruction: string;
  }): Promise<{ order: DisposalOrder; problems: OrderProblem[] }> {
    return request('/api/retention/orders', { method: 'POST', body: JSON.stringify(input) });
  },

  previewOrder(
    id: string,
  ): Promise<{
    lines: ManifestLine[];
    auditEntries: number;
    gaps: string[];
    problems: OrderProblem[];
  }> {
    return request(`/api/retention/orders/${id}/preview`);
  },

  proposeOrder(id: string): Promise<{ order: DisposalOrder; problems?: OrderProblem[] }> {
    return request(`/api/retention/orders/${id}/propose`, { method: 'POST' });
  },

  executeOrder(id: string): Promise<{ order: DisposalOrder; certificate: Certificate | null }> {
    return request(`/api/retention/orders/${id}/execute`, { method: 'POST' });
  },

  withdrawOrder(id: string, reason: string): Promise<{ order: DisposalOrder }> {
    return request(`/api/retention/orders/${id}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  openSealed(
    subjectId: string,
    reason: string,
  ): Promise<{ incident: unknown; person: unknown; supplements: unknown[]; arrests: unknown[] }> {
    return request(
      `/api/retention/sealed/${subjectId}?reason=${encodeURIComponent(reason)}`,
    );
  },

  /* ---- Feedback ----------------------------------------------------- */

  feedback(): Promise<{ feedback: Feedback[]; forwarding: boolean }> {
    return request('/api/feedback');
  },

  sendFeedback(draft: FeedbackDraft): Promise<{ feedback: Feedback; redacted: number }> {
    return request('/api/feedback', { method: 'POST', body: JSON.stringify(draft) });
  },

  secondFeedback(id: string): Promise<{ feedback: Feedback }> {
    return request(`/api/feedback/${id}/second`, { method: 'POST' });
  },

  answerFeedback(
    id: string,
    patch: { status?: string; response?: string },
  ): Promise<{ feedback: Feedback }> {
    return request(`/api/feedback/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },

  forwardFeedback(id: string): Promise<{ feedback: Feedback; ok: boolean }> {
    return request(`/api/feedback/${id}/forward`, { method: 'POST' });
  },

  /* ---- Crash reports and inbound data ------------------------------ */

  createCrash(callNumber: string): Promise<{ crash: CrashReport; prefilled: boolean }> {
    return request('/api/crashes', { method: 'POST', body: JSON.stringify({ callNumber }) });
  },

  saveCrash(id: string, patch: Partial<CrashReport>): Promise<{ crash: CrashReport }> {
    return request(`/api/crashes/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
  },

  crashAction(
    id: string,
    action: 'submit' | 'approve' | 'return' | 'reopen',
    body: Record<string, unknown> = {},
  ): Promise<{ crash: CrashReport }> {
    return request(`/api/crashes/${id}/${action}`, { method: 'POST', body: JSON.stringify(body) });
  },

  /** The seam a CAD, MDT or query gateway posts to. */
  ingest(returns: unknown[]): Promise<{ returns: QueryReturn[] }> {
    return request('/api/inbound', { method: 'POST', body: JSON.stringify({ returns }) });
  },

  markReturnApplied(id: string, documentId: string): Promise<{ return: QueryReturn }> {
    return request(`/api/inbound/${id}/applied`, {
      method: 'POST',
      body: JSON.stringify({ documentId }),
    });
  },

  /* ---- Traffic stops ----------------------------------------------- */

  createStop(stop: Partial<TrafficStop>): Promise<{ stop: TrafficStop }> {
    return request('/api/stops', { method: 'POST', body: JSON.stringify(stop) });
  },

  saveStop(id: string, patch: Partial<TrafficStop>): Promise<{ stop: TrafficStop }> {
    return request(`/api/stops/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
  },

  deleteStop(id: string): Promise<{ ok: true }> {
    return request(`/api/stops/${id}`, { method: 'DELETE' });
  },

  /* ---- Supplements ------------------------------------------------- */

  createSupplement(caseId: string): Promise<{ supplement: Supplement }> {
    return request('/api/supplements', { method: 'POST', body: JSON.stringify({ caseId }) });
  },

  saveSupplement(id: string, patch: Partial<Supplement>): Promise<{ supplement: Supplement }> {
    return request(`/api/supplements/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
  },

  supplementAction(
    id: string,
    action: 'submit' | 'approve' | 'return' | 'reopen',
    body: Record<string, unknown> = {},
  ): Promise<{ supplement: Supplement; incident?: Incident }> {
    return request(`/api/supplements/${id}/${action}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  signOut(): Promise<{ ok: true }> {
    return request('/api/auth/sign-out', { method: 'POST' });
  },

  changePassword(current: string, next: string): Promise<{ ok: true }> {
    return request('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ current, next }),
    });
  },

  /* ---- Trespass notices ---------------------------------------------- */

  /**
   * Everywhere one person is barred from. Small enough to fetch whole.
   */
  personTrespasses(personId: string): Promise<{ trespasses: TrespassRow[] }> {
    return request(`/api/people/${personId}/trespasses`);
  },

  /**
   * Everybody barred from one place.
   *
   * Paged and searched on the server. A shopping centre can hold hundreds of
   * these, and the whole reason this is not part of the bulk payload is that
   * nobody should be paying for another place's list on every page load.
   */
  locationTrespasses(
    locationId: string,
    options: {
      q?: string;
      sort?: 'name' | 'served' | 'expires';
      dir?: 'asc' | 'desc';
      state?: 'active' | 'all';
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<TrespassPage> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const query = params.toString();
    return request(`/api/locations/${locationId}/trespasses${query ? `?${query}` : ''}`);
  },

  recordTrespass(draft: TrespassDraft): Promise<{ trespass: Trespass; renewalOf: Trespass | null }> {
    return request('/api/trespasses', { method: 'POST', body: JSON.stringify(draft) });
  },

  liftTrespass(id: string, reason: string): Promise<{ trespass: Trespass }> {
    return request(`/api/trespasses/${id}/lift`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  correctTrespass(id: string, patch: Partial<TrespassDraft>): Promise<{ trespass: Trespass }> {
    return request(`/api/trespasses/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },

  /* ---- Investigations --------------------------------------------------- */

  investigation(caseId: string): Promise<CaseWork> {
    return request(`/api/cases/${caseId}/investigation`);
  },

  caseload(scope: 'mine' | 'all' = 'mine'): Promise<{ investigations: CaseWork[] }> {
    return request(`/api/investigations?scope=${scope}`);
  },

  assignCase(caseId: string, detectiveId: string): Promise<CaseWork> {
    return request(`/api/cases/${caseId}/investigation/assign`, {
      method: 'POST',
      body: JSON.stringify({ detectiveId }),
    });
  },

  scoreCase(caseId: string, factors: Record<string, boolean>): Promise<CaseWork> {
    return request(`/api/cases/${caseId}/investigation/factors`, {
      method: 'POST',
      body: JSON.stringify({ factors }),
    });
  },

  suspendCase(caseId: string, reason: string): Promise<CaseWork & { advice: string }> {
    return request(`/api/cases/${caseId}/investigation/suspend`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  reviewCase(caseId: string, decision: ReviewDecision, note: string): Promise<CaseWork> {
    return request(`/api/cases/${caseId}/investigation/reviews`, {
      method: 'POST',
      body: JSON.stringify({ decision, note }),
    });
  },

  /* ---- Citations ---------------------------------------------------------- */

  personCitations(personId: string): Promise<{ citations: Citation[] }> {
    return request(`/api/people/${personId}/citations`);
  },

  stopCitations(stopId: string): Promise<{ citations: Citation[] }> {
    return request(`/api/stops/${stopId}/citations`);
  },

  citations(scope: 'mine' | 'all' = 'mine'): Promise<{ citations: Citation[]; awaitingCourt: number }> {
    return request(`/api/citations?scope=${scope}`);
  },

  /** Records a ticket the officer has already issued. */
  recordCitation(draft: Partial<Citation>): Promise<{ citation: Citation; advice: string }> {
    return request('/api/citations', { method: 'POST', body: JSON.stringify(draft) });
  },

  voidCitation(id: string, reason: string): Promise<{ citation: Citation }> {
    return request(`/api/citations/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  citationDisposition(id: string, disposition: string): Promise<{ citation: Citation }> {
    return request(`/api/citations/${id}/disposition`, {
      method: 'POST',
      body: JSON.stringify({ disposition }),
    });
  },

  /* ---- Public records -------------------------------------------------- */

  publicRequests(scope: 'open' | 'all' = 'open', offset = 0, limit = 50): Promise<PublicRequestPage> {
    return request(`/api/public-requests?scope=${scope}&offset=${offset}&limit=${limit}`);
  },

  publicRequest(id: string): Promise<PublicRequestRow & { policy: PublicRecordsPolicy; implied: Outcome; mayRelease: boolean }> {
    return request(`/api/public-requests/${id}`);
  },

  logPublicRequest(draft: {
    description: string;
    channel: string;
    receivedAt?: string;
    requester: Partial<Requester>;
  }): Promise<PublicRequestRow> {
    return request('/api/public-requests', { method: 'POST', body: JSON.stringify(draft) });
  },

  updatePublicRequest(id: string, patch: Record<string, unknown>): Promise<PublicRequestRow> {
    return request(`/api/public-requests/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },

  addPublicRequestNote(id: string, direction: 'in' | 'out', body: string): Promise<PublicRequestRow> {
    return request(`/api/public-requests/${id}/correspondence`, {
      method: 'POST',
      body: JSON.stringify({ direction, text: body }),
    });
  },

  pausePublicRequest(id: string, reason: 'clarification' | 'fee', note: string): Promise<PublicRequestRow> {
    return request(`/api/public-requests/${id}/pause`, {
      method: 'POST',
      body: JSON.stringify({ reason, note }),
    });
  },

  resumePublicRequest(id: string): Promise<PublicRequestRow> {
    return request(`/api/public-requests/${id}/resume`, { method: 'POST' });
  },

  extendPublicRequest(id: string, days: number, reason: string): Promise<PublicRequestRow> {
    return request(`/api/public-requests/${id}/extensions`, {
      method: 'POST',
      body: JSON.stringify({ days, reason }),
    });
  },

  attachPublicRecord(id: string, kind: string, recordId: string): Promise<PublicRequestRow> {
    return request(`/api/public-requests/${id}/items`, {
      method: 'POST',
      body: JSON.stringify({ kind, recordId }),
    });
  },

  detachPublicRecord(id: string, itemId: string): Promise<PublicRequestRow> {
    return request(`/api/public-requests/${id}/items/${itemId}`, { method: 'DELETE' });
  },

  redactionProposal(id: string, itemId: string): Promise<ProposalView> {
    return request(`/api/public-requests/${id}/items/${itemId}/proposal`);
  },

  saveRedactionReview(
    id: string,
    itemId: string,
    review: {
      spans: DecidedSpan[];
      answered: string[];
      attachments: AttachmentDecision[];
      readInFull: boolean;
      approve?: boolean;
    },
  ): Promise<PublicRequestRow & { blockers: Blocker[] }> {
    return request(`/api/public-requests/${id}/items/${itemId}/review`, {
      method: 'POST',
      body: JSON.stringify(review),
    });
  },

  redactionPreview(id: string, itemId: string): Promise<{ release: ReleasedRecord }> {
    return request(`/api/public-requests/${id}/items/${itemId}/preview`);
  },

  closePublicRequest(id: string, outcome: Outcome, reason: string): Promise<PublicRequestRow> {
    return request(`/api/public-requests/${id}/close`, {
      method: 'POST',
      body: JSON.stringify({ outcome, reason }),
    });
  },

  publicRelease(id: string): Promise<{ releases: ReleaseBundle[] }> {
    return request(`/api/public-requests/${id}/release`);
  },

  /* ---- County GIS ------------------------------------------------------ */

  /** Addresses from the county's layer, fetched by our server rather than here. */
  gisSearch(query: string): Promise<{
    candidates: AddressCandidate[];
    configured: boolean;
    attribution?: string;
  }> {
    return request(`/api/gis/search?q=${encodeURIComponent(query)}`);
  },

  /** Does this connection work, and what does the county call its fields? */
  testGis(source: GisSource): Promise<{
    ok: true;
    fields: string[];
    guess: GisSource['fields'];
    sample: AddressCandidate[];
    reached: boolean;
  }> {
    return request('/api/gis/test', { method: 'POST', body: JSON.stringify({ source }) });
  },

  /* ---- Warrants ------------------------------------------------------- */

  personWarrants(personId: string): Promise<{ warrants: WarrantRow[]; notice: string }> {
    return request(`/api/people/${personId}/warrants`);
  },

  /** The warrant clerk's screen. Paged, because this number only goes up. */
  warrants(
    options: { q?: string; state?: 'active' | 'all'; limit?: number; offset?: number } = {},
  ): Promise<WarrantPage> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const query = params.toString();
    return request(`/api/warrants${query ? `?${query}` : ''}`);
  },

  enterWarrant(draft: Partial<Warrant>): Promise<{
    warrant: Warrant;
    duplicateOf: Warrant | null;
    notice: string;
  }> {
    return request('/api/warrants', { method: 'POST', body: JSON.stringify(draft) });
  },

  attemptWarrant(
    id: string,
    attempt: Pick<ServiceAttempt, 'address' | 'outcome' | 'notes'>,
  ): Promise<{ warrant: Warrant }> {
    return request(`/api/warrants/${id}/attempts`, {
      method: 'POST',
      body: JSON.stringify(attempt),
    });
  },

  recallWarrant(id: string, reason: string): Promise<{ warrant: Warrant }> {
    return request(`/api/warrants/${id}/recall`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  /* ---- Field contacts -------------------------------------------------- */

  personContacts(personId: string): Promise<ContactList> {
    return request(`/api/people/${personId}/contacts`);
  },

  myContacts(scope: 'mine' | 'all' = 'mine'): Promise<ContactList> {
    return request(`/api/contacts?scope=${scope}`);
  },

  recordContact(draft: Partial<FieldContact>): Promise<{
    contact: FieldContact;
    advice: string;
    retentionYears: number;
  }> {
    return request('/api/contacts', { method: 'POST', body: JSON.stringify(draft) });
  },

  correctContact(
    id: string,
    patch: Partial<FieldContact>,
  ): Promise<{ contact: FieldContact; advice: string }> {
    return request(`/api/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },

  /* ---- The Master Vehicle Index -------------------------------------- */

  vehicle(id: string): Promise<{ vehicle: MasterVehicle; registeredOwner: unknown }> {
    return request(`/api/vehicles/${id}`);
  },

  /** What this vehicle might already be. Reads only; decides nothing. */
  resolveVehicle(query: VehicleQuery): Promise<{
    matches: VehicleMatchResult[];
    autoLink: VehicleMatchResult | null;
    vin: { ok: boolean; reason: string; expected: string };
  }> {
    return request('/api/vehicles/resolve', { method: 'POST', body: JSON.stringify(query) });
  },

  addVehicle(
    draft: VehicleQuery & { registeredOwnerId?: string; notes?: string; forceNew?: boolean },
  ): Promise<{
    vehicle: MasterVehicle;
    linkedToExisting: boolean;
    reasons?: string[];
    nearMatches?: VehicleMatchResult[];
    vin: { ok: boolean; reason: string; expected: string };
  }> {
    return request('/api/vehicles', { method: 'POST', body: JSON.stringify(draft) });
  },

  updateVehicle(
    id: string,
    patch: Partial<MasterVehicle>,
  ): Promise<{ vehicle: MasterVehicle; vin: { ok: boolean; reason: string; expected: string } }> {
    return request(`/api/vehicles/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },

  /* ---- State ------------------------------------------------------- */

  state(): Promise<{
    incidents: Incident[];
    supplements: Supplement[];
    stops: TrafficStop[];
    crashes: CrashReport[];
    returns: QueryReturn[];
    arrests: Arrest[];
    caseTasks: CaseTask[];
    photos: PersonPhoto[];
    seals: { subjectId: string; scope: string; orderRef: string; sealedAt: string; sealedBy: string }[];
    people: PersonIndex;
    locations: LocationIndex;
    vehicles: VehicleIndex;
    wanted: Record<string, { count: number; national: boolean }>;
    agency: AgencyProfile | null;
    users: User[];
    auditLog: AuditEntry[];
    versions: Record<string, number>;
    locks: Record<string, LockHolder>;
    attachments: Attachment[];
  }> {
    return request('/api/state');
  },

  /**
   * Writes one record, carrying the version the client last saw. A 409 means
   * somebody else saved first — the error carries their version of the record.
   */
  putRecord(
    collection: Collection,
    id: string,
    doc: unknown,
    version: number | null,
  ): Promise<{ ok: true; version: number }> {
    return request(`/api/records/${collection}/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ doc, version }),
    });
  },

  deleteRecord(collection: Collection, id: string) {
    return request<{ ok: true }>(`/api/records/${collection}/${id}`, { method: 'DELETE' });
  },

  /* ---- Edit locks -------------------------------------------------- */

  locks(): Promise<{ locks: Record<string, LockHolder> }> {
    return request('/api/locks');
  },

  acquireLock(id: string, takeover = false): Promise<{ ok: true; tookOver: boolean }> {
    return request(`/api/locks/${id}`, { method: 'POST', body: JSON.stringify({ takeover }) });
  },

  releaseLock(id: string) {
    return request<{ ok: true }>(`/api/locks/${id}`, { method: 'DELETE' });
  },

  /* ---- Attachments -------------------------------------------------- */

  attachments(incidentId?: string): Promise<{ attachments: Attachment[] }> {
    const query = incidentId ? `?incident=${encodeURIComponent(incidentId)}` : '';
    return request(`/api/attachments${query}`);
  },

  async uploadAttachment(
    incidentId: string,
    file: File,
    caption: string,
  ): Promise<{ attachment: Attachment }> {
    if (DEMO) {
      const { addAttachment } = await import('@/state/demo/uploads');
      return { attachment: (await addAttachment(incidentId, file, caption)) as Attachment };
    }
    const form = new FormData();
    form.append('file', file);
    form.append('incidentId', incidentId);
    form.append('caption', caption);
    // No Content-Type header — the browser sets the multipart boundary.
    const response = await fetch('/api/attachments', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(
        (body as { error?: string } | null)?.error ?? 'Upload failed.',
        response.status,
      );
    }
    return body as { attachment: Attachment };
  },

  verifyAttachment(id: string): Promise<{ intact: boolean; sha256: string }> {
    return request(`/api/attachments/${id}/verify`);
  },

  retractAttachment(id: string, reason: string) {
    return request<{ ok: true }>(`/api/attachments/${id}/retract`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  /* ---- Review ------------------------------------------------------- */

  submitReport(id: string): Promise<{ report: Incident }> {
    return request(`/api/reports/${id}/submit`, { method: 'POST' });
  },

  /** The officer takes it back, before anybody has acted on it. */
  recallReport(id: string): Promise<{ report: Incident }> {
    return request(`/api/reports/${id}/recall`, { method: 'POST' });
  },

  /** Passes the report to another officer to finish. */
  handOffReport(id: string, toId: string): Promise<{ report: Incident }> {
    return request(`/api/reports/${id}/hand-off`, {
      method: 'POST',
      body: JSON.stringify({ toId }),
    });
  },

  approveReport(id: string, note = ''): Promise<{ report: Incident }> {
    return request(`/api/reports/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
  },

  returnReport(
    id: string,
    reason: string,
    comments: { path: string; section: string; message: string }[],
  ): Promise<{ report: Incident }> {
    return request(`/api/reports/${id}/return`, {
      method: 'POST',
      body: JSON.stringify({ reason, comments }),
    });
  },

  reopenReport(id: string, reason: string): Promise<{ report: Incident }> {
    return request(`/api/reports/${id}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  resolveComment(id: string, commentId: string): Promise<{ report: Incident }> {
    return request(`/api/reports/${id}/comments/${commentId}/resolve`, { method: 'POST' });
  },

  putAgency(agency: AgencyProfile) {
    return request<{ ok: true }>('/api/agency', {
      method: 'PUT',
      body: JSON.stringify({ agency }),
    });
  },

  /* ---- Accounts ---------------------------------------------------- */

  createUser(input: Partial<User>): Promise<{ user: User; temporaryPassword: string }> {
    return request('/api/users', { method: 'POST', body: JSON.stringify(input) });
  },

  deactivateUser(id: string) {
    return request<{ ok: true }>(`/api/users/${id}/deactivate`, { method: 'POST' });
  },

  reactivateUser(id: string) {
    return request<{ ok: true }>(`/api/users/${id}/reactivate`, { method: 'POST' });
  },

  /* ---- Audit ------------------------------------------------------- */

  /**
   * Reports an action the client observed. The actor is taken from the session
   * server-side; anything sent here about who did it would be ignored.
   */
  record(action: string, target = '', detail = ''): Promise<{ ok: true }> {
    return request('/api/audit', {
      method: 'POST',
      body: JSON.stringify({ action, target, detail }),
    });
  },

  auditLog(): Promise<{ entries: AuditEntry[] }> {
    return request('/api/audit');
  },

  verifyAudit(): Promise<ChainStatus> {
    return request('/api/audit/verify');
  },
};
