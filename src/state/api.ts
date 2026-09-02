/**
 * API client.
 *
 * The session lives in an httpOnly cookie, so there is no token to attach and
 * nothing for this module to hold. `credentials: 'same-origin'` is what carries
 * it; the browser will not hand it to any other origin.
 */

import type { Incident } from '@/domain/types';
import type { PersonIndex } from '@/domain/person';
import type { LocationIndex } from '@/domain/location';
import type { AgencyProfile } from '@/domain/agency';
import type { User } from '@/domain/auth';
import type { AuditEntry, ChainStatus } from '@/domain/audit';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
      ...init,
    });
  } catch {
    // A dead server should read as a dead server, not as a mystery.
    throw new ApiError('Cannot reach the server. Check that the API is running.', 0);
  }

  if (response.status === 204) return undefined as T;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      (body as { error?: string } | null)?.error ?? `Request failed (${response.status}).`;
    throw new ApiError(message, response.status);
  }

  return body as T;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export interface Identity {
  user: User;
  mustChangePassword: boolean;
}

export const api = {
  /** Resolves the signed-in user, or null when there is no valid session. */
  async me(): Promise<Identity | null> {
    try {
      return await request<Identity>('/api/auth/me');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },

  signIn(username: string, password: string): Promise<Identity> {
    return request<Identity>('/api/auth/sign-in', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  signOut(): Promise<{ ok: true }> {
    return request('/api/auth/sign-out', { method: 'POST' });
  },

  changePassword(current: string, next: string): Promise<{ ok: true }> {
    return request('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ current, next }),
    });
  },

  /* ---- State ------------------------------------------------------- */

  state(): Promise<{
    incidents: Incident[];
    people: PersonIndex;
    locations: LocationIndex;
    agency: AgencyProfile | null;
    users: User[];
    auditLog: AuditEntry[];
  }> {
    return request('/api/state');
  },

  putCollection(collection: 'incidents' | 'people' | 'locations', docs: unknown[]) {
    return request<{ ok: true }>(`/api/state/${collection}`, {
      method: 'PUT',
      body: JSON.stringify({ docs }),
    });
  },

  putAgency(agency: AgencyProfile) {
    return request<{ ok: true }>('/api/agency', {
      method: 'PUT',
      body: JSON.stringify({ agency }),
    });
  },

  /* ---- Accounts ---------------------------------------------------- */

  createUser(input: Partial<User>): Promise<{ user: User; temporaryPassword: string }> {
    return request('/api/users', { method: 'POST', body: JSON.stringify(input) });
  },

  deactivateUser(id: string) {
    return request<{ ok: true }>(`/api/users/${id}/deactivate`, { method: 'POST' });
  },

  reactivateUser(id: string) {
    return request<{ ok: true }>(`/api/users/${id}/reactivate`, { method: 'POST' });
  },

  /* ---- Audit ------------------------------------------------------- */

  /**
   * Reports an action the client observed. The actor is taken from the session
   * server-side; anything sent here about who did it would be ignored.
   */
  record(action: string, target = '', detail = ''): Promise<{ ok: true }> {
    return request('/api/audit', {
      method: 'POST',
      body: JSON.stringify({ action, target, detail }),
    });
  },

  auditLog(): Promise<{ entries: AuditEntry[] }> {
    return request('/api/audit');
  },

  verifyAudit(): Promise<ChainStatus> {
    return request('/api/audit/verify');
  },
};
