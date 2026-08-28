import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useStore as useStoreForAnchor } from '@/state/store';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:brightness-110 border-transparent',
  secondary: 'bg-surface text-ink border-line hover:bg-raised',
  ghost: 'bg-transparent text-muted border-transparent hover:bg-raised hover:text-ink',
  danger: 'bg-transparent text-danger border-transparent hover:bg-danger-soft',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-[12.5px] gap-1.5',
  md: 'h-9.5 px-3.5 text-[13.5px] gap-2',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg border font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-xl border border-line bg-surface', className)}>{children}</div>
  );
}

/** A titled block within a form section. */
export function Panel({
  title,
  description,
  aside,
  children,
  className,
}: {
  title: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-line bg-surface', className)}>
      <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
          {description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{description}</p>}
        </div>
        {aside}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** A repeating record (an offense, a person, a property item). */
export function RecordCard({
  index,
  title,
  subtitle,
  badge,
  onRemove,
  children,
}: {
  index: number;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  onRemove?: () => void;
  children: ReactNode;
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-surface">
      <header className="flex items-center gap-3 border-b border-line bg-raised px-4 py-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface text-[12px] font-semibold text-muted tabular ring-1 ring-line">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-[13.5px] font-semibold text-ink">{title}</h4>
          {subtitle && <p className="truncate text-[12px] text-muted">{subtitle}</p>}
        </div>
        {badge}
        {onRemove && (
          <Button variant="danger" size="sm" onClick={onRemove} aria-label={`Remove ${title}`}>
            <Trash2 size={14} />
          </Button>
        )}
      </header>
      <div className="p-4">{children}</div>
    </article>
  );
}

export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-transparent py-3 text-[13.5px] font-medium text-muted transition hover:border-accent hover:bg-accent-soft hover:text-accent"
    >
      <Plus size={16} aria-hidden />
      {label}
    </button>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-raised text-faint">{icon}</div>
      <h4 className="text-[14px] font-semibold text-ink">{title}</h4>
      <p className="mt-1 max-w-md text-[13px] leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const TONES = {
  neutral: 'bg-raised text-muted ring-line',
  accent: 'bg-accent-soft text-accent ring-accent/30',
  danger: 'bg-danger-soft text-danger ring-danger/30',
  warn: 'bg-warn-soft text-warn ring-warn/30',
  ok: 'bg-ok-soft text-ok ring-ok/30',
} as const;

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function FieldGrid({ cols = 2, children }: { cols?: number; children: ReactNode }) {
  return (
    <div
      className="grid gap-x-4 gap-y-4"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

/**
 * Registers a section-level focus anchor, so issues that belong to a whole
 * section (rather than one field) still have somewhere to jump to.
 */
export function SectionAnchor({ section, children }: { section: string; children: ReactNode }) {
  const { registerField } = useStoreForAnchor();
  return (
    <div ref={(el) => registerField(section, el)} data-field-path={section} className="space-y-4">
      {children}
    </div>
  );
}
