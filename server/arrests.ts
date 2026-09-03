/**
 * Arrest routes.
 *
 * An arrest moves through the same review states as a report, so the same
 * separation-of-duties rules apply: an officer submits, somebody else approves,
 * and nobody approves their own. That logic already exists in `domain/review`
 * and is reused rather than restated.
 *
 * The one thing worth reading carefully is `linkArrestee`. An arrest document
 * and the incident's arrestee role are one fact in two records, and this is
 * where they are kept honest — recording an arrest against a case adds the
 * arrestee role to that report if it is not already there, so the NIBRS
 * submission counts the arrest without this table being involved at all.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, documents } from './db';
import { newId } from './ids';
import { requireAuth } from './auth';
import { recordAudit } from './audit';
import { reviewEvent } from './review';
import { canReopen, canReview, canSubmit } from '../src/domain/review';
import {
  blockingProblems,
  checkArrest,
  createArrest,
  createCharge,
  nextArrestNumber,
  type Arrest,
  type ArrestCharge,
} from '../src/domain/arrest';
import type { Incident } from '../src/domain/types';
import type { MasterPerson } from '../src/domain/person';

const arrests = documents<Arrest>(DOC_TABLES.arrests);
const cases = documents<Incident>(DOC_TABLES.incidents);
const people = documents<MasterPerson>(DOC_TABLES.people);

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);

/** The name shown in a list, so a thousand rows need no lookups. */
function nameOf(db: DatabaseSync, masterId: string): string {
  const person = masterId ? people.find(db, masterId) : null;
  if (!person) return '';
  if (person.businessName) return person.businessName;
  return [person.lastName, person.firstName].filter(Boolean).join(', ');
}

/**
 * Keeps the incident's arrestee role in step with the arrest document.
 *
 * The NIBRS arrestee segment is built from `incident.persons`, and the state's
 * submission has been pinned byte for byte against that. So recording an arrest
 * does not move the NIBRS fact — it makes sure the fact is there. If the person
 * is already on the report as an arrestee, nothing changes; if they are on it
 * in another role, that role is promoted; if they are not on it, they are added.
 *
 * Returns the id of the incident person the arrest hangs off, or '' when there
 * is no case — a warrant service or an assist for another agency.
 */
function linkArrestee(db: DatabaseSync, arrest: Arrest): string {
  if (!arrest.caseId || !arrest.masterId) return '';
  const incident = cases.find(db, arrest.caseId);
  if (!incident) return '';

  const existing = incident.persons.find((p) => p.masterId === arrest.masterId);

  if (existing?.role === 'arrestee') {
    // Already right. Refresh only what the arrest is authoritative about.
    const updated = {
      ...incident,
      persons: incident.persons.map((p) =>
        p.id === existing.id
          ? {
              ...p,
              arrestDate: arrest.arrestedAt.slice(0, 10),
              arrestType: arrest.arrestType,
              arrestingOfficerId: arrest.arrestingOfficerId,
            }
          : p,
      ),
      updatedAt: new Date().toISOString(),
    };
    cases.save(db, updated);
    return existing.id;
  }

  const link = {
    id: existing?.id ?? newId('ip'),
    masterId: arrest.masterId,
    role: 'arrestee' as const,
    offenseIds: existing?.offenseIds ?? incident.offenses.map((o) => o.id),
    victimType: '' as const,
    injuries: [],
    relationships: existing?.relationships ?? [],
    armedWith: existing?.armedWith ?? [],
    description: existing?.description ?? '',
    isUnknown: false,
    arrestDate: arrest.arrestedAt.slice(0, 10),
    arrestType: arrest.arrestType,
    arrestingOfficerId: arrest.arrestingOfficerId,
    charges: arrest.charges.map((c) => ({
      id: c.id,
      statute: c.statute,
      description: c.description,
      counts: c.counts || '1',
      degree: c.degree,
    })),
    notes: existing?.notes ?? '',
  };

  cases.save(db, {
    ...incident,
    persons: existing
      ? incident.persons.map((p) => (p.id === existing.id ? link : p))
      : [...incident.persons, link],
    updatedAt: new Date().toISOString(),
  });
  return link.id;
}

