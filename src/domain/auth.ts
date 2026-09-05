/**
 * Users, roles and permissions.
 *
 * The rule this exists for: an officer adds what they learned at a location,
 * and cannot quietly take away what someone else learned. Notes on a place are
 * the accumulated knowledge of a shift that has already gone home, and the
 * person best placed to judge whether one is wrong is rarely the person who
 * finds it inconvenient.
 */

import type { UUID } from './person';

export type Role = 'officer' | 'dispatch' | 'records' | 'supervisor' | 'admin' | 'vendor';

export const ROLE_LABEL: Record<Role, string> = {
  officer: 'Patrol officer',
  dispatch: 'Dispatcher',
  records: 'Records',
  supervisor: 'Supervisor',
  admin: 'Agency administrator',
  vendor: 'Vendor administrator',
};

/**
 * Administrative authority, used to stop anyone handing out more than they
 * hold. This is about who may provision whom, not about rank on the street —
 * a records clerk outranks nobody, but does administer the file room.
 */
const ROLE_RANK: Record<Role, number> = {
  officer: 1,
  /*
    Level with records and supervisors for provisioning purposes, which is all
    rank means here — an administrator can create a dispatcher, and a
    dispatcher, holding no account management, creates nobody.
  */
  dispatch: 2,
  records: 2,
  supervisor: 2,
  admin: 3,
  vendor: 4,
};

export const ROLE_ORDER: Role[] = ['officer', 'dispatch', 'records', 'supervisor', 'admin', 'vendor'];

export type Permission =
  /** Add a note to a location. Everyone who writes reports can. */
  | 'notes.add'
  /** Withdraw a note so it stops showing on the location. */
  | 'notes.retract'
  /** See notes that have been withdrawn, and who withdrew them. */
  | 'notes.viewRetracted'
  /** Read notes marked restricted, such as gate codes. */
  | 'notes.viewRestricted'
  /** Change jurisdiction and boundary configuration. */
  | 'agency.configure'
  /** Approve reports submitted for review. */
  | 'reports.approve'
  /** Create and manage accounts for this agency. */
  | 'users.manage'
  /** Stand up a new customer agency and its first administrator. */
  | 'agency.provision'
  /**
   * Property-room duties: move an item, check the shelf, release it, destroy it.
   *
   * Separate from writing reports because it is a separate job. Any officer
   * seizes property and signs it in or out — that is police work. Deciding
   * where an item lives and when it leaves for good belongs to the property
   * clerk, and an agency that gives that to everyone has no property room.
   */
  | 'evidence.manage'
  /**
   * Read the audit log. Deliberately separate from account management — the
   * people who review access are not always the people who grant it, and an
   * internal affairs or records reviewer needs this without the ability to
   * hand out permissions.
   */
  | 'audit.view'
  /**
   * Seal a record, and record a court order about one.
   *
   * Sealing hides a record from ordinary use and is reversible, so it sits
   * with the records job rather than with destruction.
   */
  | 'records.seal'
  /**
   * Carry out a destruction order.
   *
   * The one irreversible operation in this system. What protects it is not
   * the scarcity of this permission — it is the court order, the preview of
   * exactly what will go, and the second person: whoever proposes an order
   * cannot be the one who carries it out. That is the same shape as a
   * two-signature drug destruction, where both officers hold the authority
   * and neither can act alone.
   *
   * Held by administrators, so an agency with one administrator cannot
   * destroy anything until it has two. An agency wanting it narrower revokes
   * it from the administrators and grants it to named people.
   */
  | 'records.expunge'
  /**
   * Lift a trespass notice before it runs out.
   *
   * Recording one is open to everybody who takes calls, because the notice is
   * somebody else's decision that the police are writing down. Undoing one is
   * not: it is deciding that a property owner's instruction no longer stands,
   * and an officer who arrests somebody on a notice that was quietly lifted an
   * hour earlier has been let down by the system. Same line as withdrawing a
   * location note, held by the same people.
   *
   * A notice reaching its end date needs nobody's authority. That is not a
   * decision, it is a date.
   */
  | 'trespass.lift'
  /**
   * Put something on the board — a BOLO, a lookout, a shift notice.
   *
   * Everybody, on purpose. The officer who has just watched a car leave a
   * burglary is the one holding the description, and a board that makes them
   * find a supervisor first is a board that gets it an hour late and second
   * hand. Same line as adding a location note.
   */
  | 'bulletins.post'
  /**
   * Take something off the board.
   *
   * Administrators and dispatch. A lookout somebody found inconvenient and
   * quietly deleted is the exact failure the location note rule exists to
   * prevent, and dispatch is on this list because dispatch is who runs the
   * board hour to hour — they are told the car was recovered before anybody
   * else is.
   *
   * Withdrawal, not destruction: it leaves the board, keeps who took it down
   * and why, and stays readable by the people who may see withdrawn material.
   * Nobody asks about a deleted BOLO until something has gone wrong, which is
   * when "it is gone" is the worst available answer.
   */
  | 'bulletins.remove'
  /**
   * Approve a redaction and issue a public records release.
   *
   * Logging a request is open to everybody, because writing down that somebody
   * asked is not a decision and a request that goes unlogged because the only
   * clerk was at lunch is a statutory clock that never started. Deciding what
   * leaves the building is a decision, and it is one somebody has to answer
   * for: releasing something exempt cannot be taken back, and withholding
   * something releasable is the thing agencies are actually sued over.
   *
   * Held by records and administrators. A supervisor does not get it by rank —
   * in a small agency the sergeant often *is* the records clerk, and the way
   * to say that is to designate them, which leaves a name against the
   * decision rather than a job title.
   *
   * Not held by the vendor. Standing up an agency's software is not authority
   * to send that agency's records to a member of the public.
   */
  | 'records.release';

