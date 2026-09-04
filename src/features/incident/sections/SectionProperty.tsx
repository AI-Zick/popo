import { Car, Package } from 'lucide-react';
import { useStore } from '@/state/store';
import { path, personDisplayName } from '@/validation/engine';
import { createProperty } from '@/domain/factory';
import type { PropertyItem } from '@/domain/types';
import { currency } from '@/lib/format';
import {
  AddButton,
  Badge,
  EmptyState,
  FieldGrid,
  RecordCard,
  SectionAnchor,
} from '@/components/ui/primitives';
import { SelectField, TextField, TextareaField } from '@/components/ui/fields';
import {
  BODY_STYLES,
  labelOf,
  DRUG_MEASUREMENTS,
  DRUG_TYPES,
  LOSS_TYPES,
  OFFENSE_BY_CODE,
  PROPERTY_DESCRIPTIONS,
} from '@/domain/codes';

export function SectionProperty() {
  const { incident, update } = useStore();
  if (!incident) return null;

  const setItem = (id: string, patch: Partial<PropertyItem>) =>
    update((d) => {
      const target = d.property.find((p) => p.id === id);
      if (target) Object.assign(target, patch);
    });

  const hasDrugOffense = incident.offenses.some((o) => OFFENSE_BY_CODE.get(o.code)?.isDrug);

  const total = incident.property
    .filter((p) => p.lossType === 'stolen')
    .reduce((sum, p) => sum + (Number(p.value.replace(/[^0-9.]/g, '')) || 0), 0);

  return (
    <SectionAnchor section="property">
      {incident.property.length === 0 ? (
        <EmptyState
          icon={<Package size={20} />}
          title="No property recorded"
          body="List anything taken, damaged, recovered or seized. If a burglar was interrupted and took nothing, add one record with loss type “None” — that is a real answer and closes the requirement."
          action={
            <AddButton
              label="Add a property record"
              onClick={() => update((d) => void d.property.push(createProperty()))}
            />
          }
        />
      ) : (
        <>
          {total > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-line bg-raised px-4 py-2.5">
              <span className="text-[13px] text-muted">Total value of stolen property</span>
              <span className="text-[15px] font-semibold text-ink tabular">{currency(total)}</span>
            </div>
          )}
          {incident.property.map((item, index) => (
            <PropertyCard
              key={item.id}
              item={item}
              index={index}
              forceDrugFields={hasDrugOffense}
              onChange={(patch) => setItem(item.id, patch)}
              onRemove={() => update((d) => void (d.property = d.property.filter((p) => p.id !== item.id)))}
            />
          ))}
          <AddButton
            label="Add another property record"
            onClick={() => update((d) => void d.property.push(createProperty()))}
          />
        </>
      )}
    </SectionAnchor>
  );
}

