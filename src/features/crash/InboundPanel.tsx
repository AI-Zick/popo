import { AlertTriangle, Car, Download, Phone, Radio, User } from 'lucide-react';
import { useStore } from '@/state/store';
import {
  alertsOn,
  alreadyApplied,
  describeReturn,
  KIND_LABEL,
  SOURCE_LABEL,
  type QueryReturn,
} from '@/domain/inbound';
import { unitLabel } from '@/domain/crash';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/format';

const ICON: Record<string, typeof Car> = {
  call: Radio,
  registration: Car,
  license: User,
  person: User,
};

/**
 * What dispatch and the registries already know about this scene.
 *
 * By the time the officer opens this, the plate has been read over the radio,
 * the registration has come back and two licences have been run. Typing any of
 * it again is where the transcription errors come from, so the returns sit
 * beside the report and go in with a click.
 *
 * It is still a click. A licence return says what the state has on file, not
 * what the officer confirmed with the person in front of them, and which
 * vehicle is unit 1 is a judgement nobody else can make. What the click removes
 * is the typing, not the officer.
 */
export function InboundPanel() {
  const { sceneReturns, crash, applyReturn, applyCallDetails } = useStore();
  if (!crash) return null;

  const unapplied = sceneReturns.filter((r) => !alreadyApplied(r, crash.id));
  const applied = sceneReturns.filter((r) => alreadyApplied(r, crash.id));

  return (
    <Panel
      title="From dispatch and the registries"
      description={
        crash.callNumber
          ? `Returns on call ${crash.callNumber}. Nothing here has to be retyped.`
          : 'No call number on this report, so these are what you ran in the last twelve hours.'
      }
      aside={<Download size={17} className="text-faint" aria-hidden />}
    >
      {sceneReturns.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-muted">
          Nothing has come in for this scene. Registration and licence returns appear here as they
          are run, and go into the report with one click.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {unapplied.map((ret) => (
              <ReturnCard
                key={ret.id}
                ret={ret}
                units={crash.units.map((u) => ({ id: u.id, label: unitLabel(u) }))}
                onApply={(as, unitId) => applyReturn(ret.id, as, unitId)}
                onApplyCall={() => applyCallDetails(ret.id)}
              />
            ))}
          </ul>

          {applied.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">
                Already used on this report
              </p>
              <ul className="mt-1.5 space-y-1">
                {applied.map((ret) => (
                  <li key={ret.id} className="text-[12px] text-muted">
                    {describeReturn(ret)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function ReturnCard({
  ret,
  units,
  onApply,
  onApplyCall,
}: {
  ret: QueryReturn;
  units: { id: string; label: string }[];
  onApply: (as: 'unit' | 'driver' | 'owner' | 'occupant', unitId?: string) => void;
  onApplyCall: () => void;
}) {
  const Icon = ICON[ret.kind] ?? Phone;
  const alerts = alertsOn(ret);
  const isVehicle = ret.kind === 'registration';
  const isPerson = ret.kind === 'license' || ret.kind === 'person';
  const isCall = ret.kind === 'call';

  return (
    <li className="rounded-xl border border-line bg-canvas p-3">
      <div className="flex items-start gap-2.5">
        <Icon size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-ink">{describeReturn(ret)}</p>
          <p className="mt-0.5 text-[11.5px] text-muted">
            {KIND_LABEL[ret.kind]} · {SOURCE_LABEL[ret.source]} · {relativeTime(ret.receivedAt)}
          </p>
        </div>
      </div>

      {/*
        The reason the query was run in the first place. Filling it silently
        into a field would waste the one piece of information the officer
        actually needed from it.
      */}
      {alerts.length > 0 && (
        <ul className="mt-2 space-y-1">
          {alerts.map((alert) => (
            <li
              key={alert}
              className="flex items-start gap-1.5 rounded-md bg-warn-soft px-2 py-1 text-[11.5px] text-ink"
            >
              <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              {alert}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {isCall && (
          <Button size="sm" variant="primary" onClick={onApplyCall}>
            Use the time and place
          </Button>
        )}
        {isVehicle && (
          <Button size="sm" variant="primary" onClick={() => onApply('unit')}>
            Add as a unit
          </Button>
        )}
        {isPerson && units.length === 0 && (
          <span className="text-[11.5px] text-faint">Add a unit first, then place this person on it.</span>
        )}
        {isPerson &&
          units.map((unit) => (
            <div key={unit.id} className="flex items-center gap-1">
              <Button size="sm" variant="primary" onClick={() => onApply('driver', unit.id)}>
                Driver of {unit.label.split(' — ')[0]}
              </Button>
              <Button size="sm" onClick={() => onApply('occupant', unit.id)}>
                Passenger
              </Button>
            </div>
          ))}
      </div>

      {isVehicle && (
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          The registered owner comes with it, as a person on the report — not as the driver. Who was
          driving is a separate call.
        </p>
      )}
      {isPerson && (
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Fields filled from this will read “not confirmed with this person” until you confirm them.
        </p>
      )}
      {isCall && (
        <>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            Only fills what is still blank. Dispatch's address is where the caller said it was, and
            what you saw standing there wins.
          </p>
          {ret.payload.kind === 'call' && ret.payload.comments.length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-line pt-2">
              {ret.payload.comments.map((comment, i) => (
                <li key={i} className="text-[11.5px] leading-relaxed text-muted">
                  “{comment}”
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {ret.appliedTo.length > 0 && (
        <Badge tone="neutral">Used on {ret.appliedTo.length} other report(s)</Badge>
      )}
    </li>
  );
}
