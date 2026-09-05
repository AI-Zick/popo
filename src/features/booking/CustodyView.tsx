import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  Clock,
  DoorOpen,
  Inbox,
  Loader2,
  Package,
  Plus,
  ShieldAlert,
  Trash2,
  Users,
} from 'lucide-react';
import { useStore } from '@/state/store';
import { api, ApiError } from '@/state/api';
import {
  CLEARING_NEEDS_A_REASON,
  CONCERN_LABEL,
  CUSTODY_LABEL,
  ITEM_KIND_LABEL,
  ITEM_OUTCOME_LABEL,
  RELEASE_LABEL,
  REVIEW_HOURS,
  REVIEW_NOTE,
  custody,
  hoursHeld,
  isUrgent,
  keepApart,
  moneyHeld,
  releaseBlockers,
  sortConcerns,
  stillHeld,
  type Booking,
  type Concern,
  type ConcernKind,
  type HeldItem,
  type ItemKind,
  type ItemOutcome,
  type ReleaseReason,
  type RosterRow,
} from '@/domain/booking';
import { Badge, Button, EmptyState, FieldGrid, Panel } from '@/components/ui/primitives';
import { SelectField, TextField, TextareaField, ToggleField } from '@/components/ui/fields';
import { cn } from '@/lib/cn';

const optionsFrom = <T extends string>(labels: Record<T, string>) =>
  (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label }));

/**
 * Custody.
 *
 * Two screens that answer two different questions, and only one of them is a
 * form. The roster answers "who is in the building and what do I have to know
 * about them", which is what a shift briefing reads and what somebody checks
 * at three in the morning. The booking answers "what did this person come in
 * with and where is it now", which is what gets subpoenaed.
 *
 * Nothing here stores whether somebody is in custody. It is worked out from
 * the booking and release times each time the page is drawn, because a stored
 * flag and a release time disagree the first time somebody records one and
 * misses the other — and the roster is exactly the place that must not be
 * wrong.
 */
