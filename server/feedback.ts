/**
 * Feedback on its way to the vendor.
 *
 * Two things this file is careful about.
 *
 * **It is stored in the agency's own database, not the vendor's.** An agency
 * can always see, audit and export everything its officers have sent outside
 * the building. A channel that writes straight to a third party and leaves no
 * local record is one no records manager should agree to.
 *
 * **The social security number scan runs here, not only in the browser.** The
 * client shows findings and offers to replace them, which is the right place
 * for judgement. But a guarantee that depends on the client having behaved is
 * not a guarantee, so the one thing that must never leave is removed on the way
 * in, and the response says it happened.
 */

import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, readDoc, readDocs, writeDoc } from './db';
import { requireAuth, requirePermission } from './auth';
import { recordAudit } from './audit';
import {
  DETAIL_MAX,
  SUMMARY_MAX,
  dueForRetry,
  enforceRedaction,
  signPayload,
  type Feedback,
  type FeedbackKind,
  type FeedbackStatus,
  type Impact,
} from '../src/domain/feedback';

const KINDS: FeedbackKind[] = ['bug', 'idea', 'slow', 'wording'];
const IMPACTS: Impact[] = ['blocked', 'workaround', 'annoyance'];
const STATUSES: FeedbackStatus[] = ['new', 'reading', 'planned', 'shipped', 'declined'];

/** Feedback is cheap to write and easy to flood. */
const PER_PERSON_PER_DAY = 40;

function newId(): string {
  return `fb_${randomBytes(8).toString('hex')}`;
}

function load(db: DatabaseSync, id: string): Feedback | null {
  const stored = readDoc(db, DOC_TABLES.feedback, id);
  return stored ? (stored.doc as unknown as Feedback) : null;
}

function save(db: DatabaseSync, doc: Feedback): void {
  writeDoc(db, DOC_TABLES.feedback, doc as unknown as Record<string, unknown>, null);
}

function all(db: DatabaseSync): Feedback[] {
  return readDocs(db, DOC_TABLES.feedback) as unknown as Feedback[];
}

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);

/**
 * Sending it on to the vendor.
 *
 * On by default — see `vendor.ts` — because a channel every customer must
 * configure before it works reports nothing from the agencies least likely to
 * configure it. `DEPLOYMENT.md` says exactly what crosses the wire, and
 * `AEGIS_FEEDBACK_URL=off` stops it.
 *
 * A failure is never an error the officer sees. Their feedback is saved either
 * way, and the sweep below keeps trying.
 */
