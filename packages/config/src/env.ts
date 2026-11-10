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
    AUTH_DEV_MODE: z.literal('false').default('false'),
  })
  .superRefine((env, context) => {
    if (env.APP_ENV === 'production' && !env.WEB_ORIGIN.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['WEB_ORIGIN'],
        message: 'Production requires HTTPS.',
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
