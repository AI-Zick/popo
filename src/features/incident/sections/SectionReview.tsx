import { useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, FileCheck2, Send, Undo2 } from 'lucide-react';
import { useStore } from '@/state/store';
import { SECTION_LABEL, SECTION_ORDER, type SectionId } from '@/domain/types';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { currency, formatDateTime } from '@/lib/format';
import { OFFENSE_BY_CODE } from '@/domain/codes';
import { personDisplayName } from '@/validation/engine';
import { fullAddress } from '@/domain/location';
import { cn } from '@/lib/cn';
import { ReviewPanel } from '@/features/review/ReviewPanel';
import { canRecall, STATUS_LABEL } from '@/domain/review';

/**
 * Submitted, and what to do about remembering something afterwards.
 *
 * Without a way back, an officer who realises they left out the second
 * witness has two options: ask a supervisor to return it — which puts
 * "returned for correction" on a report nothing was wrong with — or say
 * nothing. The second is what actually happens, and it is how a report goes
 * into the record incomplete.
 *
 * It disappears the moment a supervisor has left a note, because from then on
 * taking it back would drop what they asked for. `canRecall` holds that rule.
 */
function WaitingOnSupervisor() {
  const { incident, currentUser, recallReport } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!incident) return null;

  const recall = canRecall(currentUser, incident);

  return (
    <div className="rounded-xl border border-accent/35 bg-accent-soft p-4">
      <p className="text-[14px] font-semibold text-ink">Waiting on a supervisor</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        Submitted {incident.submittedAt ? formatDateTime(incident.submittedAt) : ''}. It is
        read-only until it comes back or is approved.
      </p>
      {recall.ok ? (
        <div className="mt-3">
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError('');
              void recallReport().then((result) => {
                setBusy(false);
                if (!result.ok) setError(result.reason ?? 'That did not work.');
              });
            }}
          >
            <Undo2 size={15} aria-hidden />
            Take it back to finish something
          </Button>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">
            Puts it back in your drafts. It stays on the report's history, so this is not a way to
            un-submit quietly.
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[11.5px] leading-relaxed text-faint">{recall.reason}</p>
      )}
      {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
    </div>
  );
}

