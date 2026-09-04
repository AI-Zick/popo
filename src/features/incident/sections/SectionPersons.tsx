import { useState, type ReactNode } from 'react';
import { ArrowRight, CalendarCheck, CalendarClock, Gavel, History, ShieldAlert, Users } from 'lucide-react';
import { useStore } from '@/state/store';
import { path } from '@/validation/engine';
import { createCharge } from '@/domain/factory';
import {
  displayName,
  SOURCE_LABEL,
  type Charge,
  type MasterPerson,
  type Person,
  type PersonRole,
  type ProvenancedField,
} from '@/domain/person';
import { STATUS_LABEL } from '@/domain/review';
import { describeCharges } from '@/domain/arrest';
import { ageAt, formatDate } from '@/lib/format';
import { freshness } from '@/domain/freshness';
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
import { AddExistingPersonButton } from '@/components/person/PersonPicker';
import { PersonPhotos } from '@/components/person/PersonPhotos';
import { AutoLinkNotice, DuplicateCandidates } from '@/components/person/DuplicateCandidates';
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

/**
 * The roles a report is read by, in the order they matter.
 *
 * Victims first: they are who the offence happened to, and on most reports
 * they are also who the required fields are about.
 */
const ROLE_TABS: PersonRole[] = ['victim', 'suspect', 'arrestee', 'witness', 'complainant', 'other'];

const ROLE_TAB_LABEL: Record<PersonRole, string> = {
  victim: 'Victims',
  suspect: 'Suspects',
  arrestee: 'Arrestees',
  witness: 'Witnesses',
  complainant: 'Reported by',
  other: 'Others',
};

export function SectionPersons() {
  const { incident, persons, addNewPerson, validation } = useStore();
  const [tab, setTab] = useState<PersonRole | 'all'>('all');
  if (!incident) return null;

  const byRole = (role: PersonRole) => persons.filter((person) => person.role === role);
  const shown = tab === 'all' ? persons : byRole(tab);

  /*
    Problems, counted per role, so a tab that is hiding a blocking error says
    so. Splitting a list into tabs is only safe if nothing can hide behind one
    — an officer who cannot see the victim's missing date of birth because
    they are on the Witnesses tab is worse off than before.
  */
  const errorsIn = (role: PersonRole) =>
    byRole(role).reduce(
      (count, person) =>
        count +
        validation.errors.filter((issue) => issue.path.startsWith(`persons[${person.id}]`)).length,
      0,
    );

  return (
    <SectionAnchor section="persons">
      <AutoLinkNotice />

      {/*
        Roles as tabs, because "who was the victim" and "who was the suspect"
        are different questions asked at different moments, and a flat list of
        nine people answers neither quickly. "Everyone" stays first and stays
        the default: on a two-person report the tabs are overhead, and this is
        a two-person report most of the time.
      */}
      {persons.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <RoleTab active={tab === 'all'} onClick={() => setTab('all')} count={persons.length}>
            Everyone
          </RoleTab>
          {ROLE_TABS.filter((role) => byRole(role).length > 0).map((role) => (
            <RoleTab
              key={role}
              active={tab === role}
              onClick={() => setTab(role)}
              count={byRole(role).length}
              errors={errorsIn(role)}
            >
              {ROLE_TAB_LABEL[role]}
            </RoleTab>
          ))}
        </div>
      )}

      {persons.length === 0 ? (
        <EmptyState
          icon={<Users size={20} />}
          title="Nobody on this report yet"
          body="Add everyone involved. Anyone you enter joins the agency index, so the next officer who needs them can pull them up instead of retyping — and if they are already on file, this will spot it."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => addNewPerson('victim')}>
                Add a victim
              </Button>
              <Button onClick={() => addNewPerson('suspect')}>Add a suspect</Button>
              <AddExistingPersonButton />
            </div>
          }
        />
      ) : (
        <>
          {shown.map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              /* Numbered by their place on the report, not on the tab — the
                 validation messages say "Victim 2" and mean the whole report. */
              index={persons.indexOf(person)}
            />
          ))}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(['victim', 'suspect', 'arrestee', 'witness'] as PersonRole[]).map((role) => (
              <AddButton key={role} label={`Add ${role}`} onClick={() => addNewPerson(role)} />
            ))}
            <div className="flex items-center justify-center">
              <AddExistingPersonButton />
            </div>
          </div>
        </>
      )}
    </SectionAnchor>
  );
}

