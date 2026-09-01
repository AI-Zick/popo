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

export type Role = 'officer' | 'records' | 'supervisor' | 'admin' | 'vendor';

export const ROLE_LABEL: Record<Role, string> = {
  officer: 'Patrol officer',
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
  records: 2,
  supervisor: 2,
  admin: 3,
  vendor: 4,
};

export const ROLE_ORDER: Role[] = ['officer', 'records', 'supervisor', 'admin', 'vendor'];

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
   * Read the audit log. Deliberately separate from account management — the
   * people who review access are not always the people who grant it, and an
   * internal affairs or records reviewer needs this without the ability to
   * hand out permissions.
   */
  | 'audit.view';

export const PERMISSION_LABEL: Record<Permission, string> = {
  'notes.add': 'Add location notes',
  'notes.retract': 'Withdraw location notes',
  'notes.viewRetracted': 'View withdrawn notes',
  'notes.viewRestricted': 'View restricted notes',
  'agency.configure': 'Change agency setup',
  'reports.approve': 'Approve reports',
  'users.manage': 'Create and manage accounts',
  'agency.provision': 'Provision new agencies',
  'audit.view': 'Read the audit log',
};

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  officer: ['notes.add', 'notes.viewRestricted'],
  supervisor: [
    'notes.add',
    'notes.viewRestricted',
    'notes.retract',
    'notes.viewRetracted',
    'reports.approve',
    'audit.view',
  ],
  records: ['notes.add', 'notes.viewRestricted', 'notes.retract', 'notes.viewRetracted', 'audit.view'],
  admin: [
    'notes.add',
    'notes.viewRestricted',
    'notes.retract',
    'notes.viewRetracted',
    'agency.configure',
    'reports.approve',
    'users.manage',
    'audit.view',
  ],
  vendor: [
    'notes.add',
    'notes.viewRestricted',
    'notes.retract',
    'notes.viewRetracted',
    'agency.configure',
    'reports.approve',
    'users.manage',
    'agency.provision',
    'audit.view',
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

export function rankOf(role: Role): number {
  return ROLE_RANK[role];
}

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
