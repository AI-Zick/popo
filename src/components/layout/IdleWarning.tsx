import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock } from 'lucide-react';
import { useStore } from '@/state/store';
import { api } from '@/state/api';
import { countdown, idleCheck, IDLE_TIMEOUT_MS, type IdleCheck } from '@/domain/session';
import { Button } from '@/components/ui/primitives';

/**
 * Two minutes' notice before a session ends.
 *
 * Sessions end after thirty minutes idle, enforced on the server, which is the
 * control CJIS asks for and is not up for negotiation. What was wrong was that
 * it happened silently: an officer came back to a sign-in screen with no idea
 * whether what they had typed survived, and no chance to have prevented it.
 *
 * ## What counts as being there
 *
 * A key or a deliberate press. Not mouse movement, and this matters: a laptop
 * bolted into a car is jogged at every pothole, and a timeout that any
 * vibration defeats is not a timeout. Movement is the machine being moved;
 * a keystroke is somebody using it.
 *
 * ## Two clocks
 *
 * The server marks a session used when a request arrives. An officer writing a
 * long narrative may not cause one for half an hour, so local activity sends a
 * cheap request when the browser has been quiet with the server for five
 * minutes. Without that they would be warned by their own browser, press the
 * button, and find the server had already given up.
 */
export function IdleWarning() {
  const { isAuthenticated, signOut } = useStore();
  const activity = useRef(Date.now());
  const contact = useRef(Date.now());
  const [state, setState] = useState<IdleCheck>({
    standing: 'active',
    msLeft: IDLE_TIMEOUT_MS,
    keepAlive: false,
  });

  const ping = useCallback(() => {
    contact.current = Date.now();
    void api.me().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    activity.current = Date.now();
    contact.current = Date.now();

    const seen = () => {
      activity.current = Date.now();
    };
    /*
      Deliberately not mousemove or scroll. See the note above — a jogged
      laptop must not count as somebody being at it.
    */
    window.addEventListener('keydown', seen, { passive: true });
    window.addEventListener('pointerdown', seen, { passive: true });

    const tick = window.setInterval(() => {
      const check = idleCheck(activity.current, contact.current, Date.now());
      setState(check);
      if (check.keepAlive) ping();
      /*
        Signed out here rather than left to fail on the next request. The
        alternative is somebody pressing Save and being told they are not
        signed in, which is the same outcome delivered at the worst moment.
      */
      if (check.standing === 'over') void signOut();
    }, 1000);

    return () => {
      window.removeEventListener('keydown', seen);
      window.removeEventListener('pointerdown', seen);
      window.clearInterval(tick);
    };
  }, [isAuthenticated, ping, signOut]);

  if (!isAuthenticated || state.standing !== 'warning') return null;

  return createPortal(
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="You are about to be signed out"
      className="fixed inset-x-0 bottom-0 z-[60] flex justify-center p-4 print:hidden"
    >
      <div className="flex w-full max-w-md flex-wrap items-center gap-3 rounded-xl border border-warn/50 bg-surface px-4 py-3 shadow-xl">
        <Clock size={18} className="shrink-0 text-warn" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-ink">
            Signing you out in <span className="tabular">{countdown(state.msLeft)}</span>
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
            Nothing you have saved is affected. Anything you are part-way through writing is not
            saved yet.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            activity.current = Date.now();
            ping();
          }}
        >
          Stay signed in
        </Button>
      </div>
    </div>,
    document.body,
  );
}
