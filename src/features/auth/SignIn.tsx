import { useState } from 'react';
import { AlertCircle, Loader2, LogIn, Shield, TriangleAlert } from 'lucide-react';
import { useStore } from '@/state/store';
import { DEMO_PASSWORD } from '@/state/seed';
import { Button } from '@/components/ui/primitives';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

export function SignIn() {
  const { signIn, agency } = useStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await signIn(username, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.reason ?? 'Could not sign in.');
      setPassword('');
    }
  };

  const control =
    'w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[14px] text-ink placeholder:text-faint';

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex shrink-0 justify-end p-4">
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-start justify-center px-6 pt-[6vh]">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-white">
              <Shield size={20} aria-hidden />
            </span>
            <div>
              <h1 className="text-[17px] font-semibold tracking-tight text-ink">Aegis RMS</h1>
              <p className="text-[12.5px] text-muted">
                {agency.name || 'Records Management System'}
              </p>
            </div>
          </div>

          <form onSubmit={submit} className="rounded-xl border border-line bg-surface p-5">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink">Username</span>
              <input
                autoFocus
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={control}
              />
            </label>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={control}
              />
            </label>

            {error && (
              <p className="mt-4 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-[13px] leading-relaxed text-danger">
                <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
                {error}
              </p>
            )}

            <Button
              variant="primary"
              className="mt-5 w-full"
              disabled={busy || !username.trim() || !password}
              onClick={() => void submit()}
            >
              {busy ? (
                <>
                  <Loader2 size={15} className="animate-spin" aria-hidden />
                  Checking…
                </>
              ) : (
                <>
                  <LogIn size={15} aria-hidden />
                  Sign in
                </>
              )}
            </Button>
            {/* Button renders type="button", so Enter needs its own submit target. */}
            <button type="submit" className="hidden" aria-hidden tabIndex={-1}>
              Sign in
            </button>
          </form>

          <DemoNotice />
        </div>
      </main>
    </div>
  );
}

/**
 * The honest label. Verification here runs in the browser, where the person
 * being checked controls the code doing the checking — so this screen is a
 * workflow, not a lock, until it is backed by a server.
 */
function DemoNotice() {
  const { users } = useStore();
  return (
    <div className="mt-4 rounded-xl border border-warn/30 bg-warn-soft/50 p-4">
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-warn">
        <TriangleAlert size={13} aria-hidden />
        Prototype — not a security boundary
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
        Passwords are hashed correctly, but the check runs in your browser, so anyone can bypass it
        with dev tools. Real authentication needs the same code behind an API. Sign in with any of
        these and the password <code className="rounded bg-surface px-1 font-mono">{DEMO_PASSWORD}</code>:
      </p>
      <ul className="mt-2 space-y-0.5">
        {users
          .filter((u) => u.active)
          .map((user) => (
            <li key={user.id} className="text-[12px] text-muted">
              <code className="font-mono text-ink">{user.username}</code> — {user.name}
            </li>
          ))}
      </ul>
    </div>
  );
}
