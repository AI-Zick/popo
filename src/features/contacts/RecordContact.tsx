import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, Loader2, TriangleAlert } from 'lucide-react';
import { api } from '@/state/api';
import {
  BASIS_HINT,
  BASIS_LABEL,
  DISPOSITION_LABEL,
  MIN_REASON_WORDS,
  adviseContact,
  checkContact,
  createSubject,
  isConclusory,
  retentionLine,
  type ContactBasis,
  type Disposition,
  type FieldContact,
} from '@/domain/fieldContact';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * Writing down a field contact.
 *
 * The whole form is arranged around one question — was this person free to
 * walk away — because that is the question that decides everything else, and
 * because officers answer it wrongly by accident all the time. Picking
 * "detained" opens the field that matters and says what the field is for; the
 * other two say plainly that no reason is needed, so nobody types one to fill
 * a box.
 *
 * The check on that field runs while it is being typed rather than on submit.
 * Being told "suspicious person" is not a reason *after* filing is a lecture;
 * being told while the cursor is still in the box is help.
 */

const BASES: ContactBasis[] = ['consensual', 'detention', 'community'];
const DISPOSITIONS: Disposition[] = [
  'advised', 'released', 'citation', 'referred', 'transported', 'arrest',
];

export function RecordContact({
  personId,
  personName,
  onClose,
  onRecorded,
}: {
  personId?: string;
  personName?: string;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [address, setAddress] = useState('');
  const [basis, setBasis] = useState<ContactBasis>('');
  const [reason, setReason] = useState('');
  const [givenName, setGivenName] = useState(personName ?? '');
  const [description, setDescription] = useState('');
  const [declined, setDeclined] = useState(false);
  const [disposition, setDisposition] = useState<Disposition>('');
  const [narrative, setNarrative] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ number: string; advice: string; years: number } | null>(null);

  const draft: Partial<FieldContact> = useMemo(
    () => ({
      occurredAt: occurredAt ? new Date(occurredAt).toISOString() : '',
      address: address.trim(),
      basis,
      reason: reason.trim(),
      disposition,
      narrative: narrative.trim(),
      subjects: [
        createSubject({
          id: 's1',
          masterId: personId ?? '',
          givenName: personId ? '' : givenName.trim(),
          description: description.trim(),
          declinedToIdentify: declined,
        }),
      ],
    }),
    [occurredAt, address, basis, reason, disposition, narrative, personId, givenName, description, declined],
  );

  const check = checkContact(draft);
  const advice = adviseContact(draft);

  /*
    Live, while the reason is being typed. Only once there is enough there to
    judge — telling somebody their two-word draft is too short before they have
    finished the sentence is nagging, not help.
  */
  const reasonProblem = useMemo(() => {
    if (basis !== 'detention') return '';
    const trimmed = reason.trim();
    if (trimmed.length < 4) return '';
    if (isConclusory(trimmed)) {
      return `“${trimmed}” is a conclusion, not something you saw. What was happening when you decided to stop them?`;
    }
    const words = trimmed.split(/\s+/).filter(Boolean).length;
    if (words < MIN_REASON_WORDS) return 'Keep going — a sentence, not a label.';
    return '';
  }, [basis, reason]);

  const submit = async () => {
    if (!check.ok) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.recordContact(draft);
      setSaved({
        number: result.contact.number,
        advice: result.advice,
        years: result.retentionYears,
      });
      setBusy(false);
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
      aria-label="Record a field contact"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="my-auto w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-xl">
        {saved ? (
          <>
            <h2 className="text-[15px] font-semibold text-ink">Recorded as {saved.number}</h2>
            {saved.advice && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-warn/45 bg-warn/5 p-3 text-[12.5px] leading-relaxed text-warn">
                <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
                {saved.advice}
              </p>
            )}
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
              {retentionLine({ occurredAt: draft.occurredAt ?? '' }, saved.years)}
            </p>
            <Button variant="primary" className="mt-4 w-full justify-center" onClick={onRecorded}>
              Done
            </Button>
          </>
        ) : (
          <>
            <h2 className="text-[15px] font-semibold text-ink">Record a field contact</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              A conversation that is not a stop and not a report.
              {personName && (
                <>
                  {' '}
                  With <span className="text-ink">{personName}</span>.
                </>
              )}
            </p>

            <div className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-ink">When</span>
                  <input
                    type="datetime-local"
                    value={occurredAt}
                    onChange={(event) => setOccurredAt(event.target.value)}
                    className={field}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-ink">Where</span>
                  <input
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder="612 N Marion St"
                    className={field}
                  />
                </label>
              </div>

              {/*
                The question the whole form turns on. Three buttons rather than
                a dropdown, because a dropdown defaults to something and this
                must not have a default — the officer has to answer it.
              */}
              <div>
                <span className="mb-1.5 block text-[13px] font-medium text-ink">
                  Were they free to walk away?
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {BASES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setBasis(option)}
                      aria-pressed={basis === option}
                      className={cn(
                        'rounded-lg border px-2.5 py-1.5 text-[12.5px] transition',
                        basis === option
                          ? option === 'detention'
                            ? 'border-warn/60 bg-warn/10 text-ink'
                            : 'border-accent/50 bg-accent/10 text-ink'
                          : 'border-line bg-canvas text-muted hover:text-ink',
                      )}
                    >
                      {BASIS_LABEL[option]}
                    </button>
                  ))}
                </div>
                {basis && (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-faint">{BASIS_HINT[basis]}</p>
                )}
              </div>

              {basis === 'detention' && (
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-ink">
                    What did you see that made you stop them?
                  </span>
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={3}
                    placeholder="Trying door handles on parked cars in the storage lot at 0215."
                    className={cn(field, reasonProblem && 'border-warn')}
                  />
                  {reasonProblem ? (
                    <span className="mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-warn">
                      <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
                      {reasonProblem}
                    </span>
                  ) : (
                    <span className="mt-1.5 block text-[12px] leading-relaxed text-faint">
                      In your words, as you would say it in court. Not a category.
                    </span>
                  )}
                </label>
              )}

              {!personId && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-ink">
                      Name given <span className="font-normal text-faint">if any</span>
                    </span>
                    <input
                      value={givenName}
                      onChange={(event) => setGivenName(event.target.value)}
                      disabled={declined}
                      className={cn(field, declined && 'opacity-50')}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-ink">Description</span>
                    <input
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Grey hoodie, red rucksack"
                      className={field}
                    />
                  </label>
                </div>
              )}

              {!personId && (
                <label className="flex cursor-pointer items-start gap-2 text-[13px] leading-relaxed text-ink">
                  <input
                    type="checkbox"
                    checked={declined}
                    onChange={(event) => setDeclined(event.target.checked)}
                    className="mt-0.5"
                  />
                  They declined to identify themselves
                </label>
              )}

              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-ink">
                  How it ended <span className="font-normal text-faint">optional</span>
                </span>
                <select
                  value={disposition}
                  onChange={(event) => setDisposition(event.target.value as Disposition)}
                  className={field}
                >
                  <option value="">Not stated</option>
                  {DISPOSITIONS.map((option) => (
                    <option key={option} value={option}>
                      {DISPOSITION_LABEL[option]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-ink">
                  What happened <span className="font-normal text-faint">optional</span>
                </span>
                <textarea
                  value={narrative}
                  onChange={(event) => setNarrative(event.target.value)}
                  rows={3}
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
            {error && (
              <p className="mt-3 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-danger">
                <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
                {error}
              </p>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              {!check.ok && (
                <span className="mr-auto text-[12.5px] text-muted">{check.reason}</span>
              )}
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
