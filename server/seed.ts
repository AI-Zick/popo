/**
 * First-run seeding. Only ever populates an empty database — an agency's real
 * data is never overwritten by demo records.
 */

import type { DatabaseSync } from 'node:sqlite';
import { DOC_TABLES, documents } from './db';
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

  documents(DOC_TABLES.incidents).replaceAll(db, state.incidents);
  documents(DOC_TABLES.arrests).replaceAll(db, state.arrests);
  documents(DOC_TABLES.rosters).replaceAll(db, state.rosters);
  documents(DOC_TABLES.stops).replaceAll(db, state.stops);
  documents(DOC_TABLES.bulletins).replaceAll(db, state.bulletins);
  documents(DOC_TABLES.returns).replaceAll(db, state.returns);
  documents(DOC_TABLES.people).replaceAll(db, Object.values(state.people));
  documents(DOC_TABLES.locations).replaceAll(db, Object.values(state.locations));
  documents(DOC_TABLES.vehicles).replaceAll(db, Object.values(state.vehicles));
  documents(DOC_TABLES.trespasses).replaceAll(db, state.trespasses);
  documents(DOC_TABLES.warrants).replaceAll(db, state.warrants);
  documents(DOC_TABLES.fieldContacts).replaceAll(db, state.contacts);
  documents(DOC_TABLES.citations).replaceAll(db, state.citations);
  documents(DOC_TABLES.publicRequests).replaceAll(db, state.publicRequests);

  console.log(`Seeded ${state.users.length} accounts and ${state.incidents.length} reports.`);
}