export function CustodyView() {
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [openId, setOpenId] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const reply = await api.custodyRoster();
      setRows(reply.roster);
      setFailed('');
    } catch (error) {
      setFailed(error instanceof ApiError ? error.message : 'Could not read the roster.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (openId) {
    return (
      <BookingSheet
        bookingId={openId}
        onClose={() => {
          setOpenId('');
          void load();
        }}
      />
    );
  }

  const apart = keepApart(rows);

  return (
    <div className="space-y-4">
      <Panel
        title="Who is in custody"
        description="Worked out from the booking and release times every time this is read. Longest-held first — the person nineteen hours into a cell is what a briefing is about, not whoever just came through the door."
        aside={<Users size={17} className="text-faint" aria-hidden />}
      >
        {loading ? (
          <p className="flex items-center gap-2 py-6 text-[13px] text-faint">
            <Loader2 size={15} className="animate-spin" aria-hidden />
            Reading the roster…
          </p>
        ) : failed ? (
          <p className="rounded-lg border border-danger/35 bg-danger-soft p-3 text-[13px] text-danger">
            {failed}
          </p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Inbox size={22} aria-hidden />}
            title="Nobody is in custody"
            body="Bookings open from an arrest. When somebody is booked in they appear here until they are released."
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.booking.id}>
                <RosterCard row={row} onOpen={() => setOpenId(row.booking.id)} />
              </li>
            ))}
          </ul>
        )}

        {/*
          Keep-separate read off the live roster rather than stored as a
          pairing, so it stops warning about somebody who left on Tuesday.
        */}
        {apart.length > 0 && (
          <div className="mt-3 rounded-xl border border-danger/40 bg-danger-soft p-3">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-danger">
              <ShieldAlert size={14} aria-hidden />
              Do not house together
            </p>
            <ul className="mt-1 space-y-0.5">
              {apart.map((pair, index) => (
                <li key={index} className="text-[12.5px] text-ink">
                  {pair.row.booking.personName} — keep apart from {pair.from}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One person on the roster                                            */
/* ------------------------------------------------------------------ */

function RosterCard({ row, onOpen }: { row: RosterRow; onOpen: () => void }) {
  const urgent = row.concerns.filter(isUrgent);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition hover:bg-raised',
        urgent.length > 0 ? 'border-danger/45 bg-danger-soft/40' : 'border-line bg-surface',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-ink">
          {row.booking.personName || 'Name not recorded'}
        </p>
        <p className="mt-0.5 truncate text-[12px] text-muted">
          {row.booking.bookingNumber} · arrest {row.booking.arrestNumber}
          {row.booking.cell && ` · cell ${row.booking.cell}`}
        </p>

        {/*
          The urgent concerns on the card itself. A roster that makes somebody
          click into each person to find out who is diabetic is a roster
          nobody reads at three in the morning.
        */}
        {urgent.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {urgent.map((concern) => (
              <li key={concern.id} className="text-[12.5px] font-medium text-danger">
                {CONCERN_LABEL[concern.kind]}
                {concern.detail && <span className="font-normal text-ink/80"> — {concern.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 text-right">
        <p className="text-[13px] text-ink tabular">
          {row.hours === null ? '—' : `${Math.floor(row.hours)}h`}
        </p>
        {row.pastReview && (
          <Badge tone="warn" className="mt-1">
            <Clock size={11} aria-hidden />
            Over {REVIEW_HOURS}h
          </Badge>
        )}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* The booking sheet                                                   */
/* ------------------------------------------------------------------ */

function BookingSheet({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const { can } = useStore();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [failed, setFailed] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const reply = await api.booking(bookingId);
      setBooking(reply.booking);
      setFailed('');
    } catch (error) {
      setFailed(error instanceof ApiError ? error.message : 'Could not read this booking.');
    }
  }, [bookingId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Worked out here rather than trusted from the server's last answer, so the
     screen and the refusal cannot drift apart between saves. */
  const blockers = useMemo(() => (booking ? releaseBlockers(booking) : []), [booking]);

  /*
    Returns whether it worked, and the callers use that.

    Without it, a step that closes the panel on completion closes it on failure
    too — the release bounces back to the roster, the reason the server gave is
    thrown away, and the person is still in a cell with nothing on screen
    saying why. A save that failed must leave the screen where the reason can
    be read.
  */
  const act = async (run: () => Promise<{ booking: Booking }>): Promise<boolean> => {
    setBusy(true);
    try {
      const reply = await run();
      setBooking(reply.booking);
      setFailed('');
      return true;
    } catch (error) {
      setFailed(error instanceof ApiError ? error.message : String(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!booking) {
    return (
      <Panel title="Booking" description="">
        {failed ? (
          <p className="text-[13px] text-danger">{failed}</p>
        ) : (
          <p className="flex items-center gap-2 text-[13px] text-faint">
            <Loader2 size={15} className="animate-spin" aria-hidden />
            Reading…
          </p>
        )}
      </Panel>
    );
  }

  const state = custody(booking);
  const held = hoursHeld(booking);
  const closed = state === 'released';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onClose}>
          <ChevronLeft size={15} aria-hidden />
          Roster
        </Button>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-ink">
            {booking.personName || 'Name not recorded'}
          </p>
          <p className="text-[12px] text-muted">
            {booking.bookingNumber} · arrest {booking.arrestNumber}
          </p>
        </div>
        <div className="flex-1" />
        <Badge tone={state === 'held' ? 'accent' : state === 'released' ? 'neutral' : 'warn'}>
          {CUSTODY_LABEL[state]}
        </Badge>
        {held !== null && (
          <span className="text-[12.5px] text-muted tabular">{Math.floor(held)}h</span>
        )}
      </div>

      {failed && (
        <p className="rounded-xl border border-danger/35 bg-danger-soft p-3 text-[13px] text-danger">
          {failed}
        </p>
      )}

      {booking.release?.at && (
        <Panel title="Released" description="">
          <p className="text-[13px] text-ink">
            {RELEASE_LABEL[booking.release.reason]}
            {booking.release.to && ` — ${booking.release.to}`}
          </p>
          <p className="mt-0.5 text-[12px] text-muted">
            {new Date(booking.release.at).toLocaleString()} by {booking.release.releasedByName}
          </p>
          {booking.release.note && (
            <p className="mt-1 text-[12.5px] text-ink/80">{booking.release.note}</p>
          )}
        </Panel>
      )}

      {state === 'held' && held !== null && held >= REVIEW_HOURS && (
        <p className="flex items-start gap-2 rounded-xl border border-warn/45 bg-warn/5 p-3 text-[12.5px] leading-relaxed text-warn">
          <Clock size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Held {Math.floor(held)} hours. {REVIEW_NOTE}
          </span>
        </p>
      )}

      <Intake booking={booking} closed={closed} busy={busy} onSave={act} />
      <Property booking={booking} closed={closed} busy={busy} onSave={act} />
      <Concerns booking={booking} busy={busy} mayClear={can('notes.retract')} onSave={act} />
      {!closed && <Release booking={booking} blockers={blockers} busy={busy} onSave={act} />}
    </div>
  );
}

type Saver = (run: () => Promise<{ booking: Booking }>) => Promise<boolean>;

/* ------------------------------------------------------------------ */
/* Intake                                                              */
/* ------------------------------------------------------------------ */

function Intake({
  booking,
  closed,
  busy,
  onSave,
}: {
  booking: Booking;
  closed: boolean;
  busy: boolean;
  onSave: Saver;
}) {
  const set = (patch: Partial<Booking>) =>
    void onSave(() => api.saveBooking(booking.id, patch));

  return (
    <Panel title="Intake" description="Where they are, and who processed them.">
      <FieldGrid cols={2}>
        <TextField
          path="facility"
          label="Facility"
          value={booking.facility}
          disabled={closed || busy}
          onChange={(v) => set({ facility: v })}
        />
        <TextField
          path="cell"
          label="Cell"
          value={booking.cell}
          disabled={closed || busy}
          onChange={(v) => set({ cell: v })}
        />
        <TextField
          path="bookedByName"
          label="Booked by"
          value={booking.bookedByName}
          disabled={closed || busy}
          onChange={(v) => set({ bookedByName: v })}
        />
        <TextField
          path="searchedByName"
          label="Searched by"
          value={booking.searchedByName}
          disabled={closed || busy}
          onChange={(v) => set({ searchedByName: v })}
        />
      </FieldGrid>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <ToggleField
          path="fingerprinted"
          label="Fingerprinted"
          checked={booking.fingerprinted}
          disabled={closed || busy}
          onChange={(v) => set({ fingerprinted: v })}
        />
        <ToggleField
          path="photographed"
          label="Photographed"
          checked={booking.photographed}
          disabled={closed || busy}
          onChange={(v) => set({ photographed: v })}
        />
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Property                                                            */
/* ------------------------------------------------------------------ */

/**
 * What they came in with, and where each of it is now.
 *
 * The list that gets subpoenaed. Every jail sued over property was sued
 * because this was a line in a logbook, so each item carries where it is and
 * what became of it — and a release will not be written while a line is still
 * open.
 */
function Property({
  booking,
  closed,
  busy,
  onSave,
}: {
  booking: Booking;
  closed: boolean;
  busy: boolean;
  onSave: Saver;
}) {
  const [adding, setAdding] = useState(false);
  const open = booking.items.filter(stillHeld);
  const cash = moneyHeld(booking.items);

  return (
    <Panel
      title="Property taken"
      description="Everything they handed over, and where each of it went. A release cannot be recorded while a line is still open."
      aside={<Package size={17} className="text-faint" aria-hidden />}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={open.length > 0 ? 'warn' : 'ok'}>
          {open.length === 0 ? 'Nothing outstanding' : `${open.length} still held`}
        </Badge>
        {cash > 0 && <Badge tone="neutral">{cash.toFixed(2)} in cash held</Badge>}
      </div>

      {booking.items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {booking.items.map((item) => (
            <li key={item.id}>
              <ItemRow
                item={item}
                bookingId={booking.id}
                closed={closed}
                busy={busy}
                onSave={onSave}
              />
            </li>
          ))}
        </ul>
      )}

      {!closed && (
        <div className="mt-3">
          {adding ? (
            <NewItem
              bookingId={booking.id}
              onSave={onSave}
              onDone={() => setAdding(false)}
            />
          ) : (
            <Button onClick={() => setAdding(true)} disabled={busy}>
              <Plus size={15} aria-hidden />
              Add an item
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}

function ItemRow({
  item,
  bookingId,
  closed,
  busy,
  onSave,
}: {
  item: HeldItem;
  bookingId: string;
  closed: boolean;
  busy: boolean;
  onSave: Saver;
}) {
  const settle = (patch: Partial<HeldItem>) =>
    void onSave(() => api.saveBookingItem(bookingId, { id: item.id, ...patch }));

  const needsReference =
    (['toEvidence', 'contraband', 'destroyed'] as ItemOutcome[]).includes(item.outcome) &&
    !item.reference.trim();

  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        stillHeld(item) ? 'border-line bg-surface' : 'border-line/60 bg-raised/40',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-ink">
            {item.description || ITEM_KIND_LABEL[item.kind]}
            {item.quantity && <span className="font-normal text-muted"> × {item.quantity}</span>}
          </p>
          <p className="mt-0.5 text-[12px] text-muted">
            {ITEM_KIND_LABEL[item.kind]}
            {item.kind === 'money' && item.amount && ` · ${item.amount}`}
            {item.storedAt && ` · ${item.storedAt}`}
          </p>
        </div>
        <Badge tone={stillHeld(item) ? 'warn' : 'ok'}>{ITEM_OUTCOME_LABEL[item.outcome]}</Badge>
        {!closed && !item.outcome && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onSave(() => api.removeBookingItem(bookingId, item.id))}
            title="Struck off — only while nothing has been recorded about where it went"
            className="rounded-lg p-1.5 text-faint transition hover:bg-raised hover:text-danger"
            aria-label={`Remove ${item.description || 'item'}`}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {!closed && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <SelectField
            path={`item-${item.id}-outcome`}
            label="What became of it"
            options={optionsFrom(ITEM_OUTCOME_LABEL)}
            value={item.outcome}
            disabled={busy}
            onChange={(v) => settle({ outcome: v as ItemOutcome })}
          />
          {item.outcome === 'releasedToOther' && (
            <TextField
              path={`item-${item.id}-to`}
              label="Released to"
              value={item.releasedTo}
              disabled={busy}
              onChange={(v) => settle({ releasedTo: v })}
            />
          )}
          {(['toEvidence', 'contraband', 'destroyed'] as ItemOutcome[]).includes(item.outcome) && (
            <TextField
              path={`item-${item.id}-ref`}
              label="Reference"
              hint="An evidence tag or order number — something a person can follow."
              value={item.reference}
              disabled={busy}
              onChange={(v) => settle({ reference: v })}
            />
          )}
        </div>
      )}

      {needsReference && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-warn">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
          This left the property bag with nothing to trace it by. In six months that reads the same
          as missing.
        </p>
      )}
    </div>
  );
}

function NewItem({
  bookingId,
  onSave,
  onDone,
}: {
  bookingId: string;
  onSave: Saver;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<ItemKind>('other');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('');
  const [amount, setAmount] = useState('');
  const [storedAt, setStoredAt] = useState('');

  const add = async () => {
    const ok = await onSave(() =>
      api.saveBookingItem(bookingId, { kind, description, quantity, amount, storedAt }),
    );
    // Left open on a failure, with what the server said still on screen.
    if (ok) onDone();
  };

  return (
    <div className="rounded-xl border border-line bg-raised/40 p-3">
      <FieldGrid cols={2}>
        <SelectField
          path="new-item-kind"
          label="Kind"
          options={optionsFrom(ITEM_KIND_LABEL)}
          value={kind}
          onChange={(v) => setKind(v as ItemKind)}
        />
        <TextField
          path="new-item-description"
          label="Description"
          placeholder="Black leather wallet"
          value={description}
          onChange={setDescription}
        />
        {kind === 'money' ? (
          <TextField
            path="new-item-amount"
            label="Amount"
            type="number"
            hint="Counted, not described. This is the line that gets argued about."
            value={amount}
            onChange={setAmount}
          />
        ) : (
          <TextField
            path="new-item-quantity"
            label="How many"
            placeholder="1"
            value={quantity}
            onChange={setQuantity}
          />
        )}
        <TextField
          path="new-item-stored"
          label="Bag or locker"
          placeholder="Bag 14"
          value={storedAt}
          onChange={setStoredAt}
        />
      </FieldGrid>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" onClick={() => void add()}>
          Add it
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Concerns                                                            */
/* ------------------------------------------------------------------ */

/**
 * What the next shift has to know.
 *
 * Anybody may raise one, because seeing something and having nowhere to write
 * it down is the failure. Only a supervisor stands one down, with a reason —
 * the question after somebody is hurt in a cell is who stopped acting on what,
 * and a concern that can be deleted cannot answer it.
 */
function Concerns({
  booking,
  busy,
  mayClear,
  onSave,
}: {
  booking: Booking;
  busy: boolean;
  mayClear: boolean;
  onSave: Saver;
}) {
  const [adding, setAdding] = useState(false);
  const sorted = sortConcerns(booking.concerns);

  return (
    <Panel
      title="What the next shift has to know"
      description="Anybody can raise one. Standing one down is a supervisor's decision, and it stays on the record either way."
      aside={<ShieldAlert size={17} className="text-faint" aria-hidden />}
    >
      {sorted.length === 0 ? (
        <p className="text-[13px] text-faint">Nothing raised.</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((concern) => (
            <li key={concern.id}>
              <ConcernRow
                concern={concern}
                bookingId={booking.id}
                busy={busy}
                mayClear={mayClear}
                onSave={onSave}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        {adding ? (
          <NewConcern bookingId={booking.id} onSave={onSave} onDone={() => setAdding(false)} />
        ) : (
          <Button onClick={() => setAdding(true)} disabled={busy}>
            <Plus size={15} aria-hidden />
            Raise a concern
          </Button>
        )}
      </div>
    </Panel>
  );
}

function ConcernRow({
  concern,
  bookingId,
  busy,
  mayClear,
  onSave,
}: {
  concern: Concern;
  bookingId: string;
  busy: boolean;
  mayClear: boolean;
  onSave: Saver;
}) {
  const [clearing, setClearing] = useState(false);
  const [reason, setReason] = useState('');
  const live = !concern.clearedAt;

  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        !live
          ? 'border-line/60 bg-raised/40'
          : isUrgent(concern)
            ? 'border-danger/45 bg-danger-soft/40'
            : 'border-line bg-surface',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-[13.5px] font-medium',
              live && isUrgent(concern) ? 'text-danger' : 'text-ink',
            )}
          >
            {CONCERN_LABEL[concern.kind]}
            {concern.keepSeparateFrom && ` — from ${concern.keepSeparateFrom}`}
          </p>
          {concern.detail && <p className="mt-0.5 text-[12.5px] text-ink/80">{concern.detail}</p>}
          <p className="mt-1 text-[11.5px] text-faint">
            Raised by {concern.raisedByName}
            {concern.raisedAt && ` · ${new Date(concern.raisedAt).toLocaleString()}`}
          </p>
          {!live && (
            <p className="mt-1 rounded-lg bg-raised px-2 py-1 text-[11.5px] text-muted">
              Stood down by {concern.clearedByName} — {concern.clearedReason}
            </p>
          )}
        </div>
        {live && !clearing && mayClear && (
          <Button size="sm" disabled={busy} onClick={() => setClearing(true)}>
            Stand down
          </Button>
        )}
      </div>

      {clearing && (
        <div className="mt-2">
          <TextareaField
            path={`clear-${concern.id}`}
            label="Why does this no longer apply?"
            hint={CLEARING_NEEDS_A_REASON}
            rows={2}
            value={reason}
            onChange={setReason}
          />
          <div className="mt-2 flex gap-2">
            <Button
              variant="primary"
              disabled={busy || !reason.trim()}
              onClick={() =>
                void onSave(() => api.clearConcern(bookingId, concern.id, reason)).then(
                  (ok) => ok && setClearing(false),
                )
              }
            >
              Stand it down
            </Button>
            <Button onClick={() => setClearing(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NewConcern({
  bookingId,
  onSave,
  onDone,
}: {
  bookingId: string;
  onSave: Saver;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<ConcernKind>('medical');
  const [detail, setDetail] = useState('');
  const [from, setFrom] = useState('');

  return (
    <div className="rounded-xl border border-line bg-raised/40 p-3">
      <FieldGrid cols={2}>
        <SelectField
          path="new-concern-kind"
          label="What kind"
          options={optionsFrom(CONCERN_LABEL)}
          value={kind}
          onChange={(v) => setKind(v as ConcernKind)}
        />
        {kind === 'keepSeparate' && (
          <TextField
            path="new-concern-from"
            label="Keep apart from"
            value={from}
            onChange={setFrom}
          />
        )}
      </FieldGrid>
      <div className="mt-2">
        <TextareaField
          path="new-concern-detail"
          label="What was seen or said"
          rows={2}
          value={detail}
          onChange={setDetail}
        />
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          variant="primary"
          onClick={() =>
            void onSave(() =>
              api.raiseConcern(bookingId, { kind, detail, keepSeparateFrom: from }),
            ).then((ok) => ok && onDone())
          }
        >
          Raise it
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Release                                                             */
/* ------------------------------------------------------------------ */

/**
 * Letting somebody out.
 *
 * The one place in this flow that refuses rather than warns. Property that
 * walks out of the door unaccounted for cannot be recovered, and it is always
 * discovered weeks later by a solicitor — so the button is not there until
 * every line has an answer, and the server says the same thing again.
 */
function Release({
  booking,
  blockers,
  busy,
  onSave,
}: {
  booking: Booking;
  blockers: ReturnType<typeof releaseBlockers>;
  busy: boolean;
  onSave: Saver;
}) {
  const [reason, setReason] = useState<ReleaseReason>('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');

  const handedOver = reason === 'transferred' || reason === 'toHospital';

  return (
    <Panel
      title="Release"
      description="On what authority they walked out, and where they went if it was not out."
      aside={<DoorOpen size={17} className="text-faint" aria-hidden />}
    >
      {blockers.length > 0 ? (
        <div className="space-y-2">
          {blockers.map((blocker, index) => (
            <div key={index} className="rounded-xl border border-danger/40 bg-danger-soft p-3">
              <p className="text-[13px] font-medium text-danger">{blocker.reason}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink/80">{blocker.tip}</p>
            </div>
          ))}
        </div>
      ) : (
        <>
          <FieldGrid cols={2}>
            <SelectField
              path="release-reason"
              label="On what authority"
              required
              options={optionsFrom(RELEASE_LABEL)}
              value={reason}
              onChange={(v) => setReason(v as ReleaseReason)}
            />
            {handedOver && (
              <TextField
                path="release-to"
                label="Handed over to"
                placeholder="Agency or hospital"
                value={to}
                onChange={setTo}
              />
            )}
          </FieldGrid>
          <div className="mt-2">
            <TextareaField
              path="release-note"
              label="Anything else"
              rows={2}
              value={note}
              onChange={setNote}
            />
          </div>
          <div className="mt-3">
            <Button
              variant="primary"
              disabled={busy || !reason}
              onClick={() =>
                /*
                  Stays on the sheet. The panel above becomes the release
                  record — what was written down, on whose authority, by whom —
                  and somebody who has just let a person out of a cell should
                  see that rather than be returned to a list.
                */
                void onSave(() => api.releaseFromCustody(booking.id, { reason, to, note }))
              }
            >
              <DoorOpen size={15} aria-hidden />
              Record the release
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}
