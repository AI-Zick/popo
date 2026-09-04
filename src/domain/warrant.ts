/**
 * Warrants.
 *
 * A court orders somebody arrested; the police carry it out. Like a trespass
 * notice, this is somebody else's instrument that the agency records and acts
 * on — and unlike almost everything else in this system, acting on it wrongly
 * puts a person in a cell who should not be there.
 *
 * Three things this file exists to get right.
 *
 * **This record is not authority to arrest.** It is what the agency believes
 * about a warrant, which is a different thing from what the court currently
 * holds. Warrants are recalled, quashed, satisfied and served by other
 * agencies, often hours before anybody updates a records system. Every
 * jurisdiction requires the officer to confirm a hit with the holding agency
 * before acting on it. The screen says so, every time, because a system that
 * displays a warrant like a fact invites an officer to treat it as one.
 *
 * **Extradition is not a footnote.** A warrant that is only extraditable
 * within the issuing state is not a warrant an officer two states away can
 * arrest on, and doing it anyway is a false arrest. It is carried next to the
 * charge rather than buried in a detail panel.
 *
 * **Attempts are a record of police activity.** They are never edited or
 * deleted. "We tried three times, and here is when" is what answers a
 * complaint that nobody bothered, and it is what shows a pattern when somebody
 * is never home at the address on file.
 */

import type { UUID } from './person';

/* ------------------------------------------------------------------ */
/* What kind of warrant                                                */
/* ------------------------------------------------------------------ */

export type WarrantKind = '' | 'arrest' | 'bench' | 'capias' | 'search' | 'civil' | 'probation';

export const KIND_LABEL: Record<WarrantKind, string> = {
  '': 'Not stated',
  arrest: 'Arrest warrant',
  bench: 'Bench warrant',
  capias: 'Capias',
  search: 'Search warrant',
  civil: 'Civil warrant',
  probation: 'Probation violation',
};

export const KIND_HINT: Record<WarrantKind, string> = {
  '': '',
  arrest: 'Issued on a charge, usually after a complaint or an indictment.',
  bench: 'Issued by a judge for failing to appear or comply.',
  capias: 'For an arrest after a charge is already filed — terms vary by state.',
  search: 'Authorises a search, not an arrest. Serving it is a different job.',
  civil: 'Civil process. Often not an arrest authority at all — read it.',
  probation: 'For breaching the conditions of a supervised release.',
};

/**
 * How far the issuing court will come to collect somebody.
 *
 * The field officers most need and most systems bury. A warrant marked for
 * the issuing county only is not a reason to hold somebody found three states
 * away, and an officer who does it anyway has made a false arrest — the
 * agency will be answering for it, not the court.
 */
export type Extradition = '' | 'none' | 'county' | 'state' | 'surrounding' | 'national';

export const EXTRADITION_LABEL: Record<Extradition, string> = {
  '': 'Not stated',
  none: 'Will not extradite',
  county: 'This county only',
  state: 'Within this state',
  surrounding: 'This state and those bordering it',
  national: 'Anywhere in the country',
};

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

export interface WarrantCharge {
  id: UUID;
  statute: string;
  description: string;
  /** Felony, misdemeanour and so on, in the same words an arrest uses. */
  severity: string;
  counts: string;
}

export type AttemptOutcome =
  | ''
  | 'notThere'
  | 'refusedEntry'
  | 'moved'
  | 'notHome'
  | 'served'
  | 'unsafe'
  | 'wrongAddress';

export const OUTCOME_LABEL: Record<AttemptOutcome, string> = {
  '': 'Not stated',
  notThere: 'Nobody there',
  notHome: 'Someone there, subject not home',
  refusedEntry: 'Entry refused',
  moved: 'Moved away',
  wrongAddress: 'Address is wrong',
  unsafe: 'Backed off — not safe to attempt alone',
  served: 'Served',
};

/**
 * One attempt to serve it.
 *
 * Append-only. An attempt that happened cannot stop having happened, and the
 * pattern across attempts is the useful part — three visits at the same hour
 * of the morning is a shift-planning problem, not a person who cannot be
 * found.
 */
export interface ServiceAttempt {
  id: UUID;
  at: string;
  address: string;
  byId: UUID | '';
  byName: string;
  outcome: AttemptOutcome;
  notes: string;
}

export type WarrantState = 'active' | 'served' | 'recalled' | 'expired';

export const STATE_LABEL: Record<WarrantState, string> = {
  active: 'Outstanding',
  served: 'Served',
  recalled: 'Recalled',
  expired: 'Expired',
};

export interface Warrant {
  id: UUID;

  /** Points into the Master Name Index. */
  personId: UUID;

  /** The court's own number. Not ours — this is how the court knows it. */
  number: string;
  kind: WarrantKind;

  court: string;
  docket: string;
  judge: string;
  issuedOn: string;
  /** Some warrants carry an end date. Blank means it stands until dealt with. */
  expiresOn: string;

  charges: WarrantCharge[];

