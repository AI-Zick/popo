/**
 * Whether this installation is ready to hold a real agency's records.
 *
 * Every setup screen in this system already tells the truth about itself. The
 * statute table says which entries nobody has verified. The county GIS says it
 * has never been tested. The mail panel says it is not set up. The shift times
 * say they are still the ones the software shipped with.
 *
 * The problem was never that the markers were missing. It was that each one is
 * only visible to somebody standing on that particular screen, and the person
 * who has to decide whether an agency can go live is not going to visit nine
 * screens and remember what each of them said. So this reads them all and puts
 * them in one list.
 *
 * ## What it will not do
 *
 * Score anything. There is no percentage and no green tick that means "ready",
 * because readiness is a judgement about an agency's circumstances — a
 * department with no county GIS to connect to is not less ready than one that
 * has connected to it, and a progress bar that says 87% invites somebody to
 * treat the remaining 13% as rounding. What this produces is a list of true
 * statements, sorted by how much they matter, each with the screen that fixes
 * it.
 *
 * ## Three weights
 *
 * **Blocking** — an agency cannot work without this, or would be running
 * outside what it has been told it must do. An installation with these
 * outstanding is not one to hand over.
 *
 * **Worth fixing** — it works, and something specific is worse than it should
 * be: an officer will hit a wall, or a number will be wrong.
 *
 * **Worth knowing** — nothing is broken, but somebody signing this off should
 * have been told. Most of these are honest defaults doing their job.
 */

import type { AgencyProfile } from './agency';
import type { User } from './auth';
import { can } from './auth';
import { canSendMail } from './passwordReset';
import { DEFAULT_PATTERN } from './shift';
import { isVerified } from './statute';

export type Weight = 'blocking' | 'fix' | 'know';

export const WEIGHT_LABEL: Record<Weight, string> = {
  blocking: 'Blocking',
  fix: 'Worth fixing',
  know: 'Worth knowing',
};

/** Which setup screen answers this. Matches the hub's tab keys. */
export type Screen =
  | 'jurisdiction'
  | 'accounts'
  | 'statutes'
  | 'exemptions'
  | 'retention'
  | 'gis'
  | 'mail';

export interface Finding {
  id: string;
  weight: Weight;
  /** One line, true as written. */
  says: string;
  /** What to do about it, or why it is only worth knowing. */
  because: string;
  screen: Screen;
}

export interface Context {
  agency: AgencyProfile;
  users: User[];
  /** Whether the server has a mail relay password. It cannot be read here. */
  hasMailPassword: boolean;
}

const WEIGHT_ORDER: Record<Weight, number> = { blocking: 0, fix: 1, know: 2 };

/**
 * Everything true about this installation that somebody signing it off should
 * read, worst first.
 */
