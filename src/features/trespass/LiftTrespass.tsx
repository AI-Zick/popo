import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, TriangleAlert } from 'lucide-react';
import { api } from '@/state/api';
import { checkLift, trespassStanding, type Trespass } from '@/domain/trespass';
import { Button } from '@/components/ui/primitives';

/**
 * Lifting a notice before it runs out.
 *
 * Deliberately a stop-and-think rather than a button that just works. Lifting
 * is undoing a property owner's instruction, and the officer who arrests
 * somebody an hour later on a notice that was quietly withdrawn has been let
 * down by whoever made this easy.
 *
 * A notice reaching its end date needs none of this. That is a date, not a
 * decision, and nothing here runs for it.
 */
export function LiftTrespass({
  trespass,
  who,
  where,
  onClose,
  onLifted,
}: {
  trespass: Trespass;
  who: string;
  where: string;
  onClose: () => void;
  onLifted: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = checkLift(reason);

  const submit = async () => {
    if (!check.ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.liftTrespass(trespass.id, reason.trim());
      onLifted();
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
      aria-label="Lift this trespass notice"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl">
        <h2 className="text-[15px] font-semibold text-ink">Lift this notice</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          {who} is barred from {where}. {trespassStanding(trespass)}
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-faint">
          Lifting it stops it being in force from now on. The notice stays on both records, with
          your name and this reason against it — an officer reading this next month needs to know
          it existed and why it ended.
        </p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink">Why is it being lifted?</span>
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="The store manager withdrew it in person this morning."
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
            Leave it in force
          </Button>
          <Button
            variant="primary"
            disabled={busy || !check.ok}
            title={check.ok ? undefined : check.reason}
            onClick={() => void submit()}
          >
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
            Lift it
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
