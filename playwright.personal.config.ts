import base from './playwright.config';
// These tests intercept all business requests and only need the built Web server.
export default {
  ...base,
  testMatch: ['personal-state.spec.ts', 'admin-config.spec.ts', 'plugin-directory.spec.ts'],
  webServer: Array.isArray(base.webServer) ? [base.webServer[1]!] : [],
};
