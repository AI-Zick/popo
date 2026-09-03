import { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { useStore } from '@/state/store';
import {
  createChecklistItem,
  DEFAULT_CHECKLIST,
  type ChecklistItem,
} from '@/domain/fleet';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * What the daily cruiser check asks.
 *
 * The list is the agency's, not ours. A department with rifles in the cars
 * checks the rifle and one without does not, and a fixed list would have half
 * its users ticking a box that means nothing to them — which is how a
 * checklist becomes something people click through in four seconds.
 *
 * The one thing this screen argues for is `critical`. Most items are worth
 * knowing about; a few mean the car does not leave the lot, and that
 * difference has to be decided in advance by somebody thinking about it
 * rather than at five in the morning by somebody who wants to get going.
 */
export function ChecklistEditor() {
  const { agency, updateAgency } = useStore();
  const items = agency.checklist ?? [];
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: '', section: 'Walk-around', hint: '', critical: false });

  const save = (next: ChecklistItem[]) => updateAgency({ checklist: next });

  const set = (id: string, patch: Partial<ChecklistItem>) =>
    save(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const move = (id: string, by: number) => {
    const index = items.findIndex((i) => i.id === id);
    const to = index + by;
    if (index < 0 || to < 0 || to >= items.length) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    save(next);
  };

  const add = () => {
    if (!draft.label.trim()) return;
    save([
      ...items,
      createChecklistItem({
        ...draft,
        id: `chk${Date.now().toString(36)}`,
        label: draft.label.trim(),
        section: draft.section.trim() || 'Other',
      }),
    ]);
    setDraft({ label: '', section: draft.section, hint: '', critical: false });
    setAdding(false);
  };

  const field =
    'w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint';

  return (
    <Panel
      title="The daily cruiser check"
      description="What an officer is asked at the start of a shift. Yours to decide — every line here can be changed or removed."
    >
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li
            key={item.id}
            className={cn(
              'rounded-lg border px-3 py-2',
              item.active ? 'border-line bg-surface' : 'border-dashed border-line bg-canvas',
            )}
          >
            <div className="flex items-start gap-2">
              {/*
                Order matters: the form is a walk around the car, and reading
                it out of order is how an item gets skipped.
              */}
              <span className="mt-1 flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => move(item.id, -1)}
                  disabled={i === 0}
                  aria-label={`Move ${item.label} up`}
                  className="rounded text-faint transition hover:bg-raised hover:text-ink disabled:opacity-25"
                >
                  <ChevronUp size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => move(item.id, 1)}
                  disabled={i === items.length - 1}
                  aria-label={`Move ${item.label} down`}
                  className="rounded text-faint transition hover:bg-raised hover:text-ink disabled:opacity-25"
                >
                  <ChevronDown size={14} aria-hidden />
                </button>
              </span>

              <div className="min-w-0 flex-1">
                <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
                  <input
                    value={item.label}
                    onChange={(e) => set(item.id, { label: e.target.value })}
                    className={field}
                  />
                  <input
                    value={item.section}
                    onChange={(e) => set(item.id, { section: e.target.value })}
                    placeholder="Section"
                    className={field}
                  />
                </div>
                <input
                  value={item.hint}
                  onChange={(e) => set(item.id, { hint: e.target.value })}
                  placeholder="Hint shown under the label — for the item whose meaning is not obvious"
                  className={cn(field, 'mt-1.5 text-[12.5px]')}
                />

                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink">
                    <input
                      type="checkbox"
                      checked={item.critical}
                      onChange={(e) => set(item.id, { critical: e.target.checked })}
                    />
                    Takes the car off the road
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-muted">
                    <input
                      type="checkbox"
                      checked={item.active}
                      onChange={(e) => set(item.id, { active: e.target.checked })}
                    />
                    In use
                  </label>
                  {item.critical && (
                    <Badge tone="danger">
                      <TriangleAlert size={11} className="mr-1 inline" aria-hidden />
                      Critical
                    </Badge>
                  )}
                </div>
              </div>

              {/*
                Retired rather than deleted. Checks already filed name the items
                they answered, and a list that can lose a line is a list whose
                old records stop making sense.
              */}
              <button
                type="button"
                onClick={() => set(item.id, { active: false })}
                disabled={!item.active}
                aria-label={`Stop asking about ${item.label}`}
                className="mt-1 shrink-0 rounded p-1 text-faint transition hover:bg-danger-soft hover:text-danger disabled:opacity-30"
              >
                <Trash2 size={13} aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="mt-3 rounded-lg border border-line bg-raised p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
            <input
              autoFocus
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              placeholder="Spare tyre present"
              className={field}
            />
            <input
              value={draft.section}
              onChange={(e) => setDraft((d) => ({ ...d, section: e.target.value }))}
              placeholder="Section"
              className={field}
            />
          </div>
          <input
            value={draft.hint}
            onChange={(e) => setDraft((d) => ({ ...d, hint: e.target.value }))}
            placeholder="Hint (optional)"
            className={cn(field, 'mt-1.5 text-[12.5px]')}
          />
          <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink">
            <input
              type="checkbox"
              checked={draft.critical}
              onChange={(e) => setDraft((d) => ({ ...d, critical: e.target.checked }))}
            />
            Takes the car off the road
          </label>
          <div className="mt-2.5 flex gap-2">
            <Button variant="primary" size="sm" disabled={!draft.label.trim()} onClick={add}>
              Add it
            </Button>
            <Button size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => setAdding(true)}>
            <Plus size={15} aria-hidden />
            Add an item
          </Button>
          <Button
            onClick={() =>
              save(DEFAULT_CHECKLIST.map((item, i) => ({ ...item, id: `chk${i + 1}` })))
            }
            title="Replaces the list with the one this ships with"
          >
            <RotateCcw size={15} aria-hidden />
            Start again from the default
          </Button>
        </div>
      )}
    </Panel>
  );
}
