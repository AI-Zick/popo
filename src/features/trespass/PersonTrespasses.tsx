import { useCallback, useEffect, useState } from 'react';
import { Ban, ChevronDown, Loader2, TriangleAlert } from 'lucide-react';
import { api, type TrespassRow } from '@/state/api';
import { useStore } from '@/state/store';
import { STATE_LABEL, trespassStanding } from '@/domain/trespass';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { LiftTrespass } from './LiftTrespass';
import { RecordTrespass } from './RecordTrespass';

/**
 * Everywhere one person is barred from.
 *
 * Folds open, and says on the closed header how many notices are in force —
 * which is the only part most people need, and the part that has to be
 * readable without a click. An officer at a door has one question: is this
 * person allowed to be here.
 *
 * Expired and lifted notices are kept and shown, greyed, below the ones that
 * bite. They are not clutter: somebody arrested last winter on a notice that
 * has since run out is still being prosecuted, and the notice is the evidence
 * that they had been warned.
 */
export function PersonTrespasses({
  masterId,
  personName,
  defaultOpen = false,
}: {
  masterId: string;
  personName: string;
  defaultOpen?: boolean;
}) {
  const { can } = useStore();
  const [open, setOpen] = useState(defaultOpen);
  const [rows, setRows] = useState<TrespassRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lifting, setLifting] = useState<TrespassRow | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { trespasses } = await api.personTrespasses(masterId);
      setRows(trespasses);
    } catch {
      setError('Could not load the trespass notices for this person.');
      setRows([]);
    }
  }, [masterId]);

  /*
    Loaded as soon as the person is on screen, not when the section is opened.
    The count in the header is the whole point of the header, and a header that
    says nothing until you click it has not saved anybody anything.
  */
  useEffect(() => {
    void load();
  }, [load]);

  const active = rows?.filter((row) => row.state === 'active') ?? [];
  const past = rows?.filter((row) => row.state !== 'active') ?? [];

  return (
    <section className="rounded-xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <Ban
          size={16}
          className={active.length ? 'text-warn' : 'text-faint'}
          aria-hidden
        />
        <span className="text-[14px] font-medium text-ink">Trespassed from</span>

        <span className="text-[13px] text-muted">
          {rows === null ? (
            <Loader2 size={13} className="animate-spin" aria-hidden />
          ) : active.length === 0 ? (
            past.length ? 'Nowhere currently' : 'Nowhere'
          ) : (
            `${active.length} ${active.length === 1 ? 'place' : 'places'}`
          )}
        </span>

        <ChevronDown
          size={15}
          className={cn('ml-auto shrink-0 text-faint transition', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {/*
        The closed header carries the one fact that matters, so an officer
        scanning a record does not have to open anything to learn there is
        something here.
      */}
      {!open && active.length > 0 && (
        <p className="px-4 pb-3 text-[12.5px] leading-relaxed text-warn">
          {active
            .slice(0, 3)
            .map((row) => row.location?.commonName || row.location?.address || 'a place on file')
            .join(' · ')}
          {active.length > 3 && ` · and ${active.length - 3} more`}
        </p>
      )}

      {open && (
        <div className="space-y-2 border-t border-line px-4 py-3">
          {error && (
            <p className="flex items-start gap-1.5 text-[12.5px] text-danger">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          {rows?.length === 0 && !error && (
            <p className="text-[13px] text-muted">
              No trespass notice has been recorded against {personName}.
            </p>
          )}

          {[...active, ...past].map((row) => (
            <div
              key={row.trespass.id}
              className={cn(
                'rounded-lg border border-line p-3',
                row.state !== 'active' && 'opacity-65',
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[13.5px] font-medium text-ink">
                  {row.location?.commonName || row.location?.address || 'A place no longer on file'}
                </span>
                <span
                  className={cn(
                    'rounded border px-1.5 py-0.5 text-[11px] uppercase tracking-wide',
                    row.state === 'active'
                      ? 'border-warn/50 text-warn'
                      : 'border-line text-muted',
                  )}
                >
                  {STATE_LABEL[row.state]}
                </span>
              </div>

              {row.location?.commonName && row.location.address && (
                <p className="mt-0.5 text-[12.5px] text-faint">{row.location.address}</p>
              )}

              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                Served {row.trespass.servedOn}
                {row.trespass.requestedBy && ` at the request of ${row.trespass.requestedBy}`}.{' '}
                {trespassStanding(row.trespass)}
              </p>

              {row.trespass.notes && (
                <p className="mt-1 text-[12.5px] leading-relaxed text-faint">{row.trespass.notes}</p>
              )}

              {row.state === 'active' && can('trespass.lift') && (
                <Button size="sm" className="mt-2" onClick={() => setLifting(row)}>
                  Lift it
                </Button>
              )}
            </div>
          ))}

          <Button size="sm" onClick={() => setAdding(true)}>
            <Ban size={13} aria-hidden />
            Record a trespass
          </Button>
        </div>
      )}

      {lifting && (
        <LiftTrespass
          trespass={lifting.trespass}
          who={personName}
          where={lifting.location?.commonName || lifting.location?.address || 'that place'}
          onClose={() => setLifting(null)}
          onLifted={() => {
            setLifting(null);
            void load();
          }}
        />
      )}

      {adding && (
        <RecordTrespass
          personId={masterId}
          personName={personName}
          onClose={() => setAdding(false)}
          onRecorded={() => {
            setAdding(false);
            setOpen(true);
            void load();
          }}
        />
      )}
    </section>
  );
}