  /** As written on the warrant. Free text, because "$5,000 cash or surety". */
  bond: string;
  extradition: Extradition;

  /**
   * Officer-safety information from the issuing court or the entering officer.
   *
   * Separate from the person's own cautions because it travels with the
   * warrant — "armed and dangerous" endorsed on a warrant is a statement by
   * the issuing court, not an observation somebody made once.
   */
  cautions: string[];

  attempts: ServiceAttempt[];

  servedOn: string;
  servedByName: string;
  /** The arrest record this became, when it became one. */
  arrestId: UUID | '';

  recalledOn: string;
  recalledReason: string;

  notes: string;

  enteredById: UUID | '';
  enteredByName: string;
  createdAt: string;
  updatedAt: string;
}

export function createWarrant(partial: Partial<Warrant> = {}): Warrant {
  const now = new Date().toISOString();
  return {
    id: '',
    personId: '',
    number: '',
    kind: 'arrest',
    court: '',
    docket: '',
    judge: '',
    issuedOn: '',
    expiresOn: '',
    charges: [],
    bond: '',
    extradition: '',
    cautions: [],
    attempts: [],
    servedOn: '',
    servedByName: '',
    arrestId: '',
    recalledOn: '',
    recalledReason: '',
    notes: '',
    enteredById: '',
    enteredByName: '',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function createWarrantCharge(partial: Partial<WarrantCharge> = {}): WarrantCharge {
  return { id: '', statute: '', description: '', severity: '', counts: '', ...partial };
}

/* ------------------------------------------------------------------ */
/* Where it stands                                                     */
/* ------------------------------------------------------------------ */

export const today = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/**
 * Worked out, never stored — the same rule the trespass notices follow, and
 * for the same reason: a status column is a column that can be stale, and
 * stale here means telling an officer somebody is wanted when they are not.
 *
 * Order matters. Served beats recalled beats expired: a warrant that was
 * served is served, whatever happened to it afterwards.
 */
export function warrantState(
  warrant: Pick<Warrant, 'servedOn' | 'recalledOn' | 'expiresOn'>,
  on: string = today(),
): WarrantState {
  if (warrant.servedOn) return 'served';
  if (warrant.recalledOn) return 'recalled';
  // The expiry date is the last day it stands, not the first day it does not.
  if (warrant.expiresOn && warrant.expiresOn < on) return 'expired';
  return 'active';
}

export const isOutstanding = (
  warrant: Pick<Warrant, 'servedOn' | 'recalledOn' | 'expiresOn'>,
  on: string = today(),
): boolean => warrantState(warrant, on) === 'active';

/**
 * The line a name search shows when somebody is wanted.
 *
 * Deliberately blunt and deliberately hedged in the same breath: it has to be
 * impossible to miss, and it has to say that it is not the authority.
 */
export function warrantAlert(warrants: Warrant[], on: string = today()): string {
  const live = warrants.filter((warrant) => isOutstanding(warrant, on));
  if (live.length === 0) return '';
  const worst = live.find((warrant) => warrant.extradition === 'national');
  const scope = worst ? ' (one extraditable nationally)' : '';
  return live.length === 1
    ? `Outstanding warrant${scope} — confirm with the issuing court before acting`
    : `${live.length} outstanding warrants${scope} — confirm with the issuing court before acting`;
}

/**
 * Whether this warrant can be acted on where the officer is standing.
 *
 * Returns the reason it cannot, or ''. The comparison is deliberately crude —
 * a records system does not know where an officer is — so it answers the
 * question the entering agency can answer: is this warrant good outside the
 * state that issued it.
 */
export function extraditionWarning(warrant: Pick<Warrant, 'extradition'>): string {
  switch (warrant.extradition) {
    case 'none':
      return 'The issuing court will not extradite. Outside their area this is not an arrest authority.';
    case 'county':
      return 'Extraditable within the issuing county only.';
    case 'state':
      return 'Extraditable within the issuing state only.';
    case 'surrounding':
      return 'Extraditable in the issuing state and those bordering it.';
    case 'national':
      return '';
    default:
      return 'Extradition limits are not recorded. Ask the issuing court before acting on this outside their area.';
  }
}

/**
 * The sentence that goes on every warrant, everywhere it is shown.
 *
 * Not a nag and not dismissible. An RMS record is what this agency last heard;
 * warrants are recalled, quashed and served elsewhere hours before anybody
 * updates anything, and every jurisdiction requires a hit to be confirmed with
 * the holding agency before an arrest. A system that renders a warrant like a
 * settled fact is a system that invites somebody to treat it as one.
 */
export const CONFIRMATION_NOTICE =
  'This is what we hold, not authority to arrest. Confirm the warrant with the issuing court or agency before acting on it.';

/** Days a warrant has been outstanding, or null when the date is unusable. */
export function outstandingDays(
  warrant: Pick<Warrant, 'issuedOn'>,
  on: string = today(),
): number | null {
  const from = Date.parse(`${warrant.issuedOn}T00:00:00Z`);
  const to = Date.parse(`${on}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

/** The most serious charge on it, for a one-line summary. */
export function headlineCharge(warrant: Warrant): string {
  if (warrant.charges.length === 0) return KIND_LABEL[warrant.kind];
  const rank: Record<string, number> = { felony: 0, misdemeanor: 1, ordinance: 2, infraction: 3 };
  const sorted = [...warrant.charges].sort(
    (a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9),
  );
  const first = sorted[0];
  const rest = warrant.charges.length - 1;
  const name = first.description || first.statute || KIND_LABEL[warrant.kind];
  return rest > 0 ? `${name} and ${rest} more` : name;
}

/* ------------------------------------------------------------------ */
/* Writing one down                                                    */
/* ------------------------------------------------------------------ */

export interface Check {
  ok: boolean;
  reason: string;
  field: string;
}

const good: Check = { ok: true, reason: '', field: '' };
const isDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Whether a warrant can be recorded as entered.
 *
 * Stricter than the trespass form, on purpose. A trespass notice with a
 * missing field is an inconvenience; a warrant with no court on it cannot be
 * confirmed, and a warrant that cannot be confirmed cannot lawfully be acted
 * on at all — so it is worse than useless, it is a trap.
 */
export function checkWarrant(warrant: Partial<Warrant>): Check {
  if (!warrant.personId) {
    return { ok: false, reason: 'Say who the warrant is for.', field: 'personId' };
  }
  if (!(warrant.number ?? '').trim()) {
    return {
      ok: false,
      reason: 'The court’s warrant number. Without it nobody can confirm this.',
      field: 'number',
    };
  }
  if (!(warrant.court ?? '').trim()) {
    return {
      ok: false,
      reason: 'Which court issued it? This is who an officer has to ring to confirm it.',
      field: 'court',
    };
  }
  if (!warrant.issuedOn || !isDate(warrant.issuedOn)) {
    return { ok: false, reason: 'When was it issued?', field: 'issuedOn' };
  }
  const expires = (warrant.expiresOn ?? '').trim();
  if (expires) {
    if (!isDate(expires)) {
      return {
        ok: false,
        reason: 'An end date needs to be a real date, or leave it blank if it does not expire.',
        field: 'expiresOn',
      };
    }
    if (expires < warrant.issuedOn) {
      return {
        ok: false,
        reason: 'That end date is before it was issued, so it would never stand.',
        field: 'expiresOn',
      };
    }
  }

  /*
    A search warrant is not an arrest authority, and the two get filed on the
    same screen by people in a hurry. Recording one against a person, with
    charges, is almost always somebody reaching for the wrong kind.
  */
  if (warrant.kind === 'search' && (warrant.charges?.length ?? 0) > 0) {
    return {
      ok: false,
      reason:
        'A search warrant authorises a search, not an arrest, and does not carry charges. Did you mean an arrest warrant?',
      field: 'kind',
    };
  }

  if (warrant.kind !== 'search' && (warrant.charges?.length ?? 0) === 0) {
    return {
      ok: false,
      reason: 'What is it for? At least one charge, as it reads on the warrant.',
      field: 'charges',
    };
  }

  return good;
}

/** Recording an attempt. Short, because it is typed in a car. */
export function checkAttempt(attempt: Partial<ServiceAttempt>): Check {
  if (!attempt.outcome) {
    return { ok: false, reason: 'What happened?', field: 'outcome' };
  }
  if (!(attempt.address ?? '').trim()) {
    return { ok: false, reason: 'Where was it tried?', field: 'address' };
  }
  return good;
}

/** Recalling one takes a reason — a court did something, and it matters what. */
export function checkRecall(reason: string): Check {
  return reason.trim().length >= 3
    ? good
    : { ok: false, reason: 'Say why it was recalled — quashed, satisfied, served elsewhere.', field: 'recalledReason' };
}

/* ------------------------------------------------------------------ */
/* Ordering                                                            */
/* ------------------------------------------------------------------ */

/**
 * Outstanding first, then the most serious, then the oldest.
 *
 * An officer reading somebody's record wants what is live and what is worst;
 * a served warrant from 2019 is history and sorts as history.
 */
export function sortWarrants(list: Warrant[], on: string = today()): Warrant[] {
  const stateRank: Record<WarrantState, number> = {
    active: 0,
    served: 1,
    recalled: 2,
    expired: 3,
  };
  const severityRank: Record<string, number> = {
    felony: 0,
    misdemeanor: 1,
    ordinance: 2,
    infraction: 3,
  };
  const worst = (warrant: Warrant): number =>
    Math.min(...warrant.charges.map((c) => severityRank[c.severity] ?? 9), 9);

  return [...list].sort((a, b) => {
    const byState = stateRank[warrantState(a, on)] - stateRank[warrantState(b, on)];
    if (byState !== 0) return byState;
    const bySeverity = worst(a) - worst(b);
    if (bySeverity !== 0) return bySeverity;
    return a.issuedOn.localeCompare(b.issuedOn);
  });
}
