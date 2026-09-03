import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Car,
  Check,
  CircleCheck,
  ClipboardCheck,
  Gauge,
  Loader2,
  Plus,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { useStore } from '@/state/store';
import {
  blankItems,
  checkedToday,
  checklistSections,
  CRUISER_STATUS_LABEL,
  cruiserLabel,
  isOpen,
  REQUEST_STATUS_LABEL,
  requestsForCruiser,
  sortCruisers,
  URGENCY_LABEL,
  type CheckedItem,
  type Cruiser,
  type ItemResult,
  type MaintenanceRequest,
  type Urgency,
} from '@/domain/fleet';
import { Badge, Button, EmptyState, Panel, TabButton } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

type Tab = 'cars' | 'queue';

/**
 * The fleet.
 *
 * Two audiences on one screen. An officer coming on shift wants one thing —
 * check my car, and tell somebody if it is broken. A fleet supervisor wants
 * the other — what is waiting on me, worst first. Anything else is a report
 * that can be built later from the same records.
 */
export function FleetView() {
  const { cruisers, maintenanceQueue, refreshFleet, can } = useStore();
  const [tab, setTab] = useState<Tab>('cars');

  // Fetched on its own, so a report screen never pays for it.
  useEffect(() => {
    void refreshFleet();
  }, [refreshFleet]);

  const unsafe = maintenanceQueue.filter((r) => r.urgency === 'unsafe').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <TabButton active={tab === 'cars'} onClick={() => setTab('cars')}>
          Cars ({cruisers.length})
        </TabButton>
        <TabButton active={tab === 'queue'} onClick={() => setTab('queue')}>
          Maintenance
          {maintenanceQueue.length > 0 && (
            <span
              className={cn(
                'ml-1.5 rounded px-1.5 text-[11px] font-semibold text-white tabular',
                unsafe > 0 ? 'bg-danger' : 'bg-accent',
              )}
            >
              {maintenanceQueue.length}
            </span>
          )}
        </TabButton>
      </div>

      {tab === 'cars' ? <Cars /> : <Queue />}

      {can('agency.configure') && tab === 'cars' && <AddCruiser />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The cars                                                            */
/* ------------------------------------------------------------------ */

function Cars() {
  const { cruisers, cruiserChecks, maintenanceRequests } = useStore();
  const [open, setOpen] = useState<string | null>(null);

  const ordered = useMemo(() => sortCruisers(cruisers), [cruisers]);

  if (ordered.length === 0) {
    return (
      <EmptyState
        icon={<Car size={20} />}
        title="No cars yet"
        body="Add the fleet and officers can start running the daily check on it."
      />
    );
  }

  return (
    <ul className="space-y-2">
      {ordered.map((cruiser) => {
        const done = checkedToday(cruiserChecks, cruiser.id);
        const faults = requestsForCruiser(maintenanceRequests, cruiser.id).filter(isOpen);
        const expanded = open === cruiser.id;

        return (
          <li key={cruiser.id} className="overflow-hidden rounded-xl border border-line bg-surface">
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : cruiser.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-raised"
            >
              <Car
                size={17}
                className={cn(
                  'shrink-0',
                  cruiser.status === 'inService' ? 'text-faint' : 'text-danger',
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-ink">
                    {cruiserLabel(cruiser)}
                  </span>
                  {cruiser.status !== 'inService' && (
                    <Badge tone="danger">{CRUISER_STATUS_LABEL[cruiser.status]}</Badge>
                  )}
                  {done ? (
                    <span className="inline-flex items-center gap-1 text-[12px] text-ok">
                      <CircleCheck size={12} aria-hidden />
                      Checked today
                    </span>
                  ) : (
                    <span className="text-[12px] text-muted">Not checked today</span>
                  )}
                  {faults.length > 0 && (
                    <Badge tone="warn">
                      {faults.length} open {faults.length === 1 ? 'fault' : 'faults'}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[12px] text-faint">
                  {cruiser.plate && `${cruiser.plate} · `}
                  {cruiser.odometer ? `${Number(cruiser.odometer).toLocaleString()} miles` : 'No mileage'}
                  {cruiser.statusNote && ` · ${cruiser.statusNote}`}
                </p>
              </div>
            </button>

            {expanded && <CruiserPanel cruiser={cruiser} />}
          </li>
        );
      })}
    </ul>
  );
}

function CruiserPanel({ cruiser }: { cruiser: Cruiser }) {
  const { maintenanceRequests } = useStore();
  const [doing, setDoing] = useState<'check' | 'fault' | null>(null);

  const faults = requestsForCruiser(maintenanceRequests, cruiser.id);

  return (
    <div className="border-t border-line bg-canvas p-4">
      <div className="flex flex-wrap gap-2">
        <Button
          variant={doing === 'check' ? 'primary' : undefined}
          onClick={() => setDoing(doing === 'check' ? null : 'check')}
        >
          <ClipboardCheck size={15} aria-hidden />
          Daily check
        </Button>
        <Button
          variant={doing === 'fault' ? 'primary' : undefined}
          onClick={() => setDoing(doing === 'fault' ? null : 'fault')}
        >
          <Wrench size={15} aria-hidden />
          Something is wrong with it
        </Button>
      </div>

      {doing === 'check' && (
        <div className="mt-3">
          <DailyCheck cruiser={cruiser} onDone={() => setDoing(null)} />
        </div>
      )}
      {doing === 'fault' && (
        <div className="mt-3">
          <ReportFault cruiser={cruiser} onDone={() => setDoing(null)} />
        </div>
      )}

      {faults.length > 0 && !doing && (
        <ul className="mt-3 space-y-1.5">
          {faults.slice(0, 6).map((request) => (
            <li key={request.id} className="text-[12.5px] leading-relaxed text-muted">
              <span className="font-mono text-[12px] text-ink">{request.number}</span>{' '}
              <Badge tone={isOpen(request) ? (request.urgency === 'unsafe' ? 'danger' : 'warn') : 'neutral'}>
                {REQUEST_STATUS_LABEL[request.status]}
              </Badge>{' '}
              {request.problem}
              <span className="block text-[11.5px] text-faint">
                {request.reportedByName} · {relativeTime(request.reportedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The daily check                                                     */
/* ------------------------------------------------------------------ */

const RESULTS: { value: ItemResult; label: string; tone: string }[] = [
  { value: 'ok', label: 'OK', tone: 'data-[on=true]:bg-ok data-[on=true]:text-white' },
  { value: 'fail', label: 'Fault', tone: 'data-[on=true]:bg-danger data-[on=true]:text-white' },
  { value: 'na', label: 'N/A', tone: 'data-[on=true]:bg-line-strong data-[on=true]:text-ink' },
];

function DailyCheck({ cruiser, onDone }: { cruiser: Cruiser; onDone: () => void }) {
  const { agency, fileCheck } = useStore();
  const template = useMemo(() => agency.checklist ?? [], [agency.checklist]);

  const [items, setItems] = useState<CheckedItem[]>(() => blankItems(template));
  const [odometer, setOdometer] = useState(cruiser.odometer);
  const [shift, setShift] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sections = useMemo(() => checklistSections(template), [template]);
  const unanswered = items.filter((i) => i.result === '').length;
  const missingNote = items.some((i) => i.result === 'fail' && !i.note.trim());

  const set = (itemId: string, patch: Partial<CheckedItem>) =>
    setItems((prev) => prev.map((i) => (i.itemId === itemId ? { ...i, ...patch } : i)));

  const allOk = () =>
    setItems((prev) => prev.map((i) => (i.result === '' ? { ...i, result: 'ok' } : i)));

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await fileCheck({
      cruiserId: cruiser.id,
      shift,
      odometer,
      notes,
      items: items.map((i) => ({ itemId: i.itemId, result: i.result, note: i.note })),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.reason ?? 'The check was not filed.');
      return;
    }
    onDone();
  };

  if (template.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line px-3 py-4 text-[13px] text-muted">
        Nobody has set up what the daily check asks. An administrator does that in Setup, under
        Fleet.
      </p>
    );
  }

  return (
    <Panel
      title={`Daily check — ${cruiser.unit}`}
      description="Walk it, try it, then say so. Anything you mark as a fault goes straight to the fleet supervisor."
      aside={<Gauge size={17} className="text-faint" aria-hidden />}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-ink">Odometer</span>
          <input
            inputMode="numeric"
            value={odometer}
            onChange={(e) => setOdometer(e.target.value.replace(/[^0-9]/g, ''))}
            className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[12.5px] font-medium text-ink">Shift</span>
          <input
            value={shift}
            onChange={(e) => setShift(e.target.value)}
            placeholder="Nights, 1900–0700"
            className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint"
          />
        </label>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" onClick={allOk}>
          <Check size={14} aria-hidden />
          Mark the rest OK
        </Button>
        <span className="text-[12px] text-muted">
          {unanswered > 0 ? `${unanswered} left` : 'All answered'}
        </span>
      </div>

      <div className="mt-3 space-y-4">
        {sections.map((section) => (
          <div key={section}>
            <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-faint">
              {section}
            </p>
            <ul className="space-y-1.5">
              {template
                .filter((t) => t.active && t.section === section)
                .map((t) => {
                  const answer = items.find((i) => i.itemId === t.id);
                  if (!answer) return null;
                  return (
                    <li
                      key={t.id}
                      className={cn(
                        'rounded-lg border px-3 py-2',
                        answer.result === 'fail' ? 'border-danger/45 bg-danger-soft/40' : 'border-line bg-surface',
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 text-[13px] text-ink">
                          {t.label}
                          {t.critical && (
                            <span
                              className="ml-1.5 text-[11px] font-semibold uppercase text-danger"
                              title="A fault here takes the car off the road"
                            >
                              Critical
                            </span>
                          )}
                          {t.hint && (
                            <span className="block text-[11.5px] leading-relaxed text-faint">
                              {t.hint}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 gap-0.5 rounded-lg bg-raised p-0.5">
                          {RESULTS.map((r) => (
                            <button
                              key={r.value}
                              type="button"
                              data-on={answer.result === r.value}
                              onClick={() => set(t.id, { result: r.value })}
                              className={cn(
                                'rounded-md px-2 py-1 text-[12px] font-medium text-muted transition hover:text-ink',
                                r.tone,
                              )}
                            >
                              {r.label}
                            </button>
                          ))}
                        </span>
                      </div>

                      {/*
                        A fault has to be described. A checklist where "fail" is
                        one click produces records saying a car was broken with
                        nothing about how, which is no better than the tick.
                      */}
                      {answer.result === 'fail' && (
                        <input
                          autoFocus
                          value={answer.note}
                          onChange={(e) => set(t.id, { note: e.target.value })}
                          placeholder="What is wrong with it — one line is enough."
                          className="mt-2 w-full rounded-lg border border-danger/40 bg-surface px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-faint"
                        />
                      )}
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </div>

      <label className="mt-3 block">
        <span className="mb-1 block text-[12.5px] font-medium text-ink">Anything else</span>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] leading-relaxed text-ink"
        />
      </label>

      {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}

      <div className="mt-3 flex gap-2">
        <Button
          variant="primary"
          disabled={busy || unanswered > 0 || missingNote}
          title={
            unanswered > 0
              ? `${unanswered} still to answer`
              : missingNote
                ? 'Say what is wrong with the items you marked as a fault'
                : undefined
          }
          onClick={() => void submit()}
        >
          {busy ? (
            <Loader2 size={15} className="animate-spin" aria-hidden />
          ) : (
            <ClipboardCheck size={15} aria-hidden />
          )}
          File the check
        </Button>
        <Button disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Reporting a fault on its own                                        */
/* ------------------------------------------------------------------ */

const URGENCIES: Urgency[] = ['routine', 'soon', 'unsafe'];

function ReportFault({ cruiser, onDone }: { cruiser: Cruiser; onDone: () => void }) {
  const { reportFault } = useStore();
  const [problem, setProblem] = useState('');
  const [urgency, setUrgency] = useState<Urgency>('soon');
  const [odometer, setOdometer] = useState(cruiser.odometer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await reportFault({ cruiserId: cruiser.id, problem, urgency, odometer });
    setBusy(false);
    if (result.ok) onDone();
    else setError(result.reason ?? 'That was not sent.');
  };

  return (
    <Panel
      title={`Report a fault — ${cruiser.unit}`}
      description="Goes to the fleet supervisor. You will see what they do with it."
      aside={<Wrench size={17} className="text-faint" aria-hidden />}
    >
      <label className="block">
        <span className="mb-1 block text-[12.5px] font-medium text-ink">What is wrong</span>
        <textarea
          autoFocus
          rows={3}
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
          placeholder="Pulls left under braking, worse when cold."
          className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-[13px] leading-relaxed text-ink placeholder:text-faint"
        />
        <span className="mt-1 block text-[11.5px] leading-relaxed text-faint">
          Enough that a mechanic knows what to look at without ringing you.
        </span>
      </label>

      <fieldset className="mt-3">
        <legend className="mb-1.5 text-[12.5px] font-medium text-ink">How bad</legend>
        <div className="space-y-1.5">
          {URGENCIES.map((u) => (
            <label
              key={u}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition',
                urgency === u
                  ? u === 'unsafe'
                    ? 'border-danger/50 bg-danger-soft'
                    : 'border-accent/45 bg-accent-soft'
                  : 'border-line bg-surface hover:bg-raised',
              )}
            >
              <input
                type="radio"
                name="urgency"
                checked={urgency === u}
                onChange={() => setUrgency(u)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{URGENCY_LABEL[u]}</span>
                {u === 'unsafe' && (
                  <span className="mt-0.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-danger">
                    <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
                    This takes {cruiser.unit} off the road now. You are next to it and nobody else
                    is — a car driven for two more shifts while this waits its turn is the thing
                    this is for.
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-3 block max-w-[180px]">
        <span className="mb-1 block text-[12.5px] font-medium text-ink">Odometer</span>
        <input
          inputMode="numeric"
          value={odometer}
          onChange={(e) => setOdometer(e.target.value.replace(/[^0-9]/g, ''))}
          className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink"
        />
      </label>

      {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}

      <div className="mt-3 flex gap-2">
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>
          {busy ? (
            <Loader2 size={15} className="animate-spin" aria-hidden />
          ) : (
            <Wrench size={15} aria-hidden />
          )}
          Send it
        </Button>
        <Button disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* The supervisor's queue                                              */
/* ------------------------------------------------------------------ */

function Queue() {
  const { maintenanceQueue, maintenanceRequests, can } = useStore();
  const [showClosed, setShowClosed] = useState(false);

  const closed = maintenanceRequests.filter((r) => !isOpen(r));
  const mayDecide = can('reports.approve');

  return (
    <div className="space-y-3">
      {maintenanceQueue.length === 0 ? (
        <EmptyState
          icon={<CircleCheck size={20} />}
          title="Nothing outstanding"
          body="Every reported fault has been dealt with."
        />
      ) : (
        <ul className="space-y-2">
          {maintenanceQueue.map((request) => (
            <RequestRow key={request.id} request={request} mayDecide={mayDecide} />
          ))}
        </ul>
      )}

      {closed.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowClosed((v) => !v)}
            className="rounded-lg px-2 py-1.5 text-[12.5px] font-medium text-muted transition hover:bg-surface"
          >
            {showClosed ? 'Hide' : 'Show'} {closed.length} closed
          </button>
          {showClosed && (
            <ul className="mt-1.5 space-y-2">
              {closed.map((request) => (
                <RequestRow key={request.id} request={request} mayDecide={false} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const NEXT_STATUS: { value: string; label: string }[] = [
  { value: 'acknowledged', label: 'Seen it' },
  { value: 'scheduled', label: 'Booked in' },
  { value: 'resolved', label: 'Fixed' },
  { value: 'declined', label: 'Not doing it' },
];

function RequestRow({
  request,
  mayDecide,
}: {
  request: MaintenanceRequest;
  mayDecide: boolean;
}) {
  const { moveRequest } = useStore();
  const [note, setNote] = useState('');
  const [assignedTo, setAssignedTo] = useState(request.assignedTo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const move = async (status: string) => {
    setBusy(true);
    setError(null);
    const result = await moveRequest(request.id, { status, note: note.trim(), assignedTo });
    setBusy(false);
    if (!result.ok) {
      setError(result.reason ?? 'That did not work.');
      return;
    }
    setNote('');
    if (result.backOnRoad) setOutcome(`${request.cruiserUnit} is back in service.`);
  };

  return (
    <li
      className={cn(
        'rounded-xl border bg-surface p-3',
        request.urgency === 'unsafe' && isOpen(request) ? 'border-danger/45' : 'border-line',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] font-semibold text-ink">{request.number}</span>
        <Badge tone="neutral">{request.cruiserUnit}</Badge>
        {request.urgency === 'unsafe' && (
          <Badge tone="danger">
            <AlertTriangle size={11} className="mr-1 inline" aria-hidden />
            Not safe to drive
          </Badge>
        )}
        {request.urgency === 'soon' && <Badge tone="warn">Before it gets worse</Badge>}
        <Badge tone={isOpen(request) ? 'accent' : 'ok'}>
          {REQUEST_STATUS_LABEL[request.status]}
        </Badge>
        <div className="flex-1" />
        <span className="text-[11.5px] text-faint">{relativeTime(request.reportedAt)}</span>
      </div>

      <p className="mt-1.5 text-[13px] leading-relaxed text-ink">{request.problem}</p>
      <p className="mt-0.5 text-[11.5px] text-faint">
        {request.reportedByName}
        {request.fromCheckId && ' · from a daily check'}
        {request.odometer && ` · ${Number(request.odometer).toLocaleString()} miles`}
        {request.assignedTo && ` · ${request.assignedTo}`}
      </p>

      {request.history.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {request.history.map((event) => (
            <li key={event.id} className="text-[11.5px] leading-relaxed text-muted">
              <span className="font-medium text-ink">{REQUEST_STATUS_LABEL[event.status]}</span> by{' '}
              {event.actorName} · {relativeTime(event.at)}
              {event.note && <span className="block text-faint">“{event.note}”</span>}
            </li>
          ))}
        </ul>
      )}

      {outcome && <p className="mt-1.5 text-[12px] font-medium text-ok">{outcome}</p>}
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}

      {mayDecide && isOpen(request) && (
        <div className="mt-2.5 border-t border-line pt-2.5">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note — required to turn one down"
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-faint"
            />
            <input
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              placeholder="Garage or work order"
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-faint"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {NEXT_STATUS.filter((s) => s.value !== request.status).map((s) => (
              <Button
                key={s.value}
                size="sm"
                variant={s.value === 'resolved' ? 'primary' : undefined}
                disabled={busy || (s.value === 'declined' && !note.trim())}
                title={
                  s.value === 'declined' && !note.trim()
                    ? 'Say why. The officer who reported it will see this.'
                    : undefined
                }
                onClick={() => void move(s.value)}
              >
                {s.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */

function AddCruiser() {
  const { addCruiser } = useStore();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ unit: '', year: '', make: '', model: '', plate: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field =
    'w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint';

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await addCruiser(draft);
    setBusy(false);
    if (result.ok) {
      setDraft({ unit: '', year: '', make: '', model: '', plate: '' });
      setOpen(false);
    } else {
      setError(result.reason ?? 'Could not add it.');
    }
  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus size={15} aria-hidden />
        Add a car
      </Button>
    );
  }

  return (
    <Panel title="Add a car" description="The unit number is what it is called on the radio.">
      <div className="grid gap-2 sm:grid-cols-5">
        {(
          [
            ['unit', 'Unit', '412'],
            ['year', 'Year', '2023'],
            ['make', 'Make', 'Ford'],
            ['model', 'Model', 'Explorer'],
            ['plate', 'Plate', 'AL-77291'],
          ] as const
        ).map(([key, label, placeholder]) => (
          <label key={key} className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-ink">{label}</span>
            <input
              value={draft[key]}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              placeholder={placeholder}
              className={field}
            />
          </label>
        ))}
      </div>
      {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button variant="primary" disabled={busy || !draft.unit.trim()} onClick={() => void submit()}>
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Plus size={15} aria-hidden />}
          Add it
        </Button>
        <Button onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </Panel>
  );
}
