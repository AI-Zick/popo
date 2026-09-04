import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, TriangleAlert } from 'lucide-react';
import { api, type CaseWork } from '@/state/api';
import { DECISION_LABEL, checkReview, type ReviewDecision } from '@/domain/investigation';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * A supervisor looking at a case again.
 *
 * The decision carries out what it says. A review that records "close it" and
 * leaves the case open is how decisions get made and never acted on, and the
 * gap is only ever found months later by somebody reading the list.
 *
 * "Keep working it" is the option that needs the most typing, on purpose. A
 * review that says nothing moved is a review nobody did, and the whole value
 * of a review cycle is that somebody had to write down what happened.
 */

const DECISIONS: ReviewDecision[] = ['continue', 'reassign', 'suspend', 'close'];

export function ReviewCase({
  caseId,
  onClose,
  onDone,
}: {
  caseId: string;
  onClose: () => void;
  onDone: (next: CaseWork) => void;
}) {
  const [decision, setDecision] = useState<ReviewDecision>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = checkReview(decision, note);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await api.reviewCase(caseId, decision, note.trim()));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That could not be saved.');
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Record a case review"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl">
        <h2 className="text-[15px] font-semibold text-ink">Record a review</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          What is happening with this case. The decision is carried out, not just noted.
        </p>

        <div className="mt-4">
          <span className="mb-1.5 block text-[13px] font-medium text-ink">Decision</span>
          <div className="flex flex-wrap gap-1.5">
            {DECISIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDecision(option)}
                aria-pressed={decision === option}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-[12.5px] transition',
                  decision === option
                    ? option === 'close' || option === 'suspend'
                      ? 'border-warn/60 bg-warn/10 text-ink'
                      : 'border-accent/50 bg-accent/10 text-ink'
                    : 'border-line bg-canvas text-muted hover:text-ink',
                )}
              >
                {DECISION_LABEL[option]}
              </button>
            ))}
          </div>
          {decision === 'close' && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-warn">
              This closes the case here. It does not change how the offence is cleared for the
              state return — that is the disposition on the report.
            </p>
          )}
          {decision === 'suspend' && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
              Recorded as a decision. Use the Suspend button on the panel to put it on the shelf,
              which asks for the account that goes with it.
            </p>
          )}
        </div>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink">
            What has moved since last time?
          </span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="Print comparison came back negative. Waiting on the bank for the card images."
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[14px] text-ink placeholder:text-faint"
          />
        </label>

        {error && (
          <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-danger">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          {!check.ok && <span className="mr-auto text-[12.5px] text-muted">{check.reason}</span>}
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !check.ok} onClick={() => void submit()}>
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
            Record it
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
