import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  CornerUpLeft,
  Fingerprint,
  Gavel,
  Loader2,
  Plus,
  Search,
  Send,
} from 'lucide-react';
import { useStore } from '@/state/store';
import {
  ARREST_TYPE_LABEL,
  DISPOSITION_LABEL,
  JUVENILE_ONLY,
  OUTCOME_LABEL,
  SEVERITY_LABEL,
  blockingProblems,
  describeCharges,
  totalBond,
  type Arrest,
  type ArrestCharge,
  type ChargeOutcome,
  type ChargeSeverity,
  type Disposition,
  type Problem,
} from '@/domain/arrest';
import { canReopen, canReview, REVIEW_ACTION_LABEL, STATUS_LABEL } from '@/domain/review';
import { displayName } from '@/domain/person';
import { Badge, Button, FieldGrid, Panel, RecordCard } from '@/components/ui/primitives';
import { SelectField, TextField, TextareaField, ToggleField } from '@/components/ui/fields';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * Writing up an arrest.
 *
 * An arrest is its own document rather than a section of a report, because it
 * outlives the report it came from: it goes to a court, comes back with a
 * disposition years later, and is asked about on its own. It is also the one
 * document here where a mistake takes somebody's liberty, so the checks are
 * loud and the panel that lists them puts the cursor in the offending field.
 */
