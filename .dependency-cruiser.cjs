module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'domain-is-pure',
      severity: 'error',
      from: { path: '^src/core/domain' },
      to: { pathNot: '^src/core/domain' },
    },
    {
      name: 'ports-domain-only',
      severity: 'error',
      from: { path: '^src/core/ports' },
      to: { pathNot: '^src/core/(domain|ports)' },
    },
    {
      name: 'core-no-implementations',
      severity: 'error',
      from: { path: '^src/core' },
      to: { path: '^src/(adapters|providers|integrations|monitors)' },
    },
  ],
  options: { doNotFollow: { path: 'node_modules' }, tsPreCompilationDeps: true },
};
