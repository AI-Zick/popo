import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Boxes,
  CircleAlert,
  Loader2,
  PackagePlus,
  ScanLine,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { useStore } from '@/state/store';
import type { EvidenceDetail, EvidenceSummary } from '@/state/api';
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  type CustodyStatus,
  type EvidenceCategory,
} from '@/domain/evidence';
import { Badge, Panel, TabButton } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { BookIn } from './BookIn';
import { ItemDetail } from './ItemDetail';

/**
 * The property room.
 *
 * Opens on what is wrong, not on a catalogue. A room holding forty thousand
 * items has one screen worth looking at every morning, and it is the list of
 * things that need doing: the bag collected on Friday that never arrived, the
 * item a detective signed out in March, the shelf nobody has checked in a year.
 *
 * Browsing everything is the second tab, because it is the second question.
 */
export function PropertyRoom() {
  const { evidence, can, loadEvidence } = useStore();
  const [tab, setTab] = useState<'attention' | 'all' | 'book'>('attention');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EvidenceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  const mayManage = can('evidence.manage');

  const needsAttention = useMemo(
    () =>
      [...evidence]
        .filter((row) => row.findings.length > 0)
        .sort((a, b) => severityOf(b) - severityOf(a) || a.item.tagNumber.localeCompare(b.item.tagNumber)),
    [evidence],
  );

  const held = useMemo(() => evidence.filter((row) => !row.state.closed), [evidence]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = [...evidence].sort((a, b) => b.item.tagNumber.localeCompare(a.item.tagNumber));
    if (!q) return rows;
    return rows.filter((row) =>
      [
        row.item.tagNumber,
        row.item.description,
        row.item.caseNumber,
        row.item.serialNumber,
        row.state.location,
        CATEGORY_LABEL[row.item.category],
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [evidence, query]);

  // Re-read the open item whenever the list changes, so recording a transfer
  // updates the chain on screen without a second click.
  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadEvidence(openId).then((next) => {
      if (cancelled) return;
      setDetail(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [openId, loadEvidence, evidence]);

  if (openId) {
    return (
      <ItemDetail
        detail={detail}
        loading={loading}
        onClose={() => setOpenId(null)}
      />
    );
  }

  return (
    <>
      <Panel
        title="Property room"
        description="Everything the agency is holding, and where it is. Every movement is signed and none of it can be edited afterwards."
        aside={<Boxes size={17} className="text-faint" aria-hidden />}
      >
        <div className="mb-4 grid grid-cols-3 gap-2">
          <Count label="Being held" value={held.length} icon={<Archive size={12} aria-hidden />} />
          <Count
            label="Need a look"
            value={needsAttention.length}
            tone={needsAttention.length > 0 ? 'warn' : 'neutral'}
            icon={<TriangleAlert size={12} aria-hidden />}
          />
          <Count
            label="On hold"
            value={evidence.filter((r) => r.item.holdReason).length}
            icon={<ShieldAlert size={12} aria-hidden />}
          />
        </div>

        <nav className="flex flex-wrap gap-1 border-b border-line pb-2">
          <TabButton active={tab === 'attention'} onClick={() => setTab('attention')}>
            Needs a look
            {needsAttention.length > 0 && (
              <span className="ml-1.5 text-[11px] text-warn">{needsAttention.length}</span>
            )}
          </TabButton>
          <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
            Everything
            <span className="ml-1.5 text-[11px] text-faint">{evidence.length}</span>
          </TabButton>
          <TabButton active={tab === 'book'} onClick={() => setTab('book')}>
            Book something in
          </TabButton>
        </nav>

        <div className="mt-4">
          {tab === 'book' && <BookIn onBooked={() => setTab('all')} />}

          {tab === 'attention' &&
            (needsAttention.length === 0 ? (
              <Settled />
            ) : (
              <div className="space-y-2">
                {needsAttention.map((row) => (
                  <Row key={row.item.id} row={row} onOpen={() => setOpenId(row.item.id)} showFindings />
                ))}
              </div>
            ))}

          {tab === 'all' && (
            <>
              <label className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-surface px-3">
                <ScanLine size={15} className="shrink-0 text-faint" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tag number, description, case, serial, shelf…"
                  aria-label="Search property"
                  className="w-full bg-transparent py-2 text-[13.5px] text-ink outline-none placeholder:text-faint"
                />
              </label>

              {matches.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-muted">
                  {evidence.length === 0
                    ? 'Nothing has been booked in yet.'
                    : 'Nothing matches that.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {matches.slice(0, 200).map((row) => (
                    <Row key={row.item.id} row={row} onOpen={() => setOpenId(row.item.id)} />
                  ))}
                  {matches.length > 200 && (
                    <p className="pt-2 text-center text-[12px] text-faint">
                      Showing the first 200 of {matches.length.toLocaleString()}. Narrow the search.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Panel>

      {!mayManage && (
        <p className="mt-3 px-1 text-[12.5px] leading-relaxed text-muted">
          You can book property in and sign items in and out. Moving items, checking the shelf, and
          releasing or destroying anything is the property room's to record.
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

const severityOf = (row: EvidenceSummary) =>
  row.findings.some((f) => f.severity === 'critical') ? 2 : row.findings.length > 0 ? 1 : 0;

const STATUS_TONE: Record<CustodyStatus, 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'> = {
  uncollected: 'neutral',
  inField: 'warn',
  inStorage: 'ok',
  signedOut: 'accent',
  released: 'neutral',
  destroyed: 'neutral',
};

function Row({
  row,
  onOpen,
  showFindings,
}: {
  row: EvidenceSummary;
  onOpen: () => void;
  showFindings?: boolean;
}) {
  const critical = row.findings.some((f) => f.severity === 'critical');

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'block w-full rounded-xl border px-3 py-2.5 text-left transition hover:border-line-strong',
        critical ? 'border-danger/40 bg-danger-soft/30' : 'border-line',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-[12.5px] font-medium text-ink">{row.item.tagNumber}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{row.item.description}</span>
        <Badge tone={STATUS_TONE[row.state.status]}>{STATUS_LABEL[row.state.status]}</Badge>
      </div>

      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-faint">
        <span>{CATEGORY_LABEL[row.item.category]}</span>
        {row.item.caseNumber && (
          <>
            <span aria-hidden>·</span>
            <span className="font-mono">{row.item.caseNumber}</span>
          </>
        )}
        {row.state.location && (
          <>
            <span aria-hidden>·</span>
            <span>{row.state.location}</span>
          </>
        )}
        {row.state.holder && (
          <>
            <span aria-hidden>·</span>
            <span>with {row.state.holder}</span>
          </>
        )}
        {row.item.holdReason && <Badge tone="warn">On hold</Badge>}
      </p>

      {showFindings &&
        row.findings.map((finding) => (
          <p
            key={finding.kind}
            className={cn(
              'mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed',
              finding.severity === 'critical' ? 'text-danger' : 'text-warn',
            )}
          >
            {finding.severity === 'critical' ? (
              <ShieldAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
            ) : (
              <CircleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
            )}
            <span>
              <span className="font-medium">{finding.title}.</span>{' '}
              <span className="text-muted">{finding.detail}</span>
            </span>
          </p>
        ))}
    </button>
  );
}

function Count({
  label,
  value,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: 'neutral' | 'warn';
}) {
  return (
    <div className="rounded-xl border border-line bg-canvas px-3 py-2">
      <p
        className={cn(
          'text-[22px] font-semibold tabular',
          tone === 'warn' && value > 0 ? 'text-warn' : 'text-ink',
        )}
      >
        {value.toLocaleString()}
      </p>
      <p className="mt-0.5 flex items-center gap-1 text-[11.5px] uppercase tracking-wide text-faint">
        {icon}
        {label}
      </p>
    </div>
  );
}

function Settled() {
  return (
    <div className="py-8 text-center">
      <PackagePlus size={22} className="mx-auto text-faint" aria-hidden />
      <p className="mt-2 text-[13.5px] font-medium text-ink">Nothing needs a look.</p>
      <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted">
        Everything held is on a shelf, nothing is overdue, and every chain verifies.
      </p>
    </div>
  );
}

export function EvidenceLoading() {
  return (
    <p className="flex items-center gap-2 py-8 text-[13px] text-muted">
      <Loader2 size={15} className="animate-spin" aria-hidden />
      Reading the ledger…
    </p>
  );
}

export type { EvidenceCategory };
