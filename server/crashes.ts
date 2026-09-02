/**
 * Crash report and inbound-return routes.
 *
 * The ingest endpoint is the interesting one. It is the seam a real CAD, MDT or
 * query gateway connects to, and everything behind it — the crash report, the
 * autofill panel, the provenance strip — is written against the shape it
 * accepts rather than against any vendor's protocol.
 *
 * That is deliberately the same bet as the state NIBRS packs: push the
 * awkward, vendor-specific part to the edge and keep it out of the report.
 */

import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, readDoc, readDocs, writeDoc } from './db';
import { requireAuth } from './auth';
import { recordAudit } from './audit';
import { canReopen, canReview, canSubmit, type ReviewComment, type ReviewEvent } from '../src/domain/review';
import { checkCrash, createCrashReport, type CrashReport } from '../src/domain/crash';
import { createQueryReturn, type QueryReturn, type ReturnPayload } from '../src/domain/inbound';

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function event(action: ReviewEvent['action'], user: { id: string; name: string }, note = ''): ReviewEvent {
  return { id: newId('rev'), action, actorId: user.id, actorName: user.name, at: new Date().toISOString(), note };
}

function loadCrash(db: DatabaseSync, id: string): CrashReport | null {
  const stored = readDoc(db, DOC_TABLES.crashes, id);
  return stored ? (stored.doc as unknown as CrashReport) : null;
}

function saveCrash(db: DatabaseSync, doc: CrashReport): void {
  writeDoc(db, DOC_TABLES.crashes, doc as unknown as Record<string, unknown>, null);
}

function allReturns(db: DatabaseSync): QueryReturn[] {
  return readDocs(db, DOC_TABLES.returns) as unknown as QueryReturn[];
}

