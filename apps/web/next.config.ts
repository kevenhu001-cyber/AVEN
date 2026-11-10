import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import { parseApiOrigin } from '@aven/config/env';

const apiOrigin = parseApiOrigin(process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001');
const root = resolve(__dirname, '../..');
const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: root,
  turbopack: { root },
  experimental: { cpus: 1 },
  async rewrites() {
    return [
      { source: '/health/:path*', destination: `${apiOrigin}/health/:path*` },
      { source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` },
    ];
  },
};
export default config;
