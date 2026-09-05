import { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, Check, KeyRound, Loader2, Mail } from 'lucide-react';
import { api, ApiError } from '@/state/api';
import { checkPassword, MIN_PASSWORD_LENGTH } from '@/domain/credentials';
import { REQUEST_ACKNOWLEDGED, TOKEN_MINUTES } from '@/domain/passwordReset';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

const control =
  'w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[14px] text-ink placeholder:text-faint';

/**
 * "I cannot sign in."
 *
 * Two screens, and the second one is reached from an email rather than from
 * here. Both are deliberately outside the signed-in application: somebody
 * using them has no session and, by definition, cannot get one.
 *
 * The thing worth reading is what this screen does *not* say. It never
 * confirms that an address matched an account, because a police agency's
 * roster is exactly what somebody preparing a phishing run wants, and "no such
 * user" hands it over one guess at a time. So the acknowledgement is written
 * to be true whether or not anything was sent.
 */
export function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [who, setWho] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!who.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.forgotPassword(who.trim());
      setSent(true);
    } catch (problem) {
      /*
        Only the failures that are facts about the installation reach here —
        no mail server, or the server refused the message. Anything about
        whether the account exists is answered identically by the route.
      */
      setError(
        problem instanceof ApiError || problem instanceof Error
          ? problem.message
          : 'That did not work.',
      );
    }
    setBusy(false);
  };

  return (
    <Shell title="Can't sign in?" onBack={onBack}>
      {sent ? (
        <>
          <p className="flex items-start gap-2 rounded-lg border border-ok/40 bg-ok-soft px-3 py-2.5 text-[13px] leading-relaxed text-ok">
            <Check size={15} className="mt-0.5 shrink-0" aria-hidden />
            {REQUEST_ACKNOWLEDGED}
          </p>
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
            Setting a new password does not sign you in. You will still be asked for your
            authenticator code afterwards — which is why a link on its own is not enough to reach
            your account.
          </p>
          <Button className="mt-4 w-full justify-center" onClick={onBack}>
            Back to signing in
          </Button>
        </>
      ) : (
        <form onSubmit={submit}>
          <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
            Type your username or your work email address. If there is an address on your account,
            a link to set a new password is sent to it.
          </p>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">
              Username or email address
            </span>
            <input
              autoFocus
              value={who}
              onChange={(e) => setWho(e.target.value)}
              autoComplete="username"
              className={control}
            />
          </label>

          {error && (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2.5 text-[13px] leading-relaxed text-danger">
              <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <Button
            variant="primary"
            className="mt-5 w-full justify-center"
            disabled={!who.trim() || busy}
            onClick={() => void submit()}
          >
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Mail size={15} aria-hidden />}
            Send me a link
          </Button>
          <button type="submit" className="hidden" aria-hidden tabIndex={-1}>
            Send
          </button>
        </form>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* The screen the link opens                                           */
/* ------------------------------------------------------------------ */

/**
 * Setting the password from a mailed link.
 *
 * Checks the link before drawing the form. Somebody holding a dead link should
 * be told immediately, not after choosing a password, typing it twice and
 * pressing a button.
 *
 * Finishing does not sign anybody in — deliberately, and the screen says so.
 * That is the property that makes mailing a link acceptable here at all: a
 * stolen mailbox yields a password and still meets the second factor.
 */
export function ResetPassword({ token, onDone }: { token: string; onDone: () => void }) {
  const [state, setState] = useState<'checking' | 'ok' | 'bad'>('checking');
  const [name, setName] = useState('');
  const [linkError, setLinkError] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.checkResetLink(token).then(
      (result) => {
        if (cancelled) return;
        if (result.ok) {
          setName(result.name ?? '');
          setState('ok');
        } else {
          setLinkError(result.error ?? 'That link is no good.');
          setState('bad');
        }
      },
      () => {
        if (cancelled) return;
        setLinkError('That link could not be checked. Try it again in a moment.');
        setState('bad');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  const policy = checkPassword(next, { name });
  const matches = next.length > 0 && next === confirm;
  const ready = policy.ok && matches;

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.resetPassword(token, next);
      setDone(true);
    } catch (problem) {
      setError(
        problem instanceof ApiError || problem instanceof Error
          ? problem.message
          : 'That could not be saved.',
      );
    }
    setBusy(false);
  };

  if (state === 'checking') {
    return (
      <Shell title="Setting a new password" onBack={onDone}>
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 size={15} className="animate-spin" aria-hidden />
          Checking the link…
        </p>
      </Shell>
    );
  }

  if (state === 'bad') {
    return (
      <Shell title="That link is no good" onBack={onDone}>
        <p className="flex items-start gap-2 rounded-lg border border-warn/45 bg-warn/5 px-3 py-2.5 text-[13px] leading-relaxed text-warn">
          <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
          {linkError}
        </p>
        <Button className="mt-4 w-full justify-center" onClick={onDone}>
          Back to signing in
        </Button>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell title="Password set" onBack={onDone}>
        <p className="flex items-start gap-2 rounded-lg border border-ok/40 bg-ok-soft px-3 py-2.5 text-[13px] leading-relaxed text-ok">
          <Check size={15} className="mt-0.5 shrink-0" aria-hidden />
          Your password is set. Everywhere that was signed in on this account has been signed out.
        </p>
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
          Sign in with it now. You will be asked for your authenticator code as usual.
        </p>
        <Button variant="primary" className="mt-4 w-full justify-center" onClick={onDone}>
          Sign in
        </Button>
      </Shell>
    );
  }

  return (
    <Shell title="Set a new password" onBack={onDone}>
      {name && <p className="mb-4 text-[12.5px] text-muted">For {name}.</p>}
      <form onSubmit={submit}>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink">New password</span>
          <input
            autoFocus
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className={control}
          />
          {next.length === 0 ? (
            <span className="mt-1.5 block text-[12px] leading-relaxed text-faint">
              At least {MIN_PASSWORD_LENGTH} characters. Three or four unrelated words beat P@ssw0rd
              and are easier to type on a car keyboard.
            </span>
          ) : policy.problems.length > 0 ? (
            policy.problems.map((problem) => (
              <span
                key={problem}
                className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-warn"
              >
                <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden />
                {problem}
              </span>
            ))
          ) : (
            <span className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ok">
              <Check size={13} aria-hidden />
              That one will do.
            </span>
          )}
        </label>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink">
            New password again
          </span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={cn(control, confirm.length > 0 && !matches && 'border-warn/60')}
          />
          {confirm.length > 0 && !matches && (
            <span className="mt-1 block text-[12px] text-warn">These two do not match.</span>
          )}
        </label>

        {error && (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2.5 text-[13px] leading-relaxed text-danger">
            <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        <Button
          variant="primary"
          className="mt-5 w-full justifyate-center justify-center"
          disabled={!ready || busy}
          onClick={() => void submit()}
        >
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <KeyRound size={15} aria-hidden />}
          Set it
        </Button>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1}>
          Set it
        </button>
      </form>

      {/*
        Said before it happens rather than discovered afterwards. Somebody
        expecting to land inside the application will otherwise read the
        sign-in screen as the reset having failed.
      */}
      <p className="mt-4 text-[12px] leading-relaxed text-faint">
        This sets your password and sends you back to sign in — it does not sign you in. Your
        authenticator code is still needed, which is why a link on its own cannot reach your
        account. The link stops working once used, and lasts {TOKEN_MINUTES} minutes.
      </p>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */

function Shell({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-canvas">
      <main className="flex flex-1 items-start justify-center px-6 pt-[8vh]">
        <div className="w-full max-w-sm">
          <button
            type="button"
            onClick={onBack}
            className="mb-4 flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink"
          >
            <ArrowLeft size={14} aria-hidden />
            Signing in
          </button>
          <h1 className="text-[17px] font-semibold tracking-tight text-ink">{title}</h1>
          <div className="mt-4 rounded-xl border border-line bg-surface p-5">{children}</div>
        </div>
      </main>
    </div>
  );
}
