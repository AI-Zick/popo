import { Users } from 'lucide-react';
import { useStore } from '@/state/store';
import { path } from '@/validation/engine';
import { personDisplayName } from '@/validation/engine';
import { createCharge, createPerson } from '@/domain/factory';
import type { Charge, Person, PersonRole } from '@/domain/types';
import { ageAt } from '@/lib/format';
import {
  AddButton,
  Badge,
  Button,
  EmptyState,
  FieldGrid,
  RecordCard,
  SectionAnchor,
} from '@/components/ui/primitives';
import {
  MultiSelectField,
  SelectField,
  TextField,
  TextareaField,
  ToggleField,
  useFieldIssues,
} from '@/components/ui/fields';
import {
  ARREST_TYPES,
  ETHNICITY_CODES,
  INJURY_TYPES,
  OFFENSE_BY_CODE,
  PERSON_ROLES,
  RACE_CODES,
  RELATIONSHIPS,
  SEX_CODES,
  STATES,
  VICTIM_TYPES,
  WEAPONS,
} from '@/domain/codes';
import { cn } from '@/lib/cn';

const ROLE_TONE: Record<PersonRole, 'danger' | 'warn' | 'accent' | 'neutral'> = {
  victim: 'danger',
  suspect: 'warn',
  arrestee: 'warn',
  witness: 'accent',
  complainant: 'accent',
  other: 'neutral',
};

export function SectionPersons() {
  const { incident, update } = useStore();
  if (!incident) return null;

  const setPerson = (id: string, patch: Partial<Person>) =>
    update((d) => {
      const target = d.persons.find((p) => p.id === id);
      if (target) Object.assign(target, patch);
    });

  const addPerson = (role: PersonRole) =>
    update((d) => {
      const person = createPerson(role);
      // A single-offense report has only one sensible answer, so pre-link it.
      if (d.offenses.length === 1) person.offenseIds = [d.offenses[0].id];
      d.persons.push(person);
    });

  const removePerson = (id: string) =>
    update((d) => {
      d.persons = d.persons.filter((p) => p.id !== id);
      for (const person of d.persons) {
        person.relationships = person.relationships.filter((r) => r.offenderId !== id);
      }
      for (const item of d.property) if (item.ownerPersonId === id) item.ownerPersonId = '';
      for (const v of d.vehicles) if (v.ownerPersonId === id) v.ownerPersonId = '';
    });

  return (
    <SectionAnchor section="persons">
      {incident.persons.length === 0 ? (
        <EmptyState
          icon={<Users size={20} />}
          title="Nobody on this report yet"
          body="Add everyone involved — victims, suspects, witnesses and anyone arrested. The fields each person needs depend on their role and on the offenses you listed."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => addPerson('victim')}>
                Add a victim
              </Button>
              <Button onClick={() => addPerson('suspect')}>Add a suspect</Button>
              <Button onClick={() => addPerson('witness')}>Add a witness</Button>
            </div>
          }
        />
      ) : (
        <>
          {incident.persons.map((person, index) => (
            <PersonCard
              key={person.id}
              person={person}
              index={index}
              onChange={(patch) => setPerson(person.id, patch)}
              onRemove={() => removePerson(person.id)}
            />
          ))}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(['victim', 'suspect', 'arrestee', 'witness'] as PersonRole[]).map((role) => (
              <AddButton
                key={role}
                label={`Add ${role}`}
                onClick={() => addPerson(role)}
              />
            ))}
          </div>
        </>
      )}
    </SectionAnchor>
  );
}

