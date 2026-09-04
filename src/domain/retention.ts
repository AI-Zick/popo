/**
 * Keeping records, sealing them, and destroying them when a court says so.
 *
 * Three duties that are usually one page of a policy manual and are, in
 * software, three quite different things.
 *
 * **Retention** is how long a record is kept. It is set by state law and it
 * cuts both ways: destroying a record early is a spoliation problem, and
 * keeping one past its schedule is a disclosure problem. Nothing here destroys
 * anything on a timer — records reaching their date land in a queue for a
 * person to look at. An agency that lets software delete case files
 * unattended will one day discover it deleted the one it needed.
 *
 * **Sealing** hides a record from ordinary use without destroying it. It is
 * reversible, and every look at a sealed record is an access event, because
 * "who read this after it was sealed" is the question sealing exists to be
 * able to answer.
 *
 * **Expungement** is a court ordering destruction. It is not reversible and it
 * is not optional, and it is the one operation in this system that genuinely
 * removes data. Three things protect it from being the way a record quietly
 * disappears: it has to name a real court order, a second person has to
 * execute what the first proposed, and what remains afterwards is a
 * certificate that says exactly how much of what was destroyed under whose
 * order — carrying none of the destroyed content itself.
 */

import type { UUID } from './types';

/* ------------------------------------------------------------------ */
/* What is kept, and for how long                                      */
/* ------------------------------------------------------------------ */

/**
 * The kinds of record a schedule can speak about.
 *
 * Coarser than the tables underneath on purpose. A schedule is written by a
 * records manager reading a state retention statute, and that statute says
 * "arrest records" — not "the arrests table and the arrestee rows on incident
 * reports". Mapping one to the other is this software's job, not theirs.
 */
export type RecordKind =
  | 'incident'
  | 'arrest'
  | 'crash'
  | 'stop'
  | 'evidence'
  | 'warrant'
  | 'fieldContact'
  | 'audit';

export const RECORD_KIND_LABEL: Record<RecordKind, string> = {
  incident: 'Incident reports',
  arrest: 'Arrest records',
  crash: 'Crash reports',
  stop: 'Traffic stops',
  evidence: 'Property and evidence',
  warrant: 'Warrants',
  fieldContact: 'Field contacts',
  audit: 'The audit log',
};

/**
 * What starts the clock.
 *
 * The most-missed distinction in a retention schedule. "Seven years" means
 * seven years from *something*, and the something differs by record: an
 * incident runs from when it was closed, a juvenile record from a birthday
 * that may be years after the offence.
 */
export type ClockBasis = 'created' | 'closed' | 'lastActivity' | 'majority';

export const CLOCK_BASIS_LABEL: Record<ClockBasis, string> = {
  created: 'the date the record was made',
  closed: 'the date the case was closed',
  lastActivity: 'the last thing that happened on it',
  majority: 'the subject’s eighteenth birthday',
};

export interface RetentionRule {
  kind: RecordKind;
  /** Ignored when `permanent`. */
  years: number;
  basis: ClockBasis;
  /** Kept for good — homicides, and anything an agency decides never goes. */
  permanent: boolean;
  /** The statute or policy this comes from, so nobody has to guess later. */
  authority: string;
}

/**
 * A starting point, and nothing more.
 *
 * Retention periods are state law and no two states agree, so every number
 * here is one an agency must check and change. They exist so the screen is not
 * empty on the first day, and every one of them is shown with the authority
 * field blank — an agency that has not filled that in has not yet decided.
 */
export const DEFAULT_SCHEDULE: RetentionRule[] = [
  { kind: 'incident', years: 7, basis: 'closed', permanent: false, authority: '' },
  { kind: 'arrest', years: 10, basis: 'created', permanent: false, authority: '' },
  { kind: 'crash', years: 5, basis: 'created', permanent: false, authority: '' },
  { kind: 'stop', years: 3, basis: 'created', permanent: false, authority: '' },
  { kind: 'evidence', years: 0, basis: 'closed', permanent: true, authority: '' },
  { kind: 'warrant', years: 5, basis: 'closed', permanent: false, authority: '' },
  /*
    The shortest period on this list, and deliberately so. A field contact is
    a record of somebody who was not charged with anything, and it should not
    outlive the reason for making it.
  */
  { kind: 'fieldContact', years: 2, basis: 'created', permanent: false, authority: '' },
  { kind: 'audit', years: 0, basis: 'created', permanent: true, authority: '' },
];

export function ruleFor(schedule: RetentionRule[], kind: RecordKind): RetentionRule | null {
  return schedule.find((r) => r.kind === kind) ?? null;
}

export interface DueResult {
  /** True once the record is past its retention period. */
  due: boolean;
  /** The date it becomes due, or '' when it is kept for good. */
  dueOn: string;
  /** Days until it is due; negative once it is past. Null when permanent. */
  days: number | null;
  permanent: boolean;
  /** Why it is not calculable, when it is not. */
  reason: string;
}

const DAY = 86_400_000;