export const PERMISSION_LABEL: Record<Permission, string> = {
  'notes.add': 'Add location notes',
  'notes.retract': 'Withdraw location notes',
  'notes.viewRetracted': 'View withdrawn notes',
  'notes.viewRestricted': 'View restricted notes',
  'agency.configure': 'Change agency setup',
  'reports.approve': 'Approve reports',
  'users.manage': 'Create and manage accounts',
  'agency.provision': 'Provision new agencies',
  'evidence.manage': 'Run the property room',
  'audit.view': 'Read the audit log',
  'records.seal': 'Seal records and record court orders',
  'records.expunge': 'Carry out destruction orders',
  'records.release': 'Approve redactions and issue public records releases',
  'trespass.lift': 'Lift a trespass notice early',
  'bulletins.post': 'Post BOLOs and bulletins',
  'bulletins.remove': 'Take a BOLO or bulletin off the board',
};

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  officer: ['notes.add', 'notes.viewRestricted', 'bulletins.post'],
  /*
    Dispatch takes the calls and runs the board. No report approval, no
    property room, no accounts — a dispatcher is not a supervisor, and the
    permissions here are the ones the job actually uses.
  */
  dispatch: [
    'notes.add',
    'notes.viewRestricted',
    'bulletins.post',
    'bulletins.remove',
  ],
  supervisor: [
    'notes.add',
    'notes.viewRestricted',
    'notes.retract',
    'notes.viewRetracted',
    'trespass.lift',
    'bulletins.post',
    'reports.approve',
    'evidence.manage',
    'audit.view',
  ],
  records: [
    'notes.add',
    'notes.viewRestricted',
    'notes.retract',
    'notes.viewRetracted',
    'trespass.lift',
    'bulletins.post',
    'evidence.manage',
    'audit.view',
    'records.seal',
    'records.release',
  ],
  admin: [
    'notes.add',
    'notes.viewRestricted',
    'notes.retract',
    'notes.viewRetracted',
    'trespass.lift',
    'bulletins.post',
    'bulletins.remove',
    'agency.configure',
    'reports.approve',
    'users.manage',
    'evidence.manage',
    'audit.view',
    'records.seal',
    'records.release',
    'records.expunge',
  ],
  /*
    Deliberately without `records.expunge`. The vendor stands up agencies and
    fixes their software; a supplier able to destroy a customer's records on
    their own system is not a support arrangement, it is a liability.
  */
  vendor: [
    'notes.add',
    'notes.viewRestricted',
    'notes.retract',
    'notes.viewRetracted',
    'trespass.lift',
    'bulletins.post',
    'bulletins.remove',
    'agency.configure',
    'reports.approve',
    'users.manage',
    'agency.provision',
    'evidence.manage',
    'audit.view',
    'records.seal',
  ],
};

