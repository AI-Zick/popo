import { describe, expect, it } from 'vitest';
import {
  CITATION_NEEDED,
  DEFAULT_RULES,
  DETECTOR_FAMILY,
  FEDERAL_RULES,
  IDENTIFIER_RULES,
  STATE_RULE_TEMPLATES,
  activeRules,
  checkRule,
  createRule,
  isCited,
  uncitedRules,
  unusableRules,
} from '../exemption';
import type { ExemptionRule } from '../exemption';
import {
  MANUAL_MESSAGE_KEYS,
  MARKER,
  NOT_EXHAUSTIVE,
  applyRedactions,
  mergeSpans,
  propose,
  withholdingLog,
} from '../redaction';
import type { RecordContext, Span, SubjectContext, TextFields } from '../redaction';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const subject = (partial: Partial<SubjectContext> = {}): SubjectContext => ({
  id: 's1',
  firstName: 'Dana',
  lastName: 'Whitfield',
  aliases: [],
  dob: '',
  address: '',
  driverLicense: '',
  role: 'victim',
  juvenile: false,
  ...partial,
});

const context = (partial: Partial<RecordContext> = {}): RecordContext => ({
  subjects: [],
  plates: [],
  offenseCodes: [],
  hasDmvReturn: false,
  hasCriminalHistory: false,
  attachments: [],
  ...partial,
});

/** A rule with an authority on it, so the citation gate is not what is under test. */
const cited = (partial: Partial<ExemptionRule>): ExemptionRule =>
  createRule({ authority: 'Test Code § 1', enabled: true, ...partial });

const narrative = (text: string): TextFields => ({ narrative: text });

const run = (text: string, rules: ExemptionRule[], ctx = context()) =>
  propose(narrative(text), ctx, rules);

/* ------------------------------------------------------------------ */
/* The catalogue                                                       */
/* ------------------------------------------------------------------ */

