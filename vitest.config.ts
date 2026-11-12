import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Nest uses legacy TypeScript decorators. Vitest 5 transforms with oxc, which does
  // not resolve tsconfig `extends` from a workspace package on its own.
  oxc: { decorator: { legacy: true } },
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/{api,worker}/src/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
      'apps/mobile/src/**/*.test.{ts,tsx}',
    ],
    environment: 'node',
    maxWorkers: 1,
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
