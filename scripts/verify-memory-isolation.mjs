import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

/**
 * Structural verification of the memory-write security boundary.
 *
 * Guarantee (honest): this checker confirms the structural order of known security calls inside
 * the single exported function `executeMemoryWrite`. It is target-specific and fail-closed, but
 * it is not a full interprocedural TypeScript control-flow proof. Future pipeline changes must
 * update both this checker and its self-tests. Ambiguity is failure, not a warning.
 */

const failures = [];
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const parse = (path) => {
  if (!existsSync(path)) {
    failures.push(`ZERO_FILES: ${path} is missing.`);
    return null;
  }
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true);
};

const callName = (source, node) => {
  if (!ts.isCallExpression(node)) return null;
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.getText(source);
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  return null;
};

const findFunctionsNamed = (source, name) => {
  const found = [];
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node);
    if (
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer)),
      )
    ) {
      for (const declaration of node.declarationList.declarations)
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer))
        )
          found.push(declaration.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

/**
 * Collects direct call expressions inside a function body only. Nested function declarations and
 * nested function/arrow expressions are skipped so dead helpers cannot satisfy the order.
 */
export function collectDirectCalls(source, functionNode) {
  const body = functionNode.body;
  if (!body) return null;
  const calls = [];
  const visit = (node, insideNestedFunction) => {
    if (
      insideNestedFunction === false &&
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)) &&
      node !== functionNode
    ) {
      ts.forEachChild(node, (child) => visit(child, true));
      return;
    }
    if (insideNestedFunction === false && ts.isCallExpression(node)) {
      const name = callName(source, node);
      if (name !== null)
        calls.push({
          name,
          position: node.getStart(source),
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        });
    }
    ts.forEachChild(node, (child) => visit(child, insideNestedFunction));
  };
  if (ts.isBlock(body)) for (const statement of body.statements) visit(statement, false);
  else visit(body, false);
  return calls.sort((left, right) => left.position - right.position);
}

const STAGE_ALIASES = Object.freeze({
  validateOperationContext: 'context-validation',
  markUntrusted: 'untrusted-marking',
  'deps.scanner.scanText': 'text-scan',
  'deps.scanner.scanMetadata': 'metadata-scan',
  classifyData: 'privacy-classification',
  classificationFor: 'privacy-classification',
  authorizeMemoryAccess: 'namespace-authorization',
  'deps.policy.evaluate': 'memory-policy',
  deriveMemoryWriteApprovalDemand: 'approval-demand-derivation',
  validateApproval: 'approval-validation',
  'deps.approvals.consume': 'approval-consumption',
  'deps.memory.write': 'memory-write',
  'deps.audit.record': 'safe-audit',
  readTrustedTimestamp: 'trusted-clock',
});

const REQUIRED_ORDER = Object.freeze([
  'context-validation',
  'text-scan',
  'metadata-scan',
  'privacy-classification',
  'namespace-authorization',
  'memory-policy',
  'approval-demand-derivation',
  'approval-validation',
  'approval-consumption',
  'memory-write',
  'safe-audit',
]);

