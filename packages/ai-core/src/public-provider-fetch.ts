import type { IncomingMessage } from 'node:http';
import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { Agent, request } from 'node:https';
import { Readable, Transform, type TransformCallback } from 'node:stream';

export function isPublicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export function publicProviderUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '443') ||
    isIP(host) === 6 ||
    (isIP(host) === 4 && !isPublicIPv4(host)) ||
    !host.includes('.') ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)$/.test(host)
  )
    throw new Error('PUBLIC_HTTPS_PROVIDER_REQUIRED');
  return url.href.replace(/\/+$/, '');
}
export async function resolvePublicProviderAddress(
  hostname: string,
  resolver = lookup,
): Promise<string> {
  const addresses = await resolver(hostname, { family: 4, all: true });
  if (!addresses.length || addresses.some((item) => !isPublicIPv4(item.address)))
    throw new Error('PROVIDER_ADDRESS_REJECTED');
  return addresses[0]!.address;
}
const safeLookup: LookupFunction = (hostname, _options, callback) => {
  void resolvePublicProviderAddress(hostname).then(
    (address) => callback(null, address, 4),
    () =>
      callback(Object.assign(new Error('PROVIDER_ADDRESS_REJECTED'), { code: 'ENOTFOUND' }), '', 4),
  );
};
/** DNS validation is bound to the actual TLS connection; no redirects or environment proxies. */
export const publicProviderFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  publicProviderUrl(url.href);
  if (init?.method !== 'POST' || typeof init.body !== 'string')
    throw new Error('PROVIDER_REQUEST_REJECTED');
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  headers['accept-encoding'] = 'identity';
  const agent = new Agent({
    keepAlive: false,
    family: 4,
    autoSelectFamily: false,
    lookup: safeLookup,
  });
  return new Promise<Response>((resolve, reject) => {
    let responseBody: IncomingMessage | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      agent.destroy();
    };
    const req = request(
      url,
      { method: 'POST', headers, agent, ...(init.signal ? { signal: init.signal } : {}) },
      (response) => {
        responseBody = response;
        try {
          const status = response.statusCode ?? 502;
          if (status < 200 || status > 599 || (status >= 300 && status < 400))
            throw new Error('PROVIDER_RESPONSE_REJECTED');
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers))
            if (value !== undefined)
              responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
          let bytes = 0;
          const bounded = new Transform({
            transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback) {
              if (!Buffer.isBuffer(chunk)) {
                callback(new Error('PROVIDER_RESPONSE_REJECTED'));
                return;
              }
              bytes += chunk.length;
              if (bytes > 1048576) {
                callback(new Error('PROVIDER_RESPONSE_TOO_LARGE'));
                return;
              }
              callback(null, chunk);
            },
          });
          bounded.once('error', () => {
            response.destroy();
            cleanup();
          });
          bounded.once('close', () => {
            response.destroy();
            cleanup();
          });
          response.once('error', () => bounded.destroy(new Error('PROVIDER_RESPONSE_INTERRUPTED')));
          response.once('close', cleanup);
          response.pipe(bounded);
          resolve(
            new Response(
              status === 204 ? null : (Readable.toWeb(bounded) as ReadableStream<Uint8Array>),
              { status, headers: responseHeaders },
            ),
          );
        } catch {
          response.destroy();
          cleanup();
          reject(new Error('PROVIDER_RESPONSE_REJECTED'));
        }
      },
    );
    req.once('error', (error) => {
      responseBody?.destroy();
      cleanup();
      reject(error);
    });
    const timer = setTimeout(() => {
      req.destroy(new Error('PROVIDER_TOTAL_TIMEOUT'));
      responseBody?.destroy();
      cleanup();
    }, 60000);
    timer.unref();
    req.end(init.body);
  });
};
