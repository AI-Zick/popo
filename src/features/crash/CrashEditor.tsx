import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  CornerUpLeft,
  Loader2,
  Plus,
  Printer,
  Send,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useStore } from '@/state/store';
import {
  CONTRIBUTING_FACTORS,
  CRASH_MANNERS,
  LIGHT_CONDITIONS,
  OCCUPANT_SEATS,
  RESTRAINTS,
  ROAD_SURFACE,
  SEVERITIES,
  UNIT_KINDS,
  WEATHER,
  unitLabel,
  worstInjury,
  type CrashUnit,
  type Occupant,
} from '@/domain/crash';
import { canReopen, canReview, REVIEW_ACTION_LABEL, STATUS_LABEL } from '@/domain/review';
import { displayName } from '@/domain/person';
import { STATES } from '@/domain/codes';
import { Badge, Button, FieldGrid, Panel } from '@/components/ui/primitives';
import { SelectField, TextField, TextareaField } from '@/components/ui/fields';
import { Dictate } from '@/components/ui/Dictate';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { InboundPanel } from './InboundPanel';
import { DiagramEditor } from './DiagramEditor';
import { PrintableCrashReport } from './PrintableCrashReport';
import { emptyDiagram } from '@/domain/diagram';

/**
 * Writing a crash report.
 *
 * Organised around units, because that is how a crash is written, diagrammed
 * and argued about — "unit 2 failed to yield". Everything the officer already
 * ran on the radio sits in the panel on the right and goes in with a click.
 */
