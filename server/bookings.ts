/**
 * Booking routes.
 *
 * Deliberately not shaped like the arrest routes, because booking is not a
 * report. An arrest is written, submitted and approved; a booking is a running
 * record of a person who is in a building right now, edited by whoever is on
 * duty, and finished when they leave. There is no review cycle to put on it and
 * pretending otherwise would mean a custody roster that only shows people whose
 * paperwork a sergeant has got round to.
 *
 * Three rules are enforced here rather than only in the browser, because each
 * of them is the kind that gets clicked past at four in the morning:
 *
 *   A release is refused while property is unaccounted for. The domain works
 *   out why; this route will not write the release.
 *
 *   A concern is cleared, never deleted, and only by somebody who may — with
 *   their name and their reason on it.
 *
 *   Everything that happens to somebody in custody is audited by name. The
 *   question after a person is hurt in a cell is who did what and when, and an
 *   audit trail written afterwards is not one.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, documents } from './db';
import { newId } from './ids';
import { requireAuth } from './auth';
import { recordAudit } from './audit';
import { can } from '../src/domain/auth';
import {
  createBooking,
  createConcern,
  createItem,
  custody,
  nextBookingNumber,
  releaseBlockers,
  roster,
  type Booking,
  type Concern,
  type ConcernKind,
  type HeldItem,
  type ItemKind,
  type ItemOutcome,
  type ReleaseReason,
} from '../src/domain/booking';
import type { Arrest } from '../src/domain/arrest';

const bookings = documents<Booking>(DOC_TABLES.bookings);
const arrests = documents<Arrest>(DOC_TABLES.arrests);

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);
const flag = (value: unknown): boolean => value === true;

const ITEM_KINDS: ItemKind[] = ['money', 'valuables', 'clothing', 'electronics', 'documents', 'medication', 'other'];
const ITEM_OUTCOMES: ItemOutcome[] = ['', 'returned', 'toEvidence', 'contraband', 'releasedToOther', 'destroyed'];
const CONCERN_KINDS: ConcernKind[] = [
  'medical', 'medication', 'mentalHealth', 'suicideRisk', 'withdrawal',
  'keepSeparate', 'mobility', 'communication', 'other',
];
const RELEASE_REASONS: ReleaseReason[] = [
  '', 'bond', 'ownRecognisance', 'citation', 'chargesDropped',
  'timeServed', 'courtOrder', 'transferred', 'toHospital',
];

const oneOf = <T extends string>(value: unknown, allowed: T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/**
 * Fields the browser may set directly.
 *
 * Property, concerns and the release are all missing from this list on
 * purpose. Each of them has a rule attached — property blocks a release,
 * a concern may only be cleared by somebody who may clear it — and a blanket
 * merge is how a rule gets bypassed by a client that simply sends the whole
 * document back.
 */
function merge(current: Booking, patch: Record<string, unknown>): Booking {
  return {
    ...current,
    bookedAt: patch.bookedAt !== undefined ? text(patch.bookedAt, 40) : current.bookedAt,
    bookedByName: patch.bookedByName !== undefined ? text(patch.bookedByName, 120) : current.bookedByName,
    facility: patch.facility !== undefined ? text(patch.facility, 160) : current.facility,
    cell: patch.cell !== undefined ? text(patch.cell, 60) : current.cell,
    searchedByName: patch.searchedByName !== undefined ? text(patch.searchedByName, 120) : current.searchedByName,
    photographed: patch.photographed !== undefined ? flag(patch.photographed) : current.photographed,
    fingerprinted: patch.fingerprinted !== undefined ? flag(patch.fingerprinted) : current.fingerprinted,
    inventoryAcknowledged:
      patch.inventoryAcknowledged !== undefined ? flag(patch.inventoryAcknowledged) : current.inventoryAcknowledged,
    inventoryWitnessName:
      patch.inventoryWitnessName !== undefined ? text(patch.inventoryWitnessName, 120) : current.inventoryWitnessName,
    updatedAt: new Date().toISOString(),
  };
}

