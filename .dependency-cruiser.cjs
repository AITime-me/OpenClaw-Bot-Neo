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
    layer('config-depends-on-domain-and-routing', 'config', ['domain', 'routing', 'config']),
    layer('runtime-is-isolated', 'runtime', ['runtime']),
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
        pathNot: '^src/core/(domain|ports|policy|routing|config|runtime|application)',
      },
    },
    {
      name: 'core-does-not-depend-on-host',
      severity: 'error',
      comment: 'Core must never import the app-private host composition layer.',
      from: { path: '^src/core' },
      to: { path: '^src/host' },
    },
    {
      name: 'host-depends-on-allowed-core-only',
      severity: 'error',
      comment:
        'Host may import only itself and public core domain/ports/policy/application/config surfaces.',
      from: { path: '^src/host' },
      to: {
        path: '^src/',
        pathNot: '^src/(host|core/(domain|ports|policy|application|config))',
      },
    },
    {
      name: 'core-config-does-not-depend-on-host',
      severity: 'error',
      comment: 'Core config parsers must never import the app-private host layer.',
      from: { path: '^src/core/config' },
      to: { path: '^src/host' },
    },
    {
      name: 'host-no-filesystem-builtins',
      severity: 'error',
      comment:
        'Host may not import filesystem Node builtins except the dedicated POSIX storage-root Node adapter.',
      from: {
        path: '^src/host',
        pathNot: '^src/host/storage/runtime/create-node-posix-storage-system\\.ts$',
      },
      to: { path: '^(node:)?fs(/promises)?$' },
    },
    {
      name: 'host-no-os-builtin',
      severity: 'error',
      comment: 'Host may not import node:os except the dedicated POSIX storage-root Node adapter.',
      from: {
        path: '^src/host',
        pathNot: '^src/host/storage/runtime/create-node-posix-storage-system\\.ts$',
      },
      to: { path: '^(node:)?os$' },
    },
    {
      name: 'host-no-network-builtins',
      severity: 'error',
      comment: 'Host may not import network or child_process Node builtins.',
      from: { path: '^src/host' },
      to: { path: '^(node:)?(http|https|net|tls|child_process)$' },
    },
    {
      name: 'public-api-exposes-core-only',
      severity: 'error',
      from: { path: '^src/index\\.ts$' },
      to: {
        path: '^src/',
        pathNot: '^src/core/(domain|ports|policy|routing|config|runtime|application)',
      },
    },
    {
      name: 'core-has-no-external-packages',
      severity: 'error',
      comment:
        'src may not import npm packages except the dedicated better-sqlite3 driver wrapper.',
      from: {
        path: '^src/',
        pathNot: '^src/host/storage/sqlite/better-sqlite3-driver\\.ts$',
      },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled'],
      },
    },
    {
      name: 'sqlite-driver-only-better-sqlite3',
      severity: 'error',
      comment: 'The SQLite driver wrapper may depend only on better-sqlite3 among npm packages.',
      from: { path: '^src/host/storage/sqlite/better-sqlite3-driver\\.ts$' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled'],
        pathNot: 'node_modules/better-sqlite3',
      },
    },
    {
      name: 'sealed-modules-stay-sealed',
      severity: 'error',
      comment: 'Only the sealing owners may import a *.internal module.',
      from: {
        pathNot:
          '^src/(core/(domain/(index|extension-permission|extension-registry-entry|extension-registry-entry\\.internal)\\.ts|policy/(confirmation-gate|extension-manifest|extension-permissions|namespace-isolation|voice-profile|webhook-ingress)\\.ts|application/(memory-write\\.service|memory-access\\.gateway|extension-registration\\.service|extension-activation\\.service|extension-activation\\.gateway|runtime-risk-classification\\.service|extension-permission\\.gateway|voice-resolution\\.gateway|webhook-ingress\\.service)\\.ts)|host/storage/runtime/(open-posix-storage-root|posix-storage-root-resolve\\.internal)\\.ts)$',
      },
      to: {
        path: '\\.internal\\.ts$',
        // Resolver facade is gated by resolver-facade-importers-only (exact SQLite factory only).
        pathNot: '^src/host/storage/runtime/posix-storage-root-resolve\\.internal\\.ts$',
      },
    },
    {
      name: 'resolver-facade-importers-only',
      severity: 'error',
      comment: 'Only the exact SQLite MemoryPort factory may import the resolver-only facade.',
      from: {
        pathNot: '^src/host/storage/sqlite/create-sqlite-memory-port\\.ts$',
      },
      to: {
        path: '^src/host/storage/runtime/posix-storage-root-resolve\\.internal\\.ts$',
      },
    },
    {
      name: 'sqlite-factory-no-sealer-internal',
      severity: 'error',
      comment: 'SQLite factory must not import the capability sealer; only the resolver facade.',
      from: {
        path: '^src/host/storage/sqlite/create-sqlite-memory-port\\.ts$',
      },
      to: {
        path: '^src/host/storage/runtime/posix-storage-root-capability\\.internal\\.ts$',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^tests/fixtures' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
