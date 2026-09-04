import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Infinity as Endless, Loader2, TriangleAlert } from 'lucide-react';
import { api, type TrespassDraft } from '@/state/api';
import { useStore } from '@/state/store';
import { checkTrespass, today } from '@/domain/trespass';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * Recording a trespass notice.
 *
 * Written for the person actually entering it, who is usually a dispatcher
 * with a shop manager on the phone. That shapes two things.
 *
 * The end date offers the answers people give — a year, six months, no end
 * date — rather than a calendar to work out a date in. "Barred for a year
 * from today" is what is said on the phone, and making somebody count to next
 * August is how the field gets left blank.
 *
 * No end date is the default, because it is what most notices are, and it is
 * offered as a stated choice rather than as an empty box. A blank field could
 * mean indefinite or could mean unfinished, and those must not look the same.
 */

type Term = 'indefinite' | '6m' | '1y' | '2y' | 'date';

const TERMS: { key: Term; label: string; months: number | null }[] = [
  { key: 'indefinite', label: 'No end date', months: null },
  { key: '6m', label: '6 months', months: 6 },
  { key: '1y', label: '1 year', months: 12 },
  { key: '2y', label: '2 years', months: 24 },
  { key: 'date', label: 'Pick a date', months: null },
];

/**
 * The day before the same date N months on, which is what "a year from today"
 * means to everybody except a calendar library. Served on 15 January, a
 * one-year notice runs to 14 January.
 */
function endOfTerm(from: string, months: number): string {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + months);
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

export function RecordTrespass({
  personId,
  personName,
  locationId: fixedLocation,
  locationName: fixedLocationName,
  onClose,
  onRecorded,
}: {
  personId: string;
  personName: string;
  locationId?: string;
  locationName?: string;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const { locations } = useStore();
  const [locationId, setLocationId] = useState(fixedLocation ?? '');
  const [servedOn, setServedOn] = useState(today());
  const [term, setTerm] = useState<Term>('indefinite');
  const [customEnd, setCustomEnd] = useState('');
  const [requestedBy, setRequestedBy] = useState('');
  const [requestedByPhone, setRequestedByPhone] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [source, setSource] = useState<'officer' | 'dispatch'>('officer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renewal, setRenewal] = useState<string | null>(null);

  const places = useMemo(
    () =>
      Object.values(locations).sort((a, b) =>
        (a.commonName || a.address).localeCompare(b.commonName || b.address),
      ),
    [locations],
  );

  const expiresOn = useMemo(() => {
    if (term === 'indefinite') return '';
    if (term === 'date') return customEnd;
    const months = TERMS.find((t) => t.key === term)?.months;
    return months && servedOn ? endOfTerm(servedOn, months) : '';
  }, [term, customEnd, servedOn]);

  const draft: TrespassDraft = {
    personId,
    locationId,
    servedOn,
    expiresOn,
    requestedBy: requestedBy.trim(),
    requestedByPhone: requestedByPhone.trim(),
    caseNumber: caseNumber.trim(),
    notes: notes.trim(),
    source,
  };

  const check = checkTrespass(draft);

  const submit = async () => {
    if (!check.ok) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.recordTrespass(draft);
      if (result.renewalOf) {
        // Not a failure. Said out loud so the dispatcher knows they renewed
        // rather than duplicated, and does not go hunting for the old one.
        setRenewal(
          `Recorded. This renews a notice already in force for ${personName} at this place, served ${result.renewalOf.servedOn}.`,
        );
        setBusy(false);
        window.setTimeout(onRecorded, 2200);
        return;
      }
      onRecorded();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That could not be saved.');
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
      aria-label={`Record a trespass notice against ${personName}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="my-auto w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-xl">
        <h2 className="text-[15px] font-semibold text-ink">Record a trespass notice</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          Against <span className="text-ink">{personName}</span>. It will show on their record and
          on the place's list.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">Barred from</span>
            {fixedLocation ? (
              <p className="rounded-lg border border-line bg-canvas px-3 py-2 text-[14px] text-ink">
                {fixedLocationName}
              </p>
            ) : (
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className={field}
              >
                <option value="">Choose a place…</option>
                {places.map((place) => (
                  <option key={place.id} value={place.id}>
                    {place.commonName ? `${place.commonName} — ${place.address}` : place.address}
                  </option>
                ))}
              </select>
            )}
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink">Served on</span>
              <input
                type="date"
                value={servedOn}
                onChange={(e) => setServedOn(e.target.value)}
                className={field}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink">Taken by</span>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as 'officer' | 'dispatch')}
                className={field}
              >
                <option value="officer">An officer at the scene</option>
                <option value="dispatch">Dispatch, over the phone</option>
              </select>
            </label>
          </div>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-ink">How long for</span>
            <div className="flex flex-wrap gap-1.5">
              {TERMS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setTerm(option.key)}
                  aria-pressed={term === option.key}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] transition',
                    term === option.key
                      ? 'border-accent/50 bg-accent/10 text-ink'
                      : 'border-line bg-canvas text-muted hover:text-ink',
                  )}
                >
                  {option.key === 'indefinite' && <Endless size={13} aria-hidden />}
                  {option.label}
                </button>
              ))}
            </div>

            {term === 'date' && (
              <input
                type="date"
                value={customEnd}
                min={servedOn}
                onChange={(e) => setCustomEnd(e.target.value)}
                aria-label="Last day the notice is in force"
                className={cn(field, 'mt-2')}
              />
            )}

            <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
              {term === 'indefinite'
                ? 'It stays in force until somebody lifts it.'
                : expiresOn
                  ? `In force through ${expiresOn}. After that it stops counting on its own — it is not deleted, because a notice that was in force is evidence long after it ends.`
                  : 'Pick the last day it is in force.'}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink">Who asked for it</span>
              <input
                value={requestedBy}
                onChange={(e) => setRequestedBy(e.target.value)}
                placeholder="D. Okafor, store manager"
                className={field}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink">
                Their number <span className="font-normal text-faint">optional</span>
              </span>
              <input
                value={requestedByPhone}
                onChange={(e) => setRequestedByPhone(e.target.value)}
                placeholder="(205) 555-0148"
                className={field}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">
              Case number <span className="font-normal text-faint">optional</span>
            </span>
            <input
              value={caseNumber}
              onChange={(e) => setCaseNumber(e.target.value)}
              placeholder="2026-000431"
              className={field}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">
              Anything the next officer needs{' '}
              <span className="font-normal text-faint">optional</span>
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Covers the whole lot including the loading bay."
              className={field}
            />
          </label>
        </div>

        {error && (
          <p className="mt-3 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-danger">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        {renewal && <p className="mt-3 text-[12.5px] leading-relaxed text-ok">{renewal}</p>}

        <div className="mt-4 flex items-center justify-end gap-2">
          {!check.ok && !renewal && (
            <span className="mr-auto text-[12.5px] text-muted">{check.reason}</span>
          )}
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !check.ok || Boolean(renewal)}
            onClick={() => void submit()}
          >
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
            Record it
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