/**
 * When a record may be destroyed.
 *
 * An unknown anchor date is never treated as due. A record whose closing date
 * was never filled in is a record nobody has decided about, and defaulting to
 * "destroy it" would make a missing field into a destruction order.
 */
export function retentionDue(
  rule: RetentionRule | null,
  anchor: string,
  now = new Date(),
): DueResult {
  if (!rule) {
    return { due: false, dueOn: '', days: null, permanent: false, reason: 'No rule for this kind of record.' };
  }
  if (rule.permanent) {
    return { due: false, dueOn: '', days: null, permanent: true, reason: '' };
  }
  const from = new Date(anchor);
  if (!anchor || Number.isNaN(from.getTime())) {
    return {
      due: false,
      dueOn: '',
      days: null,
      permanent: false,
      reason: `Cannot tell: ${CLOCK_BASIS_LABEL[rule.basis]} is not recorded.`,
    };
  }

  const dueAt = new Date(from);
  dueAt.setFullYear(dueAt.getFullYear() + rule.years);
  const days = Math.ceil((dueAt.getTime() - now.getTime()) / DAY);

  return {
    due: days <= 0,
    dueOn: dueAt.toISOString().slice(0, 10),
    days,
    permanent: false,
    reason: '',
  };
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

/**
 * What the order does.
 *
 * `seal` and `expunge` are not two settings of one control. Sealing is a
 * reversible change of who may look; expungement destroys. Keeping them apart
 * in the type means nothing can drift from one to the other by accident.
 */
export type OrderKind = 'seal' | 'unseal' | 'expunge';

export const ORDER_KIND_LABEL: Record<OrderKind, string> = {
  seal: 'Seal the record',
  unseal: 'Unseal the record',
  expunge: 'Destroy the record',
};

/** Who or what the order is about. */
export type ScopeKind = 'case' | 'person';

export type OrderStatus =
  /** Written down, nothing done. */
  | 'draft'
  /** Proposed by one person, waiting on a second to carry it out. */
  | 'proposed'
  | 'executed'
  | 'withdrawn';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Being written up',
  proposed: 'Waiting on a second person',
  executed: 'Carried out',
  withdrawn: 'Withdrawn',
};

export interface DisposalOrder {
  id: UUID;
  /** `X-000042`. Ours, not the court's — the court's is `docket`. */
  reference: string;
  kind: OrderKind;

  /* ---- The court's part -------------------------------------------- */
  court: string;
  docket: string;
  /** The date the judge signed it. */
  orderedOn: string;
  /** Free text: what the order actually says, in the order's own words. */
  instruction: string;

  /* ---- What it covers ---------------------------------------------- */
  scope: ScopeKind;
  /**
   * The case or master identity named by the order.
   *
   * Cleared when the order is carried out. An expungement order that keeps
   * naming its subject afterwards has destroyed nothing — the name is on the
   * order, in the system, forever.
   */
  subjectId: UUID | '';
  /** Shown while the order is live, and cleared with the id. */
  subjectLabel: string;

  status: OrderStatus;
  createdBy: UUID;
  createdByName: string;
  createdAt: string;

  proposedBy: UUID | '';
  proposedByName: string;
  proposedAt: string;

  executedBy: UUID | '';
  executedByName: string;
  executedAt: string;

  /** What was actually destroyed. No content — counts only. */
  certificate: Certificate | null;
  withdrawnReason: string;
}

export function createOrder(partial: Partial<DisposalOrder> = {}): DisposalOrder {
  return {
    id: '',
    reference: '',
    kind: 'seal',
    court: '',
    docket: '',
    orderedOn: '',
    instruction: '',
    scope: 'case',
    subjectId: '',
    subjectLabel: '',
    status: 'draft',
    createdBy: '',
    createdByName: '',
    createdAt: partial.createdAt ?? new Date().toISOString(),
    proposedBy: '',
    proposedByName: '',
    proposedAt: '',
    executedBy: '',
    executedByName: '',
    executedAt: '',
    certificate: null,
    withdrawnReason: '',
    ...partial,
  };
}

/** `X-000042`, in its own series so nobody reads it as a case number. */
export function nextOrderReference(existing: string[]): string {
  const used = existing
    .filter((n) => n.startsWith('X-'))
    .map((n) => Number(n.slice(2)))
    .filter((n) => Number.isFinite(n));
  return `X-${String((used.length > 0 ? Math.max(...used) : 0) + 1).padStart(6, '0')}`;
}

/* ------------------------------------------------------------------ */
/* What an order would touch                                           */
/* ------------------------------------------------------------------ */

/**
 * One line of the preview, and afterwards one line of the certificate.
 *
 * The same shape does both jobs deliberately. What somebody is shown before
 * they sign and what the certificate says was done have to be the same list,
 * or the signature meant nothing.
 */
export interface ManifestLine {
  kind: string;
  count: number;
  /** Shown in the preview so nobody signs blind. Never in the certificate. */
  examples: string[];
}

export const manifestTotal = (lines: ManifestLine[]): number =>
  lines.reduce((sum, line) => sum + line.count, 0);

