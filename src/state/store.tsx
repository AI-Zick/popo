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
import { createIncident, newCaseNumber } from '@/domain/factory';
import { runRules, type Issue, type ValidationResult } from '@/validation/engine';
import { ALL_RULES } from '@/validation/rules';
import { loadIncidents, saveIncidents } from './persistence';

type Mutator = (draft: Incident) => void;

interface StoreValue {
  incidents: Incident[];
  incident: Incident | null;
  validation: ValidationResult;
  activeSection: SectionId;
  /** Sections the user has visited — used to hold back errors on untouched sections. */
  visitedSections: Set<SectionId>;
  /** True once the user has attempted to submit; unlocks every error at once. */
  submitAttempted: boolean;
  /** Field paths whose inline errors have been revealed (blurred or jumped to). */
  revealedPaths: Set<string>;
  savedAt: string | null;

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
}

const StoreContext = createContext<StoreValue | null>(null);

const EMPTY_VALIDATION = runRules(createIncident(), []);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [incidents, setIncidents] = useState<Incident[]>(() => loadIncidents());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeSection, setActiveSectionState] = useState<SectionId>('incident');
  const [visitedSections, setVisitedSections] = useState<Set<SectionId>>(() => new Set(['incident']));
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [revealedPaths, setRevealedPaths] = useState<Set<string>>(() => new Set());

  const fields = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);

  const incident = useMemo(
    () => incidents.find((i) => i.id === activeId) ?? null,
    [incidents, activeId],
  );

  const validation = useMemo(
    () => (incident ? runRules(incident, ALL_RULES) : EMPTY_VALIDATION),
    [incident],
  );

  /* -------------------------------------------------- persistence ------ */
  useEffect(() => {
    saveIncidents(incidents);
  }, [incidents]);

  /* -------------------------------------------------- field registry --- */
  const registerField = useCallback((path: string, el: HTMLElement | null) => {
    if (el) fields.current.set(path, el);
    else fields.current.delete(path);
  }, []);

  /**
   * Focus a registered field. The element may not exist yet — the section may
   * have just switched, or the record may have just been created by a quick
   * fix — so retry across a handful of frames before giving up.
   */
  const focusPath = useCallback((path: string, attempt = 0) => {
    const el = fields.current.get(path);
    if (!el) {
      if (attempt < 12) {
        requestAnimationFrame(() => focusPath(path, attempt + 1));
      }
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Focus the control itself when the registered node is a wrapper.
    const focusable =
      el.matches('input, select, textarea, button, [tabindex]')
        ? el
        : el.querySelector<HTMLElement>('input, select, textarea, button, [tabindex]');
    focusable?.focus({ preventScroll: true });

    el.classList.remove('field-flash');
    // Force a reflow so the animation restarts when jumping to the same field twice.
    void el.offsetWidth;
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
      setVisitedSections((prev) => {
        const next = new Set(prev);
        next.add(issue.section);
        return next;
      });
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
      setIncidents((prev) =>
        prev.map((item) => {
          if (item.id !== activeId) return item;
          const draft = structuredClone(item);
          const result = issue.quickFix!.apply(draft);
          focusTarget = typeof result === 'string' ? result : undefined;
          draft.updatedAt = new Date().toISOString();
          return draft;
        }),
      );
      setSavedAt(new Date().toISOString());
      if (focusTarget) {
        setSection(issue.section);
        pendingFocus.current = focusTarget;
      }
    },
    [activeId, setSection],
  );

  /* -------------------------------------------------- lifecycle -------- */
  const openIncident = useCallback((id: string) => {
    setActiveId(id);
    setActiveSectionState('incident');
    setVisitedSections(new Set(['incident']));
    setSubmitAttempted(false);
    setRevealedPaths(new Set());
    setSavedAt(null);
  }, []);

  const closeIncident = useCallback(() => {
    setActiveId(null);
  }, []);

  const createNew = useCallback(() => {
    const sequence = incidents.length + 1;
    const fresh = createIncident({
      caseNumber: newCaseNumber(sequence),
      state: 'AL',
      reportingOfficer: 'M. Reyes',
      reportingBadge: '4417',
      unit: 'Patrol 12',
    });
    setIncidents((prev) => [fresh, ...prev]);
    setActiveId(fresh.id);
    setActiveSectionState('incident');
    setVisitedSections(new Set(['incident']));
    setSubmitAttempted(false);
    setRevealedPaths(new Set());
  }, [incidents.length]);

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
    return true;
  }, [validation, goToIssue, update]);

  const value: StoreValue = {
    incidents,
    incident,
    validation,
    activeSection,
    visitedSections,
    submitAttempted,
    revealedPaths,
    savedAt,
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
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}

/** The active incident, asserted non-null for editor screens. */
export function useIncident(): Incident {
  const { incident } = useStore();
  if (!incident) throw new Error('No active incident');
  return incident;
}
