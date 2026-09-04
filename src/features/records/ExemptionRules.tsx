import { useMemo, useState } from 'react';
import { AlertTriangle, Plus, ScrollText, Trash2 } from 'lucide-react';
import { useStore } from '@/state/store';
import {
  DETECTOR_FAMILY,
  DETECTOR_LABEL,
  activeRules,
  checkRule,
  createRule,
  isCited,
  uncitedRules,
  unusableRules,
  type Action,
  type Detector,
  type ExemptionRule,
  type Scope,
} from '@/domain/exemption';
import { defaultPolicy } from '@/domain/publicRecords';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * The exemptions this agency redacts under.
 *
 * An administrator's screen, and mostly a reading screen: the work is deciding
 * which of these the state actually requires and finding the citation, which
 * is research rather than typing. What the screen has to do is make the state
 * of that research visible — what is on, what is on but undefendable, and what
 * has never been looked at.
 *
 * Federal rules are shown and cannot be switched off. They are not the
 * agency's to change, and a toggle that looks available but refuses is worse
 * than one that is plainly not there.
 */
export function ExemptionRules() {
  const { agency, updateAgency, can } = useStore();
  const mayEdit = can('agency.configure');
  const rules = useMemo(() => agency.exemptions ?? [], [agency.exemptions]);
  const [adding, setAdding] = useState(false);

  const running = activeRules(rules);
  const uncited = uncitedRules(rules);
  const broken = unusableRules(rules);

  const set = (id: string, patch: Partial<ExemptionRule>) =>
    updateAgency({ exemptions: rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)) });

  const remove = (id: string) =>
    updateAgency({ exemptions: rules.filter((rule) => rule.id !== id) });

  const byScope = (scope: Scope) => rules.filter((rule) => rule.scope === scope);

  return (
    <div className="space-y-4">
      <Panel
        title="What may be withheld, and on what authority"
        description="Every redaction on a release has to be defensible by naming the law it was made under. A rule with nothing named against it still runs and still proposes — what it cannot do is put a redaction on a release anybody has signed off."
      >
        <div className="flex flex-wrap gap-2">
          <Badge tone="neutral">{running.length} running</Badge>
          {uncited.length > 0 && (
            <Badge tone="warn">{uncited.length} with no statute named</Badge>
          )}
          {broken.length > 0 && <Badge tone="danger">{broken.length} cannot run</Badge>}
        </div>

        {uncited.length > 0 && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-warn/45 bg-warn/5 p-3 text-[12.5px] leading-relaxed text-warn">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {uncited.length === 1 ? 'One rule is' : `${uncited.length} rules are`} switched on with
              no statute named. {uncited.length === 1 ? 'It' : 'They'} will still find things and
              propose them — but a clerk cannot issue a release that withholds anything under{' '}
              {uncited.length === 1 ? 'it' : 'them'} until somebody fills the citation in.
            </span>
          </p>
        )}

        {broken.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {broken.map(({ rule, reason }) => (
              <li
                key={rule.id}
                className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-[12.5px] leading-relaxed text-ink"
              >
                <span className="font-medium">{rule.label || 'Unnamed rule'}</span> is switched on
                and finding nothing — {reason}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Federal law"
        description="Binds every agency in the country, and is not this one’s to switch off."
      >
        <ul className="space-y-2">
          {byScope('federal').map((rule) => (
            <RuleRow key={rule.id} rule={rule} locked mayEdit={mayEdit} onChange={set} />
          ))}
        </ul>
      </Panel>

      <Panel
        title="State law"
        description="What actually governs the response, and no two states agree. These arrive switched off with blank citations, because a rule nobody has read against their own statute is a rule that redacts the wrong thing — and over-redaction is its own unlawful act, not a safe default."
      >
        <ul className="space-y-2">
          {byScope('state').map((rule) => (
            <RuleRow key={rule.id} rule={rule} mayEdit={mayEdit} onChange={set} />
          ))}
        </ul>
      </Panel>

      <Panel
        title="Agency policy"
        description="Policy can be stricter than the law about what leaves the building, but policy is not an exemption: withholding something on policy alone, where the law says release it, is how an agency loses a public records suit."
      >
        {byScope('agency').length === 0 && !adding && (
          <p className="text-[13px] leading-relaxed text-muted">Nothing added.</p>
        )}
        <ul className="space-y-2">
          {byScope('agency').map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              mayEdit={mayEdit}
              onChange={set}
              onRemove={() => remove(rule.id)}
            />
          ))}
        </ul>
        {mayEdit &&
          (adding ? (
            <NewRule
              onDone={(rule) => {
                if (rule) updateAgency({ exemptions: [...rules, rule] });
                setAdding(false);
              }}
            />
          ) : (
            <Button className="mt-3" onClick={() => setAdding(true)}>
              <Plus size={15} aria-hidden />
              Add a rule
            </Button>
          ))}
      </Panel>

      <ResponsePolicy />
    </div>
  );
}

