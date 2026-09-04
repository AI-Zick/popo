import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Phone, TriangleAlert } from 'lucide-react';
import { api, type WarrantRow } from '@/state/api';
import {
  CONFIRMATION_NOTICE,
  OUTCOME_LABEL,
  checkAttempt,
  headlineCharge,
  type AttemptOutcome,
} from '@/domain/warrant';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * Recording an attempt to serve a warrant.
 *
 * The one outcome that is not like the others is "served", because it closes
 * the warrant. It is the last option and it carries the confirmation notice
 * again — this is the exact moment somebody is about to be arrested on what
 * this system says, and it is the last point at which saying "ring the court
 * first" is any use.
 */

const OUTCOMES: AttemptOutcome[] = [
  'notThere',
  'notHome',
  'refusedEntry',
  'moved',
  'wrongAddress',
  'unsafe',
  'served',
];

export function AttemptService({
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
  const [address, setAddress] = useState('');
  const [outcome, setOutcome] = useState<AttemptOutcome>('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = checkAttempt({ address, outcome });

  const submit = async () => {
    if (!check.ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.attemptWarrant(row.warrant.id, { address: address.trim(), outcome, notes: notes.trim() });
      onDone();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That could not be saved.');
      setBusy(false);
    }
  };

  const field =
    'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[14px] text-ink placeholder:text-faint';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Record an attempt to serve this warrant"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl">
        <h2 className="text-[15px] font-semibold text-ink">Record an attempt</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          {headlineCharge(row.warrant)} — {row.warrant.number}, against {personName}.
        </p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink">Where did you try?</span>
          <input
            autoFocus
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="1142 Ashwood Ln"
            className={field}
          />
        </label>

        <div className="mt-3">
          <span className="mb-1.5 block text-[13px] font-medium text-ink">What happened?</span>
          <div className="flex flex-wrap gap-1.5">
            {OUTCOMES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setOutcome(option)}
                aria-pressed={outcome === option}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-[12.5px] transition',
                  outcome === option
                    ? option === 'served'
                      ? 'border-danger/50 bg-danger/10 text-ink'
                      : 'border-accent/50 bg-accent/10 text-ink'
                    : 'border-line bg-canvas text-muted hover:text-ink',
                )}
              >
                {OUTCOME_LABEL[option]}
              </button>
            ))}
          </div>
        </div>

        {/*
          The last moment before somebody is arrested on what this system says.
          If the notice is anywhere, it is here.
        */}
        {outcome === 'served' && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-danger/45 bg-danger/5 p-3 text-[12.5px] font-medium leading-relaxed text-danger">
            <Phone size={13} className="mt-0.5 shrink-0" aria-hidden />
            {CONFIRMATION_NOTICE} Recording this closes the warrant.
          </p>
        )}

        <label className="mt-3 block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink">
            Anything worth knowing next time{' '}
            <span className="font-normal text-faint">optional</span>
          </span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            placeholder="Mother says he works nights and is there mornings."
            className={field}
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
          <Button
            variant={outcome === 'served' ? 'danger' : 'primary'}
            disabled={busy || !check.ok}
            onClick={() => void submit()}
          >
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
            {outcome === 'served' ? 'Record it as served' : 'Record the attempt'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