export function review(context: Context): Finding[] {
  const { agency, users } = context;
  const found: Finding[] = [];
  const add = (finding: Finding) => found.push(finding);

  /* ---- The agency itself ------------------------------------------- */

  if (!agency.name.trim()) {
    add({
      id: 'name',
      weight: 'blocking',
      says: 'The agency has no name.',
      because: 'It heads every printed report and every public records release.',
      screen: 'jurisdiction',
    });
  }

  if (!agency.ori.trim()) {
    add({
      id: 'ori',
      weight: 'blocking',
      says: 'No ORI is set.',
      because:
        'The FBI identifier for this agency. Every NIBRS submission carries it, and a submission without one is rejected in full.',
      screen: 'jurisdiction',
    });
  }

  if (!agency.state.trim()) {
    add({
      id: 'state',
      weight: 'blocking',
      says: 'No state is set.',
      because:
        'The state decides which NIBRS rules apply and which statute pack loads. Nothing downstream is right until it is chosen.',
      screen: 'jurisdiction',
    });
  }

  if (!agency.boundary) {
    add({
      id: 'boundary',
      weight: 'fix',
      says: 'No jurisdiction boundary has been loaded.',
      because:
        'Calls outside the jurisdiction are not flagged, so an assist for another agency looks like an offence in this one.',
      screen: 'jurisdiction',
    });
  }

  if (!agency.zones) {
    add({
      id: 'zones',
      weight: 'know',
      says: `No ${agency.zoneLabel.toLowerCase()} areas have been loaded.`,
      because: `Reports will carry no ${agency.zoneLabel.toLowerCase()}, and crime trends cannot be broken down by area.`,
      screen: 'jurisdiction',
    });
  }

  /* ---- Who can work here ------------------------------------------- */

  const active = users.filter((user) => user.active);
  const managers = active.filter((user) => can(user, 'users.manage'));
  const approvers = active.filter((user) => can(user, 'reports.approve'));
  const expungers = active.filter((user) => can(user, 'records.expunge'));

  if (managers.length === 1) {
    add({
      id: 'one-manager',
      weight: 'fix',
      says: 'One account can manage accounts.',
      because:
        'If they are away or locked out, nobody can create an account or grant a permission until they are back. There is a console recovery command, but it needs somebody at the server.',
      screen: 'accounts',
    });
  }

  if (approvers.length === 0) {
    add({
      id: 'no-approver',
      weight: 'blocking',
      says: 'Nobody can approve a report.',
      because: 'Every report submitted for review would sit in the queue permanently.',
      screen: 'accounts',
    });
  }

  if (expungers.length < 2) {
    add({
      id: 'expunge-pair',
      weight: 'know',
      says:
        expungers.length === 0
          ? 'Nobody can carry out a destruction order.'
          : 'Only one account can carry out a destruction order.',
      because:
        'Destruction deliberately needs two people — one proposes, a different one executes. Until there are two, a court order cannot be carried out. That is the rule working, not a fault.',
      screen: 'accounts',
    });
  }

  if (active.length === users.length && users.length <= 2) {
    add({
      id: 'few-accounts',
      weight: 'know',
      says: `${users.length} accounts exist.`,
      because: 'Looks like an installation nobody has been provisioned into yet.',
      screen: 'accounts',
    });
  }

  /* ---- Signing in --------------------------------------------------- */

  if (!agency.requireMfa) {
    add({
      id: 'mfa-off',
      weight: 'blocking',
      says: 'A second factor is not required to sign in.',
      because:
        'CJIS requires more than a password to reach criminal justice information. Turning this off is a decision to run outside that, not a convenience setting.',
      screen: 'jurisdiction',
    });
  }

  if (!canSendMail(agency.mail, { hasPassword: context.hasMailPassword })) {
    add({
      id: 'no-mail',
      weight: 'fix',
      says: 'Nobody can reset their own password.',
      because:
        'No mail server is configured, so the sign-in screen offers no reset. Administrators can still issue passwords, and there is a console command for the last one out.',
      screen: 'mail',
    });
  }

  const withoutEmail = active.filter((user) => !user.email.trim());
  if (canSendMail(agency.mail, { hasPassword: context.hasMailPassword }) && withoutEmail.length > 0) {
    add({
      id: 'accounts-without-email',
      weight: 'know',
      says: `${withoutEmail.length} of ${active.length} accounts have no email address.`,
      because:
        'Those officers cannot use the reset link and will need an administrator. Everybody else can.',
      screen: 'accounts',
    });
  }

  /* ---- Things the software cannot see ------------------------------- */

  /*
    The one finding here that nothing in this system can verify. SQLite writes
    plaintext, so what protects these records at rest is the volume they sit on
    — a hosting decision, made by somebody else, and invisible from inside.

    So it asks for a name and a date instead. "We assumed the provider did it"
    is the answer an assessor hears most often, and the point of recording who
    confirmed it is that there is then somebody to ask.
  */
  if (!agency.encryptionAtRest.confirmedOn) {
    add({
      id: 'encryption-at-rest',
      weight: 'blocking',
      says: 'Nobody has confirmed the disk under this installation is encrypted.',
      because:
        'The database is written in plain text, so the volume is what protects it. This software cannot check that and is not claiming to — it needs somebody to have looked, and to have said so here.',
      screen: 'mail',
    });
  }

  /* ---- Tables an agency has to own --------------------------------- */

  const unverified = agency.statutes.filter((statute) => !isVerified(statute));
  if (agency.statutes.length === 0) {
    add({
      id: 'no-statutes',
      weight: 'fix',
      says: 'The statute table is empty.',
      because:
        'Officers will type charges as free text, and nothing will check them against a citation.',
      screen: 'statutes',
    });
  } else if (unverified.length > 0) {
    add({
      id: 'unverified-statutes',
      weight: unverified.length === agency.statutes.length ? 'fix' : 'know',
      says: `${unverified.length} of ${agency.statutes.length} statutes have never been checked against the code.`,
      because:
        'They ship unverified on purpose — a citation is only as good as the day somebody read it. Anything charged from an unchecked entry is somebody else’s wording.',
      screen: 'statutes',
    });
  }

  const uncited = agency.exemptions.filter((rule) => rule.enabled && !rule.authority.trim());
  if (uncited.length > 0) {
    add({
      id: 'uncited-exemptions',
      weight: 'fix',
      says: `${uncited.length} public-records exemptions are switched on with no citation.`,
      because:
        'They will propose redactions and cannot be signed off, so a release will stall at the last step rather than at the first.',
      screen: 'exemptions',
    });
  }

  const noAuthority = agency.retention.filter((rule) => !rule.authority.trim());
  if (noAuthority.length > 0) {
    add({
      id: 'retention-authority',
      weight: 'know',
      says: `${noAuthority.length} retention rules cite no authority.`,
      because:
        'The schedule works either way. The authority is what somebody points at when asked why a record was destroyed.',
      screen: 'retention',
    });
  }

  /* ---- Everything else ---------------------------------------------- */

  if (!agency.gis.kind) {
    add({
      id: 'no-gis',
      weight: 'know',
      says: 'No county address service is connected.',
      because:
        'Addresses are typed rather than looked up, so the same house arrives spelled three ways. Plenty of agencies have nothing to connect to.',
      screen: 'gis',
    });
  } else if (!agency.gis.checkedOn) {
    add({
      id: 'gis-untested',
      weight: 'fix',
      says: 'The county address service has never been tested.',
      because: 'It is configured but unproven. One button on that screen settles it.',
      screen: 'gis',
    });
  }

  const shiftsAreDefault =
    agency.shifts.starts.join() === DEFAULT_PATTERN.starts.join() &&
    agency.shifts.names.join() === DEFAULT_PATTERN.names.join();
  if (shiftsAreDefault) {
    add({
      id: 'default-shifts',
      weight: 'know',
      says: 'Shift times are the ones the software shipped with.',
      because:
        'Seven, three and eleven. If this agency changes over at other times, the briefing draws its boundaries in the wrong places.',
      screen: 'mail',
    });
  }

  return found.sort(
    (a, b) => WEIGHT_ORDER[a.weight] - WEIGHT_ORDER[b.weight] || a.id.localeCompare(b.id),
  );
}

export const blocking = (findings: Finding[]): Finding[] =>
  findings.filter((finding) => finding.weight === 'blocking');

/**
 * One sentence for the top of the screen.
 *
 * Deliberately never says "ready". Nothing here can know whether an agency is
 * ready to go live; what it can say is whether anything is outstanding, and
 * who has to decide about the rest.
 */
export function summary(findings: Finding[]): string {
  const stop = blocking(findings).length;
  const rest = findings.length - stop;
  if (findings.length === 0) {
    return 'Nothing outstanding. Every setup screen has been filled in and nothing is running on a default.';
  }
  if (stop > 0) {
    return `${stop} ${stop === 1 ? 'thing' : 'things'} would stop this agency working${
      rest > 0 ? `, and ${rest} more ${rest === 1 ? 'is' : 'are'} worth reading` : ''
    }.`;
  }
  return `Nothing is blocking. ${rest} ${rest === 1 ? 'thing is' : 'things are'} worth reading before anybody signs this off.`;
}