const field =
  'w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint disabled:opacity-60';

function RuleRow({
  rule,
  locked,
  mayEdit,
  onChange,
  onRemove,
}: {
  rule: ExemptionRule;
  locked?: boolean;
  mayEdit: boolean;
  onChange: (id: string, patch: Partial<ExemptionRule>) => void;
  onRemove?: () => void;
}) {
  const check = checkRule(rule);
  const family = DETECTOR_FAMILY[rule.detector];

  return (
    <li
      className={cn(
        'rounded-xl border p-3',
        rule.enabled && !isCited(rule) ? 'border-warn/45 bg-warn/5' : 'border-line bg-surface',
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          aria-label={`Switch on ${rule.label}`}
          disabled={!mayEdit || locked}
          checked={rule.enabled}
          onChange={(e) => onChange(rule.id, { enabled: e.target.checked })}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-ink">
            {rule.label}
            {locked && (
              <span className="ml-2 text-[11.5px] font-normal text-faint">
                Federal — cannot be switched off
              </span>
            )}
          </p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{rule.note}</p>

          <p className="mt-1.5 text-[11.5px] text-faint">
            {DETECTOR_LABEL[rule.detector]} ·{' '}
            {family === 'pattern'
              ? 'found by its shape in the text'
              : family === 'record'
                ? 'found by knowing who is on this record'
                : 'finds nothing — puts a sentence in front of the clerk'}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              disabled={!mayEdit}
              value={rule.authority}
              onChange={(e) => onChange(rule.id, { authority: e.target.value })}
              placeholder="The statute or ordinance this is withheld under"
              className={cn(field, 'max-w-[400px] flex-1 text-[12.5px]')}
            />
            {rule.enabled && !isCited(rule) && (
              <span className="text-[11.5px] text-warn">
                Nothing can be withheld under this until it is named
              </span>
            )}
          </div>

          {rule.detector === 'custom' && (
            <input
              disabled={!mayEdit}
              value={rule.pattern}
              onChange={(e) => onChange(rule.id, { pattern: e.target.value })}
              placeholder="A regular expression to look for"
              className={cn(field, 'mt-2 font-mono text-[12px]')}
            />
          )}

          {!check.ok && (
            <p className="mt-1.5 text-[11.5px] text-danger">{check.reason}</p>
          )}
        </div>

        {onRemove && mayEdit && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${rule.label}`}
            className="rounded-lg p-1.5 text-faint transition hover:bg-canvas hover:text-danger"
          >
            <Trash2 size={15} aria-hidden />
          </button>
        )}
      </div>
    </li>
  );
}

const DETECTORS: Detector[] = [
  'custom', 'ssn', 'phone', 'email', 'dob', 'driverLicense', 'plate', 'bankAccount',
  'juvenileName', 'victimIdentity', 'witnessIdentity', 'reportingPartyIdentity', 'homeAddress',
  'medical', 'mentalHealth', 'sexualOffence', 'confidentialSource', 'ongoingInvestigation',
  'officerSafety', 'dmvReturn', 'criminalHistory',
];

const ACTIONS: { value: Action; label: string }[] = [
  { value: 'redact', label: 'propose hiding what it finds' },
  { value: 'flag', label: 'tell the clerk to look — it cannot say where' },
  { value: 'review', label: 'ask for a closer read of the whole record' },
];

function NewRule({ onDone }: { onDone: (rule: ExemptionRule | null) => void }) {
  const [draft, setDraft] = useState<ExemptionRule>(() =>
    createRule({ id: `ag-${Date.now().toString(36)}`, scope: 'agency' }),
  );
  const check = checkRule(draft);

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-line bg-canvas p-3">
      <input
        autoFocus
        value={draft.label}
        onChange={(e) => setDraft({ ...draft, label: e.target.value })}
        placeholder="What this rule is called"
        className={field}
      />
      <select
        value={draft.detector}
        onChange={(e) => setDraft({ ...draft, detector: e.target.value as Detector })}
        aria-label="What it looks for"
        className={field}
      >
        {DETECTORS.map((detector) => (
          <option key={detector} value={detector}>
            {DETECTOR_LABEL[detector]}
          </option>
        ))}
      </select>
      <select
        value={draft.action}
        onChange={(e) => setDraft({ ...draft, action: e.target.value as Action })}
        aria-label="What it does"
        className={field}
      >
        {ACTIONS.map((action) => (
          <option key={action.value} value={action.value}>
            {action.label}
          </option>
        ))}
      </select>
      {draft.detector === 'custom' && (
        <input
          value={draft.pattern}
          onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
          placeholder="A regular expression to look for"
          className={cn(field, 'font-mono text-[12px]')}
        />
      )}
      <input
        value={draft.authority}
        onChange={(e) => setDraft({ ...draft, authority: e.target.value })}
        placeholder="The ordinance or policy this is withheld under"
        className={field}
      />
      <textarea
        value={draft.note}
        onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        rows={2}
        placeholder="What a clerk needs to know about when this applies"
        className={field}
      />
      {!check.ok && <p className="text-[12px] text-danger">{check.reason}</p>}
      <div className="flex gap-2">
        <Button variant="primary" disabled={!check.ok} onClick={() => onDone(draft)}>
          Add it
        </Button>
        <Button variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * How long the state gives the agency to answer.
 *
 * The number that decides whether a request is late, which is the failure
 * agencies are actually sued for — far more often than releasing something
 * they should not have.
 */
function ResponsePolicy() {
  const { agency, updateAgency, can } = useStore();
  const mayEdit = can('agency.configure');
  const policy = agency.publicRecords ?? defaultPolicy();
  const set = (patch: Record<string, unknown>) =>
    updateAgency({ publicRecords: { ...policy, ...patch } });

  return (
    <Panel
      title="Answering a request"
      description="How long the state gives this agency, and how it counts. Ten business days is the most common period and is wrong in a good number of states — some are three days, some are twenty, some say “promptly” with no number at all."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-muted">Days to respond</span>
          <input
            type="number"
            min={1}
            disabled={!mayEdit}
            value={policy.responseDays}
            onChange={(e) => set({ responseDays: Math.max(1, Number(e.target.value) || 1) })}
            className={field}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-muted">Counted in</span>
          <select
            disabled={!mayEdit}
            value={policy.businessDays ? 'business' : 'calendar'}
            onChange={(e) => set({ businessDays: e.target.value === 'business' })}
            className={field}
          >
            <option value="business">business days</option>
            <option value="calendar">calendar days</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-muted">
            Longest extension the statute allows
          </span>
          <input
            type="number"
            min={0}
            disabled={!mayEdit}
            value={policy.extensionDays}
            onChange={(e) => set({ extensionDays: Math.max(0, Number(e.target.value) || 0) })}
            className={field}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-muted">
            How many times (0 where the statute is silent)
          </span>
          <input
            type="number"
            min={0}
            disabled={!mayEdit}
            value={policy.maxExtensions}
            onChange={(e) => set({ maxExtensions: Math.max(0, Number(e.target.value) || 0) })}
            className={field}
          />
        </label>
      </div>
      <input
        disabled={!mayEdit}
        value={policy.authority}
        onChange={(e) => set({ authority: e.target.value })}
        placeholder="This state’s public records act"
        className={cn(field, 'mt-3')}
      />
      {!policy.authority.trim() && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-warn">
          <ScrollText size={13} aria-hidden />
          Not yet checked against the statute
        </p>
      )}
    </Panel>
  );
}
