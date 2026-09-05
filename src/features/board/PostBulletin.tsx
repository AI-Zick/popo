import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Loader2, Megaphone } from 'lucide-react';
import { api, ApiError } from '@/state/api';
import {
  check,
  createBulletin,
  DEFAULT_DAYS,
  KIND_DESCRIPTION,
  KIND_LABEL,
  needsExpiry,
  type Bulletin,
  type BulletinKind,
} from '@/domain/bulletin';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

const KINDS: BulletinKind[] = ['bolo', 'attemptToLocate', 'officerSafety', 'information'];

/** The date input wants `YYYY-MM-DDTHH:mm` in local time, not an ISO string. */
function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const defaultExpiry = (kind: BulletinKind): string => {
  const days = DEFAULT_DAYS[kind];
  if (!days) return '';
  return localInput(new Date(Date.now() + days * 86_400_000));
};

/**
 * Putting something on the board.
 *
 * Short on purpose. The officer filling this in is often standing next to a
 * running car with a description somebody shouted at them thirty seconds ago,
 * and every field they have to think about is a field that turns a two-minute
 * BOLO into one they post later, or not at all. Headline, what to look for,
 * and when it stops — everything else is optional and sits below.
 *
 * The expiry is filled in for them rather than demanded. A week for a lookout,
 * a month for a missing person: they are wrong often enough to be worth
 * changing and right often enough to be worth offering, and a blank date box
 * on a form nobody has time for is how a board fills with things from 2019.
 */
export function PostBulletin({
  onClose,
  onPosted,
  existing,
}: {
  onClose: () => void;
  onPosted: () => void;
  existing?: Bulletin;
}) {
  const editing = Boolean(existing);
  const [kind, setKind] = useState<BulletinKind>(existing?.kind ?? 'bolo');
  const [headline, setHeadline] = useState(existing?.headline ?? '');
  const [lookFor, setLookFor] = useState(existing?.lookFor ?? '');
  const [detail, setDetail] = useState(existing?.detail ?? '');
  const [area, setArea] = useState(existing?.area ?? '');
  const [contact, setContact] = useState(existing?.contact ?? '');
  const [caseNumber, setCaseNumber] = useState(existing?.caseNumber ?? '');
  const [expiresAt, setExpiresAt] = useState(
    existing?.expiresAt ? localInput(new Date(existing.expiresAt)) : defaultExpiry('bolo'),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /*
    Changing the kind moves the offered date with it, but never overwrites one
    already typed — somebody who has set a date meant it.
  */
  const chooseKind = (next: BulletinKind) => {
    setKind(next);
    const wasOffered = expiresAt === defaultExpiry(kind);
    if (wasOffered || !expiresAt) setExpiresAt(defaultExpiry(next));
  };

  const draft = createBulletin({
    id: existing?.id ?? 'draft',
    kind,
    headline,
    lookFor,
    detail,
    area,
    contact,
    caseNumber,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : '',
  });
  const problems = check(draft);
  const blockers = problems.filter((p) => p.severity === 'error');
  const warnings = problems.filter((p) => p.severity === 'warning');

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (blockers.length > 0 || busy) return;
    setBusy(true);
    setError('');
    const body = {
      kind,
      headline,
      lookFor,
      detail,
      area,
      contact,
      caseNumber,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : '',
    };
    try {
      if (existing) await api.editBulletin(existing.id, body);
      else await api.postBulletin(body);
      onPosted();
    } catch (problem) {
      setError(
        problem instanceof ApiError || problem instanceof Error
          ? problem.message
          : 'That could not be posted.',
      );
      setBusy(false);
    }
  };

  const field =
    'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[14px] text-ink placeholder:text-faint';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? 'Change this board entry' : 'Put something on the board'}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="my-auto w-full max-w-xl rounded-2xl border border-line bg-surface p-6 shadow-xl"
      >
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Megaphone size={17} className="text-accent" aria-hidden />
          {editing ? 'Change this entry' : 'Put something on the board'}
        </h2>

        {/* The kind first, because it changes what the rest of the form means. */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          {KINDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => chooseKind(option)}
              aria-pressed={kind === option}
              className={cn(
                'rounded-lg border px-3 py-2 text-left transition',
                kind === option
                  ? 'border-accent bg-accent-soft'
                  : 'border-line bg-canvas hover:border-line-strong',
              )}
            >
              <span className="block text-[13px] font-medium text-ink">{KIND_LABEL[option]}</span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">
                {KIND_DESCRIPTION[option]}
              </span>
            </button>
          ))}
        </div>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink">
            One line, read out at briefing
          </span>
          <input
            autoFocus
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Silver pickup, burglary on Third Street"
            className={field}
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink">What to look for</span>
          <textarea
            value={lookFor}
            onChange={(e) => setLookFor(e.target.value)}
            rows={2}
            placeholder="Silver Ford F-150, older body, partial plate 4KJ, dent in the tailgate"
            className={cn(field, 'resize-y')}
          />
        </label>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">
              {needsExpiry(kind) ? 'Until' : 'Until (optional)'}
            </span>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className={field}
            />
            <span className="mt-1 block text-[11.5px] leading-relaxed text-faint">
              {needsExpiry(kind)
                ? 'It comes off the board by itself. Extend it if it is still current.'
                : 'Leave this empty for a standing warning. You will be asked in three months whether it still holds.'}
            </span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">Who to call</span>
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Unit 12, or the desk"
              className={field}
            />
          </label>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">Area</span>
            <input
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="North end, around Third and Vine"
              className={field}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">Case number</span>
            <input
              value={caseNumber}
              onChange={(e) => setCaseNumber(e.target.value)}
              placeholder="If this came out of a report"
              className={cn(field, 'font-mono')}
            />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink">Anything else</span>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={3}
            className={cn(field, 'resize-y')}
          />
        </label>

        {/* Said while it can still be fixed, not after the button is pressed. */}
        {headline.length > 0 &&
          blockers.map((problem) => (
            <p
              key={problem.field}
              className="mt-3 flex items-start gap-2 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-[12.5px] leading-relaxed text-danger"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                {problem.message}
                {problem.tip && <span className="mt-0.5 block text-ink/70">{problem.tip}</span>}
              </span>
            </p>
          ))}

        {blockers.length === 0 &&
          warnings.map((problem) => (
            <p
              key={problem.field}
              className="mt-3 flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-[12.5px] leading-relaxed text-warn"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                {problem.message}
                {problem.tip && <span className="mt-0.5 block text-ink/75">{problem.tip}</span>}
              </span>
            </p>
          ))}

        {error && (
          <p className="mt-3 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <Button type="submit" variant="primary" disabled={blockers.length > 0 || busy}>
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
            {editing ? 'Save the change' : 'Post it'}
          </Button>
          <Button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {/*
            Warnings do not block, and the button says so rather than leaving
            somebody hunting for what is stopping them.
          */}
          {blockers.length === 0 && warnings.length > 0 && (
            <span className="self-center text-[11.5px] text-faint">
              Nothing here blocks posting.
            </span>
          )}
        </div>
      </form>
    </div>,
    document.body,
  );
}
