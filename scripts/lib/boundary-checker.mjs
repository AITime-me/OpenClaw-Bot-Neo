import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

/**
 * Structural architecture checker. Module references are read from the TypeScript AST, so static
 * imports, `export ... from`, dynamic `import()` and `require()` are all recognised, and every
 * core layer is validated against an explicit allowlist instead of a directory-name blacklist.
 *
 * Non-literal (computed) module specifiers are fail-closed violations: the checker never evaluates
 * expressions and does not act as a runtime sandbox.
 */

export const CORE_LAYER_RULES = {
  'core/domain/infrastructure': ['core/domain', 'core/domain/infrastructure'],
  'core/domain': ['core/domain'],
  'core/communication/domain': ['core/domain', 'core/communication/domain'],
  'core/communication/ports': [
    'core/domain',
    'core/ports',
    'core/communication/domain',
    'core/communication/ports',
  ],
  'core/communication/policy': [
    'core/domain',
    'core/ports',
    'core/policy',
    'core/communication/domain',
    'core/communication/ports',
    'core/communication/policy',
  ],
  /**
   * Offline communication application/runtime (Build 3.7D).
   * May use communication domain/ports/policy and public core surfaces.
   * Must not import host, connectors, infrastructure, neo-runtime, or Telegram/provider SDKs.
   */
  'core/communication/application': [
    'core/domain',
    'core/ports',
    'core/communication/domain',
    'core/communication/ports',
    'core/communication/policy',
    'core/communication/application',
  ],
  /**
   * App-private offline reference adapters (Build 3.7D).
   */
  'communication/reference': [
    'core/domain',
    'core/ports',
    'core/communication/domain',
    'core/communication/ports',
    'core/communication/policy',
    'core/communication/application',
    'communication/reference',
  ],
  'core/ports': ['core/domain', 'core/domain/infrastructure', 'core/ports'],
  'core/policy': ['core/domain', 'core/ports', 'core/policy'],
  'core/routing': ['core/domain', 'core/ports', 'core/routing'],
  'core/config': ['core/domain', 'core/routing', 'core/config'],
  'core/runtime': ['core/runtime'],
  'core/application/connector': [
    'core/domain',
    'core/ports',
    'core/application/connector',
    'connectors/sdk',
  ],
  'core/application/infrastructure': [
    'core/domain',
    'core/domain/infrastructure',
    'core/ports',
    'core/application/infrastructure',
    'core/application/connector',
  ],
  'core/application': [
    'core/domain',
    'core/ports',
    'core/policy',
    'core/routing',
    'core/application',
  ],
  'connectors/sdk': ['core/domain', 'connectors/sdk'],
  'connectors/reference': ['core/domain', 'connectors/sdk', 'connectors/reference'],
  'connectors/infrastructure': [
    'core/domain',
    'core/domain/infrastructure',
    'connectors/sdk',
    'connectors/infrastructure',
    'core/application/infrastructure',
  ],
  'infrastructure/reference': [
    'core/domain',
    'core/domain/infrastructure',
    'infrastructure/reference',
  ],
  connectors: ['connectors'],
  /**
   * App-private local composition (Build 3.0+), pure config bootstrap (Build 3.1),
   * storage boundary/schema contract (Build 3.2), POSIX storage-root safe-open (Build 3.3B1),
   * safe-root capability seal (Build 3.3B2B), and SQLite MemoryPort adapter (Build 3.3B2).
   * May use public core surfaces only, including core/config parsers.
   * Must not import core internals, tests, scripts, or future channel/adapters trees.
   */
  /**
   * Offline SQLite communication persistence (Build 3.7C).
   * May import communication domain/ports contracts and shared host/sqlite/runtime surfaces.
   * Must not import communication policy, application, adapters, or connectors.
   */
  'host/storage/sqlite/communication': [
    'core/domain',
    'core/ports',
    'core/communication/domain',
    'core/communication/ports',
    'host',
    'host/storage/sqlite',
    'host/storage/sqlite/communication',
    'host/storage/runtime',
  ],
  host: ['core/domain', 'core/ports', 'core/policy', 'core/application', 'core/config', 'host'],
  /**
   * App-private Neo runtime lifecycle (Build 3.4B+). Sub-layers are listed longest-path first.
   */
  'neo-runtime/production': [
    'core/domain',
    'core/ports',
    'host',
    'neo-runtime',
    'neo-runtime/production',
    'neo-runtime/ports',
  ],
  'neo-runtime/cli': [
    'core/domain',
    'host',
    'neo-runtime',
    'neo-runtime/adapters',
    'neo-runtime/cli',
    'neo-runtime/coordination',
    'neo-runtime/logging',
    'neo-runtime/production',
    'neo-runtime/readiness',
    'neo-runtime/ports',
  ],
  'neo-runtime/adapters': ['neo-runtime/adapters', 'neo-runtime/ports'],
  'neo-runtime/coordination': [
    'core/domain',
    'neo-runtime',
    'neo-runtime/coordination',
    'neo-runtime/logging',
    'neo-runtime/ports',
  ],
  'neo-runtime/readiness': [
    'core/domain',
    'neo-runtime',
    'neo-runtime/readiness',
    'neo-runtime/ports',
  ],
  'neo-runtime/logging': ['core/domain', 'neo-runtime', 'neo-runtime/logging', 'neo-runtime/ports'],
  'neo-runtime/ports': ['core/domain', 'neo-runtime', 'neo-runtime/ports'],
  'neo-runtime': ['core/domain', 'neo-runtime', 'neo-runtime/production'],
  root: [
    'core/domain',
    'core/ports',
    'core/policy',
    'core/routing',
    'core/config',
    'core/runtime',
    'core/application',
    'root',
  ],
};

