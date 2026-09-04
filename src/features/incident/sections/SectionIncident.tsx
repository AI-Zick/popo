import { useState } from 'react';
import { CalendarClock, MapPin, ShieldAlert, UserCog, UserPlus, X } from 'lucide-react';
import { useStore } from '@/state/store';
import { path } from '@/validation/engine';
import { AddButton, Button, FieldGrid, Panel } from '@/components/ui/primitives';
import { SelectField, TextField, ToggleField } from '@/components/ui/fields';
import { CLEARANCE_OPTIONS, EXCEPTIONAL_CLEARANCE_REASONS } from '@/domain/codes';
import { createSupportingOfficer } from '@/domain/factory';
import { canHandOff } from '@/domain/review';
import { cn } from '@/lib/cn';
import { LocationField } from '@/components/location/LocationField';
import { PremiseNotes } from '@/components/location/PremiseNotes';
import { LocationPin } from '@/components/location/LocationPin';

/**
 * Passing the report to somebody else to finish.
 *
 * The case it exists for: an officer does the scene, writes what they have,
 * and goes off shift with the follow-up still open. Without this, the report
 * waits for them to come back — or the other officer starts a second one about
 * the same incident, and now the agency has two records of one thing.
 *
 * Whoever hands it on stays on the report as a supporting officer. That is the
 * point rather than a nicety: they wrote part of it, and a document that ends
 * up with one name on it when two people worked it misleads everybody who
 * reads it afterwards.
 */
function HandOff() {
  const { incident, currentUser, users, handOffReport } = useStore();
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!incident) return null;

  const allowed = canHandOff(currentUser, incident);
  if (!allowed.ok) return null;

  const candidates = users.filter((user) => user.active && user.id !== incident.createdBy);

  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="text-[13px] font-medium text-ink">Hand it to another officer</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-faint">
        They finish it and it becomes theirs to submit. You stay on the report as a supporting
        officer — what you wrote is still yours.
      </p>
      <div className="mt-2.5 flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1">
          <span className="sr-only">Officer to hand it to</span>
          <select
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink"
          >
            <option value="">Choose an officer…</option>
            {candidates.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
                {user.badge ? ` #${user.badge}` : ''}
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={!to || busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void handOffReport(to).then((result) => {
              setBusy(false);
              setTo('');
              if (!result.ok) setError(result.reason ?? 'That did not work.');
            });
          }}
        >
          <UserPlus size={15} aria-hidden />
          Hand it over
        </Button>
      </div>
      {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
    </div>
  );
}