function PersonCard({
  person,
  index,
  onChange,
  onRemove,
}: {
  person: Person;
  index: number;
  onChange: (patch: Partial<Person>) => void;
  onRemove: () => void;
}) {
  const { incident } = useStore();
  const at = (field: keyof Person) => path.person(person.id, field);

  const isOrgVictim = person.role === 'victim' && person.victimType !== 'I' && person.victimType !== '';
  const isIndividualVictim = person.role === 'victim' && person.victimType === 'I';
  const isOffender = person.role === 'suspect' || person.role === 'arrestee';

  const reference = incident?.occurredFrom || incident?.reportedAt || '';
  const age = ageAt(person.dob, reference);

  const linkedOffenses = (incident?.offenses ?? []).filter(
    (o) => person.offenseIds.includes(o.id) || person.offenseIds.length === 0,
  );
  const collectsInjury = linkedOffenses.some((o) => OFFENSE_BY_CODE.get(o.code)?.collectsInjury);

  return (
    <RecordCard
      index={index}
      title={personDisplayName(person)}
      subtitle={
        [
          PERSON_ROLES.find((r) => r.value === person.role)?.label,
          age !== null ? `${age} yrs` : null,
        ]
          .filter(Boolean)
          .join(' · ') || undefined
      }
      badge={
        <div className="flex items-center gap-1.5">
          {age !== null && age < 18 && <Badge tone="warn">Juvenile</Badge>}
          <Badge tone={ROLE_TONE[person.role]}>
            {PERSON_ROLES.find((r) => r.value === person.role)?.label}
          </Badge>
        </div>
      }
      onRemove={onRemove}
    >
      <FieldGrid cols={isIndividualVictim || person.role === 'victim' ? 2 : 1}>
        <SelectField
          path={at('role')}
          label="Role"
          required
          placeholder="Select a role…"
          options={PERSON_ROLES}
          value={person.role}
          onChange={(v) => onChange({ role: v as PersonRole, victimType: v === 'victim' ? person.victimType || 'I' : '' })}
        />
        {person.role === 'victim' && (
          <SelectField
            path={at('victimType')}
            label="Victim type"
            required
            options={VICTIM_TYPES}
            hint="Individual means a natural person. A business cannot be assaulted."
            value={person.victimType}
            onChange={(v) => onChange({ victimType: v as Person['victimType'] })}
          />
        )}
      </FieldGrid>

      <OffenseLinks person={person} onChange={onChange} />

      {/* ---- Identity --------------------------------------------------- */}
      <div className="mt-4 border-t border-line pt-4">
        {isOrgVictim ? (
          <TextField
            path={at('businessName')}
            label="Business / organization name"
            required
            placeholder="Riverside Mini Mart"
            value={person.businessName}
            onChange={(v) => onChange({ businessName: v })}
          />
        ) : (
          <>
            {!isIndividualVictim && (
              <div className="mb-4">
                <ToggleField
                  path={at('isUnknown')}
                  label="Identity unknown"
                  description="Use this instead of leaving the name blank — it tells records this was a dead end, not an oversight."
                  checked={person.isUnknown}
                  onChange={(v) => onChange({ isUnknown: v })}
                />
              </div>
            )}
            <FieldGrid cols={4}>
              <TextField
                path={at('lastName')}
                label="Last name"
                required={!person.isUnknown}
                value={person.lastName}
                onChange={(v) => onChange({ lastName: v })}
              />
              <TextField
                path={at('firstName')}
                label="First name"
                value={person.firstName}
                onChange={(v) => onChange({ firstName: v })}
              />
              <TextField
                path={at('middleName')}
                label="Middle"
                value={person.middleName}
                onChange={(v) => onChange({ middleName: v })}
              />
              <TextField
                path={at('suffix')}
                label="Suffix"
                placeholder="Jr."
                value={person.suffix}
                onChange={(v) => onChange({ suffix: v })}
              />
            </FieldGrid>

            <div className="mt-4">
              <FieldGrid cols={4}>
                <TextField
                  path={at('dob')}
                  label="Date of birth"
                  type="date"
                  required={isIndividualVictim}
                  value={person.dob}
                  onChange={(v) => onChange({ dob: v })}
                />
                <SelectField
                  path={at('sex')}
                  label="Sex"
                  required={isIndividualVictim}
                  options={SEX_CODES}
                  value={person.sex}
                  onChange={(v) => onChange({ sex: v })}
                />
                <SelectField
                  path={at('race')}
                  label="Race"
                  required={isIndividualVictim}
                  options={RACE_CODES}
                  value={person.race}
                  onChange={(v) => onChange({ race: v })}
                />
                <SelectField
                  path={at('ethnicity')}
                  label="Ethnicity"
                  options={ETHNICITY_CODES}
                  value={person.ethnicity}
                  onChange={(v) => onChange({ ethnicity: v })}
                />
              </FieldGrid>
            </div>

            {!person.dob && (
              <div className="mt-4 grid grid-cols-4 gap-4">
                <TextField
                  path={at('ageFrom')}
                  label="Estimated age from"
                  type="number"
                  hint="Use this when the exact date of birth is unknown."
                  value={person.ageFrom}
                  onChange={(v) => onChange({ ageFrom: v })}
                />
                <TextField
                  path={at('ageTo')}
                  label="to"
                  type="number"
                  value={person.ageTo}
                  onChange={(v) => onChange({ ageTo: v })}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* ---- Contact ---------------------------------------------------- */}
      {!person.isUnknown && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="grid grid-cols-4 gap-4">
            <TextField
              className="col-span-2"
              path={at('address')}
              label="Address"
              value={person.address}
              onChange={(v) => onChange({ address: v })}
            />
            <TextField
              path={at('city')}
              label="City"
              value={person.city}
              onChange={(v) => onChange({ city: v })}
            />
            <SelectField
              path={at('state')}
              label="State"
              options={STATES}
              value={person.state}
              onChange={(v) => onChange({ state: v })}
            />
            <TextField
              path={at('phone')}
              label="Phone"
              type="tel"
              value={person.phone}
              onChange={(v) => onChange({ phone: v })}
            />
            <TextField
              className="col-span-2"
              path={at('email')}
              label="Email"
              type="email"
              value={person.email}
              onChange={(v) => onChange({ email: v })}
            />
          </div>
        </div>
      )}

      {/* ---- Victim detail ---------------------------------------------- */}
      {isIndividualVictim && collectsInjury && (
        <div className="mt-4 border-t border-line pt-4">
          <MultiSelectField
            path={at('injuries')}
            label="Injuries"
            required
            columns={3}
            hint="Pick “None” if the victim was not hurt. Blank is not the same answer."
            options={INJURY_TYPES}
            values={person.injuries}
            onChange={(v) => onChange({ injuries: v })}
          />
        </div>
      )}

      {isIndividualVictim && <RelationshipEditor victim={person} onChange={onChange} />}

      {/* ---- Suspect detail --------------------------------------------- */}
      {isOffender && (
        <div className="mt-4 border-t border-line pt-4 space-y-4">
          <MultiSelectField
            path={at('armedWith')}
            label="Armed with"
            columns={3}
            options={WEAPONS}
            values={person.armedWith}
            onChange={(v) => onChange({ armedWith: v })}
          />
          <TextareaField
            path={at('description')}
            label="Physical description"
            rows={3}
            placeholder="Height, build, clothing, tattoos, accent, direction of travel…"
            hint="Partial detail still links cases. Write what the witness actually said."
            value={person.description}
            onChange={(v) => onChange({ description: v })}
          />
        </div>
      )}

      {/* ---- Arrest detail ---------------------------------------------- */}
      {person.role === 'arrestee' && (
        <div className="mt-4 rounded-xl border border-warn/25 bg-warn-soft/30 p-4">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-warn">Arrest</p>
          <FieldGrid cols={2}>
            <TextField
              path={at('arrestDate')}
              label="Arrest date"
              type="date"
              required
              value={person.arrestDate}
              onChange={(v) => onChange({ arrestDate: v })}
            />
            <SelectField
              path={at('arrestType')}
              label="Arrest type"
              required
              options={ARREST_TYPES}
              value={person.arrestType}
              onChange={(v) => onChange({ arrestType: v })}
            />
          </FieldGrid>
          <ChargeEditor person={person} onChange={onChange} />
        </div>
      )}

      <div className="mt-4 border-t border-line pt-4">
        <TextareaField
          path={at('notes')}
          label="Notes"
          rows={2}
          value={person.notes}
          onChange={(v) => onChange({ notes: v })}
        />
      </div>
    </RecordCard>
  );
}

/* ------------------------------------------------------------------ */

function OffenseLinks({ person, onChange }: { person: Person; onChange: (p: Partial<Person>) => void }) {
  const { incident, registerField, revealField } = useStore();
  const fieldPath = path.person(person.id, 'offenseIds');
  const { visible } = useFieldIssues(fieldPath);
  const offenses = incident?.offenses ?? [];

  if (offenses.length === 0) return null;

  const toggle = (id: string) => {
    revealField(fieldPath);
    onChange({
      offenseIds: person.offenseIds.includes(id)
        ? person.offenseIds.filter((o) => o !== id)
        : [...person.offenseIds, id],
    });
  };

  return (
    <div ref={(el) => registerField(fieldPath, el)} data-field-path={fieldPath} className="mt-4">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-ink">
          Involved in which offenses <span className="text-danger">*</span>
        </span>
        {offenses.length > 1 && (
          <button
            type="button"
            onClick={() => {
              revealField(fieldPath);
              onChange({ offenseIds: offenses.map((o) => o.id) });
            }}
            className="text-[12px] font-medium text-accent hover:underline"
          >
            Select all
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {offenses.map((o, i) => {
          const active = person.offenseIds.includes(o.id);
          const def = OFFENSE_BY_CODE.get(o.code);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => toggle(o.id)}
              aria-pressed={active}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-[12.5px] transition',
                active
                  ? 'border-accent/50 bg-accent-soft font-medium text-ink'
                  : 'border-line bg-surface text-muted hover:bg-raised',
              )}
            >
              <span className="font-mono text-[11.5px] opacity-70">{i + 1}</span>
              <span className="mx-1.5 opacity-40">·</span>
              {def?.label ?? 'Unspecified offense'}
            </button>
          );
        })}
      </div>
      {visible.map((issue) => (
        <InlineIssue key={issue.key} issueKey={issue.key} />
      ))}
    </div>
  );
}

