import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { useStore } from '@/state/store';
import {
  checkMail,
  emptyMailSettings,
  TOKEN_MINUTES,
  type MailSettings,
} from '@/domain/passwordReset';
import { Badge, Panel } from '@/components/ui/primitives';
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
  const check = checkMail(mail);

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

        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink">Password</span>
          <input
            type="password"
            value={mail.password}
            disabled={!mayEdit}
            onChange={(e) => set({ password: e.target.value })}
            placeholder={mail.username ? '••••••••' : ''}
            className={field}
            autoComplete="off"
          />
          {/*
            Never read back. The server keeps the stored one when this arrives
            empty, so leaving it alone changes nothing.
          */}
          <span className="mt-1 block text-[11.5px] text-faint">
            Stored, never shown again. Leave it empty to keep the one already saved.
          </span>
        </label>

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