export function analyzeExecuteMemoryWrite(sourceText, fileName = 'memory-write.service.ts') {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2022, true);
  const localFailures = [];
  const functions = findFunctionsNamed(source, 'executeMemoryWrite');
  if (functions.length === 0) {
    localFailures.push('MISSING_TARGET: executeMemoryWrite was not found.');
    return { ok: false, failures: localFailures };
  }
  if (functions.length > 1) {
    localFailures.push('AMBIGUOUS_TARGET: executeMemoryWrite was found more than once.');
    return { ok: false, failures: localFailures };
  }
  const [target] = functions;
  const calls = collectDirectCalls(source, target);
  if (calls === null) {
    localFailures.push('UNANALYZABLE: executeMemoryWrite body could not be analysed.');
    return { ok: false, failures: localFailures };
  }

  const stagePositions = new Map();
  for (const call of calls) {
    const stage = STAGE_ALIASES[call.name];
    if (stage === undefined) continue;
    if (!stagePositions.has(stage)) stagePositions.set(stage, call.position);
  }

  for (const stage of REQUIRED_ORDER)
    if (!stagePositions.has(stage))
      localFailures.push(`MISSING_STAGE: ${stage} is absent from executeMemoryWrite.`);

  for (let index = 1; index < REQUIRED_ORDER.length; index += 1) {
    const previous = REQUIRED_ORDER[index - 1];
    const current = REQUIRED_ORDER[index];
    const previousPosition = stagePositions.get(previous);
    const currentPosition = stagePositions.get(current);
    if (
      previousPosition !== undefined &&
      currentPosition !== undefined &&
      previousPosition > currentPosition
    )
      localFailures.push(`ORDER_VIOLATION: ${previous} must run before ${current}.`);
  }

  if (!stagePositions.has('trusted-clock'))
    localFailures.push('MISSING_STAGE: trusted-clock (readTrustedTimestamp) is absent.');
  else if (
    stagePositions.has('context-validation') &&
    stagePositions.get('trusted-clock') < stagePositions.get('context-validation')
  )
    localFailures.push('ORDER_VIOLATION: trusted-clock must follow context validation.');

  const writePosition = stagePositions.get('memory-write');
  if (writePosition !== undefined) {
    for (const stage of [
      'text-scan',
      'metadata-scan',
      'namespace-authorization',
      'memory-policy',
      'approval-validation',
      'approval-consumption',
    ]) {
      const position = stagePositions.get(stage);
      if (position !== undefined && position > writePosition)
        localFailures.push(`ORDER_VIOLATION: ${stage} must run before memory-write.`);
    }
  }
  const auditPosition = stagePositions.get('safe-audit');
  if (writePosition !== undefined && auditPosition !== undefined && auditPosition < writePosition)
    localFailures.push('ORDER_VIOLATION: safe-audit must run after memory-write.');

  return { ok: localFailures.length === 0, failures: localFailures, calls };
}

const interfaceMembers = (source, interfaceName) => {
  let members = null;
  const visit = (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) members = node.members;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return members;
};

const parameterTypes = (source, interfaceName, methodName) => {
  const members = interfaceMembers(source, interfaceName);
  if (members === null) {
    failures.push(`MISSING_CONTRACT: interface ${interfaceName} not found.`);
    return null;
  }
  const method = members.find(
    (member) => ts.isMethodSignature(member) && member.name.getText(source) === methodName,
  );
  if (!method) {
    failures.push(`MISSING_CONTRACT: ${interfaceName}.${methodName} not found.`);
    return null;
  }
  return method.parameters.map((parameter) => parameter.type?.getText(source) ?? 'unknown');
};

const expectParameters = (source, interfaceName, methodName, expected) => {
  const actual = parameterTypes(source, interfaceName, methodName);
  if (actual === null) return;
  for (const [index, type] of expected.entries())
    if (actual[index] !== type)
      failures.push(
        `CONTRACT_MISMATCH: ${interfaceName}.${methodName} parameter ${String(index)} is ` +
          `${actual[index] ?? 'absent'}, expected ${type}.`,
      );
};

