/**
 * What may be withheld from a public records release, and on what authority.
 *
 * The rules an agency redacts under come from three places, and keeping them
 * apart matters because they answer to different people.
 *
 * **Federal law** binds every agency in the country. There is not much of it
 * that reaches a municipal police record directly — the Driver's Privacy
 * Protection Act is the one that bites hardest and most often — but what there
 * is, is not the agency's to switch off.
 *
 * **State law** is what actually governs a municipal agency's response, and no
 * two states agree. Every state rule below ships disabled with a blank
 * citation, because a rule an agency has not read and cited is a rule it
 * cannot defend, and a system that arrives with fifty states' exemptions
 * switched on is a system that teaches over-redaction on day one.
 *
 * **Agency policy** is the third, and the narrowest. Policy can be stricter
 * than the law about what leaves the building, but policy is not an exemption:
 * withholding something on policy alone, where the law says release it, is how
 * an agency loses a public records suit. Rules from this scope say so on the
 * withholding log.
 *
 * Over-redaction is a real failure, not a safe default. An agency that blacks
 * out everything has not been careful, it has broken a different law — and the
 * clerk pressing the button is the one who has to defend it either way.
 *
 * **Where the citation is enforced.** Every redaction on a release has to be
 * defensible by naming the law it was made under; that is what a withholding
 * log is. But the gate sits at the release, not at the detector. A rule with no
 * citation still runs and still proposes, because finding a social security
 * number has never harmed anybody — what would be indefensible is *withholding*
 * it with nothing named against it, and that is where this refuses. An agency
 * that installs on Monday and has not researched its state's exemptions yet
 * gets the proposals, gets told which of them cannot be signed off, and does
 * not get a release that quietly went out with a licence number in it because
 * a rule was switched off in a settings screen nobody opened.
 */

/* ------------------------------------------------------------------ */
/* How a rule finds what it is about                                   */
/* ------------------------------------------------------------------ */

/**
 * The two families, and the difference between them is the whole design.
 *
 * A **pattern** detector reads the text. It finds a social security number
 * wherever it appears, and it is reliable because the shape of the thing is
 * the thing.
 *
 * A **record** detector reads the record. It knows who is a victim on this
 * report, which offence they are a victim of, and how old they were — and it
 * can therefore find a name that a pattern detector has no way to recognise
 * as anything but a name. That is what a records system can do that a generic
 * redaction tool cannot, and it is most of the value here.
 *
 * A **manual** detector finds nothing. It exists to put a sentence in front of
 * the clerk: this record touches something the law treats carefully, and a
 * person has to read it. Pretending a regex can find medical information in a
 * narrative is worse than admitting it cannot.
 */
export type DetectorFamily = 'pattern' | 'record' | 'manual';

export type Detector =
  // Pattern: the shape of the thing is the thing.
  | 'ssn'
  | 'phone'
  | 'email'
  | 'dob'
  | 'driverLicense'
  | 'plate'
  | 'bankAccount'
  | 'custom'
  // Record: needs to know who is on this report and in what role.
  | 'juvenileName'
  | 'victimIdentity'
  | 'witnessIdentity'
  | 'reportingPartyIdentity'
  | 'homeAddress'
  // Manual: says what to look for and admits it cannot find it.
  | 'dmvReturn'
  | 'criminalHistory'
  | 'medical'
  | 'mentalHealth'
  | 'sexualOffence'
  | 'confidentialSource'
  | 'ongoingInvestigation'
  | 'officerSafety';

export const DETECTOR_FAMILY: Record<Detector, DetectorFamily> = {
  ssn: 'pattern',
  phone: 'pattern',
  email: 'pattern',
  dob: 'pattern',
  driverLicense: 'pattern',
  plate: 'pattern',
  bankAccount: 'pattern',
  custom: 'pattern',
  juvenileName: 'record',
  victimIdentity: 'record',
  witnessIdentity: 'record',
  reportingPartyIdentity: 'record',
  homeAddress: 'record',
  /*
    Manual, not record, and the distinction is the honest one. This engine
    knows a registration query is attached to the case; it cannot know which
    words in a narrative an officer copied out of the return it came back
    with. Claiming to find those would be claiming to find what it cannot.
  */
  dmvReturn: 'manual',
  criminalHistory: 'manual',
  medical: 'manual',
  mentalHealth: 'manual',
  sexualOffence: 'manual',
  confidentialSource: 'manual',
  ongoingInvestigation: 'manual',
  officerSafety: 'manual',
};