function RoleTab({
  active,
  onClick,
  count,
  errors = 0,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  errors?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition',
        active ? 'bg-surface text-ink ring-1 ring-line' : 'text-muted hover:bg-surface/60',
      )}
    >
      {children}
      <span className="text-[11.5px] text-faint tabular">{count}</span>
      {errors > 0 && (
        <span
          className="flex size-4 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white tabular"
          aria-label={`${errors} to fix`}
        >
          {errors}
        </span>
      )}
    </button>
  );
}

function PersonCard({ person, index }: { person: Person; index: number }) {
  const { incident, updateInvolvement, updateIdentity, removePerson, historyFor } = useStore();
  const at = (field: string) => `persons[${person.id}].${field}`;

  const setLink = (patch: Parameters<typeof updateInvolvement>[1]) =>
    updateInvolvement(person.id, patch);
  const setIdentity = (patch: Partial<MasterPerson>) => updateIdentity(person.masterId, patch);

  const isOrgVictim = person.role === 'victim' && person.victimType !== 'I' && person.victimType !== '';
  const isIndividualVictim = person.role === 'victim' && person.victimType === 'I';
  const isOffender = person.role === 'suspect' || person.role === 'arrestee';

  const reference = incident?.occurredFrom || incident?.reportedAt || '';
  const age = ageAt(person.dob, reference);

  const linkedOffenses = (incident?.offenses ?? []).filter(
    (o) => person.offenseIds.includes(o.id) || person.offenseIds.length === 0,
  );
  const collectsInjury = linkedOffenses.some((o) => OFFENSE_BY_CODE.get(o.code)?.collectsInjury);

  // Other reports this identity appears on — the payoff of a shared index.
  const priors = historyFor(person.masterId).filter((h) => h.incident.id !== incident?.id);

  return (
    <RecordCard
      index={index}
      title={displayName(person)}
      subtitle={
        [PERSON_ROLES.find((r) => r.value === person.role)?.label, age !== null ? `${age} yrs` : null]
          .filter(Boolean)
          .join(' · ') || undefined
      }
      badge={
        <div className="flex items-center gap-1.5">
          {person.cautions.map((c) => (
            <Badge key={c} tone="danger">
              <ShieldAlert size={11} aria-hidden />
              {c}
            </Badge>
          ))}
          {age !== null && age < 18 && <Badge tone="warn">Juvenile</Badge>}
          <Badge tone={ROLE_TONE[person.role]}>
            {PERSON_ROLES.find((r) => r.value === person.role)?.label}
          </Badge>
        </div>
      }
      onRemove={() => removePerson(person.id)}
    >
      {priors.length > 0 && <PriorCases priors={priors} />}

      <FieldGrid cols={person.role === 'victim' ? 2 : 1}>
        <SelectField
          path={at('role')}
          label="Role on this report"
          required
          placeholder="Select a role…"
          options={PERSON_ROLES}
          value={person.role}
          onChange={(v) =>
            setLink({
              role: v as PersonRole,
              victimType: v === 'victim' ? person.victimType || 'I' : '',
            })
          }
        />
        {person.role === 'victim' && (
          <SelectField
            path={at('victimType')}
            label="Victim type"
            required
            options={VICTIM_TYPES}
            hint="Individual means a natural person. A business cannot be assaulted."
            value={person.victimType}
            onChange={(v) => setLink({ victimType: v as Person['victimType'] })}
          />
        )}
      </FieldGrid>

      <OffenseLinks person={person} onChange={setLink} />

      {/* ---- Identity — shared across every report ---------------------- */}
      <div className="mt-4 border-t border-line pt-4">
        <p className="mb-3 text-[11.5px] uppercase tracking-wider text-faint">
          Identity · shared with every report this person appears on
        </p>

        {isOrgVictim ? (
          <TextField
            path={at('businessName')}
            label="Business / organization name"
            required
            placeholder="Riverside Mini Mart"
            value={person.businessName}
            onChange={(v) => setIdentity({ businessName: v })}
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
                  onChange={(v) => setLink({ isUnknown: v })}
                />
              </div>
            )}
            <FieldGrid cols={4}>
              <TextField
                path={at('lastName')}
                label="Last name"
                required={!person.isUnknown}
                value={person.lastName}
                onChange={(v) => setIdentity({ lastName: v })}
              />
              <TextField
                path={at('firstName')}
                label="First name"
                value={person.firstName}
                onChange={(v) => setIdentity({ firstName: v })}
              />
              <TextField
                path={at('middleName')}
                label="Middle"
                value={person.middleName}
                onChange={(v) => setIdentity({ middleName: v })}
              />
              <TextField
                path={at('suffix')}
                label="Suffix"
                placeholder="Jr."
                hint="Distinguishes a father from a son."
                value={person.suffix}
                onChange={(v) => setIdentity({ suffix: v })}
              />
            </FieldGrid>

            <div className="mt-4">
              <FieldGrid cols={4}>
                <ProvenancedText
                  person={person}
                  field="dob"
                  label="Date of birth"
                  type="date"
                  required={isIndividualVictim}
                  onChange={(v) => setIdentity({ dob: v })}
                />
                <SelectField
                  path={at('sex')}
                  label="Sex"
                  required={isIndividualVictim}
                  options={SEX_CODES}
                  value={person.sex}
                  onChange={(v) => setIdentity({ sex: v })}
                />
                <SelectField
                  path={at('race')}
                  label="Race"
                  required={isIndividualVictim}
                  options={RACE_CODES}
                  value={person.race}
                  onChange={(v) => setIdentity({ race: v })}
                />
                <SelectField
                  path={at('ethnicity')}
                  label="Ethnicity"
                  options={ETHNICITY_CODES}
                  value={person.ethnicity}
                  onChange={(v) => setIdentity({ ethnicity: v })}
                />
              </FieldGrid>
            </div>

            {/* Strong identifiers are what make de-duplication safe. */}
            <div className="mt-4">
              <FieldGrid cols={4}>
                <TextField
                  path={at('driverLicense')}
                  label="Driver licence #"
                  hint="Unique per state — the surest way to match a record."
                  value={person.driverLicense}
                  onChange={(v) => setIdentity({ driverLicense: v.toUpperCase() })}
                  inputClassName="font-mono uppercase"
                />
                <SelectField
                  path={at('driverLicenseState')}
                  label="Licence state"
                  options={STATES}
                  value={person.driverLicenseState}
                  onChange={(v) => setIdentity({ driverLicenseState: v })}
                />
                <TextField
                  path={at('ssn')}
                  label="SSN"
                  placeholder="000-00-0000"
                  value={person.ssn}
                  onChange={(v) => setIdentity({ ssn: v })}
                  inputClassName="font-mono"
                />
                <TextField
                  path={at('stateId')}
                  label="State ID"
                  value={person.stateId}
                  onChange={(v) => setIdentity({ stateId: v.toUpperCase() })}
                  inputClassName="font-mono uppercase"
                />
              </FieldGrid>
            </div>
          </>
        )}

        <DuplicateCandidates incidentPersonId={person.id} />
      </div>

      {/* ---- Contact ---------------------------------------------------- */}
      {!person.isUnknown && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="grid grid-cols-4 gap-4">
            <ProvenancedText
              className="col-span-2"
              person={person}
              field="address"
              label="Address"
              onChange={(v) => setIdentity({ address: v })}
            />
            <TextField
              path={at('city')}
              label="City"
              value={person.city}
              onChange={(v) => setIdentity({ city: v })}
            />
            <SelectField
              path={at('state')}
              label="State"
              options={STATES}
              value={person.state}
              onChange={(v) => setIdentity({ state: v })}
            />
            <ProvenancedText
              person={person}
              field="phone"
              label="Phone"
              type="tel"
              onChange={(v) => setIdentity({ phone: v })}
            />
            <TextField
              className="col-span-2"
              path={at('email')}
              label="Email"
              type="email"
              value={person.email}
              onChange={(v) => setIdentity({ email: v })}
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
            onChange={(v) => setLink({ injuries: v })}
          />
        </div>
      )}

      {isIndividualVictim && <RelationshipEditor victim={person} onChange={setLink} />}

      {/* ---- Suspect detail --------------------------------------------- */}
      {isOffender && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          <MultiSelectField
            path={at('armedWith')}
            label="Armed with"
            columns={3}
            options={WEAPONS}
            values={person.armedWith}
            onChange={(v) => setLink({ armedWith: v })}
          />
          <TextareaField
            path={at('description')}
            label="Description at the time"
            rows={3}
            placeholder="Clothing, demeanour, direction of travel…"
            hint="What they looked like that day, not their permanent description."
            value={person.description}
            onChange={(v) => setLink({ description: v })}
          />
        </div>
      )}

      {/*
        Photographs live on the identity, not the report — a face outlives the
        case it was taken on, and the officer who needs it next is on a
        different one.
      */}
      {!person.isUnknown && !isOrgVictim && (
        <PersonPhotos masterId={person.masterId} personName={displayName(person)} />
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
              onChange={(v) => setLink({ arrestDate: v })}
            />
            <SelectField
              path={at('arrestType')}
              label="Arrest type"
              required
              options={ARREST_TYPES}
              value={person.arrestType}
              onChange={(v) => setLink({ arrestType: v })}
            />
          </FieldGrid>
          <ChargeEditor person={person} onChange={setLink} />
          <ArrestDocumentLink person={person} />
        </div>
      )}

      <div className="mt-4 border-t border-line pt-4">
        <TextareaField
          path={at('notes')}
          label="Notes"
          rows={2}
          value={person.notes}
          onChange={(v) => setLink({ notes: v })}
        />
      </div>
    </RecordCard>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The bridge between the arrest on the report and the arrest document.
 *
 * The fields above are the NIBRS view — what the state submission counts. The
 * document is the rest of it: probable cause, booking, bond, and the court
 * outcome that arrives two years later. Approving the document writes the
 * arrestee back onto these fields, so the two never drift.
 */
