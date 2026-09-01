import { AlertTriangle, Check, Link2, Undo2, Users, X } from 'lucide-react';
import { useStore } from '@/state/store';
import { formalName } from '@/domain/person';
import type { MatchResult, MatchTier } from '@/domain/matching';
import { Badge, Button } from '@/components/ui/primitives';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';

const TIER_COPY: Record<MatchTier, { label: string; tone: 'accent' | 'warn' }> = {
  certain: { label: 'Same person', tone: 'accent' },
  strong: { label: 'Very likely the same person', tone: 'accent' },
  possible: { label: 'Possibly the same person', tone: 'warn' },
};

/**
 * Proposes existing records that look like the person being entered.
 *
 * Deliberately never merges on its own. Folding two identities together puts
 * one person's history onto another, and that is far harder to undo than
 * asking a question.
 */
export function DuplicateCandidates({ incidentPersonId }: { incidentPersonId: string }) {
  const { matchesFor, linkToMaster, historyFor } = useStore();
  const matches = matchesFor(incidentPersonId);
  if (matches.length === 0) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-accent/30 bg-accent-soft/50">
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <Users size={15} className="shrink-0 text-accent" aria-hidden />
        <p className="text-[13px] font-medium text-ink">
          {matches.length === 1
            ? 'Someone in the index looks like this person'
            : `${matches.length} people in the index look like this person`}
        </p>
      </div>
      <ul className="space-y-1.5 px-2.5 pb-2.5">
        {matches.map((match) => (
          <li key={match.master.id}>
            <CandidateRow
              match={match}
              caseCount={historyFor(match.master.id).length}
              onLink={() => linkToMaster(incidentPersonId, match.master.id)}
            />
          </li>
        ))}
      </ul>
      <p className="border-t border-accent/20 px-3.5 py-2 text-[11.5px] leading-relaxed text-muted">
        Linking reuses the existing record instead of creating a second one. If none of these is
        the right person, keep typing — a new record is saved automatically.
      </p>
    </div>
  );
}

function CandidateRow({
  match,
  caseCount,
  onLink,
}: {
  match: MatchResult;
  caseCount: number;
  onLink: () => void;
}) {
  const tier = TIER_COPY[match.tier];
  const { master } = match;

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold text-ink">
              {formalName(master)}
            </span>
            <Badge tone={tier.tone}>{tier.label}</Badge>
            {master.cautions.map((c) => (
              <Badge key={c} tone="danger">
                {c}
              </Badge>
            ))}
          </div>

          <p className="mt-1 text-[12px] text-muted">
            {[
              master.dob ? `DOB ${formatDate(master.dob)}` : null,
              master.address || null,
              `${caseCount} ${caseCount === 1 ? 'case' : 'cases'}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>

          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {match.reasons.map((reason) => (
              <li key={reason} className="flex items-center gap-1 text-[11.5px] text-ok">
                <Check size={11} strokeWidth={3} aria-hidden />
                {reason}
              </li>
            ))}
            {match.conflicts.map((conflict) => (
              <li key={conflict} className="flex items-center gap-1 text-[11.5px] text-danger">
                <AlertTriangle size={11} aria-hidden />
                {conflict}
              </li>
            ))}
          </ul>
        </div>

        <Button size="sm" variant={match.conflicts.length ? 'secondary' : 'primary'} onClick={onLink}>
          <Link2 size={13} aria-hidden />
          This is them
        </Button>
      </div>

      {match.conflicts.length > 0 && (
        <p className="mt-2 rounded-md bg-danger-soft px-2.5 py-1.5 text-[11.5px] leading-relaxed text-danger">
          Contradicting information on file. Confirm you have the right person before linking —
          check the identifier that differs first.
        </p>
      )}
    </div>
  );
}

/**
 * Shown after an identity was linked automatically on a unique identifier.
 * Automatic is only ever applied to evidence that cannot reasonably be wrong,
 * and even then it is reversible in one click.
 */
export function AutoLinkNotice() {
  const { autoLink, undoAutoLink, dismissAutoLink } = useStore();
  if (!autoLink) return null;

  return (
    <div
      className={cn(
        'mb-4 flex items-start gap-3 rounded-xl border border-ok/35 bg-ok-soft px-4 py-3',
      )}
      role="status"
    >
      <Link2 size={16} className="mt-0.5 shrink-0 text-ok" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink">
          Linked to the existing record for {autoLink.name}
        </p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
          A unique identifier matched exactly, so this person was joined to their existing file
          rather than duplicated. Their prior cases are now attached to this report.
        </p>
      </div>
      <Button size="sm" onClick={undoAutoLink}>
        <Undo2 size={13} aria-hidden />
        Undo
      </Button>
      <button
        type="button"
        onClick={dismissAutoLink}
        className="rounded-md p-1 text-faint transition hover:text-ink"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
