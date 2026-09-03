import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CircleAlert,
  Loader2,
  Lock,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useStore } from '@/state/store';
import { api, type EvidenceDetail } from '@/state/api';
import {
  ACTION_LABEL,
  CATEGORY_LABEL,
  STATUS_LABEL,
  TWO_PERSON_CATEGORIES,
  canRecord,
  checkCustody,
  type CustodyAction,
  type CustodyDraft,
  type CustodyParty,
} from '@/domain/evidence';
import { Badge, Button, FieldGrid, Panel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/** Only the actions somebody standing at the shelf would reach for. */
const OFFERED: { action: CustodyAction; party: CustodyParty; label: string }[] = [
  { action: 'booked', party: 'storage', label: 'Book onto a shelf' },
  { action: 'moved', party: 'storage', label: 'Move it' },
  { action: 'checkedOut', party: 'officer', label: 'Sign it out' },
  { action: 'checkedIn', party: 'storage', label: 'Sign it back in' },
  { action: 'audited', party: 'storage', label: 'Confirm on the shelf' },
  { action: 'released', party: 'owner', label: 'Release it' },
  { action: 'destroyed', party: 'destruction', label: 'Destroy it' },
];

const PARTY_LABEL: Record<CustodyParty, string> = {
  scene: 'the scene',
  storage: 'the property room',
  officer: 'an officer',
  lab: 'a laboratory',
  court: 'a court',
  owner: 'the owner',
  agency: 'another agency',
  destruction: 'destruction',
};

/**
 * One item: what it is, where it has been, and what may happen next.
 *
 * The chain is the point of the page, so it is the largest thing on it and it
 * reads oldest first — the order a court reads it in, not the order a feed
 * would show it.
 */
export function ItemDetail({
  detail,
  loading,
  onClose,
}: {
  detail: EvidenceDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  const { can, recordCustody, updateEvidence, currentUser } = useStore();
  const [action, setAction] = useState<CustodyAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mayManage = can('evidence.manage');

  if (loading || !detail) {
    return (
      <Panel title="Property">
        <p className="flex items-center gap-2 py-6 text-[13px] text-muted">
          <Loader2 size={15} className="animate-spin" aria-hidden />
          Reading the ledger…
        </p>
      </Panel>
    );
  }

  const { item, chain, state, integrity, findings } = detail;

  const clerkOnly: CustodyAction[] = ['moved', 'released', 'destroyed', 'audited'];
  const available = OFFERED.filter((offer) => {
    if (clerkOnly.includes(offer.action) && !mayManage) return false;
    return canRecord(offer.action, item, chain, true).ok;
  });

  return (
    <>
      <div className="mb-3 flex items-center gap-3">
        <Button variant="ghost" onClick={onClose}>
          <ArrowLeft size={15} aria-hidden />
          Property room
        </Button>
        <span className="font-mono text-[14px] font-semibold text-ink">{item.tagNumber}</span>
        <Badge tone={state.closed ? 'neutral' : 'ok'}>{STATUS_LABEL[state.status]}</Badge>
        {item.holdReason && <Badge tone="warn">On hold</Badge>}
      </div>

      {!integrity.intact && (
        <p className="mb-3 flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft px-3.5 py-3 text-[13px] leading-relaxed text-ink">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
          <span>
            <strong>This chain of custody does not verify.</strong> {integrity.reason} The break is
            at entry {(integrity.brokenAt ?? 0) + 1}. Nothing about this item should be relied on
            until somebody establishes how that happened.
          </span>
        </p>
      )}

      {findings
        .filter((f) => f.kind !== 'brokenChain')
        .map((finding) => (
          <p
            key={finding.kind}
            className={cn(
              'mb-2 flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px] leading-relaxed',
              finding.severity === 'critical'
                ? 'bg-danger-soft text-ink'
                : 'bg-warn-soft text-ink',
            )}
          >
            <CircleAlert
              size={14}
              className={cn(
                'mt-0.5 shrink-0',
                finding.severity === 'critical' ? 'text-danger' : 'text-warn',
              )}
              aria-hidden
            />
            <span>
              <strong>{finding.title}.</strong> {finding.detail}
            </span>
          </p>
        ))}

      <Panel title={item.description} description={CATEGORY_LABEL[item.category]}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          <Fact label="Where it is" value={state.location || 'Not on a shelf'} />
          <Fact
            label={state.closed ? 'Went to' : 'Who has it'}
            value={state.holder || (state.status === 'destroyed' ? 'Destroyed' : '—')}
          />
          <Fact label="Case" value={item.caseNumber || 'Found property'} mono />
          <Fact label="Found at" value={item.foundAt} />
          <Fact label="Quantity" value={item.quantity || '—'} />
          <Fact label="Serial" value={item.serialNumber || '—'} mono />
        </dl>

        {item.holdReason && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] leading-relaxed text-ink">
            <Lock size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <span>
              <strong>Held:</strong> {item.holdReason}. It cannot be released or destroyed until the
              hold is lifted.
            </span>
          </p>
        )}

        {/*
          A hold stops an item being disposed of. Offering one on an item that
          has already gone is offering to close a door that is not there.
        */}
        {mayManage && !state.closed && (
          <HoldControl
            item={item}
            onSave={(holdReason) => updateEvidence(item.id, { holdReason })}
          />
        )}
      </Panel>

      {!state.closed && available.length > 0 && (
        <Panel title="Record a movement" description="Signed by you, and never editable afterwards.">
          <div className="flex flex-wrap gap-1.5">
            {available.map((offer) => (
              <button
                key={offer.action}
                type="button"
                onClick={() => {
                  setAction(action === offer.action ? null : offer.action);
                  setError(null);
                }}
                aria-pressed={action === offer.action}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition',
                  action === offer.action
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line text-muted hover:border-line-strong hover:text-ink',
                  (offer.action === 'released' || offer.action === 'destroyed') &&
                    action !== offer.action &&
                    'text-danger',
                )}
              >
                {offer.label}
              </button>
            ))}
          </div>

          {action && (
            <CustodyForm
              key={action}
              action={action}
              party={OFFERED.find((o) => o.action === action)!.party}
              item={item}
              currentUserId={currentUser.id}
              busy={busy}
              error={error}
              onCancel={() => setAction(null)}
              onSubmit={async (draft) => {
                setBusy(true);
                setError(null);
                const result = await recordCustody(item.id, draft);
                setBusy(false);
                if (!result.ok) {
                  setError(result.reason ?? 'Could not record it.');
                  return;
                }
                setAction(null);
              }}
            />
          )}
        </Panel>
      )}

      <Panel
        title="Chain of custody"
        description="Oldest first, the way it is read back. Nothing here can be changed — a mistake is corrected by adding to it."
        aside={
          integrity.intact ? (
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-ok">
              <ShieldCheck size={14} aria-hidden />
              {integrity.checked} entries verify
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-danger">
              <ShieldAlert size={14} aria-hidden />
              Broken
            </span>
          )
        }
      >
        <ol className="space-y-0">
          {chain.map((entry, i) => (
            <li
              key={entry.id}
              className={cn(
                'grid grid-cols-[auto_1fr] gap-x-3 border-l-2 py-2.5 pl-3',
                integrity.brokenAt === i ? 'border-danger bg-danger-soft/40' : 'border-line',
              )}
            >
              <span className="font-mono text-[11.5px] text-faint tabular">{i + 1}</span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">
                  {ACTION_LABEL[entry.action]}
                  {entry.toName && <span className="font-normal text-muted"> to {entry.toName}</span>}
                  {!entry.toName && entry.action === 'checkedOut' && (
                    <span className="font-normal text-muted"> to {PARTY_LABEL[entry.toParty]}</span>
                  )}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-faint">
                  <span>{new Date(entry.at).toLocaleString()}</span>
                  <span aria-hidden>·</span>
                  <span>{entry.actorName}</span>
                  {entry.location && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{entry.location}</span>
                    </>
                  )}
                  {entry.witnessName && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="text-ink">witnessed by {entry.witnessName}</span>
                    </>
                  )}
                </p>
                {entry.reason && (
                  <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{entry.reason}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------------ */

function CustodyForm({
  action,
  party,
  item,
  currentUserId,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  action: CustodyAction;
  party: CustodyParty;
  item: EvidenceDetail['item'];
  currentUserId: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (draft: Record<string, string>) => Promise<void>;
}) {
  const [toParty, setToParty] = useState<CustodyParty>(party);
  const [toName, setToName] = useState('');
  const [location, setLocation] = useState('');
  const [reason, setReason] = useState('');
  const [witnessId, setWitnessId] = useState('');
  const [witnesses, setWitnesses] = useState<{ id: string; name: string; badge: string }[]>([]);

  const leaving = action === 'released' || action === 'destroyed';
  const needsWitness = leaving && TWO_PERSON_CATEGORIES.includes(item.category);

  useEffect(() => {
    if (!needsWitness) return;
    void api
      .witnesses()
      .then(({ witnesses: list }) => setWitnesses(list.filter((w) => w.id !== currentUserId)))
      .catch(() => setWitnesses([]));
  }, [needsWitness, currentUserId]);

  const problems = checkCustody({
    action,
    toParty,
    toName,
    location,
    reason,
  } as CustodyDraft);

  const blocked = problems.length > 0 || (needsWitness && !witnessId);

  const control =
    'w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px] text-ink placeholder:text-faint';

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-line bg-raised p-3.5">
      {leaving && (
        <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink">
          <ShieldAlert size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden />
          <span>
            This is the last entry this item will ever have. Once recorded, the chain is closed and
            {action === 'destroyed' ? ' the item is gone' : ' the item has left the building'}.
          </span>
        </p>
      )}

      {(action === 'checkedOut' || action === 'released') && (
        <FieldGrid cols={2}>
          <label>
            <span className="mb-1.5 block text-[12.5px] font-medium text-ink">Going to</span>
            <select
              value={toParty}
              onChange={(e) => setToParty(e.target.value as CustodyParty)}
              className={control}
            >
              {(Object.keys(PARTY_LABEL) as CustodyParty[])
                .filter((p) => p !== 'scene' && p !== 'destruction')
                .map((p) => (
                  <option key={p} value={p}>
                    {PARTY_LABEL[p]}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span className="mb-1.5 block text-[12.5px] font-medium text-ink">
              Who signs for it
              {action === 'released' && <span className="ml-1 text-danger">*</span>}
            </span>
            <input
              value={toName}
              onChange={(e) => setToName(e.target.value)}
              placeholder="Alabama Dept of Forensic Sciences"
              className={control}
            />
          </label>
        </FieldGrid>
      )}

      {(action === 'booked' || action === 'moved' || action === 'audited' || action === 'checkedIn') && (
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink">
            Shelf
            {(action === 'booked' || action === 'moved') && (
              <span className="ml-1 text-danger">*</span>
            )}
          </span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Room 2 · Shelf C · Bin 14"
            className={control}
          />
        </label>
      )}

      <label className="block">
        <span className="mb-1.5 block text-[12.5px] font-medium text-ink">
          Why
          {['checkedOut', 'released', 'destroyed'].includes(action) && (
            <span className="ml-1 text-danger">*</span>
          )}
        </span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="State exhibit 4, trial 3 Nov"
          className={control}
        />
        <span className="mt-1 block text-[12px] leading-relaxed text-faint">
          Read back years later by somebody deciding whether this item is still trustworthy.
        </span>
      </label>

      {needsWitness && (
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink">
            Witnessed by <span className="text-danger">*</span>
          </span>
          <select
            value={witnessId}
            onChange={(e) => setWitnessId(e.target.value)}
            className={control}
          >
            <option value="">Choose somebody</option>
            {witnesses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} #{w.badge}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[12px] leading-relaxed text-faint">
            {CATEGORY_LABEL[item.category]} needs two people. Nobody signs a firearm, drugs or cash
            out of the building alone.
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button
          variant={leaving ? 'danger' : 'primary'}
          disabled={busy || blocked}
          onClick={() =>
            void onSubmit({ action, toParty, toName, location, reason, witnessId })
          }
        >
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
          {ACTION_LABEL[action]}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
        <span className="text-[12px] text-danger">
          {error ??
            problems[0]?.message ??
            (needsWitness && !witnessId ? 'Choose a witness.' : '')}
        </span>
      </div>
    </div>
  );
}

function HoldControl({
  item,
  onSave,
}: {
  item: EvidenceDetail['item'];
  onSave: (holdReason: string) => Promise<{ ok: boolean; reason?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.holdReason);
  const [busy, setBusy] = useState(false);

  if (!editing) {
    return (
      <Button
        size="sm"
        className="mt-3"
        onClick={() => {
          setValue(item.holdReason);
          setEditing(true);
        }}
      >
        <Lock size={13} aria-hidden />
        {item.holdReason ? 'Change or lift the hold' : 'Place a hold'}
      </Button>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-line bg-raised p-3">
      <label className="block">
        <span className="mb-1.5 block text-[12.5px] font-medium text-ink">
          Why this cannot be disposed of
        </span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Appeal pending until 2028"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px] text-ink placeholder:text-faint"
        />
        <span className="mt-1 block text-[12px] text-faint">
          Leave it empty to lift the hold. Either way it is recorded in the audit log.
        </span>
      </label>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onSave(value);
            setBusy(false);
            setEditing(false);
          }}
        >
          {busy && <Loader2 size={13} className="animate-spin" aria-hidden />}
          Save
        </Button>
        <Button size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] uppercase tracking-wide text-faint">{label}</dt>
      <dd className={cn('mt-0.5 truncate text-[13px] text-ink', mono && 'font-mono')} title={value}>
        {value}
      </dd>
    </div>
  );
}