export function SectionReview() {
  const { incident, persons, location, validation, goToIssue, setSection, attemptSubmit } =
    useStore();
  if (!incident) return null;

  const { errors, warnings } = validation;
  const stolenTotal = incident.property
    .filter((p) => p.lossType === 'stolen')
    .reduce((sum, p) => sum + (Number(p.value.replace(/[^0-9.]/g, '')) || 0), 0);

  return (
    <div className="space-y-4">
      {incident.status === 'returned' && incident.returnedReason && (
        <div className="rounded-xl border border-warn/35 bg-warn-soft p-4">
          <p className="text-[14px] font-semibold text-ink">
            Sent back by {incident.reviewedBy || 'a supervisor'}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink/85">{incident.returnedReason}</p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
            Anything they pinned to a section is in the report check panel on the right, alongside
            the validation problems. Mark each one done as you deal with it.
          </p>
        </div>
      )}

      {incident.status === 'pending_review' && <WaitingOnSupervisor />}

      <ReviewPanel />

      {/* -------- Readiness banner ---------------------------------------- */}
      <div
        className={cn(
          'rounded-xl border p-5',
          errors.length === 0 ? 'border-ok/35 bg-ok-soft' : 'border-danger/35 bg-danger-soft',
        )}
      >
        <div className="flex items-start gap-3.5">
          {errors.length === 0 ? (
            <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-ok" aria-hidden />
          ) : (
            <AlertCircle size={22} className="mt-0.5 shrink-0 text-danger" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-ink">
              {errors.length === 0
                ? 'This report is ready to submit'
                : `${errors.length} ${errors.length === 1 ? 'problem has' : 'problems have'} to be fixed first`}
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              {errors.length === 0
                ? warnings.length > 0
                  ? `Nothing is blocking submission. There ${warnings.length === 1 ? 'is 1 suggestion' : `are ${warnings.length} suggestions`} worth a second look, but they will not stop this from going to your supervisor.`
                  : 'Every required field is complete and all cross-checks passed.'
                : 'Each one below jumps straight to the field it belongs to, with a note on how to resolve it.'}
            </p>

            {errors.length > 0 && (
              <ul className="mt-3.5 space-y-1.5">
                {errors.slice(0, 6).map((issue) => (
                  <li key={issue.key}>
                    <button
                      type="button"
                      onClick={() => goToIssue(issue)}
                      className="group flex w-full items-center gap-2.5 rounded-lg border border-danger/25 bg-surface px-3 py-2 text-left transition hover:border-danger/50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">
                          {issue.title}
                        </span>
                        <span className="block truncate text-[11.5px] text-faint">
                          {SECTION_LABEL[issue.section]}
                          {issue.scope ? ` · ${issue.scope}` : ''}
                        </span>
                      </span>
                      <ArrowRight
                        size={14}
                        className="shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-danger"
                        aria-hidden
                      />
                    </button>
                  </li>
                ))}
                {errors.length > 6 && (
                  <li className="pl-1 text-[12.5px] text-muted">
                    and {errors.length - 6} more in the panel on the right.
                  </li>
                )}
              </ul>
            )}

            <div className="mt-4 flex gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  const ok = attemptSubmit();
                  if (ok) setSection('review');
                }}
                disabled={incident.status !== 'draft' && incident.status !== 'returned'}
              >
                <Send size={15} aria-hidden />
                {errors.length === 0 ? 'Submit for supervisor review' : 'Try to submit'}
              </Button>
              {errors.length > 0 && (
                <Button onClick={() => goToIssue(errors[0])}>Go to first problem</Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* -------- Section completeness ------------------------------------ */}
      <Panel title="Section status" description="Where the remaining work is.">
        <ul className="divide-y divide-line">
          {SECTION_ORDER.filter((s) => s !== 'review').map((section) => {
            const errs = validation.errorCountBySection[section];
            const warns = validation.warningCountBySection[section];
            return (
              <li key={section}>
                <button
                  type="button"
                  onClick={() => setSection(section as SectionId)}
                  className="flex w-full items-center gap-3 py-2.5 text-left transition hover:opacity-80"
                >
                  {errs > 0 ? (
                    <AlertCircle size={16} className="shrink-0 text-danger" aria-hidden />
                  ) : (
                    <CheckCircle2 size={16} className="shrink-0 text-ok" aria-hidden />
                  )}
                  <span className="flex-1 text-[13.5px] font-medium text-ink">
                    {SECTION_LABEL[section]}
                  </span>
                  {errs > 0 && <Badge tone="danger">{errs} to fix</Badge>}
                  {warns > 0 && <Badge tone="warn">{warns} to review</Badge>}
                  {errs === 0 && warns === 0 && <Badge tone="ok">Complete</Badge>}
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>

      {/* -------- Summary -------------------------------------------------- */}
      <Panel title="Report summary" aside={<FileCheck2 size={17} className="text-faint" aria-hidden />}>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-[13px]">
          <Row label="Case number" value={incident.caseNumber} mono />
          <Row label="Status" value={statusLabel(incident.status)} />
          <Row label="Reported" value={formatDateTime(incident.reportedAt)} />
          <Row
            label="Occurred"
            value={
              incident.occurredIsRange
                ? `${formatDateTime(incident.occurredFrom)} — ${formatDateTime(incident.occurredTo)}`
                : formatDateTime(incident.occurredFrom)
            }
          />
          <Row
            label="Location"
            value={fullAddress(location ?? undefined, incident.locationUnit) || '—'}
          />
          <Row label="Reporting officer" value={incident.reportingOfficer || '—'} />
          <Row
            label="Offenses"
            value={
              incident.offenses.length
                ? incident.offenses
                    .map((o) => OFFENSE_BY_CODE.get(o.code)?.label ?? 'Unspecified')
                    .join(', ')
                : '—'
            }
          />
          <Row
            label="People"
            value={persons.length ? persons.map((p) => personDisplayName(p)).join(', ') : '—'}
          />
          <Row label="Property items" value={String(incident.property.length)} />
          <Row label="Stolen property value" value={stolenTotal ? currency(stolenTotal) : '—'} />
          <Row label="Vehicles" value={String(incident.vehicles.length)} />
          <Row
            label="Narrative"
            value={`${incident.narrative.trim() ? incident.narrative.trim().split(/\s+/).length : 0} words`}
          />
        </dl>
      </Panel>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] uppercase tracking-wide text-faint">{label}</dt>
      <dd className={cn('mt-0.5 truncate text-ink', mono && 'font-mono text-[12.5px]')}>{value}</dd>
    </div>
  );
}

function statusLabel(status: string): string {
  return STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status;
}
