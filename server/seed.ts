/**
 * First-run seeding. Only ever populates an empty database — an agency's real
 * data is never overwritten by demo records.
 */

import type { DatabaseSync } from 'node:sqlite';
import { DOC_TABLES, writeDocs } from './db';
import { saveCredential } from './auth';
import { createCredential } from '../src/domain/session';
import { hashPassword } from '../src/domain/credentials';
import { seedState, DEMO_PASSWORD } from '../src/state/seed';

export async function seedDatabase(db: DatabaseSync): Promise<void> {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (existing.n > 0) return;

  const state = seedState();

  db.prepare('INSERT INTO agency (id, doc, updated_at) VALUES (?, ?, ?)').run(
    'default',
    JSON.stringify(state.agency),
    new Date().toISOString(),
  );

  const insertUser = db.prepare(
    `INSERT INTO users (id, username, name, badge, role, grants, revocations, active, deactivated_at, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, '', ?, ?)`,
  );

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const user of state.users) {
    insertUser.run(
      user.id,
      user.username,
      user.name,
      user.badge,
      user.role,
      JSON.stringify(user.grants),
      JSON.stringify(user.revocations),
      user.createdAt,
      user.createdBy,
    );
    saveCredential(db, createCredential(user.id, { passwordHash, mustChangePassword: false }));
  }

  writeDocs(db, DOC_TABLES.incidents, state.incidents as unknown as Record<string, unknown>[]);
  writeDocs(db, DOC_TABLES.stops, state.stops as unknown as Record<string, unknown>[]);
  writeDocs(db, DOC_TABLES.people, Object.values(state.people) as unknown as Record<string, unknown>[]);
  writeDocs(db, DOC_TABLES.locations, Object.values(state.locations) as unknown as Record<string, unknown>[]);

  console.log(`Seeded ${state.users.length} accounts and ${state.incidents.length} reports.`);
}
