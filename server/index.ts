/**
 * API server.
 *
 * Every route re-decides authorisation from the session the server issued.
 * Nothing here trusts a role, a permission or an identity supplied by the
 * client — those exist in the browser only to decide what to render.
 */

import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import type { DatabaseSync } from 'node:sqlite';

import { DOC_TABLES, openDatabase, readDocs, writeDocs } from './db';
import {
  attemptSignIn,
  clearSessionCookie,
  destroySession,
  getCredential,
  getUserById,
  listUsers,
  requireAuth,
  requirePermission,
  saveCredential,
  sessionMiddleware,
  setSessionCookie,
} from './auth';
import { readAuditLog, recordAudit, verifyAuditLog } from './audit';
import { seedDatabase } from './seed';
import { checkPassword, hashPassword, verifyPassword } from '../src/domain/credentials';
import {
  can,
  canAssignRole,
  canDeactivate,
  canManageUser,
  createUser,
  sanitizeUserInput,
  type User,
} from '../src/domain/auth';
import { createCredential } from '../src/domain/session';
import { generateTemporaryPassword } from '../src/domain/credentials';

const PORT = Number(process.env.PORT ?? 4000);
const DB_PATH = process.env.AEGIS_DB ?? 'data/aegis.db';

export function createApp(db: DatabaseSync) {
  const app = express();

  // Reports carry narratives and many records; 4 MB is generous for JSON and
  // still small enough that a single request cannot exhaust memory.
  app.use(express.json({ limit: '4mb' }));
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.db = db;
    next();
  });
  app.use(sessionMiddleware);

  /* ---- Auth --------------------------------------------------------- */

  app.post('/api/auth/sign-in', async (req: Request, res: Response) => {
    const { username, password } = req.body ?? {};
    const result = await attemptSignIn(db, String(username ?? ''), String(password ?? ''));
    if (result.ok && result.session) setSessionCookie(res, result.session.id);
    res.status(result.status).json(result.body);
  });

  app.post('/api/auth/sign-out', (req: Request, res: Response) => {
    if (req.session && req.user) {
      void recordAudit(db, {
        actorId: req.user.id,
        actorName: req.user.name,
        action: 'auth.signOut',
        target: '',
        detail: '',
      });
      destroySession(db, req.session.id);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  /** Who the server thinks you are. The client never decides this. */
  app.get('/api/auth/me', (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    const credential = getCredential(db, req.user.id);
    res.json({
      user: req.user,
      mustChangePassword: credential?.mustChangePassword ?? false,
    });
  });

  app.post('/api/auth/password', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const { current, next } = req.body ?? {};
    const credential = getCredential(db, user.id);
    if (!credential) {
      res.status(400).json({ error: 'No credential on file.' });
      return;
    }

    if (credential.passwordHash && !(await verifyPassword(String(current ?? ''), credential.passwordHash))) {
      res.status(400).json({ error: 'That is not your current password.' });
      return;
    }

    const policy = checkPassword(String(next ?? ''), {
      username: user.username,
      name: user.name,
    });
    if (!policy.ok) {
      res.status(400).json({ error: policy.problems.join(' ') });
      return;
    }

    if (await verifyPassword(String(next), credential.passwordHash)) {
      res.status(400).json({ error: 'The new password must be different from the old one.' });
      return;
    }

    saveCredential(db, {
      ...credential,
      passwordHash: await hashPassword(String(next)),
      mustChangePassword: false,
      passwordChangedAt: new Date().toISOString(),
    });
    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'auth.passwordChanged',
      target: '',
      detail: '',
    });
    res.json({ ok: true });
  });

  /* ---- Bootstrap state ---------------------------------------------- */

  /** Everything the signed-in client needs to render. */
  app.get('/api/state', requireAuth, (req: Request, res: Response) => {
    const agencyRow = db.prepare('SELECT doc FROM agency WHERE id = ?').get('default') as
      | { doc: string }
      | undefined;

    const people = readDocs(db, DOC_TABLES.people);
    const locations = readDocs(db, DOC_TABLES.locations);

    res.json({
      incidents: readDocs(db, DOC_TABLES.incidents),
      people: Object.fromEntries(people.map((p) => [String(p.id), p])),
      locations: Object.fromEntries(locations.map((l) => [String(l.id), l])),
      agency: agencyRow ? JSON.parse(agencyRow.doc) : null,
      users: listUsers(db),
      // The log is only sent to people entitled to read it.
      auditLog: can(req.user!, 'audit.view') ? readAuditLog(db) : [],
    });
  });

  /**
   * Write-through of a whole collection. Coarse, and deliberately so at this
   * stage — the client still owns the domain logic. The seam to replace when
   * that changes is here, not in the schema.
   */
  app.put('/api/state/:collection', requireAuth, (req: Request, res: Response) => {
    const table = DOC_TABLES[req.params.collection];
    if (!table) {
      res.status(404).json({ error: 'Unknown collection.' });
      return;
    }
    const docs = req.body?.docs;
    if (!Array.isArray(docs)) {
      res.status(400).json({ error: 'Expected { docs: [...] }.' });
      return;
    }
    writeDocs(db, table, docs);
    res.json({ ok: true, count: docs.length });
  });

  app.put('/api/agency', requirePermission('agency.configure'), (req: Request, res: Response) => {
    const doc = req.body?.agency;
    if (!doc || typeof doc !== 'object') {
      res.status(400).json({ error: 'Expected { agency: {...} }.' });
      return;
    }
    db.prepare(
      `INSERT INTO agency (id, doc, updated_at) VALUES ('default', ?, ?)
       ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at`,
    ).run(JSON.stringify(doc), new Date().toISOString());
    void recordAudit(db, {
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'agency.configured',
      target: String(doc.name ?? ''),
      detail: '',
    });
    res.json({ ok: true });
  });

  /* ---- Accounts ------------------------------------------------------ */

  app.post('/api/users', requirePermission('users.manage'), async (req: Request, res: Response) => {
    const actor = req.user!;
    const input = req.body ?? {};

    /*
     * Refuse what was asked for, rather than quietly building something else.
     * `sanitizeUserInput` below would downgrade an over-reaching role to
     * `officer`, which is safe but dishonest: an administrator who asked for a
     * vendor account would be told it worked and get something different. The
     * raw request is checked first so the answer is no.
     */
    if (input.role && !canAssignRole(actor, input.role)) {
      res.status(403).json({
        error: `You cannot create an account with the role "${input.role}" — it carries more authority than your own.`,
      });
      return;
    }
    const requestedGrants: string[] = Array.isArray(input.grants) ? input.grants : [];
    const refusedGrants = requestedGrants.filter((p) => !can(actor, p as never));
    if (refusedGrants.length > 0) {
      res.status(403).json({
        error: `You cannot grant permissions you do not hold yourself: ${refusedGrants.join(', ')}.`,
      });
      return;
    }

    // Still sanitised afterwards, so anything the checks above did not
    // anticipate cannot slip through.
    const safe = sanitizeUserInput(actor, input);
    if (!safe.name?.toString().trim()) {
      res.status(400).json({ error: 'A name is required.' });
      return;
    }
    const username = String(safe.username ?? '').trim().toLowerCase();
    if (!username) {
      res.status(400).json({ error: 'A username is required.' });
      return;
    }
    const clash = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (clash) {
      res.status(409).json({ error: 'That username is already in use.' });
      return;
    }

    const account = createUser({
      ...safe,
      id: `usr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      username,
      name: String(safe.name).trim(),
      createdBy: actor.name,
    });

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    db.prepare(
      `INSERT INTO users (id, username, name, badge, role, grants, revocations, active, deactivated_at, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, '', ?, ?)`,
    ).run(
      account.id,
      account.username,
      account.name,
      account.badge,
      account.role,
      JSON.stringify(account.grants),
      JSON.stringify(account.revocations),
      account.createdAt,
      account.createdBy,
    );
    saveCredential(db, createCredential(account.id, { passwordHash, mustChangePassword: true }));

    await recordAudit(db, {
      actorId: actor.id,
      actorName: actor.name,
      action: 'user.created',
      target: account.name,
      detail: account.role,
    });

    // Shown once, never stored readably, and the holder must change it.
    res.json({ ok: true, user: account, temporaryPassword });
  });

  app.post(
    '/api/users/:id/deactivate',
    requirePermission('users.manage'),
    async (req: Request, res: Response) => {
      const actor = req.user!;
      const target = getUserById(db, req.params.id);
      if (!target) {
        res.status(404).json({ error: 'No such account.' });
        return;
      }
      const guard = canDeactivate(actor, target, listUsers(db));
      if (!guard.ok) {
        res.status(403).json({ error: guard.reason });
        return;
      }
      db.prepare('UPDATE users SET active = 0, deactivated_at = ? WHERE id = ?').run(
        new Date().toISOString(),
        target.id,
      );
      // End their sessions immediately rather than at next expiry.
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      await recordAudit(db, {
        actorId: actor.id,
        actorName: actor.name,
        action: 'user.deactivated',
        target: target.name,
        detail: '',
      });
      res.json({ ok: true });
    },
  );

  app.post(
    '/api/users/:id/reactivate',
    requirePermission('users.manage'),
    async (req: Request, res: Response) => {
      const actor = req.user!;
      const target = getUserById(db, req.params.id);
      if (!target) {
        res.status(404).json({ error: 'No such account.' });
        return;
      }
      if (!canManageUser(actor, target)) {
        res.status(403).json({ error: 'This account has more authority than yours.' });
        return;
      }
      db.prepare("UPDATE users SET active = 1, deactivated_at = '' WHERE id = ?").run(target.id);
      await recordAudit(db, {
        actorId: actor.id,
        actorName: actor.name,
        action: 'user.reactivated',
        target: target.name,
        detail: '',
      });
      res.json({ ok: true });
    },
  );

  /* ---- Audit --------------------------------------------------------- */

  app.get('/api/audit', requirePermission('audit.view'), (_req: Request, res: Response) => {
    res.json({ entries: readAuditLog(db) });
  });

  app.get('/api/audit/verify', requirePermission('audit.view'), async (_req, res: Response) => {
    res.json(await verifyAuditLog(db));
  });

  /** Audit events the client observes, such as reading a restricted note. */
  app.post('/api/audit', requireAuth, async (req: Request, res: Response) => {
    const { action, target, detail } = req.body ?? {};
    const allowed = new Set([
      'note.added',
      'note.retracted',
      'note.restored',
      'note.restrictedViewed',
      'report.submitted',
    ]);
    if (!allowed.has(String(action))) {
      res.status(400).json({ error: 'Not a client-reportable action.' });
      return;
    }
    // Actor comes from the session, never from the request body.
    const entry = await recordAudit(db, {
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: String(action) as never,
      target: String(target ?? ''),
      detail: String(detail ?? ''),
    });
    res.json({ ok: true, id: entry.id });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'No such endpoint.' });
  });

  return app;
}

/* ------------------------------------------------------------------ */

const isMain = process.argv[1]?.includes('server/index');
if (isMain) {
  const db = openDatabase(DB_PATH);
  await seedDatabase(db);
  createApp(db).listen(PORT, () => {
    console.log(`Aegis API listening on http://localhost:${PORT} (db: ${DB_PATH})`);
  });
}