async function forward(
  options: { forwardUrl: string; signingKey: string },
  item: Feedback,
): Promise<boolean> {
  const body = JSON.stringify(item);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  // Shared with the receiver, so the two ends cannot drift apart.
  const signature = await signPayload(options.signingKey, timestamp, body);

  try {
    const response = await fetch(options.forwardUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aegis-agency': item.context.agencyOri || 'unknown',
        'x-aegis-timestamp': timestamp,
        'x-aegis-signature': signature,
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Attempts delivery once and records what happened.
 *
 * Returns the item as it should now be stored — the attempt count and time are
 * written whether or not it worked, because that is what the backoff reads.
 */
async function attemptDelivery(
  options: { forwardUrl: string; signingKey: string },
  item: Feedback,
): Promise<Feedback> {
  const at = new Date().toISOString();
  const ok = await forward(options, item);
  return {
    ...item,
    forwarded: ok,
    forwardedAt: ok ? at : item.forwardedAt,
    forwardAttempts: item.forwardAttempts + 1,
    lastAttemptAt: at,
  };
}

/** How often the queue is swept for anything that has not got through. */
const SWEEP_MS = 60_000;

/**
 * Keeps trying, so nobody has to notice.
 *
 * Without this, feedback written while the receiver happened to be down waits
 * for an administrator to spot a badge on a settings screen and click a button.
 * They do not spot it, so it never arrives — which is the exact failure this
 * whole channel exists to prevent.
 */
export function startFeedbackSweep(
  db: DatabaseSync,
  options: { forwardUrl: string; signingKey: string },
): () => void {
  if (!options.forwardUrl) return () => {};

  let running = false;
  const tick = async () => {
    // One sweep at a time: a slow receiver must not stack up overlapping runs.
    if (running) return;
    running = true;
    try {
      for (const item of dueForRetry(all(db))) {
        save(db, await attemptDelivery(options, item));
      }
    } catch (error) {
      console.error('Feedback sweep failed', error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), SWEEP_MS);
  // Never hold the process open for a retry; shutdown should not wait on this.
  timer.unref?.();
  return () => clearInterval(timer);
}

export function registerFeedbackRoutes(
  app: Express,
  db: DatabaseSync,
  options: { forwardUrl: string; signingKey: string } = { forwardUrl: '', signingKey: '' },
): void {
  /*
    Everyone can read the queue, and that is the point: an officer about to
    report something sees it has already been raised and seconds it instead,
    and an officer who reported something sees the answer. Nothing here is
    criminal justice information — the context is structural by construction —
    and everyone reading it is inside the same agency.
  */
  app.get('/api/feedback', requireAuth, (_req: Request, res: Response) => {
    res.json({ feedback: all(db), forwarding: Boolean(options.forwardUrl) });
  });

  /** Anyone signed in. A channel only some ranks can use is not a channel. */
  app.post('/api/feedback', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const body = req.body ?? {};

    const summary = text(body.summary, SUMMARY_MAX).trim();
    if (!summary) {
      res.status(400).json({ error: 'Say in one line what happened.' });
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const mine = all(db).filter((f) => f.submittedBy === user.id && f.at.startsWith(today));
    if (mine.length >= PER_PERSON_PER_DAY) {
      res.status(429).json({
        error: `That is ${PER_PERSON_PER_DAY} pieces of feedback today. Anything more can wait until tomorrow.`,
      });
      return;
    }

    // The one thing that never leaves, removed here rather than trusted to the
    // browser. Notices stay exactly as they were written.
    const cleanSummary = enforceRedaction(summary);
    const cleanDetail = enforceRedaction(text(body.detail, DETAIL_MAX));
    const removed = [...cleanSummary.removed, ...cleanDetail.removed];

    const kind: FeedbackKind = KINDS.includes(body.kind) ? body.kind : 'bug';
    const impact: Impact = IMPACTS.includes(body.impact) ? body.impact : 'workaround';
    const context = body.context ?? {};
    const at = new Date().toISOString();

    const item: Feedback = {
      id: newId(),
      kind,
      impact,
      summary: cleanSummary.text,
      detail: cleanDetail.text,
      context: {
        screen: text(context.screen, 80),
        field: text(context.field, 120),
        version: text(context.version, 40),
        agencyOri: text(context.agencyOri, 20),
        agencyName: text(context.agencyName, 120),
        userAgent: text(context.userAgent, 300),
      },
      submittedBy: user.id,
      submittedByName: user.name,
      submittedByRole: user.role,
      at,
      status: 'new',
      response: '',
      respondedAt: '',
      respondedBy: '',
      respondedByName: '',
      respondedByRole: '',
      seconded: [],
      forwarded: false,
      forwardedAt: '',
      forwardAttempts: 0,
      lastAttemptAt: '',
    };

    const stored = options.forwardUrl ? await attemptDelivery(options, item) : item;
    save(db, stored);

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'feedback.sent',
      target: item.summary,
      detail: [
        kind,
        impact,
        item.context.screen,
        stored.forwarded ? 'sent to the vendor' : 'queued for sending',
        removed.length > 0 ? `${removed.length} redacted before sending` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    });

    res.json({ feedback: stored, redacted: removed.length });
  });

  /**
   * "Same here."
   *
   * A toggle, and the only write on this resource an ordinary officer can make
   * to somebody else's item — three officers on one entry is the best
   * prioritisation signal there is and costs them one click.
   */
  app.post('/api/feedback/:id/second', requireAuth, (req: Request, res: Response) => {
    const user = req.user!;
    const item = load(db, req.params.id);
    if (!item) {
      res.status(404).json({ error: 'That feedback is no longer there.' });
      return;
    }
    if (item.submittedBy === user.id) {
      res.status(400).json({ error: 'You raised this one.' });
      return;
    }

    const seconded = item.seconded.includes(user.id)
      ? item.seconded.filter((id) => id !== user.id)
      : [...item.seconded, user.id];

    const updated = { ...item, seconded };
    save(db, updated);
    res.json({ feedback: updated });
  });

  /*
    Answering. Agency configuration rights, which the vendor role also carries
    — an agency administrator triaging their own officers' reports before they
    are escalated is normal and useful. Who answered is recorded either way,
    because "not going to be done" from your own admin and from the vendor are
    different sentences and the officer should be able to tell them apart.
  */
  app.patch(
    '/api/feedback/:id',
    requirePermission('agency.configure'),
    async (req: Request, res: Response) => {
      const user = req.user!;
      const item = load(db, req.params.id);
      if (!item) {
        res.status(404).json({ error: 'That feedback is no longer there.' });
        return;
      }

      const status: FeedbackStatus = STATUSES.includes(req.body?.status)
        ? req.body.status
        : item.status;
      const response = enforceRedaction(text(req.body?.response, DETAIL_MAX)).text;
      const answered = response !== item.response || status !== item.status;

      const updated: Feedback = {
        ...item,
        status,
        response,
        ...(answered
          ? {
              respondedAt: new Date().toISOString(),
              respondedBy: user.id,
              respondedByName: user.name,
              respondedByRole: user.role,
            }
          : {}),
      };
      save(db, updated);

      if (answered) {
        await recordAudit(db, {
          actorId: user.id,
          actorName: user.name,
          action: 'feedback.answered',
          target: item.summary,
          detail: status,
        });
      }
      res.json({ feedback: updated });
    },
  );

  /** Re-send one the vendor never received. */
  app.post(
    '/api/feedback/:id/forward',
    requirePermission('agency.configure'),
    async (req: Request, res: Response) => {
      const user = req.user!;
      const item = load(db, req.params.id);
      if (!item) {
        res.status(404).json({ error: 'That feedback is no longer there.' });
        return;
      }
      if (!options.forwardUrl) {
        res.status(400).json({
          error:
            'This install has no vendor address configured, so nothing is sent automatically. Export the queue instead.',
        });
        return;
      }

      const updated = await attemptDelivery(options, item);
      save(db, updated);
      const ok = updated.forwarded;
      if (ok) {
        await recordAudit(db, {
          actorId: user.id,
          actorName: user.name,
          action: 'feedback.forwarded',
          target: item.summary,
          detail: 'sent to the vendor',
        });
      }
      res.json({ feedback: updated, ok });
    },
  );
}
