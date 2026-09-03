/**
 * Cruisers, daily checks and maintenance requests.
 *
 * The rules worth reading:
 *
 * **A filed check is not editable.** There is deliberately no route that
 * changes one. A signed statement that a car was fine is exactly the thing
 * nobody should be able to revise after the crash, and a check that can be
 * corrected is a check worth nothing in the one moment it matters.
 *
 * **A failed critical item takes the car off the road here, not in the
 * browser.** The officer's client could be old, wrong, or bypassed; the state
 * of the fleet is the server's business.
 *
 * **Reporting a fault is open to everyone; deciding what happens to it is
 * not.** An officer says what is wrong with the car in front of them. A
 * supervisor decides whether it goes to the garage. That is the same division
 * the review queue already draws, and it is drawn here for the same reason.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, documents } from './db';
import { newId } from './ids';
import { requireAuth, requirePermission } from './auth';
import { can } from '../src/domain/auth';
import { recordAudit } from './audit';
import {
  blockingProblems,
  CLOSED_STATUSES,
  isOpen,
  checkCheck,
  checkRequest,
  createCheck,
  createCruiser,
  createRequest,
  criticalFailures,
  nextRequestNumber,
  takesOffRoad,
  type CheckedItem,
  type Cruiser,
  type CruiserCheck,
  type CruiserStatus,
  type MaintenanceRequest,
  type RequestStatus,
  type Urgency,
} from '../src/domain/fleet';
import type { AgencyProfile } from '../src/domain/agency';

const cruisers = documents<Cruiser>(DOC_TABLES.cruisers);
const checks = documents<CruiserCheck>(DOC_TABLES.cruiserChecks);
const requests = documents<MaintenanceRequest>(DOC_TABLES.maintenanceRequests);

const STATUSES: CruiserStatus[] = ['inService', 'outOfService', 'inShop', 'retired'];
const URGENCIES: Urgency[] = ['routine', 'soon', 'unsafe'];
const REQUEST_STATUSES: RequestStatus[] = [
  'open', 'acknowledged', 'scheduled', 'resolved', 'declined',
];

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);

function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function agencyChecklist(db: DatabaseSync) {
  const row = db.prepare('SELECT doc FROM agency WHERE id = ?').get('default') as
    | { doc: string }
    | undefined;
  if (!row) return [];
  return (JSON.parse(row.doc) as AgencyProfile).checklist ?? [];
}

/**
 * Puts a car off the road and says why.
 *
 * Only ever moves it *out* of service. Bringing a car back is a decision
 * somebody makes deliberately, not something that happens because the next
 * check passed — the fault may still be there and simply not on the list.
 */
function takeOffRoad(db: DatabaseSync, cruiserId: string, why: string): void {
  const cruiser = cruisers.find(db, cruiserId);
  if (!cruiser || cruiser.status !== 'inService') return;
  cruisers.save(db, {
    ...cruiser,
    status: 'outOfService',
    statusNote: why,
    updatedAt: new Date().toISOString(),
  });
}

