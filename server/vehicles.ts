/**
 * Master Vehicle Index routes.
 *
 * The interesting one is the resolve endpoint. An officer types a plate on a
 * stop or a crash, and this decides whether that is a car already on file. It
 * never decides on their behalf beyond a VIN — see `autoLinkVehicle` and the
 * long note in `vehicleMatching` about why a plate is not a car.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, documents } from './db';
import { newId } from './ids';
import { requireAuth } from './auth';
import { recordAudit } from './audit';
import {
  createMasterVehicle,
  isIdentifiable,
  normalizePlate,
  normalizeVin,
  vehicleName,
  vinCheckDigit,
  type MasterVehicle,
} from '../src/domain/vehicle';
import {
  autoLinkVehicle,
  findVehicleMatches,
  mergeObservation,
  type VehicleQuery,
} from '../src/domain/vehicleMatching';
import type { MasterPerson } from '../src/domain/person';

const vehicles = documents<MasterVehicle>(DOC_TABLES.vehicles);
const people = documents<MasterPerson>(DOC_TABLES.people);

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);

const queryFrom = (body: Record<string, unknown>): VehicleQuery => ({
  vin: text(body.vin, 32).trim(),
  plate: text(body.plate, 16).trim(),
  plateState: text(body.plateState, 2).trim(),
  year: text(body.year, 4).trim(),
  make: text(body.make, 40).trim(),
  model: text(body.model, 40).trim(),
  color: text(body.color, 30).trim(),
});

/*
  Candidates are scored against an index held in memory.

  Loading every vehicle to answer one query is fine at the scale one agency
  reaches and would not be at ten — but the blocking keys mean only records
  sharing a plate or VIN are ever scored, so the shape that has to change first
  is this load, not the matching. Narrowing it to the rows sharing a key is a
  SQL change behind this function, and nothing above it would notice.
*/
function candidateIndex(db: DatabaseSync, query: VehicleQuery): Record<string, MasterVehicle> {
  const vin = normalizeVin(query.vin ?? '');
  const plate = normalizePlate(query.plate ?? '');
  const list = vehicles.all(db).filter((vehicle) => {
    if (vin && normalizeVin(vehicle.vin) === vin) return true;
    if (!plate) return false;
    if (normalizePlate(vehicle.plate) === plate) return true;
    return vehicle.formerPlates?.some((entry) => normalizePlate(entry.plate) === plate) ?? false;
  });
  return Object.fromEntries(list.map((vehicle) => [vehicle.id, vehicle]));
}