export interface User {
  id: UUID;
  name: string;
  badge: string;
  role: Role;
  /**
   * Permissions granted to this person beyond their role — the "and those
   * designated" case. A veteran officer who maintains the location index does
   * not need to be made a supervisor to tidy it.
   */
  grants: Permission[];
  /** Permissions withheld from this person despite their role. */
  revocations: Permission[];

  /** Sign-in identifier. Not authentication — see the README. */
  username: string;

  /**
   * Accounts are deactivated, never deleted. An officer who has left still
   * authored reports and notes, and those have to keep resolving to a person.
   */
  active: boolean;
  deactivatedAt: string;

  createdAt: string;
  /** Who provisioned this account. */
  createdBy: string;
}

export function can(user: User | null, permission: Permission): boolean {
  if (!user) return false;
  if (user.revocations.includes(permission)) return false;
  if (user.grants.includes(permission)) return true;
  return ROLE_PERMISSIONS[user.role].includes(permission);
}

/** Permissions this user actually holds, for display in setup. */
export function effectivePermissions(user: User): Permission[] {
  return (Object.keys(PERMISSION_LABEL) as Permission[]).filter((p) => can(user, p));
}

/** True when the permission comes from an explicit grant rather than the role. */
export function isDesignated(user: User, permission: Permission): boolean {
  return user.grants.includes(permission) && !ROLE_PERMISSIONS[user.role].includes(permission);
}

export function createUser(partial: Partial<User> & { id: UUID }): User {
  return {
    name: '',
    badge: '',
    role: 'officer',
    grants: [],
    revocations: [],
    username: '',
    active: true,
    deactivatedAt: '',
    createdAt: new Date().toISOString(),
    createdBy: '',
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* Provisioning                                                        */
/* ------------------------------------------------------------------ */

/**
 * Roles this person may hand out. Nobody may create an account with more
 * administrative authority than their own — the guard that stops an agency
 * administrator quietly making themselves a vendor.
 */
export function assignableRoles(actor: User | null): Role[] {
  if (!actor || !can(actor, 'users.manage')) return [];
  return ROLE_ORDER.filter((role) => ROLE_RANK[role] <= ROLE_RANK[actor.role]);
}

export function canAssignRole(actor: User | null, role: Role): boolean {
  return assignableRoles(actor).includes(role);
}

/**
 * Permissions this person may designate to someone else: only ones they hold
 * themselves. Otherwise "designate a colleague" becomes a way to mint any
 * permission in the system.
 */
export function grantablePermissions(actor: User | null): Permission[] {
  if (!actor || !can(actor, 'users.manage')) return [];
  return (Object.keys(PERMISSION_LABEL) as Permission[]).filter((p) => can(actor, p));
}

export function canGrantPermission(actor: User | null, permission: Permission): boolean {
  return grantablePermissions(actor).includes(permission);
}

/** Whether the actor may edit this account at all. */
export function canManageUser(actor: User | null, target: User): boolean {
  if (!actor || !can(actor, 'users.manage')) return false;
  // Never reach above your own authority.
  return ROLE_RANK[target.role] <= ROLE_RANK[actor.role];
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

/**
 * Deactivation guards. Two ways an agency locks itself out of its own system:
 * an administrator deactivates their own account, or the last person who can
 * manage accounts is switched off.
 */
export function canDeactivate(actor: User | null, target: User, allUsers: User[]): GuardResult {
  if (!actor || !can(actor, 'users.manage')) {
    return { ok: false, reason: 'You do not have permission to manage accounts.' };
  }
  if (!canManageUser(actor, target)) {
    return { ok: false, reason: 'This account has more authority than yours.' };
  }
  if (target.id === actor.id) {
    return { ok: false, reason: 'You cannot deactivate your own account.' };
  }
  const remainingManagers = allUsers.filter(
    (u) => u.active && u.id !== target.id && can(u, 'users.manage'),
  );
  if (remainingManagers.length === 0) {
    return {
      ok: false,
      reason: 'This is the last account that can manage accounts. Set up another one first.',
    };
  }
  return { ok: true };
}

/** Sanitises a proposed account so it can never exceed the actor's authority. */
export function sanitizeUserInput(actor: User | null, input: Partial<User>): Partial<User> {
  const role = input.role && canAssignRole(actor, input.role) ? input.role : 'officer';
  const grants = (input.grants ?? []).filter((p) => canGrantPermission(actor, p));
  const revocations = input.revocations ?? [];
  return { ...input, role, grants, revocations };
}
