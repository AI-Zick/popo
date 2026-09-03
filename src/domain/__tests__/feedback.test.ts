import { describe, expect, it } from 'vitest';
import {
  alreadyRaised,
  answeredFor,
  checkDraft,
  describeFindings,
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
  ...partial,
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
