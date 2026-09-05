import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, LogOut, MonitorSmartphone } from 'lucide-react';
import { useStore } from '@/state/store';
import { api, ApiError, DEMO, type SignedInDevice } from '@/state/api';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * Where this account is signed in, and how to stop being.
 *
 * The question this answers is asked in one situation: somebody has left a
 * phone in a patrol car, or walked away from a terminal in a station they no
 * longer work at, and wants that session gone. Until now the only way was to
 * change the password, which ends every session including the one they are
 * using — a sledgehammer, and one that means telling everybody the password
 * changed.
 *
 * Two things this deliberately does not show. Anybody else's sessions: this is
 * not an administrative view and there is no version of it that lets one
 * officer look at another. And addresses: a per-session record of where an
 * officer was is nobody's business, kept for no operational reason, and
 * discoverable. The device description is coarse for the same reason — enough
 * to pick a row, not enough to follow somebody.
 */
export function YourDevices() {
  const { signOut } = useStore();
  const [devices, setDevices] = useState<SignedInDevice[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    let cancelled = false;
    api.sessions().then(
      (result) => {
        if (!cancelled) {
          setDevices(result.sessions);
          setError('');
        }
      },
      (problem: unknown) => {
        if (cancelled) return;
        setDevices([]);
        setError(
          problem instanceof ApiError || problem instanceof Error
            ? problem.message
            : 'That could not be read.',
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(load, [load]);

  const end = async (device: SignedInDevice) => {
    setBusy(device.id);
    setError('');
    try {
      const result = await api.endSession(device.id);
      /*
        Ending the current one is allowed, and means signing out. Refusing
        would mean somebody at a machine they are about to walk away from
        cannot use the obvious button on the screen in front of them.
      */
      if (result.signedOut) {
        await signOut();
        return;
      }
      load();
    } catch (problem) {
      setError(
        problem instanceof ApiError || problem instanceof Error
          ? problem.message
          : 'That did not work.',
      );
    }
    setBusy('');
  };

  return (
    <Panel
      title="Where you are signed in"
      description="Your own sessions, and nobody else's. Ending one signs that browser out at once."
      aside={<MonitorSmartphone size={17} className="text-faint" aria-hidden />}
    >
      {DEMO ? (
        <p className="rounded-lg border border-warn/45 bg-warn/5 p-3 text-[12.5px] leading-relaxed text-warn">
          Not in the demonstration — it runs in this one browser tab and there are no other
          sessions to show. On a real installation this lists every device signed in on your
          account, and ends the one you left in a patrol car.
        </p>
      ) : (
        <>
          {error && (
            <p className="mb-3 flex items-start gap-2 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
              <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          {devices === null ? (
            <p className="flex items-center gap-2 py-2 text-[13px] text-muted">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              Reading…
            </p>
          ) : devices.length === 0 ? (
            <p className="py-2 text-[13px] text-muted">Nothing to show.</p>
          ) : (
            <ul className="space-y-2">
              {devices.map((device) => (
                <li
                  key={device.id}
                  className={cn(
                    'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2.5',
                    device.current ? 'border-accent/40 bg-accent-soft/40' : 'border-line bg-surface',
                  )}
                >
                  <span className="text-[13.5px] font-medium text-ink">{device.device}</span>
                  {device.current && <Badge tone="ok">This browser</Badge>}
                  {/*
                    A half-finished sign-in is worth naming. It reaches nothing
                    but the second-factor screen, and somebody looking at this
                    list should not mistake it for a way in.
                  */}
                  {device.factor === 'password' && <Badge tone="warn">Second factor not given</Badge>}
                  <span className="text-[12px] text-muted">
                    Signed in {relativeTime(device.startedAt)} · last used{' '}
                    {relativeTime(device.lastSeenAt)}
                  </span>
                  <span className="flex-1" />
                  <Button
                    onClick={() => void end(device)}
                    disabled={busy === device.id}
                    aria-label={
                      device.current
                        ? 'Sign out of this browser'
                        : `End the session on ${device.device}`
                    }
                  >
                    {busy === device.id ? (
                      <Loader2 size={13} className="animate-spin" aria-hidden />
                    ) : (
                      <LogOut size={13} aria-hidden />
                    )}
                    {device.current ? 'Sign out here' : 'End it'}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-[12px] leading-relaxed text-faint">
            Sessions end by themselves after 30 minutes idle, or 12 hours whatever happens. Changing
            your password ends all of them at once.
          </p>
        </>
      )}
    </Panel>
  );
}
