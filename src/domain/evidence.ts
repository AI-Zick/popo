/**
 * Property and evidence.
 *
 * The property already on a report is the **NIBRS view**: what was taken, what
 * it was worth, so the crime can be counted. This is a different thing that
 * happens to describe some of the same objects — physical custody of a thing,
 * from the moment an officer picks it up to the day it is destroyed.
 *
 * Two rules run through all of it.
 *
 *   **The ledger is the record; everything else is derived.** Where an item is,
 *   who has it and what state it is in are computed from its custody entries,
 *   never stored beside them. Storing both invites drift between the two, and
 *   drift in a chain of custody is precisely what defence counsel is looking
 *   for — an item the system says is on shelf C while the ledger's last entry
 *   says a detective signed it out in March.
 *
 *   **Nothing is ever edited or deleted.** A mistake is corrected by adding an
 *   entry that says so. The chain is hashed the same way the audit log is, so a
 *   quiet edit breaks every link after it and `verifyCustody` says where.
 *
 * What this file does not do is decide policy. How long a firearm is held, when
 * narcotics may be destroyed, whether currency needs two signatures — those are
 * an agency's rules and a state's statutes, and they are configuration, not
 * constants buried in a domain file.
 */

import type { UUID } from './person';
import {
  headHash,
  sealLink,
  verifyLinks,
  type ChainStatus,
  type Fingerprint,
  type Linked,
} from './chain';

/* ------------------------------------------------------------------ */
/* What is being held                                                  */
/* ------------------------------------------------------------------ */

/**
 * The kind of thing it is.
 *
 * Not decoration: category decides handling. A firearm is traced and never
 * destroyed on an officer's say-so, narcotics are weighed by two people and
 * destroyed on a schedule, biological evidence is refrigerated and on violent
 * cases is often kept for ever, and digital evidence is imaged so the original
 * is never the working copy.
 */
export type EvidenceCategory =
  | 'general'
  | 'firearm'
  | 'ammunition'
  | 'drug'
  | 'currency'
  | 'biological'
  | 'digital'
  | 'document'
  | 'vehicle'
  | 'hazardous';

export const CATEGORY_LABEL: Record<EvidenceCategory, string> = {
  general: 'General property',
  firearm: 'Firearm',
  ammunition: 'Ammunition',
  drug: 'Drugs / narcotics',
  currency: 'Currency',
  biological: 'Biological',
  digital: 'Digital media',
  document: 'Documents',
  vehicle: 'Vehicle',
  hazardous: 'Hazardous',
};

/**
 * Categories that may not be released or destroyed on one person's signature.
 *
 * The two where a mistake is not recoverable and the temptation is real. Not a
 * legal opinion — an agency's own policy will be stricter — but a floor.
 */
export const TWO_PERSON_CATEGORIES: EvidenceCategory[] = ['firearm', 'drug', 'currency'];

export interface EvidenceItem {
  id: UUID;
  /**
   * What is written on the bag.
   *
   * Agency-wide and sequential, not per-case: the number is how a shelf is
   * searched and how a lab refers to it, and it has to be unique across
   * everything the property room holds.
   */
  tagNumber: string;

  /** The case it belongs to. Found property arrives without one. */
  caseId: UUID | '';
  caseNumber: string;
  /**
   * The property line on the report this is the physical counterpart of.
   *
   * Optional both ways. A stolen car listed on a report is property with no
   * evidence item; a seized knife is an evidence item that may be no part of
   * the NIBRS property count.
   */
  propertyItemId: UUID | '';

  category: EvidenceCategory;
  description: string;
  quantity: string;
  make: string;
  model: string;
  serialNumber: string;

  /** Where it came from, in the officer's words. */
  foundAt: string;

  /**
   * When it may be disposed of, and why not yet.
   *
   * Set by whoever has authority over the case, not computed here: a hold for
   * appeal outlasts any schedule, and a schedule that quietly overrode a hold
   * would destroy evidence in a live case.
   */
  holdReason: string;
  disposalDueAt: string;

