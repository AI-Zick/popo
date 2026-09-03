import { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Lightbulb,
  MessageSquare,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useStore } from '@/state/store';
import { SECTION_LABEL, SECTION_ORDER, type SectionId } from '@/domain/types';
import type { Issue } from '@/validation/engine';
import { Button } from '@/components/ui/primitives';

type Filter = 'all' | 'error' | 'warning';

export function IssuePanel() {
  const { validation, goToIssue, applyQuickFix, activeSection } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const shown = useMemo(
    () => (filter === 'all' ? validation.issues : validation.issues.filter((i) => i.severity === filter)),
    [validation.issues, filter],
  );

  const grouped = useMemo(() => {
    const map = new Map<SectionId, Issue[]>();
    for (const issue of shown) {
      const list = map.get(issue.section);
      if (list) list.push(issue);
      else map.set(issue.section, [issue]);
    }
    return SECTION_ORDER.filter((s) => map.has(s)).map((s) => [s, map.get(s)!] as const);
  }, [shown]);

  const errorCount = validation.errors.length;
  const warnCount = validation.warnings.length;

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-line bg-canvas">
      <header className="border-b border-line px-4 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Report check</h2>
          {errorCount === 0 && (
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-ok">
              <ShieldCheck size={14} aria-hidden />
              Ready to submit
            </span>
          )}
        </div>

        <div className="mt-3 flex gap-1.5">
          <FilterTab active={filter === 'all'} onClick={() => setFilter('all')}>
            All {shown.length > 0 && <Count value={errorCount + warnCount} />}
          </FilterTab>
          <FilterTab active={filter === 'error'} onClick={() => setFilter('error')} tone="danger">
            Must fix <Count value={errorCount} tone={errorCount ? 'danger' : undefined} />
          </FilterTab>
          <FilterTab active={filter === 'warning'} onClick={() => setFilter('warning')} tone="warn">
            Review <Count value={warnCount} tone={warnCount ? 'warn' : undefined} />
          </FilterTab>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {grouped.length === 0 ? (
          <AllClear filter={filter} />
        ) : (
          <div className="space-y-4">
            {grouped.map(([section, issues]) => (
              <div key={section}>
                <div className="mb-1.5 flex items-center gap-2 px-1.5">
                  <h3
                    className={cn(
                      'text-[11.5px] font-semibold uppercase tracking-wider',
                      section === activeSection ? 'text-accent' : 'text-faint',
                    )}
                  >
                    {SECTION_LABEL[section]}
                  </h3>
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-[11.5px] text-faint tabular">{issues.length}</span>
                </div>
                <div className="space-y-1.5">
                  {issues.map((issue) => (
                    <IssueRow
                      key={issue.key}
                      issue={issue}
                      expanded={expanded === issue.key}
                      onToggle={() => setExpanded((k) => (k === issue.key ? null : issue.key))}
                      onGo={() => goToIssue(issue)}
                      onFix={() => applyQuickFix(issue)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {errorCount > 0 && (
        <footer className="border-t border-line p-3">
          <Button
            variant="primary"
            className="w-full"
            onClick={() => goToIssue(validation.errors[0])}
          >
            Go to first problem
            <ArrowRight size={15} aria-hidden />
          </Button>
          <p className="mt-2 text-center text-[11.5px] text-faint">
            {errorCount} {errorCount === 1 ? 'item blocks' : 'items block'} submission
          </p>
        </footer>
      )}
    </aside>
  );
}

function Count({ value, tone }: { value: number; tone?: 'danger' | 'warn' }) {
  if (value === 0) return null;
  return (
    <span
      className={cn(
        'ml-1 rounded px-1 text-[11px] font-semibold tabular',
        tone === 'danger' && 'bg-danger/15 text-danger',
        tone === 'warn' && 'bg-warn/15 text-warn',
        !tone && 'bg-line text-muted',
      )}
    >
      {value}
    </span>
  );
}

function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: 'danger' | 'warn';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center rounded-lg border px-2 py-1.5 text-[12.5px] font-medium transition',
        active ? 'border-line-strong bg-surface text-ink' : 'border-transparent text-muted hover:bg-surface/60',
      )}
    >
      {children}
    </button>
  );
}

function IssueRow({
  issue,
  expanded,
  onToggle,
  onGo,
  onFix,
}: {
  issue: Issue;
  expanded: boolean;
  onToggle: () => void;
  onGo: () => void;
  onFix: () => void;
}) {
  const { resolveReviewComment } = useStore();
  const isError = issue.severity === 'error';
  // Supervisor notes are folded into the same list; they read differently.
  const reviewCommentId = issue.key.startsWith('review:') ? issue.key.slice(7) : null;
  const Icon = reviewCommentId ? MessageSquare : isError ? AlertCircle : AlertTriangle;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-surface transition',
        reviewCommentId ? 'border-accent/35' : isError ? 'border-danger/25' : 'border-warn/25',
        expanded && 'ring-1',
        expanded && (isError ? 'ring-danger/25' : 'ring-warn/25'),
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-raised"
      >
        <Icon
          size={15}
          className={cn(
            'mt-0.5 shrink-0',
            reviewCommentId ? 'text-accent' : isError ? 'text-danger' : 'text-warn',
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium leading-snug text-ink">{issue.title}</span>
          {issue.scope && <span className="mt-0.5 block text-[11.5px] text-faint">{issue.scope}</span>}
        </span>
        <ChevronRight
          size={14}
          className={cn('mt-0.5 shrink-0 text-faint transition-transform', expanded && 'rotate-90')}
          aria-hidden
        />
      </button>

      {expanded && (
        <div className="border-t border-line px-3 py-2.5">
          <p className="text-[12.5px] leading-relaxed text-muted">{issue.message}</p>
          {issue.tip && (
            <div className="mt-2 flex gap-2 rounded-lg bg-raised p-2.5">
              <Lightbulb size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <p className="text-[12.5px] leading-relaxed text-ink/85">{issue.tip}</p>
            </div>
          )}
          <div className="mt-2.5 flex gap-2">
            <Button size="sm" variant="secondary" onClick={onGo} className="flex-1">
              Take me there
              <ArrowRight size={13} aria-hidden />
            </Button>
            {issue.quickFix && (
              <Button size="sm" variant="primary" onClick={onFix}>
                <Wrench size={13} aria-hidden />
                {issue.quickFix.label}
              </Button>
            )}
            {reviewCommentId && (
              <Button size="sm" variant="primary" onClick={() => resolveReviewComment(reviewCommentId)}>
                <Check size={13} aria-hidden />
                Mark done
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AllClear({ filter }: { filter: Filter }) {
  const copy: Record<Filter, { title: string; body: string }> = {
    all: {
      title: 'Nothing to fix',
      body: 'Every required field is filled and no cross-checks failed. This report is ready for supervisor review.',
    },
    error: {
      title: 'No blocking problems',
      body: 'Nothing here prevents submission. Switch to Review to see the softer suggestions.',
    },
    warning: {
      title: 'No suggestions',
      body: 'Nothing flagged for a second look.',
    },
  };
  const { title, body } = copy[filter];

  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <CheckCircle2 size={30} className="mb-3 text-ok" aria-hidden />
      <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}
