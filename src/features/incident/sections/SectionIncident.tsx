import { CalendarClock, MapPin, ShieldAlert, UserCog } from 'lucide-react';
import { useStore } from '@/state/store';
import { path } from '@/validation/engine';
import { FieldGrid, Panel } from '@/components/ui/primitives';
import { SelectField, TextField, ToggleField } from '@/components/ui/fields';
import { CLEARANCE_OPTIONS, EXCEPTIONAL_CLEARANCE_REASONS } from '@/domain/codes';
import { LocationField } from '@/components/location/LocationField';
import { PremiseNotes } from '@/components/location/PremiseNotes';

export function SectionIncident() {
  const { incident, location, update } = useStore();
  if (!incident) return null;

  const set = <K extends keyof typeof incident>(key: K, value: (typeof incident)[K]) =>
    update((d) => {
      (d[key] as typeof value) = value;
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
          <div className="mt-4">
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