export function registerFleetRoutes(app: Express, db: DatabaseSync): void {
  /* ---- The cars ---------------------------------------------------- */

  app.get('/api/fleet', requireAuth, (_req: Request, res: Response) => {
    res.json({
      cruisers: cruisers.all(db),
      checks: checks.all(db),
      requests: requests.all(db),
    });
  });

  /** Adding and editing a car is agency setup, the same as adding a beat. */
  app.post('/api/fleet/cruisers', requirePermission('agency.configure'), (req, res) => {
    const body = req.body ?? {};
    const unit = text(body.unit, 20).trim();
    if (!unit) {
      res.status(400).json({ error: 'A car needs a unit number — what it is called on the radio.' });
      return;
    }
    if (cruisers.where(db, { unit }).length > 0) {
      res.status(409).json({ error: `Unit ${unit} already exists.` });
      return;
    }

    const cruiser = createCruiser({
      id: newId('crz'),
      unit,
      year: text(body.year, 4),
      make: text(body.make, 40),
      model: text(body.model, 40),
      plate: text(body.plate, 20),
      vin: text(body.vin, 20),
      odometer: text(body.odometer, 10),
    });
    cruisers.save(db, cruiser);
    res.json({ cruiser });
  });

  app.patch('/api/fleet/cruisers/:id', requirePermission('agency.configure'), (req, res) => {
    const current = cruisers.find(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: 'No such car.' });
      return;
    }
    const body = req.body ?? {};
    const keep = <T>(value: unknown, fallback: T, read: (v: unknown) => T): T =>
      value === undefined ? fallback : read(value);

    const next: Cruiser = {
      ...current,
      unit: keep(body.unit, current.unit, (v) => text(v, 20).trim() || current.unit),
      year: keep(body.year, current.year, (v) => text(v, 4)),
      make: keep(body.make, current.make, (v) => text(v, 40)),
      model: keep(body.model, current.model, (v) => text(v, 40)),
      plate: keep(body.plate, current.plate, (v) => text(v, 20)),
      vin: keep(body.vin, current.vin, (v) => text(v, 20)),
      odometer: keep(body.odometer, current.odometer, (v) => text(v, 10)),
      status: keep(body.status, current.status, (v) => oneOf(v, STATUSES, current.status)),
      statusNote: keep(body.statusNote, current.statusNote, (v) => text(v, 300)),
      assignedToId: keep(body.assignedToId, current.assignedToId, (v) => text(v, 64)),
      assignedToName: keep(body.assignedToName, current.assignedToName, (v) => text(v, 120)),
      notes: keep(body.notes, current.notes, (v) => text(v, 1000)),
      updatedAt: new Date().toISOString(),
    };
    cruisers.save(db, next);
    res.json({ cruiser: next });
  });

  /* ---- The daily check --------------------------------------------- */

  /**
   * Files one. Everyone does this; it is the start of a shift.
   *
   * The check is written first and the requests it raises second, so a car
   * with a broken light never ends up with a request pointing at a check that
   * was rejected.
   */
  app.post('/api/fleet/checks', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const body = req.body ?? {};
    const cruiser = cruisers.find(db, text(body.cruiserId, 64));
    if (!cruiser) {
      res.status(404).json({ error: 'No such car.' });
      return;
    }

    // Answers are matched against the agency's current list, so a client
    // sending items that are not on it cannot invent a passing check.
    const onList = agencyChecklist(db).filter((i) => i.active);
    const answers = new Map<string, { result: unknown; note: unknown }>();
    if (Array.isArray(body.items)) {
      for (const raw of body.items.slice(0, 200)) {
        const item = (raw ?? {}) as Record<string, unknown>;
        answers.set(text(item.itemId, 64), {
          result: item.result,
          note: item.note,
        });
      }
    }

    const items: CheckedItem[] = onList.map((item) => {
      const given = answers.get(item.id);
      return {
        itemId: item.id,
        // Copied from the list as it stands now, so renaming an item later
        // does not rewrite what somebody signed.
        label: item.label,
        critical: item.critical,
        result: oneOf(given?.result, ['ok', 'fail', 'na'] as const, '' as const),
        note: text(given?.note, 500),
      };
    });

    const check = createCheck({
      id: newId('chk'),
      cruiserId: cruiser.id,
      cruiserUnit: cruiser.unit,
      officerId: user.id,
      officerName: user.name,
      shift: text(body.shift, 40),
      odometer: text(body.odometer, 10),
      items,
      notes: text(body.notes, 2000),
    });

    const blocking = blockingProblems(checkCheck(check));
    if (blocking.length > 0) {
      res.status(400).json({
        error: `${blocking.length} ${blocking.length === 1 ? 'thing' : 'things'} to fix first.`,
        problems: checkCheck(check),
      });
      return;
    }

    /*
      Every failure becomes a request, because a failure that only lives inside
      a filed checklist is a failure nobody is going to act on. The urgency
      comes from what the agency decided in advance: a critical item is not
      safe to drive, anything else wants looking at.
    */
    const failed = check.items.filter((i) => i.result === 'fail');
    const raised: MaintenanceRequest[] = failed.map((item) =>
      createRequest({
        id: newId('mrq'),
        cruiserId: cruiser.id,
        cruiserUnit: cruiser.unit,
        reportedBy: user.id,
        reportedByName: user.name,
        problem: `${item.label}: ${item.note}`,
        urgency: item.critical ? 'unsafe' : 'soon',
        odometer: check.odometer,
        fromCheckId: check.id,
      }),
    );

    // Numbered in one pass so two failures on one check cannot collide.
    let numbers = requests.columnValues(db, 'number');
    for (const request of raised) {
      request.number = nextRequestNumber(numbers);
      numbers = [...numbers, request.number];
    }

    const saved = { ...check, raisedRequestIds: raised.map((r) => r.id) };
    checks.save(db, saved);
    for (const request of raised) requests.save(db, request);

    // The car's odometer follows whoever last looked at it.
    if (check.odometer) {
      cruisers.save(db, { ...cruiser, odometer: check.odometer, updatedAt: new Date().toISOString() });
    }

    const critical = criticalFailures(saved);
    if (critical.length > 0) {
      takeOffRoad(
        db,
        cruiser.id,
        `${critical.map((i) => i.label).join(', ')} — failed on ${user.name}'s check`,
      );
    }

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'fleet.checked',
      target: cruiser.unit,
      detail:
        failed.length > 0
          ? `${failed.length} failed${critical.length > 0 ? ', off the road' : ''}`
          : 'all clear',
    });

    res.json({ check: saved, requests: raised, offRoad: critical.length > 0 });
  });

  /* ---- Maintenance requests ---------------------------------------- */

  /** Anyone can report a fault. That is the whole point of the form. */
  app.post('/api/fleet/requests', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const body = req.body ?? {};
    const cruiser = cruisers.find(db, text(body.cruiserId, 64));
    if (!cruiser) {
      res.status(404).json({ error: 'No such car.' });
      return;
    }

    const request = createRequest({
      id: newId('mrq'),
      number: nextRequestNumber(requests.columnValues(db, 'number')),
      cruiserId: cruiser.id,
      cruiserUnit: cruiser.unit,
      reportedBy: user.id,
      reportedByName: user.name,
      problem: text(body.problem, 2000).trim(),
      urgency: oneOf(body.urgency, URGENCIES, 'routine'),
      odometer: text(body.odometer, 10),
    });

    const blocking = blockingProblems(checkRequest(request));
    if (blocking.length > 0) {
      res.status(400).json({ error: blocking[0].message, problems: checkRequest(request) });
      return;
    }

    requests.save(db, request);

    /*
      The officer standing next to the car takes it off the road, not a
      supervisor reading the queue tomorrow. A car driven for two more shifts
      while a request waits its turn is the failure this exists to stop.
    */
    if (takesOffRoad(request.urgency)) {
      takeOffRoad(db, cruiser.id, `${request.number}: ${request.problem}`);
    }

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'fleet.requested',
      target: `${cruiser.unit} · ${request.number}`,
      detail: request.urgency === 'unsafe' ? 'not safe to drive' : request.urgency,
    });

    res.json({ request, offRoad: takesOffRoad(request.urgency) });
  });

  /**
   * Moving one along. A supervisor's job.
   *
   * Gated on approving reports rather than on a permission of its own: the
   * person who signs off an officer's work is the person who decides whether
   * their car goes to the garage, and an agency that splits those two ends up
   * granting both to the same people anyway.
   */
  app.post('/api/fleet/requests/:id/status', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    if (!can(user, 'reports.approve')) {
      res.status(403).json({ error: 'A supervisor decides what happens to a maintenance request.' });
      return;
    }

    const current = requests.find(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: 'No such request.' });
      return;
    }

    const status = oneOf(req.body?.status, REQUEST_STATUSES, current.status);
    const note = text(req.body?.note, 1000).trim();

    if (status === 'declined' && !note) {
      res.status(400).json({
        error: 'Say why it is not being done. The officer who reported it will see this.',
      });
      return;
    }

    const now = new Date().toISOString();
    const next: MaintenanceRequest = {
      ...current,
      status,
      assignedTo:
        req.body?.assignedTo === undefined ? current.assignedTo : text(req.body.assignedTo, 200),
      resolvedAt: status === 'resolved' ? now : current.resolvedAt,
      resolution: status === 'resolved' ? note || current.resolution : current.resolution,
      history: [
        ...current.history,
        { id: newId('evt'), at: now, actorName: user.name, status, note },
      ],
    };
    requests.save(db, next);

    /*
      Closing the last thing wrong with a car is what puts it back on the road.

      Declining counts, and has to: a supervisor who looks at "steering feels
      loose", drives it, and decides there is nothing wrong has just cleared
      the car, and leaving it parked until somebody remembers to flip a status
      by hand is how a fleet loses a car to paperwork.

      Deliberately not automatic while anything else is outstanding, and
      deliberately never for a car in the shop — that one comes back when it
      physically comes back.
    */
    let backOnRoad = false;
    if (CLOSED_STATUSES.includes(status)) {
      const stillOpen = requests
        .where(db, { cruiser_id: current.cruiserId })
        .filter((r) => r.id !== next.id && isOpen(r));
      const cruiser = cruisers.find(db, current.cruiserId);
      if (stillOpen.length === 0 && cruiser && cruiser.status === 'outOfService') {
        cruisers.save(db, {
          ...cruiser,
          status: 'inService',
          statusNote: '',
          updatedAt: now,
        });
        backOnRoad = true;
      }
    }

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'fleet.requestUpdated',
      target: `${current.cruiserUnit} · ${current.number}`,
      detail: `${status}${note ? ` · ${note}` : ''}`,
    });

    res.json({ request: next, backOnRoad });
  });
}