export function ArrestEditor() {
  const {
    arrest,
    arrestProblems,
    incidents,
    people,
    users,
    currentUser,
    closeArrest,
    updateArrest,
    addCharge,
    updateCharge,
    removeCharge,
    submitArrest,
    approveArrest,
    returnArrest,
    reopenArrest,
    savedAt,
  } = useStore();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [pickingPerson, setPickingPerson] = useState(false);

  const officers = useMemo(
    () => users.filter((u) => u.active).map((u) => ({ value: u.id, label: u.name })),
    [users],
  );

  if (!arrest) return null;

  const editable = arrest.status === 'draft' || arrest.status === 'returned';
  const mine = arrest.createdBy === currentUser.id;
  const writable = editable && mine;
  const review = canReview(currentUser, {
    status: arrest.status,
    createdBy: arrest.createdBy,
    reportingOfficer: arrest.arrestingOfficerId,
  });
  const reopen = canReopen(currentUser, arrest.status);

  const errors = blockingProblems(arrestProblems);
  const warnings = arrestProblems.filter((p) => p.severity === 'warning');
  const incident = incidents.find((i) => i.id === arrest.caseId) ?? null;
  const bond = totalBond(arrest);

  const set = (patch: Partial<Arrest>) => updateArrest(patch);

  const run = async (action: () => Promise<{ ok: boolean; reason?: string }>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) setNote('');
    else setError(result.reason ?? 'That did not work.');
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas" data-screen="Arrest">
      <header className="flex shrink-0 items-center gap-4 border-b border-line bg-surface px-4 py-2.5">
        <Button variant="ghost" onClick={closeArrest} aria-label="Back to reports">
          <ChevronLeft size={16} aria-hidden />
          Reports
        </Button>
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate font-mono text-[14px] font-semibold text-ink">
            {arrest.arrestNumber}
          </h1>
          <Badge tone="warn">Arrest</Badge>
          <Badge
            tone={
              arrest.status === 'approved' ? 'ok' : arrest.status === 'returned' ? 'warn' : 'neutral'
            }
          >
            {STATUS_LABEL[arrest.status]}
          </Badge>
          {arrest.juvenile && <Badge tone="accent">Juvenile</Badge>}
        </div>
        <div className="flex-1" />
        {savedAt && <span className="text-[12px] text-faint">Saved {relativeTime(savedAt)}</span>}
        {writable && (
          <Button
            variant="primary"
            disabled={busy || errors.length > 0}
            onClick={() => void run(submitArrest)}
            title={errors[0]?.message}
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <Send size={15} aria-hidden />
            )}
            {errors.length > 0 ? `Submit (${errors.length} to fix)` : 'Submit'}
          </Button>
        )}
      </header>

      {error && (
        <div className="border-b border-danger/35 bg-danger-soft px-4 py-2.5 text-[13px] text-danger">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
            <fieldset disabled={!writable} className="space-y-4">
              {/* ---- Who -------------------------------------------------- */}
              <Panel
                title="Who was arrested"
                description="From the name index, so this arrest joins everything else the agency knows about them."
              >
                <div
                  className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3"
                  data-field-path="masterId"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-ink">
                      {arrest.personName || 'Nobody chosen yet'}
                    </p>
                    <p className="text-[12.5px] text-muted">
                      {arrest.caseNumber ? `On case ${arrest.caseNumber}` : 'No case — a warrant service or an assist'}
                    </p>
                  </div>
                  {writable && (
                    <Button onClick={() => setPickingPerson(true)}>
                      <Search size={15} aria-hidden />
                      {arrest.masterId ? 'Change' : 'Choose'}
                    </Button>
                  )}
                </div>

                <FieldGrid cols={2}>
                  <TextField
                    path="arrestedAt"
                    label="Date and time of the arrest"
                    type="datetime-local"
                    required
                    value={toLocalInput(arrest.arrestedAt)}
                    onChange={(v) => set({ arrestedAt: fromLocalInput(v) })}
                  />
                  <SelectField
                    path="arrestType"
                    label="Arrest type"
                    required
                    options={optionsFrom(ARREST_TYPE_LABEL)}
                    value={arrest.arrestType}
                    onChange={(v) => set({ arrestType: v as Arrest['arrestType'] })}
                  />
                  <TextField
                    path="arrestLocation"
                    label="Where the arrest was made"
                    className="col-span-2"
                    placeholder="612 N Marion St"
                    value={arrest.arrestLocation}
                    onChange={(v) => set({ arrestLocation: v })}
                  />
                  <SelectField
                    path="arrestingOfficerId"
                    label="Arresting officer"
                    required
                    hint="The one who will be asked about it in court — not necessarily whoever is typing."
                    options={officers}
                    value={arrest.arrestingOfficerId}
                    onChange={(v) =>
                      // The name travels with the id so a list can be read
                      // without resolving every account. The server recomputes
                      // it from the users table either way; this is so the
                      // screen agrees with itself before the save lands.
                      set({
                        arrestingOfficerId: v,
                        arrestingOfficerName: users.find((u) => u.id === v)?.name ?? '',
                      })
                    }
                  />
                  <TextField
                    path="assistingOfficers"
                    label="Assisting"
                    placeholder="Sgt Alvarez, Ofc Kim"
                    value={arrest.assistingOfficers}
                    onChange={(v) => set({ assistingOfficers: v })}
                  />
                </FieldGrid>
              </Panel>

              {/* ---- Charges ---------------------------------------------- */}
              <Panel
                title={`Charges (${arrest.charges.length})`}
                description={describeCharges(arrest)}
                aside={
                  bond > 0 ? (
                    <Badge tone="neutral">Bond ${bond.toLocaleString()}</Badge>
                  ) : (
                    <Gavel size={17} className="text-faint" aria-hidden />
                  )
                }
              >
                <div className="space-y-3">
                  {arrest.charges.map((charge, i) => (
                    <ChargeCard
                      key={charge.id}
                      index={i}
                      charge={charge}
                      onChange={(patch) => updateCharge(charge.id, patch)}
                      onRemove={writable ? () => removeCharge(charge.id) : undefined}
                    />
                  ))}
                  {arrest.charges.length === 0 && (
                    <p
                      className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[13px] text-muted"
                      data-field-path="charges"
                    >
                      No charges yet. An arrest with none is not an arrest.
                    </p>
                  )}
                </div>
                {writable && (
                  <div className="mt-3">
                    <Button onClick={addCharge}>
                      <Plus size={15} aria-hidden />
                      Add a charge
                    </Button>
                  </div>
                )}
              </Panel>

              {/* ---- Where they went -------------------------------------- */}
              <Panel
                title="Where they went"
                description="The single most-asked question about an arrest, months later."
              >
                <FieldGrid cols={2}>
                  <SelectField
                    path="disposition"
                    label="Disposition"
                    required
                    options={optionsFrom(DISPOSITION_LABEL).filter(
                      (o) =>
                        arrest.juvenile || !JUVENILE_ONLY.includes(o.value as Disposition),
                    )}
                    value={arrest.disposition}
                    onChange={(v) => set({ disposition: v as Disposition })}
                  />
                  <TextField
                    path="heldAt"
                    label="Held at"
                    placeholder="County detention centre"
                    value={arrest.heldAt}
                    onChange={(v) => set({ heldAt: v })}
                  />
                  <TextField
                    path="bookingNumber"
                    label="Booking number"
                    value={arrest.bookingNumber}
                    onChange={(v) => set({ bookingNumber: v })}
                  />
                  <TextField
                    path="bookedAt"
                    label="Booked at"
                    type="datetime-local"
                    value={toLocalInput(arrest.bookedAt)}
                    onChange={(v) => set({ bookedAt: fromLocalInput(v) })}
                  />
                  <TextField
                    path="bookedByName"
                    label="Booked by"
                    value={arrest.bookedByName}
                    onChange={(v) => set({ bookedByName: v })}
                  />
                  <TextField
                    path="releasedAt"
                    label="Released at"
                    type="datetime-local"
                    hint="Leave blank while they are still held."
                    value={toLocalInput(arrest.releasedAt)}
                    onChange={(v) => set({ releasedAt: fromLocalInput(v) })}
                  />
                  <TextField
                    path="bondAmount"
                    label="Bond set"
                    type="number"
                    value={arrest.bondAmount}
                    onChange={(v) => set({ bondAmount: v })}
                  />
                  <TextField
                    path="courtDate"
                    label="Court date"
                    type="date"
                    value={arrest.courtDate}
                    onChange={(v) => set({ courtDate: v })}
                  />
                  <TextField
                    path="courtLocation"
                    label="Court"
                    className="col-span-2"
                    value={arrest.courtLocation}
                    onChange={(v) => set({ courtLocation: v })}
                  />
                </FieldGrid>
              </Panel>

              {/* ---- Booking identifiers ---------------------------------- */}
              <Panel
                title="Identification"
                description="Taken at booking. Without prints the arrest never reaches the state's criminal history."
                aside={<Fingerprint size={17} className="text-faint" aria-hidden />}
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <ToggleField
                    path="fingerprinted"
                    label="Fingerprinted"
                    checked={arrest.fingerprinted}
                    onChange={(v) => set({ fingerprinted: v })}
                  />
                  <ToggleField
                    path="photographed"
                    label="Photographed"
                    checked={arrest.photographed}
                    onChange={(v) => set({ photographed: v })}
                  />
                </div>
                <div className="mt-3">
                  <FieldGrid cols={2}>
                    <TextField
                      path="stateIdNumber"
                      label="State identification number"
                      value={arrest.stateIdNumber}
                      onChange={(v) => set({ stateIdNumber: v })}
                    />
                    <TextField
                      path="fbiNumber"
                      label="FBI number"
                      value={arrest.fbiNumber}
                      onChange={(v) => set({ fbiNumber: v })}
                    />
                  </FieldGrid>
                </div>
              </Panel>

              {/* ---- Juvenile --------------------------------------------- */}
              <Panel
                title="Juvenile"
                description="A different set of rules, and a decision that has to be written down."
              >
                <ToggleField
                  path="juvenile"
                  label="Under eighteen"
                  description="Turns on the handling and guardian questions, and the juvenile dispositions."
                  checked={arrest.juvenile}
                  onChange={(v) => set({ juvenile: v })}
                />
                {arrest.juvenile && (
                  <div className="mt-3 space-y-3">
                    <TextareaField
                      path="juvenileHandling"
                      label="How it was handled"
                      required
                      rows={3}
                      placeholder="Released to mother at the scene with a referral to juvenile court."
                      value={arrest.juvenileHandling}
                      onChange={(v) => set({ juvenileHandling: v })}
                    />
                    <TextField
                      path="guardianNotifiedAt"
                      label="Parent or guardian notified at"
                      type="datetime-local"
                      value={toLocalInput(arrest.guardianNotifiedAt)}
                      onChange={(v) => set({ guardianNotifiedAt: fromLocalInput(v) })}
                    />
                  </div>
                )}
              </Panel>

              {/* ---- Probable cause --------------------------------------- */}
              <Panel
                title="Probable cause"
                description="Why this person was taken into custody — not what happened, which is the report's job. A magistrate reads this."
              >
                <TextareaField
                  path="narrative"
                  label="Statement of probable cause"
                  required
                  rows={12}
                  placeholder="Observed leaving the unit with the property in hand…"
                  value={arrest.narrative}
                  onChange={(v) => set({ narrative: v })}
                />
              </Panel>
            </fieldset>

            {(errors.length > 0 || warnings.length > 0) && writable && (
              <Panel title={`Arrest check (${errors.length + warnings.length})`}>
                <ul className="space-y-2">
                  {[...errors, ...warnings].map((problem, i) => (
                    <ProblemRow key={`${problem.path}-${i}`} problem={problem} />
                  ))}
                </ul>
              </Panel>
            )}

            {(review.ok || reopen.ok) && (
              <Panel
                title="Supervisor review"
                description={
                  review.ok
                    ? 'Approve it, or send it back. Approving also puts the arrestee on the report.'
                    : 'Reopening puts it back to its author.'
                }
                aside={<Badge tone="accent">Reviewer</Badge>}
              >
                {incident && (
                  <p className="mb-3 text-[12.5px] text-muted">
                    Case {incident.caseNumber} — {incident.persons.length} people on the report.
                  </p>
                )}
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    review.ok ? 'Note — required if you send it back' : 'Why it is being reopened'
                  }
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px] text-ink placeholder:text-faint"
                />
                <div className="mt-3 flex gap-2">
                  {review.ok && (
                    <>
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={() => void run(() => approveArrest(note.trim()))}
                      >
                        <Check size={15} aria-hidden />
                        Approve
                      </Button>
                      <Button
                        disabled={busy || !note.trim()}
                        onClick={() => void run(() => returnArrest(note.trim()))}
                      >
                        <CornerUpLeft size={15} aria-hidden />
                        Return for correction
                      </Button>
                    </>
                  )}
                  {reopen.ok && (
                    <Button
                      disabled={busy || !note.trim()}
                      onClick={() => void run(() => reopenArrest(note.trim()))}
                    >
                      <CornerUpLeft size={15} aria-hidden />
                      Reopen
                    </Button>
                  )}
                </div>
              </Panel>
            )}

            {arrest.reviewHistory.length > 0 && (
              <Panel title="History">
                <ul className="space-y-1.5">
                  {[...arrest.reviewHistory].reverse().map((entry) => (
                    <li key={entry.id} className="text-[12.5px] text-muted">
                      <span className="font-medium text-ink">
                        {REVIEW_ACTION_LABEL[entry.action]}
                      </span>{' '}
                      by {entry.actorName} · {relativeTime(entry.at)}
                      {entry.note && (
                        <span className="block text-[12px] text-faint">“{entry.note}”</span>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        </main>
      </div>

      {pickingPerson && (
        <ArresteePicker
          people={people}
          onClose={() => setPickingPerson(false)}
          onPick={(masterId, name) => {
            set({ masterId, personName: name });
            setPickingPerson(false);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * One problem, and a way to get to it.
 *
 * The click is the point. A list that names a field the officer then has to
 * hunt for is a list they stop reading.
 */
function ProblemRow({ problem }: { problem: Problem }) {
  const go = () => {
    const el = document.querySelector<HTMLElement>(`[data-field-path="${CSS.escape(problem.path)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusable = el.matches('input, select, textarea, button')
      ? el
      : el.querySelector<HTMLElement>('input, select, textarea, button');
    focusable?.focus({ preventScroll: true });
  };

  return (
    <li>
      <button
        type="button"
        onClick={go}
        className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-raised"
      >
        <AlertTriangle
          size={14}
          className={cn(
            'mt-0.5 shrink-0',
            problem.severity === 'error' ? 'text-danger' : 'text-warn',
          )}
          aria-hidden
        />
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-ink">{problem.title}</span>
          <span className="block text-[12.5px] leading-relaxed text-muted">{problem.message}</span>
          {problem.tip && (
            <span className="mt-0.5 block text-[12px] leading-relaxed text-faint">{problem.tip}</span>
          )}
        </span>
      </button>
    </li>
  );
}

function ChargeCard({
  index,
  charge,
  onChange,
  onRemove,
}: {
  index: number;
  charge: ArrestCharge;
  onChange: (patch: Partial<ArrestCharge>) => void;
  onRemove?: () => void;
}) {
  return (
    <RecordCard
      index={index}
      title={charge.description || charge.statute || 'New charge'}
      subtitle={charge.severity ? SEVERITY_LABEL[charge.severity] : undefined}
      badge={
        charge.outcome ? <Badge tone="neutral">{OUTCOME_LABEL[charge.outcome]}</Badge> : undefined
      }
      onRemove={onRemove}
    >
      <FieldGrid cols={2}>
        <TextField
          path={`charges.${index}.statute`}
          label="Statute or ordinance"
          required
          placeholder="13A-8-4"
          value={charge.statute}
          onChange={(v) => onChange({ statute: v })}
        />
        <TextField
          path={`charges.${index}.description`}
          label="Charge"
          placeholder="Theft of property, second degree"
          value={charge.description}
          onChange={(v) => onChange({ description: v })}
        />
        <SelectField
          path={`charges.${index}.severity`}
          label="Severity"
          required
          options={optionsFrom(SEVERITY_LABEL)}
          value={charge.severity}
          onChange={(v) => onChange({ severity: v as ChargeSeverity })}
        />
        <TextField
          path={`charges.${index}.degree`}
          label="Class or degree"
          placeholder="C"
          value={charge.degree}
          onChange={(v) => onChange({ degree: v })}
        />
        <TextField
          path={`charges.${index}.counts`}
          label="Counts"
          type="number"
          required
          value={charge.counts}
          onChange={(v) => onChange({ counts: v })}
        />
        <TextField
          path={`charges.${index}.nibrsCode`}
          label="NIBRS offence code"
          placeholder="23F"
          value={charge.nibrsCode}
          onChange={(v) => onChange({ nibrsCode: v })}
        />
        <TextField
          path={`charges.${index}.bondAmount`}
          label="Bond on this charge"
          type="number"
          value={charge.bondAmount}
          onChange={(v) => onChange({ bondAmount: v })}
        />
        <SelectField
          path={`charges.${index}.outcome`}
          label="Outcome"
          hint="Filled in when the court comes back, often much later."
          options={optionsFrom(OUTCOME_LABEL)}
          value={charge.outcome}
          onChange={(v) => onChange({ outcome: v as ChargeOutcome })}
        />
      </FieldGrid>
      {charge.outcome && (
        <div className="mt-3">
          <FieldGrid cols={2}>
            <TextField
              path={`charges.${index}.outcomeAt`}
              label="Outcome date"
              type="date"
              value={charge.outcomeAt}
              onChange={(v) => onChange({ outcomeAt: v })}
            />
            <TextField
              path={`charges.${index}.outcomeNote`}
              label="Note"
              value={charge.outcomeNote}
              onChange={(v) => onChange({ outcomeNote: v })}
            />
          </FieldGrid>
        </div>
      )}
    </RecordCard>
  );
}

/** Picks the arrestee out of the name index. */
function ArresteePicker({
  people,
  onPick,
  onClose,
}: {
  people: Record<string, { id: string; firstName: string; lastName: string; businessName: string; dob: string }>;
  onPick: (masterId: string, name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = Object.values(people);
    const matched = needle
      ? all.filter((p) =>
          `${p.lastName} ${p.firstName} ${p.businessName} ${p.dob}`.toLowerCase().includes(needle),
        )
      : all;
    return matched.slice(0, 40);
  }, [people, query]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-6 pt-[8vh]">
      <div
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Choose who was arrested"
      >
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="text-[14px] font-semibold text-ink">Who was arrested</h2>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </header>
        <div className="border-b border-line px-4 py-3">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or date of birth"
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13.5px] text-ink placeholder:text-faint"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-muted">
              Nobody matches. Add them to the report first — an arrest points at an identity the
              agency already holds, so it joins up with everything else about them.
            </p>
          ) : (
            <ul className="space-y-1">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onPick(p.id, displayName(p))}
                    className="flex w-full items-baseline gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-raised"
                  >
                    <span className="text-[13.5px] font-medium text-ink">{displayName(p)}</span>
                    {p.dob && <span className="text-[12px] text-muted">{p.dob}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** A `Record<code, label>` as select options, in declaration order. */
function optionsFrom(labels: Record<string, string>) {
  return Object.entries(labels)
    .filter(([value]) => value !== '')
    .map(([value, label]) => ({ value, label }));
}

/**
 * ISO to what `datetime-local` wants, and back.
 *
 * The input has no timezone, so it means local time — which is what an officer
 * writing "we took him at 2340" means too. Stored as an instant.
 */
function toLocalInput(iso: string): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  if (!value) return '';
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? '' : at.toISOString();
}
