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
  createNote,
  newCaseNumber,
} from '@/domain/factory';
import { autoLinkCandidate, findMatches, type MatchResult } from '@/domain/matching';
import { emptyAgency, type AgencyProfile } from '@/domain/agency';
import { ROLE_LABEL as ROLE_LABEL_FOR_AUDIT } from '@/domain/auth';
import {
  can as canDo,
  canDeactivate,
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
import { newId } from '@/lib/id';
import { hashPassword, checkPassword, generateTemporaryPassword, verifyPassword } from '@/domain/credentials';
import {
  createCredential,
  createSession,
  isLockedOut,
  lockoutRemainingMs,
  registerFailure,
  registerSuccess,
  sessionState,
  touchSession,
  SIGN_IN_FAILURE_MESSAGE,
  type Credential,
  type Session,
  type SignInOutcome,
} from '@/domain/session';
import { appendEntry, verifyChain, type AuditDraft, type AuditEntry, type ChainStatus } from '@/domain/audit';
import { runRules, type Issue, type ValidationResult } from '@/validation/engine';
import { ALL_RULES } from '@/validation/rules';
import { loadState, saveState } from './persistence';
import { DEMO_PASSWORD } from './seed';

type Mutator = (draft: Incident) => void;

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
  /** Null until someone signs in. */
  session: Session | null;
  isAuthenticated: boolean;
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
  deactivateUser: (userId: string) => GuardResult;
  reactivateUser: (userId: string) => GuardResult;
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

export function StoreProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => loadState(), []);
  const [incidents, setIncidents] = useState<Incident[]>(initial.incidents);
  const [people, setPeople] = useState<PersonIndex>(initial.people);
  const [locations, setLocations] = useState<LocationIndex>(initial.locations);
  const [agency, setAgency] = useState<AgencyProfile>(initial.agency ?? emptyAgency());
  const [users, setUsers] = useState<User[]>(initial.users);
  const [credentials, setCredentials] = useState<Record<string, Credential>>(initial.credentials);
  const [session, setSession] = useState<Session | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>(initial.auditLog);

  // The log is kept in a ref as well, so serialised appends always chain onto
  // the newest entry rather than a stale render's copy.
  const logRef = useRef<AuditEntry[]>(initial.auditLog);
  const auditQueue = useRef<Promise<void>>(Promise.resolve());

  const currentUser = useMemo(
    () =>
      users.find((u) => u.id === session?.userId) ??
      createUser({ id: 'anonymous', name: 'Not signed in' }),
    [users, session],
  );

  const isAuthenticated = Boolean(session) && currentUser.id !== 'anonymous';
  const mustChangePassword = Boolean(
    session && credentials[session.userId]?.mustChangePassword,
  );

  const record = useCallback((draft: AuditDraft) => {
    auditQueue.current = auditQueue.current.then(async () => {
      const next = await appendEntry(logRef.current, draft, newId('aud'));
      logRef.current = next;
      setAuditLog(next);
    });
  }, []);

  const verifyAuditLog = useCallback(() => verifyChain(logRef.current), []);

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
  const locationsRef = useRef<LocationIndex>(initial.locations);
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

  const validation = useMemo(
    () =>
      incident ? runRules(incident, ALL_RULES, { people, locations, agency }) : EMPTY_VALIDATION,
    [incident, people, locations, agency],
  );

  incidentRef.current = incident;
  locationsRef.current = locations;

  useEffect(() => {
    saveState({ incidents, people, locations, agency, users, credentials, auditLog });
  }, [incidents, people, locations, agency, users, credentials, auditLog]);

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
      let focusTarget: string | undefined = undefined;
      const draftPeople = structuredClone(people);
      setIncidents((prev) =>
        prev.map((item) => {
          if (item.id !== activeId) return item;
          const draft = structuredClone(item);
          const result = issue.quickFix!.apply(draft, draftPeople);
          focusTarget = typeof result === 'string' ? result : undefined;
          draft.updatedAt = new Date().toISOString();
          return draft;
        }),
      );
      setPeople(draftPeople);
      setSavedAt(new Date().toISOString());
      if (focusTarget) {
        setSection(issue.section);
        revealField(focusTarget);
        pendingFocus.current = focusTarget;
      }
    },
    [activeId, people, setSection, revealField],
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
      setLocation(created.id);
    },
    [locations, setLocation, agency.city, agency.state],
  );

  const updateLocation = useCallback((locationId: string, patch: Partial<MasterLocation>) => {
    setLocations((prev) => {
      const current = prev[locationId];
      if (!current) return prev;
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
      if (!canDo(currentUser, 'users.manage')) {
        return { ok: false, reason: 'You do not have permission to manage accounts.' };
      }
      const safe = sanitizeUserInput(currentUser, input);
      if (!safe.name?.trim()) return { ok: false, reason: 'A name is required.' };
      const username = safe.username?.trim().toLowerCase() ?? '';
      if (!username) return { ok: false, reason: 'A username is required.' };
      if (users.some((u) => u.username.toLowerCase() === username)) {
        return { ok: false, reason: 'That username is already in use.' };
      }

      const account = createUser({
        id: newId('usr'),
        ...safe,
        username,
        name: safe.name.trim(),
        createdBy: currentUser.name,
      });

      // Issued once, shown once, and must be changed at first sign-in.
      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await hashPassword(temporaryPassword);

      setUsers((prev) => [...prev, account]);
      setCredentials((prev) => ({
        ...prev,
        [account.id]: createCredential(account.id, { passwordHash, mustChangePassword: true }),
      }));
      record({
        actorId: currentUser.id,
        actorName: currentUser.name,
        action: 'user.created',
        target: account.name,
        detail: `${ROLE_LABEL_FOR_AUDIT[account.role]}${account.grants.length ? ` · designated: ${account.grants.join(', ')}` : ''}`,
      });
      setSavedAt(new Date().toISOString());
      return { ok: true, temporaryPassword };
    },
    [currentUser, users, record],
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

  const deactivateUser = useCallback(
    (userId: string): GuardResult => {
      const target = users.find((u) => u.id === userId);
      if (!target) return { ok: false, reason: 'No such account.' };
      const guard = canDeactivate(currentUser, target, users);
      if (!guard.ok) return guard;

      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, active: false, deactivatedAt: new Date().toISOString() } : u,
        ),
      );
      record({
        actorId: currentUser.id,
        actorName: currentUser.name,
        action: 'user.deactivated',
        target: target.name,
        detail: '',
      });
      setSavedAt(new Date().toISOString());
      return { ok: true };
    },
    [currentUser, users, record],
  );

  const reactivateUser = useCallback(
    (userId: string): GuardResult => {
      const target = users.find((u) => u.id === userId);
      if (!target) return { ok: false, reason: 'No such account.' };
      if (!canManageUser(currentUser, target)) {
        return { ok: false, reason: 'This account has more authority than yours.' };
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, active: true, deactivatedAt: '' } : u)),
      );
      record({
        actorId: currentUser.id,
        actorName: currentUser.name,
        action: 'user.reactivated',
        target: target.name,
        detail: '',
      });
      return { ok: true };
    },
    [currentUser, users],
  );

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
    setAgency((prev) => ({ ...prev, ...patch }));
    setSavedAt(new Date().toISOString());
  }, []);

  /* -------------------------------------------------- auth ------------- */

  /**
   * Demo bootstrap. Hashing is async so it cannot happen in the seed, and a
   * real deployment issues credentials at provisioning time instead. This only
   * runs when no credentials exist at all.
   */
  useEffect(() => {
    if (Object.keys(credentials).length > 0) return;
    let cancelled = false;
    void (async () => {
      const passwordHash = await hashPassword(DEMO_PASSWORD);
      if (cancelled) return;
      const seeded: Record<string, Credential> = {};
      for (const user of users) {
        seeded[user.id] = createCredential(user.id, {
          passwordHash,
          mustChangePassword: false,
        });
      }
      setCredentials(seeded);
    })();
    return () => {
      cancelled = true;
    };
  }, [credentials, users]);

  /**
   * Every failure returns the same message. Distinguishing "no such user" from
   * "wrong password" hands an attacker a way to enumerate valid usernames,
   * which is the first thing they want. Lockout is the one exception, because
   * the real account holder needs to understand why they cannot get in.
   */
  const signIn = useCallback(
    async (username: string, password: string): Promise<SignInOutcome> => {
      const now = Date.now();
      const handle = username.trim().toLowerCase();
      const user = users.find((u) => u.username.toLowerCase() === handle);
      const credential = user ? credentials[user.id] : undefined;

      if (!user || !user.active || !credential?.passwordHash) {
        // Still do the work, so a missing account does not answer faster than
        // a wrong password and reveal itself by timing.
        await verifyPassword(password, 'pbkdf2$sha256$210000$c2FsdHNhbHRzYWx0c2E=$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
        record({
          actorId: '',
          actorName: username.trim() || 'unknown',
          action: 'auth.signInFailed',
          target: '',
          detail: 'No matching active account',
        });
        return { ok: false, reason: SIGN_IN_FAILURE_MESSAGE };
      }

      if (isLockedOut(credential, now)) {
        const minutes = Math.ceil(lockoutRemainingMs(credential, now) / 60_000);
        return {
          ok: false,
          reason: `This account is locked after too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask an administrator to unlock it.`,
        };
      }

      const valid = await verifyPassword(password, credential.passwordHash);

      if (!valid) {
        const failed = registerFailure(credential, now);
        setCredentials((prev) => ({ ...prev, [user.id]: failed }));
        record({
          actorId: '',
          actorName: user.username,
          action: 'auth.signInFailed',
          target: '',
          detail: `Attempt ${failed.failedAttempts}`,
        });
        if (isLockedOut(failed, now)) {
          record({
            actorId: '',
            actorName: user.username,
            action: 'auth.lockout',
            target: '',
            detail: 'Locked after repeated failures',
          });
        }
        return { ok: false, reason: SIGN_IN_FAILURE_MESSAGE };
      }

      setCredentials((prev) => ({ ...prev, [user.id]: registerSuccess(credential, now) }));
      setSession(createSession(user.id, newId('ses'), now));
      record({
        actorId: user.id,
        actorName: user.name,
        action: 'auth.signIn',
        target: '',
        detail: ROLE_LABEL_FOR_AUDIT[user.role],
      });
      return { ok: true, mustChangePassword: credential.mustChangePassword };
    },
    [users, credentials, record],
  );

  const signOut = useCallback(() => {
    if (session) {
      record({
        actorId: currentUser.id,
        actorName: currentUser.name,
        action: 'auth.signOut',
        target: '',
        detail: '',
      });
    }
    setSession(null);
    setActiveId(null);
  }, [session, currentUser, record]);

  const changePassword = useCallback(
    async (current: string, next: string): Promise<GuardResult> => {
      if (!session) return { ok: false, reason: 'Not signed in.' };
      const credential = credentials[session.userId];
      if (!credential) return { ok: false, reason: 'No credential on file.' };

      if (credential.passwordHash && !(await verifyPassword(current, credential.passwordHash))) {
        return { ok: false, reason: 'That is not your current password.' };
      }

      const policy = checkPassword(next, {
        username: currentUser.username,
        name: currentUser.name,
      });
      if (!policy.ok) return { ok: false, reason: policy.problems.join(' ') };

      if (await verifyPassword(next, credential.passwordHash)) {
        return { ok: false, reason: 'The new password must be different from the old one.' };
      }

      const passwordHash = await hashPassword(next);
      setCredentials((prev) => ({
        ...prev,
        [session.userId]: {
          ...credential,
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date().toISOString(),
        },
      }));
      record({
        actorId: currentUser.id,
        actorName: currentUser.name,
        action: 'auth.passwordChanged',
        target: '',
        detail: '',
      });
      return { ok: true };
    },
    [session, credentials, currentUser, record],
  );

  /**
   * Idle and absolute session timeouts. A car laptop gets left unattended, so
   * the session has to end on its own rather than waiting to be closed.
   */
  useEffect(() => {
    if (!session) return;
    const tick = window.setInterval(() => {
      const state = sessionState(session);
      if (state !== 'active') {
        setSession(null);
        setActiveId(null);
      }
    }, 30_000);
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

  const attemptSubmit = useCallback(() => {
    setSubmitAttempted(true);
    if (!validation.canSubmit) {
      const first = validation.errors[0];
      if (first) goToIssue(first);
      return false;
    }
    update((draft) => {
      draft.status = 'pending_review';
      draft.submittedAt = new Date().toISOString();
    });
    record({
      actorId: currentUser.id,
      actorName: currentUser.name,
      action: 'report.submitted',
      target: incident?.caseNumber ?? '',
      detail: '',
    });
    return true;
  }, [validation, goToIssue, update, record, currentUser, incident]);

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
