import { useCallback, useRef } from 'react';
import { Download, Loader2, Mic, MicOff, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useDictation } from '@/lib/dictation';
import { insertTranscript } from '@/domain/dictation';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * A microphone for one narrative field.
 *
 * The audio never leaves the machine — see `lib/dictation` for how that is
 * enforced — and the panel says so, because an officer being asked to speak
 * the details of an assault into a computer is entitled to know where the
 * recording goes. "It stays on this machine" is the whole reason this is
 * allowed to exist in a police report at all.
 *
 * Words land at the caret, not at the end. Officers dictate a draft and then
 * go back to put a sentence in the middle of it, and a feature that can only
 * append is one they stop using at the first correction.
 */
export function Dictate({
  value,
  onChange,
  path,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  /**
   * The field this writes into, by the path every field already carries.
   *
   * Found through the DOM rather than a ref because the caret is a DOM fact —
   * React does not know where it is, and threading an id through the shared
   * field components to learn it would change every field in the app for the
   * benefit of the two that have a microphone.
   */
  path: string;
  disabled?: boolean;
}) {
  // The live value, so the result handler never appends onto a stale draft.
  const latest = useRef(value);
  latest.current = value;

  const field = useCallback(
    () =>
      document.querySelector<HTMLTextAreaElement>(
        `[data-field-path="${CSS.escape(path)}"] textarea`,
      ),
    [path],
  );

  const write = useCallback(
    (chunk: string) => {
      const el = field();
      const at = el && el.selectionStart != null ? el.selectionStart : latest.current.length;
      const { text, caret } = insertTranscript(latest.current, chunk, at);
      latest.current = text;
      onChange(text);
      // After React re-renders the field the caret is wherever the browser put
      // it, which is not after the words just spoken.
      requestAnimationFrame(() => {
        const again = field();
        if (again) again.setSelectionRange(caret, caret);
      });
    },
    [field, onChange],
  );

  const { state, interim, message, install, start, stop } = useDictation(write);

  if (state === 'unsupported') return null;

  const listening = state === 'listening';

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        {state === 'downloadable' || state === 'downloading' ? (
          <Button
            size="sm"
            disabled={disabled || state === 'downloading'}
            onClick={() => void install()}
          >
            {state === 'downloading' ? (
              <Loader2 size={14} className="animate-spin" aria-hidden />
            ) : (
              <Download size={14} aria-hidden />
            )}
            {state === 'downloading' ? 'Installing…' : 'Set up dictation'}
          </Button>
        ) : (
          <Button
            size="sm"
            variant={listening ? 'danger' : undefined}
            disabled={disabled}
            onClick={listening ? stop : start}
            aria-pressed={listening}
          >
            {listening ? <MicOff size={14} aria-hidden /> : <Mic size={14} aria-hidden />}
            {listening ? 'Stop dictating' : 'Dictate'}
          </Button>
        )}

        {listening ? (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-danger">
            <span className="size-2 animate-pulse rounded-full bg-danger" aria-hidden />
            Listening — say “period”, “comma” or “new paragraph” for punctuation.
          </span>
        ) : state === 'downloadable' ? (
          <span className="text-[12px] text-muted">
            A one-time download, then it works with no network at all.
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[12px] text-muted">
            <ShieldCheck size={12} aria-hidden />
            Stays on this machine. No audio is sent anywhere.
          </span>
        )}
      </div>

      {/*
        Interim words are shown but never written into the field. They change
        as the engine hears more of the sentence, and a police report is not
        the place for text that rewrites itself under the officer's hands.
      */}
      {listening && interim && (
        <p className="mt-1.5 rounded-lg bg-raised px-2.5 py-1.5 text-[13px] italic leading-relaxed text-faint">
          {interim}…
        </p>
      )}

      {message && (
        <p
          className={cn(
            'mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-relaxed',
            state === 'denied' || state === 'error' ? 'text-warn' : 'text-muted',
          )}
        >
          <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
          {message}
        </p>
      )}
    </div>
  );
}
