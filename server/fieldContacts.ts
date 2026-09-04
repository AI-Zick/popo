/**
 * Field contact routes.
 *
 * The reads are small — one person's contacts, or one officer's own recent
 * ones — so unlike the trespass list there is no paging here. What there is
 * instead is a rule about who can read them at all.
 *
 * An officer can always read their own. Reading *everybody's* is a supervisor
 * and records function, because a searchable pile of conversations with people
 * who were never charged is precisely the thing that has to have somebody
 * accountable for it. This is not a hypothetical worry: it is the record type
 * that has cost agencies the most in court, and the answer to "who could see
 * this" has been the deciding question more than once.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, documents } from './db';
import { newId } from './ids';
import { requireAuth } from './auth';
import { recordAudit } from './audit';
import { can, type User } from '../src/domain/auth';
import {
  NOT_EVIDENCE,
  adviseContact,
  checkContact,
  createFieldContact,
  createSubject,
  nextContactNumber,
  sortContacts,
  type ContactBasis,
  type ContactSubject,
  type Disposition,
  type FieldContact,
} from '../src/domain/fieldContact';
import { DEFAULT_SCHEDULE, ruleFor, type RetentionRule } from '../src/domain/retention';
import type { AgencyProfile } from '../src/domain/agency';

const contacts = documents<FieldContact>(DOC_TABLES.fieldContacts);

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);

const BASES: ContactBasis[] = ['', 'consensual', 'detention', 'community'];
const DISPOSITIONS: Disposition[] = [
  '', 'advised', 'released', 'citation', 'arrest', 'referred', 'transported',
];

const oneOf = <T extends string>(value: unknown, allowed: T[], fallback: T): T =>
  (allowed as string[]).includes(String(value ?? '')) ? (value as T) : fallback;

function subjectsFrom(input: unknown): ContactSubject[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 12).map((raw) => {
    const subject = (raw ?? {}) as Record<string, unknown>;
    return createSubject({
      id: text(subject.id, 64) || newId('sub'),
      masterId: text(subject.masterId, 64),
      givenName: text(subject.givenName, 120).trim(),
      description: text(subject.description, 500).trim(),
      declinedToIdentify: Boolean(subject.declinedToIdentify),
    });
  });
}

/** How long the agency keeps these, if it has said. */
function retentionYears(db: DatabaseSync): number {
  const row = db.prepare('SELECT doc FROM agency WHERE id = ?').get('default') as
    | { doc: string }
    | undefined;
  const schedule = (row ? (JSON.parse(row.doc) as AgencyProfile).retention : null) as
    | RetentionRule[]
    | null
    | undefined;
  const rule = ruleFor(schedule?.length ? schedule : DEFAULT_SCHEDULE, 'fieldContact');
  return rule && !rule.permanent ? rule.years : 0;
}

/** Everyone reads their own; reading everybody's is a separate job. */
const maySeeAll = (user: User): boolean =>
  can(user, 'audit.view') || can(user, 'reports.approve');