/** Renders one already-computed issue by key, reusing the shared note styling. */
function InlineIssue({ issueKey }: { issueKey: string }) {
  const { validation, applyQuickFix } = useStore();
  const issue = validation.issues.find((i) => i.key === issueKey);
  if (!issue) return null;
  const isError = issue.severity === 'error';
  return (
    <div
      className={cn(
        'mt-1.5 rounded-lg border px-2.5 py-2 text-[13px] leading-relaxed',
        isError ? 'border-danger/35 bg-danger-soft text-danger' : 'border-warn/35 bg-warn-soft text-warn',
      )}
    >
      <p className="font-medium">{issue.message}</p>
      {issue.tip && <p className="mt-1 text-ink/75">{issue.tip}</p>}
      {issue.quickFix && (
        <Button size="sm" className="mt-2" onClick={() => applyQuickFix(issue)}>
          {issue.quickFix.label}
        </Button>
      )}
    </div>
  );
}

function RelationshipEditor({
  victim,
  onChange,
}: {
  victim: Person;
  onChange: (p: Partial<Person>) => void;
}) {
  const { incident, registerField } = useStore();
  const fieldPath = path.person(victim.id, 'relationships');
  const { visible } = useFieldIssues(fieldPath);

  const offenders = (incident?.persons ?? []).filter(
    (p) => p.role === 'suspect' || p.role === 'arrestee',
  );
  if (offenders.length === 0) return null;

  const setRelationship = (offenderId: string, relationship: string) => {
    const next = victim.relationships.filter((r) => r.offenderId !== offenderId);
    if (relationship) next.push({ offenderId, relationship });
    onChange({ relationships: next });
  };

  return (
    <div
      ref={(el) => registerField(fieldPath, el)}
      data-field-path={fieldPath}
      className="mt-4 border-t border-line pt-4"
    >
      <p className="mb-1.5 text-[13px] font-medium text-ink">
        Relationship to offender <span className="text-danger">*</span>
      </p>
      <p className="mb-3 text-[12px] text-faint">
        Required on crimes against a person. This is the field that drives the domestic violence
        enhancement.
      </p>
      <div className="space-y-2">
        {offenders.map((offender) => {
          const current = victim.relationships.find((r) => r.offenderId === offender.id);
          return (
            <div key={offender.id} className="flex items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                {personDisplayName(offender)}
              </span>
              <select
                value={current?.relationship ?? ''}
                onChange={(e) => setRelationship(offender.id, e.target.value)}
                className="w-64 shrink-0 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink"
                aria-label={`Relationship to ${personDisplayName(offender)}`}
              >
                <option value="">Select relationship…</option>
                {RELATIONSHIPS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      {visible.map((issue) => (
        <InlineIssue key={issue.key} issueKey={issue.key} />
      ))}
    </div>
  );
}

function ChargeEditor({ person, onChange }: { person: Person; onChange: (p: Partial<Person>) => void }) {
  const { registerField } = useStore();
  const fieldPath = path.person(person.id, 'charges');
  const { visible } = useFieldIssues(fieldPath);

  const setCharge = (id: string, patch: Partial<Charge>) =>
    onChange({
      charges: person.charges.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });

  return (
    <div ref={(el) => registerField(fieldPath, el)} data-field-path={fieldPath} className="mt-4">
      <p className="mb-2 text-[13px] font-medium text-ink">
        Charges <span className="text-danger">*</span>
      </p>
      <div className="space-y-2">
        {person.charges.map((charge, i) => (
          <div key={charge.id} className="flex items-end gap-2 rounded-lg border border-line bg-surface p-2.5">
            <span className="pb-2 text-[12px] text-faint tabular">{i + 1}</span>
            <label className="flex-1">
              <span className="mb-1 block text-[11.5px] text-muted">Statute</span>
              <input
                value={charge.statute}
                onChange={(e) => setCharge(charge.id, { statute: e.target.value })}
                placeholder="32-5A-191"
                className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[13px]"
              />
            </label>
            <label className="flex-[2]">
              <span className="mb-1 block text-[11.5px] text-muted">Description</span>
              <input
                value={charge.description}
                onChange={(e) => setCharge(charge.id, { description: e.target.value })}
                placeholder="DUI — Alcohol"
                className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[13px]"
              />
            </label>
            <label className="w-16">
              <span className="mb-1 block text-[11.5px] text-muted">Counts</span>
              <input
                value={charge.counts}
                onChange={(e) => setCharge(charge.id, { counts: e.target.value })}
                className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] tabular"
              />
            </label>
            <Button
              variant="danger"
              size="sm"
              onClick={() => onChange({ charges: person.charges.filter((c) => c.id !== charge.id) })}
              aria-label="Remove charge"
            >
              ✕
            </Button>
          </div>
        ))}
      </div>
      <Button
        size="sm"
        className="mt-2"
        onClick={() => onChange({ charges: [...person.charges, createCharge()] })}
      >
        Add charge
      </Button>
      {visible.map((issue) => (
        <InlineIssue key={issue.key} issueKey={issue.key} />
      ))}
    </div>
  );
}
