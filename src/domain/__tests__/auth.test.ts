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
    expect(effectivePermissions(admin)).toContain('agency.configure');
  });
});
