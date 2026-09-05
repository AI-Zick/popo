import { Gavel, Info, TriangleAlert } from 'lucide-react';
import { useStore } from '@/state/store';
import { path } from '@/validation/engine';
import { createOffense } from '@/domain/factory';
import type { Offense } from '@/domain/types';
import { AddButton, Badge, EmptyState, FieldGrid, RecordCard, SectionAnchor } from '@/components/ui/primitives';
import { ComboField, MultiSelectField, SelectField, TextField } from '@/components/ui/fields';
import {
  BIAS_MOTIVATION,
  CRIMINAL_ACTIVITY,
  LOCATION_TYPES,
  METHOD_OF_ENTRY,
  OFFENSE_BY_CODE,
  OFFENSE_CODES,
  WEAPONS,
} from '@/domain/codes';
import {
  findStatute,
  isVerified,
  statuteLabel,
  statutesFor,
  UNVERIFIED_NOTICE,
} from '@/domain/statute';

const CATEGORY_TONE = {
  person: 'danger',
  property: 'warn',
  society: 'accent',
} as const;

const CATEGORY_LABEL = {
  person: 'Against a person',
  property: 'Against property',
  society: 'Against society',
} as const;

const OFFENSE_OPTIONS = OFFENSE_CODES.map((o) => ({
  value: o.code,
  label: o.label,
  group: o.group,
  meta: CATEGORY_LABEL[o.category],
}));

export function SectionOffenses() {
  const { incident, location, update } = useStore();
  if (!incident) return null;

  const setOffense = (id: string, patch: Partial<Offense>) =>
    update((d) => {
      const target = d.offenses.find((o) => o.id === id);
      if (target) Object.assign(target, patch);
    });

  const addOffense = () =>
    update((d) => {
      d.offenses.push(createOffense({ locationType: location?.locationType ?? '' }));
    });

  const removeOffense = (id: string) =>
    update((d) => {
      d.offenses = d.offenses.filter((o) => o.id !== id);
      // Detach the offense from everyone who referenced it.
      for (const person of d.persons) {
        person.offenseIds = person.offenseIds.filter((oid) => oid !== id);
      }
    });

  return (
    <SectionAnchor section="offenses">
      {incident.offenses.length === 0 ? (
        <EmptyState
          icon={<Gavel size={20} />}
          title="No offenses listed"
          body="Every report needs at least one offense. The offense you choose determines which fields the rest of this report will require — pick it first and the form adapts around it."
          action={<AddButton label="Add the first offense" onClick={addOffense} />}
        />
      ) : (
        <>
          {incident.offenses.map((offense, index) => (
            <OffenseCard
              key={offense.id}
              offense={offense}
              index={index}
              onChange={(patch) => setOffense(offense.id, patch)}
              onRemove={() => removeOffense(offense.id)}
            />
          ))}
          <AddButton label="Add another offense" onClick={addOffense} />
        </>
      )}
    </SectionAnchor>
  );
}

function OffenseCard({
  offense,
  index,
  onChange,
  onRemove,
}: {
  offense: Offense;
  index: number;
  onChange: (patch: Partial<Offense>) => void;
  onRemove: () => void;
}) {
  const def = OFFENSE_BY_CODE.get(offense.code);
  const at = (field: keyof Offense) => path.offense(offense.id, field);

  return (
    <RecordCard
      index={index}
      title={def ? def.label : 'Offense not yet selected'}
      subtitle={def ? `${def.code} · ${def.group}` : 'Pick an offense type to continue'}
      badge={def && <Badge tone={CATEGORY_TONE[def.category]}>{CATEGORY_LABEL[def.category]}</Badge>}
      onRemove={onRemove}
    >
      <FieldGrid cols={2}>
        <ComboField
          path={at('code')}
          label="Offense"
          required
          value={offense.code}
          onChange={(v) => onChange({ code: v })}
          options={OFFENSE_OPTIONS}
          placeholder="Search offenses…"
        />
        <StatuteField offense={offense} onChange={onChange} at={at} />
      </FieldGrid>

      {def && <RequirementNote def={def} />}

      <div className="mt-4">
        <FieldGrid cols={2}>
          <SelectField
            path={at('attemptCompleted')}
            label="Attempted or completed"
            required
            placeholder="Select…"
            options={[
              { value: 'C', label: 'Completed' },
              { value: 'A', label: 'Attempted' },
            ]}
            value={offense.attemptCompleted}
            onChange={(v) => onChange({ attemptCompleted: v as Offense['attemptCompleted'] })}
          />
          <SelectField
            path={at('locationType')}
            label="Location type"
            required
            showCodes
            options={LOCATION_TYPES}
            value={offense.locationType}
            onChange={(v) => onChange({ locationType: v })}
          />
        </FieldGrid>
      </div>

      {def?.isBurglary && (
        <div className="mt-4 rounded-xl border border-accent/25 bg-accent-soft/40 p-4">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-accent">
            Burglary detail
          </p>
          <FieldGrid cols={2}>
            <SelectField
              path={at('methodOfEntry')}
              label="Method of entry"
              required
              options={METHOD_OF_ENTRY}
              hint="Force covers pry marks, broken glass, punched locks."
              value={offense.methodOfEntry}
              onChange={(v) => onChange({ methodOfEntry: v })}
            />
            <TextField
              path={at('premisesEntered')}
              label="# of premises entered"
              type="number"
              min={0}
              hint="1 for a single home or unit. Higher only where one entry got into several — a block of lock-ups, a row of storage units."
              value={offense.premisesEntered}
              onChange={(v) => onChange({ premisesEntered: v })}
            />
          </FieldGrid>
        </div>
      )}

      {(def?.requiresWeapon || offense.weapons.length > 0) && (
        <div className="mt-4">
          <MultiSelectField
            path={at('weapons')}
            label="Weapon / force used"
            required={def?.requiresWeapon}
            columns={3}
            hint="Choose “Personal Weapons” for hands and feet — that is not the same as leaving this blank."
            options={WEAPONS}
            values={offense.weapons}
            onChange={(v) => onChange({ weapons: v })}
          />
        </div>
      )}

      {def?.requiresCriminalActivity && (
        <div className="mt-4">
          <MultiSelectField
            path={at('criminalActivity')}
            label="Criminal activity"
            required
            columns={2}
            hint="What the offender was doing with the contraband. More than one can apply."
            options={CRIMINAL_ACTIVITY}
            values={offense.criminalActivity}
            onChange={(v) => onChange({ criminalActivity: v })}
          />
        </div>
      )}

      <div className="mt-4">
        <SelectField
          path={at('biasMotivation')}
          label="Bias motivation"
          required
          options={BIAS_MOTIVATION}
          hint="“None” for the vast majority of reports."
          value={offense.biasMotivation}
          onChange={(v) => onChange({ biasMotivation: v })}
          className="max-w-md"
        />
      </div>
    </RecordCard>
  );
}