export function registerFieldContactRoutes(app: Express, db: DatabaseSync): void {
  /**
   * Every contact naming one person.
   *
   * Scans the documents rather than a column because a contact can name
   * several people and a subject may be an unidentified description. At one
   * agency's volume that is a table scan of a few thousand small rows; if it
   * ever stops being cheap the answer is a join table, and nothing above this
   * function would notice.
   */
  app.get('/api/people/:id/contacts', requireAuth, (req: Request, res: Response) => {
    const user = req.user!;
    const masterId = text(req.params.id, 64);
    const all = contacts.all(db).filter((contact) =>
      contact.subjects.some((subject) => subject.masterId === masterId),
    );
    const visible = maySeeAll(user) ? all : all.filter((c) => c.officerId === user.id);

    res.json({
      contacts: sortContacts(visible),
      /*
        How many are there that this reader is not being shown. A bare list
        that quietly omits things teaches people the list is complete when it
        is not — and an officer who thinks they have seen everything is worse
        off than one who knows they have not.
      */
      hidden: all.length - visible.length,
      retentionYears: retentionYears(db),
      notice: NOT_EVIDENCE,
    });
  });

  /** An officer's own recent contacts, which is the other way these are read. */
  app.get('/api/contacts', requireAuth, (req: Request, res: Response) => {
    const user = req.user!;
    const mine = req.query.scope !== 'all';
    if (!mine && !maySeeAll(user)) {
      res.status(403).json({
        error: 'Reading everybody’s field contacts is a supervisor and records function.',
      });
      return;
    }
    const list = mine ? contacts.where(db, { officer_id: user.id }) : contacts.all(db);
    res.json({
      contacts: sortContacts(list).slice(0, 200),
      retentionYears: retentionYears(db),
      notice: NOT_EVIDENCE,
    });
  });

  app.post('/api/contacts', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const body = req.body ?? {};

    const draft = {
      occurredAt: text(body.occurredAt, 40).trim(),
      locationId: text(body.locationId, 64),
      address: text(body.address, 200).trim(),
      basis: oneOf(body.basis, BASES, ''),
      reason: text(body.reason, 2000).trim(),
      subjects: subjectsFrom(body.subjects),
      vehicleId: text(body.vehicleId, 64),
      disposition: oneOf(body.disposition, DISPOSITIONS, ''),
      narrative: text(body.narrative, 20_000).trim(),
      caseNumber: text(body.caseNumber, 40).trim(),
    };

    const check = checkContact(draft);
    if (!check.ok) {
      res.status(400).json({ error: check.reason, field: check.field });
      return;
    }

    const contact = createFieldContact({
      ...draft,
      id: newId('fc'),
      number: nextContactNumber(contacts.columnValues(db, 'number')),
      officerId: user.id,
      officerName: user.name,
    });
    contacts.save(db, contact);

    /*
      The audit entry names the contact and the basis, never who was spoken
      to. The audit log is read by more people than the contact is, and a
      record of everybody an officer ever talked to should not leak out
      through the log of the fact that they wrote it down.
    */
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'contact.recorded',
      target: contact.number,
      detail: draft.basis,
    });

    res.status(201).json({
      contact,
      advice: adviseContact(draft),
      retentionYears: retentionYears(db),
    });
  });

  /**
   * Correcting one.
   *
   * Only its author, or somebody who can approve reports. A field contact is
   * one officer's account of a conversation they had; another officer editing
   * it is not a correction, it is a different account with the first
   * officer's name on it.
   */
  app.patch('/api/contacts/:id', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const contact = contacts.find(db, text(req.params.id, 64));
    if (!contact) {
      res.status(404).json({ error: 'No such contact.' });
      return;
    }
    if (contact.officerId !== user.id && !can(user, 'reports.approve')) {
      res.status(403).json({
        error: 'This is somebody else’s account of a conversation they had. Only they, or a supervisor, can change it.',
      });
      return;
    }

    const body = req.body ?? {};
    const next: FieldContact = {
      ...contact,
      basis: body.basis === undefined ? contact.basis : oneOf(body.basis, BASES, contact.basis),
      reason: body.reason === undefined ? contact.reason : text(body.reason, 2000).trim(),
      disposition:
        body.disposition === undefined
          ? contact.disposition
          : oneOf(body.disposition, DISPOSITIONS, contact.disposition),
      narrative: body.narrative === undefined ? contact.narrative : text(body.narrative, 20_000).trim(),
      subjects: body.subjects === undefined ? contact.subjects : subjectsFrom(body.subjects),
      caseNumber: body.caseNumber === undefined ? contact.caseNumber : text(body.caseNumber, 40).trim(),
      updatedAt: new Date().toISOString(),
    };

    const check = checkContact(next);
    if (!check.ok) {
      res.status(400).json({ error: check.reason, field: check.field });
      return;
    }

    contacts.save(db, next);
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'contact.corrected',
      target: contact.number,
      detail: next.basis,
    });

    res.json({ contact: next, advice: adviseContact(next) });
  });
}