/** `2026-C00042` — crash reports carry their own series in most agencies. */
function nextCrashNumber(db: DatabaseSync): string {
  const year = new Date().getFullYear();
  const existing = readDocs(db, DOC_TABLES.crashes) as unknown as CrashReport[];
  const used = existing
    .map((c) => Number(String(c.caseNumber).replace(`${year}-C`, '')))
    .filter((n) => Number.isFinite(n));
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${year}-C${String(next).padStart(5, '0')}`;
}

export function registerCrashRoutes(app: Express, db: DatabaseSync): void {
  /* ---- Inbound ------------------------------------------------------ */

  /**
   * Where CAD, the MDT and the query gateway post what they know.
   *
   * Accepts one return or a batch, because a call and its four queries arrive
   * together. Returns are never edited afterwards: a stored return is what the
   * registry said at that moment, and a report that contradicts it later needs
   * both, not one overwritten by the other.
   */
  app.post('/api/inbound', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const incoming: unknown[] = Array.isArray(req.body?.returns)
      ? req.body.returns
      : [req.body];

    const stored: QueryReturn[] = [];
    for (const raw of incoming.slice(0, 200)) {
      const item = raw as Partial<QueryReturn> & { payload?: ReturnPayload };
      if (!item?.payload?.kind) continue;

      const doc = createQueryReturn({
        id: newId('ret'),
        source: item.source ?? 'mdt',
        query: String(item.query ?? '').slice(0, 120),
        receivedAt: String(item.receivedAt ?? new Date().toISOString()),
        // An adapter running as a service account may say which officer's
        // terminal ran the query; a person posting for themselves may not.
        officerId: String(item.officerId ?? user.id),
        officerName: String(item.officerName ?? user.name),
        callNumber: String(item.callNumber ?? '').slice(0, 60),
        payload: item.payload,
      });
      writeDoc(db, DOC_TABLES.returns, doc as unknown as Record<string, unknown>, null);
      stored.push(doc);
    }

    if (stored.length === 0) {
      res.status(400).json({ error: 'Nothing recognisable to ingest.' });
      return;
    }

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'inbound.received',
      target: stored[0].callNumber || String(stored.length),
      detail: `${stored.length} ${stored.length === 1 ? 'return' : 'returns'}`,
    });
    res.json({ ok: true, returns: stored });
  });

  /** Marks a return as used on a document, so it is not offered twice. */
  app.post('/api/inbound/:id/applied', requireAuth, (req: Request, res: Response) => {
    const stored = readDoc(db, DOC_TABLES.returns, req.params.id);
    if (!stored) {
      res.status(404).json({ error: 'No such return.' });
      return;
    }
    const doc = stored.doc as unknown as QueryReturn;
    const documentId = String(req.body?.documentId ?? '');
    if (documentId && !doc.appliedTo.includes(documentId)) {
      doc.appliedTo = [...doc.appliedTo, documentId];
      writeDoc(db, DOC_TABLES.returns, doc as unknown as Record<string, unknown>, null);
    }
    res.json({ ok: true, return: doc });
  });

  /* ---- Crash reports ------------------------------------------------- */

  app.post('/api/crashes', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const callNumber = String(req.body?.callNumber ?? '').slice(0, 60);

    /*
      A crash opened against a dispatch call starts with what dispatch already
      knows — time, place, cross street. Retyping it from the screen next to
      you is exactly the work this module exists to remove.
    */
    const call = allReturns(db).find(
      (r) => r.callNumber === callNumber && r.payload.kind === 'call',
    );
    const fromCall =
      call && call.payload.kind === 'call'
        ? {
            occurredAt: call.payload.receivedAt || '',
            reportedAt: call.payload.receivedAt || '',
            onRoad: call.payload.address || '',
            crossStreet: call.payload.crossStreet || '',
            latitude: call.payload.latitude || '',
            longitude: call.payload.longitude || '',
          }
        : {};

    const doc = createCrashReport({
      id: newId('crash'),
      caseNumber: nextCrashNumber(db),
      callNumber,
      reportedAt: new Date().toISOString().slice(0, 16),
      createdBy: user.id,
      reportingOfficer: user.name,
      reportingBadge: user.badge ?? '',
      ...fromCall,
    });
    saveCrash(db, doc);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'crash.created',
      target: doc.caseNumber,
      detail: callNumber,
    });
    res.json({ ok: true, crash: doc, prefilled: Boolean(call) });
  });

  app.put('/api/crashes/:id', requireAuth, (req: Request, res: Response) => {
    const user = req.user!;
    const current = loadCrash(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: 'No such crash report.' });
      return;
    }
    if (current.status !== 'draft' && current.status !== 'returned') {
      res.status(409).json({ error: 'This report is not editable right now.' });
      return;
    }
    if (current.createdBy && current.createdBy !== user.id) {
      res.status(403).json({ error: 'This report belongs to another officer.' });
      return;
    }

    const patch = (req.body ?? {}) as Partial<CrashReport>;
    // Status, authorship and review history are not the author's to set.
    const {
      id: _id,
      status: _s,
      createdBy: _c,
      reviewHistory: _rh,
      reviewComments: _rc,
      caseNumber: _cn,
      ...editable
    } = patch;

    const doc: CrashReport = { ...current, ...editable, updatedAt: new Date().toISOString() };
    saveCrash(db, doc);
    res.json({ ok: true, crash: doc });
  });

  app.post('/api/crashes/:id/submit', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const current = loadCrash(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: 'No such crash report.' });
      return;
    }
    const transition = canSubmit(current.status);
    if (!transition.ok) {
      res.status(409).json({ error: transition.reason });
      return;
    }

    // Re-checked here, not trusted from the browser.
    const blocking = checkCrash(current).filter((p) => p.severity === 'error');
    if (blocking.length > 0) {
      res.status(400).json({ error: blocking[0].message, problems: blocking });
      return;
    }

    const doc: CrashReport = {
      ...current,
      status: 'pending_review',
      submittedAt: new Date().toISOString(),
      createdBy: current.createdBy || user.id,
      returnedReason: '',
      reviewHistory: [...current.reviewHistory, event('submitted', user)],
      updatedAt: new Date().toISOString(),
    };
    saveCrash(db, doc);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'crash.submitted',
      target: doc.caseNumber,
      detail: '',
    });
    res.json({ ok: true, crash: doc });
  });

  app.post('/api/crashes/:id/approve', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const current = loadCrash(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: 'No such crash report.' });
      return;
    }
    const check = canReview(user, current);
    if (!check.ok) {
      res.status(403).json({ error: check.reason });
      return;
    }

    const note = String(req.body?.note ?? '').slice(0, 1000);
    const doc: CrashReport = {
      ...current,
      status: 'approved',
      reviewedBy: user.name,
      reviewedAt: new Date().toISOString(),
      returnedReason: '',
      reviewHistory: [...current.reviewHistory, event('approved', user, note)],
      updatedAt: new Date().toISOString(),
    };
    saveCrash(db, doc);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'crash.approved',
      target: doc.caseNumber,
      detail: note,
    });
    res.json({ ok: true, crash: doc });
  });

  app.post('/api/crashes/:id/return', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const current = loadCrash(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: 'No such crash report.' });
      return;
    }
    const check = canReview(user, current);
    if (!check.ok) {
      res.status(403).json({ error: check.reason });
      return;
    }
    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) {
      res.status(400).json({ error: 'Say what needs fixing.' });
      return;
    }

    const incoming: unknown[] = Array.isArray(req.body?.comments) ? req.body.comments : [];
    const comments: ReviewComment[] = incoming.slice(0, 50).map((raw) => {
      const c = raw as Partial<ReviewComment>;
      return {
        id: newId('cmt'),
        path: String(c.path ?? ''),
        section: (c.section ?? 'narrative') as ReviewComment['section'],
        message: String(c.message ?? '').slice(0, 1000),
        authorId: user.id,
        authorName: user.name,
        createdAt: new Date().toISOString(),
        resolvedAt: '',
      };
    });

    const doc: CrashReport = {
      ...current,
      status: 'returned',
      reviewedBy: user.name,
      reviewedAt: new Date().toISOString(),
      returnedReason: reason,
      reviewComments: [...current.reviewComments, ...comments],
      reviewHistory: [...current.reviewHistory, event('returned', user, reason)],
      updatedAt: new Date().toISOString(),
    };
    saveCrash(db, doc);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'crash.returned',
      target: doc.caseNumber,
      detail: reason,
    });
    res.json({ ok: true, crash: doc });
  });

  app.post('/api/crashes/:id/reopen', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const current = loadCrash(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: 'No such crash report.' });
      return;
    }
    const check = canReopen(user, current.status);
    if (!check.ok) {
      res.status(403).json({ error: check.reason });
      return;
    }
    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) {
      res.status(400).json({ error: 'Say why it is being reopened.' });
      return;
    }

    const doc: CrashReport = {
      ...current,
      status: 'returned',
      returnedReason: reason,
      reviewHistory: [...current.reviewHistory, event('reopened', user, reason)],
      updatedAt: new Date().toISOString(),
    };
    saveCrash(db, doc);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'crash.reopened',
      target: doc.caseNumber,
      detail: reason,
    });
    res.json({ ok: true, crash: doc });
  });
}
