import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, Loader2, Plus, TriangleAlert, X } from 'lucide-react';
import { ApiError, api } from '@/state/api';
import {
  adviseCitation,
  checkCitation,
  createViolation,
  type Citation,
  type Violation,
} from '@/domain/citation';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * Recording a citation an officer has already issued.
 *
 * The fallback for a dead MDT, no coverage, or a paper book — all common, all
 * ending with somebody keying a ticket in later.
 *
 * The framing is the design. This is not a screen that issues a citation:
 * somebody was handed a numbered ticket at the roadside, and this transcribes
 * it. That is why the number comes first and is required, why the time asked
 * for is when it was handed over rather than now, and why the screen says both
 * of those things out loud. It is also what makes the number safe to
 * reconcile against when the MDT submission eventually arrives.
 */
export function RecordCitation({
  personId,
  personName,
  stopId,
  onClose,
  onRecorded,
}: {
  personId?: string;
  personName?: string;
  stopId?: string;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [number, setNumber] = useState('');
  const [issuedAt, setIssuedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [subjectName, setSubjectName] = useState(personName ?? '');
  const [driverLicense, setDriverLicense] = useState('');
  const [plate, setPlate] = useState('');
  const [plateState, setPlateState] = useState('');
  const [location, setLocation] = useState('');
  const [court, setCourt] = useState('');
  const [courtDate, setCourtDate] = useState('');
  const [notes, setNotes] = useState('');
  const [violations, setViolations] = useState<Violation[]>([
    createViolation({ id: 'v1' }),
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clash, setClash] = useState<Citation | null>(null);
  const [saved, setSaved] = useState<{ number: string; advice: string } | null>(null);

  const draft: Partial<Citation> = useMemo(
    () => ({
      number: number.trim(),
      issuedAt: issuedAt ? new Date(issuedAt).toISOString() : '',
      recordedAt: new Date().toISOString(),
      personId: personId ?? '',
      subjectName: subjectName.trim(),
      driverLicense: driverLicense.trim(),
      plate: plate.trim(),
      plateState: plateState.trim(),
      location: location.trim(),
      stopId: stopId ?? '',
      court: court.trim(),
      courtDate,
      notes: notes.trim(),
      violations: violations.filter((v) => v.statute.trim() || v.description.trim()),
    }),
    [number, issuedAt, personId, subjectName, driverLicense, plate, plateState, location, stopId, court, courtDate, notes, violations],
  );

  const check = checkCitation(draft);
  const advice = adviseCitation(draft);

  const update = (id: string, patch: Partial<Violation>) =>
    setViolations((list) => list.map((v) => (v.id === id ? { ...v, ...patch } : v)));

  const submit = async () => {
    if (!check.ok) return;
    setBusy(true);
    setError(null);
    setClash(null);
    try {
      const result = await api.recordCitation(draft);
      setSaved({ number: result.citation.number, advice: result.advice });
      setBusy(false);
    } catch (problem) {
      /*
        Already on file, because the MDT got there first. Not a failure — the
        officer is holding a ticket they wrote and cannot know what has been
        submitted — so the answer shows them what is there.
      */
      const body = problem instanceof ApiError ? (problem.body as { citation?: Citation } | null) : null;
      if (body?.citation) setClash(body.citation);
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
      aria-label="Record a citation you have issued"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="my-auto w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-xl">
        {saved ? (
          <>
            <h2 className="text-[15px] font-semibold text-ink">Recorded {saved.number}</h2>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
              If the MDT submits this same number later, it will fill in this record rather than
              making a second one.
            </p>
            {saved.advice && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-warn/45 bg-warn/5 p-3 text-[12.5px] leading-relaxed text-warn">
                <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
                {saved.advice}
              </p>
            )}
            <Button variant="primary" className="mt-4 w-full justify-center" onClick={onRecorded}>
              Done
            </Button>
          </>
        ) : (
          <>
            <h2 className="text-[15px] font-semibold text-ink">Record a citation you issued</h2>
            {/*
              The framing, said first and plainly. Somebody was handed a ticket;
              this writes down the one that exists.
            */}
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              For when the MDT was down, out of coverage, or you wrote it from the book. This
              records a ticket that has already been handed over — it does not issue one.
            </p>

            <div className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-ink">
                    Number on the ticket
                  </span>
                  <input
                    autoFocus
                    value={number}
                    onChange={(event) => setNumber(event.target.value)}
                    placeholder="A-4471902"
                    className={cn(field, 'font-mono')}
                  />
                  <span className="mt-1 block text-[12px] leading-relaxed text-faint">
                    How the court, the clerk and the driver all know this one.
                  </span>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-ink">
                    When you handed it over
                  </span>
                  <input
                    type="datetime-local"
                    value={issuedAt}
                    onChange={(event) => setIssuedAt(event.target.value)}
                    className={field}
                  />
                  <span className="mt-1 block text-[12px] leading-relaxed text-faint">
                    The roadside time, not now.
                  </span>
                </label>
              </div>

              {!personId && (
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-ink">Issued to</span>
                  <input
                    value={subjectName}
                    onChange={(event) => setSubjectName(event.target.value)}
                    placeholder="Whitfield, Dana Marie"
                    className={field}
                  />
                </label>
              )}

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-[13px] font-medium text-ink">
                    Licence <span className="font-normal text-faint">optional</span>
                  </span>
                  <input
                    value={driverLicense}
                    onChange={(event) => setDriverLicense(event.target.value)}
                    className={cn(field, 'font-mono')}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-ink">Plate</span>
                  <div className="flex gap-2">
                    <input
                      value={plate}
                      onChange={(event) => setPlate(event.target.value)}
                      className={cn(field, 'font-mono')}
                    />
                    <input
                      value={plateState}
                      onChange={(event) => setPlateState(event.target.value.toUpperCase().slice(0, 2))}
                      placeholder="AL"
                      aria-label="Plate state"
                      className={cn(field, 'w-16 shrink-0 text-center font-mono')}
                    />
                  </div>
                </label>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-ink">Where</span>
                <input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="US-411 at Watson Rd"
                  className={field}
                />
              </label>

              {/* ---- What it was for ------------------------------------ */}
              <div>
                <span className="mb-1.5 block text-[13px] font-medium text-ink">What for</span>
                <div className="space-y-2">
                  {violations.map((violation) => (
                    <div key={violation.id} className="rounded-lg border border-line p-3">
                      <div className="flex gap-2">
                        <input
                          value={violation.description}
                          onChange={(event) => update(violation.id, { description: event.target.value })}
                          placeholder="Speeding"
                          className={cn(field, 'flex-1')}
                        />
                        {violations.length > 1 && (
                          <button
                            type="button"
                            aria-label="Remove this line"
                            onClick={() => setViolations((l) => l.filter((v) => v.id !== violation.id))}
                            className="rounded-lg p-2 text-faint transition hover:text-danger"
                          >
                            <X size={15} aria-hidden />
                          </button>
                        )}
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <input
                          value={violation.statute}
                          onChange={(event) => update(violation.id, { statute: event.target.value })}
                          placeholder="Statute"
                          className={cn(field, 'font-mono text-[13px]')}
                        />
                        <input
                          value={violation.speed}
                          onChange={(event) => update(violation.id, { speed: event.target.value })}
                          placeholder="Speed"
                          className={cn(field, 'text-[13px]')}
                        />
                        <input
                          value={violation.speedLimit}
                          onChange={(event) => update(violation.id, { speedLimit: event.target.value })}
                          placeholder="Limit"
                          className={cn(field, 'text-[13px]')}
                        />
                      </div>
                      <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12.5px] text-ink">
                        <input
                          type="checkbox"
                          checked={violation.warningOnly}
                          onChange={(event) => update(violation.id, { warningOnly: event.target.checked })}
                        />
                        Written warning only
                      </label>
                    </div>
                  ))}
                </div>
                <Button
                  size="sm"
                  className="mt-2"
                  onClick={() =>
                    setViolations((l) => [...l, createViolation({ id: `v${l.length + 1}-${Date.now()}` })])
                  }
                >
                  <Plus size={13} aria-hidden />
                  Another line
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-ink">
                    Court <span className="font-normal text-faint">optional</span>
                  </span>
                  <input
                    value={court}
                    onChange={(event) => setCourt(event.target.value)}
                    className={field}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-ink">
                    Appear on <span className="font-normal text-faint">optional</span>
                  </span>
                  <input
                    type="date"
                    value={courtDate}
                    onChange={(event) => setCourtDate(event.target.value)}
                    className={field}
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-ink">
                  Notes <span className="font-normal text-faint">optional</span>
                </span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={2}
                  className={field}
                />
              </label>
            </div>

            {advice && (
              <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-warn/45 bg-warn/5 p-3 text-[12.5px] leading-relaxed text-warn">
                <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
                {advice}
              </p>
            )}

            {clash && (
              <div className="mt-3 rounded-lg border border-warn/45 bg-warn/5 p-3 text-[12.5px] leading-relaxed text-warn">
                <p className="font-medium">That number is already on file.</p>
                <p className="mt-1">
                  Recorded {clash.recordedAt.slice(0, 10)}
                  {clash.officerName && ` by ${clash.officerName}`}. Nothing has been changed — if
                  this is the same ticket, it is already here.
                </p>
              </div>
            )}
            {error && !clash && (
              <p className="mt-3 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-danger">
                <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
                {error}
              </p>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              {!check.ok && <span className="mr-auto text-[12.5px] text-muted">{check.reason}</span>}
              <Button onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" disabled={busy || !check.ok} onClick={() => void submit()}>
                {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
                Record it
              </Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