export const DETECTOR_LABEL: Record<Detector, string> = {
  ssn: 'Social security numbers',
  phone: 'Telephone numbers',
  email: 'Email addresses',
  dob: 'Dates of birth',
  driverLicense: 'Driver licence numbers',
  plate: 'Registration plates',
  bankAccount: 'Account and card numbers',
  custom: 'A pattern the agency wrote',
  juvenileName: 'Names of juveniles on the record',
  victimIdentity: 'Names and details of victims',
  witnessIdentity: 'Names and details of witnesses',
  reportingPartyIdentity: 'Whoever reported it',
  homeAddress: 'Home addresses of people on the record',
  dmvReturn: 'Anything returned by a DMV query',
  criminalHistory: 'Criminal history returned by a query',
  medical: 'Medical information',
  mentalHealth: 'Mental health information',
  sexualOffence: 'Anything identifying a sexual offence victim',
  confidentialSource: 'A confidential source',
  ongoingInvestigation: 'Material that would harm a live investigation',
  officerSafety: 'Anything that would endanger an officer',
};

export type Scope = 'federal' | 'state' | 'agency';

export const SCOPE_LABEL: Record<Scope, string> = {
  federal: 'Federal law',
  state: 'State law',
  agency: 'Agency policy',
};

/**
 * What the rule asks for.
 *
 * `redact` proposes hiding something specific. `flag` says a person has to
 * look and cannot say where. `review` is the weakest and the most honest —
 * it means the whole record needs a closer read than usual.
 */
export type Action = 'redact' | 'flag' | 'review';

export interface ExemptionRule {
  id: string;
  label: string;
  scope: Scope;
  detector: Detector;
  action: Action;

  /**
   * The statute or ordinance. Blank until an agency fills it in. An uncited
   * rule still runs and still proposes; what it cannot do is put a redaction
   * on a release that anybody has signed off — see `uncitedRules`.
   */
  authority: string;

  /** What a clerk needs to know about when this applies, in plain words. */
  note: string;

  /** A regular expression, for `custom` only. */
  pattern: string;

  enabled: boolean;
}

