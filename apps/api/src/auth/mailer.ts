import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { parseMailEnvironment, type ApiEnvironment } from '@aven/config/env';
import nodemailer, { type Transporter } from 'nodemailer';

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  kind: 'verify_email' | 'reset_password' | 'invite_organization';
};

export interface Mailer {
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}

/** Development-only file sink. The directory is gitignored and never served. */
export class DevFileMailer implements Mailer {
  readonly configured = true;

  constructor(private readonly directory: string) {}

  async send(message: MailMessage): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const file = resolve(this.directory, `${Date.now()}-${randomUUID()}.json`);
    await writeFile(
      file,
      `${JSON.stringify({ ...message, created_at: new Date().toISOString() }, null, 2)}\n`,
      { mode: 0o600 },
    );
  }
}

export class UnconfiguredMailer implements Mailer {
  readonly configured = false;

  async send(): Promise<void> {
    throw new Error('EMAIL_NOT_CONFIGURED');
  }
}

/** SMTP credentials stay in server configuration; provider errors never escape. */
export class SmtpMailer implements Mailer {
  readonly configured = true;
  constructor(
    private readonly transport: Pick<Transporter, 'sendMail'>,
    private readonly from: string,
  ) {}
  async send(message: MailMessage): Promise<void> {
    try {
      const result = await this.transport.sendMail({
        from: { name: 'AVEN', address: this.from },
        to: message.to,
        subject: message.subject,
        text: message.text,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (result.rejected?.length) throw new Error('Recipient rejected.');
    } catch {
      throw new Error('EMAIL_DELIVERY_FAILED');
    }
  }
}

export function smtpTransport(input: Record<string, unknown>) {
  const config = parseMailEnvironment({ ...input, AUTH_MAIL_TRANSPORT: 'smtp' });
  return nodemailer.createTransport({
    host: config.SMTP_HOST!,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE === 'true',
    requireTLS: config.SMTP_SECURE !== 'true',
    auth: { user: config.SMTP_USER!, pass: config.SMTP_PASS! },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}
export function createMailer(
  env: ApiEnvironment,
  input: Record<string, unknown> = process.env,
): Mailer {
  const config = parseMailEnvironment(input);
  if (config.AUTH_MAIL_TRANSPORT === 'smtp')
    return new SmtpMailer(smtpTransport(input), config.SMTP_FROM!);
  if (config.AUTH_MAIL_TRANSPORT === 'disabled') return new UnconfiguredMailer();
  if (
    env.APP_ENV !== 'production' &&
    env.AUTH_DEV_MODE === 'true' &&
    (!config.AUTH_MAIL_TRANSPORT || config.AUTH_MAIL_TRANSPORT === 'file')
  )
    return new DevFileMailer(env.AUTH_MAIL_DIR);
  return new UnconfiguredMailer();
}
