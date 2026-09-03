import { describe, expect, it } from 'vitest';
import {
  alreadyRaised,
  answeredFor,
  checkDraft,
  MAX_FORWARD_ATTEMPTS,
  MAX_SKEW_SECONDS,
  describeFindings,
  dueForRetry,
  retryDelayMinutes,
  signPayload,
  signaturesMatch,
  timestampFresh,
  enforceRedaction,
  mustAcknowledge,
  redact,
  scan,
  triage,
  type Feedback,
  type FeedbackContext,
  type FeedbackDraft,
} from '../feedback';

const CONTEXT: FeedbackContext = {
  screen: 'Incident report',
  field: 'people.0.dob',
  version: 'test',
  agencyOri: 'AL0010200',
  agencyName: 'Cedar Falls PD',
  userAgent: 'test',
};

const draft = (partial: Partial<FeedbackDraft> = {}): FeedbackDraft => ({
  kind: 'bug',
  impact: 'workaround',
  summary: 'The date field rejects a valid date',
  detail: '',
  context: CONTEXT,
  ...partial,
});

describe('finding what should not leave the agency', () => {
  it('finds a social security number and insists somebody says so', () => {
    const findings = scan('The SSN field will not take 412-55-8871 even though it is valid.');
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('ssn');
    expect(mustAcknowledge(findings)).toBe(true);
  });

  it('does not let the phone pattern claim a social security number', () => {
    /*
      412-55-8871 is nine digits with two separators and the phone pattern is
      hungry. If it matched first the finding would come back as a notice, and
      the one thing that must never leave quietly would leave quietly.
    */
    const findings = scan('412-55-8871');
    expect(findings.map((f) => f.kind)).toEqual(['ssn']);
  });

  it('finds dates, case numbers, addresses and plates', () => {
    const findings = scan(
      'On 2026-000431 the DOB 03/14/1985 at 1142 Ashwood Lane would not save, plate 4AC-7821.',
    );
    const kinds = findings.map((f) => f.kind);
    expect(kinds).toContain('caseNumber');
    expect(kinds).toContain('dob');
    expect(kinds).toContain('address');
    expect(kinds).toContain('licencePlate');
    // None of those is worth blocking a send over.
    expect(mustAcknowledge(findings)).toBe(false);
  });

  it('tells a case number from a date of birth, which look alike', () => {
    expect(scan('2026-000431').map((f) => f.kind)).toEqual(['caseNumber']);
    expect(scan('1985-03-14').map((f) => f.kind)).toEqual(['dob']);
  });

  it('leaves ordinary feedback alone', () => {
    /*
      The scanner earns its place by being quiet. One false positive per report
      and officers learn to click past the warning, at which point it is worse
      than not being there.
    */
    expect(
      scan(
        'The submit button is greyed out with no explanation of what is missing, and the ' +
          'offense list takes four clicks to reach when it used to take one. Version 2 was better.',
      ),
    ).toEqual([]);
  });

  it('scans the whole text, not every other match', () => {
    // A `g` regex reused across calls resumes from lastIndex and silently skips.
    const twice = 'first 412-55-8871 and second 999-00-1111';
    expect(scan(twice)).toHaveLength(2);
    expect(scan(twice)).toHaveLength(2);
  });

  it('removes a social security number whatever the client did', () => {
    /*
      The client offers redaction and asks for an acknowledgement, but a
      guarantee that depends on the client behaving is not a guarantee. This is
      the one that runs on the server.
    */
    const { text, removed } = enforceRedaction('SSN 412-55-8871 with DOB 03/14/1985 fails.');
    expect(text).toBe('SSN [SSN] with DOB 03/14/1985 fails.');
    expect(removed.map((f) => f.kind)).toEqual(['ssn']);
  });

  it('leaves everything short of that exactly as it was written', () => {
    const written = 'Case 2026-000431 at 1142 Ashwood Lane will not print.';
    expect(enforceRedaction(written)).toEqual({ text: written, removed: [] });
  });

  it('replaces findings without disturbing the rest of the sentence', () => {
    const text = 'Saving 412-55-8871 for a DOB of 03/14/1985 fails.';
    const redacted = redact(text, scan(text));
    expect(redacted).toBe('Saving [SSN] for a DOB of [date] fails.');
  });

  it('describes what it found in words somebody will read', () => {
    expect(describeFindings(scan('412-55-8871'))).toBe('a social security number');
    expect(describeFindings(scan('03/14/1985 and 01/02/2003'))).toBe('2 dates of birth');
  });
});