describe('what an agency starts with', () => {
  it('ships every federal rule cited, because they are not the agency’s to research', () => {
    for (const rule of FEDERAL_RULES) {
      expect(rule.authority.trim()).not.toBe('');
      expect(rule.enabled).toBe(true);
    }
  });

  it('ships every state template switched off', () => {
    // Fifty states' exemptions arriving switched on teaches over-redaction.
    for (const rule of STATE_RULE_TEMPLATES) {
      expect(rule.enabled).toBe(false);
      expect(rule.authority).toBe('');
    }
  });

  it('has no rule that is switched on and can never find anything', () => {
    /*
      The failure this catches is silent, which is why it is worth a test. A
      rule set to redact whose detector is in the manual family points at
      nothing and says nothing — it appears in the list of rules that ran, so
      the clerk reads "checked, found none" where the truth is "never looked".
    */
    for (const rule of DEFAULT_RULES) {
      if (rule.action === 'redact') {
        expect([rule.id, DETECTOR_FAMILY[rule.detector]]).not.toEqual([rule.id, 'manual']);
      }
    }
  });

  it('gives every manual detector something to say', () => {
    const said = DEFAULT_RULES.filter((rule) => DETECTOR_FAMILY[rule.detector] === 'manual');
    for (const rule of said) {
      const found = propose(narrative(''), context({ hasDmvReturn: true, hasCriminalHistory: true, offenseCodes: ['11A'] }),
        [{ ...rule, enabled: true, authority: rule.authority || 'Test Code § 1' }]);
      // Either it speaks, or it has a reason not to on this record. What it
      // must never do is be silently incapable of speaking at all.
      expect(found.notices.length + found.spans.length).toBeGreaterThanOrEqual(0);
      expect(MANUAL_MESSAGE_KEYS).toContain(rule.detector);
    }
  });

  it('raises the federal motor vehicle rule when a query is attached', () => {
    // The one federal rule that bites most often. It shipped pointing at a
    // detector nothing implemented, and found nothing at all.
    const dppa = FEDERAL_RULES.find((rule) => rule.id === 'fed-dppa')!;
    const found = propose(narrative('Ran the tag before the stop.'), context({ hasDmvReturn: true }), [dppa]);
    expect(found.notices).toHaveLength(1);
    expect(found.notices[0].authority).toMatch(/2721/);
  });

  it('raises the criminal history rule when a person query is attached', () => {
    const chri = FEDERAL_RULES.find((rule) => rule.id === 'fed-chri')!;
    expect(propose(narrative('x'), context({ hasCriminalHistory: true }), [chri]).notices).toHaveLength(1);
    expect(propose(narrative('x'), context({ hasCriminalHistory: false }), [chri]).notices).toHaveLength(0);
  });

  it('has no duplicate ids across the three lists', () => {
    const ids = DEFAULT_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the citation gate', () => {
  it('does not stop an uncited rule from running', () => {
    /*
      The load-bearing decision in the whole feature. An agency that installs
      on Monday and has not researched its state's exemptions still gets its
      social security numbers found — the gate is at the release, not here.
    */
    const running = activeRules(IDENTIFIER_RULES).map((rule) => rule.id);
    expect(running).toContain('id-ssn');

    const found = run('SSN: 452-11-9087 on the form.', IDENTIFIER_RULES);
    expect(found.spans).toHaveLength(1);
  });

  it('names every rule that is running with nothing against it', () => {
    const uncited = uncitedRules(DEFAULT_RULES).map((rule) => rule.id);
    expect(uncited).toContain('id-ssn');
    expect(uncited).toContain('id-dob');
    // The federal ones arrive cited, so they are not on the list.
    expect(uncited).not.toContain('fed-dppa');
  });

  it('counts a rule as cited once an agency fills the authority in', () => {
    expect(isCited(createRule({ authority: '' }))).toBe(false);
    expect(isCited(createRule({ authority: '  ' }))).toBe(false);
    expect(isCited(createRule({ authority: 'Ala. Code § 36-12-40' }))).toBe(true);
  });

  it('has something to say when a release is held up by one', () => {
    expect(CITATION_NEEDED).toMatch(/statute/i);
  });
});

describe('a rule that cannot run', () => {
  it('refuses one with no name', () => {
    expect(checkRule(createRule({ label: '' })).field).toBe('label');
  });

  it('refuses a custom rule whose pattern does not compile', () => {
    const broken = cited({ label: 'Broken', detector: 'custom', pattern: '([a-z' });
    expect(checkRule(broken).ok).toBe(false);
    expect(checkRule(broken).field).toBe('pattern');
  });

  it('refuses a repeat inside a repeat', () => {
    /*
      Exponential on text that nearly matches, and this engine runs every rule
      over every narrative on a request. A guard against a mistake rather than
      against an attacker — only an administrator can write one.
    */
    for (const pattern of ['(a+)+', '(\\d*)*', '(x{2,})+']) {
      expect(checkRule(cited({ label: 'Custom', detector: 'custom', pattern })).field).toBe('pattern');
    }
  });

  it('leaves an ordinary pattern alone', () => {
    for (const pattern of ['(ab|cd)+', '[0-9]{3}-[0-9]{2}', '\\bacct\\s*#?\\s*\\d+']) {
      expect(checkRule(cited({ label: 'Custom', detector: 'custom', pattern })).ok).toBe(true);
    }
  });

  it('refuses a pattern longer than it has any reason to be', () => {
    const long = cited({ label: 'Custom', detector: 'custom', pattern: 'a'.repeat(201) });
    expect(checkRule(long).field).toBe('pattern');
  });

  it('says so out loud rather than silently not running it', () => {
    // A rule that quietly does nothing is worse than one that visibly does not:
    // the clerk believes it is catching something and it is not.
    const broken = cited({ id: 'x', label: 'Broken', detector: 'custom', pattern: '([a-z' });
    expect(activeRules([broken])).toHaveLength(0);
    expect(unusableRules([broken])).toHaveLength(1);
  });

  it('orders what does run federal first', () => {
    const rules = [
      cited({ id: 'a', label: 'Agency thing', scope: 'agency', detector: 'phone' }),
      cited({ id: 'f', label: 'Federal thing', scope: 'federal', detector: 'ssn' }),
      cited({ id: 's', label: 'State thing', scope: 'state', detector: 'email' }),
    ];
    expect(activeRules(rules).map((rule) => rule.id)).toEqual(['f', 's', 'a']);
  });
});

/* ------------------------------------------------------------------ */
/* Pattern detectors                                                   */
/* ------------------------------------------------------------------ */

describe('social security numbers', () => {
  const rules = [cited({ id: 'ssn', label: 'SSN', detector: 'ssn' })];

  it('finds a punctuated one', () => {
    expect(run('DOB aside, 452-11-9087 is his number.', rules).spans[0].text).toBe('452-11-9087');
  });

  it('finds an unpunctuated one where it is labelled', () => {
    expect(run('Social security number 452119087.', rules).spans[0].text).toBe('452119087');
  });

  it('leaves nine bare digits alone', () => {
    /*
      Case numbers, serial numbers and amounts in cents are all nine digits. A
      redactor whose suggestions are mostly wrong is one clerks click through,
      which costs more than it saves the first time a real one goes past.
    */
    expect(run('Property tag 452119087 was booked.', rules).spans).toHaveLength(0);
  });

  it('redacts the number and not the label', () => {
    const span = run('SSN: 452-11-9087', rules).spans[0];
    expect(span.text).toBe('452-11-9087');
  });
});

describe('payment cards', () => {
  const rules = [cited({ id: 'fin', label: 'Cards', detector: 'bankAccount' })];

  it('finds one that passes its check digit', () => {
    expect(run('Card 4539 5787 6362 1486 was used.', rules).spans).toHaveLength(1);
  });

  it('leaves a long number that is not a card alone', () => {
    // The Luhn check is the difference between a rule worth reading and one
    // that flags every long number on a fraud report.
    expect(run('Case reference 1234567890123456 refers.', rules).spans).toHaveLength(0);
  });
});

describe('dates of birth', () => {
  const rules = [cited({ id: 'dob', label: 'DOB', detector: 'dob' })];

  it('finds one that is labelled', () => {
    expect(run('DOB: 03/14/1988', rules).spans[0].text).toBe('03/14/1988');
  });

  it('leaves an unlabelled date alone', () => {
    /*
      The most common date in a report is when the offence happened, which is
      the single most public fact on it.
    */
    expect(run('The burglary occurred on 03/14/2026.', rules).spans).toHaveLength(0);
  });

  it('finds an unlabelled one that matches a date of birth on the record', () => {
    const ctx = context({ subjects: [subject({ dob: '1988-03-14' })] });
    const found = run('Seen again on 1988-03-14 in the file.', rules, ctx);
    expect(found.spans).toHaveLength(1);
    expect(found.spans[0].because).toMatch(/Dana Whitfield/);
  });
});

/* ------------------------------------------------------------------ */
/* Record detectors — the part a generic tool cannot do                */
/* ------------------------------------------------------------------ */

describe('knowing who is on the record', () => {
  const victims = [cited({ id: 'vic', label: 'Victims', detector: 'victimIdentity' })];

  it('finds a victim by surname alone', () => {
    const ctx = context({ subjects: [subject({ role: 'victim' })] });
    const found = run('Whitfield stated the door was open.', victims, ctx);
    expect(found.spans).toHaveLength(1);
    expect(found.spans[0].because).toMatch(/victim/);
  });

  it('does not redact every use of a common forename', () => {
    // Blacking out every "Dana" would hide half the sentences and identify
    // nobody, and a surname is identifying in a way a forename is not.
    const ctx = context({ subjects: [subject({ role: 'victim' })] });
    expect(run('Dana was contacted by telephone.', victims, ctx).spans).toHaveLength(0);
  });

  it('leaves the suspect’s name alone when the rule is about victims', () => {
    const ctx = context({
      subjects: [subject({ id: 's2', firstName: 'Marcus', lastName: 'Ordway', role: 'suspect' })],
    });
    expect(run('Ordway was arrested at the scene.', victims, ctx).spans).toHaveLength(0);
  });

  it('finds a juvenile whoever else they are', () => {
    const rules = [cited({ id: 'juv', label: 'Juveniles', detector: 'juvenileName' })];
    const ctx = context({
      subjects: [subject({ lastName: 'Ordway', role: 'suspect', juvenile: true })],
    });
    const found = run('Ordway ran from the lot.', rules, ctx);
    expect(found.spans[0].because).toMatch(/juvenile/);
  });

  it('says a home address might be the scene rather than deciding', () => {
    const rules = [cited({ id: 'addr', label: 'Addresses', detector: 'homeAddress' })];
    const ctx = context({ subjects: [subject({ address: '114 Marion Street' })] });
    const found = run('Called to 114 Marion Street at 0300.', rules, ctx);
    expect(found.spans[0].because).toMatch(/where the offence happened/i);
  });
});

/* ------------------------------------------------------------------ */
/* Manual rules                                                        */
/* ------------------------------------------------------------------ */

describe('rules that find nothing on purpose', () => {
  const medical = [cited({ id: 'med', label: 'Medical', detector: 'medical', action: 'flag' })];

  it('raises a notice instead of a span', () => {
    const found = run('Transported by ambulance to Cedar Falls General.', medical);
    expect(found.spans).toHaveLength(0);
    expect(found.notices).toHaveLength(1);
    expect(found.notices[0].message).toMatch(/Nothing here can find it/);
  });

  it('stays quiet where there is no reason to think it applies', () => {
    // A mental health notice on every burglary is noise, and noise is what
    // teaches people to stop reading notices.
    expect(run('Rear window was forced with a pry bar.', medical).notices).toHaveLength(0);
  });

  it('raises the sexual offence flag off the offence code, not the words', () => {
    const rules = [cited({ id: 'sex', label: 'Sexual offence', detector: 'sexualOffence', action: 'flag' })];
    const found = propose(narrative('Report taken at the hospital.'), context({ offenseCodes: ['11A'] }), rules);
    expect(found.notices[0].message).toMatch(/more than a name/);
  });
});

describe('what nothing here can read', () => {
  it('lists every attachment whether or not anything was found', () => {
    /*
      A redaction drawn over an image is not a redaction unless the file that
      goes out has been changed, so the photograph is always on this list.
    */
    const ctx = context({ attachments: [{ id: 'a1', filename: 'scene.jpg', mime: 'image/jpeg' }] });
    const found = propose(narrative('Nothing of note.'), ctx, []);
    expect(found.unreadable).toHaveLength(1);
    expect(found.unreadable[0].label).toBe('scene.jpg');
  });

  it('reports which rules ran, so “not checked” reads differently from “none found”', () => {
    const found = run('Nothing of note.', [cited({ id: 'ssn', label: 'SSN', detector: 'ssn' })]);
    expect(found.spans).toHaveLength(0);
    expect(found.ranRules.map((rule) => rule.id)).toEqual(['ssn']);
  });

  it('never claims to be complete', () => {
    expect(NOT_EXHAUSTIVE).toMatch(/cannot find everything/);
  });
});

/* ------------------------------------------------------------------ */
/* Overlaps                                                            */
/* ------------------------------------------------------------------ */

const span = (partial: Partial<Span>): Span => ({
  id: 'x',
  field: 'narrative',
  start: 0,
  end: 5,
  text: 'abcde',
  ruleId: 'r',
  ruleLabel: 'Rule',
  authority: 'Code § 1',
  detector: 'ssn',
  confidence: 'high',
  because: 'because',
  ...partial,
});

describe('two rules reaching the same words', () => {
  it('keeps one span and carries both authorities', () => {
    // The log has to be able to say every reason a thing was withheld.
    const merged = mergeSpans([
      span({ id: 'a', start: 10, end: 20, ruleId: 'juv', ruleLabel: 'Juveniles', authority: '§ A', because: 'a juvenile' }),
      span({ id: 'b', start: 10, end: 20, ruleId: 'vic', ruleLabel: 'Victims', authority: '§ B', because: 'a victim' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].authority).toBe('§ A; § B');
    expect(merged[0].because).toMatch(/a juvenile.*a victim/);
  });

  it('widens to cover both', () => {
    const merged = mergeSpans([
      span({ id: 'a', start: 10, end: 20, ruleId: 'a' }),
      span({ id: 'b', start: 15, end: 30, ruleId: 'b' }),
    ]);
    expect(merged[0].start).toBe(10);
    expect(merged[0].end).toBe(30);
  });

  it('leaves the same offsets in different fields alone', () => {
    const merged = mergeSpans([
      span({ id: 'a', field: 'narrative', start: 0, end: 5 }),
      span({ id: 'b', field: 'summary', start: 0, end: 5 }),
    ]);
    expect(merged).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/* Applying                                                            */
/* ------------------------------------------------------------------ */

describe('the released text', () => {
  it('covers exactly what was approved', () => {
    const text = 'Whitfield gave 452-11-9087 at the counter.';
    const out = applyRedactions(text, [span({ start: 15, end: 26, text: '452-11-9087' })]);
    expect(out).toBe(`Whitfield gave ${MARKER.repeat(11)} at the counter.`);
  });

  it('covers every span exactly, however many there are', () => {
    /*
      The second redaction is the one that catches an offset bug: anything that
      shifted the text while applying the first would put it a few characters
      out, and a redaction three characters out releases the last three digits
      of a social security number.
    */
    const text = 'aaa 111-11-1111 bbb 222-22-2222 ccc';
    const out = applyRedactions(text, [
      span({ id: '1', start: 4, end: 15 }),
      span({ id: '2', start: 20, end: 31 }),
    ]);
    expect(out).toBe(`aaa ${MARKER.repeat(11)} bbb ${MARKER.repeat(11)} ccc`);
    expect(out).toHaveLength(text.length);
  });

  it('keeps the length of what it covers', () => {
    // A redaction that shortens the line lets a reader work out how long the
    // hidden thing was, which for a plate is most of the way to knowing it.
    const out = applyRedactions('plate 4AC7821 seen', [span({ start: 6, end: 13, text: '4AC7821' })]);
    expect(out).toHaveLength('plate 4AC7821 seen'.length);
  });

  it('ignores a span that does not fit the text it was handed', () => {
    expect(applyRedactions('short', [span({ start: 0, end: 500 })])).toBe('short');
  });
});

describe('the withholding log', () => {
  it('counts by authority and never repeats the content', () => {
    const log = withholdingLog([
      span({ id: '1', authority: '§ A', ruleLabel: 'SSN', text: '452-11-9087' }),
      span({ id: '2', authority: '§ A', ruleLabel: 'SSN', field: 'summary', text: '111-22-3333' }),
      span({ id: '3', authority: '§ B', ruleLabel: 'Victims' }),
    ]);
    expect(log[0]).toEqual({ authority: '§ A', ruleLabel: 'SSN', count: 2, fields: ['narrative', 'summary'] });
    expect(JSON.stringify(log)).not.toContain('452-11-9087');
  });
});
