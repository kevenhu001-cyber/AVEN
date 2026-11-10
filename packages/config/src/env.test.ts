import { describe, expect, it } from 'vitest';
import { parseApiEnvironment, parseApiOrigin, parseWorkerEnvironment } from './env';

describe('environment boundaries', () => {
  it('supplies safe development defaults without requiring secrets', () => {
    expect(parseApiEnvironment({})).toMatchObject({
      API_HOST: '127.0.0.1',
      API_PORT: 3001,
      AUTH_DEV_MODE: 'false',
    });
    expect(parseWorkerEnvironment({}).WORKER_HEALTH_PORT).toBe(3002);
  });
  it.each(['0', '-1', '65536', 'not-a-number', '3001.2'])('rejects invalid port %s', (port) => {
    expect(() => parseApiEnvironment({ API_PORT: port })).toThrow('API_PORT');
  });
  it('never echoes secret-bearing invalid values', () => {
    expect(() =>
      parseApiEnvironment({ WEB_ORIGIN: 'https://user:private-password@example.org' }),
    ).toThrow('Invalid environment fields: WEB_ORIGIN');
  });
  it('does not silently enable the unimplemented developer identity', () => {
    expect(() => parseApiEnvironment({ AUTH_DEV_MODE: 'true' })).toThrow('AUTH_DEV_MODE');
  });
  it('requires a secure production web origin', () => {
    expect(() => parseApiEnvironment({ APP_ENV: 'production' })).toThrow('WEB_ORIGIN');
    expect(
      parseApiEnvironment({ APP_ENV: 'production', WEB_ORIGIN: 'https://aven.example' }).APP_ENV,
    ).toBe('production');
  });
  it.each([
    'file:///tmp/app',
    'https://example.org/private',
    'https://example.org?token=secret',
    'https://example.org#private',
  ])('rejects a non-origin URL %s', (origin) => {
    expect(() => parseApiOrigin(origin)).toThrow();
  });
});
