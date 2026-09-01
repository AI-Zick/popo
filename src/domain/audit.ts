/**
 * Audit log.
 *
 * "Who viewed this record, and when" is the question asked after something goes
 * wrong, and it cannot be answered retrospectively — the writing has to already
 * have happened. CJIS requires it for access to criminal justice information,
 * and every agency's own policy requires it for the gate codes and personal
 * data this system holds.
 *
 * Entries are append-only and hash-chained: each carries the hash of the one
 * before it, so removing or editing an entry breaks every hash after it and
 * `verifyChain` says exactly where. That does not make the log unfalsifiable —
 * anyone who can rewrite the whole chain can rewrite history — but it does mean
 * quiet, selective edits stop being possible, which is the realistic threat.
 */

import type { UUID } from './person';

export type AuditAction =
  | 'auth.signIn'
  | 'auth.signInFailed'
  | 'auth.lockout'
  | 'auth.signOut'
  | 'auth.passwordChanged'
  | 'user.created'
  | 'user.updated'
  | 'user.deactivated'
  | 'user.reactivated'
  | 'note.added'
  | 'note.retracted'
  | 'note.restored'
  | 'note.restrictedViewed'
  | 'report.submitted'
  | 'agency.configured';

export const ACTION_LABEL: Record<AuditAction, string> = {
  'auth.signIn': 'Signed in',
  'auth.signInFailed': 'Failed sign-in',
  'auth.lockout': 'Account locked',
  'auth.signOut': 'Signed out',
  'auth.passwordChanged': 'Password changed',
  'user.created': 'Account created',
  'user.updated': 'Account changed',
  'user.deactivated': 'Account deactivated',
  'user.reactivated': 'Account reactivated',
  'note.added': 'Note added',
  'note.retracted': 'Note withdrawn',
  'note.restored': 'Note restored',
  'note.restrictedViewed': 'Restricted note viewed',
  'report.submitted': 'Report submitted',
  'agency.configured': 'Agency setup changed',
};

/** Actions worth surfacing on their own, without filtering. */
export const SECURITY_ACTIONS: AuditAction[] = [
  'auth.signInFailed',
  'auth.lockout',
  'note.retracted',
  'note.restrictedViewed',
  'user.created',
  'user.updated',
  'user.deactivated',
];

export interface AuditEntry {
  id: UUID;
  at: string;
  /** Empty for a failed sign-in, where there is no authenticated actor. */
  actorId: UUID | '';
  actorName: string;
  action: AuditAction;
  /** What was acted on, in human terms. */
  target: string;
  /** Anything worth recording beyond the target. */
  detail: string;
  /** Hash of the preceding entry — empty for the first. */
  prevHash: string;
  hash: string;
}

export type AuditDraft = Omit<AuditEntry, 'id' | 'at' | 'prevHash' | 'hash'>;

/* ------------------------------------------------------------------ */
/* Hashing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Fields are joined in a fixed order, each length-prefixed, so that no two
 * different entries can produce the same input string. Length prefixing avoids
 * the ambiguity a plain separator has when the separator itself appears in a
 * field — "ab" + "c" and "a" + "bc" must not hash alike.
 */
function canonical(entry: Omit<AuditEntry, 'hash'>): string {
  return [
    entry.id,
    entry.at,
    entry.actorId,
    entry.actorName,
    entry.action,
    entry.target,
    entry.detail,
    entry.prevHash,
  ]
    .map((part) => {
      const value = String(part ?? '');
      return `${value.length}:${value}`;
    })
    .join('|');
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sealEntry(entry: Omit<AuditEntry, 'hash'>): Promise<AuditEntry> {
  return { ...entry, hash: await sha256Hex(canonical(entry)) };
}

/** Appends a sealed entry to the chain. Never mutates the input. */
export async function appendEntry(
  log: AuditEntry[],
  draft: AuditDraft,
  id: string,
  at = new Date().toISOString(),
): Promise<AuditEntry[]> {
  const prevHash = log.length > 0 ? log[log.length - 1].hash : '';
  const sealed = await sealEntry({ ...draft, id, at, prevHash });
  return [...log, sealed];
}

export interface ChainStatus {
  intact: boolean;
  /** Index of the first entry that does not verify. */
  brokenAt: number | null;
  reason: string | null;
  checked: number;
}

/** Recomputes every hash and every link. */
export async function verifyChain(log: AuditEntry[]): Promise<ChainStatus> {
  let prevHash = '';
  for (let i = 0; i < log.length; i += 1) {
    const entry = log[i];

    if (entry.prevHash !== prevHash) {
      return {
        intact: false,
        brokenAt: i,
        reason: 'An entry is missing, or entries have been reordered.',
        checked: log.length,
      };
    }

    const { hash, ...rest } = entry;
    if ((await sha256Hex(canonical(rest))) !== hash) {
      return {
        intact: false,
        brokenAt: i,
        reason: 'An entry has been altered since it was written.',
        checked: log.length,
      };
    }

    prevHash = hash;
  }
  return { intact: true, brokenAt: null, reason: null, checked: log.length };
}

/** Most recent first, optionally narrowed. */
export function filterLog(
  log: AuditEntry[],
  options: { actions?: AuditAction[]; actorId?: string; search?: string } = {},
): AuditEntry[] {
  const search = options.search?.trim().toLowerCase();
  return [...log]
    .reverse()
    .filter((entry) => {
      if (options.actions && !options.actions.includes(entry.action)) return false;
      if (options.actorId && entry.actorId !== options.actorId) return false;
      if (search) {
        const haystack = `${entry.actorName} ${ACTION_LABEL[entry.action]} ${entry.target} ${entry.detail}`;
        if (!haystack.toLowerCase().includes(search)) return false;
      }
      return true;
    });
}
