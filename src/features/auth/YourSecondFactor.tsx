import { useEffect, useState } from 'react';
import { LifeBuoy, Loader2, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { api } from '@/state/api';
import { LOW_RECOVERY_CODES } from '@/domain/mfa';
import { Button, Panel } from '@/components/ui/primitives';
import { EnrolStep } from './SecondFactor';

/**
 * Your own second factor, from inside the app.
 *
 * The reason this exists is the most ordinary thing that happens to a second
 * factor: somebody gets a new phone. Without a way to move it themselves, the
 * only route is an administrator clearing the factor entirely — the loud back
 * door meant for a phone at the bottom of a lake, not for an upgrade. It is
 * also where a fresh set of recovery codes comes from, which matters to anyone
 * who has spent a few.
 *
 * Nothing here can turn the factor off. Enrolling again replaces it; only an
 * administrator can remove it, and that is on purpose.
 */
export function YourSecondFactor() {
  const [status, setStatus] = useState<{
    enrolled: boolean;
    recoveryRemaining: number;
    required: boolean;
  } | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    void api.mfaStatus().then(setStatus, () => setStatus(null));
  }, []);

  /*
    Confirming enrolment puts the new recovery codes in the store, and the app
    shows them over the top of everything until they are acknowledged — the
    same screen a first enrolment ends on. So there is nothing to do here
    afterwards but step back out of the form.
  */
  if (enrolling) {
    return (
      <Panel
        title="Your second factor"
        description={status?.enrolled ? 'Moving it to a different phone.' : 'Setting it up.'}
      >
        <EnrolStep replacing={Boolean(status?.enrolled)} />
        <button
          type="button"
          onClick={() => setEnrolling(false)}
          className="mt-3 text-[12.5px] text-muted transition hover:text-ink"
        >
          Leave it as it is
        </button>
      </Panel>
    );
  }

  return (
    <Panel
      title="Your second factor"
      description="The code your authenticator app shows when you sign in."
      aside={<ShieldCheck size={17} className="text-faint" aria-hidden />}
    >
      {!status ? (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 size={15} className="animate-spin" aria-hidden />
          Checking…
        </p>
      ) : (
        <div className="space-y-3">
          {status.enrolled ? (
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-ink">
              <Smartphone size={15} className="mt-0.5 shrink-0 text-ok" aria-hidden />
              An authenticator app is set up on this account.
            </p>
          ) : (
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-ink">
              <ShieldOff size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden />
              {status.required
                ? 'Nothing is set up yet. You will be asked to at your next sign-in.'
                : 'Nothing is set up. This agency does not insist on it, but a password on its own is one stolen note away from somebody else reading case files as you.'}
            </p>
          )}

          {status.enrolled && (
            <p
              className={
                status.recoveryRemaining <= LOW_RECOVERY_CODES
                  ? 'flex items-start gap-2 text-[13px] leading-relaxed text-warn'
                  : 'flex items-start gap-2 text-[13px] leading-relaxed text-muted'
              }
            >
              <LifeBuoy size={15} className="mt-0.5 shrink-0" aria-hidden />
              {status.recoveryRemaining === 0
                ? 'No recovery codes left. Set it up again to get a fresh set — without one, a lost phone means asking an administrator.'
                : `${status.recoveryRemaining} recovery ${status.recoveryRemaining === 1 ? 'code' : 'codes'} left.`}
            </p>
          )}

          <Button onClick={() => setEnrolling(true)}>
            <Smartphone size={14} aria-hidden />
            {status.enrolled ? 'Set it up on a new phone' : 'Set it up now'}
          </Button>

          {status.enrolled && (
            <p className="text-[12px] leading-relaxed text-faint">
              Your current phone keeps working until the new one is confirmed. Turning the second
              factor off altogether is something only an administrator can do, and it is written to
              the audit log when they do.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