function PropertyCard({
  item,
  index,
  forceDrugFields,
  onChange,
  onRemove,
}: {
  item: PropertyItem;
  index: number;
  forceDrugFields: boolean;
  onChange: (patch: Partial<PropertyItem>) => void;
  onRemove: () => void;
}) {
  const { persons, incident, setSection } = useStore();
  const at = (field: keyof PropertyItem) => path.property(item.id, field);

  /*
    The car this line is about, where it is about a car.

    Shown rather than duplicated. The plate, the VIN, the colour and the body
    style are what a stolen-vehicle hit matches against, and they belong on the
    one vehicle record that goes to the state — a second copy here would be a
    second copy that drifts. What the officer needs is to see, from the
    property line, that the details exist and where.
  */
  const linked = incident?.vehicles.find((vehicle) => vehicle.id === item.vehicleId);

  const isDrugItem = item.descriptionCode === '10' || item.descriptionCode === '11';
  const showDrugFields = isDrugItem || (forceDrugFields && item.lossType === 'seized');

  const owners = persons.map((p) => ({ value: p.id, label: personDisplayName(p) }));

  const typeLabel = PROPERTY_DESCRIPTIONS.find((p) => p.value === item.descriptionCode)?.label;
  const lossLabel = LOSS_TYPES.find((l) => l.value === item.lossType)?.label;

  return (
    <RecordCard
      index={index}
      title={typeLabel ?? 'Property type not selected'}
      subtitle={[item.make, item.model].filter(Boolean).join(' ') || item.description || undefined}
      badge={
        <div className="flex items-center gap-1.5">
          {item.value && <Badge tone="neutral">{currency(item.value)}</Badge>}
          {lossLabel && (
            <Badge tone={item.lossType === 'stolen' ? 'danger' : item.lossType === 'recovered' ? 'ok' : 'warn'}>
              {lossLabel}
            </Badge>
          )}
        </div>
      }
      onRemove={onRemove}
    >
      {linked && (
        <button
          type="button"
          onClick={() => setSection('vehicles')}
          className="mb-3 flex w-full items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-left text-[12.5px] transition hover:border-accent/40"
        >
          <Car size={14} className="shrink-0 text-faint" aria-hidden />
          <span className="min-w-0 flex-1 text-ink">
            {[linked.year, linked.color, linked.make, linked.model, labelOf(BODY_STYLES, linked.style) || linked.style]
              .filter(Boolean)
              .join(' ') || 'Vehicle details not filled in yet'}
            {linked.plate && <span className="ml-1.5 font-mono text-muted">{linked.plate}</span>}
          </span>
          <span className="shrink-0 text-faint">Edit in Vehicles</span>
        </button>
      )}

      <FieldGrid cols={3}>
        <SelectField
          path={at('lossType')}
          label="Loss type"
          required
          options={LOSS_TYPES}
          value={item.lossType}
          onChange={(v) => onChange({ lossType: v as PropertyItem['lossType'] })}
        />
        <SelectField
          path={at('descriptionCode')}
          label="Property type"
          required
          showCodes
          options={PROPERTY_DESCRIPTIONS}
          value={item.descriptionCode}
          onChange={(v) => onChange({ descriptionCode: v })}
        />
        <TextField
          path={at('value')}
          label="Value (USD)"
          type="number"
          hint="Replacement value, not purchase price."
          value={item.value}
          onChange={(v) => onChange({ value: v })}
        />
      </FieldGrid>

      <div className="mt-4">
        <FieldGrid cols={4}>
          <TextField
            path={at('quantity')}
            label="Quantity"
            type="number"
            value={item.quantity}
            onChange={(v) => onChange({ quantity: v })}
          />
          <TextField
            path={at('make')}
            label="Make / brand"
            value={item.make}
            onChange={(v) => onChange({ make: v })}
          />
          <TextField
            path={at('model')}
            label="Model"
            value={item.model}
            onChange={(v) => onChange({ model: v })}
          />
          <TextField
            path={at('serialNumber')}
            label="Serial number"
            hint="What a pawn shop hit matches on."
            value={item.serialNumber}
            onChange={(v) => onChange({ serialNumber: v })}
          />
        </FieldGrid>
      </div>

      {item.lossType === 'recovered' && (
        <div className="mt-4 max-w-xs">
          <TextField
            path={at('dateRecovered')}
            label="Date recovered"
            type="date"
            required
            value={item.dateRecovered}
            onChange={(v) => onChange({ dateRecovered: v })}
          />
        </div>
      )}

      {showDrugFields && (
        <div className="mt-4 rounded-xl border border-accent/25 bg-accent-soft/40 p-4">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-accent">
            Narcotics detail
          </p>
          <FieldGrid cols={3}>
            <SelectField
              path={at('drugType')}
              label="Drug type"
              required
              options={DRUG_TYPES}
              value={item.drugType}
              onChange={(v) => onChange({ drugType: v })}
            />
            <TextField
              path={at('drugQuantity')}
              label="Quantity"
              type="number"
              value={item.drugQuantity}
              onChange={(v) => onChange({ drugQuantity: v })}
            />
            <SelectField
              path={at('drugMeasurement')}
              label="Unit"
              required
              options={DRUG_MEASUREMENTS}
              value={item.drugMeasurement}
              onChange={(v) => onChange({ drugMeasurement: v })}
            />
          </FieldGrid>
        </div>
      )}

      <div className="mt-4">
        <FieldGrid cols={owners.length > 0 ? 2 : 1}>
          <TextareaField
            path={at('description')}
            label="Description"
            rows={2}
            placeholder="Distinguishing marks, engravings, damage — anything that makes it identifiable."
            value={item.description}
            onChange={(v) => onChange({ description: v })}
          />
          {owners.length > 0 && (
            <SelectField
              path={at('ownerPersonId')}
              label="Owner"
              placeholder="Not specified"
              options={owners}
              value={item.ownerPersonId}
              onChange={(v) => onChange({ ownerPersonId: v })}
            />
          )}
        </FieldGrid>
      </div>
    </RecordCard>
  );
}