describe('what travels with it', () => {
  /*
    A regression guard with a real story behind it. The first version read the
    screen name out of the page's `<h1>`, which on a report screen is the case
    number — so the one thing the whole design promised would never leave the
    agency was posted to the vendor with every note. It was caught by looking
    at what actually landed in the database, not by reading the code.

    The context type is the contract: structural fields only, and no field on
    it that could hold record content.
  */
  it('has no field that could carry anything off a record', () => {
    const keys: (keyof FeedbackContext)[] = [
      'screen',
      'field',
      'version',
      'agencyOri',
      'agencyName',
      'userAgent',
    ];
    expect(Object.keys(CONTEXT).sort()).toEqual([...keys].sort());
    // Named so a future addition of `caseNumber` fails here and is argued for.
    expect(keys).not.toContain('caseNumber');
  });
});

describe('checking a draft', () => {
  it('needs a one-line summary and nothing else', () => {
    expect(checkDraft(draft())).toEqual([]);
    expect(checkDraft(draft({ summary: '   ' }))[0].field).toBe('summary');
  });

  it('does not argue about anything else', () => {
    // A form that lectures is a form nobody uses twice.
    expect(checkDraft(draft({ detail: '', impact: 'annoyance', kind: 'wording' }))).toEqual([]);
  });

  it('refuses a summary too long to read in a queue', () => {
    expect(checkDraft(draft({ summary: 'x'.repeat(200) }))[0].field).toBe('summary');
  });
});

/* ------------------------------------------------------------------ */

const item = (partial: Partial<Feedback>): Feedback => ({
  id: partial.id ?? 'f1',
  kind: 'bug',
  impact: 'annoyance',
  summary: 's',
  detail: '',
  context: CONTEXT,
  submittedBy: 'u1',
  submittedByName: 'M. Reyes',
  submittedByRole: 'officer',
  at: '2026-09-01T10:00:00.000Z',
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
  ...partial,
});