function ArrestDocumentLink({ person }: { person: Person }) {
  const { incident, arrestsForCase, openArrest, startArrest } = useStore();
  if (!incident) return null;

  const existing = arrestsForCase(incident.id).find((a) => a.masterId === person.masterId);

  if (!existing) {
    return (
      <div className="mt-4 flex items-center gap-3 border-t border-warn/25 pt-3">
        <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-muted">
          The full arrest — probable cause, booking, bond and what the court does with it — is its
          own document.
        </p>
        <Button
          onClick={() => void startArrest({ caseId: incident.id, masterId: person.masterId })}
        >
          <Gavel size={15} aria-hidden />
          Write the arrest
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => openArrest(existing.id)}
      className="mt-4 flex w-full items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-left transition hover:border-line-strong"
    >
      <Gavel size={15} className="shrink-0 text-faint" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-mono text-[13px] font-semibold text-ink">
            {existing.arrestNumber}
          </span>
          <Badge tone={existing.status === 'approved' ? 'ok' : 'neutral'}>
            {STATUS_LABEL[existing.status]}
          </Badge>
        </span>
        <span className="mt-0.5 block truncate text-[12.5px] text-muted">
          {describeCharges(existing)}
        </span>
      </span>
      <ArrowRight size={15} className="shrink-0 text-faint" aria-hidden />
    </button>
  );
}