const SEVERITIES: ArrestCharge['severity'][] = [
  '', 'felony', 'misdemeanor', 'ordinance', 'infraction',
];
const OUTCOMES: ArrestCharge['outcome'][] = [
  '', 'pending', 'convicted', 'acquitted', 'dismissed', 'notProsecuted', 'diverted', 'reduced',
];

/** Keeps `value` when it is one of `allowed`, and blanks it when it is not. */
function oneOf<T extends string>(value: unknown, allowed: T[]): T {
  return allowed.includes(value as T) ? (value as T) : ('' as T);
}

function sanitiseCharges(input: unknown): ArrestCharge[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 40).map((raw, i) => {
    const c = (raw ?? {}) as Record<string, unknown>;
    return createCharge({
      id: text(c.id, 64) || newId(`chg${i}`),
      statute: text(c.statute, 60),
      description: text(c.description, 300),
      nibrsCode: text(c.nibrsCode, 10),
      counts: text(c.counts, 4) || '1',
      severity: oneOf(c.severity, SEVERITIES),
      degree: text(c.degree, 20),
      bondAmount: text(c.bondAmount, 30),
      outcome: oneOf(c.outcome, OUTCOMES),
      outcomeAt: text(c.outcomeAt, 30),
      outcomeNote: text(c.outcomeNote, 300),
    });
  });
}

/** Only the fields somebody writing up an arrest owns. */
function merge(current: Arrest, body: Record<string, unknown>): Arrest {
  const keep = <T>(value: unknown, fallback: T, read: (v: unknown) => T): T =>
    value === undefined ? fallback : read(value);
  const str = (max: number) => (v: unknown) => text(v, max);
  const flag = (v: unknown) => Boolean(v);

  return {
    ...current,
    caseId: keep(body.caseId, current.caseId, str(64)),
    caseNumber: keep(body.caseNumber, current.caseNumber, str(40)),
    masterId: keep(body.masterId, current.masterId, str(64)),

    arrestedAt: keep(body.arrestedAt, current.arrestedAt, str(40)),
    arrestLocation: keep(body.arrestLocation, current.arrestLocation, str(300)),
    arrestType: keep(body.arrestType, current.arrestType, (v) =>
      oneOf(v, ['', 'O', 'S', 'T'] as Arrest['arrestType'][]),
    ),
    arrestingOfficerId: keep(body.arrestingOfficerId, current.arrestingOfficerId, str(64)),
    assistingOfficers: keep(body.assistingOfficers, current.assistingOfficers, str(300)),

    charges: body.charges === undefined ? current.charges : sanitiseCharges(body.charges),
    disposition: keep(body.disposition, current.disposition, (v) =>
      oneOf(v, [
        '', 'jail', 'citedReleased', 'releasedNoCharge', 'transferred',
        'hospital', 'juvenileFacility', 'releasedToGuardian',
      ] as Arrest['disposition'][]),
    ),

    bookingNumber: keep(body.bookingNumber, current.bookingNumber, str(60)),
    bookedAt: keep(body.bookedAt, current.bookedAt, str(40)),
    bookedByName: keep(body.bookedByName, current.bookedByName, str(120)),
    heldAt: keep(body.heldAt, current.heldAt, str(160)),
    photographed: keep(body.photographed, current.photographed, flag),
    fingerprinted: keep(body.fingerprinted, current.fingerprinted, flag),
    stateIdNumber: keep(body.stateIdNumber, current.stateIdNumber, str(40)),
    fbiNumber: keep(body.fbiNumber, current.fbiNumber, str(40)),

    releasedAt: keep(body.releasedAt, current.releasedAt, str(40)),
    bondAmount: keep(body.bondAmount, current.bondAmount, str(30)),
    courtDate: keep(body.courtDate, current.courtDate, str(40)),
    courtLocation: keep(body.courtLocation, current.courtLocation, str(160)),

    narrative: keep(body.narrative, current.narrative, str(40_000)),

    juvenile: keep(body.juvenile, current.juvenile, flag),
    juvenileHandling: keep(body.juvenileHandling, current.juvenileHandling, str(400)),
    guardianNotifiedAt: keep(body.guardianNotifiedAt, current.guardianNotifiedAt, str(40)),

    updatedAt: new Date().toISOString(),
  };
}

