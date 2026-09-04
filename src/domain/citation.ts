/**
 * Citations.
 *
 * Written in the cruiser, on the MDT, at the roadside — which is why this
 * system's job is mostly the *receiving* end: a citation arrives, attaches to
 * the stop and the person, counts on the activity report, and carries whatever
 * the court sends back.
 *
 * An officer can also enter one here, and the framing of that matters more
 * than the form does.
 *
 * **Entering a citation here is recording one that already exists.** The
 * person was handed a numbered ticket at the roadside. Nothing typed into an
 * office computer at eleven at night creates that; it transcribes it. So the
 * ticket number is required and is the identity of the record, the issue time
 * is when it was handed over rather than when it was typed, and the screen
 * says all of this out loud.
 *
 * That framing is what makes the fallback safe. The MDT is down, or out of
 * coverage, or the officer was on foot and wrote a paper ticket from a book —
 * all real, all common, and all ending with somebody keying it in later. When
 * the MDT submission eventually arrives it carries the same number, so it
 * fills in the record that is already here instead of creating a second one.
 * A system where both paths create rows is a system that double-counts
 * tickets, and an activity report nobody trusts.
 */

import type { UUID } from './person';

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

export type CitationSource = 'mdt' | 'officer' | 'import';

export const SOURCE_LABEL: Record<CitationSource, string> = {
  mdt: 'Submitted from the MDT',
  officer: 'Entered here by the officer',
  import: 'Migrated from the previous system',
};

/**
 * What the court did with it.
 *
 * Comes back from the clerk, often months later, and stays empty until it
 * does. An empty disposition means nobody has heard, which is different from
 * a case that went nowhere.
 */
export type CourtDisposition =
  | ''
  | 'pending'
  | 'guilty'
  | 'notGuilty'
  | 'dismissed'
  | 'nolleProsequi'
  | 'deferred'
  | 'paid'
  | 'failedToAppear';

export const DISPOSITION_LABEL: Record<CourtDisposition, string> = {
  '': 'Not heard yet',
  pending: 'Pending',
  guilty: 'Guilty',
  notGuilty: 'Not guilty',
  dismissed: 'Dismissed',
  nolleProsequi: 'Not prosecuted',
  deferred: 'Deferred',
  paid: 'Paid without appearing',
  failedToAppear: 'Failed to appear',
};

export interface Violation {
  id: UUID;
  statute: string;
  description: string;
  /** A written warning rather than a citation, where the state distinguishes. */
  warningOnly: boolean;

  /**
   * Speed and the limit, on a speeding charge.
   *
   * Both, or neither. A speeding citation recording the speed but not the
   * limit does not say an offence was committed, and the first person to
   * notice is the prosecutor.
   */
  speed: string;
  speedLimit: string;

  /** As written on the ticket, where the schedule sets one. */
  fine: string;
}

export interface Citation {
  id: UUID;

  /**
   * The number on the ticket. Not ours — this is what the court, the clerk
   * and the person holding the copy all know it by, and it is what an MDT
   * submission reconciles against.
   */
  number: string;

  /** When it was handed over, which is not when it was typed. */
  issuedAt: string;
  /** When it reached this system. The gap between the two is worth seeing. */
  recordedAt: string;
  source: CitationSource;

  /** Points into the Master Name Index, when the person is on file. */
  personId: UUID | '';
  /** What was written on the ticket, which may be all there is. */
  subjectName: string;
  subjectDob: string;
  driverLicense: string;
  driverLicenseState: string;

  /** Points into the Master Vehicle Index. */
  vehicleId: UUID | '';
  plate: string;
  plateState: string;

  locationId: UUID | '';
  location: string;

  /** The stop this came out of, when it came out of one. */
  stopId: UUID | '';
  caseNumber: string;

  violations: Violation[];

  court: string;
  courtDate: string;
  disposition: CourtDisposition;
  dispositionAt: string;

  officerId: UUID | '';
  officerName: string;

  notes: string;

  /**
   * Voided rather than deleted.
   *
   * A ticket that was written and then voided is a thing that happened, and
   * "who voided it and why" is the question asked when somebody says they were
   * stopped and let off. Deleting it removes the only evidence of both.
   */
  voidedAt: string;
  voidedBy: string;
  voidReason: string;

  createdAt: string;
  updatedAt: string;
}

