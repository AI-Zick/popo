import {
  AlertTriangle,
  ChevronLeft,
  Cloud,
  CornerUpLeft,
  Briefcase,
  ListTodo,
  Printer,
  Send,
  ShieldCheck,
  Trash2,
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
import { canDiscard } from '@/domain/review';

const STATUS: Record<ReportStatus, { label: string; tone: 'neutral' | 'accent' | 'ok' | 'warn' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  pending_review: { label: 'Pending review', tone: 'accent' },
  approved: { label: 'Approved', tone: 'ok' },
  returned: { label: 'Returned', tone: 'warn' },
};

/** Which side panel is showing. */
export type PanelName = 'check' | 'tasks' | 'work';

export function EditorHeader({
  onPrint,
  rightPanel,
  onShowPanel,
}: {
  onPrint: () => void;
  rightPanel: PanelName;
  onShowPanel: (panel: PanelName) => void;
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
    saveNow,
    discardReport,
    currentUser,
    attachments,
  } = useStore();
  if (!incident) return null;

  const outstandingWork = taskSummary(incident.id);
  const discardable = canDiscard(
    currentUser,
    incident,
    attachments.filter((file) => file.incidentId === incident.id && !file.retractedAt).length,
  );

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
        {/*
          Who has the case and what it has to go on. Beside the to-do list
          rather than inside the report, because investigative work carries on
          after the report is approved — which is when it actually starts.
        */}
        <PanelTab active={rightPanel === 'work'} onClick={() => onShowPanel('work')}>
          <Briefcase size={14} aria-hidden />
          Case work
        </PanelTab>
      </div>

      {/*
        The editor saves as it goes and has always said so. This makes it
        something an officer can press — "Saved just now" is a claim you have
        to take on trust at the moment you close the laptop, and the honest
        answer to somebody who wants a Save button is to give them one that
        really does finish the work.
      */}
      <button
        type="button"
        onClick={() => void saveNow()}
        title="Write everything pending to the server now"
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-faint transition hover:bg-raised hover:text-ink"
      >
        <Cloud size={13} aria-hidden />
        {savedAt ? `Saved ${relativeTime(savedAt)}` : 'Save'}
      </button>

      {/*
        Only ever offered on a draft nobody has written on. `canDiscard` holds
        that line — a report with anything real in it is a record, and records
        are destroyed under a court order with a second person, not from a
        button in the corner of the screen.
      */}
      {discardable.ok && (
        <Button
          onClick={() => void discardReport()}
          title="Throw away this empty report"
        >
          <Trash2 size={15} aria-hidden />
          Discard
        </Button>
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
