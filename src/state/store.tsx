import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Incident, SectionId } from '@/domain/types';
import {
  displayName,
  resolvePeople,
  type FieldSource,
  type IncidentPerson,
  type MasterPerson,
  type Person,
  type PersonIndex,
  type PersonRole,
  type ProvenancedField,
} from '@/domain/person';
import { PROVENANCED_FIELDS } from '@/domain/person';
import {
  attachNewPerson,
  createIncident,
  createIncidentPerson,
  createLocation,
  createMasterPerson,
  createNote,
  newCaseNumber,
} from '@/domain/factory';
import { newId } from '@/lib/id';
import { autoLinkCandidate, findMatches, type MatchResult } from '@/domain/matching';
import { emptyAgency, type AgencyProfile } from '@/domain/agency';
import {
  can as canDo,
  canManageUser,
  createUser,
  sanitizeUserInput,
  type GuardResult,
  type Permission,
  type User,
} from '@/domain/auth';
import { centerOf, featureAt, featureName } from '@/domain/geo';
import {
  activeNotes,
  type LocationIndex,
  type MasterLocation,
  type NoteKind,
  type PremiseNote,
} from '@/domain/location';
import {
  autoLinkLocation,
  findLocations,
  findNearby,
  searchLocations as searchLocationIndex,
  type LocationMatch,
} from '@/domain/locationMatching';
import { createSession, touchSession, type Session, type SignInOutcome } from '@/domain/session';
import { isEditable, unresolvedComments } from '@/domain/review';
import type { AuditDraft, AuditEntry, ChainStatus } from '@/domain/audit';
import type { Feedback, FeedbackDraft, FeedbackStatus } from '@/domain/feedback';
import type { EvidenceItem } from '@/domain/evidence';
import {
  api,
  ApiError,
  type Attachment,
  type Collection,
  type EvidenceDetail,
  type EvidenceSummary,
  type LockHolder,
} from './api';
import { runRules, type Issue, type ValidationResult } from '@/validation/engine';
import { ALL_RULES } from '@/validation/rules';
import { profileFor, stateRules } from '@/domain/nibrs';
import type { TrafficStop } from '@/domain/activity';
import {
  checkCrash,
  createOccupant,
  createUnit,
  nextUnitNumber,
  type CrashProblem,
  type CrashReport,
  type CrashUnit,
} from '@/domain/crash';
import {
  requestQueue,
  type Cruiser,
  type CruiserCheck,
  type MaintenanceRequest,
} from '@/domain/fleet';
import {
  currentPhoto,
  pendingRemovals,
  photosFor,
  type PersonPhoto,
} from '@/domain/photo';
import {
  describeTasks,
  sortTasks,
  type CaseTask,
} from '@/domain/caseTask';
import {
  checkArrest,
  createCharge as createArrestCharge,
  type Arrest,
  type ArrestCharge,
  type Problem as ArrestProblem,
} from '@/domain/arrest';
import {
  ownerFromRegistration,
  personFromLicense,
  recentReturns,
  returnsForCall,
  vehicleFromRegistration,
  type QueryReturn,
} from '@/domain/inbound';
import {
  canSupplement,
  checkSupplement,
  supplementsFor,
  type Supplement,
  type SupplementProblem,
} from '@/domain/supplement';
import {
  applySuggestion,
  mergeFindings,
  readNarrative,
  type Finding,
  type Suggestion,
} from '@/domain/extraction';


type Mutator = (draft: Incident) => void;

/**
 * A suggestion the officer accepted, with what the report looked like before.
 *
 * Kept for the life of the editing session so that accepting stays a reversible
 * act. An officer who accepts the wrong thing should not have to work out by
 * hand which field changed and what it used to say.
 */
export interface AcceptedSuggestion {
  suggestion: Suggestion;
  /** The field it wrote, for "show me". */
  focusTarget: string | null;
  previousIncident: Incident;
  previousPeople: PersonIndex;
}

export interface AutoLinkNotice {
  incidentPersonId: string;
  previousMasterId: string;
  linkedMasterId: string;
  name: string;
}

interface StoreValue {
  incidents: Incident[];
  /** The Master Name Index — every person the agency knows about. */
  people: PersonIndex;
  /** Every place the agency has been, with the notes left on it. */
  locations: LocationIndex;
  /** Jurisdiction and boundary configuration, set once at install. */
  agency: AgencyProfile;
  /** Everyone with a login at this agency. */
  users: User[];
  /** Who is signed in. */
  currentUser: User;
  /** Permission check for the signed-in user. */
  can: (permission: Permission) => boolean;
  /** Null until someone signs in. Display only — the server owns the real one. */
  session: Session | null;
  isAuthenticated: boolean;
  /** True while the initial fetch is in flight. */
  loading: boolean;
  /** Set when another officer saved a record you were editing. */
  conflict: { id: string; message: string } | null;
  dismissConflict: () => void;
  /** Who is currently in which report. */
  locks: Record<string, LockHolder>;
  /** The holder of a lock on a record, when it is not you. */
  lockOn: (id: string) => LockHolder | null;
  takeOverLock: (id: string) => void;
  attachments: Attachment[];
  /** True when this report is the officer's to edit right now. */
  reportEditable: boolean;
  submitForReview: () => Promise<GuardResult>;
  approveReport: (note: string) => Promise<GuardResult>;
  returnReport: (
    reason: string,
    comments: { path: string; section: string; message: string }[],
  ) => Promise<GuardResult>;
  reopenReport: (reason: string) => Promise<GuardResult>;
  resolveReviewComment: (commentId: string) => void;
  uploadAttachment: (file: File, caption: string) => Promise<GuardResult>;
  retractAttachment: (id: string, reason: string) => Promise<GuardResult>;
  verifyAttachment: (id: string) => Promise<{ intact: boolean }>;
  /** Set when the API cannot be reached at all. */
  connectionError: string | null;
  mustChangePassword: boolean;
  auditLog: AuditEntry[];

  signIn: (username: string, password: string) => Promise<SignInOutcome>;
  signOut: () => void;
  changePassword: (current: string, next: string) => Promise<GuardResult>;
  /** Records an audit entry. Appends are serialised to keep the chain intact. */
  record: (draft: AuditDraft) => void;
  verifyAuditLog: () => Promise<ChainStatus>;
  /**
   * Creates an account and issues a temporary password, returned once so the
   * administrator can hand it over. The holder must change it at first sign-in.
   */
  createAccount: (input: Partial<User>) => Promise<GuardResult & { temporaryPassword?: string }>;
  updateUser: (userId: string, patch: Partial<User>) => GuardResult;
  deactivateUser: (userId: string) => Promise<GuardResult>;
  reactivateUser: (userId: string) => Promise<GuardResult>;
  incident: Incident | null;
  /** Participants on the active incident, joined to their identities. */
  persons: Person[];
  /** The place the active incident happened. */
  location: MasterLocation | null;
  validation: ValidationResult;
  activeSection: SectionId;
  visitedSections: Set<SectionId>;
  submitAttempted: boolean;
  revealedPaths: Set<string>;
  savedAt: string | null;
  autoLink: AutoLinkNotice | null;

  openIncident: (id: string) => void;
  closeIncident: () => void;
  createNew: () => void;
  deleteIncident: (id: string) => void;
  update: (mutator: Mutator) => void;
  setSection: (section: SectionId) => void;
  goToIssue: (issue: Issue) => void;
  applyQuickFix: (issue: Issue) => void;
  /**
   * What the narrative appears to say that the report does not.
   *
   * Suggestions only. Nothing here reaches a field without a click — a police
   * report is evidence, and a field the officer did not enter has no business
   * appearing over their badge number.
   */
  /* ---- Crash reports ----------------------------------------------- */
  crashes: CrashReport[];
  /** The crash report currently open, if any. */
  crash: CrashReport | null;
  crashProblems: CrashProblem[];
  openCrash: (id: string) => void;
  closeCrash: () => void;
  startCrash: (callNumber: string) => Promise<GuardResult>;
  updateCrash: (patch: Partial<CrashReport>) => void;
  updateUnit: (unitId: string, patch: Partial<CrashUnit>) => void;
  addUnit: () => void;
  removeUnit: (unitId: string) => void;
  submitCrash: () => Promise<GuardResult>;
  approveCrash: (note: string) => Promise<GuardResult>;
  returnCrash: (reason: string) => Promise<GuardResult>;
  reopenCrash: (reason: string) => Promise<GuardResult>;

  /* ---- Arrests ------------------------------------------------------ */
  arrests: Arrest[];
  /** The arrest currently open, if any. It takes the screen like a report. */
  arrest: Arrest | null;
  arrestProblems: ArrestProblem[];
  openArrest: (id: string) => void;
  closeArrest: () => void;
  /** Starts one, optionally against a case and a person already on it. */
  startArrest: (input: { caseId?: string; masterId?: string }) => Promise<GuardResult>;
  updateArrest: (patch: Partial<Arrest>) => void;
  addCharge: () => void;
  updateCharge: (chargeId: string, patch: Partial<ArrestCharge>) => void;
  removeCharge: (chargeId: string) => void;
  submitArrest: () => Promise<GuardResult>;
  approveArrest: (note: string) => Promise<GuardResult>;
  returnArrest: (reason: string) => Promise<GuardResult>;
  reopenArrest: (reason: string) => Promise<GuardResult>;
  /** Every arrest on one case, newest first. */
  arrestsForCase: (caseId: string) => Arrest[];

  /* ---- Case to-do list ---------------------------------------------- */
  /** Every case's items. Small enough to hold, and the dashboard counts them. */
  caseTasks: CaseTask[];
  /** One case's list, in reading order. */
  tasksForCase: (caseId: string) => CaseTask[];
  /** "3 to do · 1 overdue", or '' when there is nothing open. */
  taskSummary: (caseId: string) => string;
  addTask: (
    caseId: string,
    input: { text: string; assignedToId?: string; dueOn?: string },
  ) => Promise<GuardResult>;
  setTaskDone: (id: string, done: boolean) => Promise<GuardResult>;
  editTask: (id: string, patch: Partial<CaseTask>) => Promise<GuardResult>;
  removeTask: (id: string) => Promise<GuardResult>;

  /* ---- Photographs --------------------------------------------------- */
  photos: PersonPhoto[];
  /** Every photograph of one person, newest likeness first. */
  photosOf: (masterId: string) => PersonPhoto[];
  /** The one to put on the record, or null. */
  faceOf: (masterId: string) => PersonPhoto | null;
  /** Takedown requests waiting on somebody with the authority. */
  photoRequests: PersonPhoto[];
  addPhoto: (
    masterId: string,
    file: File,
    details: { takenOn: string; kind: string; caption: string },
  ) => Promise<GuardResult>;
  requestPhotoRemoval: (id: string, reason: string) => Promise<GuardResult>;
  decidePhoto: (id: string, remove: boolean, note: string) => Promise<GuardResult>;

  /* ---- The fleet ----------------------------------------------------- */
  cruisers: Cruiser[];
  cruiserChecks: CruiserCheck[];
  maintenanceRequests: MaintenanceRequest[];
  /** Open requests, worst first. What a fleet supervisor actually reads. */
  maintenanceQueue: MaintenanceRequest[];
  refreshFleet: () => Promise<void>;
  addCruiser: (input: Partial<Cruiser>) => Promise<GuardResult>;
  updateCruiser: (id: string, patch: Partial<Cruiser>) => Promise<GuardResult>;
  fileCheck: (input: {
    cruiserId: string;
    shift: string;
    odometer: string;
    notes: string;
    items: { itemId: string; result: string; note: string }[];
  }) => Promise<GuardResult & { offRoad?: boolean; raised?: number }>;
  reportFault: (input: {
    cruiserId: string;
    problem: string;
    urgency: string;
    odometer: string;
  }) => Promise<GuardResult & { offRoad?: boolean }>;
  moveRequest: (
    id: string,
    input: { status: string; note?: string; assignedTo?: string },
  ) => Promise<GuardResult & { backOnRoad?: boolean }>;