export const REQUIRED_CORE_LAYERS = [
  'core/domain',
  'core/ports',
  'core/policy',
  'core/routing',
  'core/application',
  'core/communication/domain',
  'core/communication/ports',
  'core/communication/policy',
];

/**
 * Host may use only pure lexical path helpers and Proxy detection builtins.
 * Filesystem, network, process, and other Node builtins remain denied except for the
 * dedicated POSIX storage-root Node adapter allowlist below.
 */
export const HOST_BUILTIN_ALLOWLIST = Object.freeze(['node:path', 'node:util/types']);

/**
 * Path-specific host builtin exceptions. Keys are paths relative to the analysed root
 * (normally `src`), using POSIX separators.
 */
export const HOST_PATH_BUILTIN_ALLOWLIST = Object.freeze({
  'host/storage/runtime/create-node-posix-storage-system.ts': Object.freeze([
    'node:fs',
    'node:os',
    'node:path',
  ]),
  'host/storage/sqlite/better-sqlite3-driver.ts': Object.freeze(['node:module']),
  'host/storage/runtime/posix-process-lock-driver.ts': Object.freeze(['node:fs', 'node:module']),
});

export const NEO_RUNTIME_PATH_BUILTIN_ALLOWLIST = Object.freeze({
  'neo-runtime/production/config-file-open-driver.ts': Object.freeze([
    'node:fs',
    'node:fs/promises',
    'node:process',
  ]),
  'neo-runtime/production/read-production-config-file.ts': Object.freeze([
    'node:fs/promises',
    'node:path',
  ]),
  'neo-runtime/readiness/readiness-temp-open-driver.ts': Object.freeze([
    'node:fs',
    'node:fs/promises',
    'node:process',
  ]),
  'neo-runtime/cli/apply-restrictive-process-umask.ts': Object.freeze(['node:process']),
  'neo-runtime/cli/read-neo-readiness-file.ts': Object.freeze(['node:fs/promises', 'node:path']),
  'neo-runtime/readiness/neo-runtime-readiness-file.ts': Object.freeze([
    'node:crypto',
    'node:fs/promises',
    'node:path',
  ]),
  'neo-runtime/adapters/create-node-process-signal-port.ts': Object.freeze(['node:process']),
  'neo-runtime/adapters/create-node-process-keep-alive-port.ts': Object.freeze(['node:timers']),
  'neo-runtime/adapters/create-node-process-output-port.ts': Object.freeze(['node:process']),
  'neo-runtime/cli/run-neo-process.ts': Object.freeze(['node:process']),
  'neo-runtime/cli/read-neo-status.ts': Object.freeze(['node:process']),
  'neo-runtime/process-identity/read-bounded-procfs-utf8.ts': Object.freeze(['node:fs/promises']),
  'neo-runtime/process-identity/create-node-process-instance-provider.ts': Object.freeze([
    'node:process',
  ]),
});