export function createCitation(partial: Partial<Citation> = {}): Citation {
  const now = new Date().toISOString();
  return {
    id: '',
    number: '',
    issuedAt: '',
    recordedAt: now,
    source: 'officer',
    personId: '',
    subjectName: '',
    subjectDob: '',
    driverLicense: '',
    driverLicenseState: '',
    vehicleId: '',
    plate: '',
    plateState: '',
    locationId: '',
    location: '',
    stopId: '',
    caseNumber: '',
    violations: [],
    court: '',
    courtDate: '',
    disposition: '',
    dispositionAt: '',
    officerId: '',
    officerName: '',
    notes: '',
    voidedAt: '',
    voidedBy: '',
    voidReason: '',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function createViolation(partial: Partial<Violation> = {}): Violation {
  return {
    id: '',
    statute: '',
    description: '',
    warningOnly: false,
    speed: '',
    speedLimit: '',
    fine: '',
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* Where it stands                                                     */
/* ------------------------------------------------------------------ */

export type CitationState = 'issued' | 'voided' | 'disposed';

export const STATE_LABEL: Record<CitationState, string> = {
  issued: 'Issued',
  voided: 'Voided',
  disposed: 'Dealt with',
};

export function citationState(
  citation: Pick<Citation, 'voidedAt' | 'disposition'>,
): CitationState {
  if (citation.voidedAt) return 'voided';
  // "Pending" is the court saying it has the ticket, not that it is finished.
  if (citation.disposition && citation.disposition !== 'pending') return 'disposed';
  return 'issued';
}

/** True where every line is a written warning, so nothing is owed. */
export const isWarningOnly = (citation: Pick<Citation, 'violations'>): boolean =>
  citation.violations.length > 0 && citation.violations.every((v) => v.warningOnly);

/** Charges that count as citations, which is what an activity report counts. */
export const chargeCount = (citation: Pick<Citation, 'violations'>): number =>
  citation.violations.filter((v) => !v.warningOnly).length;

/** "42 in a 25", or the description. What somebody reads at a glance. */
export function violationLine(violation: Violation): string {
  const name = violation.description || violation.statute || 'Violation';
  if (violation.speed && violation.speedLimit) {
    return `${name} — ${violation.speed} in a ${violation.speedLimit}`;
  }
  return name;
}

/** A one-line summary of the whole ticket. */
export function citationLine(citation: Citation): string {
  if (citation.violations.length === 0) return 'No violation recorded';
  const first = violationLine(citation.violations[0]);
  const rest = citation.violations.length - 1;
  return rest > 0 ? `${first} and ${rest} more` : first;
}

/**
 * How long the record took to reach the system.
 *
 * Worth surfacing rather than hiding. A ticket keyed in three weeks after it
 * was written is one the court may already have processed, and the gap is the
 * first sign that a stack of paper is sitting in somebody's locker.
 */
export function recordingDelayDays(citation: Pick<Citation, 'issuedAt' | 'recordedAt'>): number | null {
  const issued = Date.parse(citation.issuedAt);
  const recorded = Date.parse(citation.recordedAt);
  if (!Number.isFinite(issued) || !Number.isFinite(recorded)) return null;
  return Math.max(0, Math.round((recorded - issued) / 86_400_000));
}

export const LATE_ENTRY_DAYS = 3;

/* ------------------------------------------------------------------ */
/* Writing one down                                                    */
/* ------------------------------------------------------------------ */

export interface Check {
  ok: boolean;
  reason: string;
  field: string;
  advice?: string;
}

const good: Check = { ok: true, reason: '', field: '' };

export function checkCitation(citation: Partial<Citation>, now: Date = new Date()): Check {
  if (!(citation.number ?? '').trim()) {
    return {
      ok: false,
      reason: 'The number printed on the ticket. It is how the court, the clerk and the driver all know this one.',
      field: 'number',
    };
  }
  if (!citation.issuedAt) {
    return { ok: false, reason: 'When was it handed over?', field: 'issuedAt' };
  }

  const issued = Date.parse(citation.issuedAt);
  if (!Number.isFinite(issued)) {
    return { ok: false, reason: 'That is not a time this can read.', field: 'issuedAt' };
  }
  /*
    A citation cannot be issued in the future. Worth catching because the most
    common way to get here is a mistyped year, and a ticket dated 2027 will sit
    unmatched against the court's return for as long as anybody cares to look.
  */
  if (issued > now.getTime() + 60_000) {
    return {
      ok: false,
      reason: 'That is in the future. This records a ticket that has already been handed over.',
      field: 'issuedAt',
    };
  }

  if (!(citation.violations?.length ?? 0)) {
    return { ok: false, reason: 'What was it for?', field: 'violations' };
  }

  for (const violation of citation.violations ?? []) {
    if (!violation.statute.trim() && !violation.description.trim()) {
      return { ok: false, reason: 'Each line needs a statute or a description.', field: 'violations' };
    }
    /*
      Speed without a limit, or a limit without a speed, does not state an
      offence — the whole charge is the difference between the two numbers.
    */
    const hasSpeed = Boolean(violation.speed.trim());
    const hasLimit = Boolean(violation.speedLimit.trim());
    if (hasSpeed !== hasLimit) {
      return {
        ok: false,
        reason: hasSpeed
          ? 'A speed with no limit beside it does not state an offence. What was the limit?'
          : 'A limit with no recorded speed does not state an offence. How fast were they going?',
        field: 'violations',
      };
    }
  }

  if (!(citation.subjectName ?? '').trim() && !citation.personId) {
    return { ok: false, reason: 'Who was it issued to?', field: 'subjectName' };
  }

  if (citation.courtDate) {
    const court = Date.parse(`${citation.courtDate}T00:00:00Z`);
    if (Number.isFinite(court) && court < issued - 86_400_000) {
      return {
        ok: false,
        reason: 'The court date is before the ticket was written.',
        field: 'courtDate',
      };
    }
  }

  return good;
}

/** Things worth saying that are not refusals. */
export function adviseCitation(citation: Partial<Citation>): string {
  const violations = citation.violations ?? [];
  if (violations.length > 0 && violations.every((v) => v.warningOnly) && citation.courtDate) {
    return 'Every line here is a written warning, so there is nothing to appear for. The court date will be ignored.';
  }
  const delay = recordingDelayDays({
    issuedAt: citation.issuedAt ?? '',
    recordedAt: citation.recordedAt ?? new Date().toISOString(),
  });
  if (delay !== null && delay > LATE_ENTRY_DAYS) {
    return `This was written ${delay} days ago. The court may already have processed it — worth checking the number matches what they have.`;
  }
  return '';
}

/** Voiding one takes a reason. It is a ticket somebody was handed. */
export function checkVoid(reason: string): Check {
  return reason.trim().split(/\s+/).filter(Boolean).length >= 3
    ? good
    : { ok: false, reason: 'Say why it is being voided.', field: 'voidReason' };
}

/* ------------------------------------------------------------------ */
/* Reconciling with the MDT                                            */
/* ------------------------------------------------------------------ */

/**
 * Folding an arriving submission into a record already here.
 *
 * The whole reason an officer can enter one by hand. The MDT is authoritative
 * about what it holds — it has the structured data straight from the ticket —
 * so it fills anything blank and corrects the machine-readable fields. What it
 * does *not* touch is anything a person decided: the notes somebody wrote, and
 * a void.
 *
 * Never creates a second record for a number already known. Two rows for one
 * ticket is an activity report nobody trusts.
 */
export function reconcile(existing: Citation, arriving: Partial<Citation>): Citation {
  const next: Citation = { ...existing };
  let changed = false;

  const fill = <K extends keyof Citation>(field: K, value: unknown) => {
    const incoming = typeof value === 'string' ? value.trim() : '';
    if (!incoming) return;
    const current = String(existing[field] ?? '').trim();
    if (current && current === incoming) return;
    // Machine-readable identity fields: the MDT wins, because it read them off
    // the licence rather than off a page of handwriting.
    (next[field] as unknown as string) = incoming;
    changed = true;
  };

  fill('driverLicense', arriving.driverLicense);
  fill('driverLicenseState', arriving.driverLicenseState);
  fill('plate', arriving.plate);
  fill('plateState', arriving.plateState);
  fill('subjectDob', arriving.subjectDob);
  fill('court', arriving.court);
  fill('courtDate', arriving.courtDate);
  fill('location', arriving.location);

  // Violations arrive whole or not at all. A partial merge of charges is how
  // somebody ends up cited for something twice.
  if (arriving.violations?.length) {
    next.violations = arriving.violations;
    changed = true;
  }

  if (!existing.personId && arriving.personId) {
    next.personId = arriving.personId;
    changed = true;
  }
  if (!existing.vehicleId && arriving.vehicleId) {
    next.vehicleId = arriving.vehicleId;
    changed = true;
  }
  if (!existing.stopId && arriving.stopId) {
    next.stopId = arriving.stopId;
    changed = true;
  }

  if (!changed) return existing;
  return {
    ...next,
    // It came from the MDT in the end, whoever keyed it first.
    source: 'mdt',
    updatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Reading them back                                                   */
/* ------------------------------------------------------------------ */

/** Newest first, which is how a citation list is read. */
export function sortCitations(list: Citation[]): Citation[] {
  return [...list].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

/** Tickets still waiting on the court, oldest first — the clerk's chase list. */
export function awaitingCourt(list: Citation[]): Citation[] {
  return list
    .filter((citation) => citationState(citation) === 'issued' && !isWarningOnly(citation))
    .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
}
