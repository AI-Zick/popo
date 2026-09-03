import { describe, expect, it } from 'vitest';
import {
  createTask,
  describeTasks,
  openTasks,
  overdueTasks,
  sortTasks,
  tasksFor,
  type CaseTask,
} from '../caseTask';

const NOW = new Date('2026-09-03T12:00:00');

function task(partial: Partial<CaseTask> = {}): CaseTask {
  return createTask({ id: 't1', caseId: 'inc-1', text: 'Interview witness 3', ...partial });
}

describe('reading the list', () => {
  it('puts what is left before what is finished', () => {
    const list = sortTasks([
      task({ id: 'done', done: true, doneAt: '2026-09-02T10:00:00.000Z' }),
      task({ id: 'open' }),
    ]);
    expect(list.map((t) => t.id)).toEqual(['open', 'done']);
  });

  it('puts a deadline before no deadline, and the soonest first', () => {
    const list = sortTasks([
      task({ id: 'someday' }),
      task({ id: 'friday', dueOn: '2026-09-11' }),
      task({ id: 'tomorrow', dueOn: '2026-09-04' }),
    ]);
    expect(list.map((t) => t.id)).toEqual(['tomorrow', 'friday', 'someday']);
  });

  it('reads finished items newest first', () => {
    const list = sortTasks([
      task({ id: 'older', done: true, doneAt: '2026-09-01T09:00:00.000Z' }),
      task({ id: 'newer', done: true, doneAt: '2026-09-02T09:00:00.000Z' }),
    ]);
    expect(list.map((t) => t.id)).toEqual(['newer', 'older']);
  });

  it('falls back to the order they were written in', () => {
    const list = sortTasks([
      task({ id: 'second', createdAt: '2026-09-02T09:00:00.000Z' }),
      task({ id: 'first', createdAt: '2026-09-01T09:00:00.000Z' }),
    ]);
    expect(list.map((t) => t.id)).toEqual(['first', 'second']);
  });
});

describe('what is overdue', () => {
  it('does not count today as late', () => {
    expect(overdueTasks([task({ dueOn: '2026-09-03' })], NOW)).toEqual([]);
  });

  it('counts yesterday', () => {
    expect(overdueTasks([task({ dueOn: '2026-09-02' })], NOW)).toHaveLength(1);
  });

  it('leaves a finished item alone however late it was', () => {
    const late = task({ dueOn: '2026-01-01', done: true, doneAt: '2026-09-02T09:00:00.000Z' });
    expect(overdueTasks([late], NOW)).toEqual([]);
  });

  it('ignores an item with no date — someday is not late', () => {
    expect(overdueTasks([task()], NOW)).toEqual([]);
  });
});

describe('the one line a case list shows', () => {
  it('says nothing at all when the list is clear', () => {
    expect(describeTasks([], NOW)).toBe('');
    expect(describeTasks([task({ done: true })], NOW)).toBe('');
  });

  it('counts what is left', () => {
    expect(describeTasks([task(), task({ id: 't2' })], NOW)).toBe('2 to do');
  });

  it('calls out what has gone past its date', () => {
    expect(describeTasks([task(), task({ id: 't2', dueOn: '2026-08-30' })], NOW)).toBe(
      '2 to do · 1 overdue',
    );
  });
});

describe('whose list it is on', () => {
  it('finds one officer’s open items', () => {
    const list = [
      task({ id: 'mine', assignedToId: 'u-reyes' }),
      task({ id: 'theirs', assignedToId: 'u-boone' }),
      task({ id: 'mine-done', assignedToId: 'u-reyes', done: true }),
      task({ id: 'unassigned' }),
    ];
    expect(tasksFor(list, 'u-reyes').map((t) => t.id)).toEqual(['mine']);
  });

  it('does not treat unassigned as everybody’s', () => {
    expect(tasksFor([task()], 'u-reyes')).toEqual([]);
  });
});

describe('what is open', () => {
  it('is everything not ticked off', () => {
    expect(openTasks([task(), task({ id: 't2', done: true })]).map((t) => t.id)).toEqual(['t1']);
  });
});
