import { useMemo, useState } from 'react';
import { Download, Loader2, Send, TriangleAlert, Users } from 'lucide-react';
import { useStore } from '@/state/store';
import {
  IMPACT_LABEL,
  IMPACT_TONE,
  KIND_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  triage,
  type Feedback,
  type FeedbackStatus,
} from '@/domain/feedback';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * What officers have said, in the order it is worth reading.
 *
 * Not newest first. A queue sorted by arrival buries the thing stopping four
 * officers under twelve fresh notes about a label, and a vendor working top to
 * bottom then fixes the labels.
 */
export function FeedbackQueue() {
  const { feedback, feedbackForwarding, answerFeedback, forwardFeedback, can } = useStore();
  const [filter, setFilter] = useState<'open' | 'all'>('open');

  const mayAnswer = can('agency.configure');
  const items = useMemo(() => {
    const ordered = triage(feedback);
    return filter === 'open'
      ? ordered.filter((f) => f.status === 'new' || f.status === 'reading' || f.status === 'planned')
      : ordered;
  }, [feedback, filter]);

  const unsent = feedback.filter((f) => !f.forwarded).length;

  const exportAll = () => {
    /*
      The way feedback actually reaches a vendor on an install with no outbound
      network, which is most of them. A file somebody attaches to a support
      ticket beats a channel that silently does nothing.
    */
    const blob = new Blob([JSON.stringify(triage(feedback), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `feedback-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Panel
      title={mayAnswer ? 'Feedback from your officers' : 'What people here have raised'}
      description={
        mayAnswer
          ? 'Everything anyone here has sent about this software. Kept in your own database, so you can always see what has left the building.'
          : 'Everything anyone here has said about this software, and the answers. If one of these is yours, the answer appears against it.'
      }
      aside={<Users size={17} className="text-faint" aria-hidden />}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {(['open', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                'rounded-lg px-2.5 py-1 text-[12.5px] font-medium transition',
                filter === f ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60',
              )}
            >
              {f === 'open' ? 'Still open' : 'Everything'}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {mayAnswer && (
          <Button size="sm" onClick={exportAll} disabled={feedback.length === 0}>
            <Download size={13} aria-hidden />
            Export all
          </Button>
        )}
      </div>

      {/*
        Only to somebody who can act on it. An officer told their feedback is
        stuck behind a server setting they cannot reach learns that reporting
        things is pointless, which is the opposite of what this exists for.
      */}
      {mayAnswer && !feedbackForwarding && unsent > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-raised px-3 py-2 text-[12.5px] leading-relaxed text-ink">
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <span>
            This install does not send feedback anywhere on its own — {unsent}{' '}
            {unsent === 1 ? 'item is' : 'items are'} waiting. Export the file and send it on, or set
            a vendor address in the server configuration. Nothing leaves your network until you do
            one of those.
          </span>
        </p>
      )}

      {items.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted">
          {filter === 'open' ? 'Nothing open.' : 'Nobody has sent anything yet.'}
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <QueueItem
              key={item.id}
              item={item}
              mayAnswer={mayAnswer}
              forwarding={feedbackForwarding}
              onAnswer={(patch) => answerFeedback(item.id, patch)}
              onForward={() => forwardFeedback(item.id)}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

function QueueItem({
  item,
  mayAnswer,
  forwarding,
  onAnswer,
  onForward,
}: {
  item: Feedback;
  mayAnswer: boolean;
  forwarding: boolean;
  onAnswer: (patch: { status?: FeedbackStatus; response?: string }) => Promise<{ ok: boolean; reason?: string }>;
  onForward: () => Promise<{ ok: boolean; reason?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [response, setResponse] = useState(item.response);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: { status?: FeedbackStatus; response?: string }) => {
    setBusy(true);
    setError(null);
    const result = await onAnswer(patch);
    setBusy(false);
    if (!result.ok) setError(result.reason ?? 'Could not save it.');
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    const result = await onForward();
    setBusy(false);
    if (!result.ok) setError(result.reason ?? 'Could not send it.');
  };

  return (
    <div className="rounded-xl border border-line">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">{item.summary}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-faint">
            <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
            <Badge tone={IMPACT_TONE[item.impact]}>{IMPACT_LABEL[item.impact]}</Badge>
            <span>{KIND_LABEL[item.kind]}</span>
            <span aria-hidden>·</span>
            <span>{item.submittedByName}</span>
            <span aria-hidden>·</span>
            <span>{item.context.screen}</span>
            {item.seconded.length > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="font-medium text-ink">
                  +{item.seconded.length} {item.seconded.length === 1 ? 'other' : 'others'}
                </span>
              </>
            )}
            {mayAnswer && !item.forwarded && <Badge tone="warn">Not sent</Badge>}
          </p>
        </div>
        <span className="shrink-0 text-[11.5px] text-faint">{open ? 'Hide' : 'Open'}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-line px-3 py-3">
          {item.detail && (
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">
              {item.detail}
            </p>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px]">
            <Fact label="Screen" value={item.context.screen} />
            <Fact label="Field" value={item.context.field || '—'} mono />
            <Fact label="Build" value={item.context.version || '—'} mono />
            <Fact label="Sent" value={new Date(item.at).toLocaleString()} />
            <Fact label="Role" value={item.submittedByRole} />
            <Fact label="Browser" value={item.context.userAgent || '—'} />
          </dl>

          {mayAnswer ? (
            <>
              <div className="flex flex-wrap gap-1">
                {(Object.keys(STATUS_LABEL) as FeedbackStatus[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => void save({ status: s, response })}
                    aria-pressed={item.status === s}
                    className={cn(
                      'rounded-lg border px-2 py-1 text-[11.5px] font-medium transition',
                      item.status === s
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-line text-muted hover:border-line-strong hover:text-ink',
                    )}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>

              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink">
                  What to tell them
                  <span className="ml-1.5 font-normal text-faint">
                    shown to whoever raised it, next time they open feedback
                  </span>
                </span>
                <textarea
                  rows={2}
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  placeholder="Fixed in the next release — the button now says which field is missing."
                  className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] leading-relaxed text-ink placeholder:text-faint"
                />
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy || response === item.response}
                  onClick={() => void save({ response })}
                >
                  {busy && <Loader2 size={13} className="animate-spin" aria-hidden />}
                  Save the answer
                </Button>
                {forwarding && !item.forwarded && (
                  <Button size="sm" disabled={busy} onClick={() => void send()}>
                    <Send size={13} aria-hidden />
                    Try sending again
                  </Button>
                )}
                {error && <span className="text-[12px] text-danger">{error}</span>}
              </div>
            </>
          ) : (
            item.response && (
              <div className="rounded-lg bg-raised px-3 py-2">
                <p className="text-[11.5px] font-medium uppercase tracking-wide text-faint">
                  Answered by {item.respondedByName}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">
                  {item.response}
                </p>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-faint">{label}</dt>
      <dd className={cn('truncate text-ink', mono && 'font-mono text-[11px]')} title={value}>
        {value}
      </dd>
    </div>
  );
}
