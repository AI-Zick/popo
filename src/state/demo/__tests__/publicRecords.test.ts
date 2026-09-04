import { beforeEach, describe, expect, it } from 'vitest';
import { handle, type Reply } from '../router';
import { db, reset } from '../store';

/**
 * The demo's public records routes, driven the way the browser drives them.
 *
 * The demo router is the one place in this project that restates the server's
 * *wiring* — the rules underneath are the same imported domain functions, but
 * the path matching is written twice, and it is written differently: express
 * matches whole paths, this matches segments of an array. That difference is
 * not theoretical. It shipped a bug where `POST .../items/{id}/review` fell
 * into the branch for `POST .../items`, which then read it as an attach with
 * no record id and answered "that record is not on file" — a sentence that
 * makes a working feature look broken, and only in the offline build.
 *
 * So these walk the whole flow rather than testing a function.
 */

const call = (method: string, url: string, body?: unknown): Promise<Reply> =>
  handle(method, url, body);

const asClerk = () => {
  const state = db();
  state.currentUserId = state.users.find((user) => user.role === 'records')!.id;
  return state;
};

describe('the demo, on a public records request', () => {
  beforeEach(() => {
    reset();
  });

  it('refuses one with no way to answer it', async () => {
    asClerk();
    const reply = await call('POST', '/api/public-requests', {
      description: 'Every report from last Tuesday.',
    });
    expect(reply.status).toBe(400);
    expect((reply.body as { advice: string }).advice).toMatch(/not required/i);
  });

  it('logs one, and works the deadline out rather than storing it', async () => {
    asClerk();
    const reply = await call('POST', '/api/public-requests', {
      description: 'Every report from last Tuesday.',
      requester: { collect: 'Counter' },
    });
    expect(reply.status).toBe(201);
    const body = reply.body as { request: { number: string }; standing: { dueDate: string }; stage: string };
    expect(body.request.number).toMatch(/^PR-\d{4}-\d{5}$/);
    expect(body.standing.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.stage).toBe('logged');
  });

  it('will not let an officer decide what leaves the building', async () => {
    const state = db();
    state.currentUserId = state.users.find((user) => user.role === 'officer')!.id;
    const logged = await call('POST', '/api/public-requests', {
      description: 'A report.',
      requester: { collect: 'Counter' },
    });
    const request = (logged.body as { request: { id: string } }).request;
    const reply = await call('POST', `/api/public-requests/${request.id}/items`, {
      kind: 'incident',
      recordId: state.incidents[0].id,
    });
    expect(reply.status).toBe(403);
  });

  it('proposes, blocks, and only then releases', async () => {
    const state = asClerk();
    const logged = await call('POST', '/api/public-requests', {
      description: 'The Ashwood Lane burglary report.',
      requester: { collect: 'Counter' },
    });
    const request = (logged.body as { request: { id: string } }).request;

    const report = state.incidents.find((incident) => (incident.narrative ?? '').length > 200)!;
    const attached = await call('POST', `/api/public-requests/${request.id}/items`, {
      kind: 'incident',
      recordId: report.id,
    });
    expect(attached.status).toBe(201);
    const item = (attached.body as { request: { items: { id: string }[] } }).request.items[0];

    const proposed = await call('GET', `/api/public-requests/${request.id}/items/${item.id}/proposal`);
    expect(proposed.status).toBe(200);
    const spans = (proposed.body as { proposal: { spans: { id: string; text: string }[] } }).proposal.spans;
    expect(spans.length).toBeGreaterThan(0);

    const accept = spans.map((span) => ({ ...span, decision: 'accepted' }));
    const review = (approve: boolean, readInFull: boolean) =>
      call('POST', `/api/public-requests/${request.id}/items/${item.id}/review`, {
        spans: accept,
        answered: [],
        attachments: [],
        readInFull,
        approve,
      });

    /*
      The route-matching regression. Before the fix this answered 404 "that
      record is not on file" — the branch for attaching a record swallowed it.
    */
    const blocked = await review(true, false);
    expect(blocked.status).toBe(400);
    const blockers = (blocked.body as { blockers: { field: string }[] }).blockers;
    expect(blockers.some((blocker) => blocker.field === 'readInFull')).toBe(true);
    // And the citation gate, because the seeded state rules are uncited.
    expect(blockers.some((blocker) => blocker.field.startsWith('rule:'))).toBe(true);

    // Name the statute, the way an administrator would.
    state.agency.exemptions = state.agency.exemptions.map((rule) =>
      rule.enabled && !rule.authority ? { ...rule, authority: 'Test Code § 1' } : rule,
    );

    const approved = await review(true, true);
    expect(approved.status).toBe(200);
    expect((approved.body as { stage: string }).stage).toBe('ready');

    // Calling a redacted response a full release is refused.
    const wrong = await call('POST', `/api/public-requests/${request.id}/close`, {
      outcome: 'released',
      reason: '',
    });
    expect(wrong.status).toBe(409);

    const closed = await call('POST', `/api/public-requests/${request.id}/close`, {
      outcome: 'partial',
      reason: 'The victim’s name is withheld under the state exemption.',
    });
    expect(closed.status).toBe(200);

    const released = await call('GET', `/api/public-requests/${request.id}/release`);
    const bundle = (released.body as { releases: { records: { fields: Record<string, string> }[] }[] }).releases[0];
    const narrative = bundle.records[0].fields.narrative;
    // The redaction was actually applied, and the original is not in it.
    expect(narrative).toContain('█');
    expect(narrative).not.toContain(spans[0].text);
  });

  it('refuses a redaction that no longer covers what it was drawn on', async () => {
    const state = asClerk();
    const logged = await call('POST', '/api/public-requests', {
      description: 'A report.',
      requester: { collect: 'Counter' },
    });
    const request = (logged.body as { request: { id: string } }).request;
    const report = state.incidents.find((incident) => (incident.narrative ?? '').length > 200)!;
    const attached = await call('POST', `/api/public-requests/${request.id}/items`, {
      kind: 'incident',
      recordId: report.id,
    });
    const item = (attached.body as { request: { items: { id: string }[] } }).request.items[0];
    const proposed = await call('GET', `/api/public-requests/${request.id}/items/${item.id}/proposal`);
    const spans = (proposed.body as { proposal: { spans: { start: number; end: number }[] } }).proposal.spans;

    const drifted = [{ ...spans[0], start: spans[0].start + 4, end: spans[0].end + 4, decision: 'accepted' }];
    const reply = await call('POST', `/api/public-requests/${request.id}/items/${item.id}/review`, {
      spans: drifted,
      answered: [],
      attachments: [],
      readInFull: true,
      approve: true,
    });
    expect(reply.status).toBe(409);
    expect((reply.body as { advice: string }).advice).toMatch(/covers the wrong words/);
  });
});
