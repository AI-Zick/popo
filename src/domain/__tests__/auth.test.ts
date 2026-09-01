import { describe, expect, it } from 'vitest';
import { can, createUser, effectivePermissions, isDesignated, type User } from '../auth';

const officer = createUser({ id: 'u1', name: 'M. Reyes', badge: '4417', role: 'officer' });
const supervisor = createUser({ id: 'u2', name: 'A. Boone', badge: '2210', role: 'supervisor' });
const admin = createUser({ id: 'u3', name: 'R. Vance', badge: '1001', role: 'admin' });

describe('what an officer can do', () => {
  it('adds notes', () => {
    expect(can(officer, 'notes.add')).toBe(true);
  });

  it('cannot withdraw them', () => {
    expect(can(officer, 'notes.retract')).toBe(false);
    expect(can(officer, 'notes.viewRetracted')).toBe(false);
  });

  it('cannot change agency setup', () => {
    expect(can(officer, 'agency.configure')).toBe(false);
  });
});

describe('who can withdraw a note', () => {
  it('supervisors, records staff and admins', () => {
    expect(can(supervisor, 'notes.retract')).toBe(true);
    expect(can(admin, 'notes.retract')).toBe(true);
  });

  it('an individually designated officer, without promoting them', () => {
    const designated: User = { ...officer, grants: ['notes.retract'] };
    expect(can(designated, 'notes.retract')).toBe(true);
    expect(designated.role).toBe('officer');
    expect(isDesignated(designated, 'notes.retract')).toBe(true);
  });

  it('reports a role-derived permission as not individually designated', () => {
    expect(isDesignated(supervisor, 'notes.retract')).toBe(false);
  });
});

describe('withholding a permission', () => {
  it('a revocation beats the role', () => {
    const restricted: User = { ...supervisor, revocations: ['notes.retract'] };
    expect(can(restricted, 'notes.retract')).toBe(false);
  });

  it('a revocation beats an explicit grant too', () => {
    const conflicted: User = { ...officer, grants: ['notes.retract'], revocations: ['notes.retract'] };
    expect(can(conflicted, 'notes.retract')).toBe(false);
  });
});

describe('edge cases', () => {
  it('nobody signed in can do nothing', () => {
    expect(can(null, 'notes.add')).toBe(false);
    expect(can(null, 'notes.retract')).toBe(false);
  });

  it('lists the permissions actually held', () => {
    expect(effectivePermissions(officer)).toEqual(['notes.add', 'notes.viewRestricted']);
    expect(effectivePermissions(officer)).not.toContain('audit.view');
    expect(effectivePermissions(admin)).toContain('agency.configure');
  });
});

/* ------------------------------------------------------------------ */
/* Provisioning                                                        */
/* ------------------------------------------------------------------ */

import {
  assignableRoles,
  canAssignRole,
  canDeactivate,
  canGrantPermission,
  canManageUser,
  grantablePermissions,
  sanitizeUserInput,
} from '../auth';

const vendor = createUser({ id: 'v1', name: 'Platform', role: 'vendor' });

describe('reading the audit log', () => {
  it('is separate from account management', () => {
    const reviewer = createUser({ id: 'r2', name: 'Records', role: 'records' });
    expect(can(reviewer, 'audit.view')).toBe(true);
    expect(can(reviewer, 'users.manage')).toBe(false);
  });

  it('is not open to patrol officers by default', () => {
    expect(can(officer, 'audit.view')).toBe(false);
  });

  it('can be designated to a named officer', () => {
    const designated: User = { ...officer, grants: ['audit.view'] };
    expect(can(designated, 'audit.view')).toBe(true);
  });
});

describe('who may set up accounts', () => {
  it('agency administrators may', () => {
    expect(can(admin, 'users.manage')).toBe(true);
  });

  it('officers, supervisors and records staff may not', () => {
    expect(can(officer, 'users.manage')).toBe(false);
    expect(can(supervisor, 'users.manage')).toBe(false);
    expect(can(createUser({ id: 'r1', name: 'R', role: 'records' }), 'users.manage')).toBe(false);
  });

  it('an individually designated officer may, without being promoted', () => {
    const designated: User = { ...officer, grants: ['users.manage'] };
    expect(can(designated, 'users.manage')).toBe(true);
    expect(designated.role).toBe('officer');
  });
});

