/**
 * What the outgoing shift leaves behind.
 *
 * The sergeant's job at changeover is not to read out a log. It is to answer
 * three questions for the people about to go out, and a briefing that mixes
 * them together is one nobody can act on:
 *
 *   **What is still live?** Somebody in a cell, a BOLO nobody has cleared, an
 *   address flagged for officer safety. These are not events that happened
 *   last night — they are conditions that are still true, and they are the
 *   only part of a briefing that changes what the next eight hours look like.
 *
 *   **What happened?** The calls, the arrests, the wrecks. Read for context
 *   rather than for action: it is how the shift knows the burglaries are all
 *   on the same three streets.
 *
 *   **What is not finished?** Reports still in draft after the shift has gone
 *   home, reports sent back for correction and not returned, property seized
 *   and not lodged. This is the part that only the sergeant can chase and the
 *   part that is currently kept on a sticky note, and it is the reason this
 *   screen is worth building rather than printing a call log.
 *
 * Everything here is worked out from the records on every read. Nothing is
 * stored. A briefing saved at seven in the morning is wrong by eight, because
 * a report was amended, a person was released, or a BOLO was cleared — and a
 * stale briefing is worse than none, since it is read aloud with authority.
 */

import type { Incident } from './types';
import type { Arrest } from './arrest';
import type { CrashReport } from './crash';
import type { TrafficStop } from './activity';
import type { Booking } from './booking';
import type { FieldContact } from './fieldContact';
import type { Citation } from './citation';
import type { Bulletin } from './bulletin';
import { custody, type RosterRow } from './booking';
import { forBriefing } from './bulletin';
import { within, type Shift } from './shift';
import { OFFENSE_BY_CODE } from './codes';

/* ------------------------------------------------------------------ */
/* What is still live                                                  */
/* ------------------------------------------------------------------ */

export interface StillLive {
  /** People in the building right now, longest held first. */
  inCustody: Booking[];
  /** The board, in the order it is read out. */
  board: Bulletin[];
}

/* ------------------------------------------------------------------ */
/* What happened                                                       */
/* ------------------------------------------------------------------ */

export interface Happened {
  incidents: Incident[];
  arrests: Arrest[];
  crashes: CrashReport[];
  stops: TrafficStop[];
  contacts: FieldContact[];
  citations: Citation[];
}

/** Counts by offense, commonest first — how a pattern becomes visible. */
export interface OffenseTally {
  code: string;
  label: string;
  count: number;
}

export function tallyOffenses(incidents: Incident[]): OffenseTally[] {
  const counts = new Map<string, number>();
  for (const incident of incidents) {
    for (const offense of incident.offenses ?? []) {
      const code = offense.code ?? '';
      if (!code) continue;
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, label: OFFENSE_BY_CODE.get(code)?.label ?? code, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/* ------------------------------------------------------------------ */
/* What is not finished                                                */
/* ------------------------------------------------------------------ */

/**
 * One thing somebody has to chase, and who it belongs to.
 *
 * Named rather than counted. "Four reports outstanding" is a number a sergeant
 * cannot act on; "Reyes, 2026-000148, still in draft" is a conversation.
 */
export interface Loose {
  kind: 'draft' | 'sentBack' | 'unsubmittedArrest';
  id: string;
  label: string;
  who: string;
  /** Why it is on the list, in words. */
  note: string;
}

export const LOOSE_LABEL: Record<Loose['kind'], string> = {
  draft: 'Still in draft',
  sentBack: 'Sent back, not returned',
  unsubmittedArrest: 'Arrest not submitted',
};

/* ------------------------------------------------------------------ */
/* The whole thing                                                     */
/* ------------------------------------------------------------------ */

export interface Briefing {
  shift: Shift;
  live: StillLive;
  happened: Happened;
  offenses: OffenseTally[];
  loose: Loose[];
  /** True when the shift produced nothing at all — said, not left blank. */
  quiet: boolean;
}

export interface Records {
  incidents: Incident[];
  arrests: Arrest[];
  crashes: CrashReport[];
  stops: TrafficStop[];
  contacts: FieldContact[];
  citations: Citation[];
  bookings: Booking[];
  bulletins: Bulletin[];
}

/**
 * Gathers one shift.
 *
 * `now` is separate from the shift on purpose. What happened is bounded by the
 * shift; what is still live is true *now* — a briefing read at half past seven
 * about the night shift should list the person who is in a cell at half past
 * seven, not the person who was in one at seven.
 */
export function briefing(records: Records, shift: Shift, now: Date = new Date()): Briefing {
  const incidents = records.incidents.filter((i) => within(shift, i.reportedAt));
  const arrests = records.arrests.filter((a) => within(shift, a.arrestedAt));
  const crashes = records.crashes.filter((c) => within(shift, c.occurredAt));
  const stops = records.stops.filter((s) => within(shift, s.at));
  const contacts = records.contacts.filter((c) => within(shift, c.occurredAt));
  const citations = records.citations.filter((c) => within(shift, c.issuedAt));

  const inCustody = records.bookings
    .filter((booking) => custody(booking) !== 'released')
    .sort((a, b) => a.bookedAt.localeCompare(b.bookedAt));

  const loose: Loose[] = [];
  for (const incident of incidents) {
    if (incident.status === 'draft') {
      loose.push({
        kind: 'draft',
        id: incident.id,
        label: incident.caseNumber || 'No case number yet',
        who: incident.reportingOfficer ?? '',
        note: 'Written during the shift and never sent up.',
      });
    }
  }
  /*
    Sent-back reports are not filtered to this shift. A report returned three
    days ago and still sitting there is more overdue, not less, and the whole
    point of this list is that it is the one place somebody would notice.
  */
  for (const incident of records.incidents) {
    if (incident.status === 'returned') {
      loose.push({
        kind: 'sentBack',
        id: incident.id,
        label: incident.caseNumber || 'No case number yet',
        who: incident.reportingOfficer ?? '',
        note: 'Sent back for correction and not returned.',
      });
    }
  }
  for (const arrest of arrests) {
    if (arrest.status === 'draft') {
      loose.push({
        kind: 'unsubmittedArrest',
        id: arrest.id,
        label: arrest.arrestNumber || 'No arrest number yet',
        who: arrest.arrestingOfficerName ?? '',
        note: 'Somebody was arrested and the paperwork has not gone up.',
      });
    }
  }

  const happened: Happened = { incidents, arrests, crashes, stops, contacts, citations };
  const quiet =
    incidents.length === 0 &&
    arrests.length === 0 &&
    crashes.length === 0 &&
    stops.length === 0 &&
    contacts.length === 0 &&
    citations.length === 0;

  return {
    shift,
    live: { inCustody, board: forBriefing(records.bulletins, now) },
    happened,
    offenses: tallyOffenses(incidents),
    loose,
    quiet,
  };
}

/** How many separate things happened, for the one-line summary at the top. */
export function callCount(happened: Happened): number {
  return (
    happened.incidents.length +
    happened.arrests.length +
    happened.crashes.length +
    happened.stops.length +
    happened.contacts.length
  );
}

/** Officers who did anything at all this shift, by name, for the roster line. */
export function officersOn(happened: Happened): string[] {
  const names = new Set<string>();
  for (const incident of happened.incidents) {
    if (incident.reportingOfficer) names.add(incident.reportingOfficer);
  }
  for (const arrest of happened.arrests) {
    if (arrest.arrestingOfficerName) names.add(arrest.arrestingOfficerName);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export type { RosterRow };