  /* ---- Inbound data ------------------------------------------------- */
  /** Everything CAD, the MDT and the registries have sent. */
  returns: QueryReturn[];
  /** The returns that belong to the open crash's scene. */
  sceneReturns: QueryReturn[];
  /** Applies a return to the open crash — a vehicle, a driver, an owner. */
  applyReturn: (returnId: string, as: 'unit' | 'driver' | 'owner' | 'occupant', unitId?: string) => void;
  /** Fills the crash's time and place from the dispatch call record. */
  applyCallDetails: (returnId: string) => void;

  /* ---- Activity ---------------------------------------------------- */
  /**
   * Traffic stops, agency-wide.
   *
   * Most stops produce no report, so without them an officer who spent the
   * night on traffic reads as having done nothing.
   */
  stops: TrafficStop[];
  logStop: (stop: Partial<TrafficStop>) => Promise<GuardResult>;
  saveStop: (id: string, patch: Partial<TrafficStop>) => Promise<GuardResult>;
  removeStop: (id: string) => Promise<GuardResult>;

  /* ---- Property and evidence --------------------------------------- */
  /**
   * Every item the property room holds, with where it is.
   *
   * The state and the findings are computed on the server from each item's
   * ledger, not here: three clients working out where a thing is from the same
   * entries would be three chances to disagree, and the one question this
   * module exists to answer is where a thing is.
   */
  evidence: EvidenceSummary[];
  bookEvidence: (input: Record<string, string>) => Promise<GuardResult & { tagNumber?: string }>;
  recordCustody: (id: string, input: Record<string, string>) => Promise<GuardResult>;
  updateEvidence: (id: string, patch: Partial<EvidenceItem>) => Promise<GuardResult>;
  /** One item's whole chain, fetched when somebody opens it. */
  loadEvidence: (id: string) => Promise<EvidenceDetail | null>;

  /* ---- Feedback ---------------------------------------------------- */
  /**
   * Everything anyone in this agency has sent the vendor.
   *
   * Visible to everybody on purpose: an officer about to report something sees
   * it has already been raised and seconds it instead of writing the fourth
   * description of one fault, and somebody who reported something sees the
   * answer. Nothing in it is criminal justice information — the captured
   * context is structural by construction.
   */
  feedback: Feedback[];
  /** Whether this install actually posts feedback onward, or only holds it. */
  feedbackForwarding: boolean;
  sendFeedback: (draft: FeedbackDraft) => Promise<GuardResult & { redacted?: number }>;
  secondFeedback: (id: string) => Promise<GuardResult>;
  answerFeedback: (
    id: string,
    patch: { status?: FeedbackStatus; response?: string },
  ) => Promise<GuardResult>;
  forwardFeedback: (id: string) => Promise<GuardResult>;

  /* ---- Supplements ------------------------------------------------- */
  /** Every supplement the agency has, across all cases. */
  supplements: Supplement[];
  /** Supplements on the report currently open, in order. */
  caseSupplements: Supplement[];
  /** The supplement being written or reviewed, when one is open. */
  supplement: Supplement | null;
  /** What still has to be true before the open supplement can go up. */
  supplementProblems: SupplementProblem[];
  /** Whether a supplement may be started against the open report. */
  canAddSupplement: { ok: boolean; reason?: string };
  openSupplement: (id: string) => void;
  closeSupplement: () => void;
  startSupplement: () => Promise<GuardResult>;
  updateSupplement: (patch: Partial<Supplement>) => void;
  submitSupplement: () => Promise<GuardResult>;
  approveSupplement: (note: string) => Promise<GuardResult>;
  returnSupplement: (reason: string) => Promise<GuardResult>;
  reopenSupplement: (reason: string) => Promise<GuardResult>;

  suggestions: Suggestion[];
  dismissedSuggestions: string[];
  /** Accepted this session, newest first, each still undoable. */
  acceptedSuggestions: AcceptedSuggestion[];
  acceptSuggestion: (suggestion: Suggestion) => void;
  dismissSuggestion: (id: string) => void;
  /** Takes the officer to the field an accepted suggestion changed. */
  showSuggestion: (id: string) => void;
  /** Puts the report back the way it was before a suggestion was accepted. */
  undoSuggestion: (id: string) => void;
  /** Puts dismissed suggestions back, for when the officer changes their mind. */
  resetSuggestions: () => void;
  /** Whether the model-backed pass is available, and why not when it is not. */
  extraction: { enabled: boolean; reason: string; busy: boolean; error: string | null };
  /** Asks the model to read the narrative, on top of the offline pass. */
  readWithModel: () => Promise<void>;
  revealField: (path: string) => void;
  attemptSubmit: () => boolean;
  registerField: (path: string, el: HTMLElement | null) => void;

  // Master Name Index
  addNewPerson: (role: PersonRole) => void;
  addExistingPerson: (masterId: string, role: PersonRole) => void;
  removePerson: (incidentPersonId: string) => void;
  updateInvolvement: (incidentPersonId: string, patch: Partial<IncidentPerson>) => void;
  updateIdentity: (masterId: string, patch: Partial<MasterPerson>, source?: FieldSource) => void;
  linkToMaster: (incidentPersonId: string, masterId: string) => void;
  undoAutoLink: () => void;
  dismissAutoLink: () => void;
  matchesFor: (incidentPersonId: string) => MatchResult[];
  searchPeople: (query: string, limit?: number) => MasterPerson[];
  /** Case numbers a person appears on, most recent first. */
  historyFor: (masterId: string) => { incident: Incident; role: PersonRole }[];