export function CrashEditor() {
  const {
    crash,
    crashProblems,
    people,
    currentUser,
    closeCrash,
    updateCrash,
    updateUnit,
    addUnit,
    removeUnit,
    submitCrash,
    approveCrash,
    returnCrash,
    reopenCrash,
    savedAt,
  } = useStore();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [printing, setPrinting] = useState(false);

  if (!crash) return null;

  const editable = crash.status === 'draft' || crash.status === 'returned';
  const mine = crash.createdBy === currentUser.id;
  const review = canReview(currentUser, crash);
  const reopen = canReopen(currentUser, crash.status);
  const errors = crashProblems.filter((p) => p.severity === 'error');
  const warnings = crashProblems.filter((p) => p.severity === 'warning');
  const derived = worstInjury(crash);

  const run = async (action: () => Promise<{ ok: boolean; reason?: string }>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) setNote('');
    else setError(result.reason ?? 'That did not work.');
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      {printing && <PrintableCrashReport onClose={() => setPrinting(false)} />}

      <header className="flex shrink-0 items-center gap-4 border-b border-line bg-surface px-4 py-2.5">
        <Button variant="ghost" onClick={closeCrash} aria-label="Back to reports">
          <ChevronLeft size={16} aria-hidden />
          Reports
        </Button>
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate font-mono text-[14px] font-semibold text-ink">{crash.caseNumber}</h1>
          <Badge tone="accent">Crash</Badge>
          <Badge
            tone={
              crash.status === 'approved' ? 'ok' : crash.status === 'returned' ? 'warn' : 'neutral'
            }
          >
            {STATUS_LABEL[crash.status]}
          </Badge>
          {derived === 'fatal' && <Badge tone="danger">Fatal</Badge>}
        </div>
        <div className="flex-1" />
        {savedAt && <span className="text-[12px] text-faint">Saved {relativeTime(savedAt)}</span>}
        <Button onClick={() => setPrinting(true)} title="Print, or save as PDF">
          <Printer size={15} aria-hidden />
          Print
        </Button>
        {editable && mine && (
          <Button
            variant="primary"
            disabled={busy || errors.length > 0}
            onClick={() => void run(submitCrash)}
            title={errors[0]?.message}
          >
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Send size={15} aria-hidden />}
            {errors.length > 0 ? `Submit (${errors.length} to fix)` : 'Submit'}
          </Button>
        )}
      </header>

      {crash.status === 'returned' && crash.returnedReason && (
        <div className="flex items-start gap-3 border-b border-warn/35 bg-warn-soft px-4 py-3">
          <CornerUpLeft size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <div>
            <p className="text-[13px] font-medium text-ink">
              Sent back by {crash.reviewedBy || 'a supervisor'}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink/80">{crash.returnedReason}</p>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
            {error && (
              <p className="rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</p>
            )}

            <fieldset disabled={!editable || !mine} className="min-w-0 space-y-4 border-0 p-0">
              <Panel
                title="The crash"
                description="Where and when, and what the road was doing at the time."
              >
                <FieldGrid cols={2}>
                  <TextField
                    path="crash.occurredAt"
                    label="When it happened"
                    type="datetime-local"
                    required
                    value={crash.occurredAt.slice(0, 16)}
                    onChange={(v) => updateCrash({ occurredAt: v })}
                  />
                  <TextField
                    path="crash.reportedAt"
                    label="When it was reported"
                    type="datetime-local"
                    value={crash.reportedAt.slice(0, 16)}
                    onChange={(v) => updateCrash({ reportedAt: v })}
                  />
                </FieldGrid>

                <FieldGrid cols={2}>
                  <TextField
                    path="crash.callNumber"
                    label="Dispatch call number"
                    hint="Pulls in what dispatch and the registries already have for this scene."
                    placeholder="CF-2026-0417"
                    value={crash.callNumber}
                    onChange={(v) => updateCrash({ callNumber: v.trim() })}
                  />
                  <TextField
                    path="crash.stateCrashNumber"
                    label="State crash number"
                    value={crash.stateCrashNumber}
                    onChange={(v) => updateCrash({ stateCrashNumber: v })}
                  />
                </FieldGrid>

                <FieldGrid cols={3}>
                  <TextField
                    path="crash.onRoad"
                    label="On road"
                    required
                    hint="Crashes are located by road, not street number."
                    value={crash.onRoad}
                    onChange={(v) => updateCrash({ onRoad: v })}
                  />
                  <TextField
                    path="crash.crossStreet"
                    label="At / near"
                    value={crash.crossStreet}
                    onChange={(v) => updateCrash({ crossStreet: v })}
                  />
                  <TextField
                    path="crash.milepost"
                    label="Milepost"
                    value={crash.milepost}
                    onChange={(v) => updateCrash({ milepost: v })}
                  />
                </FieldGrid>

                <FieldGrid cols={4}>
                  <SelectField
                    path="crash.manner"
                    label="Manner of collision"
                    options={CRASH_MANNERS}
                    value={crash.manner}
                    onChange={(v) => updateCrash({ manner: v })}
                  />
                  <SelectField
                    path="crash.lightCondition"
                    label="Light"
                    options={LIGHT_CONDITIONS}
                    value={crash.lightCondition}
                    onChange={(v) => updateCrash({ lightCondition: v })}
                  />
                  <SelectField
                    path="crash.weather"
                    label="Weather"
                    options={WEATHER}
                    value={crash.weather}
                    onChange={(v) => updateCrash({ weather: v })}
                  />
                  <SelectField
                    path="crash.roadSurface"
                    label="Road surface"
                    options={ROAD_SURFACE}
                    value={crash.roadSurface}
                    onChange={(v) => updateCrash({ roadSurface: v })}
                  />
                </FieldGrid>

                <div className="mt-4 flex flex-wrap gap-4 border-t border-line pt-3">
                  <Toggle
                    label="Work zone"
                    checked={crash.workZone}
                    onChange={(v) => updateCrash({ workZone: v })}
                  />
                  <Toggle
                    label="School zone"
                    checked={crash.schoolZone}
                    onChange={(v) => updateCrash({ schoolZone: v })}
                  />
                </div>
              </Panel>

              <Panel
                title="Severity"
                description="Taken from the worst injury recorded on any unit, so the header cannot disagree with the people."
              >
                <div className="flex flex-wrap items-center gap-3">
                  <SelectField
                    className="w-72"
                    path="crash.severity"
                    label="Crash severity"
                    options={SEVERITIES}
                    value={crash.severity}
                    onChange={(v) => updateCrash({ severity: v as never })}
                  />
                  {derived !== crash.severity && (
                    <p className="flex items-start gap-1.5 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-ink">
                      <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                      The worst injury recorded is{' '}
                      <strong>{SEVERITIES.find((s) => s.value === derived)?.label}</strong>.
                      <button
                        type="button"
                        onClick={() => updateCrash({ severity: derived })}
                        className="font-medium text-accent hover:underline"
                      >
                        Use that
                      </button>
                    </p>
                  )}
                </div>
              </Panel>

              {/*
                "Unit" is the word the state crash form uses, and it is the
                right word on the form — a unit is a vehicle *or* a pedestrian
                or a cyclist, which is why the section cannot just be called
                Vehicles. But somebody looking for where the cars and the people
                go does not search for "unit", so the heading says both.
              */}
              <div className="flex items-baseline gap-2">
                <h2 className="text-[15px] font-semibold text-ink">Vehicles and people involved</h2>
                <span className="text-[12px] text-faint">
                  {crash.units.length === 0
                    ? 'The state form calls each one a unit'
                    : `${crash.units.length} ${crash.units.length === 1 ? 'unit' : 'units'} — a vehicle, a pedestrian or a cyclist, and whoever was in or on it`}
                </span>
              </div>

              {crash.units.map((unit) => (
                <UnitPanel
                  key={unit.id}
                  unit={unit}
                  nameOf={(masterId) =>
                    people[masterId] ? displayName(people[masterId]) : 'Unnamed person'
                  }
                  onChange={(patch) => updateUnit(unit.id, patch)}
                  onRemove={() => removeUnit(unit.id)}
                />
              ))}

              <Button onClick={addUnit}>
                <Plus size={15} aria-hidden />
                {crash.units.length === 0 ? 'Add a vehicle or person' : 'Add another unit'}
              </Button>

              <Panel
                title="Scene diagram"
                description="Place the units, turn them to face the way they were going, and draw the marks. It prints with the report."
              >
                <DiagramEditor
                  diagram={crash.diagram ?? emptyDiagram()}
                  units={crash.units}
                  readOnly={!editable || !mine}
                  onChange={(next) =>
                    updateCrash({
                      diagram: {
                        ...next,
                        updatedAt: new Date().toISOString(),
                        updatedBy: currentUser.name,
                      },
                    })
                  }
                />
              </Panel>

              <Panel
                title="Narrative"
                description="How the units came together, in unit numbers. An adjuster and possibly a jury will read this."
              >
                <TextareaField
                  path="crash.narrative"
                  label="What happened"
                  required
                  rows={14}
                  placeholder="Unit 1 was travelling north on…"
                  value={crash.narrative}
                  onChange={(v) => updateCrash({ narrative: v })}
                />
                <Dictate
                  path="crash.narrative"
                  value={crash.narrative}
                  onChange={(v) => updateCrash({ narrative: v })}
                  disabled={!editable || !mine}
                />
              </Panel>
            </fieldset>

            {(errors.length > 0 || warnings.length > 0) && editable && mine && (
              <Panel title={`Report check (${errors.length + warnings.length})`}>
                <ul className="space-y-2">
                  {[...errors, ...warnings].map((problem, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <AlertTriangle
                        size={14}
                        className={cn(
                          'mt-0.5 shrink-0',
                          problem.severity === 'error' ? 'text-danger' : 'text-warn',
                        )}
                        aria-hidden
                      />
                      <div>
                        <p className="text-[13px] text-ink">{problem.message}</p>
                        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{problem.tip}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {(review.ok || reopen.ok) && (
              <Panel
                title="Supervisor review"
                description={review.ok ? 'Approve it, or send it back.' : 'Reopening puts it back to its author.'}
                aside={<Badge tone="accent">Reviewer</Badge>}
              >
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={review.ok ? 'Note — required if you send it back' : 'Why it is being reopened'}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px] text-ink placeholder:text-faint"
                />
                <div className="mt-3 flex gap-2">
                  {review.ok && (
                    <>
                      <Button variant="primary" disabled={busy} onClick={() => void run(() => approveCrash(note.trim()))}>
                        <Check size={15} aria-hidden />
                        Approve
                      </Button>
                      <Button disabled={busy || !note.trim()} onClick={() => void run(() => returnCrash(note.trim()))}>
                        <CornerUpLeft size={15} aria-hidden />
                        Return for correction
                      </Button>
                    </>
                  )}
                  {reopen.ok && (
                    <Button disabled={busy || !note.trim()} onClick={() => void run(() => reopenCrash(note.trim()))}>
                      <CornerUpLeft size={15} aria-hidden />
                      Reopen
                    </Button>
                  )}
                </div>
              </Panel>
            )}

            {crash.reviewHistory.length > 0 && (
              <Panel title="History">
                <ul className="space-y-1.5">
                  {[...crash.reviewHistory].reverse().map((entry) => (
                    <li key={entry.id} className="text-[12.5px] text-muted">
                      <span className="font-medium text-ink">{REVIEW_ACTION_LABEL[entry.action]}</span>{' '}
                      by {entry.actorName} · {relativeTime(entry.at)}
                      {entry.note && <span className="block text-[12px] text-faint">“{entry.note}”</span>}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        </main>

        <aside className="w-96 shrink-0 overflow-y-auto border-l border-line bg-canvas p-4">
          <InboundPanel />
        </aside>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-line-strong"
      />
      {label}
    </label>
  );
}

function UnitPanel({
  unit,
  nameOf,
  onChange,
  onRemove,
}: {
  unit: CrashUnit;
  nameOf: (masterId: string) => string;
  onChange: (patch: Partial<CrashUnit>) => void;
  onRemove: () => void;
}) {
  const toggleFactor = (value: string) =>
    onChange({
      contributingFactors:
        value === 'none'
          ? // "No contributing factor" is an answer, and it excludes the rest.
            unit.contributingFactors.includes('none')
            ? []
            : ['none']
          : unit.contributingFactors.includes(value)
            ? unit.contributingFactors.filter((f) => f !== value)
            : [...unit.contributingFactors.filter((f) => f !== 'none'), value],
    });

  return (
    <Panel
      title={unitLabel(unit)}
      description={unit.ownerMasterId ? `Registered owner: ${nameOf(unit.ownerMasterId)}` : undefined}
      aside={
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md p-1.5 text-faint transition hover:text-danger"
          aria-label={`Remove unit ${unit.number}`}
        >
          <Trash2 size={15} />
        </button>
      }
    >
      <FieldGrid cols={4}>
        <SelectField
          path={`unit.${unit.id}.kind`}
          label="Unit type"
          options={UNIT_KINDS}
          value={unit.kind}
          onChange={(v) => onChange({ kind: v as CrashUnit['kind'] })}
        />
        <TextField
          path={`unit.${unit.id}.plate`}
          label="Plate"
          value={unit.plate}
          onChange={(v) => onChange({ plate: v.toUpperCase() })}
          inputClassName="font-mono uppercase"
        />
        <SelectField
          path={`unit.${unit.id}.plateState`}
          label="State"
          options={STATES}
          value={unit.plateState}
          onChange={(v) => onChange({ plateState: v })}
        />
        <TextField
          path={`unit.${unit.id}.vin`}
          label="VIN"
          value={unit.vin}
          onChange={(v) => onChange({ vin: v.toUpperCase() })}
          inputClassName="font-mono uppercase"
        />
      </FieldGrid>

      <FieldGrid cols={4}>
        <TextField path={`unit.${unit.id}.year`} label="Year" value={unit.year} onChange={(v) => onChange({ year: v })} />
        <TextField path={`unit.${unit.id}.make`} label="Make" value={unit.make} onChange={(v) => onChange({ make: v })} />
        <TextField path={`unit.${unit.id}.model`} label="Model" value={unit.model} onChange={(v) => onChange({ model: v })} />
        <TextField path={`unit.${unit.id}.color`} label="Colour" value={unit.color} onChange={(v) => onChange({ color: v })} />
      </FieldGrid>

      <FieldGrid cols={3}>
        <TextField
          path={`unit.${unit.id}.direction`}
          label="Travelling"
          hint="North, southbound, etc."
          value={unit.direction}
          onChange={(v) => onChange({ direction: v })}
        />
        <TextField
          path={`unit.${unit.id}.postedSpeed`}
          label="Posted speed"
          value={unit.postedSpeed}
          onChange={(v) => onChange({ postedSpeed: v })}
        />
        <TextField
          path={`unit.${unit.id}.estimatedSpeed`}
          label="Estimated speed"
          value={unit.estimatedSpeed}
          onChange={(v) => onChange({ estimatedSpeed: v })}
        />
      </FieldGrid>

      <FieldGrid cols={2}>
        <TextField
          path={`unit.${unit.id}.insuranceCarrier`}
          label="Insurance carrier"
          value={unit.insuranceCarrier}
          onChange={(v) => onChange({ insuranceCarrier: v })}
        />
        <TextField
          path={`unit.${unit.id}.insurancePolicy`}
          label="Policy number"
          value={unit.insurancePolicy}
          onChange={(v) => onChange({ insurancePolicy: v })}
        />
      </FieldGrid>

      {/* ---- Contributing factors -------------------------------------- */}
      <div className="mt-4 border-t border-line pt-3">
        <p className="mb-2 text-[13px] font-medium text-ink">What contributed, for this unit</p>
        <div className="flex flex-wrap gap-1.5">
          {CONTRIBUTING_FACTORS.map((factor) => (
            <button
              key={factor.value}
              type="button"
              onClick={() => toggleFactor(factor.value)}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-[12.5px] transition',
                unit.contributingFactors.includes(factor.value)
                  ? 'border-accent bg-accent-soft text-ink'
                  : 'border-line text-muted hover:border-line-strong',
              )}
            >
              {factor.label}
            </button>
          ))}
        </div>
      </div>

      {/* ---- Occupants -------------------------------------------------- */}
      <div className="mt-4 border-t border-line pt-3">
        <p className="mb-2 text-[13px] font-medium text-ink">
          Occupants ({unit.occupants.length})
        </p>
        {unit.occupants.length === 0 ? (
          <p className="text-[12.5px] text-muted">
            Nobody yet. Run a licence and it will appear in the panel on the right.
          </p>
        ) : (
          <ul className="space-y-2">
            {unit.occupants.map((occupant) => (
              <OccupantRow
                key={occupant.id}
                occupant={occupant}
                name={nameOf(occupant.masterId)}
                isDriver={unit.driverOccupantId === occupant.id}
                onMakeDriver={() => onChange({ driverOccupantId: occupant.id })}
                onChange={(patch) =>
                  onChange({
                    occupants: unit.occupants.map((o) =>
                      o.id === occupant.id ? { ...o, ...patch } : o,
                    ),
                  })
                }
                onRemove={() =>
                  onChange({
                    occupants: unit.occupants.filter((o) => o.id !== occupant.id),
                    driverOccupantId:
                      unit.driverOccupantId === occupant.id ? '' : unit.driverOccupantId,
                  })
                }
              />
            ))}
          </ul>
        )}
      </div>

      {/* ---- Tow --------------------------------------------------------- */}
      <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-line pt-3">
        <Toggle label="Towed" checked={unit.towed} onChange={(v) => onChange({ towed: v })} />
        {unit.towed && (
          <>
            <TextField
              className="w-52"
              path={`unit.${unit.id}.towedBy`}
              label="Towed by"
              value={unit.towedBy}
              onChange={(v) => onChange({ towedBy: v })}
            />
            <TextField
              className="w-52"
              path={`unit.${unit.id}.towedTo`}
              label="Towed to"
              value={unit.towedTo}
              onChange={(v) => onChange({ towedTo: v })}
            />
          </>
        )}
      </div>
    </Panel>
  );
}

function OccupantRow({
  occupant,
  name,
  isDriver,
  onMakeDriver,
  onChange,
  onRemove,
}: {
  occupant: Occupant;
  name: string;
  isDriver: boolean;
  onMakeDriver: () => void;
  onChange: (patch: Partial<Occupant>) => void;
  onRemove: () => void;
}) {
  return (
    <li className="rounded-lg border border-line bg-canvas p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium text-ink">{name}</span>
        {isDriver ? (
          <Badge tone="accent">Driver</Badge>
        ) : (
          <button
            type="button"
            onClick={onMakeDriver}
            className="text-[11.5px] font-medium text-accent hover:underline"
          >
            Mark as driver
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onRemove}
          className="text-faint transition hover:text-danger"
          aria-label={`Remove ${name}`}
        >
          <Trash2 size={13} />
        </button>
      </div>

      <FieldGrid cols={4}>
        <SelectField
          path={`occupant.${occupant.id}.seat`}
          label="Seat"
          options={OCCUPANT_SEATS}
          value={occupant.seat}
          onChange={(v) => onChange({ seat: v })}
        />
        <SelectField
          path={`occupant.${occupant.id}.restraint`}
          label="Restraint"
          options={RESTRAINTS}
          value={occupant.restraint}
          onChange={(v) => onChange({ restraint: v })}
        />
        <SelectField
          path={`occupant.${occupant.id}.injury`}
          label="Injury"
          options={SEVERITIES}
          value={occupant.injury}
          onChange={(v) => onChange({ injury: v as Occupant['injury'] })}
        />
        <TextField
          path={`occupant.${occupant.id}.transportedTo`}
          label="Taken to"
          value={occupant.transportedTo}
          onChange={(v) => onChange({ transportedTo: v })}
        />
      </FieldGrid>

      <div className="mt-2 flex flex-wrap gap-4">
        <Toggle
          label="Airbag deployed"
          checked={occupant.airbagDeployed}
          onChange={(v) => onChange({ airbagDeployed: v })}
        />
        <Toggle label="Ejected" checked={occupant.ejected} onChange={(v) => onChange({ ejected: v })} />
      </div>
    </li>
  );
}
