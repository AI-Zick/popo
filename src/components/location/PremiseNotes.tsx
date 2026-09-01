import { useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Phone,
  Plus,
  RotateCcw,
  StickyNote,
} from 'lucide-react';
import { useStore } from '@/state/store';
import {
  isStale,
  NOTE_KIND_HINT,
  NOTE_KIND_LABEL,
  retractedNotes,
  type MasterLocation,
  type NoteKind,
  type PremiseNote,
} from '@/domain/location';
import { Badge, Button } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

const KIND_ICON: Record<NoteKind, typeof KeyRound> = {
  access: KeyRound,
  hazard: AlertTriangle,
  contact: Phone,
  general: StickyNote,
};

const KIND_TONE: Record<NoteKind, 'accent' | 'danger' | 'ok' | 'neutral'> = {
  access: 'accent',
  hazard: 'danger',
  contact: 'ok',
  general: 'neutral',
};

/**
 * What officers and dispatch have learned about a place. This is the reason a
 * shared location record earns its keep — the gate code someone worked out at
 * 0300 lives here rather than in a notebook that leaves with them.
 */
export function PremiseNotes({ location }: { location: MasterLocation }) {
  const { notesFor, updateNote, retractNote, restoreNote, can } = useStore();
  const mayViewRestricted = can('notes.viewRestricted');
  const [adding, setAdding] = useState(false);
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const notes = notesFor(location.id);

  const mayRetract = can('notes.retract');
  const withdrawn = can('notes.viewRetracted') ? retractedNotes(location) : [];

  return (
    <div className="rounded-xl border border-line bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-ink">Notes on this location</h3>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Shared with everyone. Anything here shows the moment this address comes up again.
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding((a) => !a)}>
          <Plus size={13} aria-hidden />
          Add note
        </Button>
      </header>

      <div className="p-3">
        {adding && (
          <NoteComposer locationId={location.id} onDone={() => setAdding(false)} />
        )}

        {notes.length === 0 && !adding ? (
          <p className="px-2 py-6 text-center text-[13px] leading-relaxed text-faint">
            Nothing recorded here yet. Gate codes, which entrance actually opens, who to call after
            hours, a dog in the back — whatever you had to work out on scene, the next officer will
            have to work out again.
          </p>
        ) : (
          <ul className="space-y-2">
            {notes.map((note) => (
              <li key={note.id}>
                <NoteCard
                  note={note}
                  locationName={location.commonName || location.address}
                  mayRetract={mayRetract}
                  mayViewRestricted={mayViewRestricted}
                  onRetract={(reason) => retractNote(location.id, note.id, reason)}
                  onConfirm={() =>
                    updateNote(location.id, note.id, { reviewedAt: new Date().toISOString() })
                  }
                />
              </li>
            ))}
          </ul>
        )}

        {!mayRetract && notes.length > 0 && (
          <p className="mt-3 flex items-start gap-1.5 px-1 text-[11.5px] leading-relaxed text-faint">
            <Lock size={12} className="mt-0.5 shrink-0" aria-hidden />
            You can add notes here. Withdrawing one needs a supervisor, records, or an officer
            designated for it — so what a previous shift worked out cannot quietly disappear.
          </p>
        )}

        {withdrawn.length > 0 && (
          <div className="mt-3 border-t border-line pt-3">
            <button
              type="button"
              onClick={() => setShowWithdrawn((v) => !v)}
              className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted transition hover:text-ink"
            >
              <Archive size={13} aria-hidden />
              {showWithdrawn ? 'Hide' : 'Show'} {withdrawn.length} withdrawn{' '}
              {withdrawn.length === 1 ? 'note' : 'notes'}
            </button>
            {showWithdrawn && (
              <ul className="mt-2 space-y-2">
                {withdrawn.map((note) => (
                  <li key={note.id}>
                    <WithdrawnNote
                      note={note}
                      mayRestore={mayRetract}
                      onRestore={() => restoreNote(location.id, note.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function WithdrawnNote({
  note,
  mayRestore,
  onRestore,
}: {
  note: PremiseNote;
  mayRestore: boolean;
  onRestore: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line px-3 py-2.5">
      <p className="text-[12.5px] leading-relaxed text-muted line-through">{note.text}</p>
      <p className="mt-1.5 text-[11.5px] text-faint">
        Written by {note.author || 'unknown'} · withdrawn by {note.retractedBy || 'unknown'}{' '}
        {relativeTime(note.retractedAt)}
        {note.retractionReason && ` — “${note.retractionReason}”`}
      </p>
      {mayRestore && (
        <button
          type="button"
          onClick={onRestore}
          className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-accent hover:underline"
        >
          <RotateCcw size={12} aria-hidden />
          Put it back
        </button>
      )}
    </div>
  );
}

function NoteCard({
  note,
  locationName,
  mayRetract,
  mayViewRestricted,
  onRetract,
  onConfirm,
}: {
  note: PremiseNote;
  locationName: string;
  mayRetract: boolean;
  mayViewRestricted: boolean;
  onRetract: (reason: string) => void;
  onConfirm: () => void;
}) {
  const { record, currentUser } = useStore();
  const [retracting, setRetracting] = useState(false);
  const [reason, setReason] = useState('');
  // Access codes are masked by default. In a real deployment this is where a
  // permission check and an audit-log write belong.
  const [revealed, setRevealed] = useState(!note.sensitive);
  const Icon = KIND_ICON[note.kind];
  const stale = isStale(note);

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        note.kind === 'hazard' ? 'border-danger/30 bg-danger-soft/40' : 'border-line bg-raised',
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon
          size={15}
          className={cn(
            'mt-0.5 shrink-0',
            note.kind === 'hazard' ? 'text-danger' : note.kind === 'access' ? 'text-accent' : 'text-muted',
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={KIND_TONE[note.kind]}>{NOTE_KIND_LABEL[note.kind]}</Badge>
            {note.sensitive && <Badge tone="warn">Restricted</Badge>}
            {stale && <Badge tone="warn">Needs re-check</Badge>}
          </div>

          {revealed ? (
            <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
              {note.text}
            </p>
          ) : mayViewRestricted ? (
            <button
              type="button"
              onClick={() => {
                setRevealed(true);
                // Reading a gate code is an access event in its own right.
                record({
                  actorId: currentUser.id,
                  actorName: currentUser.name,
                  action: 'note.restrictedViewed',
                  target: locationName,
                  detail: NOTE_KIND_LABEL[note.kind],
                });
              }}
              className="mt-1.5 flex items-center gap-1.5 rounded-md border border-dashed border-line-strong px-2.5 py-1.5 text-[12.5px] text-muted transition hover:border-accent hover:text-accent"
            >
              <Eye size={13} aria-hidden />
              Show access details
            </button>
          ) : (
            <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-faint">
              <Lock size={12} aria-hidden />
              Restricted — you do not have access to this note
            </p>
          )}

          <p className="mt-1.5 text-[11.5px] text-faint">
            {note.author || 'Unknown'} · {relativeTime(note.createdAt)}
            {stale && ' · last confirmed over a year ago'}
          </p>

          {stale && (
            <button
              type="button"
              onClick={onConfirm}
              className="mt-1.5 text-[12px] font-medium text-accent hover:underline"
            >
              Still correct — confirm it
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {note.sensitive && revealed && (
            <button
              type="button"
              onClick={() => setRevealed(false)}
              className="rounded-md p-1.5 text-faint transition hover:text-ink"
              aria-label="Hide access details"
            >
              <EyeOff size={14} />
            </button>
          )}
          {mayRetract && (
            <button
              type="button"
              onClick={() => setRetracting((v) => !v)}
              className="rounded-md p-1.5 text-faint transition hover:bg-danger-soft hover:text-danger"
              aria-label="Withdraw note"
              title="Withdraw this note"
            >
              <Archive size={14} />
            </button>
          )}
        </div>
      </div>

      {retracting && (
        <div className="mt-3 rounded-lg border border-line bg-surface p-2.5">
          <p className="text-[12.5px] font-medium text-ink">Withdraw this note?</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
            It stops showing on the location. The note, its author and this withdrawal are kept.
          </p>
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why — e.g. gate code changed in March"
            className="mt-2 w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" onClick={() => setRetracting(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!reason.trim()}
              onClick={() => {
                onRetract(reason.trim());
                setRetracting(false);
              }}
            >
              Withdraw
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NoteComposer({ locationId, onDone }: { locationId: string; onDone: () => void }) {
  const { addNote } = useStore();
  const [kind, setKind] = useState<NoteKind>('access');
  const [text, setText] = useState('');
  // Access details default to restricted — a gate code is not general reading.
  const [sensitive, setSensitive] = useState(true);

  const setKindAndDefaults = (next: NoteKind) => {
    setKind(next);
    setSensitive(next === 'access');
  };

  return (
    <div className="mb-3 rounded-lg border border-accent/30 bg-accent-soft/40 p-3">
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(NOTE_KIND_LABEL) as NoteKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKindAndDefaults(k)}
            className={cn(
              'rounded-lg border px-2.5 py-1.5 text-[12.5px] transition',
              k === kind
                ? 'border-accent/50 bg-surface font-medium text-ink'
                : 'border-transparent text-muted hover:bg-surface/60',
            )}
          >
            {NOTE_KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <p className="mt-2 text-[12px] text-muted">{NOTE_KIND_HINT[kind]}</p>

      <textarea
        autoFocus
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          kind === 'access'
            ? 'Police gate code 4417# at the Marion St keypad. Rear gate chained after 1800.'
            : 'What should the next officer know before they arrive?'
        }
        className="mt-2 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px] leading-relaxed text-ink placeholder:text-faint"
      />

      <label className="mt-2 flex items-start gap-2 text-[12.5px] text-muted">
        <input
          type="checkbox"
          checked={sensitive}
          onChange={(e) => setSensitive(e.target.checked)}
          className="mt-0.5 size-3.5"
        />
        <span>
          Restricted — hide by default and require a deliberate click to read. Use this for codes
          and keys.
        </span>
      </label>

      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!text.trim()}
          onClick={() => {
            addNote(locationId, { kind, text: text.trim(), sensitive });
            onDone();
          }}
        >
          Save note
        </Button>
      </div>
    </div>
  );
}
