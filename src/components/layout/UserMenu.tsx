import { useState } from 'react';
import { ChevronDown, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { useStore } from '@/state/store';
import { effectivePermissions, isDesignated, PERMISSION_LABEL, ROLE_LABEL } from '@/domain/auth';
import { msUntilIdleTimeout } from '@/domain/session';
import { Button } from '@/components/ui/primitives';

/** Who is signed in, what they may do, and the way out. */
export function UserMenu() {
  const { currentUser, session, signOut } = useStore();
  const [open, setOpen] = useState(false);
  const idleMinutes = Math.ceil(msUntilIdleTimeout(session) / 60_000);

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
            <div className="border-b border-line px-3 py-2.5">
              <p className="text-[13px] font-medium text-ink">{currentUser.name}</p>
              <p className="mt-0.5 text-[12px] text-muted">
                <span className="font-mono">{currentUser.username}</span> ·{' '}
                {ROLE_LABEL[currentUser.role]}
              </p>
              {session && (
                <p className="mt-1 text-[11.5px] text-faint">
                  Signs out automatically after {idleMinutes} more{' '}
                  {idleMinutes === 1 ? 'minute' : 'minutes'} idle.
                </p>
              )}
            </div>

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

            <div className="border-t border-line p-2">
              <Button
                className="w-full"
                onClick={() => {
                  setOpen(false);
                  signOut();
                }}
              >
                <LogOut size={14} aria-hidden />
                Sign out
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
