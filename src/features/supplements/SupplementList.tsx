import { useState } from 'react';
import { ArrowRight, FilePlus2, Layers, Loader2, Lock } from 'lucide-react';
import { useStore } from '@/state/store';
import {
  SUPPLEMENT_TYPE_LABEL,
  supplementLabel,
  type Supplement,
} from '@/domain/supplement';
import { STATUS_LABEL } from '@/domain/review';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/format';
import type { ReportStatus } from '@/domain/types';

const TONE: Record<ReportStatus, 'neutral' | 'accent' | 'ok' | 'warn'> = {
  draft: 'neutral',
  pending_review: 'accent',
  approved: 'ok',
  returned: 'warn',
};

/**
 * The follow-ups on a case.
 *
 * Shown on the report itself rather than somewhere separate, because the
 * question "what has happened on this since?" is asked while looking at the
 * report, and a case file split across two screens is how information gets
 * missed.
 */
export function SupplementList() {
  const { caseSupplements, canAddSupplement, startSupplement, openSupplement, incident } =
    useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!incident) return null;

  const start = async () => {
    setBusy(true);
    setError(null);
    const result = await startSupplement();
    setBusy(false);
    if (!result.ok) setError(result.reason ?? 'Could not start it.');
  };

  return (
    <Panel
      title={`Supplements (${caseSupplements.length})`}
      description="Anything learned after this report was approved. A supplement never changes the report — it stands beside it."
      aside={<Layers size={17} className="text-faint" aria-hidden />}
    >
      {error && (
        <p className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</p>
      )}

      {caseSupplements.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-muted">
          Nothing yet. A supplement is for what comes later — a lab result, a follow-up interview,
          an arrest, a change in how the case stands.
        </p>
      ) : (
        <ul className="space-y-2">
          {caseSupplements.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => openSupplement(s.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-line bg-canvas px-3 py-2.5 text-left transition hover:border-line-strong"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[13px] font-semibold text-ink">
                      {supplementLabel(s)}
                    </span>
                    <Badge tone={TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                    {s.disposition && <Badge tone="warn">Changes case status</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-[12.5px] text-muted">
                    {SUPPLEMENT_TYPE_LABEL[s.type]} · {s.reportingOfficer || 'Unassigned'} ·{' '}
                    {relativeTime(s.updatedAt)}
                  </p>
                </div>
                <ArrowRight size={15} className="shrink-0 text-faint" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-line pt-3">
        {canAddSupplement.ok ? (
          <Button variant="primary" onClick={() => void start()} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <FilePlus2 size={15} aria-hidden />}
            Add a supplement
          </Button>
        ) : (
          /*
            Not an error state. A report that has not been approved yet is
            simply not the kind of thing a supplement hangs from, and the
            message says what to do instead.
          */
          <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted">
            <Lock size={14} className="mt-0.5 shrink-0 text-faint" aria-hidden />
            {canAddSupplement.reason}
          </p>
        )}
      </div>
    </Panel>
  );
}

export function supplementSummary(s: Supplement): string {
  return `${supplementLabel(s)} · ${SUPPLEMENT_TYPE_LABEL[s.type]}`;
}
