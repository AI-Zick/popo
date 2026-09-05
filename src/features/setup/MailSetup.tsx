import { CheckCircle2, Plus, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useStore } from '@/state/store';
import { api } from '@/state/api';
import {
  checkPattern,
  DEFAULT_PATTERN,
  isTimeOfDay,
  sayTime,
} from '@/domain/shift';
import {
  checkMail,
  emptyMailSettings,
  TOKEN_MINUTES,
  type MailSettings,
} from '@/domain/passwordReset';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * Where the agency's mail goes out through.
 *
 * There is exactly one thing this software sends by email — a link to set a
 * new password — and the screen says so, because an agency handing over
 * credentials for a mail account deserves to know what will be sent through it
 * and how often. It is not a notification system and this is not the beginning
 * of one.
 *
 * Ships blank and reads as blank, in the same way the statute pack ships
 * unverified and the county GIS ships untested. An unconfigured mail server
 * that looked configured would produce the worst outcome this feature has:
 * somebody locked out at two in the morning, told a link is on its way, and
 * waiting for an email that was never going to arrive. Until this is filled
 * in, the sign-in screen offers no reset at all.
 */
export function MailSetup() {
  const { agency, updateAgency, can } = useStore();
  const mayEdit = can('agency.configure');
  const mail = agency.mail ?? emptyMailSettings();

  /*
    Asked of the server rather than assumed, because the answer lives in its
    environment and nothing in the database can know it.
  */
  const [hasPassword, setHasPassword] = useState(false);
  useEffect(() => {
    void api.mailPasswordSet().then(
      (r) => setHasPassword(r.set),
      () => setHasPassword(false),
    );
  }, []);

  const check = checkMail(mail, { hasPassword });

  const set = (patch: Partial<MailSettings>) => updateAgency({ mail: { ...mail, ...patch } });

  const field =
    'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13.5px] text-ink placeholder:text-faint disabled:opacity-60';

  return (
    <Panel
      title="Sending email"
      description="Used for one thing only: the link that lets somebody set a new password when they have forgotten theirs."
      aside={
        check.ok ? (
          <Badge tone="ok">
            <span className="flex items-center gap-1">
              <CheckCircle2 size={12} aria-hidden />
              Configured
            </span>
          </Badge>
        ) : (
          <Badge tone="warn">Not set up</Badge>
        )
      }
    >
      {!check.ok && (
        <div className="mb-4 rounded-lg border border-warn/45 bg-warn/5 p-3">
          <p className="flex items-start gap-1.5 text-[12.5px] font-medium text-warn">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
            Nobody can reset their own password on this installation yet.
          </p>
          <ul className="mt-1.5 space-y-0.5 pl-5 text-[12px] leading-relaxed text-warn/90">
            {check.problems.map((problem) => (
              <li key={problem} className="list-disc">
                {problem}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Until it is filled in, the sign-in screen does not offer a reset — an offer that goes
            nowhere is worse than none. Administrators can still issue accounts.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink">Mail server</span>
          <input
            value={mail.host}
            disabled={!mayEdit}
            onChange={(e) => set({ host: e.target.value })}
            placeholder="smtp.your-county.gov"
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink">Port</span>
          <input
            type="number"
            value={mail.port}
            disabled={!mayEdit}
            onChange={(e) => set({ port: Number(e.target.value) })}
            className={field}
          />
          <span className="mt-1 block text-[11.5px] text-faint">
            587 with STARTTLS is usual. 465 is implicit TLS.
          </span>
        </label>

        <label className="flex items-start gap-2 pt-7">
          <input
            type="checkbox"
            checked={mail.secure}
            disabled={!mayEdit}
            onChange={(e) => set({ secure: e.target.checked })}
            className="mt-0.5"
          />
          <span className="text-[12.5px] leading-snug text-ink">
            Implicit TLS
            <span className="mt-0.5 block text-[11.5px] text-faint">
              Tick this for port 465. Leave it off for 587.
            </span>
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink">Username</span>
          <input
            value={mail.username}
            disabled={!mayEdit}
            onChange={(e) => set({ username: e.target.value })}
            placeholder="Leave empty if the relay needs none"
            className={field}
          />
        </label>

        {/*
          Not a field. The relay password is a deployment secret and lives in
          the environment with the TLS material, because everything typed on
          this screen is stored in the database — and a database is copied to
          backups, restored onto other machines, and readable by anybody who
          holds the disk.
        */}
        <div className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink">Password</span>
          <p className={cn(field, 'flex items-center gap-1.5 text-[12.5px] text-muted')}>
            {hasPassword ? (
              <>
                <CheckCircle2 size={13} className="shrink-0 text-ok" aria-hidden />
                Supplied by the server
              </>
            ) : (
              <>
                <TriangleAlert size={13} className="shrink-0 text-warn" aria-hidden />
                None reached the server
              </>
            )}
          </p>
          <span className="mt-1 block text-[11.5px] leading-relaxed text-faint">
            Set as <code className="font-mono">AEGIS_SMTP_PASSWORD</code> where the server runs.
            Not typed here, because this screen writes to the database.
          </span>
        </div>

        <label className="col-span-2 block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink">From address</span>
          <input
            value={mail.from}
            disabled={!mayEdit}
            onChange={(e) => set({ from: e.target.value })}
            placeholder="no-reply@your-county.gov"
            className={field}
          />
        </label>

        <label className="col-span-2 block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink">
            Address of this installation
          </span>
          <input
            value={mail.baseUrl}
            disabled={!mayEdit}
            onChange={(e) => set({ baseUrl: e.target.value })}
            placeholder="https://rms.your-county.gov"
            className={cn(field, 'font-mono')}
          />
          {/*
            Configuration rather than something worked out from the request:
            a link built from a Host header is a link somebody can aim at their
            own server simply by asking for a reset.
          */}
          <span className="mt-1 block text-[11.5px] leading-relaxed text-faint">
            Where reset links point. Taken from here rather than from the browser, so that a link
            cannot be aimed somewhere else by whoever asks for it.
          </span>
        </label>
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-muted">
        A link lasts {TOKEN_MINUTES} minutes and works once. It sets a password and does not sign
        anybody in — the authenticator code is still asked for afterwards, so a mailbox somebody
        else has got into is not a way into this system.
      </p>
    </Panel>
  );
}

/**
 * When the agency changes over.
 *
 * Lives beside the mail settings rather than on its own screen because both
 * are one-line facts about how the department runs, and a settings screen per
 * field is how nineteen tabs happened.
 *
 * Three eights until somebody says otherwise. A briefing screen that refuses
 * to draw until this is configured is a screen nobody sees, and boundaries an
 * hour out are visible and fixable in a way that a blank page is not.
 */
export function ShiftSetup() {
  const { agency, updateAgency, can } = useStore();
  const mayEdit = can('agency.configure');
  const pattern = agency.shifts ?? DEFAULT_PATTERN;
  const problems = checkPattern(pattern);
  const isDefault =
    pattern.starts.join() === DEFAULT_PATTERN.starts.join() &&
    pattern.names.join() === DEFAULT_PATTERN.names.join();

  const set = (starts: string[], names: string[]) => updateAgency({ shifts: { starts, names } });
  const setOne = (index: number, patch: { start?: string; name?: string }) => {
    const starts = [...pattern.starts];
    const names = [...pattern.names];
    if (patch.start !== undefined) starts[index] = patch.start;
    if (patch.name !== undefined) names[index] = patch.name;
    set(starts, names);
  };

  const field =
    'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13.5px] text-ink placeholder:text-faint disabled:opacity-60';

  return (
    <Panel
      title="Shifts"
      description="When one shift hands over to the next. Used to work out which shift a call belongs to, and what the briefing covers."
      aside={isDefault ? <Badge tone="warn">Default</Badge> : undefined}
    >
      {isDefault && (
        <p className="mb-3 rounded-lg border border-warn/45 bg-warn/5 p-3 text-[12.5px] leading-relaxed text-warn">
          These are the times this software ships with, not this agency&apos;s. Until they are
          changed, the briefing draws its boundaries at 7am, 3pm and 11pm.
        </p>
      )}

      <ul className="space-y-2">
        {pattern.starts.map((start, index) => (
          <li key={index} className="flex items-center gap-2">
            <input
              type="time"
              value={start}
              disabled={!mayEdit}
              onChange={(e) => setOne(index, { start: e.target.value })}
              aria-label={`Shift ${index + 1} starts`}
              className={cn(field, 'w-32')}
            />
            <input
              value={pattern.names[index] ?? ''}
              disabled={!mayEdit}
              onChange={(e) => setOne(index, { name: e.target.value })}
              placeholder="What it is called"
              aria-label={`Shift ${index + 1} name`}
              className={field}
            />
            <span className="w-24 shrink-0 text-[11.5px] text-faint">
              {isTimeOfDay(start) ? sayTime(start) : ''}
            </span>
            {mayEdit && pattern.starts.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  set(
                    pattern.starts.filter((_, i) => i !== index),
                    pattern.names.filter((_, i) => i !== index),
                  )
                }
                aria-label={`Remove shift ${index + 1}`}
                className="rounded p-1 text-faint hover:text-danger"
              >
                <X size={14} aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>

      {mayEdit && (
        <Button className="mt-3" onClick={() => set([...pattern.starts, '00:00'], [...pattern.names, ''])}>
          <Plus size={14} aria-hidden />
          Another shift
        </Button>
      )}

      {problems.length > 0 && (
        <ul className="mt-3 space-y-1">
          {problems.map((problem) => (
            <li
              key={problem.message}
              className="flex items-start gap-1.5 text-[12px] leading-relaxed text-warn"
            >
              <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                {problem.message}
                {problem.tip && <span className="block text-muted">{problem.tip}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/*
        Said explicitly, because it is the one thing about this that surprises
        people: the shift starting at 11pm is one shift, not two, and a call at
        2am belongs to the night that began the evening before.
      */}
      <p className="mt-4 text-[12px] leading-relaxed text-muted">
        A shift that crosses midnight is treated as one shift. A call at two in the morning belongs
        to the shift that started the evening before, not to the new calendar day.
      </p>
    </Panel>
  );
}
