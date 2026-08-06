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
    {
      name: 'communication-domain-pure',
      severity: 'error',
      comment: 'Communication domain may depend only on core domain and itself.',
      from: { path: '^src/core/communication/domain' },
      to: {
        path: '^src/',
        pathNot: '^src/core/(domain|communication/domain)',
      },
    },
    {
      name: 'communication-ports-depend-on-allowed-only',
      severity: 'error',
      comment:
        'Communication ports may depend on core domain/ports and communication domain/ports.',
      from: { path: '^src/core/communication/ports' },
      to: {
        path: '^src/',
        pathNot: '^src/core/(domain|ports|communication/(domain|ports))',
      },
    },
    {
      name: 'communication-policy-depend-on-allowed-only',
      severity: 'error',
      comment:
        'Communication policy may depend on core domain/ports/policy and communication domain/ports/policy.',
      from: { path: '^src/core/communication/policy' },
      to: {
        path: '^src/',
        pathNot: '^src/core/(domain|ports|policy|communication/(domain|ports|policy))',
      },
    },
    {
      name: 'communication-application-depend-on-allowed-only',
      severity: 'error',
      comment:
        'Communication application may depend on core domain/ports and communication domain/ports/policy/application.',
      from: { path: '^src/core/communication/application' },
      to: {
        path: '^src/',
        pathNot: '^src/core/(domain|ports|communication/(domain|ports|policy|application))',
      },
    },
    {
      name: 'communication-reference-depend-on-allowed-only',
      severity: 'error',
      comment:
        'Communication reference adapters may depend on communication contracts/application only.',
      from: { path: '^src/communication/reference' },
      to: {
        path: '^src/',
        pathNot:
          '^src/(core/(domain|ports|communication/(domain|ports|policy|application))|communication/reference)',
      },
    },
    {
      name: 'communication-no-connectors-infrastructure-host',
      severity: 'error',
      comment:
        'Communication contracts must not import connectors, infrastructure, host, or adapters.',
      from: { path: '^src/core/communication' },
      to: {
        path: '^src/(connectors|infrastructure|host|communication/adapters|neo-runtime)',
      },
    },
    {
      name: 'application-depends-on-core-only',
      severity: 'error',
      comment:
        'Application may depend only on allowed core layers (connector subpackage uses a separate rule).',
      from: {
        path: '^src/core/application',
        pathNot: '^src/core/application/(connector|infrastructure)',
      },
      to: {
        pathNot: '^src/core/(domain|ports|policy|routing|application)',
        dependencyTypesNot: ['core'],
      },
    },
    {
      name: 'connector-application-may-use-sdk',
      severity: 'error',
      comment: 'Connector application modules may import connector SDK contracts only.',
      from: { path: '^src/core/application/connector' },
      to: {
        path: '^src/',
        pathNot: '^src/(core/(domain|ports|application/connector)|connectors/sdk)',
      },
    },
    {
      name: 'connector-application-no-infrastructure',
      severity: 'error',
      comment: 'Generic connector application must not import infrastructure modules.',
      from: { path: '^src/core/application/connector' },
      to: { path: '^src/core/(domain/infrastructure|application/infrastructure)' },
    },
    {
      name: 'infrastructure-application-may-use-connector-facades',
      severity: 'error',
      comment:
        'Infrastructure application may import domain, ports, connector facades, and itself only.',
      from: { path: '^src/core/application/infrastructure' },
      to: {
        path: '^src/',
        pathNot: '^src/core/(domain|ports|application/(infrastructure|connector))',
      },
    },
    {
      name: 'infrastructure-connector-sdk-and-application-only',
      severity: 'error',
      comment: 'Infrastructure connector imports SDK and infrastructure application only.',
      from: { path: '^src/connectors/infrastructure' },
      to: {
        path: '^src/',
        pathNot: '^src/(core/(domain|application/infrastructure)|connectors/(sdk|infrastructure))',
      },
    },
    {
      name: 'infrastructure-reference-test-only',
      severity: 'error',
      comment: 'Reference infrastructure adapters are test/dev only.',
      from: {
        path: '^src/',
        pathNot: '^src/infrastructure/reference',
      },
      to: { path: '^src/infrastructure/reference' },
    },
    {
      name: 'infrastructure-domain-pure',
      severity: 'error',
      comment: 'Infrastructure domain imports domain/infrastructure only.',
      from: { path: '^src/core/domain/infrastructure' },
      to: {
        path: '^src/',
        pathNot: '^src/core/domain/(infrastructure|identity|immutable|connector|result)',
      },
    },
    {
      name: 'connector-sdk-domain-only',
      severity: 'error',
      comment: 'Connector SDK imports connector domain contracts only.',
      from: { path: '^src/connectors/sdk' },
      to: {
        path: '^src/',
        pathNot: '^src/(core/domain|connectors/sdk)',
      },
    },
    {
      name: 'connector-reference-test-only',
      severity: 'error',
      comment: 'Reference connector is test/dev only; production must not import it.',
      from: {
        path: '^src/',
        pathNot: '^src/connectors/reference',
      },
      to: { path: '^src/connectors/reference' },
    },
    {
      name: 'connector-execution-registry-private',
      severity: 'error',
      comment: 'Executable connector registry is orchestrator-private.',
      from: {
        path: '^src/',
        pathNot:
          '^src/core/application/connector/(tool-invocation-orchestrator|in-memory-connector-registries)\\.ts$',
      },
      to: { path: '^src/core/application/connector/connector-execution-registry' },
    },
    {
      name: 'neo-runtime-no-connector-internals',
      severity: 'error',
      comment: 'Neo runtime must not import connector platform internals.',
      from: { path: '^src/neo-runtime' },
      to: { path: '^src/(core/application/connector|connectors)' },
    },
    {
      name: 'core-uses-known-layers-only',
      severity: 'error',
      comment: 'Any new directory inside src is forbidden for core until it is allowlisted.',
      from: {
        path: '^src/core',
        pathNot: '^src/core/application/(connector|infrastructure)',
      },
      to: {
        path: '^src/',
        pathNot: '^src/core/(domain|ports|policy|routing|config|runtime|application|communication)',
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
      from: {
        path: '^src/host',
        pathNot: '^src/host/storage/sqlite/communication/',
      },
      to: {
        path: '^src/',
        pathNot: '^src/(host|core/(domain|ports|policy|application|config))',
      },
    },
    {
      name: 'host-sqlite-communication-depends-on-allowed-only',
      severity: 'error',
      comment:
        'Offline SQLite communication package may import host and core domain/ports plus communication domain/ports only.',
      from: { path: '^src/host/storage/sqlite/communication' },
      to: {
        path: '^src/',
        pathNot:
          '^src/(host|core/(domain|ports|policy|application|config|communication/(domain|ports)))',
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
          '^src/neo-runtime/(production/read-production-config-file|production/config-file-open-driver|cli/read-neo-readiness-file|readiness/neo-runtime-readiness-file|readiness/readiness-temp-open-driver|process-identity/read-bounded-procfs-utf8)\\.ts$',
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
          '^src/neo-runtime/(adapters/create-node-process-signal-port|adapters/create-node-process-keep-alive-port|adapters/create-node-process-output-port|cli/run-neo-process|cli/read-neo-status|cli/apply-restrictive-process-umask|process-identity/create-node-process-instance-provider|production/config-file-open-driver|readiness/readiness-temp-open-driver)\\.ts$',
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
          '^src/(core/(domain/(index|extension-permission|extension-registry-entry|extension-registry-entry\\.internal|sanitized\\.internal|verified-memory-write-guard)\\.ts|policy/(confirmation-gate|extension-manifest|extension-permissions|namespace-isolation|voice-profile|webhook-ingress|memory-secret-boundary)\\.ts|application/(memory-write\\.service|memory-access\\.gateway|extension-registration\\.service|extension-activation\\.service|extension-activation\\.gateway|runtime-risk-classification\\.service|extension-permission\\.gateway|voice-resolution\\.gateway|webhook-ingress\\.service)\\.ts|communication/(domain/(index|fresh-observed-admission-evidence\\.persistence\\.internal|authenticated-communication-principal\\.persistence\\.internal|validated-text-output\\.persistence\\.internal)\\.ts|policy/(communication-memory-authorization|text-output-policy)\\.ts|application/(communication-orchestrator|process-text-turn\\.service|phases/delivery-finalization)\\.ts))|communication/reference/reference-memory-authorization\\.ts|host/storage/runtime/(open-posix-storage-root|posix-storage-root-resolve\\.internal|posix-storage-root-lease\\.internal)\\.ts)$',
      },
      to: {
        path: '\\.internal\\.ts$',
        // Resolve/lease facades and communication persistence facades have dedicated importer rules.
        pathNot:
          '^src/(host/storage/runtime/posix-storage-root-(resolve|lease)\\.internal\\.ts|core/communication/domain/(fresh-observed-admission-evidence|authenticated-communication-principal|validated-text-output)\\.persistence\\.internal\\.ts)$',
      },
    },
    {
      name: 'communication-persistence-facade-importers-only',
      severity: 'error',
      comment:
        'Only the exact offline SQLite communication factory may import communication persistence facades.',
      from: {
        pathNot:
          '^src/host/storage/sqlite/communication/create-offline-sqlite-communication-ports\\.ts$',
      },
      to: {
        path: '^src/core/communication/domain/(fresh-observed-admission-evidence|authenticated-communication-principal|validated-text-output)\\.persistence\\.internal\\.ts$',
      },
    },
    {
      name: 'resolver-facade-importers-only',
      severity: 'error',
      comment:
        'Only the exact SQLite MemoryPort factory and offline communication factory may import the resolver-only facade.',
      from: {
        pathNot:
          '^src/host/storage/sqlite/(create-sqlite-memory-port|communication/create-offline-sqlite-communication-ports)\\.ts$',
      },
      to: {
        path: '^src/host/storage/runtime/posix-storage-root-resolve\\.internal\\.ts$',
      },
    },
    {
      name: 'lease-facade-importers-only',
      severity: 'error',
      comment:
        'Only the exact SQLite MemoryPort factory, offline communication factory, and process-lock factory may import the lease-only facade.',
      from: {
        pathNot:
          '^src/host/storage/(sqlite/create-sqlite-memory-port|sqlite/communication/create-offline-sqlite-communication-ports|runtime/acquire-posix-process-lock)\\.ts$',
      },
      to: {
        path: '^src/host/storage/runtime/posix-storage-root-lease\\.internal\\.ts$',
      },
    },
    {
      name: 'offline-communication-factory-not-imported-by-runtime-adapters',
      severity: 'error',
      comment:
        'Runtime, adapters, and production composition must not import the offline SQLite communication factory.',
      from: {
        path: '^src/(neo-runtime|communication/adapters|connectors|infrastructure)/',
      },
      to: {
        path: '^src/host/storage/sqlite/communication/',
      },
    },
    {
      name: 'offline-communication-package-private',
      severity: 'error',
      comment:
        'Offline SQLite communication package remains package-private within its tree; sibling host modules must not import it.',
      from: {
        path: '^src/host/',
        pathNot: '^src/host/storage/sqlite/communication/',
      },
      to: {
        path: '^src/host/storage/sqlite/communication/',
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