/**
 * Path-specific host external (npm) package exceptions.
 * Keys are paths relative to the analysed root (normally `src`), using POSIX separators.
 */
export const HOST_PATH_EXTERNAL_ALLOWLIST = Object.freeze({
  'host/storage/sqlite/better-sqlite3-driver.ts': Object.freeze(['better-sqlite3']),
  'host/storage/runtime/posix-process-lock-driver.ts': Object.freeze(['fs-ext-extra-prebuilt']),
});

/**
 * Exact POSIX durable composition factory may lazy-load only these repository-relative targets
 * after the Linux gate. No wildcards; similarly named importers do not inherit authority.
 */
export const POSIX_DURABLE_COMPOSITION_FACTORY_PATH =
  'host/durable/create-posix-durable-local-host.ts';

export const POSIX_DURABLE_COMPOSITION_DYNAMIC_IMPORT_TARGETS = Object.freeze([
  'host/storage/runtime/open-posix-storage-root.ts',
  'host/storage/runtime/acquire-posix-process-lock.ts',
  'host/storage/sqlite/create-sqlite-memory-port.ts',
]);

/** Sealed factories stay reachable only from the modules that are allowed to create sealed values. */
export const INTERNAL_MODULE_ALLOWLIST = {
  'core/domain/approval.internal.ts': ['core/domain/index.ts', 'core/policy/confirmation-gate.ts'],
  'core/domain/extension-manifest.internal.ts': [
    'core/domain/index.ts',
    'core/domain/extension-permission.ts',
    'core/domain/extension-registry-entry.ts',
    'core/domain/extension-registry-entry.internal.ts',
    'core/policy/extension-manifest.ts',
    'core/application/extension-activation.service.ts',
  ],
  'core/domain/extension-registry-entry.internal.ts': [
    'core/domain/index.ts',
    'core/domain/extension-permission.ts',
    'core/policy/extension-permissions.ts',
    'core/application/extension-registration.service.ts',
    'core/application/extension-activation.service.ts',
    'core/application/extension-activation.gateway.ts',
    'core/application/runtime-risk-classification.service.ts',
    'core/application/extension-permission.gateway.ts',
  ],
  'core/domain/extension-runtime-risk.internal.ts': [
    'core/domain/index.ts',
    'core/domain/extension-permission.ts',
    'core/policy/extension-permissions.ts',
    'core/application/runtime-risk-classification.service.ts',
    'core/application/extension-permission.gateway.ts',
  ],
  'core/domain/extension-policy.internal.ts': [
    'core/domain/index.ts',
    'core/application/runtime-risk-classification.service.ts',
    'core/application/extension-permission.gateway.ts',
    'core/application/extension-activation.service.ts',
    'core/application/extension-activation.gateway.ts',
  ],
  'core/domain/webhook.internal.ts': [
    'core/domain/index.ts',
    'core/policy/webhook-ingress.ts',
    'core/application/webhook-ingress.service.ts',
  ],
  'core/domain/voice-profile.internal.ts': [
    'core/domain/index.ts',
    'core/policy/voice-profile.ts',
    'core/application/voice-resolution.gateway.ts',
  ],
  'core/domain/sanitized.internal.ts': [
    'core/domain/index.ts',
    'core/domain/verified-memory-write-guard.ts',
    'core/application/memory-write.service.ts',
  ],
  'core/domain/verified-memory-write-guard.ts': [
    'host/in-memory/memory-store.ts',
    'host/storage/sqlite/sqlite-memory-port.ts',
  ],
  'core/domain/secret.internal.ts': [
    'core/domain/index.ts',
    'core/policy/memory-secret-boundary.ts',
    'core/ports/secrets.port.ts',
  ],
  'core/domain/memory-access.internal.ts': [
    'core/domain/index.ts',
    'core/policy/namespace-isolation.ts',
    'core/application/memory-write.service.ts',
    'core/application/memory-access.gateway.ts',
  ],
  /**
   * Communication principal seal (Build 3.7B). Public verify/redacted helpers re-export from the
   * public principal module; memory policy and security tests may import the issuer.
   * Persistence facades may seal admission evidence / read claims (Build 3.7C0).
   */
  'core/communication/domain/authenticated-communication-principal.internal.ts': [
    'core/communication/domain/index.ts',
    'core/communication/policy/communication-memory-authorization.ts',
    'core/communication/domain/authenticated-communication-principal.persistence.internal.ts',
    'core/communication/domain/fresh-observed-admission-evidence.persistence.internal.ts',
    'core/communication/application/communication-orchestrator.ts',
    'communication/reference/reference-memory-authorization.ts',
  ],
  /**
   * Validated text-output seal (Build 3.7B). Public view helpers re-export; output policy seals.
   * Persistence facade may verify and read offline-outbox plaintext (Build 3.7C0).
   */
  'core/communication/domain/text-delivery.internal.ts': [
    'core/communication/domain/index.ts',
    'core/communication/policy/text-output-policy.ts',
    'core/communication/domain/validated-text-output.persistence.internal.ts',
    'core/communication/application/process-text-turn.service.ts',
    'core/communication/application/phases/delivery-finalization.ts',
  ],
  /**
   * Narrow persistence facades (Build 3.7C0). Exact offline SQLite communication factory only.
   * No wildcards; sibling host/runtime/adapter/barrel importers remain forbidden.
   * Factory module is deferred to Build 3.7C implementation.
   */
  'core/communication/domain/fresh-observed-admission-evidence.persistence.internal.ts': [
    'host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts',
  ],
  'core/communication/domain/authenticated-communication-principal.persistence.internal.ts': [
    'host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts',
  ],
  'core/communication/domain/validated-text-output.persistence.internal.ts': [
    'host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts',
  ],
  /**
   * POSIX storage-root capability seal (Build 3.3B2B / B3A).
   * Register / prepare-close / markClosed / abandon: only the opener.
   * Resolve and lease facades may import this module; SQLite must not import the sealer directly.
   */
  'host/storage/runtime/posix-storage-root-capability.internal.ts': [
    'host/storage/runtime/open-posix-storage-root.ts',
    'host/storage/runtime/posix-storage-root-resolve.internal.ts',
    'host/storage/runtime/posix-storage-root-lease.internal.ts',
  ],
  /**
   * Resolver-only facade (Build 3.3B2). Exact SQLite factory may resolve trusted root path.
   * Does not expose register / prepare-close / markClosed / abandon / acquire.
   */
  'host/storage/runtime/posix-storage-root-resolve.internal.ts': [
    'host/storage/sqlite/create-sqlite-memory-port.ts',
    'host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts',
  ],
  /**
   * Lease-only facade (Build 3.3B3A / B3B3B3). Exact SQLite factory and exact process-lock factory
   * may acquire a child lease + trusted path. Does not expose register / prepare-close /
   * markClosed / abandon.
   */
  'host/storage/runtime/posix-storage-root-lease.internal.ts': [
    'host/storage/sqlite/create-sqlite-memory-port.ts',
    'host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts',
    'host/storage/runtime/acquire-posix-process-lock.ts',
  ],
  /**
   * Exact process-lock driver (Build 3.3B3B3). Only the process-lock factory may import it.
   */
  'host/storage/runtime/posix-process-lock-driver.ts': [
    'host/storage/runtime/acquire-posix-process-lock.ts',
  ],
  /**
   * Process-lock factory (Build 3.3B3B3 / B3C2). Exact POSIX durable composition factory may import it.
   * No wildcard host/durable/** — sibling durable modules remain forbidden.
   */
  'host/storage/runtime/acquire-posix-process-lock.ts': [
    'host/durable/create-posix-durable-local-host.ts',
  ],
  /**
   * Process-lock compile-time constants. Only the process-lock factory may import them.
   */
  'host/storage/runtime/posix-process-lock-constants.ts': [
    'host/storage/runtime/acquire-posix-process-lock.ts',
  ],
  'core/application/connector/connector-execution-registry.port.ts': [
    'core/application/connector/tool-invocation-orchestrator.ts',
    'core/application/connector/in-memory-connector-registries.ts',
  ],
};

