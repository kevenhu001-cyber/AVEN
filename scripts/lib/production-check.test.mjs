import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionIssues } from './production-check.mjs';
const env = {
  APP_ENV: 'production',
  AUTH_DEV_MODE: 'false',
  WEB_ORIGIN: 'https://aven.example.test',
  AUTH_IP_SALT: 's'.repeat(32),
  AI_USER_CONFIG_KEY: Buffer.alloc(32, 1).toString('base64'),
  AVEN_APP_PASSWORD: 'a'.repeat(24),
  AVEN_AUTH_PASSWORD: 'b'.repeat(24),
  AVEN_WORKER_PASSWORD: 'c'.repeat(24),
  REDIS_PASSWORD: 'd'.repeat(24),
  AI_PROVIDER: 'mock',
};
test('accepts explicit production configuration', () =>
  assert.deepEqual(productionIssues(env), []));
test('rejects insecure origins and development identity', () => {
  const errors = productionIssues({
    ...env,
    WEB_ORIGIN: 'http://aven.example.test',
    AUTH_DEV_MODE: 'true',
  });
  assert.ok(errors.includes('WEB_ORIGIN'));
  assert.ok(errors.includes('AUTH_DEV_MODE'));
});
test('rejects reused database passwords and malformed encryption keys', () => {
  const errors = productionIssues({
    ...env,
    AI_USER_CONFIG_KEY: 'secret',
    AVEN_AUTH_PASSWORD: env.AVEN_APP_PASSWORD,
  });
  assert.ok(errors.includes('AI_USER_CONFIG_KEY'));
  assert.ok(errors.includes('DISTINCT_DATABASE_PASSWORDS'));
});
test('does not report secret values', () => {
  const errors = productionIssues({ ...env, REDIS_PASSWORD: 'private-value' });
  assert.deepEqual(errors, ['REDIS_PASSWORD']);
});

test('rejects a privileged runtime database connection without printing it', () => {
  assert.deepEqual(
    productionIssues({
      ...env,
      DATABASE_URL: 'postgres://aven_migrator:private-password@db.example.test/aven',
    }),
    ['DATABASE_URL_ROLE'],
  );
});