/**
 * What is left after an expungement.
 *
 * Deliberately without content. It names the court's order — which is public
 * record, not agency information — and says how much of what went, so an
 * agency can prove compliance to the court that ordered it. If this carried
 * case numbers or names it would be a copy of the thing it was supposed to
 * destroy.
 */
export interface Certificate {
  orderReference: string;
  court: string;
  docket: string;
  orderedOn: string;
  executedAt: string;
  executedByName: string;
  proposedByName: string;
  /** Counts by kind, with no examples. */
  lines: ManifestLine[];
  destroyed: number;
  /** Audit entries whose content was destroyed, links kept. */
  auditRedacted: number;
}

export function certificateFor(
  order: DisposalOrder,
  lines: ManifestLine[],
  auditRedacted: number,
  at = new Date().toISOString(),
): Certificate {
  return {
    orderReference: order.reference,
    court: order.court,
    docket: order.docket,
    orderedOn: order.orderedOn,
    executedAt: at,
    executedByName: order.executedByName,
    proposedByName: order.proposedByName,
    // Examples are stripped: they are the content this exists to have destroyed.
    lines: lines.map((line) => ({ kind: line.kind, count: line.count, examples: [] })),
    destroyed: manifestTotal(lines),
    auditRedacted,
  };
}

/* ------------------------------------------------------------------ */
/* What stops an order                                                 */
/* ------------------------------------------------------------------ */

export interface Problem {
  path: string;
  title: string;
  message: string;
  tip?: string;
  severity: 'error' | 'warning';
}

export function checkOrder(order: DisposalOrder): Problem[] {
  const problems: Problem[] = [];
  const error = (path: string, title: string, message: string, tip?: string) =>
    problems.push({ path, title, message, tip, severity: 'error' });

  if (!order.subjectId) {
    error('subjectId', 'Nothing chosen', 'Say which case or person the order is about.');
  }

  /*
    A court, a docket and a date, on every order. This is the difference
    between destroying a record because a judge said so and destroying a
    record because somebody in the building wanted it gone, and it is the only
    thing that makes the difference visible a year later.
  */
  if (!order.court.trim()) {
    error('court', 'No court named', 'Which court made the order.');
  }
  if (!order.docket.trim()) {
    error('docket', 'No docket number', 'The court’s own reference for the order.');
  }
  if (!order.orderedOn) {
    error('orderedOn', 'No date on the order', 'The date the judge signed it.');
  } else if (order.orderedOn > new Date().toISOString().slice(0, 10)) {
    error('orderedOn', 'The order is dated in the future', 'Check the date on the paperwork.');
  }

  if (order.kind === 'expunge' && order.instruction.trim().length < 10) {
    error(
      'instruction',
      'Say what the order requires',
      'In the order’s own words, so the next person to read this file knows what was destroyed and why.',
      'Destroying records is not reversible. This is the record of why it was done.',
    );
  }

  return problems;
}

export const blockingProblems = (problems: Problem[]): Problem[] =>
  problems.filter((p) => p.severity === 'error');

export interface Check {
  ok: boolean;
  reason?: string;
}

/**
 * Whether this person may carry out this order.
 *
 * Two people, always — and never the same two roles as a favour. The person
 * who wrote the order down is not the person who destroys the records, for
 * the same reason nobody approves their own report and no single officer
 * destroys evidence. It is the one control that survives somebody inside the
 * building wanting a record gone.
 */
export function canExecute(order: DisposalOrder, userId: string): Check {
  if (order.status === 'executed') {
    return { ok: false, reason: 'This order has already been carried out.' };
  }
  if (order.status === 'withdrawn') {
    return { ok: false, reason: 'This order was withdrawn.' };
  }
  if (order.status !== 'proposed') {
    return { ok: false, reason: 'Nobody has proposed this order yet.' };
  }
  if (order.proposedBy === userId) {
    return {
      ok: false,
      reason:
        'Somebody else has to carry out an order you proposed. Destroying records takes two people.',
    };
  }
  return { ok: true };
}

/** Unsealing is the one that does not need a second person: it destroys nothing. */
export const needsTwoPeople = (kind: OrderKind): boolean => kind !== 'unseal';

/* ------------------------------------------------------------------ */
/* Reading the list                                                    */
/* ------------------------------------------------------------------ */

export const isLive = (order: DisposalOrder): boolean =>
  order.status === 'draft' || order.status === 'proposed';

/** Waiting on somebody, oldest first — nothing should rot at the bottom. */
export function ordersWaiting(orders: DisposalOrder[]): DisposalOrder[] {
  return orders
    .filter((o) => o.status === 'proposed')
    .sort((a, b) => a.proposedAt.localeCompare(b.proposedAt));
}

export function ordersFor(orders: DisposalOrder[], subjectId: string): DisposalOrder[] {
  return orders
    .filter((o) => o.subjectId === subjectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Every certificate, newest first. What an agency shows a court. */
export function certificates(orders: DisposalOrder[]): Certificate[] {
  return orders
    .map((o) => o.certificate)
    .filter((c): c is Certificate => c !== null)
    .sort((a, b) => b.executedAt.localeCompare(a.executedAt));
}
