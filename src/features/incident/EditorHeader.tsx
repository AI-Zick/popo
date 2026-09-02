import { AlertTriangle, ChevronLeft, Cloud, Send, UserCog } from 'lucide-react';
import { useStore } from '@/state/store';
import { Badge, Button } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/format';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { UserMenu } from '@/components/layout/UserMenu';
import type { ReportStatus } from '@/domain/types';

const STATUS: Record<ReportStatus, { label: string; tone: 'neutral' | 'accent' | 'ok' | 'warn' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  pending_review: { label: 'Pending review', tone: 'accent' },
  approved: { label: 'Approved', tone: 'ok' },
  returned: { label: 'Returned', tone: 'warn' },
};

export function EditorHeader() {
  const { incident, closeIncident, savedAt, validation, attemptSubmit, conflict, dismissConflict, lockOn } =
    useStore();
  if (!incident) return null;

  const heldBy = lockOn(incident.id);

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

      {savedAt && (
        <span className="flex items-center gap-1.5 text-[12px] text-faint">
          <Cloud size={13} aria-hidden />
          Saved {relativeTime(savedAt)}
        </span>
      )}

      <UserMenu />

      <ThemeToggle />

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