/* ------------------------------------------------------------------ */

/**
 * A text field that says where its value came from and how old it is.
 *
 * The age is the part officers actually need. An address is not a fact, it is a
 * fact as at a date: a warrant served at a four-year-old address is served on
 * whoever lives there now, and a next-of-kin call to a dead number is a
 * notification that does not happen. The date was already being stamped on
 * every edit — it just was not being shown, which made it worth nothing.
 *
 * "Still current" re-stamps without retyping, because the common case is an
 * officer looking at an old value, confirming it with the person in front of
 * them, and having nothing to change.
 */
function ProvenancedText({
  person,
  field,
  label,
  type,
  required,
  className,
  onChange,
}: {
  person: Person;
  field: ProvenancedField;
  label: string;
  type?: 'text' | 'date' | 'tel';
  required?: boolean;
  className?: string;
  onChange: (value: string) => void;
}) {
  const { updateIdentity } = useStore();
  const record = person.provenance?.[field];
  const external = record && record.source !== 'officer';
  const value = String(person[field] ?? '');

  // A date of birth does not go stale, and neither does an empty field.
  const tracksAge = field !== 'dob' && value.trim() !== '';
  const age = tracksAge ? freshness(record?.at) : null;

  const confirm = () =>
    updateIdentity(person.masterId, { [field]: person[field] } as Partial<MasterPerson>);

  return (
    <div className={className}>
      <TextField
        path={`persons[${person.id}].${field}`}
        label={label}
        type={type}
        required={required}
        value={value}
        onChange={onChange}
      />

      {(external || age) && (
        <div
          className={cn(
            'mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-1.5',
            age?.worthChecking ? 'bg-warn-soft' : 'bg-raised',
          )}
        >
          {age && (
            <span
              className={cn(
                'flex items-center gap-1 text-[11.5px]',
                age.worthChecking ? 'font-medium text-ink' : 'text-muted',
              )}
            >
              {age.worthChecking ? (
                <CalendarClock size={11} className="text-warn" aria-hidden />
              ) : (
                <CalendarCheck size={11} className="text-faint" aria-hidden />
              )}
              {age.label}
            </span>
          )}

          {external && (
            <span className="text-[11.5px] text-muted">
              · {SOURCE_LABEL[record.source]}
              {record.verified ? ' · confirmed' : ' · not confirmed with this person'}
            </span>
          )}

          {/*
            Offered whenever the value is worth a second look, or came from
            somewhere other than an officer and has not been confirmed.
          */}
          {(age?.worthChecking || (external && !record.verified)) && (
            <button
              type="button"
              onClick={confirm}
              className="ml-auto text-[11.5px] font-medium text-accent hover:underline"
            >
              {external && !record.verified ? 'I confirmed this' : 'Still current'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PriorCases({
  priors,
}: {
  priors: { incident: { id: string; caseNumber: string; reportedAt: string }; role: PersonRole }[];
}) {
  const { openIncident } = useStore();
  return (
    <div className="mb-4 rounded-lg border border-line bg-raised px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
        <History size={13} className="text-muted" aria-hidden />
        Known to the agency — {priors.length} other {priors.length === 1 ? 'report' : 'reports'}
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {priors.slice(0, 6).map((prior) => (
          <li key={prior.incident.id}>
            <button
              type="button"
              onClick={() => openIncident(prior.incident.id)}
              className="rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11.5px] text-muted transition hover:border-accent hover:text-accent"
              title={`${PERSON_ROLES.find((r) => r.value === prior.role)?.label} · ${formatDate(prior.incident.reportedAt)}`}
            >
              {prior.incident.caseNumber}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OffenseLinks({
  person,
  onChange,
}: {
  person: Person;
  onChange: (patch: { offenseIds: string[] }) => void;
}) {
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
  onChange: (patch: { relationships: Person['relationships'] }) => void;
}) {
  const { persons, registerField } = useStore();
  const fieldPath = path.person(victim.id, 'relationships');
  const { visible } = useFieldIssues(fieldPath);

  const offenders = persons.filter((p) => p.role === 'suspect' || p.role === 'arrestee');
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
            <div
              key={offender.id}
              className="flex items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                {displayName(offender)}
              </span>
              <select
                value={current?.relationship ?? ''}
                onChange={(e) => setRelationship(offender.id, e.target.value)}
                className="w-64 shrink-0 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink"
                aria-label={`Relationship to ${displayName(offender)}`}
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

function ChargeEditor({
  person,
  onChange,
}: {
  person: Person;
  onChange: (patch: { charges: Charge[] }) => void;
}) {
  const { registerField } = useStore();
  const fieldPath = path.person(person.id, 'charges');
  const { visible } = useFieldIssues(fieldPath);

  const setCharge = (id: string, patch: Partial<Charge>) =>
    onChange({ charges: person.charges.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

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
      <Button size="sm" className="mt-2" onClick={() => onChange({ charges: [...person.charges, createCharge()] })}>
        Add charge
      </Button>
      {visible.map((issue) => (
        <InlineIssue key={issue.key} issueKey={issue.key} />
      ))}
    </div>
  );
}
