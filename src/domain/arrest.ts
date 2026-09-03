/**
 * Arrests.
 *
 * An arrest was a *role on an incident* until now — `role: 'arrestee'` with a
 * date and a couple of fields. That is enough to report it to NIBRS and enough
 * to count it on an activity report, and not enough for it to be the thing it
 * actually is: a legal document that outlives the report, travels to a court,
 * and has a life of its own afterwards.
 *
 * Three consequences of the old shape, all of which this fixes:
 *
 *   **A charge could not carry what a charge carries.** What the court did with
 *   it had nowhere to live, so an agency asked "what happened to the charges we
 *   filed last quarter" had no answer.
 *
 *   **A supplement could describe an arrest but not record one.** An arrest made
 *   three weeks after the report was approved had nowhere to go, because the
 *   only place an arrestee existed was inside that finished report.
 *
 *   **Booking is a different event from arresting.** The same person is often
 *   arrested by one officer and booked by another, an hour later, in a different
 *   building. One timestamp cannot hold both.
 *
 * What this does not do yet is feed NIBRS. The arrestee segment still reads the
 * incident's own arrestee roles — unchanged, and still pinned by the golden
 * files. Making the export read arrests instead changes submission output, and
 * that is a change to prove rather than assume.
 */

import type { UUID } from './person';
import type { ReportStatus } from './types';
import type { ReviewEvent } from './review';

/* ------------------------------------------------------------------ */
/* Charges                                                             */
/* ------------------------------------------------------------------ */

/**
 * How serious the charge is, in the vocabulary every state shares.
 *
 * Separate from `degree`, which is the class within it — a Class C felony and a
 * Class A misdemeanour are both real things and neither is expressible as one
 * field. States disagree wildly about the classes, so the class is free text
 * and only the severity is a closed set.
 */
export type ChargeSeverity = '' | 'felony' | 'misdemeanor' | 'ordinance' | 'infraction';

export const SEVERITY_LABEL: Record<ChargeSeverity, string> = {
  '': 'Not stated',
  felony: 'Felony',
  misdemeanor: 'Misdemeanour',
  ordinance: 'Local ordinance',
  infraction: 'Infraction',
};

/** What the court did with it. Empty until the court does something. */
export type ChargeOutcome =
  | ''
  | 'pending'
  | 'convicted'
  | 'acquitted'
  | 'dismissed'
  | 'notProsecuted'
  | 'diverted'
  | 'reduced';

export const OUTCOME_LABEL: Record<ChargeOutcome, string> = {
  '': 'Not recorded',
  pending: 'Before the court',
  convicted: 'Convicted',
  acquitted: 'Acquitted',
  dismissed: 'Dismissed',
  notProsecuted: 'Not prosecuted',
  diverted: 'Diverted',
  reduced: 'Reduced',
};

export interface ArrestCharge {
  id: UUID;
  /** The statute or ordinance cited, as it will read on the paperwork. */
  statute: string;
  description: string;
  severity: ChargeSeverity;
  /** The class within the severity — "C", "A", "1". States differ. */
  degree: string;
  /** How many. Blank reads as one. */
  counts: string;
  /**
   * The NIBRS offence this corresponds to.
   *
   * A local cite and a federal offence code are two vocabularies for one act,
   * and the state submission wants the second. Holding both is what will let an
   * arrest be reconciled with its report when the export starts reading these.
   */
  nibrsCode: string;
  bondAmount: string;
  outcome: ChargeOutcome;
  outcomeAt: string;
  outcomeNote: string;
}

