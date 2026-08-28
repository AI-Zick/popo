import { AlertCircle, ArrowRight, CheckCircle2, FileCheck2, Send } from 'lucide-react';
import { useStore } from '@/state/store';
import { SECTION_LABEL, SECTION_ORDER, type SectionId } from '@/domain/types';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { currency, formatDateTime } from '@/lib/format';
import { OFFENSE_BY_CODE } from '@/domain/codes';
import { personDisplayName } from '@/validation/engine';
import { cn } from '@/lib/cn';

export function SectionReview() {
  const { incident, validation, goToIssue, setSection, attemptSubmit } = useStore();
  if (!incident) return null;

  const { errors, warnings } = validation;
  const stolenTotal = incident.property
    .filter((p) => p.lossType === 'stolen')
    .reduce((sum, p) => sum + (Number(p.value.replace(/[^0-9.]/g, '')) || 0), 0);

  return (
    <div className="space-y-4">
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
            value={[incident.address, incident.city, incident.state].filter(Boolean).join(', ') || '—'}
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
            value={
              incident.persons.length
                ? incident.persons.map((p) => personDisplayName(p)).join(', ')
                : '—'
            }
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
  const map: Record<string, string> = {
    draft: 'Draft',
    pending_review: 'Pending supervisor review',
    approved: 'Approved',
    returned: 'Returned for correction',
  };
  return map[status] ?? status;
}
