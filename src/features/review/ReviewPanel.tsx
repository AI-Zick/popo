import { useState } from 'react';
import { Check, CornerUpLeft, History, Loader2, MessageSquarePlus, Plus, X } from 'lucide-react';
import { useStore } from '@/state/store';
import { canReopen, canReview, REVIEW_ACTION_LABEL } from '@/domain/review';
import { SECTION_LABEL, SECTION_ORDER, type SectionId } from '@/domain/types';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * The reviewer's side of a report.
 *
 * Approving is one click. Returning deliberately is not: it asks for a reason
 * and lets the supervisor pin notes to specific sections, because "do it again"
 * costs an officer a shift and "the victim's date of birth is missing" costs
 * them a minute.
 */
export function ReviewPanel() {
  const { incident, currentUser, approveReport, returnReport, reopenReport } = useStore();
  const [mode, setMode] = useState<'idle' | 'approve' | 'return'>('idle');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [comments, setComments] = useState<{ section: SectionId; message: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!incident) return null;

  const check = canReview(currentUser, incident);
  const reopen = canReopen(currentUser, incident.status);
  if (!check.ok && !reopen.ok) return null;

  const run = async (action: () => Promise<{ ok: boolean; reason?: string }>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      setMode('idle');
      setNote('');
      setReason('');
      setComments([]);
    } else {
      setError(result.reason ?? 'That did not work.');
    }
  };

  return (
    <Panel
      title="Supervisor review"
      description={
        check.ok
          ? 'Approve it, or send it back with what needs fixing.'
          : (reopen.reason ?? check.reason)
      }
      aside={<Badge tone="accent">Reviewer</Badge>}
    >
      {error && (
        <p className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</p>
      )}

      {reopen.ok && (
        <ReopenForm busy={busy} onReopen={(why) => run(() => reopenReport(why))} />
      )}

      {check.ok && mode === 'idle' && (
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => setMode('approve')}>
            <Check size={15} aria-hidden />
            Approve
          </Button>
          <Button onClick={() => setMode('return')}>
            <CornerUpLeft size={15} aria-hidden />
            Return for correction
          </Button>
        </div>
      )}

      {check.ok && mode === 'approve' && (
        <div className="rounded-xl border border-ok/30 bg-ok-soft p-4">
          <p className="text-[13px] font-medium text-ink">Approve this report</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            It becomes part of the record and stops being editable. You can reopen it later if
            something turns out to be wrong.
          </p>
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note"
            className="mt-3 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px] text-ink placeholder:text-faint"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" onClick={() => setMode('idle')}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => void run(() => approveReport(note.trim()))}
            >
              {busy && <Loader2 size={13} className="animate-spin" aria-hidden />}
              Approve
            </Button>
          </div>
        </div>
      )}

      {check.ok && mode === 'return' && (
        <ReturnForm
          reason={reason}
          setReason={setReason}
          comments={comments}
          setComments={setComments}
          busy={busy}
          onCancel={() => setMode('idle')}
          onSubmit={() =>
            void run(() =>
              returnReport(
                reason.trim(),
                comments
                  .filter((c) => c.message.trim())
                  .map((c) => ({ path: c.section, section: c.section, message: c.message.trim() })),
              ),
            )
          }
        />
      )}

      {(incident.reviewHistory?.length ?? 0) > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-faint">
            <History size={12} aria-hidden />
            Review history
          </p>
          <ul className="mt-2 space-y-1.5">
            {[...incident.reviewHistory].reverse().map((entry) => (
              <li key={entry.id} className="text-[12.5px] text-muted">
                <span className="font-medium text-ink">{REVIEW_ACTION_LABEL[entry.action]}</span> by{' '}
                {entry.actorName} · {relativeTime(entry.at)}
                {entry.note && <span className="block text-[12px] text-faint">“{entry.note}”</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function ReturnForm({
  reason,
  setReason,
  comments,
  setComments,
  busy,
  onCancel,
  onSubmit,
}: {
  reason: string;
  setReason: (v: string) => void;
  comments: { section: SectionId; message: string }[];
  setComments: (v: { section: SectionId; message: string }[]) => void;
  busy: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const control =
    'w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px] text-ink placeholder:text-faint';

  return (
    <div className="rounded-xl border border-warn/35 bg-warn-soft/50 p-4">
      <p className="text-[13px] font-medium text-ink">Send this back</p>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
        Notes you add here land in the officer's report check panel, pinned to the section they
        belong to, so they can jump straight to each one.
      </p>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-[12.5px] text-muted">Reason</span>
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Two things before this can go to the DA."
          className={control}
        />
      </label>

      <div className="mt-3 space-y-2">
        {comments.map((comment, index) => (
          <div key={index} className="flex items-start gap-2">
            <select
              value={comment.section}
              onChange={(e) => {
                const next = [...comments];
                next[index] = { ...comment, section: e.target.value as SectionId };
                setComments(next);
              }}
              className="w-40 shrink-0 rounded-lg border border-line bg-surface px-2 py-2 text-[13px] text-ink"
            >
              {SECTION_ORDER.map((s) => (
                <option key={s} value={s}>
                  {SECTION_LABEL[s]}
                </option>
              ))}
            </select>
            <input
              value={comment.message}
              onChange={(e) => {
                const next = [...comments];
                next[index] = { ...comment, message: e.target.value };
                setComments(next);
              }}
              placeholder="What needs to change"
              className={cn(control, 'flex-1')}
            />
            <button
              type="button"
              onClick={() => setComments(comments.filter((_, i) => i !== index))}
              className="mt-1.5 shrink-0 text-faint transition hover:text-danger"
              aria-label="Remove note"
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>

      <Button
        size="sm"
        className="mt-2"
        onClick={() => setComments([...comments, { section: 'narrative', message: '' }])}
      >
        <Plus size={13} aria-hidden />
        {comments.length === 0 ? 'Add a note to a section' : 'Another note'}
      </Button>

      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={busy || !reason.trim()} onClick={onSubmit}>
          {busy && <Loader2 size={13} className="animate-spin" aria-hidden />}
          <MessageSquarePlus size={13} aria-hidden />
          Return it
        </Button>
      </div>
    </div>
  );
}

function ReopenForm({ busy, onReopen }: { busy: boolean; onReopen: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <CornerUpLeft size={15} aria-hidden />
        Reopen for correction
      </Button>
    );
  }

  return (
    <div className="rounded-xl border border-warn/35 bg-warn-soft/50 p-4">
      <p className="text-[13px] font-medium text-ink">Reopen an approved report</p>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
        It goes back to the officer as returned. The approval stays in the history — it is not
        erased.
      </p>
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why this is being reopened"
        className="mt-3 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px] text-ink placeholder:text-faint"
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={busy || !reason.trim()} onClick={() => onReopen(reason.trim())}>
          Reopen
        </Button>
      </div>
    </div>
  );
}
