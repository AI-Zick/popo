/**
 * The list of what is left to do on a case.
 *
 * Every officer already keeps one. It lives on a notepad, in a phone, or in
 * their head — "interview witness 3", "still waiting on the video from the
 * hardware store", "call the victim back about the serial number". None of it
 * belongs in the report, because none of it is a fact about the offence, and
 * all of it is lost the moment that officer goes on leave.
 *
 * Two decisions shape this file:
 *
 * It is not part of the report document. An approved report is locked, and
 * "wait for the video footage" is precisely the item that outlives approval.
 * A to-do list that stops working when the report is submitted is a to-do list
 * nobody would trust with the thing they actually need to remember.
 *
 * Nothing here is ever deleted by ticking it off. A done item keeps who ticked
 * it and when, because "did anyone ever get that video?" is a question asked
 * in court, and an empty list is not an answer.
 */

import type { UUID } from './types';

export interface CaseTask {
  id: UUID;
  caseId: UUID;

  /** What needs doing, in the words of whoever needs it done. */
  text: string;

  /**
   * Who it is on.
   *
   * Blank means the case's own officer, which is the usual answer and not
   * worth making anybody choose. A supervisor handing an item to somebody
   * specific is the case worth having the field for.
   */
  assignedToId: UUID | '';
  assignedToName: string;

  /** Date only. An item due at 14:30 is a calendar entry, not a to-do. */
  dueOn: string;

  done: boolean;
  doneAt: string;
  doneByName: string;

  createdBy: UUID;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export function createTask(partial: Partial<CaseTask> = {}): CaseTask {
  const at = partial.createdAt ?? new Date().toISOString();
  return {
    id: '',
    caseId: '',
    text: '',
    assignedToId: '',
    assignedToName: '',
    dueOn: '',
    done: false,
    doneAt: '',
    doneByName: '',
    createdBy: '',
    createdByName: '',
    createdAt: at,
    updatedAt: at,
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* Reading the list                                                    */
/* ------------------------------------------------------------------ */

/**
 * Sorts a list the way somebody picking up the case would want to read it.
 *
 * Open items first, because that is the question being asked. Within those,
 * anything with a date beats anything without — an item with a deadline is an
 * item somebody is waiting on — and the soonest of those comes first. Done
 * items sink to the bottom, most recently finished first, which is the order
 * "what has been happening on this case" wants to be read in.
 */
export function sortTasks(tasks: CaseTask[]): CaseTask[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done) return b.doneAt.localeCompare(a.doneAt);
    if (Boolean(a.dueOn) !== Boolean(b.dueOn)) return a.dueOn ? -1 : 1;
    if (a.dueOn && b.dueOn && a.dueOn !== b.dueOn) return a.dueOn.localeCompare(b.dueOn);
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function openTasks(tasks: CaseTask[]): CaseTask[] {
  return tasks.filter((t) => !t.done);
}

/** Open, dated, and the date has passed. Today is not late. */
export function overdueTasks(tasks: CaseTask[], now = new Date()): CaseTask[] {
  const today = localDay(now);
  return tasks.filter((t) => !t.done && t.dueOn && t.dueOn < today);
}

/**
 * One line for a case list: "3 to do", "3 to do · 1 overdue", or nothing.
 *
 * Returns an empty string when there is nothing open, so a case with a clear
 * list shows no badge at all rather than a reassuring zero nobody reads.
 */
export function describeTasks(tasks: CaseTask[], now = new Date()): string {
  const open = openTasks(tasks).length;
  if (open === 0) return '';
  const late = overdueTasks(tasks, now).length;
  return late > 0 ? `${open} to do · ${late} overdue` : `${open} to do`;
}

/** Only this officer's open items, for a "what is on me" list across cases. */
export function tasksFor(tasks: CaseTask[], userId: string): CaseTask[] {
  return openTasks(tasks).filter((t) => t.assignedToId === userId);
}

/**
 * Today, in the local timezone, as `YYYY-MM-DD`.
 *
 * Not `toISOString().slice(0, 10)`, which is the UTC day: an officer on a
 * night shift west of Greenwich would see items go overdue in the evening.
 */
function localDay(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
