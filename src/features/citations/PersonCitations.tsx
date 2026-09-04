import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Loader2, Receipt, TriangleAlert } from 'lucide-react';
import { api } from '@/state/api';
import {
  DISPOSITION_LABEL,
  SOURCE_LABEL,
  STATE_LABEL,
  citationLine,
  citationState,
  isWarningOnly,
  recordingDelayDays,
  sortCitations,
  LATE_ENTRY_DAYS,
  type Citation,
} from '@/domain/citation';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { RecordCitation } from './RecordCitation';

/**
 * Citations issued to one person.
 *
 * Mostly a read: these arrive from the MDT and this is where they surface.
 * The one thing worth showing that a citation list usually does not is *how*
 * each one got here — a ticket keyed in by hand three weeks after it was
 * written is worth a second look, and the gap between the roadside and the
 * record is the first sign that a stack of paper is sitting in a locker.
 */
export function PersonCitations({
  masterId,
  personName,
}: {
  masterId: string;
  personName: string;
}) {
  const [open, setOpen] = useState(false);
  const [citations, setCitations] = useState<Citation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { citations: list } = await api.personCitations(masterId);
      setCitations(sortCitations(list));
    } catch {
      setError('Could not load citations for this person.');
      setCitations([]);
    }
  }, [masterId]);

  useEffect(() => {
    void load();
  }, [load]);

  const live = citations?.filter((c) => citationState(c) !== 'voided') ?? [];

  return (
    <section className="rounded-xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <Receipt size={16} className="text-faint" aria-hidden />
        <span className="text-[14px] font-medium text-ink">Citations</span>
        <span className="text-[13px] text-muted">
          {citations === null && !error ? (
            <Loader2 size={13} className="animate-spin" aria-hidden />
          ) : live.length === 0 ? (
            'None'
          ) : (
            `${live.length}`
          )}
        </span>
        <ChevronDown
          size={15}
          className={cn('ml-auto shrink-0 text-faint transition', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open && (
        <div className="space-y-2 border-t border-line px-4 py-3">
          {error && (
            <p className="flex items-start gap-1.5 text-[12.5px] text-danger">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          {citations?.length === 0 && !error && (
            <p className="text-[13px] text-muted">No citation on file for {personName}.</p>
          )}

          {citations?.map((citation) => {
            const state = citationState(citation);
            const delay = recordingDelayDays(citation);
            return (
              <div
                key={citation.id}
                className={cn('rounded-lg border border-line p-3', state === 'voided' && 'opacity-65')}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13.5px] font-medium text-ink">
                    {citationLine(citation)}
                  </span>
                  <span
                    className={cn(
                      'rounded border px-1.5 py-0.5 text-[11px] uppercase tracking-wide',
                      state === 'voided' ? 'border-line text-muted' : 'border-accent/40 text-accent',
                    )}
                  >
                    {isWarningOnly(citation) ? 'Warning' : STATE_LABEL[state]}
                  </span>
                </div>

                <p className="mt-0.5 font-mono text-[12px] text-faint">
                  {citation.number}
                  <span className="font-sans">
                    {' '}
                    · {citation.issuedAt.slice(0, 10)}
                    {citation.officerName && ` · ${citation.officerName}`}
                  </span>
                </p>

                {citation.disposition && (
                  <p className="mt-1 text-[12.5px] text-muted">
                    Court: {DISPOSITION_LABEL[citation.disposition]}
                  </p>
                )}

                {/*
                  How it got here, and how long it took. Only said when there is
                  something to say — a ticket submitted from the MDT the same
                  day needs no explanation.
                */}
                {(citation.source !== 'mdt' || (delay ?? 0) > LATE_ENTRY_DAYS) && (
                  <p className="mt-1 text-[12px] text-faint">
                    {SOURCE_LABEL[citation.source]}
                    {delay !== null && delay > LATE_ENTRY_DAYS && `, ${delay} days after it was written`}
                  </p>
                )}

                {state === 'voided' && (
                  <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                    Voided {citation.voidedAt.slice(0, 10)}
                    {citation.voidedBy && ` by ${citation.voidedBy}`}: {citation.voidReason}
                  </p>
                )}
              </div>
            );
          })}

          <Button size="sm" onClick={() => setAdding(true)}>
            <Receipt size={13} aria-hidden />
            Record one I issued
          </Button>
        </div>
      )}

      {adding && (
        <RecordCitation
          personId={masterId}
          personName={personName}
          onClose={() => setAdding(false)}
          onRecorded={() => {
            setAdding(false);
            setOpen(true);
            void load();
          }}
        />
      )}
    </section>
  );
}