/**
 * Exact export surfaces for communication persistence facades (Build 3.7C0 corrective).
 * No export *, no re-export from original internals, no extra names.
 */
export const COMMUNICATION_PERSISTENCE_FACADE_EXPORT_MANIFESTS = Object.freeze({
  'core/communication/domain/fresh-observed-admission-evidence.persistence.internal.ts':
    Object.freeze({
      allowedExports: Object.freeze(['sealFreshObservedAdmissionEvidenceForPersistence']),
      allowedImporters: Object.freeze([
        'host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts',
      ]),
    }),
  'core/communication/domain/authenticated-communication-principal.persistence.internal.ts':
    Object.freeze({
      allowedExports: Object.freeze([
        'AuthenticatedCommunicationPrincipalPersistenceClaims',
        'readAuthenticatedCommunicationPrincipalPersistenceClaims',
      ]),
      allowedImporters: Object.freeze([
        'host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts',
      ]),
    }),
  'core/communication/domain/validated-text-output.persistence.internal.ts': Object.freeze({
    allowedExports: Object.freeze([
      'ValidatedTextOutputPersistenceMetadata',
      'isGenuineValidatedTextOutputForPersistence',
      'readValidatedTextOutputMetadataForPersistence',
      'readValidatedTextOutputPlaintextForOfflineOutbox',
    ]),
    allowedImporters: Object.freeze([
      'host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts',
    ]),
  }),
});

