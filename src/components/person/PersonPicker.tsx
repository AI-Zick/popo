import { useMemo, useState } from 'react';
import { Search, UserPlus, X } from 'lucide-react';
import { useStore } from '@/state/store';
import { displayName, formalName, type MasterPerson, type PersonRole } from '@/domain/person';
import { PERSON_ROLES } from '@/domain/codes';
import { Badge, Button } from '@/components/ui/primitives';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * Adds someone the agency already knows about. This is the path that makes a
 * shared index worth having: the officer types two letters of a name rather
 * than re-keying a date of birth and address that are already on file.
 */
export function PersonPicker({ onClose }: { onClose: () => void }) {
  const { searchPeople, addExistingPerson, historyFor, incident } = useStore();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<PersonRole>('witness');

  const alreadyOnReport = useMemo(
    () => new Set((incident?.persons ?? []).map((p) => p.masterId)),
    [incident],
  );

  const results = useMemo(() => searchPeople(query, 40), [searchPeople, query]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-6 pt-[8vh]">
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Add a person from the index"
      >
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="text-[14px] font-semibold text-ink">Add someone already in the system</h2>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-faint transition hover:bg-raised hover:text-ink"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="relative flex-1">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, date of birth, address, phone, licence…"
              className="w-full rounded-lg border border-line bg-canvas py-2 pl-9 pr-3 text-[13.5px] text-ink placeholder:text-faint"
            />
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-muted">
            Add as
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as PersonRole)}
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] text-ink"
            >
              {PERSON_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-3 py-10 text-center text-[13px] text-faint">
              {query
                ? `Nobody in the index matches “${query}”.`
                : 'The index is empty. People are added to it automatically as you write reports.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {results.map((master) => (
                <li key={master.id}>
                  <PersonRow
                    master={master}
                    caseCount={historyFor(master.id).length}
                    disabled={alreadyOnReport.has(master.id)}
                    onAdd={() => {
                      addExistingPerson(master.id, role);
                      onClose();
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function PersonRow({
  master,
  caseCount,
  disabled,
  onAdd,
}: {
  master: MasterPerson;
  caseCount: number;
  disabled: boolean;
  onAdd: () => void;
}) {
  const details = [
    master.dob ? `DOB ${formatDate(master.dob)}` : null,
    master.address || null,
    master.phone || null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition',
        disabled
          ? 'cursor-not-allowed border-transparent opacity-50'
          : 'border-transparent hover:border-line hover:bg-raised',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-medium text-ink">{formalName(master)}</span>
          {master.cautions.map((c) => (
            <Badge key={c} tone="danger">
              {c}
            </Badge>
          ))}
        </span>
        {details && <span className="mt-0.5 block truncate text-[12px] text-muted">{details}</span>}
      </span>
      <span className="shrink-0 text-[11.5px] text-faint tabular">
        {caseCount} {caseCount === 1 ? 'case' : 'cases'}
      </span>
      {disabled ? (
        <span className="shrink-0 text-[11.5px] text-faint">On this report</span>
      ) : (
        <UserPlus size={15} className="shrink-0 text-accent" aria-hidden />
      )}
    </button>
  );
}

/** Opens the picker. */
export function AddExistingPersonButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Search size={15} aria-hidden />
        Add from index
      </Button>
      {open && <PersonPicker onClose={() => setOpen(false)} />}
    </>
  );
}

export { displayName };
