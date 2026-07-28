import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeExecuteMemoryWrite } from '../scripts/verify-memory-isolation.mjs';

const straightLine = `
export async function executeMemoryWrite(deps, access, command) {
  validateOperationContext(access.operation);
  readTrustedTimestamp(deps.clock);
  normalizeMemoryWriteContent(command.rawContent);
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

describe('memory AST enforcement is target-specific and path-aware', () => {
  it('accepts the production executeMemoryWrite body', () => {
    const source = readFileSync('src/core/application/memory-write.service.ts', 'utf8');
    const report = analyzeExecuteMemoryWrite(source, 'memory-write.service.ts');
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it('accepts a straight-line safe fixture', () => {
    expect(analyzeExecuteMemoryWrite(straightLine, 'straight.ts').ok).toBe(true);
  });

  it('ignores a correctly ordered dead helper', () => {
    const report = analyzeExecuteMemoryWrite(
      `
function helper(deps, access, command) {
  validateOperationContext(access.operation);
  readTrustedTimestamp(deps.clock);
  normalizeMemoryWriteContent(command.rawContent);
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
      'dead-helper.ts',
    );
    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.includes('MISSING_STAGE'))).toBe(true);
  });

  it('fails when stages are in if and write is in else', () => {
    const report = analyzeExecuteMemoryWrite(
      `
export async function executeMemoryWrite(deps, access, command) {
  if (false) {
    validateOperationContext(access.operation);
    readTrustedTimestamp(deps.clock);
    normalizeMemoryWriteContent(command.rawContent);
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
  } else {
    await deps.memory.write({}, access);
  }
}
`,
      'if-else-split.ts',
    );
    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.includes('AMBIGUOUS_CONTROL_FLOW'))).toBe(
      true,
    );
  });

  it('fails when scanner runs after the memory sink', () => {
    const report = analyzeExecuteMemoryWrite(
      straightLine
        .replace(
          'await deps.scanner.scanText(command.rawContent, access.operation);\n  await deps.scanner.scanMetadata(command.rawMetadata, access.operation);\n  ',
          '',
        )
        .replace(
          'await deps.memory.write({}, access);',
          'await deps.memory.write({}, access);\n  await deps.scanner.scanText(command.rawContent, access.operation);\n  await deps.scanner.scanMetadata(command.rawMetadata, access.operation);',
        ),
      'scanner-after-write.ts',
    );
    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.includes('ORDER_VIOLATION'))).toBe(true);
  });

  it('fails when normalization or untrusted marking is missing or reordered', () => {
    expect(
      analyzeExecuteMemoryWrite(
        straightLine.replace('normalizeMemoryWriteContent(command.rawContent);\n  ', ''),
        'missing-normalization.ts',
      ).failures.some((failure) => failure.includes('MISSING_STAGE')),
    ).toBe(true);
    expect(
      analyzeExecuteMemoryWrite(
        straightLine.replace('markUntrusted(command.rawContent);\n  ', ''),
        'missing-untrusted.ts',
      ).failures.some((failure) => failure.includes('MISSING_STAGE')),
    ).toBe(true);
    expect(
      analyzeExecuteMemoryWrite(
        straightLine
          .replace('normalizeMemoryWriteContent(command.rawContent);\n  ', '')
          .replace(
            'await deps.scanner.scanText(command.rawContent, access.operation);',
            'normalizeMemoryWriteContent(command.rawContent);\n  await deps.scanner.scanText(command.rawContent, access.operation);',
          ),
        'normalization-after-scanner.ts',
      ).failures.some((failure) => failure.includes('ORDER_VIOLATION')),
    ).toBe(true);
  });

  it('fails closed for loops, callbacks, try/catch and logical stage calls', () => {
    expect(
      analyzeExecuteMemoryWrite(
        straightLine.replace(
          'await deps.scanner.scanText(command.rawContent, access.operation);',
          'for (const _ of [1]) { await deps.scanner.scanText(command.rawContent, access.operation); }',
        ),
        'loop.ts',
      ).failures.some((failure) => failure.includes('AMBIGUOUS_CONTROL_FLOW')),
    ).toBe(true);
    expect(
      analyzeExecuteMemoryWrite(
        `
export async function executeMemoryWrite(deps, access, command) {
  validateOperationContext(access.operation);
  readTrustedTimestamp(deps.clock);
  normalizeMemoryWriteContent(command.rawContent);
  markUntrusted(command.rawContent);
  await deps.scanner.scanText(command.rawContent, access.operation);
  await deps.scanner.scanMetadata(command.rawMetadata, access.operation);
  classifyData('owner');
  authorizeMemoryAccess(access, 'write', { ownerId: access.ownerId, namespace: command.targetNamespace });
  await deps.policy.evaluate({}, access);
  deriveMemoryWriteApprovalDemand({});
  validateApproval(null, {}, new Date());
  await deps.approvals.consume('id', 'nonce', access.operation);
  const run = async () => { await deps.memory.write({}, access); };
  await run();
  await deps.audit.record({}, access);
}
`,
        'callback-write.ts',
      ).failures.some((failure) => failure.includes('AMBIGUOUS_CONTROL_FLOW')),
    ).toBe(true);
    expect(
      analyzeExecuteMemoryWrite(
        straightLine.replace(
          'await deps.memory.write({}, access);',
          'try { await deps.memory.write({}, access); } catch (error) { await deps.memory.write({}, access); }',
        ),
        'try-catch-write.ts',
      ).failures.some((failure) => failure.includes('AMBIGUOUS_CONTROL_FLOW')),
    ).toBe(true);
    expect(
      analyzeExecuteMemoryWrite(
        straightLine.replace(
          'markUntrusted(command.rawContent);',
          'true && markUntrusted(command.rawContent);',
        ),
        'logical-stage.ts',
      ).failures.some((failure) => failure.includes('AMBIGUOUS_CONTROL_FLOW')),
    ).toBe(true);
  });

  it('fails closed when executeMemoryWrite is missing or ambiguous', () => {
    expect(analyzeExecuteMemoryWrite('export async function other() {}').ok).toBe(false);
    expect(
      analyzeExecuteMemoryWrite(
        `
export async function executeMemoryWrite() { validateOperationContext({}); }
export async function executeMemoryWrite() { validateOperationContext({}); }
`,
      ).failures.some((failure) => failure.includes('AMBIGUOUS_TARGET')),
    ).toBe(true);
  });

  it('does not treat comments or string literals as stages', () => {
    const report = analyzeExecuteMemoryWrite(
      `
export async function executeMemoryWrite(deps) {
  // validateOperationContext authorizeMemoryAccess deps.scanner.scanText
  const note = "deriveMemoryWriteApprovalDemand";
  await deps.memory.write({}, {});
}
`,
    );
    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.includes('MISSING_STAGE'))).toBe(true);
  });
});
