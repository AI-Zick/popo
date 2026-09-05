import { useEffect, useState } from 'react';
import { AlertCircle, Check, KeyRound, Loader2 } from 'lucide-react';
import { useStore } from '@/state/store';
import { api, DEMO } from '@/state/api';
import { checkPassword, MIN_PASSWORD_LENGTH } from '@/domain/credentials';
import { Button, Panel } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * Changing your own password, because you want to.
 *
 * The machinery has been here all along — the route, the policy, the audit
 * entry — but the only screen that reached it was the one forced on somebody
 * signing in with a password an administrator had issued. So the ordinary
 * case had no door: an officer who thinks a colleague watched them type it had
 * to ask an administrator to reset it, which means telling somebody why, and
 * that is exactly the conversation that ends with the password not being
 * changed.
 *
 * Collapsed until it is wanted. A settings screen where the first thing on it
 * is three empty password boxes reads as something being wrong.
 */
export function YourPassword() {
  const { changePassword, currentUser } = useStore();
  const [changedAt, setChangedAt] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const readStatus = () =>
    void api.passwordStatus().then(
      (status) => setChangedAt(status.changedAt),
      // Not knowing when it last changed is no reason to hide the form.
      () => setChangedAt(''),
    );
  useEffect(readStatus, []);

  const policy = checkPassword(next, {
    username: currentUser.username,
    name: currentUser.name,
  });
  const matches = next.length > 0 && next === confirm;
  const ready = current.length > 0 && policy.ok && matches;

  const close = () => {
    setOpen(false);
    setCurrent('');
    setNext('');
    setConfirm('');
    setError('');
  };

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    const result = await changePassword(current, next);
    setBusy(false);
    if (result.ok) {
      /*
        Cleared immediately. A form that keeps the old and new password in
        three boxes after a success is three boxes somebody walks away from.
      */
      close();
      setDone(true);
      readStatus();
      window.setTimeout(() => setDone(false), 6000);
    } else {
      setError(result.reason ?? 'Could not change the password.');
    }
  };

  return (
    <Panel
      title="Your password"
      description="Change it whenever you want to. You do not need a reason, and nobody is told one."
      aside={<KeyRound size={17} className="text-faint" aria-hidden />}
    >
      {/*
        Said only once it is known. "Never changed" while the answer is still
        in flight is a claim about somebody's account that may be false.
      */}
      {changedAt !== null && (
        <p className="text-[12.5px] text-muted">
          {changedAt
            ? `Last changed ${relativeTime(changedAt)}.`
            : 'Still on the password this account was issued.'}
        </p>
      )}

      {done && (
        <p className="mt-3 flex items-center gap-2 rounded-lg border border-ok/40 bg-ok-soft px-3 py-2 text-[13px] text-ok">
          <Check size={15} aria-hidden />
          Your password has been changed.
        </p>
      )}

      {DEMO ? (
        /*
          Said before the form rather than after it. The demo shares one
          password between everybody who opens the link, so letting somebody
          fill in three boxes and then refusing wastes the only thing a
          demonstration has.
        */
        <p className="mt-3 rounded-lg border border-warn/45 bg-warn/5 p-3 text-[12.5px] leading-relaxed text-warn">
          Not in the demonstration — everyone who opens the link shares one
          password. On a real installation this is where you change yours.
        </p>
      ) : !open ? (
        <Button className="mt-3" onClick={() => setOpen(true)}>
          <KeyRound size={15} aria-hidden />
          Change password
        </Button>
      ) : (
        <form onSubmit={submit} className="mt-3 max-w-sm space-y-3">
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

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={control}
            />
            {/*
              The rule, before it is broken rather than after — a policy that
              only speaks up on submit is one somebody hits three times. One
              line at a time, though: the hint and the refusal say almost the
              same sentence, and stacking them reads as the screen repeating
              itself rather than answering.
            */}
            {next.length === 0 ? (
              <span className="mt-1.5 block text-[12px] leading-relaxed text-faint">
                At least {MIN_PASSWORD_LENGTH} characters. Three or four unrelated words beat
                P@ssw0rd and are easier to type on a car keyboard.
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
              /* Said, rather than left to be inferred from the warning going away. */
              <span className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ok">
                <Check size={13} aria-hidden />
                That one will do.
              </span>
            )}
          </label>

          <label className="block">
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
            <p className="flex items-start gap-2 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
              <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={!ready || busy}>
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
              {busy ? 'Changing…' : 'Change it'}
            </Button>
            <Button type="button" onClick={close} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

const control =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink placeholder:text-faint';