describe('signing what is sent', () => {
  /*
    Both ends of this wire have to agree exactly — the agency's Node server
    signs, the vendor's Worker verifies — and when they disagree the failure is
    silent: every message is rejected and nobody is watching an endpoint that
    has never worked. Hence one shared implementation, and these.
  */
  const KEY = 'a-per-agency-secret';
  const BODY = JSON.stringify({ summary: 'It will not submit' });

  it('is stable for the same key, time and body', async () => {
    expect(await signPayload(KEY, '1000', BODY)).toBe(await signPayload(KEY, '1000', BODY));
    expect(await signPayload(KEY, '1000', BODY)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any part of the request changes', async () => {
    const base = await signPayload(KEY, '1000', BODY);
    expect(await signPayload('another-agency', '1000', BODY)).not.toBe(base);
    expect(await signPayload(KEY, '1001', BODY)).not.toBe(base);
    expect(await signPayload(KEY, '1000', `${BODY} `)).not.toBe(base);
  });

  it('covers the timestamp, so a captured request cannot be replayed', async () => {
    // Signing the body alone would let anybody re-post a copy indefinitely.
    const early = await signPayload(KEY, '1000', BODY);
    const late = await signPayload(KEY, '9999', BODY);
    expect(early).not.toBe(late);
  });

  it('compares signatures without leaking how much was right', () => {
    const sig = 'a'.repeat(64);
    expect(signaturesMatch(sig, sig)).toBe(true);
    expect(signaturesMatch(sig, 'b'.repeat(64))).toBe(false);
    expect(signaturesMatch(sig, 'a'.repeat(63))).toBe(false);
    expect(signaturesMatch(sig, '')).toBe(false);
  });

  it('refuses a timestamp too far from now', () => {
    const now = 1_000_000_000_000;
    const seconds = Math.floor(now / 1000);
    expect(timestampFresh(String(seconds), now)).toBe(true);
    expect(timestampFresh(String(seconds - MAX_SKEW_SECONDS + 1), now)).toBe(true);
    expect(timestampFresh(String(seconds - MAX_SKEW_SECONDS - 1), now)).toBe(false);
    // A clock ahead of ours is just as suspect as one behind.
    expect(timestampFresh(String(seconds + MAX_SKEW_SECONDS + 1), now)).toBe(false);
    expect(timestampFresh('not a number', now)).toBe(false);
    expect(timestampFresh('', now)).toBe(false);
  });
});

describe('getting it to the vendor', () => {
  const now = new Date('2026-09-03T12:00:00.000Z');
  const minutesAgo = (n: number) => new Date(now.getTime() - n * 60000).toISOString();

  it('retries something that has never been tried', () => {
    /*
      The failure this exists to prevent: feedback written while the vendor
      endpoint happened to be down waits for somebody to notice a badge in a
      settings screen and click a button. Nobody notices, so it never arrives.
    */
    expect(dueForRetry([item({ id: 'fresh' })], now).map((i) => i.id)).toEqual(['fresh']);
  });

  it('leaves alone anything that already arrived', () => {
    expect(dueForRetry([item({ forwarded: true, forwardedAt: minutesAgo(1) })], now)).toEqual([]);
  });

  it('waits longer after each failure', () => {
    const once = item({ id: 'once', forwardAttempts: 1, lastAttemptAt: minutesAgo(2) });
    // One minute has passed of the five this one now wants.
    expect(dueForRetry([once], now)).toEqual([]);
    expect(dueForRetry([{ ...once, lastAttemptAt: minutesAgo(6) }], now)).toHaveLength(1);
  });

  it('settles at twice a day rather than growing without limit', () => {
    // Ten attempts is past the end of the backoff table but short of the cap,
    // so this measures the interval rather than the giving-up rule below.
    expect(retryDelayMinutes(10)).toBe(720);
    const waiting = item({ forwardAttempts: 10, lastAttemptAt: minutesAgo(700) });
    expect(dueForRetry([waiting], now)).toHaveLength(0);
    expect(dueForRetry([{ ...waiting, lastAttemptAt: minutesAgo(721) }], now)).toHaveLength(1);
  });

  it('stops retrying after enough failures, without discarding it', () => {
    // Twenty failures is a configuration problem, and retrying forever hides
    // it. The item stays queued and an administrator can still send it.
    const exhausted = item({ forwardAttempts: MAX_FORWARD_ATTEMPTS, lastAttemptAt: minutesAgo(5000) });
    expect(dueForRetry([exhausted], now)).toEqual([]);
    expect(exhausted.forwarded).toBe(false);
  });

  it('does not freeze the queue when a clock has gone backwards', () => {
    expect(dueForRetry([item({ lastAttemptAt: 'not a date' })], now)).toHaveLength(1);
  });
});

describe('triaging the queue', () => {
  it('puts what stops an officer working above what is merely recent', () => {
    const ordered = triage([
      item({ id: 'annoying', impact: 'annoyance', at: '2026-09-02T10:00:00.000Z' }),
      item({ id: 'blocking', impact: 'blocked', at: '2026-08-01T10:00:00.000Z' }),
    ]);
    expect(ordered[0].id).toBe('blocking');
  });

  it('breaks a tie on how many people hit the same thing', () => {
    const ordered = triage([
      item({ id: 'alone', impact: 'workaround', seconded: [] }),
      item({ id: 'four-of-us', impact: 'workaround', seconded: ['a', 'b', 'c'] }),
    ]);
    expect(ordered[0].id).toBe('four-of-us');
  });

  it('drops answered items below everything still open', () => {
    const ordered = triage([
      item({ id: 'shipped', status: 'shipped', impact: 'blocked' }),
      item({ id: 'open', status: 'new', impact: 'annoyance' }),
    ]);
    expect(ordered[0].id).toBe('open');
  });
});

describe('turning a second report into a second voice', () => {
  it('offers other people’s open items, never your own', () => {
    const items = [
      item({ id: 'mine', submittedBy: 'u1' }),
      item({ id: 'theirs', submittedBy: 'u2' }),
      item({ id: 'closed', submittedBy: 'u2', status: 'declined' }),
    ];
    expect(alreadyRaised(items, 'u1').map((i) => i.id)).toEqual(['theirs']);
  });

  it('shows somebody the answer to what they raised', () => {
    const items = [
      item({ id: 'answered', submittedBy: 'u1', status: 'shipped', response: 'Fixed.', respondedAt: '2026-09-02T00:00:00.000Z' }),
      item({ id: 'silent', submittedBy: 'u1', status: 'shipped', response: '' }),
      item({ id: 'someone else', submittedBy: 'u2', status: 'shipped', response: 'Fixed.' }),
    ];
    expect(answeredFor(items, 'u1').map((i) => i.id)).toEqual(['answered']);
  });
});