const toPosix = (value) => value.split('\\').join('/');

export { toPosix };

const listFiles = (root) => {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
};

const isStaticStringSpecifier = (node) =>
  !!node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));

/**
 * @returns {{ specifier: string, kind: string, line: number, computed?: boolean }[]}
 */
export function extractReferences(sourceText, fileName) {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2022, true);
  const references = [];
  const addLiteral = (specifierNode, kind) => {
    if (!specifierNode || !isStaticStringSpecifier(specifierNode)) return false;
    const { line } = source.getLineAndCharacterOfPosition(specifierNode.getStart(source));
    references.push({ specifier: specifierNode.text, kind, line: line + 1, computed: false });
    return true;
  };
  const addComputed = (expressionNode, kind) => {
    const position = expressionNode?.getStart(source) ?? 0;
    const { line } = source.getLineAndCharacterOfPosition(position);
    references.push({
      specifier: '<computed>',
      kind,
      line: line + 1,
      computed: true,
    });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) addLiteral(node.moduleSpecifier, 'import');
    else if (ts.isExportDeclaration(node)) addLiteral(node.moduleSpecifier, 'export-from');
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const expression = node.moduleReference.expression;
      if (!addLiteral(expression, 'require')) addComputed(expression, 'computed-require');
    } else if (ts.isCallExpression(node)) {
      const [firstArgument] = node.arguments;
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (!addLiteral(firstArgument, 'dynamic-import'))
          addComputed(firstArgument ?? node, 'computed-import');
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        if (!addLiteral(firstArgument, 'require'))
          addComputed(firstArgument ?? node, 'computed-require');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return references;
}

/**
 * Exhaustive top-level export inventory for persistence facade surfaces.
 * Unknown or unclassifiable export-bearing forms set hasUnclassifiedExport (fail-closed).
 *
 * @returns {{
 *   names: string[],
 *   hasExportStar: boolean,
 *   hasReexport: boolean,
 *   hasUnclassifiedExport: boolean,
 * }}
 */