function itemFrom(body: Record<string, unknown>, current?: HeldItem): HeldItem {
  return createItem({
    ...(current ?? {}),
    id: current?.id ?? newId('itm'),
    kind: oneOf(body.kind, ITEM_KINDS, current?.kind ?? 'other'),
    description: text(body.description ?? current?.description, 240),
    quantity: text(body.quantity ?? current?.quantity, 40),
    amount: text(body.amount ?? current?.amount, 20),
    storedAt: text(body.storedAt ?? current?.storedAt, 80),
    outcome: oneOf(body.outcome, ITEM_OUTCOMES, current?.outcome ?? ''),
    releasedTo: text(body.releasedTo ?? current?.releasedTo, 160),
    reference: text(body.reference ?? current?.reference, 120),
    note: text(body.note ?? current?.note, 500),
  });
}

export function registerBookingRoutes(app: Express, db: DatabaseSync): void {
  /**
   * Who is in the building.
   *
   * Open to any signed-in user, because knowing who is in a cell is what a
   * shift briefing is. Longest-held first, and the concerns come with the row —
   * a roster that makes somebody click into each person to find out who is
   * diabetic is a roster nobody reads.
   */
  app.get('/api/bookings/roster', requireAuth, (_req: Request, res: Response) => {
    /*
      Asked of the database rather than by reading every booking: the flattened
      released_at column is empty exactly while somebody is still here.
    */
    const open = bookings.where(db, { released_at: '' });
    res.json({ roster: roster(open), asOf: new Date().toISOString() });
  });

  app.get('/api/bookings', requireAuth, (req: Request, res: Response) => {
    const criteria: Record<string, string> = {};
    if (req.query.arrestId) criteria.arrest_id = text(req.query.arrestId, 64);
    if (req.query.masterId) criteria.master_id = text(req.query.masterId, 64);

    const found = bookings.where(db, criteria);
    found.sort((a, b) => (a.bookedAt < b.bookedAt ? 1 : -1));
    res.json({ bookings: found });
  });

  app.get('/api/bookings/:id', requireAuth, (req: Request, res: Response) => {
    const booking = bookings.find(db, req.params.id);
    if (!booking) {
      res.status(404).json({ error: 'No such booking.' });
      return;
    }
    res.json({ booking, blockers: releaseBlockers(booking), custody: custody(booking) });
  });

  /**
   * Books somebody in, from the arrest.
   *
   * The arrest is required. A booking with nobody's arrest behind it is a
   * person held on no recorded authority, and the software should not be the
   * place that first happens.
   */
  app.post('/api/bookings', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const body = req.body ?? {};
    const arrest = arrests.find(db, text(body.arrestId, 64));
    if (!arrest) {
      res.status(400).json({
        error: 'Which arrest is this?',
        advice:
          'A booking hangs off an arrest. Record the arrest first — it is what says on whose authority this person is being held.',
      });
      return;
    }

    /*
      Somebody already in a cell is not booked in twice. Being brought back
      after a release is a new booking, which is why this looks at whether the
      earlier one is still open rather than whether one exists.
    */
    const open = bookings.where(db, { arrest_id: arrest.id, released_at: '' });
    if (open.length > 0) {
      res.status(409).json({
        error: `${arrest.personName || 'This person'} is already booked in on this arrest.`,
        advice: 'Open the existing booking rather than starting a second one.',
        bookingId: open[0].id,
      });
      return;
    }

    const now = new Date().toISOString();
    const booking = createBooking({
      id: newId('bkg'),
      bookingNumber: nextBookingNumber(bookings.columnValues(db, 'booking_number')),
      arrestId: arrest.id,
      arrestNumber: arrest.arrestNumber,
      masterId: arrest.masterId,
      personName: arrest.personName,
      // Whoever is at the desk is booking them in until they say otherwise.
      bookedAt: text(body.bookedAt, 40) || now,
      bookedByName: user.name,
      facility: text(body.facility, 160),
      createdBy: user.id,
    });

    bookings.save(db, booking);
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'booking.opened',
      target: booking.bookingNumber,
      detail: `${booking.personName || 'unnamed'} on ${arrest.arrestNumber}`,
    });
    res.json({ booking });
  });

  app.put('/api/bookings/:id', requireAuth, (req: Request, res: Response) => {
    const booking = bookings.find(db, req.params.id);
    if (!booking) {
      res.status(404).json({ error: 'No such booking.' });
      return;
    }
    if (booking.release?.at) {
      res.status(409).json({
        error: 'This person has been released. The booking is closed.',
        advice: 'Changing what a closed custody record says is not an edit — raise it with a supervisor.',
      });
      return;
    }

    const saved = merge(booking, req.body ?? {});
    bookings.save(db, saved);
    res.json({ booking: saved, blockers: releaseBlockers(saved), custody: custody(saved) });
  });

  /* ---- Property ------------------------------------------------------- */

  /**
   * Adds or amends a line on the property inventory.
   *
   * Every change is audited by name and item. This is the record that gets
   * subpoenaed, and "the list changed at some point" is not an answer to the
   * question that will be asked about it.
   */
  app.post('/api/bookings/:id/items', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const booking = bookings.find(db, req.params.id);
    if (!booking) {
      res.status(404).json({ error: 'No such booking.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const existingId = text(body.id, 64);
    const current = existingId ? booking.items.find((i) => i.id === existingId) : undefined;
    if (existingId && !current) {
      res.status(404).json({ error: 'No such item on this inventory.' });
      return;
    }

    const item = itemFrom(body, current);
    /* Stamped here rather than taken from the client: when an item left is a
       fact about this request, not something a browser gets to assert. */
    if (item.outcome && item.outcome !== current?.outcome) item.outcomeAt = new Date().toISOString();

    const items = current
      ? booking.items.map((i) => (i.id === item.id ? item : i))
      : [...booking.items, item];

    const saved = { ...booking, items, updatedAt: new Date().toISOString() };
    bookings.save(db, saved);
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: current ? 'booking.item.changed' : 'booking.item.added',
      target: booking.bookingNumber,
      detail: `${item.description || item.kind}${item.outcome ? ` — ${item.outcome}` : ''}`,
    });
    res.json({ booking: saved, blockers: releaseBlockers(saved) });
  });

  /**
   * Strikes a line off the inventory.
   *
   * Only a line that is still held and has never been given an outcome — a
   * typo, a duplicate. Removing a line that says where somebody's ring went is
   * not a correction, and this refuses it rather than making the refusal a
   * matter of the browser hiding a button.
   */
  app.delete('/api/bookings/:id/items/:itemId', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const booking = bookings.find(db, req.params.id);
    if (!booking) {
      res.status(404).json({ error: 'No such booking.' });
      return;
    }
    const item = booking.items.find((i) => i.id === req.params.itemId);
    if (!item) {
      res.status(404).json({ error: 'No such item on this inventory.' });
      return;
    }
    if (item.outcome) {
      res.status(409).json({
        error: 'This line says where the item went. It cannot be struck off.',
        advice:
          'If it is wrong, correct what it says. Deleting the only record of where somebody’s property went is what a property claim is made about.',
      });
      return;
    }

    const saved = {
      ...booking,
      items: booking.items.filter((i) => i.id !== item.id),
      updatedAt: new Date().toISOString(),
    };
    bookings.save(db, saved);
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'booking.item.removed',
      target: booking.bookingNumber,
      detail: item.description || item.kind,
    });
    res.json({ booking: saved, blockers: releaseBlockers(saved) });
  });

  /* ---- Concerns -------------------------------------------------------- */

  /** Raised by anybody who sees it. Seeing something and not being able to write it down is the failure mode. */
  app.post('/api/bookings/:id/concerns', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const booking = bookings.find(db, req.params.id);
    if (!booking) {
      res.status(404).json({ error: 'No such booking.' });
      return;
    }

    const body = req.body ?? {};
    const concern = createConcern({
      id: newId('cnc'),
      kind: oneOf(body.kind, CONCERN_KINDS, 'other'),
      detail: text(body.detail, 1000),
      keepSeparateFrom: text(body.keepSeparateFrom, 160),
      raisedAt: new Date().toISOString(),
      raisedByName: user.name,
    });

    const saved = {
      ...booking,
      concerns: [...booking.concerns, concern],
      updatedAt: new Date().toISOString(),
    };
    bookings.save(db, saved);
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'booking.concern.raised',
      target: booking.bookingNumber,
      detail: `${concern.kind}: ${concern.detail.slice(0, 120)}`,
    });
    res.json({ booking: saved });
  });

  /**
   * Clears a concern. Never deletes one.
   *
   * Gated on the same permission that retracts a location note, and for the
   * same reason the user gave for that rule: anybody may put a warning on the
   * record, and taking one off is a decision somebody has to own. Here the
   * stakes are higher — the question after a death in a cell is who stopped
   * acting on what, and a reason is required so there is an answer.
   */
  app.post('/api/bookings/:id/concerns/:concernId/clear', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    if (!can(user, 'notes.retract')) {
      res.status(403).json({
        error: 'Clearing a custody concern is a supervisor’s decision.',
        advice:
          'Anybody can raise one. Standing one down is somebody owning the decision that it no longer applies — ask a supervisor.',
      });
      return;
    }

    const booking = bookings.find(db, req.params.id);
    if (!booking) {
      res.status(404).json({ error: 'No such booking.' });
      return;
    }
    const concern = booking.concerns.find((c) => c.id === req.params.concernId);
    if (!concern) {
      res.status(404).json({ error: 'No such concern on this booking.' });
      return;
    }

    const reason = text(req.body?.reason, 1000).trim();
    if (!reason) {
      res.status(400).json({
        error: 'Say why this no longer applies.',
        advice:
          'Somebody raised it because they saw something. The record has to show why it stopped being acted on.',
      });
      return;
    }

    const cleared: Concern = {
      ...concern,
      clearedAt: new Date().toISOString(),
      clearedByName: user.name,
      clearedReason: reason,
    };
    const saved = {
      ...booking,
      concerns: booking.concerns.map((c) => (c.id === cleared.id ? cleared : c)),
      updatedAt: new Date().toISOString(),
    };
    bookings.save(db, saved);
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'booking.concern.cleared',
      target: booking.bookingNumber,
      detail: `${concern.kind} — ${reason.slice(0, 160)}`,
    });
    res.json({ booking: saved });
  });

  /* ---- Release --------------------------------------------------------- */

  /**
   * Lets somebody out, once everything they came in with is accounted for.
   *
   * The refusal lives here and not only on the screen. Property that walks out
   * of the door unaccounted for is unrecoverable, and it is discovered weeks
   * later by a solicitor — so this is the one place in the booking flow that
   * says no rather than warning.
   */
  app.post('/api/bookings/:id/release', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const booking = bookings.find(db, req.params.id);
    if (!booking) {
      res.status(404).json({ error: 'No such booking.' });
      return;
    }
    if (booking.release?.at) {
      res.status(409).json({ error: 'This person has already been released.' });
      return;
    }

    const blockers = releaseBlockers(booking);
    if (blockers.length > 0) {
      res.status(409).json({
        error: blockers[0].reason,
        advice: blockers[0].tip,
        blockers,
      });
      return;
    }

    const body = req.body ?? {};
    const saved: Booking = {
      ...booking,
      release: {
        at: new Date().toISOString(),
        reason: oneOf(body.reason, RELEASE_REASONS, ''),
        to: text(body.to, 200),
        releasedByName: user.name,
        note: text(body.note, 1000),
      },
      updatedAt: new Date().toISOString(),
    };

    bookings.save(db, saved);
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'booking.released',
      target: booking.bookingNumber,
      detail: `${booking.personName || 'unnamed'} — ${saved.release!.reason || 'reason not stated'}`,
    });
    res.json({ booking: saved, custody: custody(saved) });
  });
}