describe('nobody hands out more authority than they hold', () => {
  it('an agency administrator cannot create a vendor', () => {
    expect(canAssignRole(admin, 'vendor')).toBe(false);
    expect(assignableRoles(admin)).not.toContain('vendor');
  });

  it('an agency administrator can create staff up to their own level', () => {
    expect(assignableRoles(admin)).toEqual(['officer', 'records', 'supervisor', 'admin']);
  });

  it('the vendor can create an agency administrator', () => {
    expect(canAssignRole(vendor, 'admin')).toBe(true);
    expect(canAssignRole(vendor, 'vendor')).toBe(true);
  });

  it('a designated officer can only assign at officer level', () => {
    const designated: User = { ...officer, grants: ['users.manage'] };
    expect(assignableRoles(designated)).toEqual(['officer']);
    expect(canAssignRole(designated, 'supervisor')).toBe(false);
  });

  it('someone without the permission can assign nothing', () => {
    expect(assignableRoles(officer)).toEqual([]);
    expect(assignableRoles(null)).toEqual([]);
  });
});

describe('nobody designates a permission they lack', () => {
  it('an administrator cannot grant vendor provisioning', () => {
    expect(canGrantPermission(admin, 'agency.provision')).toBe(false);
    expect(grantablePermissions(admin)).not.toContain('agency.provision');
  });

  it('a designated officer can only pass on what they hold', () => {
    const designated: User = { ...officer, grants: ['users.manage'] };
    expect(canGrantPermission(designated, 'users.manage')).toBe(true);
    expect(canGrantPermission(designated, 'notes.retract')).toBe(false);
  });

  it('sanitising strips a role and grants beyond the actor', () => {
    const attempted = sanitizeUserInput(admin, {
      name: 'New Hire',
      role: 'vendor',
      grants: ['agency.provision', 'notes.retract'],
    });
    expect(attempted.role).toBe('officer');
    expect(attempted.grants).toEqual(['notes.retract']);
  });
});

describe('reaching above your authority', () => {
  it('an administrator cannot manage a vendor account', () => {
    expect(canManageUser(admin, vendor)).toBe(false);
  });

  it('the vendor can manage an administrator', () => {
    expect(canManageUser(vendor, admin)).toBe(true);
  });

  it('administrators can manage each other', () => {
    const other = createUser({ id: 'a2', name: 'Second admin', role: 'admin' });
    expect(canManageUser(admin, other)).toBe(true);
  });
});

describe('not locking the agency out', () => {
  const roster = [admin, officer, supervisor];

  it('refuses to deactivate your own account', () => {
    const result = canDeactivate(admin, admin, roster);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/your own account/i);
  });

  it('refuses to deactivate the last account that can manage accounts', () => {
    const second = createUser({ id: 'a2', name: 'Second admin', role: 'admin' });
    // Only `second` could manage accounts if `admin` is the one acting.
    const result = canDeactivate(vendor, second, [second, officer]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/last account/i);
  });

  it('allows it when another manager remains', () => {
    const second = createUser({ id: 'a2', name: 'Second admin', role: 'admin' });
    expect(canDeactivate(admin, second, [admin, second, officer]).ok).toBe(true);
  });

  it('refuses when the actor cannot manage accounts at all', () => {
    expect(canDeactivate(officer, supervisor, roster).ok).toBe(false);
  });

  it('an inactive manager does not count as remaining cover', () => {
    const dormant = createUser({ id: 'a3', name: 'On leave', role: 'admin', active: false });
    const target = createUser({ id: 'a4', name: 'Working admin', role: 'admin' });
    const result = canDeactivate(vendor, target, [dormant, target, officer]);
    expect(result.ok).toBe(false);
  });
});
