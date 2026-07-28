import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeExecuteMemoryWrite } from '../scripts/verify-memory-isolation.mjs';

describe('memory AST enforcement is target-specific', () => {
  it('accepts the production executeMemoryWrite body', () => {
    const source = readFileSync('src/core/application/memory-write.service.ts', 'utf8');
    const report = analyzeExecuteMemoryWrite(source, 'memory-write.service.ts');
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it('ignores a correctly ordered dead helper', () => {
    const report = analyzeExecuteMemoryWrite(
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
      'dead-helper.ts',
    );
    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.includes('MISSING_STAGE'))).toBe(true);
  });

  it('fails when scanner runs after the memory sink', () => {
    const report = analyzeExecuteMemoryWrite(
      `
export async function executeMemoryWrite(deps, access, command) {
  validateOperationContext(access.operation);
  readTrustedTimestamp(deps.clock);
  markUntrusted(command.rawContent);
  classifyData('owner');
  authorizeMemoryAccess(access, 'write', { ownerId: access.ownerId, namespace: command.targetNamespace });
  await deps.policy.evaluate({}, access);
  deriveMemoryWriteApprovalDemand({});
  validateApproval(null, {}, new Date());
  await deps.approvals.consume('id', 'nonce', access.operation);
  await deps.memory.write({}, access);
  await deps.scanner.scanText(command.rawContent, access.operation);
  await deps.scanner.scanMetadata(command.rawMetadata, access.operation);
  await deps.audit.record({}, access);
}
`,
      'scanner-after-write.ts',
    );
    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.includes('ORDER_VIOLATION'))).toBe(true);
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
