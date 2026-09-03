import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Eye,
  FileCheck2,
  Gavel,
  Loader2,
  Lock,
  LockOpen,
  Scale,
  ShieldAlert,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useStore } from '@/state/store';
import {
  blockingProblems,
  canExecute,
  checkOrder,
  isLive,
  manifestTotal,
  needsTwoPeople,
  ORDER_KIND_LABEL,
  ORDER_STATUS_LABEL,
  RECORD_KIND_LABEL,
  type Certificate,
  type DisposalOrder,
  type ManifestLine,
  type OrderKind,
} from '@/domain/retention';
import { Badge, Button, EmptyState, Panel, TabButton } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

type Tab = 'orders' | 'schedule' | 'certificates';

/**
 * Court orders, the retention schedule, and what was destroyed.
 *
 * The screen an agency shows an auditor. Everything irreversible on it is
 * behind two people and a preview of exactly what will go — nobody signs a
 * destruction order without seeing the list first.
 */
export function RetentionView() {
  const { refreshRetention, orders, ordersWaiting, certificates } = useStore();
  const [tab, setTab] = useState<Tab>('orders');

  useEffect(() => {
    void refreshRetention();
  }, [refreshRetention]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <TabButton active={tab === 'orders'} onClick={() => setTab('orders')}>
          Court orders ({orders.filter(isLive).length})
          {ordersWaiting.length > 0 && (
            <span className="ml-1.5 rounded bg-accent px-1.5 text-[11px] font-semibold text-white tabular">
              {ordersWaiting.length}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === 'schedule'} onClick={() => setTab('schedule')}>
          Retention schedule
        </TabButton>
        <TabButton active={tab === 'certificates'} onClick={() => setTab('certificates')}>
          Certificates ({certificates.length})
        </TabButton>
      </div>

      {tab === 'orders' && <Orders />}
      {tab === 'schedule' && <Schedule />}
      {tab === 'certificates' && <Certificates />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

function Orders() {
  const { orders, seals } = useStore();
  const [adding, setAdding] = useState(false);

  const live = orders.filter(isLive);
  const done = orders.filter((o) => !isLive(o));

  return (
    <div className="space-y-4">
      {adding ? (
        <NewOrder onDone={() => setAdding(false)} />
      ) : (
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Gavel size={15} aria-hidden />
          Record a court order
        </Button>
      )}

      {live.length === 0 && !adding && (
        <EmptyState
          icon={<Scale size={20} />}
          title="No orders outstanding"
          body="Sealing and expungement orders are recorded here, then carried out by a second person."
        />
      )}

      <ul className="space-y-3">
        {live.map((order) => (
          <OrderCard key={order.id} order={order} />
        ))}
      </ul>

      {seals.length > 0 && <SealedList />}

      {done.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[12.5px] text-muted">
            {done.length} finished
          </summary>
          <ul className="mt-2 space-y-2">
            {done.map((order) => (
              <li
                key={order.id}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] leading-relaxed text-muted"
              >
                <span className="font-mono text-ink">{order.reference}</span>{' '}
                <Badge tone="neutral">{ORDER_STATUS_LABEL[order.status]}</Badge>{' '}
                {ORDER_KIND_LABEL[order.kind]} · {order.court} {order.docket}
                {order.withdrawnReason && (
                  <span className="block text-faint">“{order.withdrawnReason}”</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const KIND_ICON: Record<OrderKind, typeof Lock> = {
  seal: Lock,
  unseal: Unlock,
  expunge: Trash2,
};

function OrderCard({ order }: { order: DisposalOrder }) {
  const { previewOrder, proposeOrder, executeOrder, withdrawOrder, currentUser, can } = useStore();
  const [preview, setPreview] = useState<{
    lines: ManifestLine[];
    auditEntries: number;
    gaps: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [certificate, setCertificate] = useState<Certificate | null>(null);

  const destroys = order.kind === 'expunge';
  const problems = blockingProblems(checkOrder(order));
  const second = canExecute(order, currentUser.id);
  const mayExecute = can(destroys ? 'records.expunge' : 'records.seal');
  const Icon = KIND_ICON[order.kind];

  // Loaded when the card opens, not cached: what an order covers changes as
  // reports are filed, and a stale list is worse than none.
  useEffect(() => {
    if (order.status === 'draft' || order.status === 'proposed') {
      void previewOrder(order.id).then(setPreview);
    }
  }, [order.id, order.status, previewOrder]);

  const run = async (action: () => Promise<{ ok: boolean; reason?: string }>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setError(result.reason ?? 'That did not work.');
    return result;
  };

  return (
    <li
      className={cn(
        'rounded-xl border bg-surface p-4',
        destroys ? 'border-danger/40' : 'border-line',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Icon size={16} className={destroys ? 'text-danger' : 'text-faint'} aria-hidden />
        <span className="font-mono text-[13.5px] font-semibold text-ink">{order.reference}</span>
        <Badge tone={destroys ? 'danger' : 'accent'}>{ORDER_KIND_LABEL[order.kind]}</Badge>
        <Badge tone={order.status === 'proposed' ? 'warn' : 'neutral'}>
          {ORDER_STATUS_LABEL[order.status]}
        </Badge>
        {order.subjectLabel && (
          <span className="font-mono text-[12.5px] text-muted">{order.subjectLabel}</span>
        )}
      </div>

      <p className="mt-1.5 text-[13px] text-ink">
        {order.court} · docket {order.docket} · signed {order.orderedOn}
      </p>
      {order.instruction && (
        <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
          {order.instruction}
        </p>
      )}
      <p className="mt-0.5 text-[11.5px] text-faint">
        Recorded by {order.createdByName} · {relativeTime(order.createdAt)}
        {order.proposedByName && ` · proposed by ${order.proposedByName}`}
      </p>

      {problems.length > 0 && (
        <ul className="mt-2 space-y-1">
          {problems.map((p, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[12.5px] text-danger">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                <span className="font-medium">{p.title}</span> — {p.message}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* ---- What would go ------------------------------------------- */}
      {preview && destroys && (
        <div className="mt-3 rounded-lg border border-danger/35 bg-danger-soft/40 p-3">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-danger">
            <ShieldAlert size={14} aria-hidden />
            This destroys {manifestTotal(preview.lines)}{' '}
            {manifestTotal(preview.lines) === 1 ? 'record' : 'records'}. It cannot be undone.
          </p>
          {preview.lines.length === 0 ? (
            <p className="mt-1.5 text-[12.5px] text-muted">
              Nothing found for this subject. Check the order names the right case.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-0.5">
              {preview.lines.map((line) => (
                <li key={line.kind} className="text-[12.5px] leading-relaxed text-ink">
                  <span className="font-medium">{line.count}</span> {line.kind.toLowerCase()}
                  {line.examples.length > 0 && (
                    <span className="text-muted"> — {line.examples.join(', ')}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
            {preview.auditEntries} audit {preview.auditEntries === 1 ? 'entry loses' : 'entries lose'}{' '}
            {preview.auditEntries === 1 ? 'its contents' : 'their contents'}. They keep their place in the
            chain, so the log still proves nothing was removed — it will report them as destroyed
            under this order.
          </p>

          {/*
            Said before anybody signs. The dangerous failure is not destroying
            too much — it is a certificate saying a record is gone while a copy
            of it sits somewhere this order does not reach.
          */}
          {preview.gaps.length > 0 && (
            <div className="mt-2 border-t border-danger/25 pt-2">
              <p className="text-[12px] font-semibold text-ink">This order does not cover:</p>
              <ul className="mt-1 space-y-0.5">
                {preview.gaps.map((gap) => (
                  <li key={gap} className="text-[12px] leading-relaxed text-muted">
                    · {gap}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {preview && !destroys && (
        <p className="mt-2 text-[12.5px] text-muted">
          {manifestTotal(preview.lines)} records{' '}
          {order.kind === 'seal' ? 'come out of ordinary sight' : 'go back into ordinary sight'}.
        </p>
      )}

      {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}

      {certificate && (
        <div className="mt-3 rounded-lg border border-ok/40 bg-ok-soft p-3">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ok">
            <FileCheck2 size={14} aria-hidden />
            Carried out. {certificate.destroyed} records destroyed, {certificate.auditRedacted} log
            entries redacted.
          </p>
          <p className="mt-1 text-[12px] text-muted">
            The certificate is on the Certificates tab. It names the order, not what was in it.
          </p>
        </div>
      )}

      {/* ---- Actions -------------------------------------------------- */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {order.status === 'draft' && (
          <Button
            variant="primary"
            disabled={busy || problems.length > 0}
            title={problems.length > 0 ? 'Fix the problems above first' : undefined}
            onClick={() => void run(() => proposeOrder(order.id))}
          >
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
            {needsTwoPeople(order.kind) ? 'Propose it' : 'Carry it out'}
          </Button>
        )}

        {order.status === 'proposed' && mayExecute && second.ok && !confirming && (
          <Button variant={destroys ? 'danger' : 'primary'} onClick={() => setConfirming(true)}>
            {destroys ? <Trash2 size={15} aria-hidden /> : <Lock size={15} aria-hidden />}
            {destroys ? 'Destroy these records' : 'Carry it out'}
          </Button>
        )}

        {confirming && (
          <div className="w-full rounded-lg border border-danger/45 bg-danger-soft p-3">
            <p className="text-[13px] font-semibold text-danger">
              {destroys
                ? `Destroy ${manifestTotal(preview?.lines ?? [])} records under ${order.court} ${order.docket}?`
                : `Carry out ${order.reference}?`}
            </p>
            {destroys && (
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink/80">
                There is no undo and no backup of what goes. What remains is a certificate saying
                how much of what was destroyed, under this order.
              </p>
            )}
            <div className="mt-2.5 flex gap-2">
              <Button
                variant="danger"
                disabled={busy}
                onClick={async () => {
                  const result = await run(() => executeOrder(order.id));
                  setConfirming(false);
                  if (result.ok) {
                    setCertificate(
                      (result as { certificate?: Certificate | null }).certificate ?? null,
                    );
                  }
                }}
              >
                {busy ? (
                  <Loader2 size={15} className="animate-spin" aria-hidden />
                ) : (
                  <Trash2 size={15} aria-hidden />
                )}
                Yes, carry it out
              </Button>
              <Button disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {order.status === 'proposed' && !second.ok && (
          <p className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-muted">
            <ShieldAlert size={13} className="mt-0.5 shrink-0 text-faint" aria-hidden />
            {second.reason}
          </p>
        )}

        {order.status === 'proposed' && second.ok && !mayExecute && (
          <p className="text-[12.5px] text-muted">
            Waiting on somebody with the authority to carry this out.
          </p>
        )}

        <div className="flex-1" />

        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why it is being withdrawn"
          className="min-w-0 max-w-[240px] flex-1 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-faint"
        />
        <Button
          disabled={busy || !reason.trim()}
          onClick={() => void run(() => withdrawOrder(order.id, reason.trim()))}
        >
          Withdraw
        </Button>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */

function NewOrder({ onDone }: { onDone: () => void }) {
  const { incidents, people, createOrder } = useStore();
  const [draft, setDraft] = useState({
    kind: 'seal' as OrderKind,
    scope: 'case',
    subjectId: '',
    court: '',
    docket: '',
    orderedOn: '',
    instruction: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subjects = useMemo(
    () =>
      draft.scope === 'case'
        ? incidents.map((i) => ({ id: i.id, label: i.caseNumber }))
        : Object.values(people).map((p) => ({
            id: p.id,
            label: [p.lastName, p.firstName].filter(Boolean).join(', ') || p.businessName,
          })),
    [draft.scope, incidents, people],
  );

  const field =
    'w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint';

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await createOrder(draft);
    setBusy(false);
    if (result.ok) onDone();
    else setError(result.reason ?? 'Could not record it.');
  };

  return (
    <Panel
      title="Record a court order"
      description="What the court ordered, and about what. Nothing happens to any record until a second person carries it out."
      aside={<Gavel size={17} className="text-faint" aria-hidden />}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-ink">What it orders</span>
          <select
            value={draft.kind}
            onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as OrderKind }))}
            className={field}
          >
            {(['seal', 'unseal', 'expunge'] as OrderKind[]).map((k) => (
              <option key={k} value={k}>
                {ORDER_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-ink">About</span>
          <select
            value={draft.scope}
            onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value, subjectId: '' }))}
            className={field}
          >
            <option value="case">A case</option>
            <option value="person">A person</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-ink">Which one</span>
          <select
            value={draft.subjectId}
            onChange={(e) => setDraft((d) => ({ ...d, subjectId: e.target.value }))}
            className={field}
          >
            <option value="">Choose…</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[12.5px] font-medium text-ink">Court</span>
          <input
            value={draft.court}
            onChange={(e) => setDraft((d) => ({ ...d, court: e.target.value }))}
            placeholder="St. Clair County Circuit Court"
            className={field}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-ink">Docket</span>
          <input
            value={draft.docket}
            onChange={(e) => setDraft((d) => ({ ...d, docket: e.target.value }))}
            placeholder="CC-2026-118"
            className={field}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-ink">Signed on</span>
          <input
            type="date"
            value={draft.orderedOn}
            onChange={(e) => setDraft((d) => ({ ...d, orderedOn: e.target.value }))}
            className={field}
          />
        </label>
      </div>

      <label className="mt-2 block">
        <span className="mb-1 block text-[12.5px] font-medium text-ink">
          What the order says
          {draft.kind === 'expunge' && <span className="ml-1 text-danger">*</span>}
        </span>
        <textarea
          rows={3}
          value={draft.instruction}
          onChange={(e) => setDraft((d) => ({ ...d, instruction: e.target.value }))}
          placeholder="All records of the arrest are to be destroyed within 30 days."
          className={cn(field, 'leading-relaxed')}
        />
        <span className="mt-1 block text-[11.5px] leading-relaxed text-faint">
          In the order’s own words. Once records are destroyed this is the only account of why.
        </span>
      </label>

      {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}

      <div className="mt-3 flex gap-2">
        <Button variant="primary" disabled={busy || !draft.subjectId} onClick={() => void submit()}>
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
          Record it
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Sealed records                                                      */
/* ------------------------------------------------------------------ */

function SealedList() {
  const { seals } = useStore();
  const [opened, setOpened] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<Record<string, unknown> | null>(null);

  const open = async (subjectId: string) => {
    setBusy(true);
    setError(null);
    try {
      const { api } = await import('@/state/api');
      setContent(
        (await api.openSealed(subjectId, 'Opened from the retention screen')) as Record<
          string,
          unknown
        >,
      );
      setOpened(subjectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open it.');
    }
    setBusy(false);
  };

  return (
    <Panel
      title={`Sealed records (${seals.length})`}
      description="Out of ordinary sight by court order. Opening one is recorded against your name."
      aside={<Lock size={17} className="text-faint" aria-hidden />}
    >
      <ul className="space-y-1.5">
        {seals.map((seal) => (
          <li
            key={seal.subjectId}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2"
          >
            <LockOpen size={13} className="shrink-0 text-faint" aria-hidden />
            <span className="font-mono text-[12.5px] text-ink">{seal.subjectId}</span>
            <span className="text-[12px] text-muted">
              under {seal.orderRef} · sealed by {seal.sealedBy} {relativeTime(seal.sealedAt)}
            </span>
            <div className="flex-1" />
            <Button size="sm" disabled={busy} onClick={() => void open(seal.subjectId)}>
              {busy ? (
                <Loader2 size={13} className="animate-spin" aria-hidden />
              ) : (
                <Eye size={13} aria-hidden />
              )}
              Open it
            </Button>
          </li>
        ))}
      </ul>

      {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}

      {opened && content && (
        <div className="mt-3 rounded-lg border border-warn/40 bg-warn-soft p-3">
          <p className="text-[12.5px] font-semibold text-warn">
            Opened. This has been recorded in the audit log against your name.
          </p>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink">
            {JSON.stringify(content, null, 2)}
          </pre>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Schedule and certificates                                           */
/* ------------------------------------------------------------------ */

function Schedule() {
  const { agency, updateAgency, can } = useStore();
  const rules = agency.retention ?? [];
  const mayEdit = can('agency.configure');

  const set = (kind: string, patch: Record<string, unknown>) =>
    updateAgency({
      retention: rules.map((r) => (r.kind === kind ? { ...r, ...patch } : r)),
    });

  const field =
    'w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint disabled:opacity-60';

  return (
    <Panel
      title="Retention schedule"
      description="How long each kind of record is kept. These are state law — the numbers shipped are a starting point, and nothing is destroyed on this schedule without somebody deciding."
    >
      <ul className="space-y-2">
        {rules.map((rule) => (
          <li key={rule.kind} className="rounded-lg border border-line bg-surface p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_90px_1fr]">
              <span className="self-center text-[13px] font-medium text-ink">
                {RECORD_KIND_LABEL[rule.kind]}
              </span>
              <label className="block">
                <span className="mb-1 block text-[11.5px] text-muted">Years</span>
                <input
                  type="number"
                  min={0}
                  disabled={!mayEdit || rule.permanent}
                  value={rule.permanent ? '' : rule.years}
                  onChange={(e) => set(rule.kind, { years: Number(e.target.value) || 0 })}
                  className={field}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11.5px] text-muted">Counted from</span>
                <select
                  disabled={!mayEdit || rule.permanent}
                  value={rule.basis}
                  onChange={(e) => set(rule.kind, { basis: e.target.value })}
                  className={field}
                >
                  <option value="created">the date the record was made</option>
                  <option value="closed">the date the case was closed</option>
                  <option value="lastActivity">the last thing that happened on it</option>
                  <option value="majority">the subject’s eighteenth birthday</option>
                </select>
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink">
                <input
                  type="checkbox"
                  disabled={!mayEdit}
                  checked={rule.permanent}
                  onChange={(e) => set(rule.kind, { permanent: e.target.checked })}
                />
                Kept for good
              </label>
              <input
                disabled={!mayEdit}
                value={rule.authority}
                onChange={(e) => set(rule.kind, { authority: e.target.value })}
                placeholder="Which statute or policy says so"
                className={cn(field, 'max-w-[320px] flex-1 text-[12.5px]')}
              />
              {!rule.authority && (
                <span className="text-[11.5px] text-warn">Not yet decided</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Certificates() {
  const { certificates } = useStore();

  if (certificates.length === 0) {
    return (
      <EmptyState
        icon={<FileCheck2 size={20} />}
        title="Nothing has been destroyed"
        body="A certificate is produced whenever a destruction order is carried out."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {certificates.map((cert) => (
        <li key={cert.orderReference} className="rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <FileCheck2 size={16} className="text-ok" aria-hidden />
            <span className="font-mono text-[13.5px] font-semibold text-ink">
              {cert.orderReference}
            </span>
            <Badge tone="ok">Carried out</Badge>
          </div>
          <p className="mt-1.5 text-[13px] text-ink">
            {cert.court} · docket {cert.docket} · signed {cert.orderedOn}
          </p>
          <ul className="mt-2 space-y-0.5">
            {cert.lines.map((line) => (
              <li key={line.kind} className="text-[12.5px] text-muted">
                <span className="font-medium text-ink">{line.count}</span> {line.kind.toLowerCase()}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12.5px] text-muted">
            {cert.destroyed} {cert.destroyed === 1 ? 'record' : 'records'} destroyed and{' '}
            {cert.auditRedacted} audit {cert.auditRedacted === 1 ? 'entry' : 'entries'} redacted, on{' '}
            {new Date(cert.executedAt).toLocaleString()}.
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
            Proposed by {cert.proposedByName}, carried out by {cert.executedByName}. This
            certificate names the order, not what was destroyed under it.
          </p>
        </li>
      ))}
    </ul>
  );
}
