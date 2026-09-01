import { useState } from 'react';
import { AlertCircle, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { useStore } from '@/state/store';
import { checkPassword, MIN_PASSWORD_LENGTH } from '@/domain/credentials';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * Forced at first sign-in on any password an administrator issued, so a
 * temporary password handed over in person does not become the permanent one.
 */
export function ChangePassword() {
  const { changePassword, signOut, currentUser } = useStore();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const policy = checkPassword(next, {
    username: currentUser.username,
    name: currentUser.name,
  });
  const matches = next.length > 0 && next === confirm;
  const ready = current.length > 0 && policy.ok && matches;

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const result = await changePassword(current, next);
    setBusy(false);
    if (!result.ok) setError(result.reason ?? 'Could not change the password.');
  };

  const control =
    'w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[14px] text-ink placeholder:text-faint';

  return (
    <div className="flex h-full items-start justify-center bg-canvas px-6 pt-[6vh]">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-white">
            <KeyRound size={19} aria-hidden />
          </span>
          <div>
            <h1 className="text-[17px] font-semibold tracking-tight text-ink">
              Choose a new password
            </h1>
            <p className="text-[12.5px] text-muted">
              Your account is using a password someone else issued.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="rounded-xl border border-line bg-surface p-5">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">Current password</span>
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={control}
            />
          </label>

          <label className="mt-4 block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={control}
            />
          </label>

          <label className="mt-4 block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">Type it again</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={cn(control, confirm && !matches && 'border-danger/60')}
            />
            {confirm && !matches && (
              <span className="mt-1 block text-[12.5px] text-danger">
                These do not match.
              </span>
            )}
          </label>

          <div className="mt-4 rounded-lg bg-raised p-3">
            <p className="text-[12.5px] font-medium text-ink">
              At least {MIN_PASSWORD_LENGTH} characters
            </p>
            {next.length > 0 && policy.problems.length > 0 ? (
              <ul className="mt-1.5 space-y-1">
                {policy.problems.map((problem) => (
                  <li key={problem} className="text-[12.5px] leading-relaxed text-danger">
                    {problem}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                Length beats complexity. Three or four unrelated words is stronger than P@ssw0rd
                and far easier to type on a car keyboard.
              </p>
            )}
            {next.length > 0 && policy.ok && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-ok">
                <ShieldCheck size={13} aria-hidden />
                This one is fine.
              </p>
            )}
          </div>

          {error && (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-[13px] leading-relaxed text-danger">
              <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <div className="mt-5 flex gap-2">
            <Button onClick={signOut}>Sign out</Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={!ready || busy}
              onClick={() => void submit()}
            >
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
              Set password
            </Button>
          </div>
          <button type="submit" className="hidden" aria-hidden tabIndex={-1}>
            Set password
          </button>
        </form>
      </div>
    </div>
  );
}
