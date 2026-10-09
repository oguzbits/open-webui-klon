/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports hide layering mistakes.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'web-never-imports-api-runtime',
      severity: 'error',
      comment: 'The web app talks to the API only through the generated client.',
      from: { path: '^apps/web/src' },
      to: { path: '^apps/api', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'api-never-imports-web',
      severity: 'error',
      from: { path: '^apps/api/src' },
      to: { path: '^apps/web' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    exclude: { path: '(^|/)(dist|coverage|generated)/' },
  },
};
