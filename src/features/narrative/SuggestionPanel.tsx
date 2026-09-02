import { useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  Loader2,
  Quote,
  ShieldCheck,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import { useStore } from '@/state/store';
import { SECTION_LABEL } from '@/domain/types';
import type { Confidence, Suggestion } from '@/domain/extraction';
import { Badge, Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * What the narrative says that the report does not.
 *
 * The design constraint is the whole feature: an officer must be able to see,
 * for every suggestion, the words it came from and what it would change,
 * before anything happens. There is no "accept all" and there is no automatic
 * application, because the point at which this becomes dangerous is the point
 * at which a field appears in an evidentiary document that the officer never
 * chose to put there.
 */
export function SuggestionPanel() {
  const {
    suggestions,
    acceptSuggestion,
    dismissSuggestion,
    resetSuggestions,
    dismissedSuggestions,
    acceptedSuggestions,
    showSuggestion,
    undoSuggestion,
    extraction,
    readWithModel,
    reportEditable,
  } = useStore();

  const fresh = suggestions.filter((s) => !s.alreadyPresent);
  const confirmed = suggestions.filter((s) => s.alreadyPresent);

  return (
    <aside className="h-fit rounded-xl border border-line bg-surface">
      <header className="border-b border-line px-4 py-3">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <Sparkles size={15} className="text-accent" aria-hidden />
          Read from your narrative
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          {fresh.length === 0
            ? 'Nothing found that is not already on the report.'
            : `${fresh.length} thing${fresh.length === 1 ? '' : 's'} the narrative says that the report does not.`}
        </p>
      </header>

      {/*
        Said once, at the top, and not buried: this proposes, the officer
        decides. Anyone using the feature should know that without being told
        by a trainer.
      */}
      <p className="flex items-start gap-2 border-b border-line bg-raised px-4 py-2.5 text-[11.5px] leading-relaxed text-muted">
        <ShieldCheck size={13} className="mt-0.5 shrink-0 text-faint" aria-hidden />
        Nothing here is entered for you. Each one shows the words it came from — check them, then
        add it yourself.
      </p>

      <div className="max-h-[28rem] overflow-y-auto p-3">
        {/*
          What was just taken, and where it went. The officer stays on the list
          and can still check or reverse each one — the change is confirmed,
          not hidden.
        */}
        {acceptedSuggestions.length > 0 && (
          <ul className="mb-2 space-y-1.5">
            {acceptedSuggestions.map(({ suggestion }) => (
              <li
                key={suggestion.id}
                className="rounded-lg border border-ok/30 bg-ok-soft px-2.5 py-2"
              >
                <p className="flex items-center gap-1.5 text-[12.5px] text-ink">
                  <Check size={12} className="shrink-0 text-ok" aria-hidden />
                  <span className="min-w-0 truncate font-medium">{suggestion.display}</span>
                </p>
                <p className="mt-0.5 pl-[18px] text-[11.5px] text-muted">
                  Added to {SECTION_LABEL[suggestion.section]}
                </p>
                <div className="mt-1.5 flex gap-3 pl-[18px]">
                  <button
                    type="button"
                    onClick={() => showSuggestion(suggestion.id)}
                    className="flex items-center gap-1 text-[11.5px] font-medium text-accent transition hover:underline"
                  >
                    Show me
                    <ArrowRight size={11} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => undoSuggestion(suggestion.id)}
                    className="flex items-center gap-1 text-[11.5px] text-muted transition hover:text-danger"
                  >
                    <Undo2 size={11} aria-hidden />
                    Undo
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {fresh.length === 0 && confirmed.length === 0 && acceptedSuggestions.length === 0 && (
          <p className="px-1 py-3 text-[12.5px] text-faint">
            Write the narrative and anything it states will show up here.
          </p>
        )}

        <ul className="space-y-2">
          {fresh.map((suggestion) => (
            <SuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              disabled={!reportEditable}
              onAccept={() => acceptSuggestion(suggestion)}
              onDismiss={() => dismissSuggestion(suggestion.id)}
            />
          ))}
        </ul>

        {confirmed.length > 0 && (
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">
              Already on the report
            </p>
            <ul className="mt-1.5 space-y-1">
              {confirmed.map((s) => (
                <li key={s.id} className="flex items-center gap-1.5 text-[12px] text-muted">
                  <Check size={12} className="shrink-0 text-ok" aria-hidden />
                  {s.label}: {s.display}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <footer className="space-y-2 border-t border-line px-3 py-3">
        {extraction.error && (
          <p className="flex items-start gap-1.5 rounded-lg bg-warn-soft px-2.5 py-2 text-[11.5px] leading-relaxed text-ink">
            <CircleAlert size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            {extraction.error}
          </p>
        )}

        {extraction.enabled ? (
          <Button
            size="sm"
            className="w-full"
            disabled={extraction.busy}
            onClick={() => void readWithModel()}
          >
            {extraction.busy ? (
              <Loader2 size={13} className="animate-spin" aria-hidden />
            ) : (
              <Sparkles size={13} aria-hidden />
            )}
            {extraction.busy ? 'Reading…' : 'Read again, more thoroughly'}
          </Button>
        ) : (
          /*
            Not an upsell and not an error. An agency that has not agreed to
            send narratives to a third party is in a perfectly reasonable
            state, and the pattern reader above is still working.
          */
          <p className="rounded-lg bg-raised px-2.5 py-2 text-[11px] leading-relaxed text-faint">
            {extraction.reason ||
              'Deeper reading by a model is switched off for this agency. What you see above is read on this machine.'}
          </p>
        )}

        {dismissedSuggestions.length > acceptedSuggestions.length && (
          <button
            type="button"
            onClick={resetSuggestions}
            className="flex w-full items-center justify-center gap-1.5 text-[11.5px] text-muted transition hover:text-ink"
          >
            <Undo2 size={12} aria-hidden />
            Bring back {dismissedSuggestions.length - acceptedSuggestions.length} dismissed
          </button>
        )}
      </footer>
    </aside>
  );
}

const TONE: Record<Confidence, { label: string; tone: 'ok' | 'accent' | 'neutral' }> = {
  high: { label: 'Clear', tone: 'ok' },
  medium: { label: 'Likely', tone: 'accent' },
  low: { label: 'Check', tone: 'neutral' },
};

function SuggestionCard({
  suggestion,
  disabled,
  onAccept,
  onDismiss,
}: {
  suggestion: Suggestion;
  disabled: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const confidence = TONE[suggestion.confidence];

  return (
    <li className="rounded-lg border border-line bg-canvas p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] text-muted">{suggestion.label}</p>
          <p className="truncate text-[13.5px] font-medium text-ink">{suggestion.display}</p>
        </div>
        <Badge tone={confidence.tone}>{confidence.label}</Badge>
      </div>

      {/* The words it came from. The officer checks this, not the label. */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="mt-1.5 flex w-full items-start gap-1.5 text-left text-[11.5px] leading-relaxed text-muted transition hover:text-ink"
      >
        <Quote size={11} className="mt-0.5 shrink-0 text-faint" aria-hidden />
        <span className={cn('flex-1 italic', !open && 'line-clamp-2')}>“{suggestion.quote}”</span>
        <ChevronRight
          size={12}
          className={cn('mt-0.5 shrink-0 text-faint transition', open && 'rotate-90')}
          aria-hidden
        />
      </button>

      {open && suggestion.reason && (
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{suggestion.reason}</p>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <Button
          size="sm"
          variant="primary"
          disabled={disabled}
          onClick={onAccept}
          title={disabled ? 'This report is not editable right now' : undefined}
        >
          <Check size={12} aria-hidden />
          Add it
        </Button>
        <Button size="sm" onClick={onDismiss}>
          <X size={12} aria-hidden />
          No
        </Button>
        {suggestion.origin === 'model' && (
          <span className="ml-auto text-[10.5px] uppercase tracking-wide text-faint">model</span>
        )}
      </div>
    </li>
  );
}
