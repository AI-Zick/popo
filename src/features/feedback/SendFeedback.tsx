import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  CircleAlert,
  Eraser,
  Loader2,
  MessageSquarePlus,
  Send,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useStore } from '@/state/store';
import {
  DETAIL_MAX,
  IMPACT_LABEL,
  KIND_HINT,
  KIND_LABEL,
  STATUS_LABEL,
  SUMMARY_MAX,
  alreadyRaised,
  answeredFor,
  checkDraft,
  describeFindings,
  hasSeconded,
  mustAcknowledge,
  redact,
  scan,
  type Feedback,
  type FeedbackContext,
  type FeedbackKind,
  type Impact,
} from '@/domain/feedback';
import { Badge, Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * Telling the vendor something is wrong, from wherever you are.
 *
 * The design constraint that shapes everything here: this is a free-text box in
 * a police records system, and the text goes outside the agency. An officer
 * explaining a fault will paste whatever makes it legible — a case number, a
 * date of birth, a name — because that is how people explain faults, not
 * because they are careless.
 *
 * So the form says plainly where it goes, scans as they type, and shows back
 * what it found with one click to replace it. It does not silently rewrite
 * them: an officer who finds their words altered stops using the channel, and a
 * channel nobody uses is the actual failure mode here.
 */
export function SendFeedback({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    feedback,
    feedbackForwarding,
    sendFeedback,
    secondFeedback,
    currentUser,
    agency,
    incident,
    supplement,
    crash,
  } = useStore();
  const lastField = useLastField();

  const [tab, setTab] = useState<'write' | 'raised'>('write');
  const [context, setContext] = useState<FeedbackContext | null>(null);
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [impact, setImpact] = useState<Impact>('workaround');
  const [summary, setSummary] = useState('');
  const [detail, setDetail] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ redacted: number } | null>(null);
  const summaryRef = useRef<HTMLInputElement>(null);

  /*
    Captured at the moment the form opens, before focus moves into it.

    This is the difference between "the date field is broken" and a report the
    vendor can act on without a phone call. It is all structural — which screen,
    which field, which build — and never content; the case number is
    deliberately not among it.
  */
  useEffect(() => {
    if (!open) return;
    setContext({
      screen: describeScreen({
        incident: Boolean(incident),
        supplement: Boolean(supplement),
        crash: Boolean(crash),
      }),
      field: lastField.current,
      version: __APP_VERSION__,
      agencyOri: agency.ori,
      agencyName: agency.name,
      userAgent: navigator.userAgent,
    });
    setSent(null);
    setError(null);
    // A fresh form every time, so yesterday's half-written note is not sent by
    // somebody who opened this to say something else.
    setSummary('');
    setDetail('');
    setAcknowledged(false);
    setTab('write');
    window.setTimeout(() => summaryRef.current?.focus(), 30);
    // `lastField` is a ref and deliberately not a dependency: re-running this
    // on every focus change would wipe a half-written note.
  }, [open, agency.ori, agency.name, incident, supplement, crash, lastField]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const findings = useMemo(() => scan(`${summary}\n${detail}`), [summary, detail]);
  const blocked = mustAcknowledge(findings) && !acknowledged;

  const others = useMemo(
    () => alreadyRaised(feedback, currentUser.id),
    [feedback, currentUser.id],
  );
  const answers = useMemo(() => answeredFor(feedback, currentUser.id), [feedback, currentUser.id]);

  if (!open || !context) return null;

  const draft = { kind, impact, summary, detail, context };
  const problems = checkDraft(draft);

  const replaceAll = () => {
    setSummary(redact(summary, scan(summary)));
    setDetail(redact(detail, scan(detail)));
    setAcknowledged(false);
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    const result = await sendFeedback(draft);
    setBusy(false);
    if (!result.ok) {
      setError(result.reason ?? 'Could not send it.');
      return;
    }
    setSent({ redacted: result.redacted ?? 0 });
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-start justify-center bg-black/40 px-4 pt-[8vh] backdrop-blur-[2px] print:hidden"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Send feedback to the vendor"
        className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4">
          <MessageSquarePlus size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="text-[14.5px] font-semibold text-ink">Tell us what is wrong</h2>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
              This goes to the people who build this software, not to your department.{' '}
              {feedbackForwarding
                ? 'It is sent as soon as you post it.'
                : 'It is held here until your administrator sends it on.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-faint transition hover:bg-raised hover:text-ink"
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        {sent ? (
          <Sent redacted={sent.redacted} onClose={onClose} />
        ) : (
          <>
            <nav className="flex shrink-0 gap-1 border-b border-line px-4 py-2">
              <TabButton active={tab === 'write'} onClick={() => setTab('write')}>
                Say something
              </TabButton>
              <TabButton active={tab === 'raised'} onClick={() => setTab('raised')}>
                Already raised
                {others.length > 0 && (
                  <span className="ml-1.5 text-[11px] text-faint">{others.length}</span>
                )}
              </TabButton>
              {answers.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTab('raised')}
                  className="ml-auto flex items-center gap-1.5 rounded-lg bg-ok-soft px-2.5 py-1.5 text-[12px] font-medium text-ok"
                >
                  <Check size={13} aria-hidden />
                  {answers.length} of yours answered
                </button>
              )}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {tab === 'write' ? (
                <div className="space-y-4">
                  <fieldset>
                    <legend className="mb-2 text-[13px] font-medium text-ink">
                      What kind of thing is it?
                    </legend>
                    <div className="grid grid-cols-2 gap-2">
                      {(Object.keys(KIND_LABEL) as FeedbackKind[]).map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setKind(k)}
                          aria-pressed={kind === k}
                          className={cn(
                            'rounded-xl border px-3 py-2 text-left transition',
                            kind === k
                              ? 'border-accent bg-accent-soft'
                              : 'border-line hover:border-line-strong',
                          )}
                        >
                          <span className="block text-[13px] font-medium text-ink">
                            {KIND_LABEL[k]}
                          </span>
                          <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">
                            {KIND_HINT[k]}
                          </span>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <label className="block">
                    <span className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-ink">
                      In one line
                      <span className="text-[11.5px] font-normal text-faint">
                        {summary.length}/{SUMMARY_MAX}
                      </span>
                    </span>
                    <input
                      ref={summaryRef}
                      value={summary}
                      maxLength={SUMMARY_MAX}
                      onChange={(e) => setSummary(e.target.value)}
                      placeholder="The submit button gives no reason when it is greyed out"
                      className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink placeholder:text-faint"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-ink">
                      Anything else
                      <span className="ml-1.5 font-normal text-faint">optional</span>
                    </span>
                    <textarea
                      rows={5}
                      value={detail}
                      maxLength={DETAIL_MAX}
                      onChange={(e) => setDetail(e.target.value)}
                      placeholder="What you were trying to do, what happened instead, and what you expected."
                      className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px] leading-relaxed text-ink placeholder:text-faint"
                    />
                  </label>

                  {findings.length > 0 && (
                    <PrivacyWarning
                      description={describeFindings(findings)}
                      stopping={mustAcknowledge(findings)}
                      acknowledged={acknowledged}
                      onAcknowledge={setAcknowledged}
                      onReplace={replaceAll}
                    />
                  )}

                  <fieldset>
                    <legend className="mb-2 text-[13px] font-medium text-ink">
                      How much did it cost you?
                    </legend>
                    <div className="flex flex-col gap-1.5">
                      {(Object.keys(IMPACT_LABEL) as Impact[]).map((i) => (
                        <label
                          key={i}
                          className="flex cursor-pointer items-center gap-2 text-[13px] text-ink"
                        >
                          <input
                            type="radio"
                            name="impact"
                            checked={impact === i}
                            onChange={() => setImpact(i)}
                            className="size-4"
                          />
                          {IMPACT_LABEL[i]}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <ContextNote context={context} />
                </div>
              ) : (
                <RaisedList
                  answers={answers}
                  others={others}
                  currentUserId={currentUser.id}
                  onSecond={(id) => void secondFeedback(id)}
                />
              )}
            </div>

            {tab === 'write' && (
              <footer className="flex shrink-0 items-center gap-3 border-t border-line px-5 py-3">
                <Button
                  variant="primary"
                  disabled={busy || problems.length > 0 || blocked}
                  onClick={() => void send()}
                >
                  {busy ? (
                    <Loader2 size={15} className="animate-spin" aria-hidden />
                  ) : (
                    <Send size={15} aria-hidden />
                  )}
                  Send it
                </Button>
                <Button onClick={onClose}>Cancel</Button>
                <span className="text-[12px] text-danger">
                  {error ?? (blocked ? 'Deal with the warning above first.' : problems[0]?.message)}
                </span>
              </footer>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The warning that earns the whole feature its keep.
 *
 * Written as a prompt rather than a scolding: it says what it noticed and
 * offers to fix it, because an officer pasting a date of birth into a bug
 * report is doing the reasonable thing and should not be told off for it.
 */
function PrivacyWarning({
  description,
  stopping,
  acknowledged,
  onAcknowledge,
  onReplace,
}: {
  description: string;
  stopping: boolean;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  onReplace: () => void;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border px-3.5 py-3',
        stopping ? 'border-danger/40 bg-danger-soft' : 'border-warn/40 bg-warn-soft',
      )}
    >
      <p className="flex items-start gap-2 text-[13px] font-medium text-ink">
        {stopping ? (
          <ShieldAlert size={15} className="mt-0.5 shrink-0 text-danger" aria-hidden />
        ) : (
          <CircleAlert size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden />
        )}
        That looks like it has {description} in it.
      </p>
      <p className="mt-1 pl-[23px] text-[12.5px] leading-relaxed text-muted">
        This leaves your department, so it should describe the fault rather than the record it
        happened on. We can almost always reproduce a problem without the real data.
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-[23px]">
        <Button size="sm" onClick={onReplace}>
          <Eraser size={13} aria-hidden />
          Replace them for me
        </Button>
        {stopping && (
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => onAcknowledge(e.target.checked)}
              className="size-4 rounded border-line-strong"
            />
            Send anyway — the social security number will still be removed
          </label>
        )}
      </div>
    </div>
  );
}

/** What travels with it, said out loud rather than gathered quietly. */
function ContextNote({ context }: { context: FeedbackContext }) {
  return (
    <div className="rounded-lg border border-line bg-raised px-3 py-2.5">
      <p className="text-[12.5px] font-medium text-ink">Sent with this</p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        The screen you were on (<span className="text-ink">{context.screen}</span>)
        {context.field && (
          <>
            , the field you were in (
            <span className="font-mono text-[11.5px] text-ink">{context.field}</span>)
          </>
        )}
        , your name and your agency, and which build you are running. Nothing from the report
        itself, and no case number.
      </p>
    </div>
  );
}

function Sent({ redacted, onClose }: { redacted: number; onClose: () => void }) {
  return (
    <div className="px-5 py-6">
      <p className="flex items-center gap-2 text-[14px] font-medium text-ok">
        <Check size={17} aria-hidden />
        Sent. Thank you.
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
        You will see the answer here when there is one. If somebody else hits the same thing they
        can add their name to yours, which is how it gets moved up the list.
      </p>
      {redacted > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] leading-relaxed text-ink">
          <ShieldAlert size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          {redacted === 1 ? 'One social security number was' : `${redacted} social security numbers were`}{' '}
          removed before it was sent. The rest of what you wrote went as you wrote it.
        </p>
      )}
      <Button variant="primary" className="mt-4" onClick={onClose}>
        Back to work
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * What everyone else has already said, and the answers to what you said.
 *
 * The second half is the part that keeps the channel alive. An officer who
 * once saw "fixed — thank you" against something they reported will report the
 * next one; an officer who reports into silence never does.
 */
function RaisedList({
  answers,
  others,
  currentUserId,
  onSecond,
}: {
  answers: Feedback[];
  others: Feedback[];
  currentUserId: string;
  onSecond: (id: string) => void;
}) {
  if (answers.length === 0 && others.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-muted">
        Nothing raised yet. Yours would be the first.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {answers.length > 0 && (
        <section>
          <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-faint">
            Answers to yours
          </h3>
          <div className="space-y-2">
            {answers.map((item) => (
              <Item key={item.id} item={item} currentUserId={currentUserId} onSecond={onSecond} />
            ))}
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section>
          <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-faint">
            Raised by others
          </h3>
          <p className="mb-2 text-[12px] leading-relaxed text-muted">
            If one of these is what you came here to say, add your name to it instead of writing it
            again — four officers on one entry moves it up the list, four separate entries do not.
          </p>
          <div className="space-y-2">
            {others.map((item) => (
              <Item key={item.id} item={item} currentUserId={currentUserId} onSecond={onSecond} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const STATUS_TONE = {
  new: 'neutral',
  reading: 'accent',
  planned: 'accent',
  shipped: 'ok',
  declined: 'neutral',
} as const;

function Item({
  item,
  currentUserId,
  onSecond,
}: {
  item: Feedback;
  currentUserId: string;
  onSecond: (id: string) => void;
}) {
  const mine = item.submittedBy === currentUserId;
  const seconded = hasSeconded(item, currentUserId);

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">{item.summary}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-faint">
            <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
            <span>{KIND_LABEL[item.kind]}</span>
            <span aria-hidden>·</span>
            <span>{mine ? 'you' : item.submittedByName}</span>
            {item.seconded.length > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {item.seconded.length} {item.seconded.length === 1 ? 'other' : 'others'} hit this
                </span>
              </>
            )}
          </p>
        </div>

        {!mine && (
          <Button
            size="sm"
            variant={seconded ? 'primary' : 'secondary'}
            onClick={() => onSecond(item.id)}
            aria-pressed={seconded}
          >
            <ArrowUp size={13} aria-hidden />
            {seconded ? 'You said this too' : 'Same here'}
          </Button>
        )}
      </div>

      {item.detail && (
        <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
          {item.detail}
        </p>
      )}

      {item.response && (
        <div className="mt-2.5 rounded-lg bg-raised px-3 py-2">
          <p className="text-[11.5px] font-medium uppercase tracking-wide text-faint">
            {item.respondedByRole === 'vendor' ? 'From the vendor' : 'From your agency'}
            {item.respondedByName && ` · ${item.respondedByName}`}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">
            {item.response}
          </p>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg px-3 py-1.5 text-[13px] font-medium transition',
        active ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60',
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Which screen they were on.
 *
 * Derived from what the app knows, never read off the page — and this is not
 * fussiness. The first version of this scraped the `<h1>`, which on a report
 * screen is the case number, so the one thing the whole design promised would
 * never leave the agency was being posted to the vendor with every note. The
 * only safe answer is a closed set of literals the code chooses.
 *
 * A screen wanting to be more specific sets `data-screen` — also a literal,
 * also from a typed map, so there is no path from record content into it.
 */
function describeScreen(open: {
  incident: boolean;
  supplement: boolean;
  crash: boolean;
}): string {
  const declared = document.querySelector('[data-screen]')?.getAttribute('data-screen');
  if (declared) return declared.slice(0, 80);
  if (open.supplement) return 'Supplement';
  if (open.crash) return 'Crash report';
  if (open.incident) return 'Incident report';
  return 'Case list';
}

/**
 * The last field they were actually in.
 *
 * Not the one focused when the form opens — that is the feedback button. The
 * field they left to come here is the useful one, and it is the difference
 * between "a date is rejected" and a path the vendor can open directly.
 */
function useLastField(): { current: string } {
  const last = useRef('');
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const target = e.target as Element | null;
      const path = target?.closest?.('[data-field-path]')?.getAttribute('data-field-path');
      if (path) last.current = path;
    };
    window.addEventListener('focusin', onFocus);
    return () => window.removeEventListener('focusin', onFocus);
  }, []);
  return last;
}