export function extractExportedNames(sourceText, fileName) {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2022, true);
  const names = new Set();
  let hasExportStar = false;
  let hasReexport = false;
  let hasUnclassifiedExport = false;

  const markUnclassified = () => {
    hasUnclassifiedExport = true;
  };

  const hasExportModifier = (node) =>
    Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));

  const hasDefaultModifier = (node) =>
    Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword));

  const kindName = (node) => String(ts.SyntaxKind[node.kind] ?? '');

  const collectBindingNames = (bindingName) => {
    if (ts.isIdentifier(bindingName)) {
      names.add(bindingName.text);
      return;
    }
    if (ts.isObjectBindingPattern(bindingName) || ts.isArrayBindingPattern(bindingName)) {
      for (const element of bindingName.elements) {
        if (ts.isOmittedExpression(element)) continue;
        if (ts.isBindingElement(element)) {
          collectBindingNames(element.name);
          continue;
        }
        markUnclassified();
      }
      return;
    }
    markUnclassified();
  };

  const addNamedExportElements = (exportClause) => {
    if (!ts.isNamedExports(exportClause)) {
      markUnclassified();
      return;
    }
    for (const element of exportClause.elements) {
      // Exported public name (supports `export { local as alias }` / type-only).
      names.add(element.name.text);
    }
  };

  for (const statement of source.statements) {
    // `export as namespace Name;` — unconditionally forbidden on persistence facades.
    // Do not rely on name-set membership: a same-name collision with an allowed export
    // must still fail closed.
    if (
      typeof ts.isNamespaceExportDeclaration === 'function' &&
      ts.isNamespaceExportDeclaration(statement)
    ) {
      markUnclassified();
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      if (statement.moduleSpecifier) {
        hasReexport = true;
        if (statement.exportClause === undefined) {
          // `export * from` / `export type * from`
          hasExportStar = true;
        } else if (ts.isNamespaceExport(statement.exportClause)) {
          // `export * as name from` / `export type * as name from`
          hasExportStar = true;
          names.add(statement.exportClause.name.text);
        } else if (ts.isNamedExports(statement.exportClause)) {
          addNamedExportElements(statement.exportClause);
        } else {
          markUnclassified();
        }
        continue;
      }

      if (statement.exportClause === undefined) {
        markUnclassified();
        continue;
      }
      if (ts.isNamespaceExport(statement.exportClause)) {
        // `export * as ns` without module specifier is unexpected — fail closed.
        hasExportStar = true;
        markUnclassified();
        continue;
      }
      if (ts.isNamedExports(statement.exportClause)) {
        // Includes type-only `export type { Foo }`.
        addNamedExportElements(statement.exportClause);
        continue;
      }
      markUnclassified();
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      // `export default <expr>` vs `export = <expr>`
      names.add(statement.isExportEquals ? 'exportEquals' : 'default');
      continue;
    }

    if (!hasExportModifier(statement)) {
      // Fail-closed for any future/unknown Export* statement kind without ExportKeyword.
      if (kindName(statement).includes('Export')) markUnclassified();
      continue;
    }

    if (hasDefaultModifier(statement)) {
      names.add('default');
      const recognizedDefault =
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement);
      if (!recognizedDefault) markUnclassified();
      continue;
    }

    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name) names.add(statement.name.text);
      else markUnclassified();
      continue;
    }

    if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      names.add(statement.name.text);
      continue;
    }

    if (ts.isModuleDeclaration(statement)) {
      // `export namespace Name` / `export module Name` / `export module "ambient"`
      if (ts.isIdentifier(statement.name)) names.add(statement.name.text);
      else if (ts.isStringLiteral(statement.name)) names.add(statement.name.text);
      else markUnclassified();
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name);
      }
      continue;
    }

    // ExportKeyword present but declaration kind not recognized (e.g. `export import =`).
    markUnclassified();
  }

  return {
    names: [...names].sort(),
    hasExportStar,
    hasReexport,
    hasUnclassifiedExport,
  };
}

const layerOf = (relativePath) => {
  const path = toPosix(relativePath);
  const known = Object.keys(CORE_LAYER_RULES).filter((layer) => layer !== 'root');
  const match = known
    .sort((a, b) => b.length - a.length)
    .find((layer) => path.startsWith(`${layer}/`) || path === layer);
  if (match) return match;
  return path.includes('/') ? `unknown:${path.split('/').slice(0, -1).join('/')}` : 'root';
};

const resolveRelative = (rootDir, fromFile, specifier) => {
  const target = resolve(dirname(fromFile), specifier);
  const candidates = [
    target,
    target.replace(/\.js$/, '.ts'),
    target.replace(/\.mjs$/, '.mts'),
    `${target}.ts`,
    join(target, 'index.ts'),
  ];
  const existing = candidates.find((candidate) => existsSync(candidate));
  const chosen = existing ?? target.replace(/\.js$/, '.ts');
  return {
    path: chosen,
    relative: toPosix(relative(rootDir, chosen)),
    resolved: existing !== undefined,
  };
};

