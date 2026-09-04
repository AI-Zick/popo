import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, TriangleAlert } from 'lucide-react';
import { api, type WarrantRow } from '@/state/api';
import { checkRecall, headlineCharge } from '@/domain/warrant';
import { Button } from '@/components/ui/primitives';

/**
 * Taking a warrant out of circulation.
 *
 * The dangerous direction. A warrant wrongly recalled is somebody wanted for a
 * felony who stops appearing on a name check, and nobody finds out until the
 * next time it matters — which is why this needs the authority that
 * withdrawing a location note needs, and why the reason is not optional.
 *
 * The warrant is kept. Recalling it is a fact about the warrant, not the
 * removal of one.
 */
export function RecallWarrant({
  row,
  personName,
  onClose,
  onDone,
}: {
  row: WarrantRow;
  personName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = checkRecall(reason);

  const submit = async () => {
    if (!check.ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.recallWarrant(row.warrant.id, reason.trim());
      onDone();
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
      aria-label="Recall this warrant"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl">
        <h2 className="text-[15px] font-semibold text-ink">Recall this warrant</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          {headlineCharge(row.warrant)} — {row.warrant.number} against {personName}, issued by{' '}
          {row.warrant.court}.
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-warn">
          After this, {personName} stops showing as wanted on this warrant. If that is wrong,
          nobody finds out until the next time it matters — so be sure the court has actually
          quashed it, or that somebody else has served it.
        </p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink">What happened to it?</span>
          <textarea
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder="Quashed by Judge Alvarez on the defendant's appearance this morning."
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[14px] text-ink placeholder:text-faint"
          />
        </label>

        {error && (
          <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-danger">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            Leave it standing
          </Button>
          <Button
            variant="danger"
            disabled={busy || !check.ok}
            title={check.ok ? undefined : check.reason}
            onClick={() => void submit()}
          >
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
            Recall it
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
