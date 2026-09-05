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
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { DOC_TABLES, openDatabase, readDocs, readDocsWithVersions } from './db';
import { registerRecordRoutes, listLocks } from './records';
import { registerAttachmentRoutes, listAttachments } from './attachments';
import { registerReviewRoutes } from './review';
import { registerExtractionRoutes } from './extract';
import { registerSupplementRoutes } from './supplements';
import { registerStopRoutes } from './stops';
import { registerCrashRoutes } from './crashes';
import { registerMigrationRoutes } from './migration';
import { registerFeedbackRoutes, startFeedbackSweep } from './feedback';
import { registerEvidenceRoutes } from './evidence';
import { registerArrestRoutes } from './arrests';
import { registerTaskRoutes } from './tasks';
import { registerPhotoRoutes } from './photos';
import { registerFleetRoutes } from './fleet';
import { registerTrespassRoutes } from './trespass';
import { registerVehicleRoutes } from './vehicles';
import { registerWarrantRoutes, outstandingWarrants } from './warrants';
import { registerFieldContactRoutes } from './fieldContacts';
import { registerInvestigationRoutes } from './investigations';
import { registerCitationRoutes } from './citations';
import { registerPublicRecordsRoutes } from './publicRecords';
import { registerGisRoutes } from './gis';
import { registerBookingRoutes } from './bookings';
import { registerBulletinRoutes } from './bulletins';
import { registerPasswordResetRoutes } from './passwordReset';
import { registerRetentionRoutes, listSeals } from './retention';
import { registerMfaRoutes } from './mfa';
import {
  createAttemptGuard,
  createRateLimiter,
  installGracefulShutdown,
  installHealthCheck,
  loadConfig,
  requestLog,
  securityHeaders,
  type ServerConfig,
} from './hardening';
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
import { mfaState } from '../src/domain/mfa';
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
import { looksLikeEmail } from '../src/domain/passwordReset';