/** The four transitions, and what each is called in the audit log. */
const AUDIT_ACTION = {
  submit: 'arrest.submitted',
  approve: 'arrest.approved',
  return: 'arrest.returned',
  reopen: 'arrest.reopened',
} as const;

export function registerArrestRoutes(app: Express, db: DatabaseSync): void {
  /**
   * The list, optionally narrowed to one case or one person.
   *
   * Both filters hit an index rather than reading every arrest and discarding
   * most of it — a case screen and a person's history are the two ways this is
   * read, and by year three neither wants the whole table.
   */
  app.get('/api/arrests', requireAuth, (req: Request, res: Response) => {
    const criteria: Record<string, string> = {};
    if (req.query.caseId) criteria.case_id = text(req.query.caseId, 64);
    if (req.query.masterId) criteria.master_id = text(req.query.masterId, 64);

    const found = arrests.where(db, criteria);
    found.sort((a, b) => (a.arrestedAt < b.arrestedAt ? 1 : -1));
    res.json({ arrests: found });
  });

  /** One arrest, with what is wrong with it and who could be named on it. */
  app.get('/api/arrests/:id', requireAuth, (req: Request, res: Response) => {
    const arrest = arrests.find(db, req.params.id);
    if (!arrest) {
      res.status(404).json({ error: 'No such arrest.' });
      return;
    }
    const incident = arrest.caseId ? cases.find(db, arrest.caseId) : null;
    res.json({
      arrest,
      problems: checkArrest(arrest, { incidentReportedAt: incident?.reportedAt }),
    });
  });

  /** Starts one, optionally from a person already on a report. */
  app.post('/api/arrests', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const body = req.body ?? {};
    const caseId = text(body.caseId, 64);
    const incident = caseId ? cases.find(db, caseId) : null;

    const arrest = createArrest({
      id: newId('arr'),
      arrestNumber: nextArrestNumber(arrests.columnValues(db, 'arrest_number')),
      caseId,
      caseNumber: incident?.caseNumber ?? '',
      masterId: text(body.masterId, 64),
      personName: nameOf(db, text(body.masterId, 64)),
      // Whoever is writing it up made the arrest until they say otherwise: the
      // common case, and the one where a wrong default costs the most.
      arrestingOfficerId: user.id,
      arrestingOfficerName: user.name,
      arrestedAt: text(body.arrestedAt, 40),
      createdBy: user.id,
    });

    arrests.save(db, arrest);
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'arrest.created',
      target: arrest.arrestNumber,
      detail: arrest.caseNumber ? `on ${arrest.caseNumber}` : 'no case',
    });
    res.json({ arrest });
  });

  app.put('/api/arrests/:id', requireAuth, (req: Request, res: Response) => {
    const user = req.user!;
    const current = arrests.find(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: 'No such arrest.' });
      return;
    }
    if (current.status === 'approved') {
      res.status(409).json({
        error: 'This arrest has been approved. Reopen it to change anything.',
      });
      return;
    }
    if (current.createdBy !== user.id && current.status !== 'returned') {
      // Somebody else's draft. Reviewing it is a different endpoint.
      res.status(403).json({ error: 'This is somebody else’s arrest to write up.' });
      return;
    }

    const merged = merge(current, req.body ?? {});
    const named = {
      ...merged,
      personName: merged.masterId ? nameOf(db, merged.masterId) : '',
      arrestingOfficerName:
        merged.arrestingOfficerId === current.arrestingOfficerId
          ? current.arrestingOfficerName
          : ((db
              .prepare('SELECT name FROM users WHERE id = ?')
              .get(merged.arrestingOfficerId) as { name: string } | undefined)?.name ?? ''),
      caseNumber: merged.caseId
        ? (cases.find(db, merged.caseId)?.caseNumber ?? merged.caseNumber)
        : '',
    };

    arrests.save(db, named);
    const incident = named.caseId ? cases.find(db, named.caseId) : null;
    res.json({
      arrest: named,
      problems: checkArrest(named, { incidentReportedAt: incident?.reportedAt }),
    });
  });

  /**
   * Submit, approve, return, reopen — the same four an incident report has.
   *
   * The rules come from `domain/review`, which already knows that nobody
   * approves their own work and that a returned report goes back to its author.
   */
  app.post('/api/arrests/:id/:action', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const arrest = arrests.find(db, req.params.id);
    if (!arrest) {
      res.status(404).json({ error: 'No such arrest.' });
      return;
    }

    const action = req.params.action;
    const note = text(req.body?.note ?? req.body?.reason, 1000);
    const incident = arrest.caseId ? cases.find(db, arrest.caseId) : null;
    const problems = checkArrest(arrest, { incidentReportedAt: incident?.reportedAt });

    let next: Arrest;

    if (action === 'submit') {
      const allowed = canSubmit(arrest.status);
      if (!allowed.ok) {
        res.status(403).json({ error: allowed.reason });
        return;
      }
      const blocking = blockingProblems(problems);
      if (blocking.length > 0) {
        res.status(400).json({
          error: `${blocking.length} ${blocking.length === 1 ? 'problem' : 'problems'} to fix first.`,
          problems,
        });
        return;
      }
      next = {
        ...arrest,
        status: 'pending_review',
        reviewHistory: [...arrest.reviewHistory, reviewEvent('submitted', user)],
      };
    } else if (action === 'approve' || action === 'return') {
      const allowed = canReview(user, {
        status: arrest.status,
        createdBy: arrest.createdBy,
        reportingOfficer: arrest.arrestingOfficerId,
      });
      if (!allowed.ok) {
        res.status(403).json({ error: allowed.reason });
        return;
      }
      if (action === 'return' && !note.trim()) {
        res.status(400).json({
          error: 'Say what needs fixing. A report sent back with no reason is sent back twice.',
        });
        return;
      }
      next = {
        ...arrest,
        status: action === 'approve' ? 'approved' : 'returned',
        reviewHistory: [
          ...arrest.reviewHistory,
          reviewEvent(action === 'approve' ? 'approved' : 'returned', user, note),
        ],
      };
    } else if (action === 'reopen') {
      const allowed = canReopen(user, arrest.status);
      if (!allowed.ok) {
        res.status(403).json({ error: allowed.reason });
        return;
      }
      if (!note.trim()) {
        res.status(400).json({ error: 'Say why it is being reopened.' });
        return;
      }
      next = {
        ...arrest,
        status: 'draft',
        reviewHistory: [...arrest.reviewHistory, reviewEvent('reopened', user, note)],
      };
    } else {
      res.status(400).json({ error: 'Unknown action.' });
      return;
    }

    /*
      The arrestee role on the report is written when the arrest is approved,
      not while it is a draft. A half-written arrest should not be putting
      people on a report that is being submitted to the state.
    */
    const incidentPersonId =
      next.status === 'approved' ? linkArrestee(db, next) : next.incidentPersonId;

    const saved = { ...next, incidentPersonId, updatedAt: new Date().toISOString() };
    arrests.save(db, saved);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: AUDIT_ACTION[action],
      target: saved.arrestNumber,
      detail: note,
    });

    res.json({
      arrest: saved,
      problems: checkArrest(saved, { incidentReportedAt: incident?.reportedAt }),
    });
  });
}
