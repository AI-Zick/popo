import { useState } from 'react';
import { AlertCircle, Loader2, LogIn, Shield } from 'lucide-react';
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
 * Still honest, but the claim has changed: credentials are now verified by the
 * server and the session lives in a cookie the page cannot read. What remains
 * is deployment work, not a missing boundary.
 */
function DemoNotice() {
  return (
    <div className="mt-4 rounded-xl border border-line bg-surface p-4">
      <p className="text-[12.5px] font-semibold text-ink">Demo accounts</p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
        Seeded on first run, all with the password{' '}
        <code className="rounded bg-raised px-1 font-mono">{DEMO_PASSWORD}</code>. Each sees a
        different slice of the app.
      </p>
      <ul className="mt-2 space-y-0.5">
        {[
          ['mreyes', 'Patrol officer — writes reports, cannot withdraw notes'],
          ['dtam', 'Patrol officer designated to withdraw notes'],
          ['aboone', 'Supervisor — reads the audit log'],
          ['jokafor', 'Records clerk — approves redactions and public releases'],
          ['rvance', 'Agency administrator — manages accounts and setup'],
          ['platform', 'Vendor — provisions agency administrators'],
        ].map(([username, description]) => (
          <li key={username} className="text-[12px] text-muted">
            <code className="font-mono text-ink">{username}</code> — {description}
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-line pt-2.5 text-[11.5px] leading-relaxed text-faint">
        Passwords are verified on the server and the session is an httpOnly cookie, so this is a
        real boundary. Before live data it still needs TLS, CJIS-eligible hosting and credentials
        that were never printed on a screen.
      </p>
    </div>
  );
}
