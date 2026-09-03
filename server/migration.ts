/**
 * Committing an approved import.
 *
 * The plan is worked out on the client and shown before anything is written;
 * this endpoint takes the rows a clerk approved and creates them, in one
 * transaction, with import provenance stamped on every field.
 *
 * All-or-nothing on purpose. An import that half-succeeds leaves an agency with
 * a database in a state nobody can describe, and "which rows landed?" is not a
 * question anybody should have to answer by hand at the end of a migration.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, writeDoc } from './db';
import { newId } from './ids';
import { requirePermission } from './auth';
import { recordAudit } from './audit';
import { importProvenance } from '../src/domain/migration';

interface CommitRow {
  values: Record<string, string>;
}

export function registerMigrationRoutes(app: Express, db: DatabaseSync): void {
  /*
    Requires agency configuration rights. A migration rewrites the shared spine
    of the whole system — the name index and the location index — and is not
    something a patrol officer should be able to start from a car.
  */
  app.post(
    '/api/migration/commit',
    requirePermission('agency.configure'),
    async (req: Request, res: Response) => {
      const user = req.user!;
      const kind = String(req.body?.kind ?? '');
      const rows: CommitRow[] = Array.isArray(req.body?.rows) ? req.body.rows : [];

      if (kind !== 'people' && kind !== 'locations') {
        res.status(400).json({ error: 'Unknown import kind.' });
        return;
      }
      if (rows.length === 0) {
        res.status(400).json({ error: 'Nothing to import.' });
        return;
      }
      if (rows.length > 50_000) {
        res.status(413).json({ error: 'Split the file — 50,000 rows at a time.' });
        return;
      }

      const at = new Date().toISOString();
      const created: string[] = [];

      db.exec('BEGIN');
      try {
        for (const row of rows) {
          const v = row.values ?? {};
          if (kind === 'people') {
            const id = newId('mp');
            writeDoc(
              db,
              DOC_TABLES.people,
              {
                id,
                lastName: v.lastName ?? '',
                firstName: v.firstName ?? '',
                middleName: v.middleName ?? '',
                suffix: v.suffix ?? '',
                businessName: v.businessName ?? '',
                aliases: [],
                dob: v.dob ?? '',
                sex: v.sex ?? '',
                race: v.race ?? '',
                ethnicity: '',
                height: '',
                weight: '',
                eyeColor: '',
                hairColor: '',
                scarsMarksTattoos: '',
                address: v.address ?? '',
                city: v.city ?? '',
                state: v.state ?? '',
                zip: v.zip ?? '',
                phone: v.phone ?? '',
                email: '',
                ssn: v.ssn ?? '',
                driverLicense: v.driverLicense ?? '',
                driverLicenseState: v.driverLicenseState ?? '',
                stateId: '',
                cautions: [],
                // Every field says it was imported and unverified, so the
                // freshness strip tells the truth about it afterwards.
                provenance: importProvenance(at),
                mergedFrom: [],
                createdAt: at,
                updatedAt: at,
              },
              null,
            );
            created.push(id);
          } else {
            const id = newId('loc');
            writeDoc(
              db,
              DOC_TABLES.locations,
              {
                id,
                commonName: v.commonName ?? '',
                aliases: [],
                address: v.address ?? '',
                city: v.city ?? '',
                state: v.state ?? '',
                zip: v.zip ?? '',
                locationType: '',
                beat: v.beat ?? '',
                latitude: Number(v.latitude) || 0,
                longitude: Number(v.longitude) || 0,
                geoSource: v.latitude ? 'import' : '',
                hasUnits: false,
                unitLabel: '',
                notes: [],
                createdAt: at,
                updatedAt: at,
              },
              null,
            );
            created.push(id);
          }
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        console.error('Import failed', error);
        res.status(500).json({ error: 'The import failed and nothing was written.' });
        return;
      }

      await recordAudit(db, {
        actorId: user.id,
        actorName: user.name,
        action: 'migration.imported',
        target: kind,
        detail: `${created.length} records`,
      });
      res.json({ ok: true, created: created.length });
    },
  );
}
