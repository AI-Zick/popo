import { useCallback, useEffect, useState } from 'react';
import { Gavel, Loader2, Phone, TriangleAlert } from 'lucide-react';
import { api, type WarrantRow } from '@/state/api';
import { useStore } from '@/state/store';
import {
  CONFIRMATION_NOTICE,
  EXTRADITION_LABEL,
  KIND_LABEL,
  OUTCOME_LABEL,
  STATE_LABEL,
  extraditionWarning,
  headlineCharge,
  outstandingDays,
} from '@/domain/warrant';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { AttemptService } from './AttemptService';
import { RecallWarrant } from './RecallWarrant';

/**
 * Whether this person is wanted.
 *
 * The one section on a person's record that is never folded away. Everything
 * else here can wait for a click; this cannot, because the officer reading it
 * may be standing in front of the person.
 *
 * It is also the section most careful about what it claims. An RMS holds what
 * the agency last heard about a warrant, and warrants are recalled, quashed
 * and served by other agencies hours before anybody updates a records system.
 * The confirmation line is not a disclaimer bolted on the bottom — it sits
 * inside the alert, because somebody reading this in a hurry reads the alert
 * and nothing else.
 */
export function PersonWarrants({ masterId, personName }: { masterId: string; personName: string }) {
  const { can } = useStore();
  const [rows, setRows] = useState<WarrantRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [attempting, setAttempting] = useState<WarrantRow | null>(null);
  const [recalling, setRecalling] = useState<WarrantRow | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { warrants } = await api.personWarrants(masterId);
      setRows(warrants);
    } catch {
      setError('Could not check for warrants. Do not read that as "none" — try again.');
      setRows(null);
    }
  }, [masterId]);

  useEffect(() => {
    void load();
  }, [load]);

  const live = rows?.filter((row) => row.state === 'active') ?? [];
  const past = rows?.filter((row) => row.state !== 'active') ?? [];

  /*
    A failed check is shown as a failed check, never as "no warrants". The
    difference between "we looked and there are none" and "we could not look"
    is the difference between letting somebody go and letting somebody go who
    is wanted for a felony.
  */
  if (error) {
    return (
      <section className="rounded-xl border border-danger/45 bg-danger/5 p-4">
        <p className="flex items-start gap-2 text-[13px] leading-relaxed text-danger">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
        <Button size="sm" className="mt-2" onClick={() => void load()}>
          Check again
        </Button>
      </section>
    );
  }

  if (rows === null) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-line bg-surface p-4 text-[13px] text-muted">
        <Loader2 size={15} className="animate-spin" aria-hidden />
        Checking for warrants…
      </p>
    );
  }

  return (
    <section
      className={cn(
        'rounded-xl border',
        live.length > 0 ? 'border-danger/50 bg-danger/5' : 'border-line bg-surface',
      )}
    >
      <div className="flex items-start gap-2.5 px-4 py-3">
        <Gavel size={16} className={live.length ? 'mt-0.5 text-danger' : 'mt-0.5 text-faint'} aria-hidden />
        <div className="min-w-0 flex-1">
          <h2
            className={cn(
              'text-[14px] font-semibold',
              live.length > 0 ? 'text-danger' : 'text-ink',
            )}
          >
            {live.length === 0
              ? past.length > 0
                ? 'No outstanding warrant'
                : 'No warrant on file'
              : live.length === 1
                ? 'Outstanding warrant'
                : `${live.length} outstanding warrants`}
          </h2>
          {live.length > 0 && (
            <p className="mt-1 flex items-start gap-1.5 text-[12.5px] font-medium leading-relaxed text-danger">
              <Phone size={12} className="mt-0.5 shrink-0" aria-hidden />
              {CONFIRMATION_NOTICE}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2 px-4 pb-3">
        {live.map((row) => (
          <WarrantCard
            key={row.warrant.id}
            row={row}
            onAttempt={() => setAttempting(row)}
            onRecall={can('notes.retract') ? () => setRecalling(row) : undefined}
          />
        ))}

        {past.length > 0 && (
          <button
            type="button"
            onClick={() => setShowPast((v) => !v)}
            className="text-[12.5px] text-muted transition hover:text-ink"
          >
            {showPast ? 'Hide' : `Show ${past.length} that ${past.length === 1 ? 'is' : 'are'} no longer outstanding`}
          </button>
        )}
        {showPast && past.map((row) => <WarrantCard key={row.warrant.id} row={row} />)}
      </div>

      {attempting && (
        <AttemptService
          row={attempting}
          personName={personName}
          onClose={() => setAttempting(null)}
          onDone={() => {
            setAttempting(null);
            void load();
          }}
        />
      )}
      {recalling && (
        <RecallWarrant
          row={recalling}
          personName={personName}
          onClose={() => setRecalling(null)}
          onDone={() => {
            setRecalling(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function WarrantCard({
  row,
  onAttempt,
  onRecall,
}: {
  row: WarrantRow;
  onAttempt?: () => void;
  onRecall?: () => void;
}) {
  const { warrant, state } = row;
  const limit = extraditionWarning(warrant);
  const days = outstandingDays(warrant);

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13.5px] font-medium text-ink">{headlineCharge(warrant)}</span>
        <span
          className={cn(
            'rounded border px-1.5 py-0.5 text-[11px] uppercase tracking-wide',
            state === 'active' ? 'border-danger/50 text-danger' : 'border-line text-muted',
          )}
        >
          {STATE_LABEL[state]}
        </span>
      </div>

      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        {KIND_LABEL[warrant.kind]} · {warrant.number} · {warrant.court}
        {warrant.issuedOn && ` · issued ${warrant.issuedOn}`}
        {state === 'active' && days !== null && days > 0 && ` (${days} days ago)`}
      </p>

      {warrant.bond && (
        <p className="mt-0.5 text-[12.5px] text-muted">Bond {warrant.bond}</p>
      )}

      {/*
        Extradition sits with the charge rather than in a detail panel. A
        warrant good only in the issuing county is not an arrest authority
        anywhere else, and an officer who acts on one has made a false arrest.
      */}
      <p
        className={cn(
          'mt-1 text-[12.5px] leading-relaxed',
          limit ? 'text-warn' : 'text-muted',
        )}
      >
        Extradition: {EXTRADITION_LABEL[warrant.extradition]}
        {limit && ` — ${limit}`}
      </p>

      {warrant.cautions.length > 0 && (
        <p className="mt-1 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-danger">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
          {warrant.cautions.join(' · ')}
        </p>
      )}

      {warrant.attempts.length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer list-none text-[12.5px] text-muted transition hover:text-ink">
            {warrant.attempts.length} service{' '}
            {warrant.attempts.length === 1 ? 'attempt' : 'attempts'}
          </summary>
          <ul className="mt-1 space-y-1 border-l border-line pl-3">
            {warrant.attempts.map((attempt) => (
              <li key={attempt.id} className="text-[12.5px] leading-relaxed text-muted">
                <span className="text-ink">{OUTCOME_LABEL[attempt.outcome]}</span> —{' '}
                {attempt.at.slice(0, 10)} at {attempt.address}
                {attempt.byName && `, ${attempt.byName}`}
                {attempt.notes && <span className="block text-faint">{attempt.notes}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {state === 'recalled' && warrant.recalledReason && (
        <p className="mt-1 text-[12.5px] leading-relaxed text-faint">
          Recalled {warrant.recalledOn}: {warrant.recalledReason}
        </p>
      )}
      {state === 'served' && (
        <p className="mt-1 text-[12.5px] text-faint">
          Served {warrant.servedOn}
          {warrant.servedByName && ` by ${warrant.servedByName}`}.
        </p>
      )}

      {(onAttempt || onRecall) && state === 'active' && (
        <div className="mt-2 flex gap-2">
          {onAttempt && (
            <Button size="sm" onClick={onAttempt}>
              Record an attempt
            </Button>
          )}
          {onRecall && (
            <Button size="sm" onClick={onRecall}>
              Recall it
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