export function registerVehicleRoutes(app: Express, db: DatabaseSync): void {
  /** The whole index, for the screen that lists it. */
  app.get('/api/vehicles', requireAuth, (_req: Request, res: Response) => {
    res.json({ vehicles: vehicles.all(db) });
  });

  app.get('/api/vehicles/:id', requireAuth, (req: Request, res: Response) => {
    const vehicle = vehicles.find(db, text(req.params.id, 64));
    if (!vehicle) {
      res.status(404).json({ error: 'No such vehicle.' });
      return;
    }
    res.json({
      vehicle,
      registeredOwner: vehicle.registeredOwnerId
        ? people.find(db, vehicle.registeredOwnerId)
        : null,
    });
  });

  /**
   * What this vehicle might already be.
   *
   * Answers with candidates and a verdict, never with a write. The caller
   * decides — which for a VIN hit means accepting the automatic link, and for
   * anything weaker means showing an officer what was found.
   */
  app.post('/api/vehicles/resolve', requireAuth, (req: Request, res: Response) => {
    const query = queryFrom(req.body ?? {});
    const matches = findVehicleMatches(query, candidateIndex(db, query), { limit: 10 });

    res.json({
      matches,
      autoLink: autoLinkVehicle(matches),
      // Said on every read, not only on save: an officer who typed a VIN wrong
      // wants to know before they walk away from the car.
      vin: vinCheckDigit(query.vin ?? ''),
    });
  });

  /**
   * Filing one.
   *
   * A VIN hit folds the sighting into the record that already exists rather
   * than creating a second one — that is the whole point of an index — and
   * says so in the response, because an officer who pressed "add" and got back
   * an existing record needs to know which happened.
   */
  app.post('/api/vehicles', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const body = req.body ?? {};
    const query = queryFrom(body);

    if (!isIdentifiable(query)) {
      res.status(400).json({
        error: 'A vehicle needs a plate or a VIN. A make and a colour describes a thousand cars.',
        field: 'plate',
      });
      return;
    }

    const check = vinCheckDigit(query.vin ?? '');
    /*
      A failing check digit is a warning, not a refusal. Imported vehicles, and
      anything built outside North America, can carry a VIN that legitimately
      fails it — and an officer standing next to a car reading the number off
      the windscreen is more likely to be right than this arithmetic.
    */

    const matches = findVehicleMatches(query, candidateIndex(db, query), { limit: 10 });
    const automatic = autoLinkVehicle(matches);
    const now = new Date().toISOString();

    if (automatic && !body.forceNew) {
      const merged = mergeObservation(automatic.master, query, now);
      if (merged !== automatic.master) vehicles.save(db, merged);
      res.json({
        vehicle: merged,
        linkedToExisting: true,
        reasons: automatic.reasons,
        vin: check,
      });
      return;
    }

    const vehicle = createMasterVehicle({
      ...query,
      id: newId('veh'),
      registeredOwnerId: text(body.registeredOwnerId, 64),
      notes: text(body.notes, 2000).trim(),
      cautions: Array.isArray(body.cautions)
        ? body.cautions.slice(0, 12).map((caution: unknown) => text(caution, 120))
        : [],
      createdAt: now,
      updatedAt: now,
    });
    vehicles.save(db, vehicle);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'vehicle.created',
      target: vehicleName(vehicle),
      detail: vehicle.vin || vehicle.plate,
    });

    res.status(201).json({
      vehicle,
      linkedToExisting: false,
      // Anything short of certain is reported so the officer can still link it
      // by hand rather than discovering the duplicate months later.
      nearMatches: matches.filter((match) => match.tier !== 'certain'),
      vin: check,
    });
  });

  app.patch('/api/vehicles/:id', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const existing = vehicles.find(db, text(req.params.id, 64));
    if (!existing) {
      res.status(404).json({ error: 'No such vehicle.' });
      return;
    }

    const body = req.body ?? {};
    const patch = queryFrom(body);
    const now = new Date().toISOString();

    // A changed plate is a re-registration, and goes through the same path a
    // sighting does so the old plate is kept either way.
    const next: MasterVehicle = {
      ...mergeObservation(existing, patch, now),
      registeredOwnerId:
        body.registeredOwnerId === undefined
          ? existing.registeredOwnerId
          : text(body.registeredOwnerId, 64),
      notes: body.notes === undefined ? existing.notes : text(body.notes, 2000).trim(),
      cautions: Array.isArray(body.cautions)
        ? body.cautions.slice(0, 12).map((caution: unknown) => text(caution, 120))
        : existing.cautions,
      updatedAt: now,
    };

    /*
      A correction, unlike a sighting, is allowed to overwrite — that is what
      makes it a correction. Only the fields actually sent, though: an absent
      field is not an instruction to blank one.
    */
    for (const field of ['vin', 'plate', 'plateState', 'year', 'make', 'model', 'color'] as const) {
      if (body[field] !== undefined && String(body[field]).trim()) {
        (next[field] as string) = String(body[field]).trim();
      }
    }

    vehicles.save(db, next);
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'vehicle.updated',
      target: vehicleName(next),
      detail: next.vin || next.plate,
    });

    res.json({ vehicle: next, vin: vinCheckDigit(next.vin) });
  });
}
