const layer = (name, from, allowed) => ({
  name,
  severity: 'error',
  comment: `${from} may depend only on: ${allowed.join(', ')} (node builtins excluded).`,
  from: { path: `^src/core/${from}` },
  to: {
    pathNot: `^src/core/(${allowed.join('|')})`,
    dependencyTypesNot: ['core'],
  },
});

module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'not-to-unresolvable', severity: 'error', from: {}, to: { couldNotResolve: true } },
    layer('domain-is-pure', 'domain', ['domain']),
    layer('ports-depend-on-domain-only', 'ports', ['domain', 'ports']),
    layer('policy-depends-on-domain-and-ports', 'policy', ['domain', 'ports', 'policy']),
    layer('routing-depends-on-domain-and-ports', 'routing', ['domain', 'ports', 'routing']),
    layer('application-depends-on-core-only', 'application', [
      'domain',
      'ports',
      'policy',
      'routing',
      'application',
    ]),
    {
      name: 'core-uses-known-layers-only',
      severity: 'error',
      comment: 'Any new directory inside src is forbidden for core until it is allowlisted.',
      from: { path: '^src/core' },
      to: {
        path: '^src/',
        pathNot: '^src/core/(domain|ports|policy|routing|application)',
      },
    },
    {
      name: 'public-api-exposes-core-only',
      severity: 'error',
      from: { path: '^src/index\\.ts$' },
      to: {
        path: '^src/',
        pathNot: '^src/core/(domain|ports|policy|routing|application)',
      },
    },
    {
      name: 'core-has-no-external-packages',
      severity: 'error',
      from: { path: '^src/' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled'],
      },
    },
    {
      name: 'sealed-modules-stay-sealed',
      severity: 'error',
      comment: 'Only the sealing owners may import a *.internal module.',
      from: {
        pathNot:
          '^src/core/(domain/(index|extension-permission)\\.ts|policy/(confirmation-gate|extension-manifest|voice-profile)\\.ts|application/memory-write\\.service\\.ts)$',
      },
      to: { path: '\\.internal\\.ts$' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^tests/fixtures' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
