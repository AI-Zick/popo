import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, Check, ChevronDown, Lightbulb, Wrench, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useStore } from '@/state/store';
import type { Issue } from '@/validation/engine';
import type { CodeOption } from '@/domain/codes';

/* ------------------------------------------------------------------ */
/* Issue plumbing                                                      */
/* ------------------------------------------------------------------ */

/**
 * Issues attached to one field. `revealed` controls whether they are shown
 * inline: a blank field the officer has not reached yet should not be shouting
 * at them, but once they have touched it — or once they have tried to submit —
 * every problem becomes visible and stays visible.
 */
export function useFieldIssues(path: string) {
  const { validation, revealedPaths, submitAttempted } = useStore();
  const issues = validation.byPath.get(path) ?? [];
  const revealed = submitAttempted || revealedPaths.has(path);
  return {
    issues,
    visible: revealed ? issues : [],
    error: issues.find((i) => i.severity === 'error'),
    revealed,
  };
}

function IssueNote({ issue }: { issue: Issue }) {
  const { applyQuickFix } = useStore();
  const isError = issue.severity === 'error';
  const Icon = isError ? AlertCircle : AlertTriangle;

  return (
    <div
      className={cn(
        'mt-1.5 rounded-lg border px-2.5 py-2 text-[13px] leading-relaxed',
        isError
          ? 'border-danger/35 bg-danger-soft text-danger'
          : 'border-warn/35 bg-warn-soft text-warn',
      )}
    >
      <div className="flex gap-2">
        <Icon size={15} className="mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{issue.message}</p>
          {issue.tip && (
            <p className="mt-1 flex gap-1.5 text-ink/75">
              <Lightbulb size={14} className="mt-0.5 shrink-0 opacity-70" aria-hidden />
              <span>{issue.tip}</span>
            </p>
          )}
          {issue.quickFix && (
            <button
              type="button"
              onClick={() => applyQuickFix(issue)}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-current/30 bg-surface px-2 py-1 text-[12px] font-medium text-ink transition hover:bg-raised"
            >
              <Wrench size={12} aria-hidden />
              {issue.quickFix.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Field shell                                                         */
/* ------------------------------------------------------------------ */

interface ShellProps {
  path: string;
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

export function FieldShell({ path, label, required, hint, className, children }: ShellProps) {
  const { registerField } = useStore();
  const { visible, error } = useFieldIssues(path);
  const id = useId();
  const noteId = `${id}-note`;

  return (
    <div
      ref={(el) => registerField(path, el)}
      data-field-path={path}
      className={cn('min-w-0', className)}
    >
      <label htmlFor={id} className="mb-1.5 flex items-baseline gap-1.5 text-[13px] font-medium text-ink">
        <span>{label}</span>
        {required && (
          <span className="text-danger" aria-label="required">
            *
          </span>
        )}
      </label>
      {children({ id, describedBy: visible.length ? noteId : undefined, invalid: Boolean(error) })}
      {hint && !visible.length && <p className="mt-1 text-[12px] text-faint">{hint}</p>}
      <div id={noteId}>
        {visible.map((issue) => (
          <IssueNote key={issue.key} issue={issue} />
        ))}
      </div>
    </div>
  );
}

const controlBase =
  'w-full rounded-lg border bg-surface px-3 py-2 text-[14px] text-ink placeholder:text-faint transition ' +
  'hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-60';

function controlClass(invalid: boolean, extra?: string) {
  return cn(controlBase, invalid ? 'border-danger/60 bg-danger-soft/40' : 'border-line', extra);
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

interface TextProps {
  path: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  type?: 'text' | 'date' | 'datetime-local' | 'number' | 'tel' | 'email';
  className?: string;
  inputClassName?: string;
  maxLength?: number;
}

export function TextField({
  path,
  label,
  value,
  onChange,
  required,
  hint,
  placeholder,
  type = 'text',
  className,
  inputClassName,
  maxLength,
}: TextProps) {
  const { revealField } = useStore();
  return (
    <FieldShell path={path} label={label} required={required} hint={hint} className={className}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          type={type}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => revealField(path)}
          className={controlClass(invalid, inputClassName)}
        />
      )}
    </FieldShell>
  );
}

export function TextareaField({
  path,
  label,
  value,
  onChange,
  required,
  hint,
  placeholder,
  rows = 4,
  className,
}: Omit<TextProps, 'type' | 'inputClassName' | 'maxLength'> & { rows?: number }) {
  const { revealField } = useStore();
  return (
    <FieldShell path={path} label={label} required={required} hint={hint} className={className}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          rows={rows}
          value={value}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => revealField(path)}
          className={controlClass(invalid, 'resize-y leading-relaxed')}
        />
      )}
    </FieldShell>
  );
}

/* ------------------------------------------------------------------ */
/* Select                                                              */
/* ------------------------------------------------------------------ */

interface SelectProps {
  path: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: CodeOption[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  className?: string;
  /** Show the code alongside the label, e.g. "20 — Residence / Home". */
  showCodes?: boolean;
}

/* ------------------------------------------------------------------ */
/* Select — a dropdown you can type into                               */
/* ------------------------------------------------------------------ */

interface TypeableProps extends SelectProps {
  /**
   * Whether a value the list does not contain may stand.
   *
   * Off for coded fields, where an unlisted value is a value the state will
   * reject. On where the list is a convenience over free text — body style is
   * the case that forced this: reports already hold "4-door sedan" typed by an
   * officer and "PK" copied off a registration return, and a control that
   * silently dropped those on first render would lose real evidence about real
   * cars.
   */
  allowFree?: boolean;
}

/**
 * A dropdown an officer can type into.
 *
 * Thirty-nine property descriptions and two hundred offence codes are not a
 * list anybody scrolls twice. Typing "burg" and pressing Enter is how this gets
 * used at three in the morning, and a plain select cannot do it.
 *
 * It shows the *label* while closed, because "Automobile" is what somebody is
 * looking for, and it keeps the code as the value, because that is what gets
 * filed. A value that is not on the list still shows — as itself — so nothing
 * already recorded disappears the day this list changes.
 */
export function SelectField({
  path,
  label,
  value,
  onChange,
  options,
  required,
  hint,
  placeholder = 'Type to search…',
  className,
  showCodes,
  allowFree,
}: TypeableProps) {
  const { revealField } = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const chosen = options.find((o) => o.value === value);
  const display = chosen ? (showCodes ? `${chosen.value} — ${chosen.label}` : chosen.label) : value;

  const matches = useMemo(() => {
    const q = (query ?? '').trim().toLowerCase();
    if (!q) return options;
    /*
      Anything the officer might type: the label, the code, and the hint. A
      search for "22" finds Burglary by its code; a search for "break" finds it
      by the hint that says what it covers.
    */
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.hint ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  // Clicking away closes it and gives up whatever was half-typed.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) {
        commit();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  });

  /** What a half-typed entry means once focus leaves. */
  function commit() {
    if (query === null) return;
    const typed = query.trim();
    setQuery(null);
    if (!typed) {
      onChange('');
      return;
    }
    const exact = options.find(
      (o) => o.label.toLowerCase() === typed.toLowerCase() || o.value.toLowerCase() === typed.toLowerCase(),
    );
    if (exact) {
      onChange(exact.value);
      return;
    }
    // One match left is what the officer meant; they narrowed it themselves.
    if (matches.length === 1) {
      onChange(matches[0].value);
      return;
    }
    if (allowFree) onChange(typed);
  }

  const pick = (option: CodeOption) => {
    onChange(option.value);
    setQuery(null);
    setOpen(false);
    revealField(path);
  };

  return (
    <FieldShell path={path} label={label} required={required} hint={hint} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="relative" ref={boxRef}>
          <input
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={open && matches[active] ? `${id}-opt-${active}` : undefined}
            autoComplete="off"
            value={query ?? display}
            placeholder={placeholder}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onFocus={() => {
              setOpen(true);
              setActive(0);
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onBlur={() => revealField(path)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
                setActive((i) => Math.min(i + 1, matches.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                if (open && matches[active]) {
                  e.preventDefault();
                  pick(matches[active]);
                }
              } else if (e.key === 'Escape') {
                // Back to what was there, rather than to nothing.
                setQuery(null);
                setOpen(false);
              } else if (e.key === 'Tab') {
                commit();
                setOpen(false);
              }
            }}
            className={controlClass(invalid, 'pr-9')}
          />
          <ChevronDown
            size={16}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint"
            aria-hidden
          />

          {open && (
            <ul
              id={`${id}-list`}
              role="listbox"
              className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg"
            >
              {matches.length === 0 && (
                <li className="px-3 py-2 text-[13px] text-faint">
                  {allowFree ? 'Nothing matches — it will be kept as typed.' : 'Nothing matches.'}
                </li>
              )}
              {matches.map((option, index) => (
                <li key={option.value}>
                  <button
                    type="button"
                    id={`${id}-opt-${index}`}
                    role="option"
                    aria-selected={option.value === value}
                    // Mouse down would blur the input and close the list first.
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(option)}
                    className={cn(
                      'flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[13.5px]',
                      index === active ? 'bg-accent-soft text-ink' : 'text-ink hover:bg-raised',
                    )}
                  >
                    {showCodes && (
                      <span className="shrink-0 font-mono text-[12px] text-faint">{option.value}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.value === value && <Check size={14} className="shrink-0 text-accent" aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </FieldShell>
  );
}

/* ------------------------------------------------------------------ */
/* Multi-select (chips)                                                */
/* ------------------------------------------------------------------ */

interface MultiProps {
  path: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: CodeOption[];
  required?: boolean;
  hint?: string;
  className?: string;
  columns?: number;
}

export function MultiSelectField({
  path,
  label,
  values,
  onChange,
  options,
  required,
  hint,
  className,
  columns = 2,
}: MultiProps) {
  const { revealField } = useStore();
  const toggle = useCallback(
    (value: string) => {
      revealField(path);
      onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
    },
    [values, onChange, path, revealField],
  );

  return (
    <FieldShell path={path} label={label} required={required} hint={hint} className={className}>
      {({ invalid }) => (
        <div
          className={cn(
            'grid gap-1.5 rounded-lg border p-2',
            invalid ? 'border-danger/60 bg-danger-soft/40' : 'border-line bg-surface',
          )}
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          role="group"
          aria-label={label}
        >
          {options.map((o) => {
            const active = values.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                aria-pressed={active}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[13px] transition',
                  active
                    ? 'border-accent/50 bg-accent-soft font-medium text-ink'
                    : 'border-transparent text-muted hover:bg-raised',
                )}
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded border',
                    active ? 'border-accent bg-accent text-white' : 'border-line-strong',
                  )}
                  aria-hidden
                >
                  {active && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="min-w-0 truncate">{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </FieldShell>
  );
}

/* ------------------------------------------------------------------ */
/* Toggle                                                              */
/* ------------------------------------------------------------------ */

export function ToggleField({
  path,
  label,
  description,
  checked,
  onChange,
}: {
  path: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const { registerField } = useStore();
  const { visible } = useFieldIssues(path);

  return (
    <div ref={(el) => registerField(path, el)} data-field-path={path}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition',
          checked ? 'border-accent/45 bg-accent-soft' : 'border-line bg-surface hover:bg-raised',
        )}
      >
        <span
          className={cn(
            'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition',
            checked ? 'bg-accent' : 'bg-line-strong',
          )}
          aria-hidden
        >
          <span
            className={cn(
              'size-4 rounded-full bg-white shadow transition-transform',
              checked && 'translate-x-4',
            )}
          />
        </span>
        <span className="min-w-0">
          <span className="block text-[13.5px] font-medium text-ink">{label}</span>
          {description && <span className="mt-0.5 block text-[12.5px] text-muted">{description}</span>}
        </span>
      </button>
      {visible.map((issue) => (
        <IssueNote key={issue.key} issue={issue} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Searchable combobox — used for the offense picker                   */
/* ------------------------------------------------------------------ */

interface ComboOption {
  value: string;
  label: string;
  group?: string;
  meta?: string;
}

export function ComboField({
  path,
  label,
  value,
  onChange,
  options,
  required,
  hint,
  placeholder = 'Search…',
  className,
}: {
  path: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  className?: string;
}) {
  const { revealField } = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.group ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, ComboOption[]>();
    for (const o of filtered) {
      const key = o.group ?? '';
      const list = map.get(key);
      if (list) list.push(o);
      else map.set(key, [o]);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <FieldShell path={path} label={label} required={required} hint={hint} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <button
            id={id}
            type="button"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            aria-expanded={open}
            aria-haspopup="listbox"
            onClick={() => {
              setOpen((o) => !o);
              setQuery('');
            }}
            onBlur={() => revealField(path)}
            className={controlClass(invalid, 'flex items-center justify-between gap-2 text-left')}
          >
            <span className={cn('min-w-0 truncate', !selected && 'text-faint')}>
              {selected ? (
                <>
                  <span className="font-mono text-[12.5px] text-muted">{selected.value}</span>
                  <span className="mx-1.5 text-faint">·</span>
                  {selected.label}
                </>
              ) : (
                placeholder
              )}
            </span>
            <ChevronDown size={16} className="shrink-0 text-faint" aria-hidden />
          </button>

          {open && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
              <div className="absolute z-40 mt-1.5 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-2xl shadow-black/25">
                <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Type to filter — try “burg”, “theft”, “assault”"
                    className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-faint"
                  />
                  {query && (
                    <button type="button" onClick={() => setQuery('')} className="text-faint hover:text-ink">
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto p-1">
                  {grouped.length === 0 && (
                    <p className="px-3 py-6 text-center text-[13px] text-faint">
                      Nothing matches “{query}”.
                    </p>
                  )}
                  {grouped.map(([group, items]) => (
                    <div key={group}>
                      {group && (
                        <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
                          {group}
                        </p>
                      )}
                      {items.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => {
                            onChange(o.value);
                            revealField(path);
                            setOpen(false);
                          }}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] transition',
                            o.value === value ? 'bg-accent-soft text-ink' : 'text-muted hover:bg-raised hover:text-ink',
                          )}
                        >
                          <span className="w-9 shrink-0 font-mono text-[12px] text-faint">{o.value}</span>
                          <span className="min-w-0 flex-1 truncate">{o.label}</span>
                          {o.meta && <span className="shrink-0 text-[11.5px] text-faint">{o.meta}</span>}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </FieldShell>
  );
}
