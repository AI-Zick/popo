/**
 * Case to-do routes.
 *
 * Small on purpose. There is no review state, no submission and no locking:
 * this is the list an officer keeps on a notepad today, and a list that argues
 * with you is one that goes back on the notepad.
 *
 * Two rules are worth reading:
 *
 * The list works on an approved report. Every other write against a case stops
 * when it is approved; "still waiting on the video from the hardware store" is
 * exactly the item that outlives approval, so this one does not.
 *
 * Ticking an item off is not deleting it. The item keeps who ticked it and
 * when, and only its author or a supervisor can remove it outright — the same
 * line drawn around location notes, for the same reason.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, Response } from 'express';
import { DOC_TABLES, documents } from './db';
import { newId } from './ids';
import { requireAuth } from './auth';
import { can } from '../src/domain/auth';
import { createTask, sortTasks, type CaseTask } from '../src/domain/caseTask';
import type { Incident } from '../src/domain/types';

const tasks = documents<CaseTask>(DOC_TABLES.caseTasks);
const cases = documents<Incident>(DOC_TABLES.incidents);

const text = (value: unknown, max: number): string => String(value ?? '').slice(0, max);

/** A date, or nothing. A half-typed one is nothing, not a date in year 202. */
const day = (value: unknown): string => {
  const raw = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
};

function nameOf(db: DatabaseSync, userId: string): string {
  if (!userId) return '';
  const row = db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as
    | { name: string }
    | undefined;
  return row?.name ?? '';
}

export function registerTaskRoutes(app: Express, db: DatabaseSync): void {
  /** The whole list for one case, in the order somebody would read it. */
  app.get('/api/cases/:caseId/tasks', requireAuth, (req: Request, res: Response) => {
    const list = tasks.where(db, { case_id: text(req.params.caseId, 64) });
    res.json({ tasks: sortTasks(list) });
  });

  app.post('/api/cases/:caseId/tasks', requireAuth, (req: Request, res: Response) => {
    const user = req.user!;
    const caseId = text(req.params.caseId, 64);
    if (!cases.find(db, caseId)) {
      res.status(404).json({ error: 'No such case.' });
      return;
    }

    const body = req.body ?? {};
    const what = text(body.text, 500).trim();
    if (!what) {
      res.status(400).json({ error: 'Say what needs doing.' });
      return;
    }

    const assignedToId = text(body.assignedToId, 64);
    const task = createTask({
      id: newId('tsk'),
      caseId,
      text: what,
      assignedToId,
      assignedToName: nameOf(db, assignedToId),
      dueOn: day(body.dueOn),
      createdBy: user.id,
      createdByName: user.name,
    });

    tasks.save(db, task);
    res.json({ task });
  });

  /**
   * Ticks one off, or puts it back, or edits its wording.
   *
   * Anyone on the case can do any of it. A list where you have to find the
   * right person to tick something off is a list that stays wrong.
   */
  app.patch('/api/tasks/:id', requireAuth, (req: Request, res: Response) => {
    const user = req.user!;
    const current = tasks.find(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: 'No such item.' });
      return;
    }

    const body = req.body ?? {};
    const done = body.done === undefined ? current.done : Boolean(body.done);
    const assignedToId =
      body.assignedToId === undefined ? current.assignedToId : text(body.assignedToId, 64);

    const next: CaseTask = {
      ...current,
      text: body.text === undefined ? current.text : text(body.text, 500).trim() || current.text,
      assignedToId,
      assignedToName:
        assignedToId === current.assignedToId ? current.assignedToName : nameOf(db, assignedToId),
      dueOn: body.dueOn === undefined ? current.dueOn : day(body.dueOn),
      done,
      // Who finished it, kept for as long as it stays finished. Putting an
      // item back clears it, because the old answer is no longer true.
      doneAt: done ? (current.done ? current.doneAt : new Date().toISOString()) : '',
      doneByName: done ? (current.done ? current.doneByName : user.name) : '',
      updatedAt: new Date().toISOString(),
    };

    tasks.save(db, next);
    res.json({ task: next });
  });

  /**
   * Removes one outright.
   *
   * Ticking off is what people mean nine times in ten; this is for the item
   * typed onto the wrong case. Its author or a supervisor, nobody else — the
   * same line drawn around location notes.
   */
  app.delete('/api/tasks/:id', requireAuth, (req: Request, res: Response) => {
    const user = req.user!;
    const current = tasks.find(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: 'No such item.' });
      return;
    }
    if (current.createdBy !== user.id && !can(user, 'reports.approve')) {
      res.status(403).json({
        error: 'Only the person who added this, or a supervisor, can remove it. Tick it off instead.',
      });
      return;
    }

    tasks.remove(db, current.id);
    res.json({ ok: true });
  });
}
