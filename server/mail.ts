/**
 * Sending mail.
 *
 * One function, and a deliberate refusal.
 *
 * The refusal is the interesting half. An agency that has not configured a
 * mail server must fail *loudly and early* — before a link is minted, before
 * an officer is told one is on its way — because the alternative is the worst
 * outcome this feature has: somebody locked out, told to check their email,
 * checking it for twenty minutes, and there never having been an email. So
 * `send` throws on an unconfigured agency rather than returning quietly, and
 * the sign-in screen does not offer a reset at all until `canSendMail` is true.
 *
 * The password in the settings is write-only from the browser's side: it goes
 * in on save and is never sent back out. See the agency route.
 */

import { createTransport } from 'nodemailer';
import { canSendMail, type MailSettings } from '../src/domain/passwordReset';

export interface Message {
  to: string;
  subject: string;
  text: string;
}

export class MailNotConfigured extends Error {
  constructor() {
    super('No mail server is configured for this agency.');
    this.name = 'MailNotConfigured';
  }
}

/**
 * Where mail goes when there is no mail server, in development.
 *
 * Set AEGIS_MAIL_SINK to a file path and messages are appended to it instead
 * of being sent. This exists so the reset flow can be exercised end to end
 * without standing up an SMTP server, and it is deliberately opt-in by
 * environment variable: a sink that turned itself on when configuration was
 * missing would be the silent failure this module exists to avoid.
 */
const sink = (): string => process.env.AEGIS_MAIL_SINK ?? '';

export async function send(settings: MailSettings, message: Message): Promise<void> {
  if (sink()) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(
      sink(),
      `${JSON.stringify({ at: new Date().toISOString(), ...message })}\n`,
      'utf8',
    );
    return;
  }

  if (!canSendMail(settings)) throw new MailNotConfigured();

  const transport = createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: settings.username ? { user: settings.username, pass: settings.password } : undefined,
  });

  await transport.sendMail({
    from: settings.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
}
