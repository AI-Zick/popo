import { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock,
  CheckSquare,
  Clock,
  Loader2,
  PauseCircle,
  Square,
  TriangleAlert,
  UserCheck,
} from 'lucide-react';
import { api, type CaseWork } from '@/state/api';
import { useStore } from '@/state/store';
import {
  ASSIGN_THRESHOLD,
  DECISION_LABEL,
  FACTORS,
  MAX_SCORE,
  STATUS_LABEL,
  scoringFactors,
} from '@/domain/investigation';
import { Button, Panel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { SuspendCase } from './SuspendCase';
import { ReviewCase } from './ReviewCase';

/**
 * How a case is being worked.
 *
 * Everything on this panel is about a decision somebody has to make and be
 * answerable for. So the order is: what will be lost if nobody acts (the
 * limitation period), who has it, what it has to go on, and when somebody last
 * looked.
 *
 * The solvability score is shown with what it is made of, never on its own. A
 * bare number invites being treated as a verdict, and the whole design of the
 * checklist is that it is a prompt for a person, not a substitute for one.
 */
export function CaseWorkPanel({ caseId }: { caseId: string }) {
  const { can, users, currentUser } = useStore();
  const [work, setWork] = useState<CaseWork | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setWork(await api.investigation(caseId));
    } catch {
      setError('Could not load how this case is being worked.');
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleFactor = async (key: string) => {
    if (!work) return;
    setBusy(true);
    const next = { ...work.investigation.factors };
    if (next[key]) delete next[key];
    else next[key] = true;
    try {
      setWork(await api.scoreCase(caseId, next));
    } catch {
      setError('That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const assign = async (detectiveId: string) => {
    setBusy(true);
    try {
      setWork(await api.assignCase(caseId, detectiveId));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  if (error && !work) {
    return (
      <Panel title="Investigation" description="How this case is being worked.">
        <p className="flex items-start gap-1.5 text-[13px] text-danger">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      </Panel>
    );
  }

  if (!work) {
    return (
      <Panel title="Investigation" description="How this case is being worked.">
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 size={15} className="animate-spin" aria-hidden />
          Loading…
        </p>
      </Panel>
    );
  }

  const { investigation, status, score, limitation } = work;
  const mayManage = can('reports.approve');
  const answered = scoringFactors(investigation.factors);

  return (
    <Panel title="Investigation" description="Who has this case, and what it has to go on.">
      <div className="space-y-3">
        {/*
          First, because it is the only clock here nobody can extend. A case
          worked past it was work that could never have gone anywhere.
        */}
        {limitation.line && (
          <p
            className={cn(
              'flex items-start gap-2 rounded-lg border p-3 text-[13px] leading-relaxed',
              limitation.expired
                ? 'border-danger/50 bg-danger/5 text-danger'
                : limitation.soon
                  ? 'border-warn/50 bg-warn/5 text-warn'
                  : 'border-line text-muted',
            )}
          >
            <Clock size={14} className="mt-0.5 shrink-0" aria-hidden />
            {limitation.line}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'rounded border px-2 py-0.5 text-[11.5px] uppercase tracking-wide',
              status === 'suspended'
                ? 'border-warn/50 text-warn'
                : status === 'unassigned'
                  ? 'border-line text-muted'
                  : 'border-accent/50 text-accent',
            )}
          >
            {STATUS_LABEL[status]}
          </span>
          {investigation.assignedToName && (
            <span className="text-[13px] text-ink">
              {investigation.assignedToName}
              <span className="text-faint"> since {investigation.assignedAt.slice(0, 10)}</span>
            </span>
          )}
          {work.reviewOverdueBy > 0 && (
            <span className="flex items-center gap-1 text-[12.5px] text-warn">
              <CalendarClock size={12} aria-hidden />
              Review {work.reviewOverdueBy} days overdue
            </span>
          )}
          {work.reviewDue && work.reviewOverdueBy === 0 && (
            <span className="text-[12.5px] text-faint">Next review {work.reviewDue}</span>
          )}
        </div>

        {investigation.suspendedAt && (
          <div
            className={cn(
              'rounded-lg border p-3 text-[12.5px] leading-relaxed',
              investigation.suspendedAgainstPolicy
                ? 'border-danger/50 bg-danger/5 text-danger'
                : 'border-line text-muted',
            )}
          >
            {investigation.suspendedAgainstPolicy && (
              <p className="mb-1 font-medium">
                Suspended against policy — this is an offence the agency works regardless.
              </p>
            )}
            <p>
              Suspended {investigation.suspendedAt.slice(0, 10)}: {investigation.suspendedReason}
            </p>
          </div>
        )}

        {mayManage && (
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">
              {investigation.assignedToId ? 'Assigned to' : 'Give it to'}
            </span>
            <select
              value={investigation.assignedToId}
              disabled={busy}
              onChange={(event) => void assign(event.target.value)}
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[14px] text-ink"
            >
              <option value="">Nobody yet</option>
              {users
                .filter((user) => user.active)
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                    {user.id === currentUser.id ? ' (you)' : ''}
                  </option>
                ))}
            </select>
          </label>
        )}

        {/* ---- Solvability ------------------------------------------- */}
        <div className="rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[13px] font-medium text-ink">What it has to go on</span>
            <span className="text-[12.5px] text-muted">
              {score} of {MAX_SCORE}
              {score >= ASSIGN_THRESHOLD && <span className="text-ok"> · worth assigning</span>}
            </span>
          </div>

          {/*
            The caveat sits with the number, not in a footnote. This checklist
            was built for burglaries; a case with no witness and no forensics
            scores near zero whatever it is, and the offences the agency works
            regardless are exactly the ones that score worst on it.
          */}
          {work.mustBeWorked ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-warn">
              <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
              This is an offence the agency works regardless of what this adds up to. The score is
              for deciding where to start, not whether to.
            </p>
          ) : (
            <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
              A prompt for a person, not a verdict. A low score is a case with little to go on, not
              a case that did not matter.
            </p>
          )}

          <ul className="mt-2 space-y-1">
            {FACTORS.map((factor) => {
              const on = Boolean(investigation.factors[factor.key]);
              return (
                <li key={factor.key}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void toggleFactor(factor.key)}
                    aria-pressed={on}
                    title={factor.hint}
                    className={cn(
                      'flex w-full items-start gap-2 rounded px-1.5 py-1 text-left text-[12.5px] transition',
                      on ? 'text-ink' : 'text-muted hover:text-ink',
                    )}
                  >
                    {on ? (
                      <CheckSquare size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                    ) : (
                      <Square size={14} className="mt-0.5 shrink-0 text-faint" aria-hidden />
                    )}
                    <span className="flex-1">{factor.question}</span>
                    <span className="shrink-0 text-faint">{factor.weight}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {answered.length > 0 && (
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Carrying it: {answered.map((f) => f.question.replace(/\?$/, '').toLowerCase()).join(', ')}.
            </p>
          )}
          {investigation.scoredAt && (
            <p className="mt-1 text-[12px] text-faint">
              Last answered {investigation.scoredAt.slice(0, 10)}.
            </p>
          )}
        </div>

        {/* ---- Reviews ------------------------------------------------ */}
        {investigation.reviews.length > 0 && (
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer list-none text-[13px] font-medium text-ink">
              {investigation.reviews.length}{' '}
              {investigation.reviews.length === 1 ? 'review' : 'reviews'}
            </summary>
            <ul className="mt-2 space-y-2">
              {[...investigation.reviews].reverse().map((review) => (
                <li key={review.id} className="border-l border-line pl-3 text-[12.5px] leading-relaxed">
                  <span className="text-ink">{DECISION_LABEL[review.decision]}</span>
                  <span className="text-faint">
                    {' '}
                    — {review.at.slice(0, 10)}, {review.byName}
                  </span>
                  {review.note && <p className="text-muted">{review.note}</p>}
                </li>
              ))}
            </ul>
          </details>
        )}

        {mayManage && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setReviewing(true)}>
              <UserCheck size={13} aria-hidden />
              Record a review
            </Button>
            {!investigation.suspendedAt && !investigation.closedAt && (
              <Button size="sm" onClick={() => setSuspending(true)}>
                <PauseCircle size={13} aria-hidden />
                Suspend it
              </Button>
            )}
          </div>
        )}

        {error && <p className="text-[12.5px] text-danger">{error}</p>}
      </div>

      {suspending && (
        <SuspendCase
          caseId={caseId}
          work={work}
          onClose={() => setSuspending(false)}
          onDone={(next) => {
            setSuspending(false);
            setWork(next);
          }}
        />
      )}
      {reviewing && (
        <ReviewCase
          caseId={caseId}
          onClose={() => setReviewing(false)}
          onDone={(next) => {
            setReviewing(false);
            setWork(next);
          }}
        />
      )}
    </Panel>
  );
}
