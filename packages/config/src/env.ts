import { z } from 'zod';

const AppEnvironmentSchema = z.enum(['development', 'test', 'production']);
const PortSchema = z.coerce.number().int().min(1).max(65535);
const HostSchema = z.enum(['127.0.0.1', '0.0.0.0', '::1']);
const OriginSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    ['http:', 'https:'].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash
  );
}, 'Expected an HTTP(S) origin without credentials, path, or query.');

function parseEnvironment<T>(schema: z.ZodType<T>, input: Record<string, unknown>): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    // Never include raw input values: these may eventually contain credentials.
    throw new Error(`Invalid environment fields: ${names.join(', ')}`);
  }
  return result.data;
}

const ApiEnvironmentSchema = z
  .object({
    APP_ENV: AppEnvironmentSchema.default('development'),
    API_HOST: HostSchema.default('127.0.0.1'),
    API_PORT: PortSchema.default(3001),
    WEB_ORIGIN: OriginSchema.default('http://localhost:3000'),
    AUTH_DEV_MODE: z.enum(['true', 'false']).default('false'),
    AUTH_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    AUTH_IP_SALT: z.string().min(16).optional(),
    AUTH_MAIL_DIR: z.string().min(1).default('.data/mail'),
  })
  .superRefine((env, context) => {
    if (env.APP_ENV === 'production' && !env.WEB_ORIGIN.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['WEB_ORIGIN'],
        message: 'Production requires HTTPS.',
      });
    }
    if (env.APP_ENV === 'production' && env.AUTH_DEV_MODE === 'true') {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_DEV_MODE'],
        message: 'Development authentication mode is not allowed in production.',
      });
    }
    if (env.APP_ENV === 'production' && !env.AUTH_IP_SALT) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_IP_SALT'],
        message: 'Production requires AUTH_IP_SALT.',
      });
    }
  });

const WorkerEnvironmentSchema = z.object({
  APP_ENV: AppEnvironmentSchema.default('development'),
  WORKER_HEALTH_HOST: HostSchema.default('127.0.0.1'),
  WORKER_HEALTH_PORT: PortSchema.default(3002),
});

export type ApiEnvironment = z.infer<typeof ApiEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof WorkerEnvironmentSchema>;

export function parseApiEnvironment(input: Record<string, unknown>): ApiEnvironment {
  return parseEnvironment(ApiEnvironmentSchema, input);
}
export function parseWorkerEnvironment(input: Record<string, unknown>): WorkerEnvironment {
  return parseEnvironment(WorkerEnvironmentSchema, input);
}
export function parseApiOrigin(value: string): string {
  return OriginSchema.parse(value).replace(/\/$/, '');
}

export function redisUrl(): string {
  const host = process.env.REDIS_HOST ?? '127.0.0.1';
  const port = process.env.REDIS_PORT ?? '6379';
  const password = process.env.REDIS_PASSWORD;
  if (!password) throw new Error('Missing REDIS_PASSWORD.');
  return `redis://:${encodeURIComponent(password)}@${host}:${port}`;
}

const OptionalMailText = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);
const MailEnvironmentSchema = z
  .object({
    AUTH_MAIL_TRANSPORT: z.enum(['file', 'smtp', 'disabled']).optional(),
    SMTP_HOST: OptionalMailText,
    SMTP_PORT: PortSchema.default(465),
    SMTP_SECURE: z.enum(['true', 'false']).default('true'),
    SMTP_USER: OptionalMailText,
    SMTP_PASS: OptionalMailText,
    SMTP_FROM: z.preprocess((value) => (value === '' ? undefined : value), z.email().optional()),
  })
  .superRefine((env, context) => {
    if (env.AUTH_MAIL_TRANSPORT !== 'smtp') return;
    for (const name of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'] as const) {
      if (!env[name])
        context.addIssue({ code: 'custom', path: [name], message: 'Required for SMTP.' });
    }
    if (env.SMTP_HOST && /[\s\r\n]/.test(env.SMTP_HOST))
      context.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'Invalid host.' });
  });
export type MailEnvironment = z.infer<typeof MailEnvironmentSchema>;
export function parseMailEnvironment(input: Record<string, unknown>): MailEnvironment {
  return parseEnvironment(MailEnvironmentSchema, input);
}
