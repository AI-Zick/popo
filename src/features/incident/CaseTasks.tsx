import { useMemo, useRef, useState } from 'react';
import { CalendarClock, Check, Plus, Trash2, UserRound } from 'lucide-react';
import { useStore } from '@/state/store';
import { overdueTasks, type CaseTask } from '@/domain/caseTask';
import { Button } from '@/components/ui/primitives';
import { formatDate, relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * What is left to do on this case.
 *
 * Every officer keeps this list already — on a notepad, in a phone, in their
 * head. It is here so it survives a day off, and so a sergeant asking "what is
 * outstanding on the Marion Street burglary" gets an answer without a phone
 * call.
 *
 * It stays writable after the report is approved, which is the whole point:
 * "still waiting on the video from the hardware store" is exactly the item
 * that outlives approval.
 */
export function CaseTasks() {
  const { incident, tasksForCase, addTask, setTaskDone, removeTask, users, currentUser } =
    useStore();

  const [draft, setDraft] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [busy, setBusy] = useState(false);
  /*
    `busy` is state, so it is not true until the next render — two Enters in
    quick succession would both get past a check on it and add the item twice.
    The ref changes on the spot, which is what a guard needs to do.
  */
  const sending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const tasks = incident ? tasksForCase(incident.id) : [];
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const late = useMemo(() => new Set(overdueTasks(tasks).map((t) => t.id)), [tasks]);

  const officers = useMemo(() => users.filter((u) => u.active), [users]);

  if (!incident) return null;

  const submit = async () => {
    const what = draft.trim();
    if (!what || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const result = await addTask(incident.id, { text: what, dueOn, assignedToId });
    sending.current = false;
    setBusy(false);
    if (result.ok) {
      setDraft('');
      setDueOn('');
      setAssignedToId('');
    } else {
      setError(result.reason ?? 'Could not add it.');
    }
  };

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-line bg-canvas">
      <header className="border-b border-line px-4 pb-3 pt-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">To do</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-faint">
          What is left on this case. Not part of the report, and it keeps working after the report
          is approved.
        </p>
      </header>

      {/* ---- Add ------------------------------------------------------- */}
      <div className="border-b border-line px-4 py-3">
        <textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds it; shift-enter is a second line. This is a list of
            // one-liners, and reaching for a button after every one is friction
            // in exactly the place that decides whether the list gets used.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Interview witness 3…"
          className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px] leading-relaxed text-ink placeholder:text-faint"
        />
        <div className="mt-2 flex items-center gap-2">
          <input
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            aria-label="Due date"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink"
          />
          <select
            value={assignedToId}
            onChange={(e) => setAssignedToId(e.target.value)}
            aria-label="Who it is on"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink"
          >
            <option value="">Anyone</option>
            {officers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.id === currentUser.id ? `${u.name} (me)` : u.name}
              </option>
            ))}
          </select>
          <Button variant="primary" size="sm" disabled={busy || !draft.trim()} onClick={() => void submit()}>
            <Plus size={14} aria-hidden />
            Add
          </Button>
        </div>
        {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
      </div>

      {/* ---- The list --------------------------------------------------- */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {open.length === 0 ? (
          <p className="px-2 py-6 text-center text-[13px] leading-relaxed text-muted">
            Nothing outstanding. Anything you are waiting on — a lab result, a business’s camera
            footage, a callback — goes here so the next person picking this up knows about it.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {open.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                late={late.has(task.id)}
                canRemove={task.createdBy === currentUser.id}
                currentUserId={currentUser.id}
                onToggle={() => void setTaskDone(task.id, true)}
                onRemove={() => void removeTask(task.id)}
              />
            ))}
          </ul>
        )}

        {done.length > 0 && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] font-medium text-muted transition hover:bg-surface"
            >
              {showDone ? 'Hide' : 'Show'} {done.length} finished
            </button>
            {showDone && (
              <ul className="mt-1.5 space-y-1.5">
                {done.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    late={false}
                    canRemove={task.createdBy === currentUser.id}
                    currentUserId={currentUser.id}
                    onToggle={() => void setTaskDone(task.id, false)}
                    onRemove={() => void removeTask(task.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function TaskRow({
  task,
  late,
  canRemove,
  currentUserId,
  onToggle,
  onRemove,
}: {
  task: CaseTask;
  late: boolean;
  canRemove: boolean;
  currentUserId: string;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <li
      className={cn(
        'group flex items-start gap-2.5 rounded-lg border bg-surface px-2.5 py-2 transition',
        late ? 'border-warn/45' : 'border-line',
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={task.done}
        onClick={onToggle}
        aria-label={task.done ? `Put back: ${task.text}` : `Tick off: ${task.text}`}
        className={cn(
          'mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded border transition',
          task.done
            ? 'border-ok bg-ok text-white'
            : 'border-line-strong bg-canvas hover:border-accent',
        )}
      >
        {task.done && <Check size={12} strokeWidth={3} aria-hidden />}
      </button>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'whitespace-pre-wrap text-[13px] leading-relaxed',
            task.done ? 'text-faint line-through' : 'text-ink',
          )}
        >
          {task.text}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11.5px] text-faint">
          {task.dueOn && (
            <span className={cn('inline-flex items-center gap-1', late && 'font-medium text-warn')}>
              <CalendarClock size={11} aria-hidden />
              {formatDate(task.dueOn)}
            </span>
          )}
          {task.assignedToName && (
            <span className="inline-flex items-center gap-1">
              <UserRound size={11} aria-hidden />
              for {task.assignedToName}
            </span>
          )}
          {task.done ? (
            <span>
              done by {task.doneByName} · {relativeTime(task.doneAt)}
            </span>
          ) : (
            // Only worth saying when it was somebody else. On your own list,
            // "added by you" on every row is a column of your own name.
            task.createdBy !== currentUserId && <span>added by {task.createdByName}</span>
          )}
        </p>
      </div>

      {/*
        Ticking off is what people mean nine times in ten. Removing is for the
        item typed onto the wrong case, so it stays out of the way until the
        row is under the cursor — and the server refuses it for anyone but the
        author or a supervisor either way.
      */}
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove: ${task.text}`}
          className="shrink-0 rounded p-1 text-faint opacity-0 transition hover:bg-danger-soft hover:text-danger focus:opacity-100 group-hover:opacity-100"
        >
          <Trash2 size={13} aria-hidden />
        </button>
      )}
    </li>
  );
}
