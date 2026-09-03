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
import { headHash, sealLink, verifyLinks, type ChainStatus, type Fingerprint } from './chain';

export type { ChainStatus };

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
  | 'attachment.added'
  | 'attachment.viewed'
  | 'attachment.retracted'
  | 'report.submitted'
  | 'report.approved'
  | 'report.returned'
  | 'report.reopened'
  | 'report.printed'
  | 'supplement.created'
  | 'supplement.submitted'
  | 'supplement.approved'
  | 'supplement.returned'
  | 'supplement.reopened'
  | 'crash.created'
  | 'crash.submitted'
  | 'crash.approved'
  | 'crash.returned'
  | 'crash.reopened'
  | 'feedback.sent'
  | 'feedback.answered'
  | 'feedback.forwarded'
  | 'inbound.received'
  | 'migration.imported'
  | 'nibrs.exported'
  | 'narrative.read'
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
  'attachment.added': 'Attachment added',
  'attachment.viewed': 'Attachment opened',
  'attachment.retracted': 'Attachment withdrawn',
  'report.submitted': 'Report submitted',
  'report.approved': 'Report approved',
  'report.returned': 'Report returned',
  'report.reopened': 'Report reopened',
  'report.printed': 'Report printed',
  'supplement.created': 'Supplement started',
  'supplement.submitted': 'Supplement submitted',
  'supplement.approved': 'Supplement approved',
  'supplement.returned': 'Supplement returned',
  'supplement.reopened': 'Supplement reopened',
  'crash.created': 'Crash report started',
  'crash.submitted': 'Crash report submitted',
  'crash.approved': 'Crash report approved',
  'crash.returned': 'Crash report returned',
  'crash.reopened': 'Crash report reopened',
  'feedback.sent': 'Feedback sent to the vendor',
  'feedback.answered': 'Feedback answered',
  'feedback.forwarded': 'Feedback re-sent to the vendor',
  'inbound.received': 'Data received from dispatch or a registry',
  'migration.imported': 'Records imported from a previous system',
  'nibrs.exported': 'NIBRS file exported',
  'narrative.read': 'Narrative sent for reading',
  'agency.configured': 'Agency setup changed',
};

/** Actions worth surfacing on their own, without filtering. */
export const SECURITY_ACTIONS: AuditAction[] = [
  'auth.signInFailed',
  'auth.lockout',
  'note.retracted',
  'note.restrictedViewed',
  'attachment.viewed',
  'attachment.retracted',
  'report.returned',
  'report.reopened',
  'report.printed',
  'nibrs.exported',
  // A narrative leaving the building is an access event, not a convenience.
  'narrative.read',
  // A supplement can change a case's clearance, which changes the agency's
  // published figures. Worth surfacing on its own.
  'supplement.approved',
  'supplement.returned',
  'supplement.reopened',
  'migration.imported',
  // Text authored inside the agency leaving it is an access event, whatever
  // the intent — the same reason a narrative sent for reading is on this list.
  'feedback.sent',
  'feedback.forwarded',
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
 * Which fields the hash covers, and in what order.
 *
 * Every field of the entry, because an audit line with an unhashed field could
 * be edited afterwards without breaking anything — which is worse than not
 * hashing it, since it would still look sealed. The chaining itself lives in
 * `chain.ts`, shared with an evidence item's chain of custody.
 */
const AUDIT_FINGERPRINT: Fingerprint<Omit<AuditEntry, 'hash'>> = (entry) => [
  entry.id,
  entry.at,
  entry.actorId,
  entry.actorName,
  entry.action,
  entry.target,
  entry.detail,
  entry.prevHash,
];

export async function sealEntry(entry: Omit<AuditEntry, 'hash'>): Promise<AuditEntry> {
  return sealLink(entry, AUDIT_FINGERPRINT);
}

/** Appends a sealed entry to the chain. Never mutates the input. */
export async function appendEntry(
  log: AuditEntry[],
  draft: AuditDraft,
  id: string,
  at = new Date().toISOString(),
): Promise<AuditEntry[]> {
  const sealed = await sealEntry({ ...draft, id, at, prevHash: headHash(log) });
  return [...log, sealed];
}

/** Recomputes every hash and every link. */
export function verifyChain(log: AuditEntry[]): Promise<ChainStatus> {
  return verifyLinks(log, AUDIT_FINGERPRINT);
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
