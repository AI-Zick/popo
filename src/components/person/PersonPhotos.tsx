import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera,
  Check,
  Flag,
  ImageOff,
  Loader2,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { useStore } from '@/state/store';
import {
  canRequestRemoval,
  isVisible,
  photoAge,
  PHOTO_KIND_LABEL,
  photoWarning,
  type PersonPhoto,
  type PhotoKind,
} from '@/domain/photo';
import { freshnessTone } from '@/domain/freshness';
import { SOURCE_LABEL } from '@/domain/person';
import { Badge, Button } from '@/components/ui/primitives';
import { photoUrl } from '@/lib/assetUrl';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * The photographs on a person's record.
 *
 * A photograph is a fact about how somebody looked *on a date*, so it carries
 * its age the way the address and the phone number do — and an old one is
 * shown with a warning rather than hidden, because an officer who needs a
 * picture is better served by a ten-year-old one clearly labelled than by
 * nothing at all.
 *
 * Anyone can add one. Nobody deletes one: a wrong photograph is asked about,
 * and somebody with the authority to withdraw a note decides. The officer who
 * spots that the picture is the wrong man is rarely the one holding that
 * authority, and a system where they have to go and find that person is one
 * where the wrong picture stays up.
 *
 * ## Why the controls live in a dialog
 *
 * This panel is displayed inside the report form, but it is not part of it — a
 * face belongs to the identity and outlives the case it was taken on. The form
 * disables itself once a report is submitted, and an approved report is
 * exactly when a wrong photograph most needs reporting. So the thumbnails
 * render inline and everything actionable opens in a dialog portalled out of
 * the form, where the report's lock does not reach it.
 */
export function PersonPhotos({ masterId, personName }: { masterId: string; personName: string }) {
  const { photosOf } = useStore();
  const [open, setOpen] = useState(false);

  const photos = photosOf(masterId);
  const standing = photos.filter(isVisible);
  const warning = photoWarning(standing[0] ?? null);

  if (!masterId) return null;

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="mb-2.5 flex items-center gap-3">
        <p className="text-[11.5px] uppercase tracking-wider text-faint">
          Photographs · how they looked, and when
        </p>
        <div className="flex-1" />
        <PlainButton onClick={() => setOpen(true)}>
          <Camera size={13} aria-hidden />
          {standing.length > 0 ? `Manage (${standing.length})` : 'Add a photograph'}
        </PlainButton>
      </div>

      {standing.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-3 text-[13px] text-muted">
          <ImageOff size={15} className="shrink-0 text-faint" aria-hidden />
          No photograph on file.
        </p>
      ) : (
        <>
          {/*
            Said once, about the best picture on the record. Repeating it under
            every thumbnail would make it wallpaper, and the judgement an
            officer is making is about the one they are going to rely on.
          */}
          {warning && (
            <p className="mb-2.5 flex items-start gap-2 rounded-lg border border-warn/35 bg-warn-soft px-3 py-2 text-[12.5px] leading-relaxed text-warn">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
              {warning}
            </p>
          )}
          <ul className="flex flex-wrap gap-2.5">
            {standing.slice(0, 6).map((photo) => (
              <Thumbnail key={photo.id} photo={photo} />
            ))}
          </ul>
        </>
      )}

      {open && (
        <PhotoManager masterId={masterId} personName={personName} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

/**
 * A control that is not a form control.
 *
 * A `<button>` here would be switched off by the report's `<fieldset disabled>`
 * the moment the report is submitted — and a submitted report is exactly when
 * a wrong photograph most needs reporting. This is not part of that form, so
 * it is not one of its controls.
 */
function PlainButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] font-medium text-ink transition hover:bg-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </span>
  );
}

