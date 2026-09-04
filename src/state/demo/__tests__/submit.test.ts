import { beforeEach, describe, expect, it } from 'vitest';
import { handle } from '../router';
import { db, reset } from '../store';
import { runRules } from '@/validation/engine';
import { ALL_RULES } from '@/validation/rules';
import { stateRules } from '@/domain/nibrs/rules';
import { profileFor } from '@/domain/nibrs/states';

/**
 * A report cannot go up with blocking problems in it.
 *
 * The editor already refuses this, and refuses it well — it names the field and
 * walks the officer to it. What it could not do was be the only thing that
 * refused it. Anything reaching the route another way put the report in the
 * review queue with whatever was missing from it, and the first person to find
 * out was the supervisor, or the state, or nobody.
 *
 * The arrest route next door has always checked its own problems before
 * accepting a submission. This is the report route being brought into line.
 */

const call = (method: string, url: string, body?: unknown) => handle(method, url, body);

describe('sending a report up', () => {
  beforeEach(() => {
    reset();
  });

  const errorsOn = (id: string) => {
    const state = db();
    const report = state.incidents.find((incident) => incident.id === id)!;
    return runRules(report, [...ALL_RULES, ...stateRules(profileFor(state.agency.state))], {
      people: state.people,
      locations: state.locations,
      agency: state.agency,
    }).errors;
  };

  it('refuses one with blocking problems, and says which', async () => {
    const state = db();
    const draft = state.incidents.find((incident) => incident.status === 'draft')!;
    const blocking = errorsOn(draft.id);
    // The seeded draft is deliberately incomplete; if it ever stops being so,
    // this test is checking nothing and should fail loudly here.
    expect(blocking.length).toBeGreaterThan(0);

    state.currentUserId = state.users.find((user) => user.role === 'officer')!.id;
    const reply = await call('POST', `/api/reports/${draft.id}/submit`, {});
    expect(reply.status).toBe(400);

    const body = reply.body as { error: string; issues: { title: string; path: string }[] };
    expect(body.issues).toHaveLength(blocking.length);
    // It has to name them, not just count them — a refusal an officer cannot
    // act on is a refusal they will work around.
    expect(body.issues[0].title).toBeTruthy();
    expect(body.issues[0].path).toBeTruthy();

    // And the report did not move.
    expect(db().incidents.find((incident) => incident.id === draft.id)!.status).toBe('draft');
  });

  it('accepts one that is finishable', async () => {
    const state = db();
    const clean = state.incidents.find(
      (incident) => incident.status === 'draft' && errorsOn(incident.id).length === 0,
    );
    /*
      The seed has no complete draft, so make one: take the report that was
      good enough to be approved and put it back in draft. Approving it is the
      agency's own statement that nothing blocking is left in it.
    */
    const approved = state.incidents.find((incident) => incident.status === 'approved')!;
    const target = clean ?? approved;
    if (!clean) target.status = 'draft';
    expect(errorsOn(target.id)).toHaveLength(0);

    state.currentUserId = state.users.find((user) => user.role === 'officer')!.id;
    const reply = await call('POST', `/api/reports/${target.id}/submit`, {});
    expect(reply.status).toBe(200);
    expect(db().incidents.find((incident) => incident.id === target.id)!.status).toBe('pending_review');
  });
});