/** Tells the officer up front what this offense choice is about to require. */
/**
 * Picking the state cite a prosecutor will charge under.
 *
 * The offence narrows the list; it never chooses from it. Three degrees of
 * burglary come back and which one it is depends on whether anybody was home
 * and whether the person was armed — a legal judgement about what happened,
 * which is why each option carries the line that tells one degree from the
 * next rather than just its number.
 *
 * Free text is still allowed and always will be. A municipal noise ordinance
 * is a real charge and no state pack will ever contain it, so a cite the table
 * does not know is kept as typed — with a quiet note that it is not on the
 * list, which is how the table grows.
 */
function StatuteField({
  offense,
  onChange,
  at,
}: {
  offense: Offense;
  onChange: (patch: Partial<Offense>) => void;
  at: (field: keyof Offense) => string;
}) {
  const { agency } = useStore();
  const table = agency.statutes ?? [];
  const candidates = statutesFor(offense.code, table);
  const chosen = findStatute(offense.statute, table);

  const options = candidates.map((statute) => ({
    value: statute.cite,
    label: statuteLabel(statute),
    /* Searchable, and the reason each option is worth reading. */
    hint: [statute.grade, statute.distinguishes].filter(Boolean).join(' · '),
  }));

  return (
    <div className="min-w-0">
      <SelectField
        path={at('statute')}
        label="Statute cite"
        placeholder={
          offense.code
            ? candidates.length > 0
              ? 'Type or pick a statute…'
              : 'Type the cite'
            : 'Choose the offence first'
        }
        options={options}
        allowFree
        value={offense.statute}
        onChange={(v) => onChange({ statute: v })}
        hint={
          candidates.length > 0
            ? undefined
            : 'The charge a prosecutor will file under.'
        }
      />

      {chosen && (
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          <span className="font-medium text-ink">{chosen.grade}</span>
          {chosen.grade && chosen.distinguishes && ' — '}
          {chosen.distinguishes}
        </p>
      )}

      {/*
        Said at the moment the cite is offered, not filed away in a settings
        screen. The failure it prevents — a charge under a section renumbered
        two sessions ago — is invisible when it happens and expensive later.
      */}
      {chosen && !isVerified(chosen) && (
        <p className="mt-1 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-warn">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>{UNVERIFIED_NOTICE}</span>
        </p>
      )}

      {offense.statute.trim() && !chosen && table.length > 0 && (
        <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
          Not in the agency’s statute table — kept as you typed it. An
          administrator can add it so the next officer finds it.
        </p>
      )}
    </div>
  );
}

function RequirementNote({ def }: { def: NonNullable<ReturnType<typeof OFFENSE_BY_CODE.get>> }) {
  const requirements: string[] = [];
  if (def.requiresIndividualVictim) requirements.push('an individual victim with age, sex and race');
  if (def.requiresProperty) requirements.push('at least one property record');
  if (def.requiresPropertyValue) requirements.push('a dollar value on the property');
  if (def.requiresVehicle) requirements.push('a vehicle record with a plate or VIN');
  if (def.requiresWeapon) requirements.push('a weapon or force entry');
  if (def.isBurglary) requirements.push('method of entry');
  if (def.isDrug) requirements.push('drug type, quantity and unit');
  if (def.requiresCriminalActivity) requirements.push('a criminal activity type');
  if (def.requiresDamagedProperty) requirements.push('property marked burned or damaged');

  if (requirements.length === 0) return null;

  return (
    <div className="mt-3 flex gap-2 rounded-lg border border-line bg-raised px-3 py-2.5">
      <Info size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
      <p className="text-[12.5px] leading-relaxed text-muted">
        <span className="font-medium text-ink">{def.label}</span> also requires{' '}
        {requirements.slice(0, -1).join(', ')}
        {requirements.length > 1 ? ' and ' : ''}
        {requirements[requirements.length - 1]}.
      </p>
    </div>
  );
}