  createdAt: string;
  createdBy: UUID;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* The ledger                                                          */
/* ------------------------------------------------------------------ */

export type CustodyAction =
  /** Picked up. Always the first entry; the chain begins in the field. */
  | 'collected'
  /** Into the property room, on a shelf. */
  | 'booked'
  /** Shelf to shelf, or room to room. */
  | 'moved'
  /** Signed out — to court, to a lab, to an investigator. */
  | 'checkedOut'
  /** Signed back in. */
  | 'checkedIn'
  /** Gone for good, to whoever is entitled to it. */
  | 'released'
  | 'destroyed'
  /** A shelf check that confirms it is where the ledger says. */
  | 'audited'
  /** A correction. The mistake stays; this says what was actually true. */
  | 'corrected';

export const ACTION_LABEL: Record<CustodyAction, string> = {
  collected: 'Collected',
  booked: 'Booked in',
  moved: 'Moved',
  checkedOut: 'Signed out',
  checkedIn: 'Signed back in',
  released: 'Released',
  destroyed: 'Destroyed',
  audited: 'Checked on the shelf',
  corrected: 'Correction',
};

/** Where it went, which decides whether it is still ours. */
export type CustodyParty =
  | 'scene'
  | 'storage'
  | 'officer'
  | 'lab'
  | 'court'
  | 'owner'
  | 'agency'
  | 'destruction';

export interface CustodyEntry extends Linked {
  id: UUID;
  itemId: UUID;
  action: CustodyAction;
  at: string;

  /** Who did it. Always an account, never typed in. */
  actorId: UUID;
  actorName: string;

  /** Who took possession, when it left this agency's hands. */
  toParty: CustodyParty;
  /** Named because a lab or an owner is not an account here. */
  toName: string;

  /** Where it is now, when that changed. */
  location: string;

  /** Why. Required for anything that lets the item leave. */
  reason: string;

