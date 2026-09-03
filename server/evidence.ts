/**
 * Property and evidence routes.
 *
 * The unusual thing here is the ledger. Every other collection in this system
 * is a document that gets updated; a chain of custody is a list that only ever
 * grows, and the routes are shaped so that is the only thing they can do —
 * there is no endpoint that edits or deletes a custody entry, and the table it
 * lives in has no update path.
 *
 * Derived state is computed here rather than stored. The list endpoint sends
 * each item with where it is and what is wrong with it, because a property
 * clerk's screen is a queue of problems, and every client working that out for
 * itself would be three implementations of the same rules.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, documents } from './db';
import { newId } from './ids';
import { requireAuth, requirePermission } from './auth';
import { can } from '../src/domain/auth';
import { recordAudit } from './audit';
import {
  ACTION_LABEL,
  TWO_PERSON_CATEGORIES,
  appendCustody,
  canRecord,
  checkCustody,
  checkItem,
  custodyState,
  findingsFor,
  nextTagNumber,
  verifyCustody,
  type CustodyAction,
  type CustodyDraft,
  type CustodyEntry,
  type CustodyParty,
  type EvidenceCategory,
  type EvidenceItem,
} from '../src/domain/evidence';

const evidence = documents<EvidenceItem>(DOC_TABLES.evidence);

const CATEGORIES: EvidenceCategory[] = [
  'general', 'firearm', 'ammunition', 'drug', 'currency',
  'biological', 'digital', 'document', 'vehicle', 'hazardous',
];
const ACTIONS: CustodyAction[] = [
  'collected', 'booked', 'moved', 'checkedOut', 'checkedIn',
  'released', 'destroyed', 'audited', 'corrected',
];
const PARTIES: CustodyParty[] = [
  'scene', 'storage', 'officer', 'lab', 'court', 'owner', 'agency', 'destruction',
];

/**
 * Which actions the property room owns, and which are ordinary police work.
 *
 * An officer seizes a knife and books it in; that is the job. Deciding where it
 * lives, confirming it is still on the shelf, and signing it out of the
 * building for good is the clerk's.
 */
const CLERK_ONLY: CustodyAction[] = ['moved', 'released', 'destroyed', 'audited', 'corrected'];

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);

/* ------------------------------------------------------------------ */
/* The ledger                                                          */
/* ------------------------------------------------------------------ */

function chainFor(db: DatabaseSync, itemId: string): CustodyEntry[] {
  const rows = db
    .prepare('SELECT doc FROM custody WHERE item_id = ? ORDER BY seq')
    .all(itemId) as { doc: string }[];
  return rows.map((row) => JSON.parse(row.doc) as CustodyEntry);
}

/** Appends one sealed entry. There is deliberately no counterpart to this. */
function writeCustody(db: DatabaseSync, entry: CustodyEntry, seq: number): void {
  db.prepare('INSERT INTO custody (id, item_id, at, seq, doc) VALUES (?, ?, ?, ?, ?)').run(
    entry.id,
    entry.itemId,
    entry.at,
    seq,
    JSON.stringify(entry),
  );
}

async function record(
  db: DatabaseSync,
  itemId: string,
  draft: CustodyDraft,
): Promise<CustodyEntry> {
  const chain = chainFor(db, itemId);
  const appended = await appendCustody(chain, draft, newId('cus'));
  const entry = appended[appended.length - 1];
  writeCustody(db, entry, chain.length);
  return entry;
}

/* ------------------------------------------------------------------ */