const detectCycle = (graph) => {
  const state = new Map();
  const stack = [];
  const walk = (node) => {
    state.set(node, 'visiting');
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const status = state.get(next);
      if (status === 'visiting') return [...stack.slice(stack.indexOf(next)), next];
      if (status === undefined) {
        const found = walk(next);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(node, 'done');
    return null;
  };
  for (const node of graph.keys())
    if (state.get(node) === undefined) {
      const cycle = walk(node);
      if (cycle) return cycle;
    }
  return null;
};

/**
 * @param {{ rootDir?: string, layerRules?: Record<string, string[]>, requiredLayers?: string[],
 *   internalAllowlist?: Record<string, string[]>,
 *   facadeExportManifests?: Record<string, { allowedExports: readonly string[], allowedImporters: readonly string[] }> }} [options]
 */
export function analyzeBoundaries(options = {}) {
  const rootDir = resolve(options.rootDir ?? 'src');
  const layerRules = options.layerRules ?? CORE_LAYER_RULES;
  const requiredLayers = options.requiredLayers ?? REQUIRED_CORE_LAYERS;
  const internalAllowlist = options.internalAllowlist ?? INTERNAL_MODULE_ALLOWLIST;
  const facadeExportManifests =
    options.facadeExportManifests ?? COMMUNICATION_PERSISTENCE_FACADE_EXPORT_MANIFESTS;
  const violations = [];
  const files = listFiles(rootDir).filter((path) => path.endsWith('.ts'));
  const graph = new Map();

  if (files.length === 0)
    violations.push({
      code: 'ZERO_FILES',
      message: `No TypeScript files found under ${toPosix(relative(process.cwd(), rootDir)) || '.'}`,
    });

  for (const layer of requiredLayers) {
    const present = files.some((file) => layerOf(relative(rootDir, file)) === layer);
    if (!present)
      violations.push({ code: 'MISSING_LAYER', message: `Expected layer ${layer} has no files.` });
  }

  for (const file of files) {
    const fileRelative = toPosix(relative(rootDir, file));
    const fromLayer = layerOf(fileRelative);
    const allowed = layerRules[fromLayer];
    graph.set(fileRelative, []);
    for (const reference of extractReferences(readFileSync(file, 'utf8'), file)) {
      const where = `${fileRelative}:${String(reference.line)} (${reference.kind})`;
      if (reference.computed === true) {
        violations.push({
          code: 'COMPUTED_MODULE_SPECIFIER',
          message: `${where} uses a computed module specifier; only static string specifiers are allowed.`,
        });
        continue;
      }
      if (reference.kind === 'dynamic-import') {
        if (fileRelative !== POSIX_DURABLE_COMPOSITION_FACTORY_PATH) {
          violations.push({
            code: 'DYNAMIC_IMPORT_FORBIDDEN',
            message: `${where} uses dynamic import; core cannot load executable extensions.`,
          });
        } else {
          const target = resolveRelative(rootDir, file, reference.specifier);
          if (!POSIX_DURABLE_COMPOSITION_DYNAMIC_IMPORT_TARGETS.includes(target.relative)) {
            violations.push({
              code: 'DYNAMIC_IMPORT_TARGET_FORBIDDEN',
              message: `${where} dynamic import target is not allowlisted for the composition factory.`,
            });
          }
        }
      }
      if (isBuiltin(reference.specifier)) {
        const specifier = reference.specifier.startsWith('node:')
          ? reference.specifier
          : `node:${reference.specifier}`;
        if (fromLayer === 'host') {
          const pathAllow = HOST_PATH_BUILTIN_ALLOWLIST[fileRelative];
          const allowlist = pathAllow ?? HOST_BUILTIN_ALLOWLIST;
          if (!allowlist.includes(specifier))
            violations.push({
              code: 'FORBIDDEN_DEPENDENCY',
              message: `${where} may not import builtin ${reference.specifier}.`,
            });
        } else if (fromLayer.startsWith('neo-runtime')) {
          const pathAllow = NEO_RUNTIME_PATH_BUILTIN_ALLOWLIST[fileRelative];
          if (pathAllow === undefined || !pathAllow.includes(specifier))
            violations.push({
              code: 'FORBIDDEN_DEPENDENCY',
              message: `${where} may not import builtin ${reference.specifier}.`,
            });
        }
        continue;
      }
      if (!reference.specifier.startsWith('.')) {
        if (fromLayer === 'host') {
          const pathAllow = HOST_PATH_EXTERNAL_ALLOWLIST[fileRelative];
          if (pathAllow !== undefined && pathAllow.includes(reference.specifier)) continue;
        }
        violations.push({
          code: 'EXTERNAL_DEPENDENCY',
          message: `${where} imports external package ${reference.specifier}.`,
        });
        continue;
      }
      const target = resolveRelative(rootDir, file, reference.specifier);
      if (!target.resolved)
        violations.push({
          code: 'UNRESOLVED_REFERENCE',
          message: `${where} points at missing module ${reference.specifier}.`,
        });
      const toLayer = layerOf(target.relative);
      if (target.relative.startsWith('..')) {
        violations.push({
          code: 'OUTSIDE_ROOT',
          message: `${where} escapes the analysed root via ${reference.specifier}.`,
        });
        continue;
      }
      if (allowed === undefined)
        violations.push({
          code: 'UNKNOWN_SOURCE_LAYER',
          message: `${where} belongs to unlisted layer ${fromLayer}.`,
        });
      else if (!allowed.includes(toLayer))
        violations.push({
          code: 'FORBIDDEN_DEPENDENCY',
          message: `${where} may not depend on ${toLayer} (${target.relative}).`,
        });
      const internalRule = internalAllowlist[target.relative];
      if (internalRule !== undefined && !internalRule.includes(fileRelative))
        violations.push({
          code: 'INTERNAL_MODULE_LEAK',
          message: `${where} may not import sealed module ${target.relative}.`,
        });
      if (target.relative.endsWith('.internal.ts') && internalRule === undefined)
        violations.push({
          code: 'UNLISTED_INTERNAL_MODULE',
          message: `${where} imports ${target.relative}, which has no allowlist entry.`,
        });

      const facadeManifest = facadeExportManifests[target.relative];
      if (facadeManifest !== undefined) {
        if (!facadeManifest.allowedImporters.includes(fileRelative)) {
          violations.push({
            code: 'PERSISTENCE_FACADE_WRONG_IMPORTER',
            message: `${where} is not the exact allowlisted importer for ${target.relative}.`,
          });
        }
        if (reference.kind === 'export-from') {
          violations.push({
            code: 'PERSISTENCE_FACADE_BARREL_REEXPORT',
            message: `${where} must not re-export persistence facade ${target.relative}.`,
          });
        }
        if (reference.kind === 'dynamic-import' || reference.kind === 'computed-import') {
          violations.push({
            code: 'PERSISTENCE_FACADE_DYNAMIC_IMPORT',
            message: `${where} must not dynamically import persistence facade ${target.relative}.`,
          });
        }
      }

      graph.get(fileRelative)?.push(target.relative);
    }

    const ownFacadeManifest = facadeExportManifests[fileRelative];
    if (ownFacadeManifest !== undefined) {
      const exported = extractExportedNames(readFileSync(file, 'utf8'), file);
      if (exported.hasExportStar) {
        violations.push({
          code: 'PERSISTENCE_FACADE_EXPORT_STAR',
          message: `${fileRelative} must not use export *.`,
        });
      }
      if (exported.hasReexport) {
        violations.push({
          code: 'PERSISTENCE_FACADE_REEXPORT',
          message: `${fileRelative} must not re-export from other modules.`,
        });
      }
      if (exported.hasUnclassifiedExport) {
        violations.push({
          code: 'PERSISTENCE_FACADE_EXTRA_EXPORT',
          message: `${fileRelative} contains an unclassified export-bearing form (fail-closed).`,
        });
      }
      const allowed = new Set(ownFacadeManifest.allowedExports);
      for (const name of exported.names) {
        if (!allowed.has(name)) {
          violations.push({
            code: 'PERSISTENCE_FACADE_EXTRA_EXPORT',
            message: `${fileRelative} exports unexpected symbol ${name}.`,
          });
        }
      }
      for (const name of ownFacadeManifest.allowedExports) {
        if (!exported.names.includes(name)) {
          violations.push({
            code: 'PERSISTENCE_FACADE_MISSING_EXPORT',
            message: `${fileRelative} is missing required export ${name}.`,
          });
        }
      }
    }
  }

  const cycle = detectCycle(graph);
  if (cycle) violations.push({ code: 'CYCLE', message: `Dependency cycle: ${cycle.join(' -> ')}` });

  return { filesAnalyzed: files.length, violations };
}