function Thumbnail({ photo }: { photo: PersonPhoto }) {
  const age = useMemo(() => photoAge(photo), [photo]);
  return (
    <li className="w-[104px]">
      <img
        src={photoUrl(photo.id)}
        alt={photo.caption || PHOTO_KIND_LABEL[photo.kind]}
        loading="lazy"
        className={cn(
          'aspect-[3/4] w-full rounded-lg border bg-raised object-cover',
          photo.removal === 'requested' ? 'border-warn/55' : 'border-line',
        )}
      />
      {/*
        Only the age goes under a thumbnail. Three badges on a 104px card wrap
        into a stack taller than the picture, and the other two are already
        said: the newest is leftmost because they are sorted that way, and a
        queried one carries the amber border above.
      */}
      <p className="mt-1">
        <Badge tone={freshnessTone(age.level)}>{age.label}</Badge>
      </p>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* The dialog                                                          */
/* ------------------------------------------------------------------ */

function PhotoManager({
  masterId,
  personName,
  onClose,
}: {
  masterId: string;
  personName: string;
  onClose: () => void;
}) {
  const { photosOf, can, currentUser } = useStore();
  const [adding, setAdding] = useState(false);

  const photos = photosOf(masterId);
  const standing = photos.filter(isVisible);
  const takenDown = photos.filter((p) => !isVisible(p));
  const mayDecide = can('notes.retract');

  // Portalled out of the report form: see the note on this file.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-6 pt-[6vh]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={`Photographs of ${personName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold text-ink">
              Photographs — {personName || 'this person'}
            </h2>
            <p className="text-[12px] text-muted">
              On the identity, not this report. Anyone can add one or ask for one to come down.
            </p>
          </div>
          <div className="flex-1" />
          <Button onClick={() => setAdding((v) => !v)}>
            {adding ? <X size={15} aria-hidden /> : <Camera size={15} aria-hidden />}
            {adding ? 'Cancel' : 'Add'}
          </Button>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {adding && <AddPhoto masterId={masterId} onDone={() => setAdding(false)} />}

          {standing.length === 0 && !adding && (
            <p className="px-2 py-8 text-center text-[13px] leading-relaxed text-muted">
              No photograph on file. A dated one — even an old one — is worth more than none, as
              long as the date is on it.
            </p>
          )}

          <ul className="grid gap-3 sm:grid-cols-2">
            {standing.map((photo, i) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                isCurrent={i === 0}
                mayDecide={mayDecide}
                currentUserId={currentUser.id}
              />
            ))}
          </ul>

          {/*
            Taken down, still on the record. The picture is gone; that it was
            here, who asked and who decided is not — which is the whole reason
            removal is a request rather than a delete.
          */}
          {takenDown.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-[12.5px] text-muted">
                {takenDown.length} taken down
              </summary>
              <ul className="mt-2 space-y-2">
                {takenDown.map((photo) => (
                  <li
                    key={photo.id}
                    className="rounded-lg bg-raised px-3 py-2 text-[12px] leading-relaxed text-muted"
                  >
                    {PHOTO_KIND_LABEL[photo.kind]}
                    {photo.takenOn && ` taken ${photo.takenOn}`}, added by {photo.addedByName}.
                    <br />
                    <span className="text-faint">
                      {photo.requestedByName} asked: “{photo.requestReason}” — taken down by{' '}
                      {photo.decidedByName} {relativeTime(photo.decidedAt)}
                      {photo.decisionNote && `: “${photo.decisionNote}”`}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PhotoCard({
  photo,
  isCurrent,
  mayDecide,
  currentUserId,
}: {
  photo: PersonPhoto;
  isCurrent: boolean;
  mayDecide: boolean;
  currentUserId: string;
}) {
  const { requestPhotoRemoval, decidePhoto } = useStore();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const age = useMemo(() => photoAge(photo), [photo]);
  const queried = photo.removal === 'requested';
  const allowed = canRequestRemoval(photo);

  const run = async (action: () => Promise<{ ok: boolean; reason?: string }>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      setAsking(false);
      setReason('');
    } else {
      setError(result.reason ?? 'That did not work.');
    }
  };

  return (
    <li
      className={cn(
        'flex gap-3 overflow-hidden rounded-xl border bg-canvas p-2.5',
        queried ? 'border-warn/45' : 'border-line',
      )}
    >
      <img
        src={photoUrl(photo.id)}
        alt={photo.caption || PHOTO_KIND_LABEL[photo.kind]}
        loading="lazy"
        className="h-[132px] w-[100px] shrink-0 rounded-lg border border-line bg-raised object-cover"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={freshnessTone(age.level)}>{age.label}</Badge>
          {isCurrent && <Badge tone="accent">Latest</Badge>}
        </div>

        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          {PHOTO_KIND_LABEL[photo.kind]}
          {photo.takenOn ? ` · taken ${photo.takenOn}` : ' · no date'}
        </p>
        {photo.caption && (
          <p className="text-[12.5px] leading-relaxed text-ink/80">{photo.caption}</p>
        )}
        <p className="text-[11.5px] text-faint">
          {SOURCE_LABEL[photo.source]} · {photo.addedByName}
        </p>

        {queried && (
          <p className="mt-1.5 rounded-lg bg-warn-soft px-2 py-1.5 text-[11.5px] leading-relaxed text-warn">
            <span className="font-medium">{photo.requestedByName}</span> asked for this to come
            down: “{photo.requestReason}”
          </p>
        )}

        {error && <p className="mt-1.5 text-[11.5px] text-danger">{error}</p>}

        {!queried && allowed.ok && !asking && (
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-muted transition hover:text-ink"
          >
            <Flag size={11} aria-hidden />
            This one is wrong
          </button>
        )}

        {asking && (
          <div className="mt-1.5">
            <textarea
              autoFocus
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Not this person — this is his brother."
              className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[12px] leading-relaxed text-ink placeholder:text-faint"
            />
            <div className="mt-1.5 flex gap-1.5">
              <Button
                size="sm"
                variant="primary"
                disabled={busy || !reason.trim()}
                onClick={() => void run(() => requestPhotoRemoval(photo.id, reason.trim()))}
              >
                {busy ? (
                  <Loader2 size={13} className="animate-spin" aria-hidden />
                ) : (
                  <Flag size={13} aria-hidden />
                )}
                Send it up
              </Button>
              <Button size="sm" onClick={() => setAsking(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {queried && mayDecide && (
          <div className="mt-1.5">
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why — whoever asked will see this."
              className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[12px] leading-relaxed text-ink placeholder:text-faint"
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => void run(() => decidePhoto(photo.id, true, reason.trim()))}
              >
                <Check size={13} aria-hidden />
                Take it down
              </Button>
              <Button
                size="sm"
                disabled={busy || !reason.trim()}
                title={reason.trim() ? undefined : 'Say why it is staying up.'}
                onClick={() => void run(() => decidePhoto(photo.id, false, reason.trim()))}
              >
                Keep it
              </Button>
            </div>
          </div>
        )}

        {queried && !mayDecide && (
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">
            {photo.requestedBy === currentUserId
              ? 'Waiting on a supervisor or records.'
              : 'A supervisor or records will decide.'}
          </p>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */

const KINDS: PhotoKind[] = ['booking', 'field', 'identification', 'marks', 'other'];

function AddPhoto({ masterId, onDone }: { masterId: string; onDone: () => void }) {
  const { addPhoto } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [takenOn, setTakenOn] = useState('');
  const [kind, setKind] = useState<PhotoKind>('field');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const result = await addPhoto(masterId, file, { takenOn, kind, caption: caption.trim() });
    setBusy(false);
    if (result.ok) onDone();
    else setError(result.reason ?? 'The photograph was not accepted.');
  };

  const field =
    'w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-faint';

  return (
    <div className="mb-4 rounded-xl border border-line bg-raised p-3">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/heif,image/webp"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="hidden"
      />

      <div className="flex gap-3">
        {preview && (
          <img
            src={preview}
            alt="The photograph about to be added"
            className="h-[120px] w-[92px] shrink-0 rounded-lg border border-line object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => input.current?.click()}>
              <Upload size={14} aria-hidden />
              {file ? 'Choose a different one' : 'Choose a photograph'}
            </Button>
            {file && <span className="truncate text-[12px] text-muted">{file.name}</span>}
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-ink">Taken on</span>
              <input
                type="date"
                value={takenOn}
                onChange={(e) => setTakenOn(e.target.value)}
                className={field}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-ink">Kind</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as PhotoKind)}
                className={field}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PHOTO_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-ink">Note</span>
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Tattoo, left forearm"
                className={field}
              />
            </label>
          </div>

          {/*
            The one field worth arguing for. An undated photograph is shown as
            undated forever, because nobody comes back to fix it later.
          */}
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">
            The date is when the picture was <em>taken</em>, not today. Leave it blank only if you
            genuinely do not know — an undated photograph stays undated.
          </p>

          {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}

          <div className="mt-2.5 flex gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={!file || busy}
              onClick={() => void submit()}
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : (
                <Camera size={14} aria-hidden />
              )}
              Add it
            </Button>
            <Button size="sm" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