export function createApp(db: DatabaseSync, config: ServerConfig) {
  const app = express();

  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(securityHeaders(config));
  app.use(requestLog(config));
  installHealthCheck(app);

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

  // Per-account lockout slows guessing at one username; this slows an attacker
  // spreading attempts across many usernames from one address.
  const signInLimiter = createRateLimiter({ windowMs: 60_000, max: 10, name: 'sign-in' });
  const passwordGuard = createAttemptGuard({ windowMs: 60_000, max: 5 });

  app.post('/api/auth/sign-in', signInLimiter, async (req: Request, res: Response) => {
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
    const state = mfaState(credential ?? {});
    res.json({
      user: req.user,
      mustChangePassword: credential?.mustChangePassword ?? false,
      /*
        Reported on every identity check, not only at sign-in: a session
        restored from a cookie has to know whether it is finished. Without
        this a browser reopened mid-sign-in would render the app around a
        session that cannot fetch anything.
      */
      secondFactor: {
        required: req.session?.factor !== 'full',
        enrolled: state.enrolled,
        recoveryRemaining: state.recoveryRemaining,
      },
    });
  });

  /**
   * When this account last changed its password.
   *
   * Its own endpoint rather than another field on the sign-in payload: it is
   * read on one settings screen and nowhere else, and every field added to the
   * thing every client fetches on every start is paid for on every start.
   */
  app.get('/api/auth/password', requireAuth, (req: Request, res: Response) => {
    const credential = getCredential(db, req.user!.id);
    res.json({
      changedAt: credential?.passwordChangedAt ?? '',
      mustChange: credential?.mustChangePassword ?? false,
    });
  });

  app.post('/api/auth/password', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    /*
      Asked before anything is read, spent only where the current password was
      wrong. Somebody working through the policy — too short, then contains
      their name, then too close to the old one — is not guessing, and must not
      be locked out of the screen that exists to help them.
    */
    const wait = passwordGuard.waitSeconds(req);
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      res.status(429).json({
        error: `Too many attempts. Wait ${wait} second${wait === 1 ? '' : 's'} and try again.`,
      });
      return;
    }
    const { current, next } = req.body ?? {};
    const credential = getCredential(db, user.id);
    if (!credential) {
      res.status(400).json({ error: 'No credential on file.' });
      return;
    }

    if (credential.passwordHash && !(await verifyPassword(String(current ?? ''), credential.passwordHash))) {
      passwordGuard.spend(req);
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
  /**
   * The agency profile, minus the one secret in it.
   *
   * The mail password is write-only: it goes in on save and never comes back
   * out. Everything in the agency profile is otherwise readable by anybody
   * signed in, so leaving a working SMTP credential in it would hand the
   * agency's outbound mail to every officer on the roster.
   */
  const publicAgency = (doc: unknown): unknown => {
    if (!doc || typeof doc !== 'object') return doc;
    const agency = doc as { mail?: Record<string, unknown> };
    if (!agency.mail) return agency;
    return { ...agency, mail: { ...agency.mail, password: '' } };
  };

  app.get('/api/state', requireAuth, (req: Request, res: Response) => {
    const agencyRow = db.prepare('SELECT doc FROM agency WHERE id = ?').get('default') as
      | { doc: string }
      | undefined;

    const people = readDocsWithVersions(db, DOC_TABLES.people);
    const locations = readDocsWithVersions(db, DOC_TABLES.locations);
    const incidents = readDocsWithVersions(db, DOC_TABLES.incidents);
    const supplements = readDocsWithVersions(db, DOC_TABLES.supplements);
    const stops = readDocsWithVersions(db, DOC_TABLES.stops);
    const crashes = readDocsWithVersions(db, DOC_TABLES.crashes);
    const returns = readDocsWithVersions(db, DOC_TABLES.returns);
    const arrests = readDocsWithVersions(db, DOC_TABLES.arrests);
    const caseTasks = readDocsWithVersions(db, DOC_TABLES.caseTasks);
    const photos = readDocsWithVersions(db, DOC_TABLES.personPhotos);
    const vehicles = readDocsWithVersions(db, DOC_TABLES.vehicles);

    /*
      Sealed records.

      A court has ordered these out of ordinary sight, so they are dropped from
      this payload — for everybody, including the records staff entitled to see
      them. Not greyed out, not marked "sealed", simply absent: a placeholder
      saying a sealed record exists tells the reader most of what the seal was
      meant to withhold.

      Somebody entitled to look fetches one through its own endpoint, which
      writes an access event. That is the point of doing it this way rather
      than sending them here and asking the client to be discreet — "who read
      this after it was sealed" is the question sealing exists to answer, and
      an answer that depends on the client choosing to report itself is not
      one.

      Everything hanging off a sealed case goes with it. A case can be hidden
      while its supplements and arrests are not, and that is not a seal.
    */
    const seals = listSeals(db);
    const sealed = new Set(seals.map((seal) => seal.subjectId));
    const maySeeSealed = can(req.user!, 'records.seal');
    const hidden = (subjectId: unknown, caseId: unknown = '') =>
      sealed.has(String(subjectId)) || sealed.has(String(caseId));

    const visibleIncidents = incidents.filter((i) => !hidden(i.doc.id));
    const visibleSupplements = supplements.filter((s) => !hidden(s.doc.id, s.doc.caseId));
    const visibleCrashes = crashes.filter((c) => !hidden(c.doc.id));
    const visibleArrests = arrests.filter((a) => !hidden(a.doc.id, a.doc.caseId));
    const visibleTasks = caseTasks.filter((t) => !hidden(t.doc.id, t.doc.caseId));
    const visiblePhotos = photos.filter((p) => !hidden(p.doc.masterId));

    // Versions travel with the data so the client can send back what it saw.
    const versions: Record<string, number> = {};
    for (const { doc, version } of [...incidents, ...people, ...locations]) {
      versions[String(doc.id)] = version;
    }

    res.json({
      incidents: visibleIncidents.map((i) => i.doc),
      supplements: visibleSupplements.map((s) => s.doc),
      stops: stops.map((s) => s.doc),
      crashes: visibleCrashes.map((c) => c.doc),
      returns: returns.map((r) => r.doc),
      arrests: visibleArrests.map((a) => a.doc),
      caseTasks: visibleTasks.map((t) => t.doc),
      photos: visiblePhotos.map((p) => p.doc),
      /*
        The list of what is sealed — not the records themselves. Only somebody
        entitled to look gets it, because they cannot ask for a record they do
        not know exists. For everyone else it is empty, and the records are
        absent from the payload above with nothing to say they ever were.
      */
      seals: maySeeSealed ? seals : [],
      people: Object.fromEntries(people.map((p) => [String(p.doc.id), p.doc])),
      locations: Object.fromEntries(locations.map((l) => [String(l.doc.id), l.doc])),
      /*
        Vehicles travel with the payload the way people and places do, because
        they are the same kind of thing: a few thousand records that every
        search touches. Trespass notices deliberately do not — one place can
        hold hundreds and nobody needs another place's list to be here.
      */
      vehicles: Object.fromEntries(vehicles.map((v) => [String(v.doc.id), v.doc])),
      /*
        Who is wanted, and nothing else about it.

        Just enough for a name search to say so — the id, how many, and whether
        any of them will be extradited nationally. The warrants themselves are
        fetched when somebody opens the record, because this exists to make an
        alert appear on a search result, not to ship the agency's warrant file
        to every browser.
      */
      wanted: outstandingWarrants(db),
      versions,
      locks: listLocks(db),
      attachments: listAttachments(db),
      agency: agencyRow ? publicAgency(JSON.parse(agencyRow.doc)) : null,
      users: listUsers(db),
      // The log is only sent to people entitled to read it.
      auditLog: can(req.user!, 'audit.view') ? readAuditLog(db) : [],
    });
  });

  app.put('/api/agency', requirePermission('agency.configure'), (req: Request, res: Response) => {
    const doc = req.body?.agency;
    if (!doc || typeof doc !== 'object') {
      res.status(400).json({ error: 'Expected { agency: {...} }.' });
      return;
    }
    /*
      The mail password never comes back out, so it never comes back in either.
      An empty one here means "leave it alone" rather than "clear it" —
      otherwise every save from a screen that cannot read it would wipe it.
      Clearing it is done by clearing the mail server, which is what somebody
      turning this off actually means.
    */
    const existing = db.prepare('SELECT doc FROM agency WHERE id = ?').get('default') as
      | { doc: string }
      | undefined;
    const incoming = doc as { mail?: Record<string, unknown> };
    if (incoming.mail && !String(incoming.mail.password ?? '')) {
      let stored = '';
      try {
        stored = String(
          (JSON.parse(existing?.doc ?? '{}') as { mail?: { password?: string } }).mail?.password ?? '',
        );
      } catch {
        stored = '';
      }
      incoming.mail = { ...incoming.mail, password: stored };
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

    /*
      An address that does not look like one is refused rather than stored.
      A typo here is only discovered on the day the officer is locked out and
      the link goes somewhere that does not exist.
    */
    const email = String(safe.email ?? '').trim().toLowerCase();
    if (email && !looksLikeEmail(email)) {
      res.status(400).json({ error: 'That does not look like an email address.' });
      return;
    }

    const account = createUser({
      ...safe,
      id: `usr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      username,
      email,
      name: String(safe.name).trim(),
      createdBy: actor.name,
    });

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    db.prepare(
      `INSERT INTO users (id, username, name, badge, role, grants, revocations, active, deactivated_at, created_at, created_by, email)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, '', ?, ?, ?)`,
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
      account.email,
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

  /**
   * An administrator issues somebody a new password.
   *
   * The path back in for every officer the emailed link cannot reach: no work
   * address on the account, a mailbox they cannot get to, or an installation
   * with no mail server at all. Without this an officer who forgets their
   * password is locked out permanently and the administrator they telephone
   * has nothing to do about it.
   *
   * Identity is verified by a person rather than by a mailbox. The
   * administrator knows the officer, hands the password over in the room or
   * down the radio, and the officer must change it at next sign-in. That is a
   * stronger check than an email link, not a weaker one — which is why this
   * route exists even on installations that can send mail.
   *
   * Three refusals worth reading.
   *
   *   **Not your own.** An administrator resetting their own password here
   *   would be doing it without knowing the old one, which turns any unlocked
   *   terminal with an administrator signed in on it into a permanent account
   *   takeover. Their own password is changed on the settings screen, where
   *   the current one is required.
   *
   *   **Not above your own authority.** The same rule that governs every other
   *   account operation.
   *
   *   **The second factor is untouched.** Resetting a password must not be a
   *   way past it. Clearing somebody's authenticator is a separate route, with
   *   its own reason and its own audit entry, and needing both is the point.
   */
  app.post(
    '/api/users/:id/reset-password',
    requirePermission('users.manage'),
    async (req: Request, res: Response) => {
      const actor = req.user!;
      const target = getUserById(db, req.params.id);
      if (!target) {
        res.status(404).json({ error: 'No such account.' });
        return;
      }
      if (target.id === actor.id) {
        res.status(400).json({
          error:
            'Change your own password on the Signing in screen, where the current one is asked for. Resetting it here would not need it.',
        });
        return;
      }
      if (!canManageUser(actor, target)) {
        res.status(403).json({ error: 'This account has more authority than yours.' });
        return;
      }

      const reason = String(req.body?.reason ?? '').slice(0, 500).trim();
      if (!reason) {
        res.status(400).json({
          error: 'Say why. Handing somebody a password is worth a line on the record.',
        });
        return;
      }

      const temporaryPassword = generateTemporaryPassword();
      const existing = getCredential(db, target.id);
      saveCredential(db, {
        ...(existing ?? createCredential(target.id)),
        userId: target.id,
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        passwordChangedAt: new Date().toISOString(),
        // Cleared so a locked-out officer is not still locked out afterwards.
        failedAttempts: 0,
        lockedUntil: '',
      });

      /*
        Their sessions end, and any reset link they were mailed stops working.
        Somebody whose password is being reset has usually lost control of
        something, and a link still sitting in that mailbox is part of it.
      */
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      db.prepare("UPDATE reset_requests SET used_at = ? WHERE user_id = ? AND used_at = ''").run(
        new Date().toISOString(),
        target.id,
      );

      await recordAudit(db, {
        actorId: actor.id,
        actorName: actor.name,
        action: 'user.passwordReset',
        target: target.name,
        detail: reason,
      });

      // Shown once, never stored readably, and the holder must change it.
      res.json({ ok: true, temporaryPassword });
    },
  );

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
      'report.printed',
      'nibrs.exported',
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

  registerRecordRoutes(app, db);
  registerReviewRoutes(app, db);
  registerExtractionRoutes(app, db);
  registerSupplementRoutes(app, db);
  registerStopRoutes(app, db);
  registerCrashRoutes(app, db);
  registerMigrationRoutes(app, db);
  registerEvidenceRoutes(app, db);
  registerArrestRoutes(app, db);
  registerTaskRoutes(app, db);
  registerPhotoRoutes(app, db, config.dataDir);
  registerFleetRoutes(app, db);
  registerTrespassRoutes(app, db);
  registerVehicleRoutes(app, db);
  registerWarrantRoutes(app, db);
  registerFieldContactRoutes(app, db);
  registerInvestigationRoutes(app, db);
  registerCitationRoutes(app, db);
  registerPublicRecordsRoutes(app, db);
  registerGisRoutes(app, db);
  registerBookingRoutes(app, db);
  registerBulletinRoutes(app, db);
  registerPasswordResetRoutes(app, db);
  registerRetentionRoutes(app, db, config.dataDir);
  registerMfaRoutes(app, db);
  registerFeedbackRoutes(app, db, {
    forwardUrl: config.feedbackUrl,
    signingKey: config.feedbackKey,
  });
  registerAttachmentRoutes(app, db, config.dataDir);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'No such endpoint.' });
  });

  // In production the API also serves the built client, so there is one origin
  // and the session cookie needs no cross-site relaxation.
  if (config.serveClient) {
    const dist = resolve('dist');
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
  }

  return app;
}

/* ------------------------------------------------------------------ */

const isMain = process.argv[1]?.includes('server/index');
if (isMain) {
  const { config, problems } = loadConfig();

  for (const problem of problems) console.error(problem.message);
  if (problems.some((p) => p.fatal)) process.exit(1);

  const db = openDatabase(config.dbPath);
  await seedDatabase(db);
  const app = createApp(db, config);

  const server = config.tls
    ? createHttpsServer(
        { key: readFileSync(config.tls.keyPath), cert: readFileSync(config.tls.certPath) },
        app,
      )
    : createHttpServer(app);

  server.listen(config.port, () => {
    const scheme = config.tls ? 'https' : 'http';
    console.log(`Aegis API on ${scheme}://localhost:${config.port} (db: ${config.dbPath})`);
    if (!config.tls && !config.production) {
      console.log('Development mode: plaintext HTTP, insecure cookies. Not for real data.');
    }
  });

  /*
    Keeps retrying anything the receiver did not take. Without it, feedback
    written during a five-minute outage waits for somebody to notice a badge on
    a settings screen — and nobody does.
  */
  const stopSweep = startFeedbackSweep(db, {
    forwardUrl: config.feedbackUrl,
    signingKey: config.feedbackKey,
  });

  installGracefulShutdown(server, () => {
    stopSweep();
    db.close();
  });
}
