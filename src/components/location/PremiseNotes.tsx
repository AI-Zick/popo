import { useState } from 'react';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  Phone,
  Plus,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { useStore } from '@/state/store';
import {
  isStale,
  NOTE_KIND_HINT,
  NOTE_KIND_LABEL,
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
  const { notesFor, removeNote, updateNote } = useStore();
  const [adding, setAdding] = useState(false);
  const notes = notesFor(location.id);

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
                  onDelete={() => removeNote(location.id, note.id)}
                  onConfirm={() =>
                    updateNote(location.id, note.id, { reviewedAt: new Date().toISOString() })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function NoteCard({
  note,
  onDelete,
  onConfirm,
}: {
  note: PremiseNote;
  onDelete: () => void;
  onConfirm: () => void;
}) {
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
          ) : (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="mt-1.5 flex items-center gap-1.5 rounded-md border border-dashed border-line-strong px-2.5 py-1.5 text-[12.5px] text-muted transition hover:border-accent hover:text-accent"
            >
              <Eye size={13} aria-hidden />
              Show access details
            </button>
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
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md p-1.5 text-faint transition hover:bg-danger-soft hover:text-danger"
            aria-label="Delete note"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
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
