import { describe, expect, it, vi } from 'vitest';
import {
  isPublicIPv4,
  publicProviderUrl,
  resolvePublicProviderAddress,
} from './public-provider-fetch.js';
describe('personal provider outbound policy', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '198.18.0.1',
    '203.0.113.1',
    '0.0.0.0',
    '255.255.255.255',
    '::1',
    '::ffff:127.0.0.1',
  ])('rejects private or reserved IP %s', (ip) => expect(isPublicIPv4(ip)).toBe(false));
  it('accepts public IPv4 and normalizes HTTPS', () => {
    expect(isPublicIPv4('8.8.8.8')).toBe(true);
    expect(publicProviderUrl('https://api.channel.org/v1/')).toBe('https://api.channel.org/v1');
  });
  it.each([
    'http://api.channel.org/v1',
    'https://127.0.0.1/v1',
    'https://2130706433/v1',
    'https://[::1]/v1',
    'https://api.channel.org:8443/v1',
    'https://user:key@api.channel.org/v1',
    'https://api.channel.org/v1?key=x',
    'https://api.channel.org/v1#key',
    'https://service.internal/v1',
  ])('rejects unsafe URLs: %s', (url) => expect(() => publicProviderUrl(url)).toThrow());
  it('rejects mixed DNS results instead of choosing only the public address', async () => {
    const resolver = vi.fn().mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(resolvePublicProviderAddress('api.channel.org', resolver)).rejects.toThrow();
  });
  it('returns the exact validated IPv4 address for the TLS connection', async () => {
    const resolver = vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    await expect(resolvePublicProviderAddress('api.channel.org', resolver)).resolves.toBe(
      '8.8.8.8',
    );
    expect(resolver).toHaveBeenCalledWith('api.channel.org', { family: 4, all: true });
  });
});
