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

export type Role = 'officer' | 'supervisor' | 'records' | 'admin';

export const ROLE_LABEL: Record<Role, string> = {
  officer: 'Patrol officer',
  supervisor: 'Supervisor',
  records: 'Records',
  admin: 'Administrator',
};

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
  | 'reports.approve';

export const PERMISSION_LABEL: Record<Permission, string> = {
  'notes.add': 'Add location notes',
  'notes.retract': 'Withdraw location notes',
  'notes.viewRetracted': 'View withdrawn notes',
  'notes.viewRestricted': 'View restricted notes',
  'agency.configure': 'Change agency setup',
  'reports.approve': 'Approve reports',
};

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  officer: ['notes.add', 'notes.viewRestricted'],
  supervisor: ['notes.add', 'notes.viewRestricted', 'notes.retract', 'notes.viewRetracted', 'reports.approve'],
  records: ['notes.add', 'notes.viewRestricted', 'notes.retract', 'notes.viewRetracted'],
  admin: [
    'notes.add',
    'notes.viewRestricted',
    'notes.retract',
    'notes.viewRetracted',
    'agency.configure',
    'reports.approve',
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
    ...partial,
  };
}
