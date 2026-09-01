import { ChevronLeft, Cloud, Send } from 'lucide-react';
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
  const { incident, closeIncident, savedAt, validation, attemptSubmit } = useStore();
  if (!incident) return null;

  const status = STATUS[incident.status];
  const locked = incident.status === 'pending_review' || incident.status === 'approved';

  return (
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
  );
}
