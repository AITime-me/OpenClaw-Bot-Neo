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
  'core/domain': ['core/domain'],
  'core/ports': ['core/domain', 'core/ports'],
  'core/policy': ['core/domain', 'core/ports', 'core/policy'],
  'core/routing': ['core/domain', 'core/ports', 'core/routing'],
  'core/config': ['core/domain', 'core/routing', 'core/config'],
  'core/runtime': ['core/runtime'],
  'core/application': [
    'core/domain',
    'core/ports',
    'core/policy',
    'core/routing',
    'core/application',
  ],
  /**
   * App-private local composition (Build 3.0+) and pure config bootstrap (Build 3.1).
   * May use public core surfaces only, including core/config parsers.
   * Must not import core internals, tests, scripts, or future channel/adapters trees.
   */
  host: ['core/domain', 'core/ports', 'core/policy', 'core/application', 'core/config', 'host'],
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
];

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
    'core/application/memory-write.service.ts',
  ],
  'core/domain/memory-access.internal.ts': [
    'core/domain/index.ts',
    'core/policy/namespace-isolation.ts',
    'core/application/memory-write.service.ts',
    'core/application/memory-access.gateway.ts',
  ],
};

const toPosix = (value) => value.split('\\').join('/');

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

const layerOf = (relativePath) => {
  const path = toPosix(relativePath);
  const known = Object.keys(CORE_LAYER_RULES).filter((layer) => layer !== 'root');
  const match = known.find((layer) => path.startsWith(`${layer}/`));
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
 *   internalAllowlist?: Record<string, string[]> }} [options]
 */
export function analyzeBoundaries(options = {}) {
  const rootDir = resolve(options.rootDir ?? 'src');
  const layerRules = options.layerRules ?? CORE_LAYER_RULES;
  const requiredLayers = options.requiredLayers ?? REQUIRED_CORE_LAYERS;
  const internalAllowlist = options.internalAllowlist ?? INTERNAL_MODULE_ALLOWLIST;
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
      if (reference.kind === 'dynamic-import')
        violations.push({
          code: 'DYNAMIC_IMPORT_FORBIDDEN',
          message: `${where} uses dynamic import; core cannot load executable extensions.`,
        });
      if (isBuiltin(reference.specifier)) continue;
      if (!reference.specifier.startsWith('.')) {
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
      graph.get(fileRelative)?.push(target.relative);
    }
  }

  const cycle = detectCycle(graph);
  if (cycle) violations.push({ code: 'CYCLE', message: `Dependency cycle: ${cycle.join(' -> ')}` });

  return { filesAnalyzed: files.length, violations };
}
