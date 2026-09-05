import { useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useStore } from '@/state/store';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * The report check, for documents that are not incident reports.
 *
 * A crash report and an arrest listed their problems in a panel at the bottom
 * of the page: correct, and useless. By the time somebody has scrolled to the
 * end of a form to read that the light condition is missing, they have to
 * scroll back and find it — and a report with eleven problems is eleven round
 * trips. The incident editor solved this a long time ago with a rail that
 * stays on screen and jumps to the field; these two never got it.
 *
 * So this is that rail, with the incident's own vocabulary — must fix versus
 * worth a look, a count that means blocking, and one button to the first
 * problem — but taking a plain list rather than the incident's validation
 * state, because a crash has units and an arrest has charges and neither has
 * an incident's sections.
 */

export interface CheckItem {
  /** Stable across renders, so an expanded row does not jump. */
  key: string;
  /** The field to jump to. Must match a `path` on the form. */
  path: string;
  message: string;
  tip?: string;
  severity: 'error' | 'warning';
  /**
   * The tab this problem lives on, where the form has tabs.
   *
   * Jumping to a field on a tab that is not showing scrolls to nothing, which
   * reads as a broken button — so the rail switches tab first and the form
   * says which tab each field is on.
   */
  group?: string;
  /** What that group is called, for the heading over the row. */
  groupLabel?: string;
}

type Filter = 'all' | 'error' | 'warning';

export function CheckRail({
  items,
  onGoTo,
  ready,
}: {
  items: CheckItem[];
  /** Called before the jump, so a tabbed form can show the right tab. */
  onGoTo?: (item: CheckItem) => void;
  /** What to say when there is nothing wrong. */
  ready?: string;
}) {
  const { focusField } = useStore();
  const [filter, setFilter] = useState<Filter>('all');

  const errors = items.filter((i) => i.severity === 'error');
  const warnings = items.filter((i) => i.severity === 'warning');
  const shown = filter === 'all' ? items : items.filter((i) => i.severity === filter);

  const grouped = useMemo(() => {
    const map = new Map<string, CheckItem[]>();
    for (const item of shown) {
      const key = item.groupLabel ?? '';
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return [...map.entries()];
  }, [shown]);

  const go = (item: CheckItem) => {
    onGoTo?.(item);
    focusField(item.path);
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-line bg-canvas">
      <div className="shrink-0 border-b border-line px-3 py-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Report check</p>
        <div className="mt-2 flex gap-1">
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label="All" count={items.length} />
          <FilterChip
            active={filter === 'error'}
            onClick={() => setFilter('error')}
            label="Must fix"
            count={errors.length}
            tone="danger"
          />
          <FilterChip
            active={filter === 'warning'}
            onClick={() => setFilter('warning')}
            label="Review"
            count={warnings.length}
            tone="warn"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {shown.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <CheckCircle2 size={22} className="mx-auto text-ok" aria-hidden />
            <p className="mt-2 text-[13px] font-medium text-ink">
              {items.length === 0 ? 'Nothing to fix' : 'Nothing under this filter'}
            </p>
            {items.length === 0 && ready && (
              <p className="mt-1 text-[12px] leading-relaxed text-muted">{ready}</p>
            )}
          </div>
        ) : (
          grouped.map(([label, list]) => (
            <div key={label} className="mb-3">
              {label && (
                <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
                  {label}
                </p>
              )}
              <ul className="space-y-1">
                {list.map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => go(item)}
                      className={cn(
                        'w-full rounded-lg border px-2.5 py-2 text-left transition',
                        item.severity === 'error'
                          ? 'border-danger/30 bg-danger-soft/60 hover:border-danger/50'
                          : 'border-warn/30 bg-warn-soft/50 hover:border-warn/50',
                      )}
                    >
                      <span className="flex items-start gap-1.5">
                        {item.severity === 'error' ? (
                          <AlertCircle size={13} className="mt-0.5 shrink-0 text-danger" aria-hidden />
                        ) : (
                          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] font-medium leading-snug text-ink">
                            {item.message}
                          </span>
                          {/*
                            The tip is shown, not hidden behind a disclosure.
                            It is the half that says what to do, and a problem
                            somebody has to click twice to understand is one
                            they guess at instead.
                          */}
                          {item.tip && (
                            <span className="mt-1 block text-[11.5px] leading-relaxed text-ink/70">
                              {item.tip}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      {items.length > 0 && (
        <div className="shrink-0 border-t border-line p-2.5">
          <Button variant="primary" className="w-full" onClick={() => go(shown[0] ?? items[0])}>
            Go to first problem
            <ArrowRight size={14} aria-hidden />
          </Button>
          <p className="mt-1.5 text-center text-[11px] text-faint">
            {errors.length === 0
              ? 'Nothing blocks submission'
              : `${errors.length} ${errors.length === 1 ? 'item blocks' : 'items block'} submission`}
          </p>
        </div>
      )}
    </aside>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: 'danger' | 'warn';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium transition',
        active ? 'bg-surface text-ink ring-1 ring-line' : 'text-muted hover:bg-surface/60',
      )}
    >
      {label}
      <span
        className={cn(
          'tabular',
          count === 0
            ? 'text-faint'
            : tone === 'danger'
              ? 'text-danger'
              : tone === 'warn'
                ? 'text-warn'
                : 'text-muted',
        )}
      >
        {count}
      </span>
    </button>
  );
}
