import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, Loader2, TriangleAlert } from 'lucide-react';
import { api, type CaseWork } from '@/state/api';
import { checkSuspension, suspensionAdvice } from '@/domain/investigation';
import { Button } from '@/components/ui/primitives';

/**
 * Putting a case on the shelf.
 *
 * Suspending is not closing and it is not clearing — nobody is working it,
 * that is all. The distinction matters because a suspended case is one the
 * victim was told something about, and the agency has to be able to say what.
 *
 * An offence on the always-worked list can still be suspended. Sometimes there
 * genuinely is nothing left. But it takes an account rather than a sentence,
 * and it is marked as having gone against policy on every list afterwards —
 * not to punish anybody, but so that "how many did we shelve" is a question
 * with an answer.
 */
export function SuspendCase({
  caseId,
  work,
  onClose,
  onDone,
}: {
  caseId: string;
  work: CaseWork;
  onClose: () => void;
  onDone: (next: CaseWork) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codes = work.mustBeWorked ? ['11A'] : [];
  const check = checkSuspension(reason, codes);
  const advice = suspensionAdvice(work.investigation.factors, codes);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await api.suspendCase(caseId, reason.trim()));
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
      aria-label="Suspend this case"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl">
        <h2 className="text-[15px] font-semibold text-ink">Suspend {work.caseNumber}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          Nobody will be working it. It is not closed and it is not cleared — it can be picked back
          up by assigning it to somebody.
        </p>

        {work.mustBeWorked && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-danger/45 bg-danger/5 p-3 text-[12.5px] leading-relaxed text-danger">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
            This is an offence the agency works regardless of solvability. Suspending it needs an
            account of what was tried, and it will be marked as against policy.
          </p>
        )}

        {advice && !work.mustBeWorked && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-warn/45 bg-warn/5 p-3 text-[12.5px] leading-relaxed text-warn">
            <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
            {advice}
          </p>
        )}

        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink">
            {work.mustBeWorked ? 'What was tried, and why is there nothing left?' : 'Why is it going on the shelf?'}
          </span>
          <textarea
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={work.mustBeWorked ? 5 : 3}
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[14px] text-ink placeholder:text-faint"
            placeholder={
              work.mustBeWorked
                ? 'Victim declined to proceed after two contacts, no forensic result, named suspect excluded by phone records.'
                : 'No witness, no camera, nothing traceable.'
            }
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
            Keep it open
          </Button>
          <Button variant="primary" disabled={busy || !check.ok} onClick={() => void submit()}>
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
            Suspend it
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
