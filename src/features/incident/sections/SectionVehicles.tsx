import { Car } from 'lucide-react';
import { useStore } from '@/state/store';
import { path, personDisplayName } from '@/validation/engine';
import { createVehicle } from '@/domain/factory';
import type { Vehicle } from '@/domain/types';
import {
  AddButton,
  Badge,
  EmptyState,
  FieldGrid,
  RecordCard,
  SectionAnchor,
} from '@/components/ui/primitives';
import { SelectField, TextField, TextareaField } from '@/components/ui/fields';
import { STATES, VEHICLE_INVOLVEMENT } from '@/domain/codes';

export function SectionVehicles() {
  const { incident, update } = useStore();
  if (!incident) return null;

  const setVehicle = (id: string, patch: Partial<Vehicle>) =>
    update((d) => {
      const target = d.vehicles.find((v) => v.id === id);
      if (target) Object.assign(target, patch);
    });

  const add = () => update((d) => void d.vehicles.push(createVehicle()));

  return (
    <SectionAnchor section="vehicles">
      {incident.vehicles.length === 0 ? (
        <EmptyState
          icon={<Car size={20} />}
          title="No vehicles on this report"
          body="Add any vehicle that was stolen, recovered, towed, or used by a suspect. The plate and VIN recorded here are what another agency hits on during a traffic stop."
          action={<AddButton label="Add a vehicle" onClick={add} />}
        />
      ) : (
        <>
          {incident.vehicles.map((vehicle, index) => (
            <VehicleCard
              key={vehicle.id}
              vehicle={vehicle}
              index={index}
              onChange={(patch) => setVehicle(vehicle.id, patch)}
              onRemove={() =>
                update((d) => void (d.vehicles = d.vehicles.filter((v) => v.id !== vehicle.id)))
              }
            />
          ))}
          <AddButton label="Add another vehicle" onClick={add} />
        </>
      )}
    </SectionAnchor>
  );
}

function VehicleCard({
  vehicle,
  index,
  onChange,
  onRemove,
}: {
  vehicle: Vehicle;
  index: number;
  onChange: (patch: Partial<Vehicle>) => void;
  onRemove: () => void;
}) {
  const { incident } = useStore();
  const at = (field: keyof Vehicle) => path.vehicle(vehicle.id, field);

  const owners = (incident?.persons ?? []).map((p) => ({
    value: p.id,
    label: personDisplayName(p),
  }));

  const title =
    [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle details pending';
  const involvementLabel = VEHICLE_INVOLVEMENT.find((v) => v.value === vehicle.involvement)?.label;

  return (
    <RecordCard
      index={index}
      title={title}
      subtitle={[vehicle.color, vehicle.plate && `Plate ${vehicle.plate}`].filter(Boolean).join(' · ') || undefined}
      badge={
        involvementLabel && (
          <Badge tone={vehicle.involvement === 'stolen' ? 'danger' : vehicle.involvement === 'recovered' ? 'ok' : 'neutral'}>
            {involvementLabel}
          </Badge>
        )
      }
      onRemove={onRemove}
    >
      <FieldGrid cols={2}>
        <SelectField
          path={at('involvement')}
          label="Involvement"
          required
          options={VEHICLE_INVOLVEMENT}
          value={vehicle.involvement}
          onChange={(v) => onChange({ involvement: v })}
        />
        {owners.length > 0 && (
          <SelectField
            path={at('ownerPersonId')}
            label="Registered owner"
            placeholder="Not specified"
            options={owners}
            value={vehicle.ownerPersonId}
            onChange={(v) => onChange({ ownerPersonId: v })}
          />
        )}
      </FieldGrid>

      <div className="mt-4">
        <FieldGrid cols={5}>
          <TextField
            path={at('year')}
            label="Year"
            type="number"
            value={vehicle.year}
            onChange={(v) => onChange({ year: v })}
          />
          <TextField path={at('make')} label="Make" value={vehicle.make} onChange={(v) => onChange({ make: v })} />
          <TextField path={at('model')} label="Model" value={vehicle.model} onChange={(v) => onChange({ model: v })} />
          <TextField path={at('style')} label="Body style" placeholder="4-door" value={vehicle.style} onChange={(v) => onChange({ style: v })} />
          <TextField path={at('color')} label="Color" value={vehicle.color} onChange={(v) => onChange({ color: v })} />
        </FieldGrid>
      </div>

      <div className="mt-4">
        <FieldGrid cols={4}>
          <TextField
            path={at('plate')}
            label="Plate"
            hint="A partial is still worth recording."
            value={vehicle.plate}
            onChange={(v) => onChange({ plate: v.toUpperCase() })}
            inputClassName="font-mono uppercase"
          />
          <SelectField
            path={at('plateState')}
            label="Plate state"
            options={STATES}
            value={vehicle.plateState}
            onChange={(v) => onChange({ plateState: v })}
          />
          <TextField
            path={at('plateYear')}
            label="Plate year"
            type="number"
            value={vehicle.plateYear}
            onChange={(v) => onChange({ plateYear: v })}
          />
          <TextField
            path={at('vin')}
            label="VIN"
            maxLength={17}
            hint="17 characters — never I, O or Q."
            value={vehicle.vin}
            onChange={(v) => onChange({ vin: v.toUpperCase() })}
            inputClassName="font-mono uppercase"
          />
        </FieldGrid>
      </div>

      {vehicle.involvement === 'towed' && (
        <div className="mt-4">
          <TextField
            path={at('towedTo')}
            label="Towed to"
            required
            placeholder="Halloran's Towing, 400 Depot St"
            hint="The first thing an owner asks the front desk."
            value={vehicle.towedTo}
            onChange={(v) => onChange({ towedTo: v })}
          />
        </div>
      )}

      <div className="mt-4">
        <TextareaField
          path={at('notes')}
          label="Notes"
          rows={2}
          value={vehicle.notes}
          onChange={(v) => onChange({ notes: v })}
        />
      </div>
    </RecordCard>
  );
}
