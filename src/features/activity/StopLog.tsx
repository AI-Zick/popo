import { useMemo, useState } from 'react';
import { Car, Check, Loader2, Plus, Trash2, X } from 'lucide-react';
import { useStore } from '@/state/store';
import {
  createCitation,
  STOP_OUTCOMES,
  STOP_REASONS,
  type Citation,
  type StopOutcome,
  type StopReason,
  type TrafficStop,
} from '@/domain/activity';
import { STATES } from '@/domain/codes';
import { nowLocalISO } from '@/domain/factory';
import { Badge, Button, FieldGrid, Panel } from '@/components/ui/primitives';
import { SelectField, TextField } from '@/components/ui/fields';
import { formatDateTime, relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * Logging a stop.
 *
 * The design constraint is speed. An officer types this standing at a car door
 * or in thirty seconds before the next call, and every field beyond the minimum
 * is a field that makes them stop bothering — at which point the activity report
 * built on top of it is wrong and nobody trusts it.
 *
 * So: time defaults to now, location is free text because officers describe
 * stops by landmark, and everything else is optional.
 */
export function StopLog() {
  const { stops, currentUser, logStop, removeStop } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<TrafficStop> | null>(null);

  const mine = useMemo(
    () =>
      stops
        .filter((s) => s.officerId === currentUser.id)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 25),
    [stops, currentUser.id],
  );

  const start = () =>
    setDraft({
      at: nowLocalISO(),
      location: '',
      beat: '',
      reason: 'moving',
      outcome: 'warning',
      citations: [],
      plate: '',
      plateState: '',
    });

  const submit = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const result = await logStop(draft);
    setBusy(false);
    if (result.ok) setDraft(null);
    else setError(result.reason ?? 'Could not log it.');
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Log a stop"
        description="Most stops never become a report. Logging them is what makes an activity report mean anything."
        aside={<Car size={17} className="text-faint" aria-hidden />}
      >
        {error && (
          <p className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</p>
        )}

        {draft ? (
          <StopForm
            draft={draft}
            setDraft={setDraft}
            busy={busy}
            onCancel={() => setDraft(null)}
            onSubmit={() => void submit()}
          />
        ) : (
          <Button variant="primary" onClick={start}>
            <Plus size={15} aria-hidden />
            New stop
          </Button>
        )}
      </Panel>

      <Panel
        title={`Your recent stops (${mine.length})`}
        description="The last twenty-five. Remove anything logged by mistake."
      >
        {mine.length === 0 ? (
          <p className="text-[12.5px] text-muted">Nothing logged yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {mine.map((stop) => (
              <StopRow key={stop.id} stop={stop} onRemove={() => void removeStop(stop.id)} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function StopForm({
  draft,
  setDraft,
  busy,
  onCancel,
  onSubmit,
}: {
  draft: Partial<TrafficStop>;
  setDraft: (d: Partial<TrafficStop>) => void;
  busy: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const set = (patch: Partial<TrafficStop>) => setDraft({ ...draft, ...patch });
  const citations = draft.citations ?? [];

  const addCitation = (warningOnly: boolean) =>
    set({
      citations: [...citations, createCitation({ id: `c${citations.length}${Date.now()}`, warningOnly })],
      // The outcome and the paperwork should not disagree with each other.
      outcome: warningOnly ? draft.outcome : 'citation',
    });

  return (
    <div className="space-y-4">
      <FieldGrid cols={3}>
        <TextField
          path="stop.at"
          label="Time of the stop"
          type="datetime-local"
          required
          value={(draft.at ?? '').slice(0, 16)}
          onChange={(v) => set({ at: v })}
        />
        <TextField
          className="col-span-2"
          path="stop.location"
          label="Where"
          required
          hint="However you would say it on the radio."
          placeholder="US-411 at Watson Rd"
          value={draft.location ?? ''}
          onChange={(v) => set({ location: v })}
        />
      </FieldGrid>

      <FieldGrid cols={4}>
        <SelectField
          path="stop.reason"
          label="Reason"
          options={STOP_REASONS}
          value={draft.reason ?? 'moving'}
          onChange={(v) => set({ reason: v as StopReason })}
        />
        <SelectField
          path="stop.outcome"
          label="Outcome"
          options={STOP_OUTCOMES}
          value={draft.outcome ?? 'warning'}
          onChange={(v) => set({ outcome: v as StopOutcome })}
        />
        <TextField
          path="stop.plate"
          label="Plate"
          value={draft.plate ?? ''}
          onChange={(v) => set({ plate: v.toUpperCase() })}
          inputClassName="font-mono uppercase"
        />
        <SelectField
          path="stop.plateState"
          label="State"
          options={STATES}
          value={draft.plateState ?? ''}
          onChange={(v) => set({ plateState: v })}
        />
      </FieldGrid>

      {citations.length > 0 && (
        <div className="space-y-2">
          {citations.map((citation, index) => (
            <div key={citation.id} className="flex items-end gap-2">
              <TextField
                className="w-44"
                path={`stop.citation.${index}.statute`}
                label={index === 0 ? 'Statute' : ''}
                value={citation.statute}
                onChange={(v) =>
                  set({
                    citations: citations.map((c, i) => (i === index ? { ...c, statute: v } : c)),
                  })
                }
              />
              <TextField
                className="flex-1"
                path={`stop.citation.${index}.description`}
                label={index === 0 ? 'What for' : ''}
                value={citation.description}
                onChange={(v) =>
                  set({
                    citations: citations.map((c, i) => (i === index ? { ...c, description: v } : c)),
                  })
                }
              />
              <div className="pb-2">
                {citation.warningOnly ? (
                  <Badge tone="neutral">Written warning</Badge>
                ) : (
                  <Badge tone="accent">Citation</Badge>
                )}
              </div>
              <button
                type="button"
                onClick={() => set({ citations: citations.filter((_, i) => i !== index) })}
                className="mb-2 text-faint transition hover:text-danger"
                aria-label="Remove"
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => addCitation(false)}>
          <Plus size={13} aria-hidden />
          Citation
        </Button>
        <Button size="sm" onClick={() => addCitation(true)}>
          <Plus size={13} aria-hidden />
          Written warning
        </Button>
        <div className="flex-1" />
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={busy} onClick={onSubmit}>
          {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Check size={13} aria-hidden />}
          Log it
        </Button>
      </div>
    </div>
  );
}

function StopRow({ stop, onRemove }: { stop: TrafficStop; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const reason = STOP_REASONS.find((r) => r.value === stop.reason)?.label ?? stop.reason;
  const outcome = STOP_OUTCOMES.find((o) => o.value === stop.outcome)?.label ?? stop.outcome;
  const cited = stop.citations.filter((c: Citation) => !c.warningOnly).length;

  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-ink">
          {stop.location || 'Location not recorded'}
          {stop.plate && <span className="ml-2 font-mono text-[12px] text-muted">{stop.plate}</span>}
        </p>
        <p className="text-[12px] text-muted">
          {formatDateTime(stop.at)} · {reason} · {outcome}
          {cited > 0 && ` · ${cited} citation${cited === 1 ? '' : 's'}`}
        </p>
      </div>
      <span className="shrink-0 text-[11.5px] text-faint">{relativeTime(stop.at)}</span>
      {confirming ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md bg-danger px-2 py-1 text-[11.5px] font-medium text-white"
          >
            Remove
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-[11.5px] text-muted hover:text-ink"
          >
            Keep
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={cn('shrink-0 rounded-md p-1.5 text-faint transition hover:text-danger')}
          aria-label="Remove this stop"
        >
          <Trash2 size={14} />
        </button>
      )}
    </li>
  );
}
