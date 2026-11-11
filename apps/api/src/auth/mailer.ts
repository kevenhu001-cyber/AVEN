import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { ApiEnvironment } from '@aven/config/env';

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  kind: 'verify_email' | 'reset_password';
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

export function createMailer(env: ApiEnvironment): Mailer {
  if (env.APP_ENV !== 'production' && env.AUTH_DEV_MODE === 'true') {
    return new DevFileMailer(env.AUTH_MAIL_DIR);
  }
  return new UnconfiguredMailer();
}