const servicePath = join(repoRoot, 'src/core/application/memory-write.service.ts');
const isCli =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isCli) {
  const serviceText = existsSync(servicePath) ? readFileSync(servicePath, 'utf8') : null;
  if (serviceText === null) failures.push(`ZERO_FILES: ${servicePath} is missing.`);
  else {
    const analysis = analyzeExecuteMemoryWrite(serviceText, servicePath);
    for (const failure of analysis.failures) failures.push(failure);
  }

  const memoryPort = parse(join(repoRoot, 'src/core/ports/memory.port.ts'));
  if (memoryPort !== null) {
    expectParameters(memoryPort, 'MemoryPort', 'write', [
      'VerifiedMemoryWrite',
      'MemoryAccessContext',
    ]);
    expectParameters(memoryPort, 'MemoryPort', 'delete', [
      'MemoryDeleteRequest',
      'MemoryAccessContext',
    ]);
    expectParameters(memoryPort, 'MemoryPort', 'query', [
      'MemoryQueryRequest',
      'MemoryAccessContext',
    ]);
    expectParameters(memoryPort, 'MemoryPort', 'read', [
      'MemoryReadRequest',
      'MemoryAccessContext',
    ]);
  }

  const auditPort = parse(join(repoRoot, 'src/core/ports/memory-audit.port.ts'));
  if (auditPort !== null)
    expectParameters(auditPort, 'MemoryAuditPort', 'record', [
      'SafeMemoryAuditEvent',
      'MemoryAccessContext',
    ]);

  const mediaAuditPort = parse(join(repoRoot, 'src/core/ports/media-audit-log.port.ts'));
  if (mediaAuditPort !== null)
    expectParameters(mediaAuditPort, 'MediaAuditLogPort', 'record', [
      'SafeMediaAuditEvent',
      'OperationContext',
    ]);

  const policy = parse(join(repoRoot, 'src/core/policy/namespace-isolation.ts'));
  if (policy !== null) {
    const exported = [];
    const visit = (node) => {
      if (ts.isVariableStatement(node) || ts.isFunctionDeclaration(node)) {
        const isExported =
          node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
          true;
        if (isExported && ts.isFunctionDeclaration(node) && node.name)
          exported.push(node.name.text);
        if (isExported && ts.isVariableStatement(node))
          for (const declaration of node.declarationList.declarations)
            exported.push(declaration.name.getText(policy));
      }
      ts.forEachChild(node, visit);
    };
    visit(policy);
    if (!exported.includes('authorizeMemoryAccess'))
      failures.push('MISSING_CONTRACT: authorizeMemoryAccess is not exported.');
    if (!policy.text.includes('MISSING_ACCESS_CONTEXT'))
      failures.push('MISSING_GUARD: default deny for a missing access context is absent.');
  }

  const pipeline = join(repoRoot, 'src/core/pipelines/memory-write.pipeline.md');
  if (!existsSync(pipeline)) failures.push(`ZERO_FILES: ${pipeline} is missing.`);
  else {
    const text = readFileSync(pipeline, 'utf8');
    const scannerIndex = text.indexOf('SensitiveDataScanner');
    const writeIndex = text.indexOf('MemoryPort');
    if (scannerIndex < 0 || writeIndex < 0 || scannerIndex >= writeIndex)
      failures.push('DOC_ORDER: the documented pipeline must scan before writing.');
    if (!text.includes('trusted') && !text.includes('derive'))
      failures.push('DOC_ORDER: approval demand derivation / trusted clock must be documented.');
  }

  /** Mutation self-tests: fixtures prove the checker fails closed. */
  const runMutation = (name, sourceText, expectedCode) => {
    const analysis = analyzeExecuteMemoryWrite(sourceText, `${name}.ts`);
    if (analysis.ok || !analysis.failures.some((failure) => failure.includes(expectedCode)))
      failures.push(
        `MUTATION_MISS: ${name} should fail with ${expectedCode}, got: ${analysis.failures.join(' | ') || 'ok'}`,
      );
  };

  const correctBody = `
export async function executeMemoryWrite(deps, access, command) {
  validateOperationContext(access.operation);
  readTrustedTimestamp(deps.clock);
  markUntrusted(command.rawContent);
  await deps.scanner.scanText(command.rawContent, access.operation);
  await deps.scanner.scanMetadata(command.rawMetadata, access.operation);
  classifyData('owner');
  authorizeMemoryAccess(access, 'write', { ownerId: access.ownerId, namespace: command.targetNamespace });
  await deps.policy.evaluate({}, access);
  deriveMemoryWriteApprovalDemand({});
  validateApproval(null, {}, new Date());
  await deps.approvals.consume('id', 'nonce', access.operation);
  await deps.memory.write({}, access);
  await deps.audit.record({}, access);
}
`;

  runMutation(
    'dead-helper',
    `
function helper(deps, access, command) {
  validateOperationContext(access.operation);
  readTrustedTimestamp(deps.clock);
  markUntrusted(command.rawContent);
  deps.scanner.scanText(command.rawContent, access.operation);
  deps.scanner.scanMetadata(command.rawMetadata, access.operation);
  classifyData('owner');
  authorizeMemoryAccess(access, 'write', { ownerId: access.ownerId, namespace: command.targetNamespace });
  deps.policy.evaluate({}, access);
  deriveMemoryWriteApprovalDemand({});
  validateApproval(null, {}, new Date());
  deps.approvals.consume('id', 'nonce', access.operation);
  deps.memory.write({}, access);
  deps.audit.record({}, access);
}
export async function executeMemoryWrite(deps) {
  await deps.memory.write({}, {});
}
`,
    'MISSING_STAGE',
  );

  runMutation(
    'scanner-after-write',
    correctBody
      .replace(
        'await deps.scanner.scanText(command.rawContent, access.operation);\n  await deps.scanner.scanMetadata(command.rawMetadata, access.operation);',
        '',
      )
      .replace(
        'await deps.memory.write({}, access);',
        'await deps.memory.write({}, access);\n  await deps.scanner.scanText(command.rawContent, access.operation);\n  await deps.scanner.scanMetadata(command.rawMetadata, access.operation);',
      ),
    'ORDER_VIOLATION',
  );

  runMutation(
    'audit-before-write',
    correctBody.replace(
      'await deps.memory.write({}, access);\n  await deps.audit.record({}, access);',
      'await deps.audit.record({}, access);\n  await deps.memory.write({}, access);',
    ),
    'ORDER_VIOLATION',
  );

  runMutation(
    'missing-authorization',
    correctBody.replace(
      "authorizeMemoryAccess(access, 'write', { ownerId: access.ownerId, namespace: command.targetNamespace });\n  ",
      '',
    ),
    'MISSING_STAGE',
  );

  runMutation(
    'approval-after-write',
    correctBody.replace(
      "deriveMemoryWriteApprovalDemand({});\n  validateApproval(null, {}, new Date());\n  await deps.approvals.consume('id', 'nonce', access.operation);\n  await deps.memory.write({}, access);",
      "await deps.memory.write({}, access);\n  deriveMemoryWriteApprovalDemand({});\n  validateApproval(null, {}, new Date());\n  await deps.approvals.consume('id', 'nonce', access.operation);",
    ),
    'ORDER_VIOLATION',
  );

  runMutation(
    'missing-function',
    `export async function other() { await deps.memory.write({}, {}); }`,
    'MISSING_TARGET',
  );

  runMutation(
    'ambiguous-target',
    `
export async function executeMemoryWrite() { validateOperationContext({}); }
export async function executeMemoryWrite() { validateOperationContext({}); }
`,
    'AMBIGUOUS_TARGET',
  );

  runMutation(
    'comment-not-stage',
    `
export async function executeMemoryWrite(deps, access, command) {
  // validateOperationContext authorizeMemoryAccess deps.scanner.scanText
  const note = "deps.memory.write";
  await deps.memory.write({}, access);
}
`,
    'MISSING_STAGE',
  );

  const production = analyzeExecuteMemoryWrite(correctBody, 'correct.ts');
  if (!production.ok)
    failures.push(`SELF_TEST_BROKEN: correct fixture failed: ${production.failures.join(' | ')}`);

  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log(
    'Memory isolation checks passed (target-specific AST order, port contracts, mutation self-tests).',
  );
}