  // Location index
  setLocation: (locationId: string) => void;
  createAndSetLocation: (draft: Partial<MasterLocation>) => void;
  updateLocation: (locationId: string, patch: Partial<MasterLocation>) => void;
  addNote: (locationId: string, note: { kind: NoteKind; text: string; sensitive: boolean }) => void;
  updateNote: (locationId: string, noteId: string, patch: Partial<PremiseNote>) => void;
  /** Withdraws a note. Requires notes.retract; the note itself is kept. */
  retractNote: (locationId: string, noteId: string, reason: string) => void;
  /** Puts a withdrawn note back. */
  restoreNote: (locationId: string, noteId: string) => void;
  locationSearch: (
    query: string,
    limit?: number,
  ) => { location: MasterLocation; distance: number | null }[];
  /** Places within a radius of a point, nearest first. */
  nearbyLocations: (
    latitude: number,
    longitude: number,
    radiusMeters?: number,
  ) => { location: MasterLocation; distance: number }[];
  locationMatches: (query: { address?: string; commonName?: string; city?: string }) => LocationMatch[];
  notesFor: (locationId: string) => PremiseNote[];
  /** Reports previously taken at a location, most recent first. */
  locationHistory: (locationId: string) => Incident[];
  /** Sets a location's coordinates and re-derives its patrol area. */
  setLocationPoint: (locationId: string, lon: number, lat: number, source?: 'pin' | 'typed') => void;
  /** The patrol area a point falls in, or '' when outside every zone. */
  zoneAt: (lon: number, lat: number) => string;
  /** False when the point sits outside the configured jurisdiction. */
  insideJurisdiction: (lon: number, lat: number) => boolean;
  updateAgency: (patch: Partial<AgencyProfile>) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

const EMPTY_VALIDATION = runRules(createIncident(), []);
const NO_PERSONS: Person[] = [];

/**
 * Why a call failed, in words worth showing somebody.
 *
 * The server's own message when there is one, because it knows what went wrong
 * — "that report has been approved and cannot be edited" beats anything a
 * catch block could invent. The fallback is for the cases the server never
 * reached at all: a dropped connection, a dead API.
 */
function reasonFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function failed(error: unknown, fallback: string): GuardResult {
  return { ok: false, reason: reasonFor(error, fallback) };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [supplements, setSupplements] = useState<Supplement[]>([]);
  const [stops, setStops] = useState<TrafficStop[]>([]);
  const [crashes, setCrashes] = useState<CrashReport[]>([]);
  const [returns, setReturns] = useState<QueryReturn[]>([]);
  const [arrests, setArrests] = useState<Arrest[]>([]);
  const [caseTasks, setCaseTasks] = useState<CaseTask[]>([]);
  const [photos, setPhotos] = useState<PersonPhoto[]>([]);
  const [cruisers, setCruisers] = useState<Cruiser[]>([]);
  const [cruiserChecks, setCruiserChecks] = useState<CruiserCheck[]>([]);
  const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequest[]>([]);
  const [activeCrashId, setActiveCrashId] = useState<string | null>(null);
  const [activeArrestId, setActiveArrestId] = useState<string | null>(null);
  const [activeSupplementId, setActiveSupplementId] = useState<string | null>(null);
  const [people, setPeople] = useState<PersonIndex>({});
  const [locations, setLocations] = useState<LocationIndex>({});
  const [agency, setAgency] = useState<AgencyProfile>(emptyAgency());
  const [users, setUsers] = useState<User[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [evidence, setEvidence] = useState<EvidenceSummary[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [feedbackForwarding, setFeedbackForwarding] = useState(false);

  const [identity, setIdentity] = useState<{ user: User; mustChangePassword: boolean } | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ id: string; message: string } | null>(null);
  const [locks, setLocks] = useState<Record<string, LockHolder>>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  /** Server version of every record, so writes can say what they were based on. */
  const versions = useRef<Record<string, number>>({});

  const currentUser = identity?.user ?? createUser({ id: 'anonymous', name: 'Not signed in' });
  const isAuthenticated = Boolean(identity);
  const mustChangePassword = Boolean(identity?.mustChangePassword);

  /**
   * Audit entries are written by the server, from the session it resolved.
   * The client only reports that something happened; it cannot say who did it.
   */
  const record = useCallback((draft: AuditDraft) => {
    void api
      .record(draft.action, draft.target, draft.detail)
      .then(() => api.auditLog())
      .then(({ entries }) => setAuditLog(entries))
      .catch(() => undefined);
  }, []);

  const verifyAuditLog = useCallback((): Promise<ChainStatus> => api.verifyAudit(), []);

  const can = useCallback(
    (permission: Permission) => canDo(currentUser, permission),
    [currentUser],
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeSection, setActiveSectionState] = useState<SectionId>('incident');
  const [visitedSections, setVisitedSections] = useState<Set<SectionId>>(() => new Set(['incident']));
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [revealedPaths, setRevealedPaths] = useState<Set<string>>(() => new Set());
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [autoLink, setAutoLink] = useState<AutoLinkNotice | null>(null);

  const fields = useRef(new Map<string, HTMLElement>());
  /** Kept in refs so audit entries can name their target without re-creating callbacks. */
  const incidentRef = useRef<Incident | null>(null);
  const locationsRef = useRef<LocationIndex>({});
  const incidentsRef = useRef<Incident[]>([]);
  const peopleRef = useRef<PersonIndex>({});
  const pendingFocus = useRef<string | null>(null);

  const incident = useMemo(
    () => incidents.find((i) => i.id === activeId) ?? null,
    [incidents, activeId],
  );

  const persons = useMemo(
    () => (incident ? resolvePeople(incident.persons, people) : NO_PERSONS),
    [incident, people],
  );

  const location = useMemo(
    () => (incident?.locationId ? locations[incident.locationId] ?? null : null),
    [incident, locations],
  );

  /*
    The national edits, plus whatever the agency's own state adds on top. A
    state pack's required fields arrive as warnings: the report is complete by
    federal standards and can be filed, but it will be held out of the state
    submission until they are answered.
  */
  const rules = useMemo(() => [...ALL_RULES, ...stateRules(profileFor(agency.state))], [agency.state]);

  const validation = useMemo(() => {
    if (!incident) return EMPTY_VALIDATION;
    const base = runRules(incident, rules, { people, locations, agency });

    // A supervisor's note is, for the officer, exactly the same kind of thing
    // as a validation problem: something specific, attached to a field, that
    // has to be dealt with. Folding them into one list means they inherit the
    // panel, the section badges and jump-to-the-field for free.
    const notes = unresolvedComments(incident.reviewComments ?? []);
    if (notes.length === 0) return base;

    const asIssues: Issue[] = notes.map((comment) => ({
      key: `review:${comment.id}`,
      ruleId: 'review.comment',
      severity: 'error',
      section: comment.section,
      path: comment.path || comment.section,
      scope: `From ${comment.authorName}`,
      title: 'Supervisor asked for a change',
      message: comment.message,
      tip: 'Make the change, then mark it done in the panel. The report cannot go back up with this outstanding.',
    }));

    return runRules(incident, [...rules, () => asIssues], { people, locations, agency });
  }, [incident, people, locations, agency, rules]);

  incidentRef.current = incident;
  locationsRef.current = locations;
  incidentsRef.current = incidents;
  peopleRef.current = people;

  /** Pulls everything the signed-in user is entitled to see. */
  const refresh = useCallback(async () => {
    const state = await api.state();
    setIncidents(state.incidents);
    setSupplements(state.supplements ?? []);
    setStops(state.stops ?? []);
    setCrashes(state.crashes ?? []);
    setReturns(state.returns ?? []);
    setArrests(state.arrests ?? []);
    setCaseTasks(state.caseTasks ?? []);
    setPhotos(state.photos ?? []);
    setPeople(state.people);
    setLocations(state.locations);
    setUsers(state.users);
    setAuditLog(state.auditLog);
    /*
      Fetched separately from the main state pull. Feedback is not something a
      report screen ever needs, and a failure here — an older server without
      the endpoint, say — must not take the whole app down with it.
    */
    void api
      .evidence()
      .then(({ evidence: items }) => setEvidence(items))
      .catch(() => setEvidence([]));
    void api
      .feedback()
      .then(({ feedback: items, forwarding }) => {
        setFeedback(items);
        setFeedbackForwarding(forwarding);
      })
      .catch(() => setFeedback([]));
    setLocks(state.locks ?? {});
    setAttachments(state.attachments ?? []);
    versions.current = state.versions ?? {};
    if (state.agency) setAgency(state.agency);
  }, []);

  // Resolve the session on load, then fetch. A 401 simply means the sign-in
  // screen, which is not an error worth reporting.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await api.me();
        if (cancelled) return;
        setIdentity(me);
        if (me) {
          setSession(createSession(me.user.id, 'local'));
          await refresh();
        }
        setConnectionError(null);
      } catch (error) {
        if (!cancelled) {
          setConnectionError(reasonFor(error, 'Could not reach the server.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  /**
   * Write-through, one record at a time.
   *
   * Each save carries the version the client last saw. If someone else has
   * saved in the meantime the server refuses, and the refusal surfaces rather
   * than being retried — retrying would be the silent overwrite this exists to
   * prevent.
   */
  const dirty = useRef(new Map<string, Collection>());
  const flushTimer = useRef<number | null>(null);

  const flush = useCallback(async () => {
    const pending = [...dirty.current.entries()];
    dirty.current.clear();

    for (const [id, collection] of pending) {
      const doc =
        collection === 'incidents'
          ? incidentsRef.current.find((i) => i.id === id)
          : collection === 'people'
            ? peopleRef.current[id]
            : locationsRef.current[id];

      // Deleted locally before the flush ran.
      if (!doc) {
        void api.deleteRecord(collection, id).catch(() => undefined);
        delete versions.current[id];
        continue;
      }

      try {
        const { version } = await api.putRecord(collection, id, doc, versions.current[id] ?? null);
        versions.current[id] = version;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          setConflict({ id, message: error.message });
          // Take the server's copy as the new base; the officer decides what
          // to do from a screen that shows both, rather than losing either.
          await refresh().catch(() => undefined);
        } else {
          // A transient failure keeps the record dirty so the next edit retries.
          dirty.current.set(id, collection);
        }
      }
    }
  }, [refresh]);

  /*
    Supplements save on their own path rather than through `markDirty`.

    The record write-through carries an optimistic version and belongs to the
    three shared collections; a supplement is a single-author draft that only
    its author can edit, so a version race cannot happen and the extra
    machinery would only get in the way.
  */
  const supplementDirty = useRef(new Set<string>());
  const supplementTimer = useRef<number | null>(null);
  const supplementsRef = useRef<Supplement[]>([]);
  supplementsRef.current = supplements;

  const flushSupplement = useCallback(async (id: string) => {
    if (!supplementDirty.current.has(id)) return;
    supplementDirty.current.delete(id);
    const doc = supplementsRef.current.find((s) => s.id === id);
    if (!doc) return;
    try {
      await api.saveSupplement(id, {
        type: doc.type,
        narrative: doc.narrative,
        disposition: doc.disposition,
        arrest: doc.arrest,
      });
    } catch {
      // Put it back so the next tick tries again rather than losing the edit.
      supplementDirty.current.add(id);
    }
  }, []);

  const markSupplementDirty = useCallback(
    (id: string) => {
      supplementDirty.current.add(id);
      if (supplementTimer.current !== null) window.clearTimeout(supplementTimer.current);
      supplementTimer.current = window.setTimeout(() => void flushSupplement(id), 600);
    },
    [flushSupplement],
  );

  const markDirty = useCallback(
    (collection: Collection, id: string) => {
      dirty.current.set(id, collection);
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(() => void flush(), 600);
    },
    [flush],
  );

  const dismissConflict = useCallback(() => setConflict(null), []);

  /* -------------------------------------------------- locks ------------ */

  const lockOn = useCallback(
    (id: string) => {
      const holder = locks[id];
      return holder && holder.userId !== currentUser.id ? holder : null;
    },
    [locks, currentUser.id],
  );

  const takeOverLock = useCallback((id: string) => {
    void api.acquireLock(id, true).then(() => api.locks()).then(({ locks: next }) => setLocks(next));
  }, []);

  /**
   * Holds a lock on the open report and refreshes it, so other officers see
   * that somebody is in there. Released on close; expires on its own if the
   * laptop simply goes away.
   */
  useEffect(() => {
    if (!activeId || !isAuthenticated) return;
    let cancelled = false;

    void api.acquireLock(activeId).catch(() => undefined);
    const beat = window.setInterval(() => {
      void api.acquireLock(activeId).catch(() => undefined);
      void api.locks().then(({ locks: next }) => !cancelled && setLocks(next)).catch(() => undefined);
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(beat);
      void api.releaseLock(activeId).catch(() => undefined);
    };
  }, [activeId, isAuthenticated]);

  /** Keeps the dashboard's "who is editing what" roughly current. */
  useEffect(() => {
    if (!isAuthenticated || activeId) return;
    const poll = window.setInterval(() => {
      void api.locks().then(({ locks: next }) => setLocks(next)).catch(() => undefined);
    }, 20_000);
    return () => window.clearInterval(poll);
  }, [isAuthenticated, activeId]);

  /* -------------------------------------------------- attachments ------ */

  const uploadAttachment = useCallback(
    async (file: File, caption: string): Promise<GuardResult> => {
      if (!activeId) return { ok: false, reason: 'No report is open.' };
      try {
        await api.uploadAttachment(activeId, file, caption);
        const { attachments: next } = await api.attachments();
        setAttachments(next);
        void api.auditLog().then(({ entries }) => setAuditLog(entries)).catch(() => undefined);
        return { ok: true };
      } catch (error) {
        return failed(error, 'Upload failed.');
      }
    },
    [activeId],
  );

  const retractAttachment = useCallback(
    async (id: string, reason: string): Promise<GuardResult> => {
      try {
        await api.retractAttachment(id, reason);
        const { attachments: next } = await api.attachments();
        setAttachments(next);
        void api.auditLog().then(({ entries }) => setAuditLog(entries)).catch(() => undefined);
        return { ok: true };
      } catch (error) {
        return failed(error, 'Could not withdraw it.');
      }
    },
    [],
  );

  const verifyAttachmentFile = useCallback(
    (id: string) => api.verifyAttachment(id).catch(() => ({ intact: false })),
    [],
  );

  /* -------------------------------------------------- field registry --- */
  const registerField = useCallback((path: string, el: HTMLElement | null) => {
    if (el) fields.current.set(path, el);
    else fields.current.delete(path);
  }, []);

  const focusPath = useCallback((path: string, attempt = 0) => {
    const el = fields.current.get(path);
    if (!el) {
      // The section may have only just switched, or a quick fix may have
      // created the record a moment ago. Retry across a few frames.
      if (attempt < 12) requestAnimationFrame(() => focusPath(path, attempt + 1));
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusable = el.matches('input, select, textarea, button, [tabindex]')
      ? el
      : el.querySelector<HTMLElement>('input, select, textarea, button, [tabindex]');
    focusable?.focus({ preventScroll: true });

    el.classList.remove('field-flash');
    void el.offsetWidth; // restart the animation when jumping to the same field twice
    el.classList.add('field-flash');
    window.setTimeout(() => el.classList.remove('field-flash'), 1600);
  }, []);

  useEffect(() => {
    if (!pendingFocus.current) return;
    const target = pendingFocus.current;
    pendingFocus.current = null;
    focusPath(target);
  });

  const revealField = useCallback((fieldPath: string) => {
    setRevealedPaths((prev) => {
      if (prev.has(fieldPath)) return prev;
      const next = new Set(prev);
      next.add(fieldPath);
      return next;
    });
  }, []);

  /* -------------------------------------------------- navigation ------- */
  const setSection = useCallback((section: SectionId) => {
    setActiveSectionState(section);
    setVisitedSections((prev) => {
      if (prev.has(section)) return prev;
      const next = new Set(prev);
      next.add(section);
      return next;
    });
    document.getElementById('section-scroll')?.scrollTo({ top: 0 });
  }, []);

  const goToIssue = useCallback(
    (issue: Issue) => {
      setSection(issue.section);
      revealField(issue.path);
      pendingFocus.current = issue.path;
    },
    [setSection, revealField],
  );

  /* -------------------------------------------------- mutation --------- */
  const update = useCallback(
    (mutator: Mutator) => {
      setIncidents((prev) =>
        prev.map((item) => {
          if (item.id !== activeId) return item;
          const draft = structuredClone(item);
          mutator(draft);
          draft.updatedAt = new Date().toISOString();
          markDirty('incidents', draft.id);
          return draft;
        }),
      );
      setSavedAt(new Date().toISOString());
    },
    [activeId],
  );

  const applyQuickFix = useCallback(
    (issue: Issue) => {
      if (!issue.quickFix) return;
      const current = incidentsRef.current.find((item) => item.id === activeId);
      if (!current) return;

      // Computed outside the updater — see `acceptSuggestion` for why.
      const draft = structuredClone(current);
      const draftPeople = structuredClone(people);
      const result = issue.quickFix.apply(draft, draftPeople);
      draft.updatedAt = new Date().toISOString();

      setIncidents((prev) => prev.map((item) => (item.id === activeId ? draft : item)));
      markDirty('incidents', draft.id);
      setPeople(draftPeople);
      for (const id of Object.keys(draftPeople)) {
        if (!peopleRef.current[id]) markDirty('people', id);
      }
      setSavedAt(new Date().toISOString());
      if (typeof result === 'string') {
        setSection(issue.section);
        revealField(result);
        pendingFocus.current = result;
      }
    },
    [activeId, people, setSection, revealField],
  );

  /* -------------------------------------------------- crashes ----------- */

  const crash = useMemo(
    () => crashes.find((c) => c.id === activeCrashId) ?? null,
    [crashes, activeCrashId],
  );

  const crashProblems = useMemo(() => (crash ? checkCrash(crash) : []), [crash]);

  const crashDirty = useRef(new Set<string>());
  const crashTimer = useRef<number | null>(null);
  const crashesRef = useRef<CrashReport[]>([]);
  crashesRef.current = crashes;

  const flushCrash = useCallback(async (id: string) => {
    if (!crashDirty.current.has(id)) return;
    crashDirty.current.delete(id);
    const doc = crashesRef.current.find((c) => c.id === id);
    if (!doc) return;
    try {
      await api.saveCrash(id, doc);
    } catch {
      crashDirty.current.add(id);
    }
  }, []);

  const markCrashDirty = useCallback(
    (id: string) => {
      crashDirty.current.add(id);
      if (crashTimer.current !== null) window.clearTimeout(crashTimer.current);
      crashTimer.current = window.setTimeout(() => void flushCrash(id), 600);
    },
    [flushCrash],
  );

  const openCrash = useCallback((id: string) => setActiveCrashId(id), []);
  const closeCrash = useCallback(() => setActiveCrashId(null), []);

  const startCrash = useCallback(async (callNumber: string): Promise<GuardResult> => {
    try {
      const { crash: created } = await api.createCrash(callNumber);
      setCrashes((prev) => [...prev, created]);
      setActiveCrashId(created.id);
      return { ok: true };
    } catch (error) {
      return failed(error, 'Could not start it.');
    }
  }, []);

  const updateCrash = useCallback(
    (patch: Partial<CrashReport>) => {
      if (!activeCrashId) return;
      setCrashes((prev) =>
        prev.map((c) =>
          c.id === activeCrashId ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c,
        ),
      );
      setSavedAt(new Date().toISOString());
      markCrashDirty(activeCrashId);
    },
    [activeCrashId, markCrashDirty],
  );

  const updateUnit = useCallback(
    (unitId: string, patch: Partial<CrashUnit>) => {
      if (!activeCrashId) return;
      setCrashes((prev) =>
        prev.map((c) =>
          c.id === activeCrashId
            ? {
                ...c,
                units: c.units.map((u) => (u.id === unitId ? { ...u, ...patch } : u)),
                updatedAt: new Date().toISOString(),
              }
            : c,
        ),
      );
      setSavedAt(new Date().toISOString());
      markCrashDirty(activeCrashId);
    },
    [activeCrashId, markCrashDirty],
  );

  const addUnit = useCallback(() => {
    if (!activeCrashId) return;
    setCrashes((prev) =>
      prev.map((c) =>
        c.id === activeCrashId
          ? {
              ...c,
              units: [...c.units, createUnit({ id: newId('unit'), number: nextUnitNumber(c.units) })],
              updatedAt: new Date().toISOString(),
            }
          : c,
      ),
    );
    markCrashDirty(activeCrashId);
  }, [activeCrashId, markCrashDirty]);

  const removeUnit = useCallback(
    (unitId: string) => {
      if (!activeCrashId) return;
      setCrashes((prev) =>
        prev.map((c) =>
          c.id === activeCrashId
            ? { ...c, units: c.units.filter((u) => u.id !== unitId), updatedAt: new Date().toISOString() }
            : c,
        ),
      );
      markCrashDirty(activeCrashId);
    },
    [activeCrashId, markCrashDirty],
  );

  const crashAction = useCallback(
    async (
      action: 'submit' | 'approve' | 'return' | 'reopen',
      body: Record<string, unknown> = {},
    ): Promise<GuardResult> => {
      if (!activeCrashId) return { ok: false, reason: 'No crash report is open.' };
      try {
        await flushCrash(activeCrashId);
        const result = await api.crashAction(activeCrashId, action, body);
        setCrashes((prev) => prev.map((c) => (c.id === result.crash.id ? result.crash : c)));
        return { ok: true };
      } catch (error) {
        return failed(error, 'That did not work.');
      }
    },
    [activeCrashId, flushCrash],
  );

  const submitCrash = useCallback(() => crashAction('submit'), [crashAction]);
  const approveCrash = useCallback((note: string) => crashAction('approve', { note }), [crashAction]);
  const returnCrash = useCallback((reason: string) => crashAction('return', { reason }), [crashAction]);
  const reopenCrash = useCallback((reason: string) => crashAction('reopen', { reason }), [crashAction]);

  /* -------------------------------------------------- arrests ----------- */

  const arrest = useMemo(
    () => arrests.find((a) => a.id === activeArrestId) ?? null,
    [arrests, activeArrestId],
  );

  /*
    Checked here as well as on the server, and by the same function. The server
    is the one that decides whether a submission is allowed; this is so the
    officer sees the problem while they are still typing rather than after
    pressing the button.
  */
  const arrestProblems = useMemo(() => {
    if (!arrest) return [];
    const incident = incidentsRef.current.find((i) => i.id === arrest.caseId);
    return checkArrest(arrest, { incidentReportedAt: incident?.reportedAt });
  }, [arrest]);

  const arrestDirty = useRef(new Set<string>());
  const arrestTimer = useRef<number | null>(null);
  const arrestsRef = useRef<Arrest[]>([]);
  arrestsRef.current = arrests;

  const flushArrest = useCallback(async (id: string) => {
    if (!arrestDirty.current.has(id)) return;
    arrestDirty.current.delete(id);
    const doc = arrestsRef.current.find((a) => a.id === id);
    if (!doc) return;
    try {
      await api.saveArrest(id, doc);
    } catch {
      arrestDirty.current.add(id);
    }
  }, []);

  const markArrestDirty = useCallback(
    (id: string) => {
      arrestDirty.current.add(id);
      if (arrestTimer.current !== null) window.clearTimeout(arrestTimer.current);
      arrestTimer.current = window.setTimeout(() => void flushArrest(id), 600);
    },
    [flushArrest],
  );

  const openArrest = useCallback((id: string) => setActiveArrestId(id), []);
  const closeArrest = useCallback(() => setActiveArrestId(null), []);

  const startArrest = useCallback(
    async (input: { caseId?: string; masterId?: string }): Promise<GuardResult> => {
      try {
        const { arrest: created } = await api.createArrest(input);
        setArrests((prev) => [...prev, created]);
        setActiveArrestId(created.id);
        return { ok: true };
      } catch (error) {
        return failed(error, 'Could not start it.');
      }
    },
    [],
  );

  /** One place every arrest edit goes through, so nothing forgets to save. */
  const editArrest = useCallback(
    (change: (current: Arrest) => Arrest) => {
      if (!activeArrestId) return;
      setArrests((prev) =>
        prev.map((a) =>
          a.id === activeArrestId ? { ...change(a), updatedAt: new Date().toISOString() } : a,
        ),
      );
      setSavedAt(new Date().toISOString());
      markArrestDirty(activeArrestId);
    },
    [activeArrestId, markArrestDirty],
  );

  const updateArrest = useCallback(
    (patch: Partial<Arrest>) => editArrest((current) => ({ ...current, ...patch })),
    [editArrest],
  );

  const addCharge = useCallback(
    () =>
      editArrest((current) => ({
        ...current,
        charges: [...current.charges, createArrestCharge({ id: newId('chg'), counts: '1' })],
      })),
    [editArrest],
  );

  const updateCharge = useCallback(
    (chargeId: string, patch: Partial<ArrestCharge>) =>
      editArrest((current) => ({
        ...current,
        charges: current.charges.map((c) => (c.id === chargeId ? { ...c, ...patch } : c)),
      })),
    [editArrest],
  );

  const removeCharge = useCallback(
    (chargeId: string) =>
      editArrest((current) => ({
        ...current,
        charges: current.charges.filter((c) => c.id !== chargeId),
      })),
    [editArrest],
  );

  const arrestAction = useCallback(
    async (
      action: 'submit' | 'approve' | 'return' | 'reopen',
      body: Record<string, unknown> = {},
    ): Promise<GuardResult> => {
      if (!activeArrestId) return { ok: false, reason: 'No arrest is open.' };
      try {
        // Anything still in the debounce window goes first, or the server
        // would review the version from six hundred milliseconds ago.
        await flushArrest(activeArrestId);
        const result = await api.arrestAction(activeArrestId, action, body);
        setArrests((prev) => prev.map((a) => (a.id === result.arrest.id ? result.arrest : a)));
        /*
          Approving an arrest writes the arrestee onto its report, so the copy
          of that report in this tab is now stale. Cheap to re-pull, and the
          alternative is a case screen that disagrees with the database.
        */
        if (action === 'approve') void refresh();
        return { ok: true };
      } catch (error) {
        return failed(error, 'That did not work.');
      }
    },
    [activeArrestId, flushArrest, refresh],
  );

  const submitArrest = useCallback(() => arrestAction('submit'), [arrestAction]);
  const approveArrest = useCallback(
    (note: string) => arrestAction('approve', { note }),
    [arrestAction],
  );
  const returnArrest = useCallback(
    (reason: string) => arrestAction('return', { reason }),
    [arrestAction],
  );
  const reopenArrest = useCallback(
    (reason: string) => arrestAction('reopen', { reason }),
    [arrestAction],
  );

  const arrestsForCase = useCallback(
    (caseId: string) =>
      arrests
        .filter((a) => a.caseId === caseId)
        .sort((a, b) => (a.arrestedAt < b.arrestedAt ? 1 : -1)),
    [arrests],
  );

  /* -------------------------------------------------- to-do list -------- */

  /*
    Written through to the server rather than debounced like a report.

    A to-do item is one short sentence and then a click; there is no typing
    session to coalesce, and the officer who adds "chase the video" wants it on
    the list before they close the laptop. The optimistic local update is what
    makes it feel instant; the server's copy replaces it a moment later.
  */

  const tasksForCase = useCallback(
    (caseId: string) => sortTasks(caseTasks.filter((t) => t.caseId === caseId)),
    [caseTasks],
  );

  const taskSummary = useCallback(
    (caseId: string) => describeTasks(caseTasks.filter((t) => t.caseId === caseId)),
    [caseTasks],
  );

  const addTask = useCallback(
    async (
      caseId: string,
      input: { text: string; assignedToId?: string; dueOn?: string },
    ): Promise<GuardResult> => {
      try {
        const { task } = await api.addTask(caseId, input);
        setCaseTasks((prev) => [...prev, task]);
        return { ok: true };
      } catch (error) {
        return failed(error, 'Could not add it.');
      }
    },
    [],
  );

  const editTask = useCallback(
    async (id: string, patch: Partial<CaseTask>): Promise<GuardResult> => {
      try {
        const { task } = await api.updateTask(id, patch);
        setCaseTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
        return { ok: true };
      } catch (error) {
        return failed(error, 'Could not save it.');
      }
    },
    [],
  );

  const setTaskDone = useCallback(
    (id: string, done: boolean) => editTask(id, { done }),
    [editTask],
  );

  const removeTask = useCallback(async (id: string): Promise<GuardResult> => {
    try {
      await api.removeTask(id);
      setCaseTasks((prev) => prev.filter((t) => t.id !== id));
      return { ok: true };
    } catch (error) {
      return failed(error, 'Could not remove it.');
    }
  }, []);

  /* -------------------------------------------------- the fleet --------- */

  /*
    Fetched on its own rather than with the main state pull, like the property
    room. A report screen never needs the fleet, and a failure here — an older
    server without the routes, say — must not take the whole app down.
  */
  const refreshFleet = useCallback(async () => {
    try {
      const state = await api.fleet();
      setCruisers(state.cruisers ?? []);
      setCruiserChecks(state.checks ?? []);
      setMaintenanceRequests(state.requests ?? []);
    } catch {
      /* Leave what is already loaded. */
    }
  }, []);

  const maintenanceQueue = useMemo(
    () => requestQueue(maintenanceRequests),
    [maintenanceRequests],
  );

  const addCruiser = useCallback(
    async (input: Partial<Cruiser>): Promise<GuardResult> => {
      try {
        const { cruiser } = await api.addCruiser(input);
        setCruisers((prev) => [...prev, cruiser]);
        return { ok: true };
      } catch (error) {
        return failed(error, 'Could not add it.');
      }
    },
    [],
  );

  const updateCruiser = useCallback(
    async (id: string, patch: Partial<Cruiser>): Promise<GuardResult> => {
      try {
        const { cruiser } = await api.updateCruiser(id, patch);
        setCruisers((prev) => prev.map((c) => (c.id === cruiser.id ? cruiser : c)));
        return { ok: true };
      } catch (error) {
        return failed(error, 'Could not save it.');
      }
    },
    [],
  );

  const fileCheck = useCallback(
    async (input: {
      cruiserId: string;
      shift: string;
      odometer: string;
      notes: string;
      items: { itemId: string; result: string; note: string }[];
    }) => {
      try {
        const result = await api.fileCheck(input);
        // A check can put a car off the road and raise requests, so the whole
        // fleet is re-read rather than three lists patched by hand.
        await refreshFleet();
        return { ok: true as const, offRoad: result.offRoad, raised: result.requests.length };
      } catch (error) {
        return failed(error, 'The check was not filed.');
      }
    },
    [refreshFleet],
  );

  const reportFault = useCallback(
    async (input: { cruiserId: string; problem: string; urgency: string; odometer: string }) => {
      try {
        const result = await api.reportFault(input);
        await refreshFleet();
        return { ok: true as const, offRoad: result.offRoad };
      } catch (error) {
        return failed(error, 'That was not sent.');
      }
    },
    [refreshFleet],
  );

  const moveRequest = useCallback(
    async (id: string, input: { status: string; note?: string; assignedTo?: string }) => {
      try {
        const result = await api.moveRequest(id, input);
        await refreshFleet();
        return { ok: true as const, backOnRoad: result.backOnRoad };
      } catch (error) {
        return failed(error, 'That did not work.');
      }
    },
    [refreshFleet],
  );

  /* -------------------------------------------------- photographs ------- */

  const photosOf = useCallback((masterId: string) => photosFor(photos, masterId), [photos]);

  const faceOf = useCallback(
    (masterId: string) => currentPhoto(photos.filter((p) => p.masterId === masterId)),
    [photos],
  );

  const photoRequests = useMemo(() => pendingRemovals(photos), [photos]);

  /** Replaces one photograph with whatever the server says it now is. */
  const replacePhoto = useCallback((photo: PersonPhoto) => {
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? photo : p)));
  }, []);

  const addPhoto = useCallback(
    async (
      masterId: string,
      file: File,
      details: { takenOn: string; kind: string; caption: string },
    ): Promise<GuardResult> => {
      try {
        const { photo } = await api.addPhoto(masterId, file, details);
        setPhotos((prev) => [...prev, photo]);
        return { ok: true };
      } catch (error) {
        return failed(error, 'The photograph was not accepted.');
      }
    },
    [],
  );

  const requestPhotoRemoval = useCallback(
    async (id: string, reason: string): Promise<GuardResult> => {
      try {
        const { photo } = await api.requestPhotoRemoval(id, reason);
        replacePhoto(photo);
        return { ok: true };
      } catch (error) {
        return failed(error, 'Could not send that.');
      }
    },
    [replacePhoto],
  );

  const decidePhoto = useCallback(
    async (id: string, remove: boolean, note: string): Promise<GuardResult> => {
      try {
        const { photo } = await api.decidePhoto(id, remove, note);
        replacePhoto(photo);
        return { ok: true };
      } catch (error) {
        return failed(error, 'That did not work.');
      }
    },
    [replacePhoto],
  );

  /* -------------------------------------------------- inbound ----------- */

  /**
   * The returns that belong to this scene.
   *
   * Grouped on the dispatch call number where there is one; otherwise what
   * this officer ran in the last twelve hours, because plenty of crashes are
   * come across rather than dispatched to.
   */
  const sceneReturns = useMemo(() => {
    if (!crash) return [];
    const byCall = returnsForCall(returns, crash.callNumber);
    return byCall.length > 0 ? byCall : recentReturns(returns, currentUser.id);
  }, [crash, returns, currentUser.id]);

  /**
   * Puts a return into the open crash report.
   *
   * Every identity it creates lands in the Master Name Index like any other
   * person, carrying the provenance the return came with — so the field shows
   * "DMV return · not confirmed with this person" until an officer says
   * otherwise. Fast, and honest about how much weight it carries.
   */
  const applyReturn = useCallback(
    (returnId: string, as: 'unit' | 'driver' | 'owner' | 'occupant', unitId?: string) => {
      const ret = returns.find((r) => r.id === returnId);
      const current = crashesRef.current.find((c) => c.id === activeCrashId);
      if (!ret || !current || !activeCrashId) return;

      /*
        Computed here rather than inside the `setCrashes` updater. React runs
        that updater when it re-renders, not when it is called, so identities
        created inside it were being discarded — the unit appeared and the
        driver silently did not. The same trap caught the suggestion and
        quick-fix paths; the rule is that anything the caller needs back has to
        be worked out before the setter, not during it.
      */
      const draftPeople = structuredClone(people);
      const next = structuredClone(current);
      let touchedPeople = false;

      const intoIndex = (identity: Partial<MasterPerson> | null): string => {
        if (!identity) return '';
        const master = createMasterPerson(identity);
        draftPeople[master.id] = master;
        touchedPeople = true;
        return master.id;
      };

      if (as === 'unit') {
        const vehicle = vehicleFromRegistration(ret);
        if (!vehicle) return;
        next.units.push(
          createUnit({
            id: newId('unit'),
            number: nextUnitNumber(next.units),
            ...vehicle,
            insuranceCarrier: ret.payload.kind === 'registration' ? ret.payload.insuranceCarrier : '',
            insurancePolicy: ret.payload.kind === 'registration' ? ret.payload.insurancePolicy : '',
            ownerMasterId: intoIndex(ownerFromRegistration(ret)),
          }),
        );
      }

      if (as === 'driver' || as === 'occupant') {
        const target = next.units.find((u) => u.id === unitId) ?? next.units[0];
        const masterId = intoIndex(personFromLicense(ret));
        if (!target || !masterId) return;
        const occupant = createOccupant({
          id: newId('occ'),
          masterId,
          seat: as === 'driver' ? 'driver' : 'other',
        });
        target.occupants.push(occupant);
        if (as === 'driver') target.driverOccupantId = occupant.id;
      }

      if (as === 'owner') {
        const target = next.units.find((u) => u.id === unitId) ?? next.units[0];
        if (!target) return;
        target.ownerMasterId = intoIndex(ownerFromRegistration(ret));
      }

      next.updatedAt = new Date().toISOString();
      setCrashes((prev) => prev.map((c) => (c.id === activeCrashId ? next : c)));

      if (touchedPeople) {
        setPeople(draftPeople);
        for (const id of Object.keys(draftPeople)) {
          if (!peopleRef.current[id]) markDirty('people', id);
        }
      }
      markCrashDirty(activeCrashId);
      setSavedAt(new Date().toISOString());
      void api
        .markReturnApplied(returnId, activeCrashId)
        .then(({ return: updated }) =>
          setReturns((prev) => prev.map((r) => (r.id === updated.id ? updated : r))),
        )
        .catch(() => {
          /* The report already has the data; the marker is a convenience. */
        });
    },
    [returns, activeCrashId, people, markCrashDirty, markDirty],
  );

  /**
   * Takes the time and place from the dispatch call record.
   *
   * Only fills what is still empty. Dispatch's address is where the caller said
   * it was, and the officer standing at the scene may well have corrected it —
   * overwriting that with the call record would replace a fact with a guess.
   */
  const applyCallDetails = useCallback(
    (returnId: string) => {
      const ret = returns.find((r) => r.id === returnId);
      if (!ret || ret.payload.kind !== 'call' || !activeCrashId) return;
      const current = crashesRef.current.find((c) => c.id === activeCrashId);
      if (!current) return;

      const call = ret.payload;
      const keep = (existing: string, incoming: string) => existing || incoming || '';
      const next: CrashReport = {
        ...current,
        occurredAt: keep(current.occurredAt, (call.receivedAt || '').slice(0, 16)),
        reportedAt: keep(current.reportedAt, (call.receivedAt || '').slice(0, 16)),
        onRoad: keep(current.onRoad, call.address),
        crossStreet: keep(current.crossStreet, call.crossStreet),
        latitude: keep(current.latitude, call.latitude),
        longitude: keep(current.longitude, call.longitude),
        updatedAt: new Date().toISOString(),
      };
      setCrashes((prev) => prev.map((c) => (c.id === activeCrashId ? next : c)));
      markCrashDirty(activeCrashId);
      setSavedAt(new Date().toISOString());
    },
    [returns, activeCrashId, markCrashDirty],
  );

  /* ------------------------------------------------- evidence ----------- */

  /** Re-reads the list so derived state comes back from one place. */
  const refreshEvidence = useCallback(async () => {
    try {
      const { evidence: items } = await api.evidence();
      setEvidence(items);
    } catch {
      /* Leave what is on screen; the next action will report the real error. */
    }
  }, []);

  const bookEvidence = useCallback(
    async (input: Record<string, string>): Promise<GuardResult & { tagNumber?: string }> => {
      try {
        const { item } = await api.bookEvidence(input);
        await refreshEvidence();
        return { ok: true, tagNumber: item.tagNumber };
      } catch (error) {
        return failed(error, 'Could not book it in.');
      }
    },
    [refreshEvidence],
  );

  const recordCustody = useCallback(
    async (id: string, input: Record<string, string>): Promise<GuardResult> => {
      try {
        await api.recordCustody(id, input);
        await refreshEvidence();
        return { ok: true };
      } catch (error) {
        return failed(error, 'Could not record it.');
      }
    },
    [refreshEvidence],
  );

  const updateEvidence = useCallback(
    async (id: string, patch: Partial<EvidenceItem>): Promise<GuardResult> => {
      try {
        await api.updateEvidence(id, patch);
        await refreshEvidence();
        return { ok: true };
      } catch (error) {
        return failed(error, 'Could not save it.');
      }
    },
    [refreshEvidence],
  );

  const loadEvidence = useCallback(async (id: string): Promise<EvidenceDetail | null> => {
    try {
      return await api.evidenceItem(id);
    } catch {
      return null;
    }
  }, []);

  /* ------------------------------------------------- feedback ----------- */

  const sendFeedback = useCallback(
    async (draft: FeedbackDraft): Promise<GuardResult & { redacted?: number }> => {
      try {
        const { feedback: created, redacted } = await api.sendFeedback(draft);
        setFeedback((prev) => [...prev, created]);
        return { ok: true, redacted };
      } catch (error) {
        return failed(error, 'Could not send it.');
      }
    },
    [],
  );

  const secondFeedback = useCallback(async (id: string): Promise<GuardResult> => {
    try {
      const { feedback: updated } = await api.secondFeedback(id);
      setFeedback((prev) => prev.map((f) => (f.id === id ? updated : f)));
      return { ok: true };
    } catch (error) {
      return failed(error, 'Could not do that.');
    }
  }, []);

  const answerFeedback = useCallback(
    async (
      id: string,
      patch: { status?: FeedbackStatus; response?: string },
    ): Promise<GuardResult> => {
      try {
        const { feedback: updated } = await api.answerFeedback(id, patch);
        setFeedback((prev) => prev.map((f) => (f.id === id ? updated : f)));
        return { ok: true };
      } catch (error) {
        return failed(error, 'Could not save the answer.');
      }
    },
    [],
  );

  const forwardFeedback = useCallback(async (id: string): Promise<GuardResult> => {
    try {
      const { feedback: updated, ok } = await api.forwardFeedback(id);
      setFeedback((prev) => prev.map((f) => (f.id === id ? updated : f)));
      return ok
        ? { ok: true }
        : { ok: false, reason: 'The vendor address did not answer. It is still saved here.' };
    } catch (error) {
      return failed(error, 'Could not send it.');
    }
  }, []);

  /* -------------------------------------------------- stops ------------- */

  const logStop = useCallback(async (stop: Partial<TrafficStop>): Promise<GuardResult> => {
    try {
      const { stop: created } = await api.createStop(stop);
      setStops((prev) => [...prev, created]);
      return { ok: true };
    } catch (error) {
      return failed(error, 'Could not log it.');
    }
  }, []);

  const saveStop = useCallback(
    async (id: string, patch: Partial<TrafficStop>): Promise<GuardResult> => {
      try {
        const { stop } = await api.saveStop(id, patch);
        setStops((prev) => prev.map((s) => (s.id === id ? stop : s)));
        return { ok: true };
      } catch (error) {
        return failed(error, 'Could not save it.');
      }
    },
    [],
  );

  const removeStop = useCallback(async (id: string): Promise<GuardResult> => {
    try {
      await api.deleteStop(id);
      setStops((prev) => prev.filter((s) => s.id !== id));
      return { ok: true };
    } catch (error) {
      return failed(error, 'Could not remove it.');
    }
  }, []);

  /* -------------------------------------------------- supplements ------- */

  /*
    A supplement is its own document. It never edits the report it hangs from —
    the original stays exactly as it was signed off — so the only thing that
    reaches the case is a disposition change, and only once a supervisor has
    approved it. The server re-decides all of that; this is the client's view.
  */
  const caseSupplements = useMemo(
    () => (activeId ? supplementsFor(supplements, activeId) : []),
    [supplements, activeId],
  );

  const supplement = useMemo(
    () => supplements.find((s) => s.id === activeSupplementId) ?? null,
    [supplements, activeSupplementId],
  );

  const supplementProblems = useMemo(() => {
    if (!supplement || !incident) return [];
    return checkSupplement(supplement, {
      clearanceStatus: incident.clearanceStatus,
      hasArrestee: incident.persons.some((p) => p.role === 'arrestee'),
      status: incident.status,
    });
  }, [supplement, incident]);

  const canAddSupplement = useMemo(
    () =>
      incident
        ? canSupplement(currentUser, { status: incident.status, createdBy: incident.createdBy })
        : { ok: false },
    [incident, currentUser],
  );

  const openSupplement = useCallback((id: string) => setActiveSupplementId(id), []);
  const closeSupplement = useCallback(() => setActiveSupplementId(null), []);

  const startSupplement = useCallback(async (): Promise<GuardResult> => {
    if (!activeId) return { ok: false, reason: 'No case is open.' };
    try {
      const { supplement: created } = await api.createSupplement(activeId);
      setSupplements((prev) => [...prev, created]);
      setActiveSupplementId(created.id);
      return { ok: true };
    } catch (error) {
      return failed(error, 'Could not start it.');
    }
  }, [activeId]);

  /**
   * Saves a draft supplement.
   *
   * Optimistic locally and debounced to the server through the same dirty-record
   * path the rest of the editor uses, so typing does not wait on a round trip.
   */
  const updateSupplement = useCallback(
    (patch: Partial<Supplement>) => {
      if (!activeSupplementId) return;
      setSupplements((prev) =>
        prev.map((s) =>
          s.id === activeSupplementId ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s,
        ),
      );
      setSavedAt(new Date().toISOString());
      markSupplementDirty(activeSupplementId);
    },
    [activeSupplementId, markSupplementDirty],
  );

  /** One transition, applied to the supplement and to the case it may move. */
  const supplementAction = useCallback(
    async (
      action: 'submit' | 'approve' | 'return' | 'reopen',
      body: Record<string, unknown> = {},
    ): Promise<GuardResult> => {
      if (!activeSupplementId) return { ok: false, reason: 'No supplement is open.' };
      try {
        // Anything unsaved has to reach the server before the transition does.
        await flushSupplement(activeSupplementId);
        const result = await api.supplementAction(activeSupplementId, action, body);
        setSupplements((prev) => prev.map((s) => (s.id === result.supplement.id ? result.supplement : s)));
        // An approval may have moved the case's clearance.
        if (result.incident) {
          setIncidents((prev) => prev.map((i) => (i.id === result.incident!.id ? result.incident! : i)));
        }
        return { ok: true };
      } catch (error) {
        return failed(error, 'That did not work.');
      }
    },
    [activeSupplementId, flushSupplement],
  );

  const submitSupplement = useCallback(() => supplementAction('submit'), [supplementAction]);
  const approveSupplement = useCallback(
    (note: string) => supplementAction('approve', { note }),
    [supplementAction],
  );
  const returnSupplement = useCallback(
    (reason: string) => supplementAction('return', { reason }),
    [supplementAction],
  );
  const reopenSupplement = useCallback(
    (reason: string) => supplementAction('reopen', { reason }),
    [supplementAction],
  );

  /* -------------------------------------------------- narrative -------- */

  /*
    Reading the narrative.

    The offline pass runs on every keystroke-debounced render and costs
    nothing. The model pass is a button, because it sends the narrative
    somewhere and that should be an act, not a background process.
  */
  const [modelFindings, setModelFindings] = useState<Finding[]>([]);
  const [dismissedSuggestions, setDismissed] = useState<string[]>([]);
  const [acceptedSuggestions, setAccepted] = useState<AcceptedSuggestion[]>([]);
  const [extraction, setExtraction] = useState({
    enabled: false,
    reason: '',
    busy: false,
    error: null as string | null,
  });

  useEffect(() => {
    if (!isAuthenticated) return;
    void api
      .extractionStatus()
      .then((status) => setExtraction((prev) => ({ ...prev, ...status })))
      .catch(() => {
        /* Absent status just means the offline pass is all there is. */
      });
  }, [isAuthenticated]);

  // Findings belong to the narrative they came from; changing report or
  // rewriting the narrative makes them stale.
  useEffect(() => {
    setModelFindings([]);
    setDismissed([]);
    setAccepted([]);
  }, [activeId]);

  const suggestions = useMemo(() => {
    if (!incident) return [];
    const all = modelFindings.length
      ? mergeFindings(incident, people, modelFindings)
      : readNarrative(incident, people);
    return all.filter((s) => !dismissedSuggestions.includes(s.id));
  }, [incident, people, modelFindings, dismissedSuggestions]);

  const readWithModel = useCallback(async () => {
    if (!incident || !extraction.enabled) return;
    setExtraction((prev) => ({ ...prev, busy: true, error: null }));
    try {
      // Codes the report already uses, so what comes back is storable rather
      // than plausible-looking.
      const context = [
        `Offenses already on this report: ${incident.offenses.map((o) => o.code).join(', ') || 'none'}.`,
        `Date of the incident: ${incident.occurredFrom || incident.reportedAt}.`,
      ].join('\n');

      const result = await api.readNarrative({
        narrative: incident.narrative ?? '',
        context,
        caseNumber: incident.caseNumber,
      });
      setModelFindings((result.findings ?? []) as Finding[]);
      if (result.refused) {
        setExtraction((prev) => ({
          ...prev,
          error: 'The model declined to read this narrative. The offline pass still ran.',
        }));
      }
    } catch (error) {
      setExtraction((prev) => ({
        ...prev,
        error: reasonFor(error, 'Could not read the narrative.'),
      }));
    } finally {
      setExtraction((prev) => ({ ...prev, busy: false }));
    }
  }, [incident, extraction.enabled]);

  /**
   * Writes one suggestion into the report, and takes the officer to it.
   *
   * The same path a validation quick fix takes, deliberately: both are "the
   * system proposes, a human decides", and the officer landing on the changed
   * field is what separates this from silent autofill.
   */
  const acceptSuggestion = useCallback(
    (suggestion: Suggestion) => {
      const current = incidentsRef.current.find((item) => item.id === activeId);
      if (!current) return;

      /*
        The change is computed here rather than inside the `setIncidents`
        updater, because React runs that updater when it re-renders — not when
        it is called. Reading the focus target straight after `setIncidents`
        read it before it had been written, so accepting a suggestion applied
        the field and then left the officer looking at the narrative. A field
        that changes somewhere the officer cannot see is exactly the silent
        autofill this module exists to avoid.
      */
      const draft = structuredClone(current);
      const draftPeople = structuredClone(people);
      const result = applySuggestion(draft, draftPeople, suggestion);
      draft.updatedAt = new Date().toISOString();

      setIncidents((prev) => prev.map((item) => (item.id === activeId ? draft : item)));
      markDirty('incidents', draft.id);
      setPeople(draftPeople);
      for (const id of Object.keys(draftPeople)) {
        if (!peopleRef.current[id]) markDirty('people', id);
      }
      setSavedAt(new Date().toISOString());
      setDismissed((prev) => [...prev, suggestion.id]);

      /*
        Deliberately does NOT navigate.

        An earlier version took the officer straight to the changed field,
        which is right for one suggestion and wrong for seven — it threw them
        out of the list on every accept. The card confirms in place instead,
        naming the field and the section, with "show me" and "undo" next to
        it. That keeps the promise the navigation was there to keep — nothing
        changes out of sight — without making the list unusable.
      */
      setAccepted((prev) => [
        {
          suggestion,
          focusTarget: typeof result === 'string' ? result : null,
          previousIncident: current,
          previousPeople: people,
        },
        ...prev,
      ]);
    },
    [activeId, people],
  );

  const showSuggestion = useCallback(
    (id: string) => {
      const entry = acceptedSuggestions.find((a) => a.suggestion.id === id);
      if (!entry) return;
      setSection(entry.suggestion.section);
      if (entry.focusTarget) {
        revealField(entry.focusTarget);
        pendingFocus.current = entry.focusTarget;
      }
    },
    [acceptedSuggestions, setSection, revealField],
  );

  /** Puts the report back exactly as it stood before the suggestion was taken. */
  const undoSuggestion = useCallback(
    (id: string) => {
      const entry = acceptedSuggestions.find((a) => a.suggestion.id === id);
      if (!entry) return;
      const restored = { ...entry.previousIncident, updatedAt: new Date().toISOString() };
      setIncidents((prev) => prev.map((item) => (item.id === restored.id ? restored : item)));
      markDirty('incidents', restored.id);
      setPeople(entry.previousPeople);
      setSavedAt(new Date().toISOString());
      setAccepted((prev) => prev.filter((a) => a.suggestion.id !== id));
      // Back on the list, so it can be taken again.
      setDismissed((prev) => prev.filter((d) => d !== id));
    },
    [acceptedSuggestions],
  );

  const dismissSuggestion = useCallback((id: string) => {
    setDismissed((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const resetSuggestions = useCallback(
    () => setDismissed(acceptedSuggestions.map((a) => a.suggestion.id)),
    [acceptedSuggestions],
  );

  /* -------------------------------------------------- people ----------- */

  /** True when no report other than the given one still references a master. */
  const isOrphaned = useCallback(
    (masterId: string, ignoreIncidentPersonId?: string) =>
      !incidents.some((inc) =>
        inc.persons.some((p) => p.masterId === masterId && p.id !== ignoreIncidentPersonId),
      ),
    [incidents],
  );

  const addNewPerson = useCallback(
    (role: PersonRole) => {
      const draftPeople = structuredClone(people);
      let created: IncidentPerson | null = null;
      setIncidents((prev) =>
        prev.map((item) => {
          if (item.id !== activeId) return item;
          const draft = structuredClone(item);
          created = attachNewPerson(draft, draftPeople, role, {}, {
            // A single-offense report has only one sensible answer.
            offenseIds: draft.offenses.length === 1 ? [draft.offenses[0].id] : [],
          });
          draft.updatedAt = new Date().toISOString();
          return draft;
        }),
      );
      setPeople(draftPeople);
      for (const id of Object.keys(draftPeople)) {
        if (!peopleRef.current[id]) markDirty('people', id);
      }
      setSavedAt(new Date().toISOString());
      if (created) pendingFocus.current = `persons[${(created as IncidentPerson).id}].lastName`;
    },
    [activeId, people],
  );

  const addExistingPerson = useCallback(
    (masterId: string, role: PersonRole) => {
      update((draft) => {
        const link = createIncidentPerson(role, masterId, {
          offenseIds: draft.offenses.length === 1 ? [draft.offenses[0].id] : [],
        });
        draft.persons.push(link);
        pendingFocus.current = `persons[${link.id}].role`;
      });
    },
    [update],
  );

  const removePerson = useCallback(
    (incidentPersonId: string) => {
      const link = incident?.persons.find((p) => p.id === incidentPersonId);
      const masterId = link?.masterId;
      update((draft) => {
        draft.persons = draft.persons.filter((p) => p.id !== incidentPersonId);
        for (const person of draft.persons) {
          person.relationships = person.relationships.filter(
            (r) => r.offenderId !== incidentPersonId,
          );
        }
        for (const item of draft.property) {
          if (item.ownerPersonId === incidentPersonId) item.ownerPersonId = '';
        }
        for (const v of draft.vehicles) {
          if (v.ownerPersonId === incidentPersonId) v.ownerPersonId = '';
        }
      });
      // Drop the identity too if this was the only report it appeared on, so a
      // mistakenly-added person does not linger in the index forever.
      if (masterId && isOrphaned(masterId, incidentPersonId)) {
        setPeople((prev) => {
          const next = { ...prev };
          delete next[masterId];
          return next;
        });
      }
    },
    [incident, update, isOrphaned],
  );

  const updateInvolvement = useCallback(
    (incidentPersonId: string, patch: Partial<IncidentPerson>) => {
      update((draft) => {
        const target = draft.persons.find((p) => p.id === incidentPersonId);
        if (target) Object.assign(target, patch);
      });
    },
    [update],
  );

  const linkToMaster = useCallback(
    (incidentPersonId: string, masterId: string) => {
      const link = incident?.persons.find((p) => p.id === incidentPersonId);
      const previous = link?.masterId;
      update((draft) => {
        const target = draft.persons.find((p) => p.id === incidentPersonId);
        if (target) target.masterId = masterId;
      });
      if (previous && previous !== masterId && isOrphaned(previous, incidentPersonId)) {
        setPeople((prev) => {
          const next = { ...prev };
          delete next[previous];
          return next;
        });
      }
    },
    [incident, update, isOrphaned],
  );

  const updateIdentity = useCallback(
    (masterId: string, patch: Partial<MasterPerson>, source: FieldSource = 'officer') => {
      const now = new Date().toISOString();

      setPeople((prev) => {
        const current = prev[masterId];
        if (!current) return prev;
        const next: MasterPerson = { ...current, ...patch, updatedAt: now };
        markDirty('people', masterId);
        const provenance = { ...current.provenance };
        for (const key of Object.keys(patch)) {
          if ((PROVENANCED_FIELDS as readonly string[]).includes(key)) {
            provenance[key as ProvenancedField] = {
              source,
              verified: source === 'officer',
              at: now,
            };
          }
        }
        next.provenance = provenance;
        return { ...prev, [masterId]: next };
      });
      setSavedAt(now);
    },
    [],
  );

  /**
   * A hit on a genuinely unique identifier is safe to link without asking.
   * Anything weaker is only ever proposed — see `domain/matching.ts`.
   */
  useEffect(() => {
    if (!incident) return;
    for (const link of incident.persons) {
      const master = people[link.masterId];
      if (!master) continue;
      // Only fold away an identity this report itself created.
      if (!isOrphaned(master.id, link.id)) continue;
      const candidate = autoLinkCandidate(
        findMatches(master, people, { excludeIds: [master.id] }),
      );
      if (!candidate) continue;

      setAutoLink({
        incidentPersonId: link.id,
        previousMasterId: master.id,
        linkedMasterId: candidate.master.id,
        name: displayName(candidate.master),
      });
      linkToMaster(link.id, candidate.master.id);
      break;
    }
  }, [incident, people, isOrphaned, linkToMaster]);

  const undoAutoLink = useCallback(() => {
    if (!autoLink) return;
    const restored = people[autoLink.linkedMasterId];
    const clone: MasterPerson = {
      ...structuredClone(restored),
      id: autoLink.previousMasterId,
      mergedFrom: [],
    };
    setPeople((prev) => ({ ...prev, [clone.id]: clone }));
    update((draft) => {
      const target = draft.persons.find((p) => p.id === autoLink.incidentPersonId);
      if (target) target.masterId = clone.id;
    });
    setAutoLink(null);
  }, [autoLink, people, update]);

  const dismissAutoLink = useCallback(() => setAutoLink(null), []);

  const matchesFor = useCallback(
    (incidentPersonId: string) => {
      const link = incident?.persons.find((p) => p.id === incidentPersonId);
      const master = link && people[link.masterId];
      if (!master) return [];
      const alreadyOnReport = (incident?.persons ?? []).map((p) => p.masterId);
      return findMatches(master, people, {
        excludeIds: [...new Set([master.id, ...alreadyOnReport])],
        limit: 5,
      });
    },
    [incident, people],
  );

  const searchPeople = useCallback(
    (query: string, limit = 25) => {
      const q = query.trim().toLowerCase();
      const all = Object.values(people);
      const matched = q
        ? all.filter((p) =>
            [
              p.lastName,
              p.firstName,
              p.middleName,
              p.businessName,
              p.dob,
              p.address,
              p.phone,
              p.driverLicense,
              ...p.aliases,
            ]
              .join(' ')
              .toLowerCase()
              .includes(q),
          )
        : all;
      return matched
        .sort((a, b) => displayName(a).localeCompare(displayName(b)))
        .slice(0, limit);
    },
    [people],
  );

  const historyFor = useCallback(
    (masterId: string) =>
      incidents
        .flatMap((inc) => {
          const link = inc.persons.find((p) => p.masterId === masterId);
          return link ? [{ incident: inc, role: link.role }] : [];
        })
        .sort((a, b) => b.incident.reportedAt.localeCompare(a.incident.reportedAt)),
    [incidents],
  );

  /* -------------------------------------------------- locations -------- */

  const setLocation = useCallback(
    (locationId: string) => {
      update((draft) => {
        draft.locationId = locationId;
      });
    },
    [update],
  );

  /**
   * Creates a place the index has not seen. An exact address already on file
   * is reused instead — that is what keeps one storage facility to one record.
   */
  const createAndSetLocation = useCallback(
    (draft: Partial<MasterLocation>) => {
      const existing = autoLinkLocation(
        findLocations({ address: draft.address, commonName: draft.commonName, city: draft.city }, locations),
      );
      if (existing) {
        setLocation(existing.location.id);
        return;
      }
      const created = createLocation({
        // Anything the form did not fill in falls back to the jurisdiction.
        city: agency.city,
        state: agency.state,
        ...draft,
      });
      setLocations((prev) => ({ ...prev, [created.id]: created }));
      markDirty('locations', created.id);
      setLocation(created.id);
    },
    [locations, setLocation, agency.city, agency.state],
  );

  const updateLocation = useCallback((locationId: string, patch: Partial<MasterLocation>) => {
    setLocations((prev) => {
      const current = prev[locationId];
      if (!current) return prev;
      markDirty('locations', locationId);
      return {
        ...prev,
        [locationId]: { ...current, ...patch, updatedAt: new Date().toISOString() },
      };
    });
    setSavedAt(new Date().toISOString());
  }, []);

  const addNote = useCallback(
    (locationId: string, note: { kind: NoteKind; text: string; sensitive: boolean }) => {
      let noteAdded: PremiseNote | null = null;
      setLocations((prev) => {
        const current = prev[locationId];
        if (!current) return prev;
        const entry = createNote({ ...note, author: currentUser.name || 'Unknown officer' });
        noteAdded = entry;
        markDirty('locations', locationId);
        return {
          ...prev,
          [locationId]: {
            ...current,
            notes: [...current.notes, entry],
            updatedAt: new Date().toISOString(),
          },
        };
      });
      setSavedAt(new Date().toISOString());
      record({
        actorId: currentUser.id,
        actorName: currentUser.name,
        action: 'note.added',
        target: locationsRef.current[locationId]?.commonName || locationsRef.current[locationId]?.address || '',
        detail: `${note.kind}${note.sensitive ? ' · restricted' : ''}`,
      });
      void noteAdded;
    },
    [currentUser, record],
  );

  const updateNote = useCallback(
    (locationId: string, noteId: string, patch: Partial<PremiseNote>) => {
      setLocations((prev) => {
        const current = prev[locationId];
        if (!current) return prev;
        return {
          ...prev,
          [locationId]: {
            ...current,
            notes: current.notes.map((n) => (n.id === noteId ? { ...n, ...patch } : n)),
            updatedAt: new Date().toISOString(),
          },
        };
      });
      setSavedAt(new Date().toISOString());
    },
    [],
  );

  /**
   * Withdrawal, not deletion. The note stops showing on the location but the
   * record survives with its author, its text, and who withdrew it — because
   * "who removed the gate code, and when" is asked after something goes wrong.
   */
  const retractNote = useCallback(
    (locationId: string, noteId: string, reason: string) => {
      if (!canDo(currentUser, 'notes.retract')) return;
      const now = new Date().toISOString();
      setLocations((prev) => {
        const current = prev[locationId];
        if (!current) return prev;
        markDirty('locations', locationId);
        return {
          ...prev,
          [locationId]: {
            ...current,
            notes: current.notes.map((n) =>
              n.id === noteId
                ? { ...n, retractedAt: now, retractedBy: currentUser.name, retractionReason: reason }
                : n,
            ),
            updatedAt: now,
          },
        };
      });
      setSavedAt(now);
      record({
        actorId: currentUser.id,
        actorName: currentUser.name,
        action: 'note.retracted',
        target: locationsRef.current[locationId]?.commonName || locationsRef.current[locationId]?.address || '',
        detail: reason,
      });
    },
    [currentUser, record],
  );

  const restoreNote = useCallback(
    (locationId: string, noteId: string) => {
      if (!canDo(currentUser, 'notes.retract')) return;
      setLocations((prev) => {
        const current = prev[locationId];
        if (!current) return prev;
        return {
          ...prev,
          [locationId]: {
            ...current,
            notes: current.notes.map((n) =>
              n.id === noteId
                ? { ...n, retractedAt: '', retractedBy: '', retractionReason: '' }
                : n,
            ),
          },
        };
      });
    },
    [currentUser],
  );

  /**
   * Every write to an account is filtered through the actor's own authority,
   * so a request for a role or a permission they do not hold is dropped rather
   * than trusted. The UI hides those options too, but the UI is not the guard.
   */
  const createAccount = useCallback(
    async (input: Partial<User>): Promise<GuardResult & { temporaryPassword?: string }> => {
      try {
        const { user, temporaryPassword } = await api.createUser(input);
        setUsers((prev) => [...prev, user]);
        void api.auditLog().then(({ entries }) => setAuditLog(entries)).catch(() => undefined);
        setSavedAt(new Date().toISOString());
        return { ok: true, temporaryPassword };
      } catch (error) {
        // The server refuses over-reaching requests outright rather than
        // quietly creating something lesser, so its reason is the useful one.
        return failed(error, 'Could not create the account.');
      }
    },
    [],
  );

  const updateUser = useCallback(
    (userId: string, patch: Partial<User>): GuardResult => {
      const target = users.find((u) => u.id === userId);
      if (!target) return { ok: false, reason: 'No such account.' };
      if (!canManageUser(currentUser, target)) {
        return { ok: false, reason: 'This account has more authority than yours.' };
      }
      // Nobody may strip their own ability to manage accounts.
      if (userId === currentUser.id && patch.role && patch.role !== currentUser.role) {
        return { ok: false, reason: 'You cannot change your own role.' };
      }
      const safe = sanitizeUserInput(currentUser, patch);
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...safe } : u)));
      record({
        actorId: currentUser.id,
        actorName: currentUser.name,
        action: 'user.updated',
        target: target.name,
        detail: Object.keys(safe).join(', '),
      });
      setSavedAt(new Date().toISOString());
      return { ok: true };
    },
    [currentUser, users, record],
  );

  const deactivateUser = useCallback(async (userId: string): Promise<GuardResult> => {
    try {
      await api.deactivateUser(userId);
      await refresh();
      setSavedAt(new Date().toISOString());
      return { ok: true };
    } catch (error) {
      return failed(error, 'Could not deactivate.');
    }
  }, [refresh]);

  const reactivateUser = useCallback(async (userId: string): Promise<GuardResult> => {
    try {
      await api.reactivateUser(userId);
      await refresh();
      return { ok: true };
    } catch (error) {
      return failed(error, 'Could not reactivate.');
    }
  }, [refresh]);

  /* -------------------------------------------------- locations ------- */

  /** Jurisdiction centre, used to rank search results by distance. */
  const searchOrigin = useMemo(() => {
    const center = centerOf(agency.boundary) ?? centerOf(agency.zones);
    return center ? { latitude: center[1], longitude: center[0] } : null;
  }, [agency.boundary, agency.zones]);

  const locationSearch = useCallback(
    (query: string, limit = 20) =>
      searchLocationIndex(query, locations, { limit, origin: searchOrigin }),
    [locations, searchOrigin],
  );

  const nearbyLocations = useCallback(
    (latitude: number, longitude: number, radiusMeters = 500) =>
      findNearby(latitude, longitude, locations, radiusMeters),
    [locations],
  );

  const locationMatches = useCallback(
    (query: { address?: string; commonName?: string; city?: string }) =>
      findLocations(query, locations, { limit: 5 }),
    [locations],
  );

  const notesFor = useCallback(
    (locationId: string) => activeNotes(locations[locationId]),
    [locations],
  );

  const locationHistory = useCallback(
    (locationId: string) =>
      incidents
        .filter((i) => i.locationId === locationId)
        .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt)),
    [incidents],
  );

  const zoneAt = useCallback(
    (lon: number, lat: number) => featureName(featureAt(lon, lat, agency.zones)),
    [agency.zones],
  );

  const insideJurisdiction = useCallback(
    (lon: number, lat: number) => {
      // With no boundary loaded there is nothing to be outside of.
      if (!agency.boundary) return true;
      return featureAt(lon, lat, agency.boundary) !== null;
    },
    [agency.boundary],
  );

  /**
   * Dropping a pin also settles the patrol area. Deriving it from the boundary
   * file is the whole point of loading one — a beat typed from memory is the
   * field that most often comes back wrong.
   */
  const setLocationPoint = useCallback(
    (locationId: string, lon: number, lat: number, source: 'pin' | 'typed' = 'pin') => {
      const derived = featureName(featureAt(lon, lat, agency.zones));
      setLocations((prev) => {
        const current = prev[locationId];
        if (!current) return prev;
        markDirty('locations', locationId);
        return {
          ...prev,
          [locationId]: {
            ...current,
            latitude: lat,
            longitude: lon,
            geoSource: source,
            // Never silently overwrite a beat someone set by hand.
            beat: derived || current.beat,
            updatedAt: new Date().toISOString(),
          },
        };
      });
      setSavedAt(new Date().toISOString());
    },
    [agency.zones],
  );

  const updateAgency = useCallback((patch: Partial<AgencyProfile>) => {
    setAgency((prev) => {
      const next = { ...prev, ...patch };
      // Agency setup is admin-gated server-side; a refusal here is expected
      // for anyone else and leaves the stored copy untouched.
      void api.putAgency(next).catch(() => undefined);
      return next;
    });
    setSavedAt(new Date().toISOString());
  }, []);

  /* -------------------------------------------------- auth ------------- */

  const signIn = useCallback(
    async (username: string, password: string): Promise<SignInOutcome> => {
      try {
        const me = await api.signIn(username, password);
        setIdentity(me);
        // Display-only mirror; the server holds the session that counts.
        setSession(createSession(me.user.id, 'local'));
        await refresh();
        setConnectionError(null);
        return { ok: true, mustChangePassword: me.mustChangePassword };
      } catch (error) {
        return failed(error, 'Could not sign in.');
      }
    },
    [refresh],
  );

  const signOut = useCallback(() => {
    void api.signOut().catch(() => undefined);
    setIdentity(null);
    setSession(null);
    setActiveId(null);
    // Nothing the signed-out user should still be holding.
    setIncidents([]);
    setPeople({});
    setLocations({});
    setUsers([]);
    setAuditLog([]);
  }, []);

  const changePassword = useCallback(
    async (current: string, next: string): Promise<GuardResult> => {
      try {
        await api.changePassword(current, next);
        setIdentity((prev) => (prev ? { ...prev, mustChangePassword: false } : prev));
        return { ok: true };
      } catch (error) {
        return failed(error, 'Could not change the password.');
      }
    },
    [],
  );

  /**
   * Idle and absolute session timeouts. A car laptop gets left unattended, so
   * the session has to end on its own rather than waiting to be closed.
   */
  useEffect(() => {
    if (!session) return;
    const tick = window.setInterval(() => {
      // The server enforces both timeouts and will simply stop recognising
      // the cookie; this only notices and clears the screen.
      void api.me().then((me) => {
        if (!me) {
          setIdentity(null);
          setSession(null);
          setActiveId(null);
        }
      }).catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(tick);
  }, [session]);

  /** Any interaction counts as activity for the idle timeout. */
  useEffect(() => {
    if (!session) return;
    let pending = false;
    const onActivity = () => {
      if (pending) return;
      pending = true;
      window.setTimeout(() => {
        pending = false;
        setSession((prev) => (prev ? touchSession(prev) : prev));
      }, 60_000);
    };
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);
    return () => {
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, [session]);

  /* -------------------------------------------------- lifecycle -------- */
  const resetEditorState = useCallback(() => {
    setActiveSectionState('incident');
    setVisitedSections(new Set(['incident']));
    setSubmitAttempted(false);
    setRevealedPaths(new Set());
    setAutoLink(null);
    setSavedAt(null);
  }, []);

  const openIncident = useCallback(
    (id: string) => {
      setActiveId(id);
      resetEditorState();
    },
    [resetEditorState],
  );

  const closeIncident = useCallback(() => setActiveId(null), []);

  const createNew = useCallback(() => {
    const fresh = createIncident({
      caseNumber: newCaseNumber(incidents.length + 1),
      reportingOfficer: 'M. Reyes',
      reportingBadge: '4417',
      unit: 'Patrol 12',
    });
    setIncidents((prev) => [fresh, ...prev]);
    setActiveId(fresh.id);
    resetEditorState();
  }, [incidents.length, resetEditorState]);

  const deleteIncident = useCallback(
    (id: string) => {
      setIncidents((prev) => prev.filter((i) => i.id !== id));
      if (activeId === id) setActiveId(null);
    },
    [activeId],
  );

  /* -------------------------------------------------- review ----------- */

  const reportEditable = incident ? isEditable(incident.status) : false;

  /** Applies a report the server just returned, keeping its new version. */
  const adoptReport = useCallback(async () => {
    await refresh().catch(() => undefined);
  }, [refresh]);

  const submitForReview = useCallback(async (): Promise<GuardResult> => {
    if (!incident) return { ok: false, reason: 'No report is open.' };
    setSubmitAttempted(true);
    if (!validation.canSubmit) {
      const first = validation.errors[0];
      if (first) goToIssue(first);
      return { ok: false, reason: 'Fix the blocking problems first.' };
    }
    try {
      await api.submitReport(incident.id);
      await adoptReport();
      return { ok: true };
    } catch (error) {
      return failed(error, 'Could not submit.');
    }
  }, [incident, validation, goToIssue, adoptReport]);

  const approveReport = useCallback(
    async (note: string): Promise<GuardResult> => {
      if (!incident) return { ok: false, reason: 'No report is open.' };
      try {
        await api.approveReport(incident.id, note);
        await adoptReport();
        return { ok: true };
      } catch (error) {
        return failed(error, 'Could not approve.');
      }
    },
    [incident, adoptReport],
  );

  const returnReport = useCallback(
    async (
      reason: string,
      comments: { path: string; section: string; message: string }[],
    ): Promise<GuardResult> => {
      if (!incident) return { ok: false, reason: 'No report is open.' };
      try {
        await api.returnReport(incident.id, reason, comments);
        await adoptReport();
        return { ok: true };
      } catch (error) {
        return failed(error, 'Could not return it.');
      }
    },
    [incident, adoptReport],
  );

  const reopenReport = useCallback(
    async (reason: string): Promise<GuardResult> => {
      if (!incident) return { ok: false, reason: 'No report is open.' };
      try {
        await api.reopenReport(incident.id, reason);
        await adoptReport();
        return { ok: true };
      } catch (error) {
        return failed(error, 'Could not reopen.');
      }
    },
    [incident, adoptReport],
  );

  const resolveReviewComment = useCallback(
    (commentId: string) => {
      if (!incident) return;
      void api.resolveComment(incident.id, commentId).then(adoptReport).catch(() => undefined);
    },
    [incident, adoptReport],
  );

  const attemptSubmit = useCallback(() => {
    setSubmitAttempted(true);
    if (!validation.canSubmit) {
      const first = validation.errors[0];
      if (first) goToIssue(first);
      return false;
    }
    void submitForReview();
    return true;
  }, [validation, goToIssue, submitForReview]);

  const value: StoreValue = {
    incidents,
    people,
    locations,
    agency,
    users,
    currentUser,
    can,
    session,
    isAuthenticated,
    loading,
    connectionError,
    conflict,
    dismissConflict,
    locks,
    lockOn,
    takeOverLock,
    attachments,
    reportEditable,
    submitForReview,
    approveReport,
    returnReport,
    reopenReport,
    resolveReviewComment,
    uploadAttachment,
    retractAttachment,
    verifyAttachment: verifyAttachmentFile,
    mustChangePassword,
    auditLog,
    signIn,
    signOut,
    changePassword,
    record,
    verifyAuditLog,
    createAccount,
    updateUser,
    deactivateUser,
    reactivateUser,
    incident,
    persons,
    location,
    validation,
    activeSection,
    visitedSections,
    submitAttempted,
    revealedPaths,
    savedAt,
    autoLink,
    openIncident,
    closeIncident,
    createNew,
    deleteIncident,
    update,
    setSection,
    goToIssue,
    applyQuickFix,
    crashes,
    crash,
    crashProblems,
    openCrash,
    closeCrash,
    startCrash,
    updateCrash,
    updateUnit,
    addUnit,
    removeUnit,
    submitCrash,
    approveCrash,
    returnCrash,
    reopenCrash,

    arrests,
    arrest,
    arrestProblems,
    openArrest,
    closeArrest,
    startArrest,
    updateArrest,
    addCharge,
    updateCharge,
    removeCharge,
    submitArrest,
    approveArrest,
    returnArrest,
    reopenArrest,
    arrestsForCase,

    cruisers,
    cruiserChecks,
    maintenanceRequests,
    maintenanceQueue,
    refreshFleet,
    addCruiser,
    updateCruiser,
    fileCheck,
    reportFault,
    moveRequest,

    photos,
    photosOf,
    faceOf,
    photoRequests,
    addPhoto,
    requestPhotoRemoval,
    decidePhoto,

    caseTasks,
    tasksForCase,
    taskSummary,
    addTask,
    setTaskDone,
    editTask,
    removeTask,

    returns,
    sceneReturns,
    applyReturn,
    applyCallDetails,

    stops,
    logStop,
    saveStop,
    removeStop,

    evidence,
    bookEvidence,
    recordCustody,
    updateEvidence,
    loadEvidence,

    feedback,
    feedbackForwarding,
    sendFeedback,
    secondFeedback,
    answerFeedback,
    forwardFeedback,

    supplements,
    caseSupplements,
    supplement,
    supplementProblems,
    canAddSupplement,
    openSupplement,
    closeSupplement,
    startSupplement,
    updateSupplement,
    submitSupplement,
    approveSupplement,
    returnSupplement,
    reopenSupplement,

    suggestions,
    dismissedSuggestions,
    acceptedSuggestions,
    acceptSuggestion,
    dismissSuggestion,
    showSuggestion,
    undoSuggestion,
    resetSuggestions,
    extraction,
    readWithModel,
    revealField,
    attemptSubmit,
    registerField,
    addNewPerson,
    addExistingPerson,
    removePerson,
    updateInvolvement,
    updateIdentity,
    linkToMaster,
    undoAutoLink,
    dismissAutoLink,
    matchesFor,
    searchPeople,
    historyFor,
    setLocation,
    createAndSetLocation,
    updateLocation,
    addNote,
    updateNote,
    retractNote,
    restoreNote,
    locationSearch,
    nearbyLocations,
    locationMatches,
    notesFor,
    locationHistory,
    setLocationPoint,
    zoneAt,
    insideJurisdiction,
    updateAgency,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}
