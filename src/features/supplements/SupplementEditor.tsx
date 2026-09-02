import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  CornerUpLeft,
  Gavel,
  Loader2,
  Send,
} from 'lucide-react';
import { useStore } from '@/state/store';
import {
  SUPPLEMENT_TYPE_HINT,
  SUPPLEMENT_TYPE_LABEL,
  supplementLabel,
  type SupplementType,
} from '@/domain/supplement';
import { canReopen, canReview, REVIEW_ACTION_LABEL, STATUS_LABEL } from '@/domain/review';
import { CLEARANCE_OPTIONS, EXCEPTIONAL_CLEARANCE_REASONS } from '@/domain/codes';
import { Badge, Button, FieldGrid, Panel } from '@/components/ui/primitives';
import { SelectField, TextField, TextareaField } from '@/components/ui/fields';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

const TYPES = Object.keys(SUPPLEMENT_TYPE_LABEL) as SupplementType[];

/**
 * Writing or reviewing one supplement.
 *
 * Deliberately much smaller than the incident editor. The case already carries
 * the coded detail; a supplement's job is to say what changed and when, and
 * loading it up with the same eight sections would make filing one feel like
 * writing a second report — which is exactly why officers in other systems
 * bury follow-ups in the original narrative instead.
 */
export function SupplementEditor() {
  const {
    supplement,
    supplementProblems,
    incident,
    currentUser,
    closeSupplement,
    updateSupplement,
    submitSupplement,
    approveSupplement,
    returnSupplement,
    reopenSupplement,
    savedAt,
  } = useStore();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');

  if (!supplement || !incident) return null;

  const editable = supplement.status === 'draft' || supplement.status === 'returned';
  const mine = supplement.createdBy === currentUser.id;
  const review = canReview(currentUser, supplement);
  const reopen = canReopen(currentUser, supplement.status);
  const words = supplement.narrative.trim() ? supplement.narrative.trim().split(/\s+/).length : 0;

  const run = async (action: () => Promise<{ ok: boolean; reason?: string }>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) setNote('');
    else setError(result.reason ?? 'That did not work.');
  };

  const disposition = supplement.disposition;

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex shrink-0 items-center gap-4 border-b border-line bg-surface px-4 py-2.5">
        <Button variant="ghost" onClick={closeSupplement} aria-label="Back to the case">
          <ChevronLeft size={16} aria-hidden />
          {incident.caseNumber}
        </Button>
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate font-mono text-[14px] font-semibold text-ink">
            {supplementLabel(supplement)}
          </h1>
          <Badge tone={supplement.status === 'approved' ? 'ok' : supplement.status === 'returned' ? 'warn' : 'neutral'}>
            {STATUS_LABEL[supplement.status]}
          </Badge>
        </div>
        <div className="flex-1" />
        {savedAt && <span className="text-[12px] text-faint">Saved {relativeTime(savedAt)}</span>}
        {editable && mine && (
          <Button
            variant="primary"
            disabled={busy || supplementProblems.length > 0}
            onClick={() => void run(submitSupplement)}
            title={supplementProblems[0]?.message}
          >
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Send size={15} aria-hidden />}
            {supplementProblems.length > 0
              ? `Submit (${supplementProblems.length} to fix)`
              : 'Submit'}
          </Button>
        )}
      </header>

      {supplement.status === 'returned' && supplement.returnedReason && (
        <div className="flex items-start gap-3 border-b border-warn/35 bg-warn-soft px-4 py-3">
          <CornerUpLeft size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <div>
            <p className="text-[13px] font-medium text-ink">
              Sent back by {supplement.reviewedBy || 'a supervisor'}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink/80">
              {supplement.returnedReason}
            </p>
          </div>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
          {error && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</p>
          )}

          <fieldset disabled={!editable || !mine} className="min-w-0 space-y-4 border-0 p-0">
            <Panel
              title="What kind of supplement"
              description="This is how the case file reads later, and how a records clerk finds it."
            >
              <div className="grid grid-cols-2 gap-2">
                {TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => updateSupplement({ type })}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 text-left transition',
                      supplement.type === type
                        ? 'border-accent bg-accent-soft'
                        : 'border-line bg-canvas hover:border-line-strong',
                    )}
                  >
                    <span className="block text-[13px] font-medium text-ink">
                      {SUPPLEMENT_TYPE_LABEL[type]}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted">
                      {SUPPLEMENT_TYPE_HINT[type]}
                    </span>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel
              title="What happened"
              description="Say when you learned it, where it came from, and what it changes. This is the part read in two years."
            >
              <TextareaField
                path="supplement.narrative"
                label="Supplement narrative"
                required
                rows={14}
                placeholder="On 20 March I received the latent print comparison from the state lab…"
                value={supplement.narrative}
                onChange={(v) => updateSupplement({ narrative: v })}
              />
              <p className="mt-2 text-[12px] text-faint tabular">{words.toLocaleString()} words</p>
            </Panel>

            <Panel
              title="Does this change how the case stands?"
              description="Most supplements do not. The ones that do have to say so here — a clearance buried in a narrative never reaches the statistics."
              aside={<Gavel size={17} className="text-faint" aria-hidden />}
            >
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={disposition !== null}
                  onChange={(e) =>
                    updateSupplement({
                      disposition: e.target.checked
                        ? {
                            clearanceStatus: 'cleared_arrest',
                            exceptionalClearanceReason: '',
                            clearedAt: '',
                          }
                        : null,
                      arrest: e.target.checked ? supplement.arrest : null,
                    })
                  }
                  className="mt-0.5 size-4 rounded border-line-strong"
                />
                <span className="text-[13.5px] text-ink">
                  This supplement changes the case status
                  <span className="mt-0.5 block text-[12px] text-muted">
                    Currently{' '}
                    <strong className="text-ink">
                      {CLEARANCE_OPTIONS.find((o) => o.value === incident.clearanceStatus)?.label}
                    </strong>
                    . The change is applied when a supervisor approves this supplement, not before.
                  </span>
                </span>
              </label>

              {disposition && (
                <div className="mt-4 space-y-4 border-t border-line pt-4">
                  <FieldGrid cols={2}>
                    <SelectField
                      path="supplement.clearanceStatus"
                      label="New status"
                      required
                      options={CLEARANCE_OPTIONS}
                      value={disposition.clearanceStatus}
                      onChange={(v) =>
                        updateSupplement({
                          disposition: { ...disposition, clearanceStatus: v as never },
                        })
                      }
                    />
                    <TextField
                      path="supplement.clearedAt"
                      label="Date it reached that status"
                      type="date"
                      required
                      hint="Rarely today. This date drives the statistics."
                      value={disposition.clearedAt}
                      onChange={(v) => updateSupplement({ disposition: { ...disposition, clearedAt: v } })}
                    />
                  </FieldGrid>

                  {disposition.clearanceStatus === 'cleared_exceptional' && (
                    <SelectField
                      path="supplement.exceptionalClearanceReason"
                      label="Why it could not be cleared by arrest"
                      required
                      options={EXCEPTIONAL_CLEARANCE_REASONS}
                      value={disposition.exceptionalClearanceReason}
                      onChange={(v) =>
                        updateSupplement({
                          disposition: { ...disposition, exceptionalClearanceReason: v },
                        })
                      }
                    />
                  )}

                  {disposition.clearanceStatus === 'cleared_arrest' && (
                    <div className="rounded-xl border border-line bg-raised p-4">
                      <p className="text-[13px] font-medium text-ink">Who was arrested</p>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
                        The arrest is usually booked under its own case number weeks later, so this
                        is a reference to it rather than a person on this report.
                      </p>
                      <FieldGrid cols={3}>
                        <TextField
                          path="supplement.arrest.personName"
                          label="Name"
                          value={supplement.arrest?.personName ?? ''}
                          onChange={(v) =>
                            updateSupplement({
                              arrest: {
                                personName: v,
                                arrestDate: supplement.arrest?.arrestDate ?? '',
                                arrestCaseNumber: supplement.arrest?.arrestCaseNumber ?? '',
                              },
                            })
                          }
                        />
                        <TextField
                          path="supplement.arrest.arrestDate"
                          label="Arrest date"
                          type="date"
                          value={supplement.arrest?.arrestDate ?? ''}
                          onChange={(v) =>
                            updateSupplement({
                              arrest: {
                                personName: supplement.arrest?.personName ?? '',
                                arrestDate: v,
                                arrestCaseNumber: supplement.arrest?.arrestCaseNumber ?? '',
                              },
                            })
                          }
                        />
                        <TextField
                          path="supplement.arrest.arrestCaseNumber"
                          label="Arrest case number"
                          hint="If it was booked separately."
                          value={supplement.arrest?.arrestCaseNumber ?? ''}
                          onChange={(v) =>
                            updateSupplement({
                              arrest: {
                                personName: supplement.arrest?.personName ?? '',
                                arrestDate: supplement.arrest?.arrestDate ?? '',
                                arrestCaseNumber: v,
                              },
                            })
                          }
                        />
                      </FieldGrid>
                    </div>
                  )}
                </div>
              )}
            </Panel>
          </fieldset>

          {editable && mine && supplementProblems.length > 0 && (
            <Panel title={`Before this can go up (${supplementProblems.length})`}>
              <ul className="space-y-2">
                {supplementProblems.map((problem, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                    <div>
                      <p className="text-[13px] text-ink">{problem.message}</p>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{problem.tip}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {!editable && !review.ok && !reopen.ok && (
            <p className="rounded-xl border border-line bg-raised px-4 py-3 text-[12.5px] leading-relaxed text-muted">
              {supplement.status === 'pending_review'
                ? 'This supplement is with a supervisor and cannot be edited until it comes back.'
                : 'This supplement has been approved and is part of the case file.'}
            </p>
          )}

          {(review.ok || reopen.ok) && (
            <SupplementReview
              busy={busy}
              note={note}
              setNote={setNote}
              canApprove={review.ok}
              canReopen={reopen.ok}
              carriesDisposition={disposition !== null}
              onApprove={() => void run(() => approveSupplement(note.trim()))}
              onReturn={() => void run(() => returnSupplement(note.trim()))}
              onReopen={() => void run(() => reopenSupplement(note.trim()))}
            />
          )}

          {supplement.reviewHistory.length > 0 && (
            <Panel title="History">
              <ul className="space-y-1.5">
                {[...supplement.reviewHistory].reverse().map((entry) => (
                  <li key={entry.id} className="text-[12.5px] text-muted">
                    <span className="font-medium text-ink">{REVIEW_ACTION_LABEL[entry.action]}</span>{' '}
                    by {entry.actorName} · {relativeTime(entry.at)}
                    {entry.note && <span className="block text-[12px] text-faint">“{entry.note}”</span>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </main>
    </div>
  );
}

function SupplementReview({
  busy,
  note,
  setNote,
  canApprove,
  canReopen: mayReopen,
  carriesDisposition,
  onApprove,
  onReturn,
  onReopen,
}: {
  busy: boolean;
  note: string;
  setNote: (v: string) => void;
  canApprove: boolean;
  canReopen: boolean;
  carriesDisposition: boolean;
  onApprove: () => void;
  onReturn: () => void;
  onReopen: () => void;
}) {
  return (
    <Panel
      title="Supervisor review"
      description={
        canApprove
          ? 'Approve it, or send it back with what needs fixing.'
          : 'This supplement is approved. Reopening puts it back to its author.'
      }
      aside={<Badge tone="accent">Reviewer</Badge>}
    >
      {carriesDisposition && canApprove && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-warn/35 bg-warn-soft/50 px-3 py-2 text-[12.5px] leading-relaxed text-ink">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          Approving this changes the case status, and with it what the agency reports to the state.
        </p>
      )}

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={canApprove ? 'Note — required if you send it back' : 'Why this is being reopened'}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px] text-ink placeholder:text-faint"
      />

      <div className="mt-3 flex gap-2">
        {canApprove && (
          <>
            <Button variant="primary" disabled={busy} onClick={onApprove}>
              <Check size={15} aria-hidden />
              Approve
            </Button>
            <Button disabled={busy || !note.trim()} onClick={onReturn}>
              <CornerUpLeft size={15} aria-hidden />
              Return for correction
            </Button>
          </>
        )}
        {mayReopen && (
          <Button disabled={busy || !note.trim()} onClick={onReopen}>
            <CornerUpLeft size={15} aria-hidden />
            Reopen
          </Button>
        )}
      </div>
    </Panel>
  );
}
