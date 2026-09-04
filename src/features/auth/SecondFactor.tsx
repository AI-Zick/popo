import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  LifeBuoy,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
} from 'lucide-react';
import { useStore } from '@/state/store';
import { formatSecret, LOW_RECOVERY_CODES } from '@/domain/mfa';
import { encodeQr, qrPath } from '@/lib/qr';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * The second half of signing in.
 *
 * Shown instead of the app while a session has passed a password and nothing
 * more. It is not what enforces anything — the server refuses every other
 * route for that session — it is what the officer sees while that is true.
 *
 * Two paths through it. Somebody already enrolled types six digits; somebody
 * who has never enrolled is walked through setting it up, because an agency
 * turning this on cannot ask three hundred officers to enrol in advance and
 * nobody should be locked out on the morning it is switched on.
 */
export function SecondFactor() {
  const { secondFactor, recoveryCodes, signOut } = useStore();
  if (!secondFactor && !recoveryCodes) return null;

  /*
    Recovery codes win over everything. By the time they exist the sign-in has
    already finished — the app is one state change away from rendering over
    them, and they cannot be shown again. No way off this screen but reading
    them, which is why there is no "sign in as somebody else" underneath it.
  */
  if (recoveryCodes) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas px-6 py-10">
        <div className="w-full max-w-md">
          <RecoveryCodes codes={recoveryCodes} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-canvas px-6 py-10">
      <div className="w-full max-w-md">
        {secondFactor!.enrolled ? <VerifyStep /> : <EnrolStep />}
        <button
          type="button"
          onClick={signOut}
          className="mt-4 w-full text-center text-[12.5px] text-muted transition hover:text-ink"
        >
          Sign in as somebody else
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function VerifyStep() {
  const { verifySecondFactor, useRecoveryCode, secondFactor } = useStore();
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = recovery ? await useRecoveryCode(code.trim()) : await verifySecondFactor(code.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.reason ?? 'That was not accepted.');
      setCode('');
    }
  };

  const ready = recovery ? code.trim().length >= 8 : /^\d{6}$/.test(code.replace(/\s/g, ''));

  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-center gap-2.5">
        <ShieldCheck size={18} className="text-accent" aria-hidden />
        <h1 className="text-[15px] font-semibold text-ink">One more step</h1>
      </div>

      {recovery ? (
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          Type one of the recovery codes you were given when you set this up. Each one works once.
        </p>
      ) : (
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          Open your authenticator app and type the six digits it shows for this agency.
        </p>
      )}

      <label className="mt-4 block">
        <span className="mb-1.5 block text-[13px] font-medium text-ink">
          {recovery ? 'Recovery code' : 'Six-digit code'}
        </span>
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ready && !busy) void submit();
          }}
          inputMode={recovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          placeholder={recovery ? 'ABCDE-FGHIJ' : '000000'}
          className={cn(
            'w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-ink placeholder:text-faint',
            recovery ? 'text-[15px] font-mono' : 'text-center text-[22px] tracking-[0.4em] tabular',
          )}
        />
      </label>

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-danger">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <Button
        variant="primary"
        className="mt-4 w-full justify-center"
        disabled={busy || !ready}
        onClick={() => void submit()}
      >
        {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />}
        Continue
      </Button>

      <button
        type="button"
        onClick={() => {
          setRecovery((v) => !v);
          setCode('');
          setError(null);
        }}
        className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-muted transition hover:text-ink"
      >
        <LifeBuoy size={13} aria-hidden />
        {recovery ? 'Use my authenticator app instead' : 'I do not have my phone'}
      </button>

      {recovery && secondFactor && secondFactor.recoveryRemaining <= LOW_RECOVERY_CODES && (
        <p className="mt-2 text-[12px] leading-relaxed text-warn">
          {secondFactor.recoveryRemaining} recovery{' '}
          {secondFactor.recoveryRemaining === 1 ? 'code' : 'codes'} left. Set your authenticator up
          again once you are in, to get a fresh set.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function EnrolStep({ replacing = false }: { replacing?: boolean }) {
  const { beginEnrolment, confirmEnrolment, agency } = useStore();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void beginEnrolment().then((result) => {
      if ('failed' in result) setUnavailable(result.failed);
      else setSetup(result);
    });
  }, [beginEnrolment]);

  /*
    A successful confirm needs no branch here. It puts the recovery codes in
    the store, and the store is what decides this screen is replaced by them.
  */
  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await confirmEnrolment(code.replace(/\s/g, ''));
    setBusy(false);
    if (!result.ok) {
      setError(result.reason ?? 'That code was not accepted.');
      setCode('');
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-center gap-2.5">
        <Smartphone size={18} className="text-accent" aria-hidden />
        <h1 className="text-[15px] font-semibold text-ink">
          {replacing ? 'Set it up on a new phone' : 'Set up your second factor'}
        </h1>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
        {replacing ? (
          <>
            Add this to the authenticator app on your new phone. Your old one keeps working until
            you finish, so a setup you abandon halfway cannot lock you out. Finishing issues a fresh
            set of recovery codes and retires the old ones.
          </>
        ) : (
          <>
            {agency.name || 'This agency'} requires more than a password to reach case information.
            Add this to an authenticator app — Google Authenticator, Microsoft Authenticator,
            1Password, Authy, any of them.
          </>
        )}
      </p>

      {unavailable ? (
        <p className="mt-4 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-danger">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
          {unavailable}
        </p>
      ) : !setup ? (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-muted">
          <Loader2 size={15} className="animate-spin" aria-hidden />
          Getting your setup key…
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-line bg-canvas p-4">
            <QrCode uri={setup.uri} />
            <p className="text-[12.5px] leading-relaxed text-muted">
              Point your phone at this. It fills in the agency name and your username for you.
            </p>
          </div>

          {/*
            The typed key is the fallback, not the headline — a desk machine
            without a camera nearby, or a scan that will not take. Folded away
            so it is there without being the first thing anybody reads.
          */}
          <details className="mt-2 group">
            <summary className="cursor-pointer list-none text-[12.5px] text-muted transition hover:text-ink">
              Cannot scan it?
            </summary>
            <div className="mt-2 rounded-xl border border-line bg-canvas p-4">
              <p className="text-[12px] font-medium uppercase tracking-wider text-faint">Setup key</p>
              <p className="mt-1.5 select-all break-all font-mono text-[15px] leading-relaxed text-ink">
                {formatSecret(setup.secret)}
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                In your app choose “enter a setup key” and type this. Name it{' '}
                <span className="text-ink">{agency.name || 'Aegis RMS'}</span>.
              </p>
            </div>
          </details>

          <label className="mt-4 block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">
              Then type the six digits it shows
            </span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) void confirm();
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-center text-[22px] tracking-[0.4em] text-ink placeholder:text-faint tabular"
            />
            <span className="mt-1.5 block text-[12px] leading-relaxed text-faint">
              Nothing is switched on until this works, so a key you did not manage to scan cannot
              lock you out.
            </span>
          </label>

          {error && (
            <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-danger">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <Button
            variant="primary"
            className="mt-4 w-full justify-center"
            disabled={busy || !/^\d{6}$/.test(code.replace(/\s/g, ''))}
            onClick={() => void confirm()}
          >
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <KeyRound size={15} aria-hidden />}
            Turn it on
          </Button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RecoveryCodes({ codes }: { codes: string[] }) {
  const { acknowledgeRecoveryCodes } = useStore();
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const asText = useMemo(() => codes.join('\n'), [codes]);

  return (
    <div className="rounded-2xl border border-warn/45 bg-surface p-6">
      <div className="flex items-center gap-2.5">
        <LifeBuoy size={18} className="text-warn" aria-hidden />
        <h1 className="text-[15px] font-semibold text-ink">Write these down now</h1>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
        These are how you get in if your phone is lost, broken or at home. Each one works once, and
        this is the only time they can be shown — they are stored hashed, so nobody, including an
        administrator, can read them back to you.
      </p>

      <ul className="mt-4 grid grid-cols-2 gap-1.5 rounded-xl border border-line bg-canvas p-3">
        {codes.map((code) => (
          <li key={code} className="select-all font-mono text-[13.5px] text-ink">
            {code}
          </li>
        ))}
      </ul>

      <Button
        className="mt-3 w-full justify-center"
        onClick={() => {
          void navigator.clipboard?.writeText(asText).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
        {copied ? 'Copied' : 'Copy them'}
      </Button>

      <label className="mt-4 flex cursor-pointer items-start gap-2 text-[13px] leading-relaxed text-ink">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5"
        />
        I have saved these somewhere I can get to without my phone.
      </label>

      <Button
        variant="primary"
        className="mt-3 w-full justify-center"
        disabled={!acknowledged}
        onClick={acknowledgeRecoveryCodes}
      >
        <Check size={15} aria-hidden />
        Done
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The provisioning URI, as something a phone camera can read.
 *
 * Drawn as one SVG path over a white plate, because a QR code on a dark
 * background does not scan and this screen has a dark mode.
 */
function QrCode({ uri }: { uri: string }) {
  const drawn = useMemo(() => {
    try {
      // Four modules of quiet zone, which is what the spec asks for and what
      // a scanner needs to find the edges against a coloured card.
      const quiet = 4;
      const qr = encodeQr(uri);
      return { path: qrPath(qr, quiet), extent: qr.size + quiet * 2 };
    } catch {
      // A URI too long to encode is a bug, not something to crash a sign-in
      // over: the typed key below still works.
      return null;
    }
  }, [uri]);

  if (!drawn) return null;

  return (
    <svg
      viewBox={`0 0 ${drawn.extent} ${drawn.extent}`}
      role="img"
      aria-label="Scan this with your authenticator app"
      className="h-44 w-44 rounded-lg bg-white"
      shapeRendering="crispEdges"
    >
      <path d={drawn.path} fill="#000" />
    </svg>
  );
}
