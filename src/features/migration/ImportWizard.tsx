import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileUp,
  Loader2,
  Merge,
  Plus,
  UserSearch,
  X,
} from 'lucide-react';
import { useStore } from '@/state/store';
import { api } from '@/state/api';
import {
  describePlan,
  fieldsFor,
  guessMapping,
  parseCsv,
  planImport,
  unreadableValues,
  type ColumnMap,
  type EntityKind,
  type ImportPlan,
  type RowPlan,
} from '@/domain/migration';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

type Step = 'file' | 'map' | 'review' | 'done';

/**
 * Moving in from a previous records system.
 *
 * The feature that decides whether an agency can actually switch, and the one
 * where a bad tool does lasting damage: a migration that half-runs, or that
 * silently imports the same person eleven times, leaves a database nobody can
 * describe and nobody can undo.
 *
 * So it is a wizard with a hard stop in the middle. Nothing is written until a
 * records clerk has seen the whole plan — how many are new, how many matched
 * somebody already known, how many need a human, and every row that was
 * rejected with the reason.
 */
export function ImportWizard() {
  const { people, locations, can } = useStore();
  const [step, setStep] = useState<Step>('file');
  const [kind, setKind] = useState<EntityKind>('people');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<ColumnMap>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState(0);
  /*
    What the clerk decided about each row the matcher could not settle, keyed
    by the row number in the file. Absent means undecided, which means skip:
    the safe default is to leave a questionable record out, because an omission
    is visible the first time somebody searches for it and a bad merge is not.
  */
  const [decisions, setDecisions] = useState<Record<number, 'skip' | 'create'>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const mayImport = can('agency.configure');

  const plan: ImportPlan | null = useMemo(() => {
    if (rows.length === 0) return null;
    return planImport({ kind, rows, hasHeader, mapping, people, locations });
  }, [rows, kind, hasHeader, mapping, people, locations]);

  const headers = rows[0] ?? [];

  const unreadable = plan ? unreadableValues(plan) : { count: 0, rows: [] };

  const willCreate = plan
    ? plan.create.length + plan.review.filter((r) => decisions[r.row] === 'create').length
    : 0;

  const readFile = async (file: File) => {
    setError(null);
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length === 0) {
      setError('That file has no rows in it.');
      return;
    }
    setFileName(file.name);
    setRows(parsed);
    setMapping(guessMapping(parsed[0], kind));
    setStep('map');
  };

  const commit = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    const toCreate = [
      ...plan.create,
      ...plan.review.filter((row) => decisions[row.row] === 'create'),
    ].map((row) => ({ values: row.values }));

    try {
      const { created } = await api.commitImport(kind, toCreate);
      setImported(created);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The import failed.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep('file');
    setRows([]);
    setFileName('');
    setImported(0);
    setDecisions({});
  };

  if (!mayImport) {
    return (
      <Panel title="Import from a previous system">
        <p className="text-[12.5px] leading-relaxed text-muted">
          Importing rewrites the name and location indexes that every report shares, so it needs
          agency configuration rights.
        </p>
      </Panel>
    );
  }

  return (
    <>
      <Panel
        title="Import from a previous system"
        description="CSV, because it is the one export every records system can produce. Nothing is written until you have seen the whole plan."
        aside={<FileUp size={17} className="text-faint" aria-hidden />}
      >
        {error && (
          <p className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</p>
        )}

        <ol className="mb-4 flex flex-wrap items-center gap-2 text-[12px]">
          {(['file', 'map', 'review', 'done'] as Step[]).map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full text-[11px] font-semibold',
                  step === s
                    ? 'bg-accent text-white'
                    : i < (['file', 'map', 'review', 'done'] as Step[]).indexOf(step)
                      ? 'bg-ok text-white'
                      : 'bg-raised text-faint',
                )}
              >
                {i + 1}
              </span>
              <span className={cn(step === s ? 'font-medium text-ink' : 'text-muted')}>
                {{ file: 'Choose a file', map: 'Match the columns', review: 'Check the plan', done: 'Done' }[s]}
              </span>
              {i < 3 && <ArrowRight size={13} className="text-faint" aria-hidden />}
            </li>
          ))}
        </ol>

        {step === 'file' && (
          <div>
            <div className="flex gap-2">
              {(['people', 'locations'] as EntityKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-left transition',
                    kind === k ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong',
                  )}
                >
                  <span className="block text-[13px] font-medium text-ink">
                    {k === 'people' ? 'People' : 'Places'}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-muted">
                    {k === 'people'
                      ? 'Names, dates of birth, addresses — the master name index.'
                      : 'Addresses and premises — the location index.'}
                  </span>
                </button>
              ))}
            </div>

            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void readFile(file);
              }}
            />
            <Button variant="primary" className="mt-4" onClick={() => inputRef.current?.click()}>
              <FileUp size={15} aria-hidden />
              Choose a CSV
            </Button>
          </div>
        )}

        {step === 'map' && (
          <div>
            <p className="mb-3 text-[12.5px] text-muted">
              {fileName} · {(hasHeader ? rows.length - 1 : rows.length).toLocaleString()} records.
              The columns below were guessed from the headers — change anything that is wrong.
            </p>

            <label className="mb-3 flex items-center gap-2 text-[13px] text-ink">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                className="size-4 rounded border-line-strong"
              />
              The first row is a header
            </label>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {fieldsFor(kind).map((field) => (
                <label key={field.key} className="text-[12.5px]">
                  <span className="mb-1 flex items-baseline gap-1.5 text-ink">
                    {field.label}
                    {field.required && <span className="text-danger">*</span>}
                  </span>
                  <select
                    value={mapping[field.key] ?? -1}
                    onChange={(e) => setMapping({ ...mapping, [field.key]: Number(e.target.value) })}
                    className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] text-ink"
                  >
                    <option value={-1}>— not in this file —</option>
                    {headers.map((header, i) => (
                      <option key={i} value={i}>
                        {hasHeader ? header || `Column ${i + 1}` : `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                  {field.hint && <span className="mt-0.5 block text-[11px] text-faint">{field.hint}</span>}
                </label>
              ))}
            </div>

            <div className="mt-4 flex gap-2">
              <Button onClick={reset}>Back</Button>
              <Button variant="primary" onClick={() => setStep('review')}>
                See the plan
                <ArrowRight size={15} aria-hidden />
              </Button>
            </div>
          </div>
        )}

        {step === 'review' && plan && (
          <div>
            <div className="mb-4 grid grid-cols-4 gap-3">
              <Count icon={<Plus size={14} />} label="New" value={plan.create.length} tone="ok" />
              <Count icon={<Merge size={14} />} label="Already known" value={plan.merge.length} tone="neutral" />
              <Count icon={<UserSearch size={14} />} label="Need a look" value={plan.review.length} tone="warn" />
              <Count icon={<X size={14} />} label="Rejected" value={plan.reject.length} tone={plan.reject.length ? 'danger' : 'neutral'} />
            </div>

            <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
              {plan.merge.length > 0 && (
                <>
                  <strong className="text-ink">{plan.merge.length}</strong> rows already exist and
                  will be skipped rather than duplicated.{' '}
                </>
              )}
              Everything imported is stamped as coming from a previous system and not confirmed by
              an officer, so it reads that way on every report afterwards.
            </p>

            {plan.review.length > 0 && (
              <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] leading-relaxed text-ink">
                <strong>{plan.review.length}</strong>{' '}
                {plan.review.length === 1 ? 'row looks' : 'rows look'} similar to somebody already
                on file without being close enough to be sure. Say which below — anything left
                undecided is skipped, because a record left out shows up the first time somebody
                searches for it, and two people merged into one does not.
              </p>
            )}

            {unreadable.count > 0 && (
              <p className="mb-3 flex items-start gap-2 rounded-lg bg-raised px-3 py-2 text-[12.5px] leading-relaxed text-ink">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                <span>
                  <strong>{unreadable.count}</strong>{' '}
                  {unreadable.count === 1 ? 'value' : 'values'} could not be read and will be left
                  blank, on {describeRows(unreadable.rows.map((r) => r.row))}. If a whole column
                  looks like this, the format is probably one we do not recognise: fix it in the
                  export and start again rather than importing the gaps.
                </span>
              </p>
            )}

            <RowTable
              title="Need a look"
              rows={plan.review}
              tone="warn"
              defaultOpen
              decisions={decisions}
              onDecide={(row, choice) => setDecisions((d) => ({ ...d, [row]: choice }))}
              onDecideAll={(choice) =>
                setDecisions(Object.fromEntries(plan.review.map((r) => [r.row, choice])))
              }
            />
            <RowTable title="New" rows={plan.create} tone="ok" />
            <RowTable title="Rejected" rows={plan.reject} tone="danger" />
            <RowTable title="Already known" rows={plan.merge} tone="neutral" />

            <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
              <Button onClick={() => setStep('map')}>Back</Button>
              <Button
                variant="primary"
                disabled={busy || willCreate === 0}
                onClick={() => void commit()}
              >
                {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
                Import {willCreate.toLocaleString()} {willCreate === 1 ? 'record' : 'records'}
              </Button>
              <span className="text-[12px] text-faint">{describePlan(plan)}</span>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div>
            <p className="flex items-center gap-2 text-[14px] font-medium text-ok">
              <CheckCircle2 size={17} aria-hidden />
              {imported.toLocaleString()} records imported.
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              They are searchable now. Every field on them reads as coming from a previous system
              until somebody confirms it — which is what stops a nine-year-old address being taken
              for something an officer checked yesterday.
            </p>
            <Button className="mt-3" onClick={reset}>
              Import another file
            </Button>
          </div>
        )}
      </Panel>
    </>
  );
}

function Count({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
}) {
  const color =
    tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : 'text-ink';
  return (
    <div className="rounded-xl border border-line bg-canvas px-3 py-2">
      <p className={cn('flex items-center gap-1.5 text-[22px] font-semibold tabular', color)}>
        {value.toLocaleString()}
      </p>
      <p className="mt-0.5 flex items-center gap-1 text-[11.5px] uppercase tracking-wide text-faint">
        {icon}
        {label}
      </p>
    </div>
  );
}

/** "row 10", "rows 10 and 14", "rows 10, 14, 22 and 37 others". */
function describeRows(rows: number[]): string {
  if (rows.length === 1) return `row ${rows[0]}`;
  const shown = rows.slice(0, 6);
  const rest = rows.length - shown.length;
  const list =
    rest > 0
      ? `${shown.join(', ')} and ${rest} others`
      : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  return `rows ${list}`;
}

type Decision = 'skip' | 'create';

/** The rows a clerk has to actually look at, with the row number from the file. */
function RowTable({
  title,
  rows,
  tone,
  defaultOpen = false,
  decisions,
  onDecide,
  onDecideAll,
}: {
  title: string;
  rows: RowPlan[];
  tone: string;
  defaultOpen?: boolean;
  /** Passing these three turns the table into one a clerk answers. */
  decisions?: Record<number, Decision>;
  onDecide?: (row: number, choice: Decision) => void;
  onDecideAll?: (choice: Decision) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (rows.length === 0) return null;

  const decidable = Boolean(decisions && onDecide);
  const answered = decisions ? rows.filter((r) => decisions[r.row]).length : 0;

  return (
    <div className="mt-2 rounded-lg border border-line">
      <div className="flex w-full items-center gap-2 px-3 py-2 text-[12.5px] font-medium text-ink">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-2 text-left"
        >
          {tone === 'danger' && <AlertTriangle size={13} className="text-danger" aria-hidden />}
          {title}
          <Badge tone="neutral">{rows.length}</Badge>
          {decidable && answered > 0 && (
            <span className="text-[11.5px] font-normal text-muted">{answered} answered</span>
          )}
          <span className="flex-1" />
          <span className="text-[11.5px] font-normal text-faint">{open ? 'Hide' : 'Show'}</span>
        </button>

        {/* A file with four hundred of these is not four hundred clicks. */}
        {decidable && open && onDecideAll && rows.length > 1 && (
          <span className="flex shrink-0 items-center gap-1 border-l border-line pl-2">
            <button
              type="button"
              onClick={() => onDecideAll('create')}
              className="rounded px-1.5 py-0.5 text-[11.5px] font-normal text-muted hover:bg-raised hover:text-ink"
            >
              All new
            </button>
            <button
              type="button"
              onClick={() => onDecideAll('skip')}
              className="rounded px-1.5 py-0.5 text-[11.5px] font-normal text-muted hover:bg-raised hover:text-ink"
            >
              All skip
            </button>
          </span>
        )}
      </div>

      {open && (
        <div className="max-h-80 overflow-y-auto border-t border-line">
          <table className="w-full text-[12px]">
            <tbody>
              {rows.slice(0, 200).map((row) => (
                <tr key={row.row} className="border-b border-line/60">
                  <td className="w-14 px-3 py-1.5 align-top text-faint tabular">{row.row}</td>
                  <td className="px-2 py-1.5 align-top text-ink">
                    {[row.values.lastName, row.values.firstName].filter(Boolean).join(', ') ||
                      row.values.address ||
                      row.values.commonName ||
                      '—'}
                  </td>
                  <td className="px-2 py-1.5 align-top text-muted">
                    {row.reason}
                    {row.matchedLabel && (
                      <span className="mt-0.5 block text-[11.5px] text-faint">
                        already on file: {row.matchedLabel}
                      </span>
                    )}
                    {row.warnings?.map((warning) => (
                      <span key={warning} className="mt-0.5 block text-[11.5px] text-warn">
                        {warning}
                      </span>
                    ))}
                  </td>
                  {decidable && decisions && onDecide && (
                    <td className="w-44 px-3 py-1.5 align-top text-right">
                      <span className="inline-flex overflow-hidden rounded-md border border-line">
                        <DecideButton
                          active={decisions[row.row] === 'create'}
                          onClick={() => onDecide(row.row, 'create')}
                        >
                          New person
                        </DecideButton>
                        <DecideButton
                          active={decisions[row.row] === 'skip'}
                          onClick={() => onDecide(row.row, 'skip')}
                        >
                          Skip
                        </DecideButton>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 200 && (
            <p className="px-3 py-2 text-[11.5px] text-faint">
              Showing the first 200 of {rows.length.toLocaleString()}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function DecideButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'px-2 py-1 text-[11.5px] font-medium transition',
        active ? 'bg-accent text-white' : 'text-muted hover:bg-raised hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
