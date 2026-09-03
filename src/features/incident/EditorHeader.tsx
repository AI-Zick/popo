import {
  AlertTriangle,
  ChevronLeft,
  Cloud,
  CornerUpLeft,
  ListTodo,
  Printer,
  Send,
  ShieldCheck,
  UserCog,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from '@/state/store';
import { Badge, Button } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { UserMenu } from '@/components/layout/UserMenu';
import type { ReportStatus } from '@/domain/types';

const STATUS: Record<ReportStatus, { label: string; tone: 'neutral' | 'accent' | 'ok' | 'warn' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  pending_review: { label: 'Pending review', tone: 'accent' },
  approved: { label: 'Approved', tone: 'ok' },
  returned: { label: 'Returned', tone: 'warn' },
};

export function EditorHeader({
  onPrint,
  rightPanel,
  onShowPanel,
}: {
  onPrint: () => void;
  rightPanel: 'check' | 'tasks';
  onShowPanel: (panel: 'check' | 'tasks') => void;
}) {
  const {
    incident,
    closeIncident,
    savedAt,
    validation,
    attemptSubmit,
    conflict,
    dismissConflict,
    lockOn,
    taskSummary,
  } = useStore();
  if (!incident) return null;

  const outstandingWork = taskSummary(incident.id);

  const heldBy = lockOn(incident.id);
  const wasReturned = incident.status === 'returned' && incident.returnedReason;
  const outstanding = (incident.reviewComments ?? []).filter((c) => !c.resolvedAt).length;

  const status = STATUS[incident.status];
  const locked = incident.status === 'pending_review' || incident.status === 'approved';

  return (
    <>
      {conflict && (
        <div className="flex items-start gap-3 border-b border-danger/35 bg-danger-soft px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-danger">{conflict.message}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink/80">
              Their version has been loaded, so nothing was overwritten. Check what changed before
              you carry on — anything you typed since your last save is not in it.
            </p>
          </div>
          <Button size="sm" onClick={dismissConflict}>
            Got it
          </Button>
        </div>
      )}

      {wasReturned && (
        <div className="flex items-start gap-3 border-b border-warn/35 bg-warn-soft px-4 py-3">
          <CornerUpLeft size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink">
              Sent back by {incident.reviewedBy || 'a supervisor'}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink/80">
              {incident.returnedReason}
            </p>
            {outstanding > 0 && (
              <p className="mt-1 text-[12.5px] text-muted">
                {outstanding} {outstanding === 1 ? 'note is' : 'notes are'} pinned to sections — they
                are in the report check panel, with the validation problems.
              </p>
            )}
          </div>
        </div>
      )}

      {heldBy && (
        <div className="flex items-center gap-2 border-b border-warn/35 bg-warn-soft px-4 py-2">
          <UserCog size={14} className="shrink-0 text-warn" aria-hidden />
          <p className="text-[12.5px] text-ink">
            <span className="font-medium">{heldBy.userName}</span> also has this report open. Two
            people editing at once will not lose work, but the second save will be refused.
          </p>
        </div>
      )}

    <header className="flex shrink-0 items-center gap-4 border-b border-line bg-surface px-4 py-2.5">
      <Button variant="ghost" onClick={closeIncident} aria-label="Back to reports">
        <ChevronLeft size={16} aria-hidden />
        Reports
      </Button>

      <div className="flex min-w-0 items-center gap-2.5">
        <h1 className="truncate font-mono text-[14px] font-semibold text-ink">{incident.caseNumber}</h1>
        <Badge tone={status.tone}>{status.label}</Badge>
        {incident.isDomestic && <Badge tone="danger">Domestic</Badge>}
        {incident.involvesJuvenile && <Badge tone="warn">Juvenile</Badge>}
      </div>

      <div className="flex-1" />

      {/*
        Two views of the same case, so one control rather than two buttons that
        each open something. The count is the reason to look: an officer with
        nothing outstanding never needs to press this.
      */}
      <div className="flex items-center gap-0.5 rounded-lg bg-raised p-0.5">
        <PanelTab active={rightPanel === 'check'} onClick={() => onShowPanel('check')}>
          <ShieldCheck size={14} aria-hidden />
          Check
          {validation.errors.length > 0 && (
            <span className="rounded bg-danger px-1 text-[11px] font-bold text-white tabular">
              {validation.errors.length}
            </span>
          )}
        </PanelTab>
        <PanelTab active={rightPanel === 'tasks'} onClick={() => onShowPanel('tasks')}>
          <ListTodo size={14} aria-hidden />
          To do
          {outstandingWork && (
            <span className="rounded bg-accent px-1 text-[11px] font-bold text-white tabular">
              {outstandingWork.split(' ')[0]}
            </span>
          )}
        </PanelTab>
      </div>

      {savedAt && (
        <span className="flex items-center gap-1.5 text-[12px] text-faint">
          <Cloud size={13} aria-hidden />
          Saved {relativeTime(savedAt)}
        </span>
      )}

      <UserMenu />

      <ThemeToggle />

      <Button onClick={onPrint} title="Print, or save as PDF">
        <Printer size={15} aria-hidden />
        Print
      </Button>

      <Button
        variant="primary"
        onClick={attemptSubmit}
        disabled={locked}
        title={locked ? 'This report has already been submitted' : undefined}
      >
        <Send size={15} aria-hidden />
        {validation.errors.length > 0 ? `Submit (${validation.errors.length} to fix)` : 'Submit'}
      </Button>
    </header>
    </>
  );
}

function PanelTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition',
        active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
