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
        'Host may not import filesystem Node builtins except the dedicated POSIX storage-root Node adapter and process-lock driver.',
      from: {
        path: '^src/host',
        pathNot:
          '^src/host/storage/runtime/(create-node-posix-storage-system|posix-process-lock-driver)\\.ts$',
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
        'src may not import npm packages except the dedicated better-sqlite3 and process-lock driver wrappers.',
      from: {
        path: '^src/',
        pathNot:
          '^src/host/storage/(sqlite/better-sqlite3-driver|runtime/posix-process-lock-driver)\\.ts$',
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
      name: 'process-lock-driver-only-fs-ext',
      severity: 'error',
      comment:
        'The process-lock driver wrapper may depend only on fs-ext-extra-prebuilt among npm packages.',
      from: { path: '^src/host/storage/runtime/posix-process-lock-driver\\.ts$' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled'],
        pathNot: 'node_modules/fs-ext-extra-prebuilt',
      },
    },
    {
      name: 'process-lock-driver-importers-only',
      severity: 'error',
      comment: 'Only the exact process-lock factory may import the process-lock driver wrapper.',
      from: {
        pathNot: '^src/host/storage/runtime/acquire-posix-process-lock\\.ts$',
      },
      to: {
        path: '^src/host/storage/runtime/posix-process-lock-driver\\.ts$',
      },
    },
    {
      name: 'posix-durable-composition-factory-importers-only',
      severity: 'error',
      comment:
        'POSIX durable composition factory is app-private; only the exact factory module and the exact production Neo runtime wrapper may be imported.',
      from: {
        pathNot:
          '^src/host/durable/create-posix-durable-local-host\\.ts$|^src/neo-runtime/production/(create-production-neo-runtime|production-config-bootstrap)\\.ts$',
      },
      to: {
        path: '^src/host/durable/create-posix-durable-local-host\\.ts$',
      },
    },
    {
      name: 'host-does-not-depend-on-neo-runtime',
      severity: 'error',
      comment: 'Host composition must not import the Neo runtime layer.',
      from: { path: '^src/host' },
      to: { path: '^src/neo-runtime' },
    },
    {
      name: 'core-does-not-depend-on-neo-runtime',
      severity: 'error',
      comment: 'Core must not import the Neo runtime layer.',
      from: { path: '^src/core' },
      to: { path: '^src/neo-runtime' },
    },
    {
      name: 'neo-runtime-no-host-except-production',
      severity: 'error',
      comment:
        'Neo runtime modules may import host only from the exact production composition wrapper.',
      from: {
        path: '^src/neo-runtime',
        pathNot:
          '^src/neo-runtime/production/(create-production-neo-runtime|production-config-bootstrap)\\.ts$',
      },
      to: { path: '^src/host' },
    },
    {
      name: 'neo-runtime-no-network-or-child-process',
      severity: 'error',
      comment: 'Neo runtime must not import network or child_process builtins.',
      from: { path: '^src/neo-runtime' },
      to: { path: '^(node:)?(http|https|net|tls|child_process)$' },
    },
    {
      name: 'neo-runtime-no-fs-except-config-and-readiness',
      severity: 'error',
      comment: 'Neo runtime may import fs only from config reader and readiness modules.',
      from: {
        path: '^src/neo-runtime',
        pathNot:
          '^src/neo-runtime/(production/read-production-config-file|cli/read-neo-readiness-file|readiness/neo-runtime-readiness-file|process-identity/read-bounded-procfs-utf8)\\.ts$',
      },
      to: { path: '^(node:)?fs(/promises)?$' },
    },
    {
      name: 'neo-runtime-no-process-except-adapters-and-cli',
      severity: 'error',
      comment: 'Neo runtime may import node:process only from adapters and CLI entry.',
      from: {
        path: '^src/neo-runtime',
        pathNot:
          '^src/neo-runtime/(adapters/create-node-process-signal-port|adapters/create-node-process-keep-alive-port|adapters/create-node-process-output-port|cli/run-neo-process|cli/read-neo-status|process-identity/create-node-process-instance-provider)\\.ts$',
      },
      to: { path: '^(node:)?process$' },
    },
    {
      name: 'neo-runtime-no-integration-scripts',
      severity: 'error',
      comment: 'Neo runtime must not import integration harness scripts.',
      from: { path: '^src/neo-runtime' },
      to: { path: '^scripts/integration' },
    },
    {
      name: 'process-lock-modules-unwired',
      severity: 'error',
      comment:
        'Process-lock factory/constants are app-private; only the exact process-lock factory and the exact POSIX durable composition factory may import them.',
      from: {
        path: '^src/host',
        pathNot:
          '^src/host/(storage/runtime/acquire-posix-process-lock|durable/create-posix-durable-local-host)\\.ts$',
      },
      to: {
        path: '^src/host/storage/runtime/(acquire-posix-process-lock|posix-process-lock-constants)\\.ts$',
      },
    },
    {
      name: 'process-lock-factory-no-sealer-internal',
      severity: 'error',
      comment: 'Process-lock factory must not import the capability sealer; only the lease facade.',
      from: {
        path: '^src/host/storage/runtime/acquire-posix-process-lock\\.ts$',
      },
      to: {
        path: '^src/host/storage/runtime/posix-storage-root-capability\\.internal\\.ts$',
      },
    },
    {
      name: 'sqlite-factory-no-process-lock',
      severity: 'error',
      comment: 'SQLite factory must not import the process-lock driver or factory.',
      from: {
        path: '^src/host/storage/sqlite/create-sqlite-memory-port\\.ts$',
      },
      to: {
        path: '^src/host/storage/runtime/(posix-process-lock-driver|acquire-posix-process-lock|posix-process-lock-constants)\\.ts$',
      },
    },
    {
      name: 'sealed-modules-stay-sealed',
      severity: 'error',
      comment: 'Only the sealing owners may import a *.internal module.',
      from: {
        pathNot:
          '^src/(core/(domain/(index|extension-permission|extension-registry-entry|extension-registry-entry\\.internal|sanitized\\.internal|verified-memory-write-guard)\\.ts|policy/(confirmation-gate|extension-manifest|extension-permissions|namespace-isolation|voice-profile|webhook-ingress|memory-secret-boundary)\\.ts|application/(memory-write\\.service|memory-access\\.gateway|extension-registration\\.service|extension-activation\\.service|extension-activation\\.gateway|runtime-risk-classification\\.service|extension-permission\\.gateway|voice-resolution\\.gateway|webhook-ingress\\.service)\\.ts)|host/storage/runtime/(open-posix-storage-root|posix-storage-root-resolve\\.internal|posix-storage-root-lease\\.internal)\\.ts)$',
      },
      to: {
        path: '\\.internal\\.ts$',
        // Resolve facade: exact SQLite factory. Lease facade: exact SQLite factory and
        // exact process-lock factory (see lease-facade-importers-only).
        pathNot: '^src/host/storage/runtime/posix-storage-root-(resolve|lease)\\.internal\\.ts$',
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
      name: 'lease-facade-importers-only',
      severity: 'error',
      comment:
        'Only the exact SQLite MemoryPort factory and exact process-lock factory may import the lease-only facade.',
      from: {
        pathNot:
          '^src/host/storage/(sqlite/create-sqlite-memory-port|runtime/acquire-posix-process-lock)\\.ts$',
      },
      to: {
        path: '^src/host/storage/runtime/posix-storage-root-lease\\.internal\\.ts$',
      },
    },
    {
      name: 'memory-sink-clearance-guard-only',
      severity: 'error',
      comment:
        'Memory sinks may import only the narrow verified-write guard from core/domain, not sealed internals.',
      from: {
        path: '^src/host/(in-memory/memory-store|storage/sqlite/sqlite-memory-port)\\.ts$',
      },
      to: {
        path: '^src/core/domain/',
        pathNot: '^src/core/domain/(index|verified-memory-write-guard)\\.ts$',
      },
    },
    {
      name: 'sqlite-factory-no-sealer-internal',
      severity: 'error',
      comment: 'SQLite factory must not import the capability sealer; only resolve/lease facades.',
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
