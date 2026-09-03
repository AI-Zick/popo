/**
 * Where officer feedback lands.
 *
 * This runs on the vendor's infrastructure, not an agency's — it is the other
 * end of `AEGIS_FEEDBACK_URL`. One Cloudflare Worker, free at any volume a
 * records system will ever produce, and no server to keep alive.
 *
 * It does three things, in this order, and the order matters:
 *
 *   1. **Verifies the signature** before reading anything. An unauthenticated
 *      endpoint on a public URL is a spam target, and the first thing it would
 *      spam is the inbox you rely on to notice real faults.
 *   2. **Stores it**, before attempting mail. Email fails — a rate limit, an
 *      expired API key, a provider outage — and feedback that only existed as
 *      an email attempt is feedback that is gone. The store is the record; the
 *      email is a notification about the record.
 *   3. **Emails you.** Best effort. A failure here is logged and returns 200,
 *      because the agency's server has done its part and retrying would only
 *      duplicate what is already stored.
 */

/*
  Signature checking is imported from the product's own domain code rather than
  reimplemented here, because both ends have to agree exactly and two versions
  of "the obvious HMAC" drift. When they drift the failure is silent: every
  message is rejected and nobody is watching an endpoint that has never worked.

  It is a pure function with no runtime dependencies, so bundling it into a
  Worker pulls in nothing else.
*/
import {
  signPayload,
  signaturesMatch,
  timestampFresh,
} from '../../../src/domain/feedback';

export interface Env {
  /** ORI → signing key. One per agency, so one can be rotated alone. */
  KEYS: KVNamespace;
  /** Everything received, keyed by id. */
  FEEDBACK: KVNamespace;
  /** Resend API key. `wrangler secret put RESEND_KEY`. */
  RESEND_KEY: string;
  /** Where to send it. `wrangler secret put NOTIFY_EMAIL`. */
  NOTIFY_EMAIL: string;
  /** A verified sender on your domain, e.g. feedback@yourdomain.com. */
  FROM_EMAIL: string;
}

interface FeedbackContext {
  screen: string;
  field: string;
  version: string;
  agencyOri: string;
  agencyName: string;
  userAgent: string;
}

interface Feedback {
  id: string;
  kind: string;
  impact: string;
  summary: string;
  detail: string;
  context: FeedbackContext;
  submittedByName: string;
  submittedByRole: string;
  at: string;
  seconded: string[];
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Subject lines you can triage without opening.
 *
 * The impact comes first because it is the only thing that decides whether
 * something needs looking at today, and a mailbox sorted by subject then sorts
 * itself.
 */
function subjectFor(item: Feedback): string {
  const flag =
    item.impact === 'blocked' ? '[BLOCKED]' : item.impact === 'workaround' ? '[costs time]' : '[minor]';
  return `${flag} ${item.context.agencyName || item.context.agencyOri}: ${item.summary}`;
}

function bodyFor(item: Feedback): string {
  const rows: [string, string][] = [
    ['Agency', `${item.context.agencyName} (${item.context.agencyOri})`],
    ['From', `${item.submittedByName} — ${item.submittedByRole}`],
    ['Kind', item.kind],
    ['Impact', item.impact],
    ['Screen', item.context.screen],
    ['Field', item.context.field || '—'],
    ['Build', item.context.version],
    ['Sent', item.at],
    ['Browser', item.context.userAgent],
  ];

  return `<div style="font:14px/1.55 system-ui,sans-serif;max-width:640px">
  <h2 style="margin:0 0 4px;font-size:17px">${escapeHtml(item.summary)}</h2>
  ${item.detail ? `<p style="white-space:pre-wrap;margin:12px 0">${escapeHtml(item.detail)}</p>` : ''}
  <table style="border-collapse:collapse;margin-top:16px;font-size:13px">
    ${rows
      .map(
        ([label, value]) =>
          `<tr><td style="padding:3px 14px 3px 0;color:#666;vertical-align:top">${label}</td>` +
          `<td style="padding:3px 0">${escapeHtml(value)}</td></tr>`,
      )
      .join('')}
  </table>
  <p style="margin-top:16px;font-size:12px;color:#777">
    Reply through the agency's own feedback screen so the officer sees it — this
    mailbox is a notification, not a thread. Reference ${escapeHtml(item.id)}.
  </p>
</div>`;
}

async function notify(env: Env, item: Feedback): Promise<void> {
  if (!env.RESEND_KEY || !env.NOTIFY_EMAIL) return;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL || 'feedback@example.com',
      to: [env.NOTIFY_EMAIL],
      subject: subjectFor(item),
      html: bodyFor(item),
    }),
  });
  if (!response.ok) {
    console.error('Mail failed', response.status, await response.text());
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Not found', { status: 404 });
    }

    const agency = request.headers.get('x-aegis-agency') ?? '';
    const timestamp = request.headers.get('x-aegis-timestamp') ?? '';
    const signature = request.headers.get('x-aegis-signature') ?? '';
    const body = await request.text();

    /*
      Nothing below this point runs on an unverified request — not parsing, not
      storing, and above all not mailing. The whole value of this endpoint is
      that a message arriving in your inbox really came from an install you
      shipped.
    */
    const key = agency ? await env.KEYS.get(agency) : null;
    if (!key) {
      return new Response('Unknown agency', { status: 401 });
    }

    if (!timestampFresh(timestamp)) {
      return new Response('Stale request', { status: 401 });
    }

    if (!signaturesMatch(signature, await signPayload(key, timestamp, body))) {
      return new Response('Bad signature', { status: 401 });
    }

    let item: Feedback;
    try {
      item = JSON.parse(body) as Feedback;
    } catch {
      return new Response('Malformed', { status: 400 });
    }

    /*
      Stored before the email is attempted, and the 200 does not wait on mail.

      The agency's server retries on any non-2xx, so returning a failure because
      a mail provider rate-limited us would have it re-send something already
      safely recorded. Store, acknowledge, then notify.
    */
    await env.FEEDBACK.put(
      `${item.at}:${item.id}`,
      JSON.stringify({ ...item, receivedAt: new Date().toISOString(), agency }),
    );

    ctx.waitUntil(notify(env, item).catch((error) => console.error('Notify failed', error)));

    return Response.json({ ok: true, id: item.id });
  },
};