export function createRule(partial: Partial<ExemptionRule> = {}): ExemptionRule {
  return {
    id: '',
    label: '',
    scope: 'agency',
    detector: 'custom',
    action: 'redact',
    authority: '',
    note: '',
    pattern: '',
    enabled: false,
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* The catalogue                                                       */
/* ------------------------------------------------------------------ */

/**
 * Federal rules, on by default.
 *
 * Short, because not much federal law reaches a municipal police record
 * directly. What is here is not the agency's to switch off, so these arrive
 * enabled and cited.
 */
export const FEDERAL_RULES: ExemptionRule[] = [
  createRule({
    id: 'fed-dppa',
    label: 'Motor vehicle record data',
    scope: 'federal',
    detector: 'dmvReturn',
    action: 'flag',
    authority: '18 U.S.C. § 2721 (Driver’s Privacy Protection Act)',
    note: 'Personal information obtained from a motor vehicle record — the name, address, licence number and photograph a registration query returns. The Act restricts redisclosure whatever the state records law says.',
    enabled: true,
  }),
  createRule({
    id: 'fed-chri',
    label: 'Criminal history from a query',
    scope: 'federal',
    detector: 'criminalHistory',
    action: 'flag',
    authority: '28 C.F.R. § 20.33',
    note: 'Criminal history record information received through NCIC or a state repository. It may be used for the purpose it was obtained for and not redisclosed; a conviction found in a public court record is a different thing and is not covered by this.',
    enabled: true,
  }),
  createRule({
    id: 'fed-victim-services',
    label: 'Victim services information',
    scope: 'federal',
    detector: 'confidentialSource',
    action: 'flag',
    authority: '34 U.S.C. § 12291(b)(2)',
    note: 'Where the agency holds information from a victim services provider under a VAWA-funded programme, that information carries its own confidentiality and generally cannot be released without the victim’s written, informed, time-limited consent.',
    enabled: true,
  }),
];

/**
 * State rules, off by default and uncited.
 *
 * A starting list of the exemptions most state public records acts carry in
 * some form, so a records clerk is not staring at an empty screen on the first
 * day. Every one arrives switched off with a blank citation, because the
 * wording, the scope and the citation differ in every state and a rule nobody
 * has checked is a rule that will redact the wrong thing.
 */
export const STATE_RULE_TEMPLATES: ExemptionRule[] = [
  createRule({
    id: 'st-juvenile',
    label: 'Juveniles',
    scope: 'state',
    detector: 'juvenileName',
    action: 'redact',
    note: 'Most states restrict identifying a juvenile in a police record. States differ on whether that covers juvenile victims and witnesses as well as juvenile suspects — check which, because this rule finds all three.',
  }),
  createRule({
    id: 'st-sexual-offence',
    label: 'Sexual offence victims',
    scope: 'state',
    detector: 'sexualOffence',
    action: 'flag',
    note: 'Nearly every state protects the identity of a victim of a sexual offence, and most protect more than the name — an address, a relationship or a distinctive detail can identify somebody just as well. This flags the record; a person has to read it.',
  }),
  createRule({
    id: 'st-victim-identity',
    label: 'Victim identity',
    scope: 'state',
    detector: 'victimIdentity',
    action: 'redact',
    note: 'Some states exempt victim identity generally, others only for listed offences, and some not at all. Enabling this where the state does not require it is over-redaction, which is its own unlawful act.',
  }),
  createRule({
    id: 'st-witness',
    label: 'Witness identity',
    scope: 'state',
    detector: 'witnessIdentity',
    action: 'redact',
    note: 'Narrower than victim identity in most states, and often limited to cases where release would endanger the witness.',
  }),
  createRule({
    id: 'st-reporting-party',
    label: 'Whoever reported it',
    scope: 'state',
    detector: 'reportingPartyIdentity',
    action: 'redact',
    note: 'A neighbour who calls something in is often protected where a witness is not. This is also the exemption most easily defeated by the narrative: "the caller from the house with the blue truck" identifies somebody as surely as a name, and no automatic rule will find that.',
  }),
  createRule({
    id: 'st-home-address',
    label: 'Home addresses',
    scope: 'state',
    detector: 'homeAddress',
    action: 'redact',
    note: 'The home address of a person on the record. Where the address is the scene of the offence it is usually releasable, and this rule cannot tell the difference — read what it proposes.',
  }),
  createRule({
    id: 'st-medical',
    label: 'Medical information',
    scope: 'state',
    detector: 'medical',
    action: 'flag',
    note: 'Injuries, treatment, ambulance transport, anything from a medical provider. HIPAA usually does not bind a police agency directly, but state law commonly exempts this and material received from a covered entity may carry its own restrictions.',
  }),
  createRule({
    id: 'st-mental-health',
    label: 'Mental health information',
    scope: 'state',
    detector: 'mentalHealth',
    action: 'flag',
    note: 'A crisis call, a commitment, a welfare check. Protected in most states and frequently the whole substance of the narrative rather than a line in it.',
  }),
  createRule({
    id: 'st-ongoing',
    label: 'Ongoing investigation',
    scope: 'state',
    detector: 'ongoingInvestigation',
    action: 'review',
    note: 'The most over-used exemption there is. In most states it protects material whose release would actually harm the investigation — not every record on an open case. A blanket refusal because the case is open is what gets an agency sued.',
  }),
  createRule({
    id: 'st-informant',
    label: 'Confidential sources',
    scope: 'state',
    detector: 'confidentialSource',
    action: 'flag',
    note: 'Identity of a confidential informant, and anything that would identify one indirectly.',
  }),
  createRule({
    id: 'st-officer-safety',
    label: 'Officer safety',
    scope: 'state',
    detector: 'officerSafety',
    action: 'flag',
    note: 'Home addresses and personal details of officers, and tactical information. Narrower than it is usually applied: an officer’s name on a report they wrote is public in most states.',
  }),
];

/**
 * The identifiers almost every state treats as exempt in some form.
 *
 * These ship enabled and uncited: they run from the first day, and the release
 * they touch cannot be signed off until somebody names the statute. A social
 * security number in a public release is a harm nobody argues about, so the
 * default is to catch it and make somebody name the authority, rather than to
 * stay silent and let it through.
 */
export const IDENTIFIER_RULES: ExemptionRule[] = [
  createRule({
    id: 'id-ssn',
    label: 'Social security numbers',
    scope: 'state',
    detector: 'ssn',
    action: 'redact',
    note: 'Exempt everywhere in some form, and a release containing one is a harm that cannot be taken back.',
    enabled: true,
  }),
  createRule({
    id: 'id-dob',
    label: 'Dates of birth',
    scope: 'state',
    detector: 'dob',
    action: 'redact',
    note: 'Exempt in many states and releasable in others, often depending on whose it is. Check before leaving this on.',
    enabled: true,
  }),
  createRule({
    id: 'id-licence',
    label: 'Driver licence numbers',
    scope: 'state',
    detector: 'driverLicense',
    action: 'redact',
    note: 'Usually exempt, and separately restricted by the federal motor vehicle rule where it came from a query.',
    enabled: true,
  }),
  createRule({
    id: 'id-phone',
    label: 'Telephone numbers',
    scope: 'state',
    detector: 'phone',
    action: 'redact',
    note: 'Personal numbers are commonly exempt. An agency’s own published number is not, and this rule cannot tell them apart.',
    enabled: true,
  }),
  createRule({
    id: 'id-email',
    label: 'Email addresses',
    scope: 'state',
    detector: 'email',
    action: 'redact',
    note: 'Personal addresses, on the same footing as telephone numbers.',
    enabled: true,
  }),
  createRule({
    id: 'id-financial',
    label: 'Account and card numbers',
    scope: 'state',
    detector: 'bankAccount',
    action: 'redact',
    note: 'Bank accounts and payment cards, which turn up in fraud and theft reports as the substance of the offence.',
    enabled: true,
  }),
];

/** What an agency starts with on the first day. */
export const DEFAULT_RULES: ExemptionRule[] = [
  ...FEDERAL_RULES,
  ...IDENTIFIER_RULES,
  ...STATE_RULE_TEMPLATES,
];

/* ------------------------------------------------------------------ */
/* Whether a rule can be used                                          */
/* ------------------------------------------------------------------ */

export interface Check {
  ok: boolean;
  reason: string;
  field: string;
}

const good: Check = { ok: true, reason: '', field: '' };

/**
 * Whether a rule is well-formed enough to run.
 *
 * Deliberately not the citation check. A rule that cannot run is one whose
 * pattern does not compile or that nobody has named — mechanical failures. A
 * missing citation is a different kind of problem, it is caught at the release
 * by `uncitedRules`, and treating it as a reason not to look would mean the
 * safest-configured agency is the one that finds the least.
 */
export function checkRule(rule: ExemptionRule): Check {
  if (!rule.label.trim()) {
    return { ok: false, reason: 'What is this rule called?', field: 'label' };
  }
  if (rule.detector === 'custom') {
    if (!rule.pattern.trim()) {
      return { ok: false, reason: 'A custom rule needs a pattern to look for.', field: 'pattern' };
    }
    if (rule.pattern.length > MAX_PATTERN) {
      return {
        ok: false,
        reason: `A pattern here is at most ${MAX_PATTERN} characters.`,
        field: 'pattern',
      };
    }
    if (NESTED_QUANTIFIER.test(rule.pattern)) {
      return {
        ok: false,
        reason: 'That pattern has a repeat inside a repeat, which can take a very long time to run.',
        field: 'pattern',
      };
    }
    try {
      // eslint-disable-next-line no-new
      new RegExp(rule.pattern);
    } catch {
      return { ok: false, reason: 'That pattern is not a valid regular expression.', field: 'pattern' };
    }
  }
  return good;
}

const MAX_PATTERN = 200;

/*
  A repeat wrapped in another repeat — `(a+)+`, `(\d*)*`. On text that nearly
  matches, these take exponential time, and this engine runs every rule over
  every narrative on a request. Only an administrator can write one, so this is
  a guard against a mistake rather than against an attacker, and it is a
  heuristic: it catches the shape that causes it in practice and does not
  pretend to be a proof. A pattern this refuses can nearly always be written
  another way.
*/
const NESTED_QUANTIFIER = /\([^)]*[+*]\)\s*[+*]|\([^)]*\{\d+,\}?\)\s*[+*{]/;

/** The rules that will actually run, in the order a clerk reads them. */
export function activeRules(rules: ExemptionRule[]): ExemptionRule[] {
  const order: Record<Scope, number> = { federal: 0, state: 1, agency: 2 };
  return rules
    .filter((rule) => rule.enabled && checkRule(rule).ok)
    .sort((a, b) => order[a.scope] - order[b.scope] || a.label.localeCompare(b.label));
}

/**
 * What is switched on and silently not running.
 *
 * Surfaced on the setup screen rather than swallowed, because a rule that
 * silently does not run is worse than one that visibly does not: the clerk
 * believes it is catching something and it is not.
 */
export function unusableRules(rules: ExemptionRule[]): { rule: ExemptionRule; reason: string }[] {
  return rules
    .filter((rule) => rule.enabled)
    .map((rule) => ({ rule, check: checkRule(rule) }))
    .filter(({ check }) => !check.ok)
    .map(({ rule, check }) => ({ rule, reason: check.reason }));
}

/**
 * Whether a rule can carry a redaction onto a signed release.
 *
 * The whole citation gate, in one line, moved to where it belongs. The rule
 * runs and proposes either way; this is what stops the proposal becoming a
 * withholding nobody can account for.
 */
export function isCited(rule: ExemptionRule): boolean {
  return rule.authority.trim().length > 0;
}

/**
 * Rules that are running with nothing named against them.
 *
 * Shown on the setup screen as work to do, and enforced at the release: a
 * redaction proposed by one of these can be accepted, but the release cannot
 * be issued until either the statute is named or the redaction is dropped.
 * Both are legitimate answers, and neither is one this system should pick.
 */
export function uncitedRules(rules: ExemptionRule[]): ExemptionRule[] {
  return activeRules(rules).filter((rule) => !isCited(rule));
}

/** What to say when an uncited rule is holding a release up. */
export const CITATION_NEEDED =
  'Name the statute this is withheld under. A redaction with nothing against it on the withholding log is one the agency cannot answer for, and a requester is entitled to ask.';
