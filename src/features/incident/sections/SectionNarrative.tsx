import { useMemo } from 'react';
import { BookOpen, Check } from 'lucide-react';
import { useStore } from '@/state/store';
import { path } from '@/validation/engine';
import { Panel } from '@/components/ui/primitives';
import { TextareaField } from '@/components/ui/fields';
import { cn } from '@/lib/cn';
import { SuggestionPanel } from '@/features/narrative/SuggestionPanel';

/** Prompts that mirror how a report actually gets written, in order. */
const PROMPTS = [
  { key: 'dispatch', label: 'How you were dispatched', match: /dispatch|call|responded|assigned|flagged down/i },
  { key: 'arrival', label: 'What you observed on arrival', match: /observed|arrived|upon arrival|noted|saw/i },
  { key: 'statements', label: 'What people told you', match: /stated|advised|reported|told me|said/i },
  { key: 'evidence', label: 'Evidence and photographs', match: /photograph|evidence|collected|lifted|swab|submitted/i },
  { key: 'action', label: 'What you did and how it ended', match: /arrest|transported|cleared|provided|case card|canvass/i },
];

export function SectionNarrative() {
  const { incident, update } = useStore();
  if (!incident) return null;

  const text = incident.narrative;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="grid grid-cols-[1fr_280px] gap-4">
      <Panel
        title="Narrative"
        description="The coded fields above produce statistics. This is the part a prosecutor actually reads."
        aside={<BookOpen size={17} className="text-faint" aria-hidden />}
      >
        <TextareaField
          path={path.incident('narrative')}
          label="Account of the incident"
          required
          rows={22}
          placeholder="On the above date and time I was dispatched to…"
          value={text}
          onChange={(v) => update((d) => void (d.narrative = v))}
        />
        <div className="mt-2 flex justify-between text-[12px] text-faint tabular">
          <span>{words.toLocaleString()} words</span>
          <span>{text.length.toLocaleString()} characters</span>
        </div>
      </Panel>

      <div className="space-y-4">
        <SuggestionPanel />
        <CoverageChecklist text={text} />
      </div>
    </div>
  );
}

function CoverageChecklist({ text }: { text: string }) {
  const covered = useMemo(
    () => PROMPTS.map((p) => ({ ...p, hit: p.match.test(text) })),
    [text],
  );
  const done = covered.filter((c) => c.hit).length;

  return (
    <aside className="h-fit rounded-xl border border-line bg-surface p-4">
      <h3 className="text-[13px] font-semibold text-ink">Coverage</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        A rough check on whether the narrative covers the usual ground. These are prompts, not
        requirements — nothing here blocks submission.
      </p>
      <p className="mt-3 text-[12px] font-medium text-muted tabular">
        {done} of {PROMPTS.length} covered
      </p>
      <ul className="mt-2 space-y-1.5">
        {covered.map((c) => (
          <li key={c.key} className="flex items-start gap-2 text-[12.5px]">
            <span
              className={cn(
                'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                c.hit ? 'border-ok bg-ok text-white' : 'border-line-strong',
              )}
              aria-hidden
            >
              {c.hit && <Check size={10} strokeWidth={3} />}
            </span>
            <span className={c.hit ? 'text-ink' : 'text-muted'}>{c.label}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
