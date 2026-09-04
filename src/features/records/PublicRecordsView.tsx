import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  Clock,
  Eye,
  FileText,
  Inbox,
  Loader2,
  Pause,
  Play,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { useStore } from '@/state/store';
import { api, ApiError, type ProposalView, type PublicRequestRow } from '@/state/api';
import {
  CHANNEL_LABEL,
  OUTCOME_LABEL,
  PAUSE_LABEL,
  STAGE_LABEL,
  WITHHOLDING_NOTICE,
  type AttachmentDecision,
  type Blocker,
  type DecidedSpan,
  type Outcome,
  type PublicRequest,
  type RequestChannel,
  type Standing,
} from '@/domain/publicRecords';
import { MARKER, NOT_EXHAUSTIVE, applyRedactions, type Span } from '@/domain/redaction';
import { Badge, Button, EmptyState, Panel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * The records clerk's screen.
 *
 * Two jobs on it, and they pull against each other. One is a clock: every
 * state sets a period to answer in, and missing it is the failure agencies are
 * actually sued for. The other is a judgement about what may go out, where
 * being late is the lesser mistake.
 *
 * So the queue leads with the deadline and the review screen leads with what
 * an automatic pass could not see. Neither pretends the other does not exist.
 */
export function PublicRecordsView() {
  const { can } = useStore();
  const [page, setPage] = useState<PublicRequestRow[]>([]);
  const [policyAuthority, setPolicyAuthority] = useState('');
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<string>('');
  const [logging, setLogging] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.publicRequests(scope);
      setPage(result.requests);
      setTotal(result.total);
      setPolicyAuthority(result.policy.authority);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  if (open) {
    return (
      <RequestDetail
        id={open}
        onBack={() => {
          setOpen('');
          void load();
        }}
      />
    );
  }

  const late = page.filter((row) => row.standing.overdue && row.standing.running).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={scope === 'open' ? 'primary' : 'ghost'}
          onClick={() => setScope('open')}
        >
          Open ({scope === 'open' ? total : '—'})
        </Button>
        <Button variant={scope === 'all' ? 'primary' : 'ghost'} onClick={() => setScope('all')}>
          Everything
        </Button>
        <div className="flex-1" />
        {/*
          Open to everybody. A request that goes unlogged because the only
          clerk was at lunch is a statutory clock that never started — and it
          runs from when it arrived, not from when it was typed in.
        */}
        <Button variant="primary" onClick={() => setLogging(true)}>
          <Plus size={15} aria-hidden />
          Log a request
        </Button>
      </div>

      {!policyAuthority && can('agency.configure') && (
        <p className="flex items-start gap-2 rounded-xl border border-warn/45 bg-warn/5 p-3 text-[12.5px] leading-relaxed text-warn">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Nobody has recorded which public records act this agency answers under, so the deadlines
            below are a default rather than a policy. Set it under Exemptions.
          </span>
        </p>
      )}

      {late > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-danger/35 bg-danger-soft p-3 text-[12.5px] leading-relaxed text-ink">
          <Clock size={15} className="mt-0.5 shrink-0 text-danger" aria-hidden />
          <span>
            {late === 1 ? 'One request is' : `${late} requests are`} past the statutory deadline.
          </span>
        </p>
      )}

      {logging && (
        <LogRequest
          onDone={(created) => {
            setLogging(false);
            if (created) void load();
          }}
        />
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 size={15} className="animate-spin" aria-hidden />
          Loading…
        </p>
      ) : page.length === 0 ? (
        <EmptyState
          icon={<Inbox size={20} />}
          title="Nothing waiting"
          body="Public records requests are logged here by whoever takes them, and the clock runs from the moment one arrives."
        />
      ) : (
        <ul className="space-y-2">
          {page.map((row) => (
            <li key={row.request.id}>
              <button
                type="button"
                onClick={() => setOpen(row.request.id)}
                className="w-full rounded-xl border border-line bg-surface p-3 text-left transition hover:border-accent/40"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12.5px] text-ink">{row.request.number}</span>
                  <Badge tone="neutral">{STAGE_LABEL[row.stage]}</Badge>
                  <Deadline standing={row.standing} />
                </div>
                <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink">
                  {row.request.description}
                </p>
                <p className="mt-0.5 text-[11.5px] text-faint">
                  {CHANNEL_LABEL[row.request.channel]} ·{' '}
                  {row.request.requester.name || 'Requester did not give a name'}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Deadline({ standing }: { standing: Standing }) {
  const tone = standing.tone === 'late' ? 'danger' : standing.tone === 'soon' ? 'warn' : standing.tone === 'done' ? 'ok' : 'neutral';
  return <Badge tone={tone}>{standing.line}</Badge>;
}

/* ------------------------------------------------------------------ */
/* Logging one                                                         */
/* ------------------------------------------------------------------ */

const CHANNELS: RequestChannel[] = ['counter', 'email', 'post', 'portal', 'phone'];

const field =
  'w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint';

function LogRequest({ onDone }: { onDone: (created: boolean) => void }) {
  const [description, setDescription] = useState('');
  const [channel, setChannel] = useState<RequestChannel>('email');
  const [requester, setRequester] = useState({ name: '', organization: '', email: '', phone: '', address: '', collect: '' });
  const [problem, setProblem] = useState<{ error: string; advice?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setProblem(null);
    try {
      await api.logPublicRequest({ description, channel, requester });
      onDone(true);
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as { error?: string; advice?: string }) : null;
      setProblem({ error: body?.error ?? String(error), advice: body?.advice });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title="Log a request"
      description="The clock runs from when it arrived, not from when it is typed in — so log it now and fill the rest in later."
    >
      <textarea
        autoFocus
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What did they ask for? Their own words are best, even where they are vague."
        className={field}
      />

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-muted">How it arrived</span>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as RequestChannel)}
            className={field}
          >
            {CHANNELS.map((value) => (
              <option key={value} value={value}>
                {CHANNEL_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-muted">Name, if they gave one</span>
          <input
            value={requester.name}
            onChange={(e) => setRequester({ ...requester, name: e.target.value })}
            placeholder="Optional"
            className={field}
          />
        </label>
      </div>

      {/*
        Said out loud on the form, because a clerk who does not know this asks
        for identification as a matter of course, and in several states that is
        unlawful on its own.
      */}
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">
        Their name is optional, and asking for it as a condition of answering is forbidden in
        several states. What is needed is a way to hand the records back.
      </p>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input
          value={requester.email}
          onChange={(e) => setRequester({ ...requester, email: e.target.value })}
          placeholder="Email"
          className={field}
        />
        <input
          value={requester.phone}
          onChange={(e) => setRequester({ ...requester, phone: e.target.value })}
          placeholder="Telephone"
          className={field}
        />
        <input
          value={requester.address}
          onChange={(e) => setRequester({ ...requester, address: e.target.value })}
          placeholder="Postal address"
          className={field}
        />
        <input
          value={requester.collect}
          onChange={(e) => setRequester({ ...requester, collect: e.target.value })}
          placeholder="Or: collecting at the counter"
          className={field}
        />
      </div>

      {problem && (
        <div className="mt-2 rounded-lg border border-danger/35 bg-danger-soft p-2.5">
          <p className="text-[12.5px] font-medium text-danger">{problem.error}</p>
          {problem.advice && (
            <p className="mt-1 text-[12px] leading-relaxed text-ink/80">{problem.advice}</p>
          )}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          Log it
        </Button>
        <Button variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* One request                                                         */
/* ------------------------------------------------------------------ */

function RequestDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { incidents } = useStore();
  const [row, setRow] = useState<(PublicRequestRow & { mayRelease: boolean; implied: Outcome }) | null>(null);
  const [reviewing, setReviewing] = useState('');
  const [problem, setProblem] = useState<string>('');

  const load = useCallback(async () => {
    setRow(await api.publicRequest(id));
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (work: () => Promise<unknown>) => {
    setProblem('');
    try {
      await work();
      await load();
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as { error?: string; advice?: string }) : null;
      setProblem([body?.error, body?.advice].filter(Boolean).join(' ') || String(error));
    }
  };

  if (!row) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted">
        <Loader2 size={15} className="animate-spin" aria-hidden />
        Loading…
      </p>
    );
  }

  const { request, standing, stage, mayRelease } = row;
  const paused = request.pauses.find((pause) => !pause.until);

  if (reviewing) {
    return (
      <ReviewRecord
        requestId={id}
        itemId={reviewing}
        onBack={() => {
          setReviewing('');
          void load();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack}>
        <ChevronLeft size={16} aria-hidden />
        The queue
      </Button>

      <Panel
        title={request.number}
        description={`${CHANNEL_LABEL[request.channel]} on ${request.receivedAt.slice(0, 10)}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{STAGE_LABEL[stage]}</Badge>
          <Deadline standing={standing} />
        </div>
        <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">
          {request.description}
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          {[
            request.requester.name,
            request.requester.organization,
            request.requester.email,
            request.requester.phone,
            request.requester.address,
            request.requester.collect,
          ]
            .filter(Boolean)
            .join(' · ') || 'Requester gave no details.'}
        </p>

        {request.closure && (
          <p className="mt-3 rounded-lg border border-line bg-canvas p-2.5 text-[12.5px] leading-relaxed text-ink">
            <span className="font-medium">{OUTCOME_LABEL[request.closure.outcome]}</span> by{' '}
            {request.closure.byName} on {request.closure.at.slice(0, 10)}
            {request.closure.reason && (
              <span className="mt-1 block text-muted">{request.closure.reason}</span>
            )}
          </p>
        )}
      </Panel>

      {problem && (
        <p className="rounded-xl border border-danger/35 bg-danger-soft p-3 text-[12.5px] leading-relaxed text-ink">
          {problem}
        </p>
      )}

      {mayRelease && !request.closure && (
        <Panel
          title="The clock"
          description="It stops only for time the requester controls — waiting on a clarification, or on a fee they have not paid. Being busy is not one of them."
        >
          {paused ? (
            <div className="space-y-2">
              <p className="text-[12.5px] leading-relaxed text-warn">
                {PAUSE_LABEL[paused.reason]}, since {paused.from.slice(0, 10)}.
                {paused.note && <span className="block text-muted">{paused.note}</span>}
              </p>
              <Button onClick={() => void act(() => api.resumePublicRequest(id))}>
                <Play size={15} aria-hidden />
                They have answered — start it again
              </Button>
            </div>
          ) : (
            <PauseControls onPause={(reason, note) => act(() => api.pausePublicRequest(id, reason, note))} />
          )}
          <ExtendControls onExtend={(days, reason) => act(() => api.extendPublicRequest(id, days, reason))} />
        </Panel>
      )}

      <Panel
        title="Records found"
        description="Every record going out is read and approved by a person first."
      >
        {request.items.length === 0 && (
          <p className="text-[13px] leading-relaxed text-muted">Nothing attached yet.</p>
        )}
        <ul className="space-y-2">
          {request.items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2"
            >
              <FileText size={15} className="shrink-0 text-faint" aria-hidden />
              <span className="flex-1 font-mono text-[12.5px] text-ink">{item.label}</span>
              {item.review?.approvedAt ? (
                <Badge tone="ok">Approved by {item.review.approvedByName}</Badge>
              ) : (
                <Badge tone="warn">Not reviewed</Badge>
              )}
              {mayRelease && !request.closure && (
                <>
                  <Button onClick={() => setReviewing(item.id)}>
                    <Eye size={14} aria-hidden />
                    Review
                  </Button>
                  <button
                    type="button"
                    aria-label={`Remove ${item.label}`}
                    onClick={() => void act(() => api.detachPublicRecord(id, item.id))}
                    className="rounded-lg p-1.5 text-faint transition hover:bg-canvas hover:text-danger"
                  >
                    <Trash2 size={15} aria-hidden />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>

        {mayRelease && !request.closure && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              aria-label="Attach a report"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) void act(() => api.attachPublicRecord(id, 'incident', e.target.value));
                e.target.value = '';
              }}
              className={cn(field, 'max-w-[320px]')}
            >
              <option value="">Attach a report…</option>
              {incidents.map((incident) => (
                <option key={incident.id} value={incident.id}>
                  {incident.caseNumber}
                </option>
              ))}
            </select>
          </div>
        )}
      </Panel>

      {mayRelease && !request.closure && (
        <CloseRequest
          implied={row.implied}
          onClose={(outcome, reason) => act(() => api.closePublicRequest(id, outcome, reason))}
        />
      )}

      <Correspondence
        request={request}
        onSend={(direction, text) => act(() => api.addPublicRequestNote(id, direction, text))}
      />
    </div>
  );
}

function PauseControls({ onPause }: { onPause: (reason: 'clarification' | 'fee', note: string) => void }) {
  const [reason, setReason] = useState<'clarification' | 'fee'>('clarification');
  const [note, setNote] = useState('');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as 'clarification' | 'fee')}
          aria-label="Why the clock is stopping"
          className={cn(field, 'max-w-[320px]')}
        >
          <option value="clarification">{PAUSE_LABEL.clarification}</option>
          <option value="fee">{PAUSE_LABEL.fee}</option>
        </select>
        <Button onClick={() => onPause(reason, note)}>
          <Pause size={15} aria-hidden />
          Stop the clock
        </Button>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What was asked of them"
        className={field}
      />
    </div>
  );
}

function ExtendControls({ onExtend }: { onExtend: (days: number, reason: string) => void }) {
  const [days, setDays] = useState(5);
  const [reason, setReason] = useState('');
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
      <label className="block">
        <span className="mb-1 block text-[11.5px] text-muted">Extra days</span>
        <input
          type="number"
          min={1}
          value={days}
          onChange={(e) => setDays(Number(e.target.value) || 1)}
          className={cn(field, 'w-24')}
        />
      </label>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why — this text goes to the requester"
        className={cn(field, 'min-w-[240px] flex-1')}
      />
      <Button onClick={() => onExtend(days, reason)}>Take an extension</Button>
    </div>
  );
}

const OUTCOMES: Outcome[] = ['released', 'partial', 'denied', 'noRecords', 'withdrawn'];

function CloseRequest({
  implied,
  onClose,
}: {
  implied: Outcome;
  onClose: (outcome: Outcome, reason: string) => void;
}) {
  const [outcome, setOutcome] = useState<Outcome>(implied);
  const [reason, setReason] = useState('');
  const needsReason = outcome === 'denied' || outcome === 'partial';

  return (
    <Panel
      title="Answer the request"
      description="A denial and a partial release both need their reason in writing — in most states that text is what an appeal is decided on."
    >
      <div className="flex flex-wrap gap-2">
        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as Outcome)}
          aria-label="What the answer is"
          className={cn(field, 'max-w-[280px]')}
        >
          {OUTCOMES.map((value) => (
            <option key={value} value={value}>
              {OUTCOME_LABEL[value]}
            </option>
          ))}
        </select>
        <Button variant="primary" onClick={() => onClose(outcome, reason)}>
          <Send size={15} aria-hidden />
          Close it out
        </Button>
      </div>
      {needsReason && (
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Name the exemption and what it covers. This is what goes to the requester."
          className={cn(field, 'mt-2')}
        />
      )}
      {outcome === 'partial' && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-faint">{WITHHOLDING_NOTICE}</p>
      )}
    </Panel>
  );
}

function Correspondence({
  request,
  onSend,
}: {
  request: PublicRequest;
  onSend: (direction: 'in' | 'out', text: string) => void;
}) {
  const [text, setText] = useState('');
  return (
    <Panel title="What has been said" description="Kept in order, so an appeal has the whole exchange.">
      <ul className="space-y-2">
        {request.correspondence.map((entry) => (
          <li key={entry.id} className="rounded-lg border border-line bg-surface px-3 py-2">
            <p className="text-[11.5px] text-faint">
              {entry.direction === 'out' ? `To the requester · ${entry.byName}` : 'From the requester'} ·{' '}
              {entry.at.slice(0, 10)}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">
              {entry.text}
            </p>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Record what was said"
          className={cn(field, 'min-w-[240px] flex-1')}
        />
        <Button
          onClick={() => {
            onSend('out', text);
            setText('');
          }}
        >
          Sent to them
        </Button>
        <Button
          onClick={() => {
            onSend('in', text);
            setText('');
          }}
        >
          Heard from them
        </Button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Reviewing one record                                                */
/* ------------------------------------------------------------------ */

/**
 * The screen where a person decides.
 *
 * Everything above the proposal is what the automatic pass could *not* do,
 * because that is the part a clerk will otherwise assume was handled. The
 * spans come second, and the count on them is never presented as a total.
 */
function ReviewRecord({
  requestId,
  itemId,
  onBack,
}: {
  requestId: string;
  itemId: string;
  onBack: () => void;
}) {
  const [view, setView] = useState<ProposalView | null>(null);
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});
  const [answered, setAnswered] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<AttachmentDecision[]>([]);
  const [readInFull, setReadInFull] = useState(false);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    void (async () => {
      const loaded = await api.redactionProposal(requestId, itemId);
      setView(loaded);
      const existing = loaded.review;
      setDecisions(
        Object.fromEntries(
          loaded.proposal.spans.map((span) => [
            span.id,
            existing
              ? // A span the clerk already rejected stays rejected on a second look.
                !existing.spans.some(
                  (previous) =>
                    previous.field === span.field &&
                    previous.start === span.start &&
                    previous.decision === 'rejected',
                )
              : true,
          ]),
        ),
      );
      setAnswered(existing?.answered ?? []);
      setAttachments(
        loaded.proposal.unreadable.map(
          (item) =>
            existing?.attachments.find((decision) => decision.filename === item.label) ?? {
              attachmentId: '',
              filename: item.label,
              outcome: 'released' as const,
              authority: '',
              note: '',
            },
        ),
      );
      setReadInFull(existing?.readInFull ?? false);
      setBlockers(loaded.blockers);
    })();
  }, [requestId, itemId]);

  const spans: DecidedSpan[] = useMemo(
    () =>
      (view?.proposal.spans ?? []).map((span) => ({
        ...span,
        decision: decisions[span.id] === false ? ('rejected' as const) : ('accepted' as const),
        addedByClerk: false,
        note: '',
      })),
    [view, decisions],
  );

  const save = async (approve: boolean) => {
    setSaving(true);
    setProblem('');
    try {
      const result = await api.saveRedactionReview(requestId, itemId, {
        spans,
        answered,
        attachments,
        readInFull,
        approve,
      });
      setBlockers(result.blockers ?? []);
      if (approve && (result.blockers ?? []).length === 0) onBack();
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as { error?: string; advice?: string; blockers?: Blocker[] }) : null;
      setBlockers(body?.blockers ?? []);
      if (!body?.blockers) setProblem([body?.error, body?.advice].filter(Boolean).join(' ') || String(error));
    } finally {
      setSaving(false);
    }
  };

  if (!view) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted">
        <Loader2 size={15} className="animate-spin" aria-hidden />
        Reading the record…
      </p>
    );
  }

  const accepted = spans.filter((span) => span.decision === 'accepted').length;

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack}>
        <ChevronLeft size={16} aria-hidden />
        The request
      </Button>

      <Panel
        title={view.label}
        description="What an automatic pass found. It is not what there is."
      >
        {/*
          First, before any count. A clerk who reads "4 redactions proposed"
          and nothing else will believe four is the number.
        */}
        <p className="rounded-xl border border-warn/45 bg-warn/5 p-3 text-[12.5px] leading-relaxed text-warn">
          {NOT_EXHAUSTIVE}
        </p>

        <p className="mt-2 text-[12px] leading-relaxed text-faint">
          {view.proposal.ranRules.length} rules ran on this record:{' '}
          {view.proposal.ranRules.map((rule) => rule.label).join(', ') || 'none'}. Anything not on
          that list was never checked for.
        </p>
      </Panel>

      {blockers.length > 0 && (
        <Panel title="Before this can go out">
          <ul className="space-y-2">
            {blockers.map((blocker) => (
              <li
                key={blocker.field}
                className="rounded-lg border border-warn/45 bg-warn/5 px-3 py-2"
              >
                <p className="text-[12.5px] font-medium text-warn">{blocker.reason}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink/80">{blocker.advice}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {view.proposal.notices.length > 0 && (
        <Panel
          title="Things nothing here can find"
          description="Each of these needs a person to read the record and decide. Mark it once you have."
        >
          <ul className="space-y-2">
            {view.proposal.notices.map((notice) => (
              <li key={notice.ruleId} className="rounded-lg border border-line bg-surface px-3 py-2">
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={answered.includes(notice.ruleId)}
                    onChange={(e) =>
                      setAnswered(
                        e.target.checked
                          ? [...answered, notice.ruleId]
                          : answered.filter((id) => id !== notice.ruleId),
                      )
                    }
                  />
                  <span>
                    <span className="text-[13px] font-medium text-ink">{notice.ruleLabel}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">
                      {notice.message}
                    </span>
                    {notice.authority && (
                      <span className="mt-0.5 block text-[11.5px] text-faint">
                        {notice.authority}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {view.proposal.unreadable.length > 0 && (
        <Panel
          title="Files nothing here has looked inside"
          description="A redaction drawn over an image is not a redaction unless the file that goes out has been changed."
        >
          <ul className="space-y-2">
            {attachments.map((decision, index) => (
              <li key={decision.filename} className="rounded-lg border border-line bg-surface p-3">
                <p className="font-mono text-[12.5px] text-ink">{decision.filename}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <select
                    value={decision.outcome}
                    aria-label={`What happens to ${decision.filename}`}
                    onChange={(e) =>
                      setAttachments(
                        attachments.map((entry, i) =>
                          i === index
                            ? { ...entry, outcome: e.target.value as AttachmentDecision['outcome'] }
                            : entry,
                        ),
                      )
                    }
                    className={cn(field, 'max-w-[240px]')}
                  >
                    <option value="released">Goes out as it is</option>
                    <option value="withheld">Withheld</option>
                    <option value="replaced">A redacted copy goes instead</option>
                  </select>
                  {decision.outcome !== 'released' && (
                    <input
                      value={decision.authority}
                      onChange={(e) =>
                        setAttachments(
                          attachments.map((entry, i) =>
                            i === index ? { ...entry, authority: e.target.value } : entry,
                          ),
                        )
                      }
                      placeholder="Under what statute"
                      className={cn(field, 'min-w-[220px] flex-1')}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title={`${view.proposal.spans.length} passages found`}
        description="Every one is a suggestion. Uncheck anything that should go out — over-redaction is its own unlawful act, not a safe default."
      >
        {view.proposal.spans.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-muted">
            Nothing matched. That is not the same as nothing being there.
          </p>
        ) : (
          <ul className="space-y-2">
            {view.proposal.spans.map((span) => (
              <SpanRow
                key={span.id}
                span={span}
                /*
                  The words around it, as the release will actually read —
                  every other accepted redaction already applied. Drawn from
                  the original, a row would show a name in its context that the
                  row below it is blacking out, which reads as though that one
                  is going out. The equal-length marker is what makes this free:
                  the offsets still mean what they meant.
                */
                text={applyRedactions(
                  view.fields[span.field] ?? '',
                  spans.filter((other) => other.decision === 'accepted' && other.id !== span.id),
                )}
                accepted={decisions[span.id] !== false}
                onToggle={(value) => setDecisions({ ...decisions, [span.id]: value })}
              />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Sign it off">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={readInFull}
            onChange={(e) => setReadInFull(e.target.checked)}
          />
          <span className="text-[13px] leading-relaxed text-ink">
            I have read this record in full, including anything the list above did not reach.
          </span>
        </label>

        <p className="mt-2 text-[12px] leading-relaxed text-faint">
          {accepted} of {view.proposal.spans.length} passages would be withheld.
        </p>

        {problem && (
          <p className="mt-2 rounded-lg border border-danger/35 bg-danger-soft p-2.5 text-[12.5px] leading-relaxed text-ink">
            {problem}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" disabled={saving} onClick={() => void save(true)}>
            Approve it for release
          </Button>
          <Button disabled={saving} onClick={() => void save(false)}>
            Save without approving
          </Button>
          <Button
            disabled={saving}
            onClick={() =>
              void (async () => {
                try {
                  await api.saveRedactionReview(requestId, itemId, { spans, answered, attachments, readInFull, approve: false });
                  const { release } = await api.redactionPreview(requestId, itemId);
                  setPreview(release.fields);
                } catch (error) {
                  setProblem(String(error));
                }
              })()
            }
          >
            <Eye size={15} aria-hidden />
            Show what would go out
          </Button>
        </div>

        {preview && (
          <div className="mt-3 space-y-2">
            {Object.entries(preview).map(([name, body]) => (
              <div key={name}>
                <p className="text-[11.5px] uppercase tracking-wide text-faint">{name}</p>
                <p className="mt-1 whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3 text-[12.5px] leading-relaxed text-ink">
                  {body}
                </p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/** One proposal, with enough of the sentence around it to judge. */
function SpanRow({
  span,
  text,
  accepted,
  onToggle,
}: {
  span: Span;
  text: string;
  accepted: boolean;
  onToggle: (accepted: boolean) => void;
}) {
  /*
    `text` arrives with every *other* accepted redaction applied, so the
    surrounding words read as the release will. This span's own text comes from
    the proposal, because it is the thing being decided and blacking it out
    either way would leave nothing to decide about.
  */
  const before = text.slice(Math.max(0, span.start - 60), span.start);
  const after = text.slice(span.end, span.end + 60);

  return (
    <li
      className={cn(
        'rounded-lg border p-3',
        accepted ? 'border-line bg-surface' : 'border-line bg-canvas opacity-70',
      )}
    >
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
          checked={accepted}
          aria-label={`Withhold ${span.text}`}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] leading-relaxed text-ink">
            <span className="text-faint">…{before}</span>
            <mark
              className={cn(
                'rounded px-0.5',
                accepted ? 'bg-ink text-ink' : 'bg-warn-soft text-ink',
              )}
            >
              {accepted ? MARKER.repeat(Math.min(span.text.length, 40)) : span.text}
            </mark>
            <span className="text-faint">{after}…</span>
          </span>
          <span className="mt-1 block text-[11.5px] text-muted">
            <span className="font-medium">{span.ruleLabel}</span>
            {span.authority ? ` · ${span.authority}` : ' · no statute named'} · {span.because}
          </span>
          {!accepted && (
            <span className="mt-0.5 block text-[11.5px] text-warn">
              This will go out as written: “{span.text}”
            </span>
          )}
        </span>
      </label>
    </li>
  );
}
