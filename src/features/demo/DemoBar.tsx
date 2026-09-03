import { useState } from 'react';
import { FlaskConical, RotateCcw, UserRound, X } from 'lucide-react';
import { useStore } from '@/state/store';
import { ROLE_LABEL } from '@/domain/auth';
import { DEMO_PASSWORD } from '@/state/seed';
import { cn } from '@/lib/cn';

/**
 * The bar across the top of the published demo.
 *
 * Two jobs. It says, permanently and without a way to dismiss it, that this is
 * a demonstration holding invented data — a records system that looks real
 * enough to evaluate is real enough for somebody to type a real name into, and
 * this has no multi-factor authentication and keeps nothing.
 *
 * And it lets a tester become somebody else in one click. Half of what is
 * worth showing here is what one person cannot do: an officer cannot approve
 * their own report, whoever proposes a destruction order cannot carry it out,
 * only a property clerk moves an item off the shelf. Making somebody sign out
 * and back in to see that is making them not see it.
 */
export function DemoBar() {
  const { users, currentUser, signIn } = useStore();
  const [switching, setSwitching] = useState(false);
  const [busy, setBusy] = useState(false);

  const become = async (username: string) => {
    setBusy(true);
    // signIn re-reads the whole state for the new identity.
    await signIn(username, DEMO_PASSWORD);
    setBusy(false);
    setSwitching(false);
  };

  return (
    <div className="relative z-40 border-b border-warn/40 bg-warn-soft">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-warn">
          <FlaskConical size={14} aria-hidden />
          Demonstration
        </span>
        <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink/80">
          The agency, the people and every record in here are invented. It runs in your browser
          only — nothing is saved, nothing is sent anywhere, and it all resets when you reload.{' '}
          <strong className="font-semibold">Do not enter real information.</strong>
        </span>

        <button
          type="button"
          onClick={() => setSwitching((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-warn/45 bg-surface px-2.5 py-1 text-[12px] font-medium text-ink transition hover:bg-raised"
        >
          <UserRound size={13} aria-hidden />
          {currentUser.name} · {ROLE_LABEL[currentUser.role]}
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          title="Back to the starting data"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-warn/45 bg-surface px-2.5 py-1 text-[12px] font-medium text-ink transition hover:bg-raised"
        >
          <RotateCcw size={13} aria-hidden />
          Start over
        </button>
      </div>

      {switching && (
        <div className="border-t border-warn/35 bg-surface px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="text-[12.5px] font-medium text-ink">Sign in as somebody else</p>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setSwitching(false)}
              aria-label="Close"
              className="rounded p-1 text-faint transition hover:bg-raised hover:text-ink"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
            Much of what this software does is decide what one person may not do on their own.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {users
              .filter((u) => u.active)
              .map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    disabled={busy || u.id === currentUser.id}
                    onClick={() => void become(u.username)}
                    className={cn(
                      'rounded-lg border px-2.5 py-1.5 text-left text-[12px] transition disabled:opacity-50',
                      u.id === currentUser.id
                        ? 'border-accent/45 bg-accent-soft'
                        : 'border-line bg-canvas hover:bg-raised',
                    )}
                  >
                    <span className="block font-medium text-ink">{u.name}</span>
                    <span className="block text-[11px] text-muted">{ROLE_LABEL[u.role]}</span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
