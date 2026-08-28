import { useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Car,
  ClipboardCheck,
  FileText,
  Gavel,
  Package,
  Users,
} from 'lucide-react';
import { useStore } from '@/state/store';
import { SECTION_LABEL, SECTION_ORDER, type SectionId } from '@/domain/types';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/primitives';
import { IssuePanel } from '@/components/validation/IssuePanel';
import { SectionIncident } from './sections/SectionIncident';
import { SectionOffenses } from './sections/SectionOffenses';
import { SectionPersons } from './sections/SectionPersons';
import { SectionProperty } from './sections/SectionProperty';
import { SectionVehicles } from './sections/SectionVehicles';
import { SectionNarrative } from './sections/SectionNarrative';
import { SectionReview } from './sections/SectionReview';
import { EditorHeader } from './EditorHeader';

const SECTION_ICON: Record<SectionId, typeof FileText> = {
  incident: FileText,
  offenses: Gavel,
  persons: Users,
  property: Package,
  vehicles: Car,
  narrative: BookOpen,
  review: ClipboardCheck,
};

const SECTION_HINT: Record<SectionId, string> = {
  incident: 'When, where, who took it',
  offenses: 'What was committed',
  persons: 'Victims, suspects, witnesses',
  property: 'Stolen, damaged, seized',
  vehicles: 'Stolen, towed, suspect',
  narrative: 'What happened, in your words',
  review: 'Check and send',
};

export function IncidentEditor() {
  const { incident, activeSection, setSection, validation, goToIssue } = useStore();

  // F8 walks to the next unresolved problem, the way a spellchecker would.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F8') {
        e.preventDefault();
        const next = validation.errors[0] ?? validation.warnings[0];
        if (next) goToIssue(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [validation, goToIssue]);

  if (!incident) return null;

  const index = SECTION_ORDER.indexOf(activeSection);
  const prev = SECTION_ORDER[index - 1];
  const next = SECTION_ORDER[index + 1];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorHeader />

      <div className="flex min-h-0 flex-1">
        {/* -------- Section rail ---------------------------------------- */}
        <nav className="w-56 shrink-0 overflow-y-auto border-r border-line bg-canvas p-3">
          <ol className="space-y-0.5">
            {SECTION_ORDER.map((section) => {
              const Icon = SECTION_ICON[section];
              const errs = validation.errorCountBySection[section];
              const warns = validation.warningCountBySection[section];
              const active = section === activeSection;

              return (
                <li key={section}>
                  <button
                    type="button"
                    onClick={() => setSection(section)}
                    aria-current={active ? 'step' : undefined}
                    className={cn(
                      'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition',
                      active ? 'bg-surface shadow-sm ring-1 ring-line' : 'hover:bg-surface/60',
                    )}
                  >
                    <Icon
                      size={16}
                      className={cn('shrink-0', active ? 'text-accent' : 'text-faint')}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate text-[13px] font-medium',
                          active ? 'text-ink' : 'text-muted',
                        )}
                      >
                        {SECTION_LABEL[section]}
                      </span>
                      <span className="block truncate text-[11px] text-faint">
                        {SECTION_HINT[section]}
                      </span>
                    </span>
                    {errs > 0 ? (
                      <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-danger text-[10.5px] font-bold text-white tabular">
                        {errs}
                      </span>
                    ) : warns > 0 ? (
                      <span className="size-2 shrink-0 rounded-full bg-warn" aria-label={`${warns} suggestions`} />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>

          <p className="mt-4 rounded-lg bg-surface/60 px-2.5 py-2 text-[11.5px] leading-relaxed text-faint">
            Press <kbd className="rounded border border-line px-1 font-mono">F8</kbd> anywhere to jump
            to the next unresolved item.
          </p>
        </nav>

        {/* -------- Form ------------------------------------------------- */}
        <main id="section-scroll" className="min-w-0 flex-1 overflow-y-auto bg-canvas">
          <div className="mx-auto max-w-4xl px-6 py-6">
            <header className="mb-5">
              <p className="text-[11.5px] font-semibold uppercase tracking-wider text-faint">
                Step {index + 1} of {SECTION_ORDER.length}
              </p>
              <h1 className="mt-0.5 text-[22px] font-semibold tracking-tight text-ink">
                {SECTION_LABEL[activeSection]}
              </h1>
            </header>

            <SectionBody section={activeSection} />

            <div className="mt-6 flex items-center justify-between border-t border-line pt-5">
              {prev ? (
                <Button onClick={() => setSection(prev)}>
                  <ArrowLeft size={15} aria-hidden />
                  {SECTION_LABEL[prev]}
                </Button>
              ) : (
                <span />
              )}
              {next && (
                <Button variant="primary" onClick={() => setSection(next)}>
                  {SECTION_LABEL[next]}
                  <ArrowRight size={15} aria-hidden />
                </Button>
              )}
            </div>
          </div>
        </main>

        <IssuePanel />
      </div>
    </div>
  );
}

function SectionBody({ section }: { section: SectionId }) {
  switch (section) {
    case 'incident':
      return <SectionIncident />;
    case 'offenses':
      return <SectionOffenses />;
    case 'persons':
      return <SectionPersons />;
    case 'property':
      return <SectionProperty />;
    case 'vehicles':
      return <SectionVehicles />;
    case 'narrative':
      return <SectionNarrative />;
    case 'review':
      return <SectionReview />;
  }
}