export function createCharge(partial: Partial<ArrestCharge> = {}): ArrestCharge {
  return {
    id: '',
    statute: '',
    description: '',
    severity: '',
    degree: '',
    counts: '',
    nibrsCode: '',
    bondAmount: '',
    outcome: '',
    outcomeAt: '',
    outcomeNote: '',
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* The arrest                                                          */
/* ------------------------------------------------------------------ */

/** NIBRS arrest types, which the states use on their own paperwork too. */
export type ArrestType = '' | 'O' | 'S' | 'T';

export const ARREST_TYPE_LABEL: Record<ArrestType, string> = {
  '': 'Not stated',
  O: 'On view',
  S: 'Summoned or cited',
  T: 'Taken into custody',
};

/** Where the person went. The single most-asked question about an arrest. */
export type Disposition =
  | ''
  | 'jail'
  | 'citedReleased'
  | 'releasedNoCharge'
  | 'transferred'
  | 'hospital'
  | 'juvenileFacility'
  | 'releasedToGuardian';

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  '': 'Not recorded',
  jail: 'Booked into jail',
  citedReleased: 'Cited and released',
  releasedNoCharge: 'Released without charge',
  transferred: 'Transferred to another agency',
  hospital: 'Taken to hospital',
  juvenileFacility: 'Juvenile detention',
  releasedToGuardian: 'Released to a parent or guardian',
};

/** Dispositions that only make sense for somebody under eighteen. */
export const JUVENILE_ONLY: Disposition[] = ['juvenileFacility', 'releasedToGuardian'];

export interface Arrest {
  id: UUID;
  /** `2026-A00042` — its own series, never the case number. */
  arrestNumber: string;

  /**
   * The incident this arose from, when there is one.
   *
   * Optional both ways. An on-view arrest happens before anybody writes a
   * report, and a report can sit for years before somebody is arrested for it.
   * Requiring the link either way is how an arrest goes unrecorded because the
   * report it belongs to was not finished.
   */
  caseId: UUID | '';
  caseNumber: string;
  /** The arrestee's row on that incident, when the arrest came from one. */
  incidentPersonId: UUID | '';

  /** Who was arrested, from the Master Name Index. */
  masterId: UUID;
  /** Denormalised so a list reads without resolving every identity. */
  personName: string;

  arrestedAt: string;
  arrestLocation: string;
  arrestType: ArrestType;
  arrestingOfficerId: UUID | '';
  arrestingOfficerName: string;
  assistingOfficers: string;

  charges: ArrestCharge[];
  disposition: Disposition;

  /* ---- Booking: a separate event, often a different officer --------- */
  bookingNumber: string;
  bookedAt: string;
  bookedByName: string;
  heldAt: string;
  photographed: boolean;
  fingerprinted: boolean;
  /** Identifiers assigned at booking, which is where they come from. */
  stateIdNumber: string;
  fbiNumber: string;

  releasedAt: string;
  bondAmount: string;
  courtDate: string;
  courtLocation: string;

  /**
   * Probable cause, in the arresting officer's words.
   *
   * What a magistrate reads. A different question from the incident narrative —
   * not what happened, but why this person was taken into custody for it.
   */
  narrative: string;

  juvenile: boolean;
  /** What was done, in words. A reportable decision, not a checkbox. */
  juvenileHandling: string;
  guardianNotifiedAt: string;

  status: ReportStatus;
  reviewHistory: ReviewEvent[];

  createdBy: UUID;
  createdAt: string;
  updatedAt: string;
}

export function createArrest(partial: Partial<Arrest> = {}): Arrest {
  const at = partial.createdAt ?? new Date().toISOString();
  return {
    id: '',
    arrestNumber: '',
    caseId: '',
    caseNumber: '',
    incidentPersonId: '',
    masterId: '',
    personName: '',
    arrestedAt: '',
    arrestLocation: '',
    arrestType: '',
    arrestingOfficerId: '',
    arrestingOfficerName: '',
    assistingOfficers: '',
    charges: [],
    disposition: '',
    bookingNumber: '',
    bookedAt: '',
    bookedByName: '',
    heldAt: '',
    photographed: false,
    fingerprinted: false,
    stateIdNumber: '',
    fbiNumber: '',
    releasedAt: '',
    bondAmount: '',
    courtDate: '',
    courtLocation: '',
    narrative: '',
    juvenile: false,
    juvenileHandling: '',
    guardianNotifiedAt: '',
    status: 'draft',
    reviewHistory: [],
    createdBy: '',
    createdAt: at,
    updatedAt: at,
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* Numbering                                                           */
/* ------------------------------------------------------------------ */

/**
 * `2026-A00042`.
 *
 * Its own series with an `A` in it, so nobody reads it as a case number. One
 * case can produce four arrests and one arrest can span two cases, so an arrest
 * that borrowed its case's number would be ambiguous the first time either
 * happened — and this number is what a court docket refers to.
 */
export function nextArrestNumber(existing: string[], now = new Date()): string {
  const prefix = `${now.getFullYear()}-A`;
  const used = existing
    .filter((n) => n.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)))
    .filter((n) => Number.isFinite(n));
  const next = (used.length > 0 ? Math.max(...used) : 0) + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Reading it back                                                     */
/* ------------------------------------------------------------------ */

const SEVERITY_RANK: Record<ChargeSeverity, number> = {
  felony: 0,
  misdemeanor: 1,
  ordinance: 2,
  infraction: 3,
  '': 4,
};

/** The most serious charge — how an arrest is described in one line. */
export function leadCharge(arrest: Arrest): ArrestCharge | null {
  return (
    [...arrest.charges].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0] ??
    null
  );
}

const countOf = (charge: ArrestCharge): number => Math.max(1, Number(charge.counts) || 1);

/** "Burglary and 2 other charges", "3 counts of Forgery", "No charges". */
export function describeCharges(arrest: Arrest): string {
  const lead = leadCharge(arrest);
  if (!lead) return 'No charges';

  const name = lead.description || lead.statute || 'Charge';
  const others = arrest.charges.length - 1;
  if (others > 0) return `${name} and ${others} other ${others === 1 ? 'charge' : 'charges'}`;

  const count = countOf(lead);
  return count > 1 ? `${count} counts of ${name}` : name;
}

const money = (value: string): number =>
  Math.round(Number(String(value).replace(/[^0-9.]/g, '')) || 0);

/**
 * Total bond, from the arrest's own figure or the charges beneath it.
 *
 * Both are real: some courts set one figure for the whole arrest, some set it
 * per charge. The arrest-level figure wins when present, because somebody typed
 * it deliberately.
 */
export function totalBond(arrest: Arrest): number {
  const stated = money(arrest.bondAmount);
  return stated > 0 ? stated : arrest.charges.reduce((sum, c) => sum + money(c.bondAmount), 0);
}

/* ------------------------------------------------------------------ */
/* Finding them again                                                  */
/* ------------------------------------------------------------------ */

const newestFirst = (a: Arrest, b: Arrest) => b.arrestedAt.localeCompare(a.arrestedAt);

/** Every arrest that came out of one case, newest first. */
export function arrestsForCase(arrests: Arrest[], caseId: string): Arrest[] {
  return arrests.filter((a) => a.caseId === caseId).sort(newestFirst);
}

/**
 * One person's arrest history, across every case.
 *
 * The question a magistrate asks and the old shape could not answer, because an
 * arrestee only existed inside the one report they appeared on.
 */
export function arrestsForPerson(arrests: Arrest[], masterId: string): Arrest[] {
  return arrests.filter((a) => a.masterId === masterId).sort(newestFirst);
}

/**
 * Approved arrests with charges the court has not answered, oldest first.
 *
 * Oldest first because age is the problem: a charge filed eighteen months ago
 * with nothing back is the one worth chasing, and a queue sorted newest-first
 * buries it.
 */
export function awaitingCourt(arrests: Arrest[]): Arrest[] {
  return arrests
    .filter(
      (a) =>
        a.status === 'approved' &&
        a.charges.length > 0 &&
        a.charges.some((c) => c.outcome === '' || c.outcome === 'pending'),
    )
    .sort((a, b) => a.arrestedAt.localeCompare(b.arrestedAt));
}

/* ------------------------------------------------------------------ */
/* Checking it                                                         */
/* ------------------------------------------------------------------ */

export interface Problem {
  /** Where it is, so the form can jump to it. */
  path: string;
  title: string;
  message: string;
  tip?: string;
  severity: 'error' | 'warning';
}

export interface CheckContext {
  /** The report this arrest hangs off, when there is one. */
  incidentReportedAt?: string;
  now?: Date;
}

/** How far before its report an arrest can sit before it is worth asking. */
const BEFORE_REPORT_HOURS = 24;

/**
 * What has to be true, and what is only worth asking about.
 *
 * One rule decides which: an **error** makes the document wrong or unusable, a
 * **warning** is something an officer may legitimately not know yet. A state
 * identification number is assigned days later by the state, so its absence is
 * a warning. A charge with no severity is an error, because nobody can tell
 * which court hears it.
 */
export function checkArrest(arrest: Arrest, context: CheckContext = {}): Problem[] {
  const problems: Problem[] = [];
  const now = context.now ?? new Date();

  const error = (path: string, title: string, message: string, tip?: string) =>
    problems.push({ path, title, message, tip, severity: 'error' });
  const warn = (path: string, title: string, message: string, tip?: string) =>
    problems.push({ path, title, message, tip, severity: 'warning' });

  /* ---- Who, when, how, and who made it ----------------------------- */

  if (!arrest.masterId) {
    error(
      'masterId',
      'Nobody is named as arrested',
      'Link the person from the name index.',
      'Linking rather than typing is what puts this arrest into that person’s history, where the next officer will look for it.',
    );
  }

  if (!arrest.arrestedAt) {
    error(
      'arrestedAt',
      'No time of arrest',
      'Record when the arrest happened.',
      'Every clock that follows starts here — charging deadlines, first appearance, and how long somebody may be held.',
    );
  } else if (new Date(arrest.arrestedAt).getTime() > now.getTime()) {
    error(
      'arrestedAt',
      'The arrest time is in the future',
      'Check the date and time.',
      'Almost always a year typed wrong, and it will make every deadline computed from it wrong too.',
    );
  }

  if (!arrest.arrestType) {
    error(
      'arrestType',
      'No arrest type',
      'Say whether this was on view, a summons, or a warrant.',
      'It goes on the state submission and decides what paperwork follows.',
    );
  }

  if (!arrest.arrestingOfficerId) {
    error(
      'arrestingOfficerId',
      'No arresting officer',
      'Name the officer who made the arrest.',
      'The person who will be asked about it in court — not necessarily whoever is typing.',
    );
  }

  if (!arrest.disposition) {
    error(
      'disposition',
      'No disposition',
      'Say where the person went.',
      'Jail, cited and released, hospital, another agency. The single most-asked question about an arrest.',
    );
  }

  if (!arrest.arrestLocation.trim()) {
    warn(
      'arrestLocation',
      'No arrest location',
      'Record where the arrest happened.',
      'Jurisdiction turns on it, and so does whether the arrest was inside this agency’s authority.',
    );
  }

  /* ---- Charges ------------------------------------------------------ */

  if (arrest.charges.length === 0) {
    error(
      'charges',
      'No charges',
      'Add at least one charge.',
      'An arrest with no charge is either a release without charge or an unfinished document, and those must not look alike.',
    );
  }

  arrest.charges.forEach((charge, i) => {
    const at = (field: string) => `charges.${i}.${field}`;

    // A cite or a description. An officer knows what somebody did before they
    // know the number for it, and blocking on the number loses the arrest.
    if (!charge.statute.trim() && !charge.description.trim()) {
      error(
        at('statute'),
        `Charge ${i + 1} says nothing`,
        'Give the statute cite or describe the offence.',
        'Either will do here. The cite can be filled in later; what it was cannot be reconstructed.',
      );
    }

    if (!charge.severity) {
      error(
        at('severity'),
        `Charge ${i + 1} has no severity`,
        'Say whether it is a felony, a misdemeanour or an ordinance violation.',
        'It decides which court hears it and how long somebody can be held before first appearance.',
      );
    } else if (!charge.degree.trim()) {
      warn(
        at('degree'),
        `Charge ${i + 1} has no class`,
        `A ${SEVERITY_LABEL[charge.severity].toLowerCase()} usually carries a class.`,
        'Class C, Class A, and so on — it sets the sentencing range, and the prosecutor will ask.',
      );
    }

    if (charge.counts.trim() && (Number(charge.counts) || 0) < 1) {
      error(
        at('counts'),
        `Charge ${i + 1} has fewer than one count`,
        'A charge is at least one count.',
        'Leave it blank for a single count rather than writing zero.',
      );
    }

    if (!charge.nibrsCode) {
      warn(
        at('nibrsCode'),
        `Charge ${i + 1} has no NIBRS code`,
        'The state submission reports offences in federal codes.',
        'Without it this arrest cannot be reconciled against the report it came from.',
      );
    }
  });

  /* ---- Times that contradict each other ----------------------------- */

  if (arrest.bookedAt && arrest.releasedAt && arrest.releasedAt < arrest.bookedAt) {
    error(
      'releasedAt',
      'Released before being booked',
      'The release time is earlier than the booking time.',
      'One of the two is wrong, and a custody timeline that runs backwards is the first thing a defence attorney will point at.',
    );
  }

  /* ---- Juveniles ---------------------------------------------------- */

  if (arrest.juvenile && !arrest.juvenileHandling.trim()) {
    error(
      'juvenileHandling',
      'No juvenile handling recorded',
      'Say what was done — handled within the department, or referred on.',
      'A juvenile arrest is reported differently, sealed differently and released to different people. An unanswered flag is how a juvenile record ends up in an adult file.',
    );
  }

  if (!arrest.juvenile && JUVENILE_ONLY.includes(arrest.disposition)) {
    error(
      'disposition',
      'That disposition is for a juvenile',
      `"${DISPOSITION_LABEL[arrest.disposition]}" applies to somebody under eighteen.`,
      'Either the disposition is wrong or the juvenile flag is — and the second one changes how this record is handled for the rest of its life.',
    );
  }

  /* ---- Worth asking about ------------------------------------------- */

  if (arrest.disposition === 'jail' && !arrest.bookingNumber.trim()) {
    warn(
      'bookingNumber',
      'No booking number',
      'Booked into jail, but with no booking number recorded.',
      'The number the holding facility uses. Without it the two records cannot be matched later.',
    );
  }

  if (
    arrest.disposition === 'citedReleased' &&
    arrest.charges.some((c) => c.severity === 'felony')
  ) {
    warn(
      'disposition',
      'A felony released on a citation',
      'A felony charge with a cite-and-release disposition.',
      'It happens, and it is unusual enough to be worth a second look before this is submitted.',
    );
  }

  if (context.incidentReportedAt && arrest.arrestedAt) {
    const gap =
      new Date(context.incidentReportedAt).getTime() - new Date(arrest.arrestedAt).getTime();
    if (gap > BEFORE_REPORT_HOURS * 3_600_000) {
      warn(
        'arrestedAt',
        'Arrested well before the report was taken',
        'This arrest is dated more than a day before the report it hangs off.',
        'Legitimate on a warrant for an old case, and a typo the rest of the time.',
      );
    }
  }

  if (!arrest.narrative.trim()) {
    warn(
      'narrative',
      'No probable cause statement',
      'Write what gave cause to arrest.',
      'A magistrate reads this to decide whether the arrest was lawful. Not the whole story — the reason this person was taken into custody.',
    );
  }

  if (arrest.bookedAt && !arrest.fingerprinted) {
    warn(
      'fingerprinted',
      'Not recorded as fingerprinted',
      'Booked, but prints are not recorded.',
      'Prints are how an identity is confirmed rather than taken on trust. A criminal history that was never printed is a name and a hope.',
    );
  }

  return problems;
}

/** Only errors block a submission. Warnings are shown and allowed through. */
export function blockingProblems(problems: Problem[]): Problem[] {
  return problems.filter((p) => p.severity === 'error');
}
