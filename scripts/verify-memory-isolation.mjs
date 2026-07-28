import { existsSync, readFileSync } from 'node:fs';
import ts from 'typescript';

/**
 * Structural verification of the memory security boundary. The call order and the port signatures
 * are read from the TypeScript AST, so the guarantee no longer depends on Markdown prose.
 */

const failures = [];

const parse = (path) => {
  if (!existsSync(path)) {
    failures.push(`ZERO_FILES: ${path} is missing.`);
    return null;
  }
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true);
};

const callSequence = (source) => {
  const calls = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression))
      calls.push({ name: node.expression.getText(source), position: node.getStart(source) });
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls.sort((left, right) => left.position - right.position).map((call) => call.name);
};

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

const service = parse('src/core/application/memory-write.service.ts');
if (service !== null) {
  const sequence = callSequence(service);
  const expectedOrder = [
    'deps.scanner.scanText',
    'deps.scanner.scanMetadata',
    'deps.policy.evaluate',
    'deps.memory.write',
    'deps.audit.record',
  ];
  const positions = expectedOrder.map((name) => sequence.indexOf(name));
  expectedOrder.forEach((name, index) => {
    if (positions[index] < 0) failures.push(`MISSING_STEP: ${name} is never called.`);
  });
  for (let index = 1; index < positions.length; index += 1)
    if (
      positions[index - 1] >= 0 &&
      positions[index] >= 0 &&
      positions[index - 1] > positions[index]
    )
      failures.push(
        `ORDER_VIOLATION: ${expectedOrder[index - 1]} must run before ${expectedOrder[index]}.`,
      );
  if (
    !sequence.includes('authorizeMemoryAccess') &&
    !service.text.includes('authorizeMemoryAccess')
  )
    failures.push('MISSING_STEP: namespace authorization is not applied.');
}

const memoryPort = parse('src/core/ports/memory.port.ts');
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
  expectParameters(memoryPort, 'MemoryPort', 'read', ['MemoryReadRequest', 'MemoryAccessContext']);
}

const auditPort = parse('src/core/ports/memory-audit.port.ts');
if (auditPort !== null)
  expectParameters(auditPort, 'MemoryAuditPort', 'record', [
    'SafeMemoryAuditEvent',
    'MemoryAccessContext',
  ]);

const mediaAuditPort = parse('src/core/ports/media-audit-log.port.ts');
if (mediaAuditPort !== null)
  expectParameters(mediaAuditPort, 'MediaAuditLogPort', 'record', [
    'SafeMediaAuditEvent',
    'OperationContext',
  ]);

const policy = parse('src/core/policy/namespace-isolation.ts');
if (policy !== null) {
  const exported = [];
  const visit = (node) => {
    if (ts.isVariableStatement(node) || ts.isFunctionDeclaration(node)) {
      const isExported =
        node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
      if (isExported && ts.isFunctionDeclaration(node) && node.name) exported.push(node.name.text);
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

const pipeline = 'src/core/pipelines/memory-write.pipeline.md';
if (!existsSync(pipeline)) failures.push(`ZERO_FILES: ${pipeline} is missing.`);
else {
  const text = readFileSync(pipeline, 'utf8');
  const scannerIndex = text.indexOf('SensitiveDataScanner');
  const writeIndex = text.indexOf('MemoryPort');
  if (scannerIndex < 0 || writeIndex < 0 || scannerIndex >= writeIndex)
    failures.push('DOC_ORDER: the documented pipeline must scan before writing.');
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Memory isolation checks passed (AST-verified order and port contracts).');