  /**
   * A second signature, where policy demands one.
   *
   * On the entry rather than alongside it, so it is inside the hash — a
   * witness that can be added afterwards is not a witness.
   */
  witnessId: UUID | '';
  witnessName: string;
}

export type CustodyDraft = Omit<CustodyEntry, 'id' | 'prevHash' | 'hash'>;

/** Every field, so nothing about a transfer can be changed after the fact. */
const CUSTODY_FINGERPRINT: Fingerprint<Omit<CustodyEntry, 'hash'>> = (entry) => [
  entry.id,
  entry.itemId,
  entry.action,
  entry.at,
  entry.actorId,
  entry.actorName,
  entry.toParty,
  entry.toName,
  entry.location,
  entry.reason,
  entry.witnessId,
  entry.witnessName,
];

/** Appends a sealed entry. Never mutates the input. */
export async function appendCustody(
  chain: CustodyEntry[],
  draft: CustodyDraft,
  id: string,
): Promise<CustodyEntry[]> {
  const sealed = await sealLink({ ...draft, id, prevHash: headHash(chain) }, CUSTODY_FINGERPRINT);
  return [...chain, sealed];
}

export function verifyCustody(chain: CustodyEntry[]): Promise<ChainStatus> {
  return verifyLinks(chain, CUSTODY_FINGERPRINT);
}

/* ------------------------------------------------------------------ */
/* Where it actually is                                                */
/* ------------------------------------------------------------------ */

export type CustodyStatus =
  | 'uncollected'
  | 'inField'
  | 'inStorage'
  | 'signedOut'
  | 'released'
  | 'destroyed';

export const STATUS_LABEL: Record<CustodyStatus, string> = {
  uncollected: 'Not yet collected',
  inField: 'With the collecting officer',
  inStorage: 'In the property room',
  signedOut: 'Signed out',
  released: 'Released',
  destroyed: 'Destroyed',
};

export interface CustodyState {
  status: CustodyStatus;
  /** Who has it right now, in words somebody can act on. */
  holder: string;
  location: string;
  /** When it entered this state. */
  since: string;
  /** True once it has left for good — nothing further should be possible. */
  closed: boolean;
}

/**
 * Where an item is, computed from its ledger and nowhere else.
 *
 * This is the whole reason the ledger exists. Anything that stored the answer
 * separately would eventually disagree with the entries, and the entries are
 * what a court will read.
 */
export function custodyState(chain: CustodyEntry[]): CustodyState {
  const last = chain[chain.length - 1];
  if (!last) {
    return {
      status: 'uncollected',
      holder: '',
      location: '',
      since: '',
      closed: false,
    };
  }

  // The most recent entry that says where the thing physically is. A shelf
  // check or a correction records something true without moving it.
  const positioning = [...chain]
    .reverse()
    .find((entry) => entry.action !== 'audited' && entry.action !== 'corrected');
  const at = positioning ?? last;

  const status: CustodyStatus =
    at.action === 'released'
      ? 'released'
      : at.action === 'destroyed'
        ? 'destroyed'
        : at.action === 'checkedOut'
          ? 'signedOut'
          : at.action === 'collected'
            ? 'inField'
            : 'inStorage';

  const closed = status === 'released' || status === 'destroyed';

  return {
    status,
    holder: closed || status === 'signedOut' || status === 'inField' ? holderOf(at) : '',
    // A shelf check confirms the location, so let it refresh what is shown.
    location: lastLocation(chain) || at.location,
    since: at.at,
    closed,
  };
}

function holderOf(entry: CustodyEntry): string {
  return entry.toName || entry.actorName;
}

function lastLocation(chain: CustodyEntry[]): string {
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    if (chain[i].location) return chain[i].location;
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* What the next entry may be                                          */
/* ------------------------------------------------------------------ */

export interface TransitionCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Whether an action makes sense from where the item is now.
 *
 * Stated as data because the rules are small and the failure mode of getting
 * them wrong is a ledger that reads as nonsense — an item signed out twice, or
 * released after it was destroyed.
 */
const ALLOWED_FROM: Record<CustodyAction, CustodyStatus[]> = {
  collected: ['uncollected'],
  booked: ['inField', 'signedOut'],
  moved: ['inStorage'],
  checkedOut: ['inStorage'],
  checkedIn: ['signedOut'],
  released: ['inStorage', 'signedOut'],
  destroyed: ['inStorage'],
  audited: ['inStorage', 'signedOut', 'inField'],
  corrected: ['uncollected', 'inField', 'inStorage', 'signedOut', 'released', 'destroyed'],
};

export function canRecord(
  action: CustodyAction,
  item: Pick<EvidenceItem, 'category' | 'holdReason'>,
  chain: CustodyEntry[],
  witnessed = false,
): TransitionCheck {
  const state = custodyState(chain);

  if (state.closed && action !== 'corrected') {
    return {
      ok: false,
      reason: `This item was ${state.status === 'destroyed' ? 'destroyed' : 'released'}. Its chain is finished — a mistake is fixed with a correction, not by reopening it.`,
    };
  }

  if (!ALLOWED_FROM[action].includes(state.status)) {
    return {
      ok: false,
      reason: `It is ${STATUS_LABEL[state.status].toLowerCase()}, so "${ACTION_LABEL[action]}" does not follow from here.`,
    };
  }

  const leavingForGood = action === 'released' || action === 'destroyed';

  if (leavingForGood && item.holdReason) {
    return {
      ok: false,
      reason: `There is a hold on this item: ${item.holdReason}. Lift the hold before disposing of it.`,
    };
  }

  if (leavingForGood && TWO_PERSON_CATEGORIES.includes(item.category) && !witnessed) {
    return {
      ok: false,
      reason: `${CATEGORY_LABEL[item.category]} needs a second person to witness disposal. Nobody should be able to sign a firearm, drugs or cash out of the building alone.`,
    };
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* What the property room needs to look at                             */
/* ------------------------------------------------------------------ */

export type FindingKind = 'brokenChain' | 'outTooLong' | 'neverBooked' | 'overdue' | 'unaudited';

export interface Finding {
  kind: FindingKind;
  itemId: UUID;
  tagNumber: string;
  title: string;
  detail: string;
  severity: 'critical' | 'warning';
}

/** Signed out this long without coming back is worth asking about. */
export const OUT_TOO_LONG_DAYS = 30;
/** Collected but never booked into the room. The classic one. */
export const NEVER_BOOKED_DAYS = 3;
/** An item nobody has laid eyes on in this long fails an inventory. */
export const UNAUDITED_DAYS = 365;

const daysBetween = (from: string, to: Date): number => {
  const start = new Date(from).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.floor((to.getTime() - start) / 86_400_000);
};

/**
 * Everything about one item that a property clerk should be told.
 *
 * The point of an evidence system is not that it stores things — a spreadsheet
 * stores things. It is that it notices: the item signed out in March that never
 * came back, the bag collected on Friday that never reached the room, the case
 * closed two years ago whose contents are still on the shelf.
 */
export function findingsFor(
  item: EvidenceItem,
  chain: CustodyEntry[],
  options: { now?: Date; chainIntact?: boolean } = {},
): Finding[] {
  const now = options.now ?? new Date();
  const state = custodyState(chain);
  const found: Finding[] = [];

  const add = (
    kind: FindingKind,
    severity: Finding['severity'],
    title: string,
    detail: string,
  ) => found.push({ kind, severity, itemId: item.id, tagNumber: item.tagNumber, title, detail });

  if (options.chainIntact === false) {
    add(
      'brokenChain',
      'critical',
      'The custody record does not verify',
      'An entry has been altered or removed since it was written. Nothing on this shelf matters more than finding out how.',
    );
  }

  if (state.status === 'signedOut') {
    const out = daysBetween(state.since, now);
    if (out >= OUT_TOO_LONG_DAYS) {
      add(
        'outTooLong',
        'warning',
        `Signed out for ${out} days`,
        `${state.holder || 'Somebody'} has had this since ${state.since.slice(0, 10)}. Ask for it back or record why it is still out.`,
      );
    }
  }

  if (state.status === 'inField') {
    const held = daysBetween(state.since, now);
    if (held >= NEVER_BOOKED_DAYS) {
      add(
        'neverBooked',
        'critical',
        `Collected ${held} days ago and never booked in`,
        'It was picked up and the chain stops there. Until it is booked, nobody can say where it is.',
      );
    }
  }

  if (!state.closed && item.disposalDueAt && !item.holdReason) {
    if (new Date(item.disposalDueAt).getTime() <= now.getTime()) {
      add(
        'overdue',
        'warning',
        'Due for disposal',
        `It could have been dealt with on ${item.disposalDueAt.slice(0, 10)}. A room full of items nobody disposed of is how a property room runs out of room.`,
      );
    }
  }

  if (state.status === 'inStorage') {
    const lastSeen = [...chain].reverse().find((e) => e.action === 'audited' || e.action === 'booked');
    if (lastSeen && daysBetween(lastSeen.at, now) >= UNAUDITED_DAYS) {
      add(
        'unaudited',
        'warning',
        'Not laid eyes on in over a year',
        'Nobody has confirmed this is on its shelf since ' + lastSeen.at.slice(0, 10) + '.',
      );
    }
  }

  return found;
}

/* ------------------------------------------------------------------ */
/* Tag numbers                                                         */
/* ------------------------------------------------------------------ */

/**
 * `2026-004217` — the year, then a number that never repeats within it.
 *
 * Agency-wide rather than per-case on purpose: the tag is what is written on
 * the bag and read off a shelf, and two items in different cases sharing a
 * number is exactly the confusion the number exists to prevent.
 */
export function nextTagNumber(existing: string[], now = new Date()): string {
  const year = now.getFullYear();
  const prefix = `${year}-`;
  const used = existing
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => Number(tag.slice(prefix.length)))
    .filter((n) => Number.isFinite(n));
  const next = (used.length > 0 ? Math.max(...used) : 0) + 1;
  return `${prefix}${String(next).padStart(6, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface Problem {
  field: string;
  message: string;
  tip?: string;
}

export function checkItem(item: EvidenceItem): Problem[] {
  const problems: Problem[] = [];

  if (!item.description.trim()) {
    problems.push({
      field: 'description',
      message: 'Say what it is.',
      tip: 'Enough for somebody who has never seen it to pick it off a shelf: "black folding knife, 3in blade", not "knife".',
    });
  }

  if (!item.foundAt.trim()) {
    problems.push({
      field: 'foundAt',
      message: 'Say where it was found.',
      tip: 'Where it physically was — "driver footwell", "under the till" — which is the question asked in court, not the case address.',
    });
  }

  if (item.category === 'firearm' && !item.serialNumber.trim()) {
    problems.push({
      field: 'serialNumber',
      message: 'A firearm needs its serial number, or a note that it has none.',
      tip: 'It is how the weapon is traced. If the serial is obliterated or absent, write that here rather than leaving it blank.',
    });
  }

  if (item.category === 'drug' && !item.quantity.trim()) {
    problems.push({
      field: 'quantity',
      message: 'Record the weight or count.',
      tip: 'Weighed and witnessed at booking. The quantity charged is read off this, and it cannot be established later.',
    });
  }

  return problems;
}

export function checkCustody(draft: CustodyDraft): Problem[] {
  const problems: Problem[] = [];
  const needsReason: CustodyAction[] = ['checkedOut', 'released', 'destroyed', 'corrected'];

  if (needsReason.includes(draft.action) && !draft.reason.trim()) {
    problems.push({
      field: 'reason',
      message: 'Say why.',
      tip: 'This line is read back years later by somebody deciding whether the item is still trustworthy. "Court" is not an answer; "State exhibit 4, trial 3 Nov" is.',
    });
  }

  if ((draft.action === 'booked' || draft.action === 'moved') && !draft.location.trim()) {
    problems.push({
      field: 'location',
      message: 'Say where it is going.',
      tip: 'Down to the shelf or bin, so somebody can walk to it: "Room 2 · Shelf C · Bin 14".',
    });
  }

  if (draft.action === 'released' && !draft.toName.trim()) {
    problems.push({
      field: 'toName',
      message: 'Say who took it.',
      tip: 'The person or organisation that signed for it. "Released" with nobody named is the gap every defence attorney looks for.',
    });
  }

  return problems;
}
