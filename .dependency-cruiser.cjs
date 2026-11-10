module.exports = {
  forbidden: [
    { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'no-shared-to-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'no-frontend-backend',
      severity: 'error',
      from: { path: '^apps/(web|mobile)/' },
      to: {
        path: '^(apps/(api|worker)|packages/(database|domain|ai-core|service-health))/',
      },
    },
    {
      name: 'no-cross-application-imports',
      severity: 'error',
      from: { path: '^apps/(api|worker)/' },
      to: { path: '^apps/(web|mobile)/' },
    },
    {
      name: 'contracts-are-portable',
      severity: 'error',
      from: { path: '^packages/contracts/' },
      to: {
        path: '^(apps/|packages/(?!contracts/)|node_modules/(?:@nestjs|react|react-native|pg|drizzle-orm))',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: '(^|/)(dist|\\.next|node_modules)/|\\.test\\.ts$',
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['types', 'import', 'require', 'default'],
    },
  },
};
