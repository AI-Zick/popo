import { useState } from 'react';
import { Check, ChevronDown, ShieldCheck, UserRound } from 'lucide-react';
import { useStore } from '@/state/store';
import { effectivePermissions, isDesignated, PERMISSION_LABEL, ROLE_LABEL } from '@/domain/auth';
import { cn } from '@/lib/cn';

/**
 * Who is signed in. A real deployment authenticates properly; this switcher
 * exists so the permission boundaries are visible while the app is a
 * prototype — the difference between a patrol officer and a supervisor is
 * otherwise invisible until something is refused.
 */
export function UserMenu() {
  const { users, currentUser, signInAs } = useStore();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-left transition hover:bg-raised"
      >
        <UserRound size={15} className="shrink-0 text-muted" aria-hidden />
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-medium text-ink">
            {currentUser.name}
          </span>
          <span className="block truncate text-[11px] text-faint">
            {ROLE_LABEL[currentUser.role]}
          </span>
        </span>
        <ChevronDown size={14} className="shrink-0 text-faint" aria-hidden />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-50 mt-1.5 w-80 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
            <p className="border-b border-line px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wider text-faint">
              Signed in as
            </p>
            <ul className="p-1">
              {users.map((user) => {
                const active = user.id === currentUser.id;
                const designated = isDesignated(user, 'notes.retract');
                return (
                  <li key={user.id}>
                    <button
                      type="button"
                      onClick={() => {
                        signInAs(user.id);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition',
                        active ? 'bg-accent-soft' : 'hover:bg-raised',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">
                          {user.name}{' '}
                          <span className="font-normal text-faint">#{user.badge}</span>
                        </span>
                        <span className="mt-0.5 block text-[11.5px] text-muted">
                          {ROLE_LABEL[user.role]}
                          {designated && ' · designated to withdraw notes'}
                        </span>
                      </span>
                      {active && <Check size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="border-t border-line px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-faint">
                <ShieldCheck size={12} aria-hidden />
                Permissions held
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {effectivePermissions(currentUser).map((permission) => (
                  <li key={permission} className="text-[12px] text-muted">
                    {PERMISSION_LABEL[permission]}
                    {isDesignated(currentUser, permission) && (
                      <span className="ml-1.5 rounded bg-accent-soft px-1 text-[10.5px] text-accent">
                        designated
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