export function registerEvidenceRoutes(app: Express, db: DatabaseSync): void {
  /**
   * Every item, with where it is and what is wrong with it.
   *
   * The chain itself is not sent — a property room holds tens of thousands of
   * entries and a screen needs none of them until somebody opens an item. What
   * it does send is the derived state, computed from the chain here so that
   * every client agrees about where a thing is.
   */
  app.get('/api/evidence', requireAuth, (_req: Request, res: Response) => {
    const items = evidence.all(db);
    const summaries = items.map((item) => {
      const chain = chainFor(db, item.id);
      return {
        item,
        state: custodyState(chain),
        entries: chain.length,
        findings: findingsFor(item, chain),
      };
    });
    res.json({ evidence: summaries });
  });

  /** One item, its whole chain, and whether that chain still verifies. */
  app.get('/api/evidence/:id', requireAuth, async (req: Request, res: Response) => {
    const item = evidence.find(db, req.params.id);
    if (!item) {
      res.status(404).json({ error: 'No such item.' });
      return;
    }
    const chain = chainFor(db, item.id);
    const integrity = await verifyCustody(chain);
    res.json({
      item,
      chain,
      integrity,
      state: custodyState(chain),
      findings: findingsFor(item, chain, { chainIntact: integrity.intact }),
    });
  });

  /**
   * Books a new item in.
   *
   * Creates the item and its first custody entry together, in one transaction.
   * An item with no chain is an item nobody can account for, and the moment
   * between the two writes is exactly where that would come from.
   */
  app.post('/api/evidence', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const body = req.body ?? {};
    const at = new Date().toISOString();

    const category: EvidenceCategory = CATEGORIES.includes(body.category)
      ? body.category
      : 'general';

    const item: EvidenceItem = {
      id: newId('ev'),
      tagNumber: nextTagNumber(evidence.columnValues(db, 'tag_number')),
      caseId: text(body.caseId, 64),
      caseNumber: text(body.caseNumber, 40),
      propertyItemId: text(body.propertyItemId, 64),
      category,
      description: text(body.description, 500),
      quantity: text(body.quantity, 60),
      make: text(body.make, 60),
      model: text(body.model, 60),
      serialNumber: text(body.serialNumber, 80),
      foundAt: text(body.foundAt, 300),
      holdReason: '',
      disposalDueAt: text(body.disposalDueAt, 30),
      createdAt: at,
      createdBy: user.id,
      updatedAt: at,
    };

    const problems = checkItem(item);
    if (problems.length > 0) {
      res.status(400).json({ error: problems[0].message, problems });
      return;
    }

    const collectedAt = text(body.collectedAt, 40) || at;
    const location = text(body.location, 200);

    const signer = { actorId: user.id, actorName: user.name, witnessId: '', witnessName: '' };

    /*
      Hashing happens before the transaction opens, not inside it.

      `node:sqlite` is synchronous but sealing an entry is not, and an `await`
      between BEGIN and COMMIT hands the event loop to the next request — which
      then tries to open its own transaction inside this one and fails. So the
      chain is built first and the transaction contains nothing but the writes.
    */
    // The chain starts in the field, with whoever picked the thing up.
    let chain = await appendCustody([], {
      ...signer,
      itemId: item.id,
      action: 'collected',
      at: collectedAt,
      toParty: 'scene',
      toName: '',
      location: item.foundAt,
      reason: '',
    }, newId('cus'));

    // Booked straight in when a shelf was given, which is the common case: an
    // officer bagging property at the end of a shift does both at once.
    if (location) {
      chain = await appendCustody(chain, {
        ...signer,
        itemId: item.id,
        action: 'booked',
        at,
        toParty: 'storage',
        toName: '',
        location,
        reason: '',
      }, newId('cus'));
    }

    db.exec('BEGIN');
    try {
      evidence.save(db, item);
      chain.forEach((entry, seq) => writeCustody(db, entry, seq));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      console.error('Booking evidence failed', error);
      res.status(500).json({ error: 'Could not book it in, and nothing was written.' });
      return;
    }

    await recordAudit(db, {
      actorId: user.id,
      actorName: user.name,
      action: 'evidence.booked',
      target: item.tagNumber,
      detail: [item.category, item.description].filter(Boolean).join(' · '),
    });

    res.json({ item, chain, state: custodyState(chain) });
  });

  /** Adds one entry to a chain. The only way anything about custody changes. */
  app.post('/api/evidence/:id/custody', requireAuth, async (req: Request, res: Response) => {
    const user = req.user!;
    const item = evidence.find(db, req.params.id);
    if (!item) {
      res.status(404).json({ error: 'No such item.' });
      return;
    }

    const body = req.body ?? {};
    const action: CustodyAction | undefined = ACTIONS.includes(body.action)
      ? body.action
      : undefined;
    if (!action) {
      res.status(400).json({ error: 'Unknown custody action.' });
      return;
    }

    if (CLERK_ONLY.includes(action) && !can(user, 'evidence.manage')) {
      res.status(403).json({
        error: `"${ACTION_LABEL[action]}" is the property room's to record. Ask a records clerk.`,
      });
      return;
    }

    /*
      The witness is an account, resolved here, never a name typed into a box.
      A second signature that one person can write on their own is not a second
      signature.
    */
    const witnessId = text(body.witnessId, 64);
    const witness = witnessId ? db
      .prepare('SELECT id, name FROM users WHERE id = ? AND active = 1')
      .get(witnessId) as { id: string; name: string } | undefined : undefined;

    if (witnessId && !witness) {
      res.status(400).json({ error: 'That witness is not an active account here.' });
      return;
    }
    if (witness && witness.id === user.id) {
      res.status(400).json({
        error: 'The witness has to be somebody else. That is the whole point of a witness.',
      });
      return;
    }

    const draft: CustodyDraft = {
      itemId: item.id,
      action,
      at: new Date().toISOString(),
      actorId: user.id,
      actorName: user.name,
      toParty: PARTIES.includes(body.toParty) ? body.toParty : 'storage',
      toName: text(body.toName, 160),
      location: text(body.location, 200),
      reason: text(body.reason, 500),
      witnessId: witness?.id ?? '',
      witnessName: witness?.name ?? '',
    };

    const problems = checkCustody(draft);
    if (problems.length > 0) {
      res.status(400).json({ error: problems[0].message, problems });
      return;
    }

    const chain = chainFor(db, item.id);
    const allowed = canRecord(action, item, chain, Boolean(witness));
    if (!allowed.ok) {
      res.status(409).json({ error: allowed.reason });
      return;
    }

    const entry = await record(db, item.id, draft);

    /*
      An item leaving the building for good is an audit event in its own right,
      not just a line in its own ledger. Somebody reviewing what the agency
      destroyed last quarter should not have to open every item to find out.
    */
    if (action === 'released' || action === 'destroyed') {
      await recordAudit(db, {
        actorId: user.id,
        actorName: user.name,
        action: action === 'released' ? 'evidence.released' : 'evidence.destroyed',
        target: item.tagNumber,
        detail: [
          draft.toName || draft.toParty,
          draft.reason,
          witness ? `witnessed by ${witness.name}` : 'no witness',
        ]
          .filter(Boolean)
          .join(' · '),
      });
    }

    const updated = chainFor(db, item.id);
    res.json({ entry, chain: updated, state: custodyState(updated) });
  });

  /**
   * Changes what the item *is*, never where it has been.
   *
   * Description, serial number, the hold and the disposal date. Nothing here
   * can touch the chain, which is why it is a different endpoint from the one
   * above and not a general update.
   */
  app.patch(
    '/api/evidence/:id',
    requirePermission('evidence.manage'),
    async (req: Request, res: Response) => {
      const user = req.user!;
      const item = evidence.find(db, req.params.id);
      if (!item) {
        res.status(404).json({ error: 'No such item.' });
        return;
      }

      const body = req.body ?? {};
      const updated: EvidenceItem = {
        ...item,
        description: body.description === undefined ? item.description : text(body.description, 500),
        quantity: body.quantity === undefined ? item.quantity : text(body.quantity, 60),
        make: body.make === undefined ? item.make : text(body.make, 60),
        model: body.model === undefined ? item.model : text(body.model, 60),
        serialNumber:
          body.serialNumber === undefined ? item.serialNumber : text(body.serialNumber, 80),
        holdReason: body.holdReason === undefined ? item.holdReason : text(body.holdReason, 300),
        disposalDueAt:
          body.disposalDueAt === undefined ? item.disposalDueAt : text(body.disposalDueAt, 30),
        updatedAt: new Date().toISOString(),
      };

      const problems = checkItem(updated);
      if (problems.length > 0) {
        res.status(400).json({ error: problems[0].message, problems });
        return;
      }

      evidence.save(db, updated);

      // A hold going on or coming off decides whether evidence can be
      // destroyed, so it is worth its own line in the agency's audit log.
      if (updated.holdReason !== item.holdReason) {
        await recordAudit(db, {
          actorId: user.id,
          actorName: user.name,
          action: 'evidence.holdChanged',
          target: item.tagNumber,
          detail: updated.holdReason ? `hold placed: ${updated.holdReason}` : 'hold lifted',
        });
      }

      res.json({ item: updated });
    },
  );

  /** Who may witness a disposal — everybody but the person doing it. */
  app.get('/api/evidence/meta/witnesses', requireAuth, (req: Request, res: Response) => {
    const rows = db
      .prepare('SELECT id, name, badge FROM users WHERE active = 1 AND id != ? ORDER BY name')
      .all(req.user!.id) as { id: string; name: string; badge: string }[];
    res.json({ witnesses: rows, twoPersonCategories: TWO_PERSON_CATEGORIES });
  });
}
