import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import { parseApiOrigin } from '@aven/config/env';

const apiOrigin = parseApiOrigin(process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001');
const root = resolve(__dirname, '../..');
// AVEN_WEB_MOCK=1 routes /api/v1/* to the in-app mock layer (apps/web/src/mocks) instead
// of the real API. Without the flag the rewrites run in beforeFiles, so the real API
// (or a connection failure) always wins and the mock handler is unreachable.
const webMockEnabled = process.env.AVEN_WEB_MOCK === '1';
const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  ...(webMockEnabled ? { devIndicators: false as const } : {}),
  outputFileTracingRoot: root,
  turbopack: { root },
  experimental: { cpus: 1 },
  async rewrites() {
    if (webMockEnabled) return [];
    return {
      beforeFiles: [
        { source: '/health/:path*', destination: `${apiOrigin}/health/:path*` },
        { source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` },
      ],
    };
  },
};
export default config;
