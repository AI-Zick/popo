import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Search, ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useStore } from '@/state/store';
import {
  ACTION_LABEL,
  filterLog,
  SECURITY_ACTIONS,
  type AuditAction,
  type ChainStatus,
} from '@/domain/audit';
import { Badge, Panel } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

const DANGEROUS: AuditAction[] = ['auth.signInFailed', 'auth.lockout', 'note.retracted'];

export function AuditLog() {
  const { auditLog, verifyAuditLog } = useStore();
  const [search, setSearch] = useState('');
  const [securityOnly, setSecurityOnly] = useState(false);
  const [chain, setChain] = useState<ChainStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void verifyAuditLog().then((status) => {
      if (!cancelled) setChain(status);
    });
    return () => {
      cancelled = true;
    };
  }, [verifyAuditLog, auditLog]);

  const entries = useMemo(
    () =>
      filterLog(auditLog, {
        search,
        actions: securityOnly ? SECURITY_ACTIONS : undefined,
      }),
    [auditLog, search, securityOnly],
  );

  return (
    <Panel
      title="Audit log"
      description="Append-only and hash-chained. Every entry carries the hash of the one before it, so a removed or edited entry breaks the chain and is reported below."
    >
      {chain && <ChainBanner status={chain} />}

      <div className="mt-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Who, what, or which record…"
            className="w-full rounded-lg border border-line bg-canvas py-2 pl-9 pr-3 text-[13.5px] text-ink placeholder:text-faint"
          />
        </div>
        <label className="flex shrink-0 items-center gap-2 text-[12.5px] text-muted">
          <input
            type="checkbox"
            checked={securityOnly}
            onChange={(e) => setSecurityOnly(e.target.checked)}
            className="size-3.5"
          />
          Security events only
        </label>
      </div>

      <p className="mt-2 text-[12px] text-faint tabular">
        {entries.length} of {auditLog.length} entries
      </p>

      {entries.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-faint">
          Nothing recorded yet{search ? ` matching “${search}”` : ''}.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {entries.slice(0, 200).map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 py-2.5">
              <span
                className={cn(
                  'mt-1 size-1.5 shrink-0 rounded-full',
                  DANGEROUS.includes(entry.action) ? 'bg-danger' : 'bg-line-strong',
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink">
                  <span className="font-medium">{entry.actorName || 'Unknown'}</span>
                  <span className="text-muted">{ACTION_LABEL[entry.action]}</span>
                  {entry.target && <Badge tone="neutral">{entry.target}</Badge>}
                </p>
                {entry.detail && (
                  <p className="mt-0.5 text-[12px] text-muted">{entry.detail}</p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[11.5px] text-faint tabular">{formatDateTime(entry.at)}</p>
                <p className="font-mono text-[10.5px] text-faint" title={entry.hash}>
                  {entry.hash.slice(0, 8)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {entries.length > 200 && (
        <p className="mt-2 text-center text-[12px] text-faint">
          Showing the most recent 200. Narrow the search to see further back.
        </p>
      )}
    </Panel>
  );
}

function ChainBanner({ status }: { status: ChainStatus }) {
  if (status.intact) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-ok/30 bg-ok-soft px-3 py-2.5">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-ok" aria-hidden />
        <div>
          <p className="text-[13px] font-medium text-ink">
            Chain intact across {status.checked} {status.checked === 1 ? 'entry' : 'entries'}
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
            Every hash recomputes and every link matches. Nothing has been altered or removed since
            it was written.
          </p>
        </div>
        <CheckCircle2 size={15} className="ml-auto mt-0.5 shrink-0 text-ok" aria-hidden />
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2.5">
      <ShieldAlert size={15} className="mt-0.5 shrink-0 text-danger" aria-hidden />
      <div>
        <p className="text-[13px] font-medium text-danger">Audit chain broken</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink/80">
          {status.reason} First failure at entry {(status.brokenAt ?? 0) + 1} of {status.checked}.
          Treat everything from that point on as unverified and escalate it — this is what a
          tampered log looks like.
        </p>
      </div>
      <TriangleAlert size={15} className="ml-auto mt-0.5 shrink-0 text-danger" aria-hidden />
    </div>
  );
}
