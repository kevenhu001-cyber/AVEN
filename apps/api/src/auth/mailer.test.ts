import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseApiEnvironment, parseMailEnvironment } from '@aven/config/env';
import {
  createMailer,
  DevFileMailer,
  SmtpMailer,
  smtpTransport,
  UnconfiguredMailer,
} from './mailer';
const mocks = vi.hoisted(() => ({ send: vi.fn(), create: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: mocks.create } }));
const smtp = {
  AUTH_MAIL_TRANSPORT: 'smtp',
  SMTP_HOST: 'smtp.example.test',
  SMTP_USER: 'user',
  SMTP_PASS: 'private-secret',
  SMTP_FROM: 'sender@example.test',
};
beforeEach(() => {
  mocks.create.mockReset().mockReturnValue({ sendMail: mocks.send });
  mocks.send.mockReset().mockResolvedValue({ rejected: [] });
});
describe('transactional SMTP boundary', () => {
  it('requires complete configuration without echoing secrets', () => {
    expect(() =>
      parseMailEnvironment({ AUTH_MAIL_TRANSPORT: 'smtp', SMTP_PASS: 'private-secret' }),
    ).toThrow('SMTP_HOST');
    expect(() =>
      parseMailEnvironment({ ...smtp, SMTP_FROM: 'private-secret\r\nBcc: attacker@example.test' }),
    ).toThrow('SMTP_FROM');
    try {
      parseMailEnvironment({ ...smtp, SMTP_FROM: 'private-secret\r\nBcc: attacker@example.test' });
    } catch (error) {
      expect(String(error)).not.toContain('private-secret');
    }
  });
  it('uses verified TLS, finite timeouts and no protocol/body logging', () => {
    smtpTransport(smtp);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        secure: true,
        requireTLS: false,
        tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
        socketTimeout: 15000,
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
    );
    smtpTransport({ ...smtp, SMTP_SECURE: 'false', SMTP_PORT: '587' });
    expect(mocks.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ secure: false, requireTLS: true }),
    );
  });
  it('keeps development file sink explicit and never falls back in production', () => {
    const development = parseApiEnvironment({ AUTH_DEV_MODE: 'true' });
    expect(createMailer(development, {})).toBeInstanceOf(DevFileMailer);
    const production = parseApiEnvironment({
      APP_ENV: 'production',
      WEB_ORIGIN: 'https://aven.example',
      AUTH_IP_SALT: '0123456789abcdef',
    });
    expect(createMailer(production, { AUTH_MAIL_TRANSPORT: 'file' })).toBeInstanceOf(
      UnconfiguredMailer,
    );
    expect(createMailer(production, smtp)).toBeInstanceOf(SmtpMailer);
  });
  it('sends AVEN plain text without external assets or automatic retries', async () => {
    const mailer = createMailer(parseApiEnvironment({}), smtp);
    await mailer.send({
      to: 'recipient@example.test',
      subject: '重置 AVEN 密码',
      text: 'test-token-body',
      kind: 'reset_password',
    });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: 'AVEN', address: 'sender@example.test' },
        text: 'test-token-body',
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
    );
    mocks.send.mockRejectedValueOnce(new Error('SMTP private-secret recipient@example.test'));
    await expect(
      mailer.send({
        to: 'recipient@example.test',
        subject: 'reset',
        text: 'token',
        kind: 'reset_password',
      }),
    ).rejects.toThrow('EMAIL_DELIVERY_FAILED');
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
  it('does not report a rejected recipient as successful delivery', async () => {
    mocks.send.mockResolvedValueOnce({ rejected: ['recipient@example.test'] });
    await expect(
      createMailer(parseApiEnvironment({}), smtp).send({
        to: 'recipient@example.test',
        subject: 'reset',
        text: 'token',
        kind: 'reset_password',
      }),
    ).rejects.toThrow('EMAIL_DELIVERY_FAILED');
  });
});