export function SectionIncident() {
  const { incident, location, update } = useStore();
  if (!incident) return null;

  const set = <K extends keyof typeof incident>(key: K, value: (typeof incident)[K]) =>
    update((d) => {
      (d[key] as typeof value) = value;
    });

  const setSupporting = (id: string, patch: { name?: string; badge?: string; role?: string }) =>
    update((d) => {
      const officer = d.supportingOfficers.find((o) => o.id === id);
      if (officer) Object.assign(officer, patch);
    });

  return (
    <div className="space-y-4">
      <Panel
        title="When it happened"
        description="Dispatch time and occurrence time are different fields, and the state submission checks them against each other."
        aside={<CalendarClock size={17} className="text-faint" aria-hidden />}
      >
        <FieldGrid cols={2}>
          <TextField
            path={path.incident('reportedAt')}
            label="Reported / dispatched"
            type="datetime-local"
            required
            value={incident.reportedAt}
            onChange={(v) => set('reportedAt', v)}
          />
          <TextField
            path={path.incident('occurredFrom')}
            label={incident.occurredIsRange ? 'Occurred — earliest' : 'Occurred'}
            type="datetime-local"
            required
            value={incident.occurredFrom}
            onChange={(v) => set('occurredFrom', v)}
          />
        </FieldGrid>

        <div className="mt-4">
          <ToggleField
            path={path.incident('occurredIsRange')}
            label="Occurred over a date range"
            description="Use this when the victim can only narrow it to a window — “sometime after I went to bed”."
            checked={incident.occurredIsRange}
            onChange={(v) => set('occurredIsRange', v)}
          />
        </div>

        {incident.occurredIsRange && (
          <div className="mt-4">
            <TextField
              path={path.incident('occurredTo')}
              label="Occurred — latest"
              type="datetime-local"
              required
              hint="Usually the moment the victim discovered it."
              value={incident.occurredTo}
              onChange={(v) => set('occurredTo', v)}
              className="max-w-sm"
            />
          </div>
        )}
      </Panel>

      <Panel
        title="Where it happened"
        description="One record per place, shared by every report at that address — including whatever officers have left on it."
        aside={<MapPin size={17} className="text-faint" aria-hidden />}
      >
        <LocationField path={path.incident('locationId')} />

        {location?.hasUnits && (
          <div className="mt-4 max-w-xs">
            <TextField
              path={path.incident('locationUnit')}
              label={`${location.unitLabel} number`}
              required
              placeholder="C-14"
              hint={`${location.commonName || location.address} has multiple ${location.unitLabel.toLowerCase()}s.`}
              value={incident.locationUnit}
              onChange={(v) => set('locationUnit', v)}
            />
          </div>
        )}

        {location && (
          <div className="mt-4 space-y-4">
            <LocationPin location={location} />
            <PremiseNotes location={location} />
          </div>
        )}
      </Panel>

      <Panel
        title="Who took the report"
        aside={<UserCog size={17} className="text-faint" aria-hidden />}
      >
        <FieldGrid cols={4}>
          <TextField
            path={path.incident('reportingOfficer')}
            label="Reporting officer"
            required
            value={incident.reportingOfficer}
            onChange={(v) => set('reportingOfficer', v)}
          />
          <TextField
            path={path.incident('reportingBadge')}
            label="Badge #"
            value={incident.reportingBadge}
            onChange={(v) => set('reportingBadge', v)}
          />
          <TextField
            path={path.incident('unit')}
            label="Unit"
            value={incident.unit}
            onChange={(v) => set('unit', v)}
          />
          <TextField
            path={path.incident('supervisor')}
            label="Supervisor"
            value={incident.supervisor}
            onChange={(v) => set('supervisor', v)}
          />
        </FieldGrid>

        {/*
          Everybody else who worked it.

          One name on a report is one name anybody can find later — and two
          officers on a scene with one on the paperwork is the ordinary case.
          The second officer's account of what they saw is evidence, and until
          this existed it lived nowhere the system could point at.
        */}
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-[13px] font-medium text-ink">Supporting officers</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-faint">
            Anyone else who worked this call — assisted, transported, processed the scene.
          </p>

          <ul className="mt-2.5 space-y-2">
            {incident.supportingOfficers.map((officer, index) => (
              <li key={officer.id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <FieldGrid cols={3}>
                    <TextField
                      path={path.incident('supportingOfficers')}
                      label={index === 0 ? 'Name' : ''}
                      value={officer.name}
                      onChange={(v) => setSupporting(officer.id, { name: v })}
                    />
                    <TextField
                      path={path.incident('supportingOfficers')}
                      label={index === 0 ? 'Badge #' : ''}
                      value={officer.badge}
                      onChange={(v) => setSupporting(officer.id, { badge: v })}
                    />
                    <TextField
                      path={path.incident('supportingOfficers')}
                      label={index === 0 ? 'What they did' : ''}
                      placeholder="Assisted"
                      value={officer.role}
                      onChange={(v) => setSupporting(officer.id, { role: v })}
                    />
                  </FieldGrid>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${officer.name || 'this officer'}`}
                  onClick={() =>
                    update((d) => {
                      d.supportingOfficers = d.supportingOfficers.filter((o) => o.id !== officer.id);
                    })
                  }
                  className={cn(
                    'rounded-lg p-2 text-faint transition hover:bg-canvas hover:text-danger',
                    index === 0 && 'mt-6',
                  )}
                >
                  <X size={15} aria-hidden />
                </button>
              </li>
            ))}
          </ul>

          <AddButton
            label={
              incident.supportingOfficers.length === 0
                ? 'Add a supporting officer'
                : 'Add another officer'
            }
            onClick={() => update((d) => void d.supportingOfficers.push(createSupportingOfficer()))}
          />
        </div>

        <HandOff />
      </Panel>

      <Panel
        title="Case flags"
        description="These drive routing, redaction and the supplements this report will require."
        aside={<ShieldAlert size={17} className="text-faint" aria-hidden />}
      >
        <FieldGrid cols={2}>
          <ToggleField
            path={path.incident('isDomestic')}
            label="Domestic violence"
            description="Victim and offender are family or intimate partners."
            checked={incident.isDomestic}
            onChange={(v) => set('isDomestic', v)}
          />
          <ToggleField
            path={path.incident('isHateCrime')}
            label="Bias / hate crime"
            description="Requires a bias motivation on at least one offense."
            checked={incident.isHateCrime}
            onChange={(v) => set('isHateCrime', v)}
          />
          <ToggleField
            path={path.incident('isGangRelated')}
            label="Gang related"
            checked={incident.isGangRelated}
            onChange={(v) => set('isGangRelated', v)}
          />
          <ToggleField
            path={path.incident('involvesJuvenile')}
            label="Involves a juvenile"
            description="Controls redaction on public records requests."
            checked={incident.involvesJuvenile}
            onChange={(v) => set('involvesJuvenile', v)}
          />
        </FieldGrid>
      </Panel>

      <Panel title="Disposition" description="How the case stands right now. This can change on a supplement.">
        <FieldGrid cols={incident.clearanceStatus === 'cleared_exceptional' ? 3 : 1}>
          <SelectField
            path={path.incident('clearanceStatus')}
            label="Case status"
            options={CLEARANCE_OPTIONS}
            placeholder="Select a disposition…"
            value={incident.clearanceStatus}
            onChange={(v) => set('clearanceStatus', v as typeof incident.clearanceStatus)}
          />
          {incident.clearanceStatus === 'cleared_exceptional' && (
            <>
              <SelectField
                path={path.incident('exceptionalClearanceReason')}
                label="Exceptional reason"
                required
                options={EXCEPTIONAL_CLEARANCE_REASONS}
                value={incident.exceptionalClearanceReason}
                onChange={(v) => set('exceptionalClearanceReason', v)}
              />
              <TextField
                path={path.incident('clearedAt')}
                label="Date cleared"
                type="date"
                required
                value={incident.clearedAt}
                onChange={(v) => set('clearedAt', v)}
              />
            </>
          )}
        </FieldGrid>
      </Panel>
    </div>
  );
}
