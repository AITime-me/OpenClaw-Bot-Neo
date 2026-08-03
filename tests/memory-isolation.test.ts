import { analyzeExecuteMemoryWrite } from '../scripts/verify-memory-isolation.mjs';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const straightLine = `
export async function executeMemoryWrite(deps, access, command) {
  validateOperationContext(access.operation);
  readTrustedTimestamp(deps.clock);
  normalizeMemoryWriteContent(command.rawContent);
  markUntrusted(command.rawContent);
  evaluateMemorySecretBoundary({ contentSensitivity: command.contentSensitivity, rawContent: command.rawContent, rawMetadata: command.rawMetadata });
  await deps.scanner.scanText(command.rawContent, access.operation);
  await deps.scanner.scanMetadata(command.rawMetadata, access.operation);
  classifyData('owner');
  authorizeMemoryAccess(access, 'write', { ownerId: access.ownerId, namespace: command.targetNamespace });
  const policyResult = await deps.policy.evaluate({}, access);
  deriveMemoryWriteApprovalDemand({});
  if (policyResult.value.decision === 'approval-required') {
    if (command.approvalId === null) return err({ code: 'APPROVAL_REQUIRED' });
    const grant = await deps.approvals.lookup(command.approvalId, access.operation);
    if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });
    const validated = validateApproval(grant.value, demand, trustedNow);
    if (!validated.ok) return err({ code: 'APPROVAL_INVALID' });
    const consumed = await deps.approvals.consume(validated.value.approvalId, validated.value.nonce, access.operation);
    if (!consumed.ok) return err({ code: 'CONSUMPTION_FAILED' });
  }
  await deps.memory.write({}, access);
  await deps.audit.record({}, access);
}
`;

const nestedCanonicalStages = `
  validateOperationContext(access.operation);
  readTrustedTimestamp(deps.clock);
  normalizeMemoryWriteContent(command.rawContent);
  markUntrusted(command.rawContent);
  evaluateMemorySecretBoundary({ contentSensitivity: command.contentSensitivity, rawContent: command.rawContent, rawMetadata: command.rawMetadata });
  deps.scanner.scanText(command.rawContent, access.operation);
  deps.scanner.scanMetadata(command.rawMetadata, access.operation);
  classifyData('owner');
  authorizeMemoryAccess(access, 'write', { ownerId: access.ownerId, namespace: command.targetNamespace });
  deps.policy.evaluate({}, access);
  deriveMemoryWriteApprovalDemand({});
  deps.approvals.lookup(command.approvalId, access.operation);
  validateApproval({}, {}, trustedNow);
  deps.approvals.consume('id', 'nonce', access.operation);
  deps.memory.write({}, access);
  deps.audit.record({}, access);
`;

describe('memory AST enforcement is target-specific and path-aware', () => {
  it('accepts the production executeMemoryWrite body', () => {
    const source = readFileSync('src/core/application/memory-write.service.ts', 'utf8');
    const report = analyzeExecuteMemoryWrite(source, 'memory-write.service.ts');
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it('accepts a canonical approval-gate fixture', () => {
    expect(analyzeExecuteMemoryWrite(straightLine, 'straight.ts').ok).toBe(true);
  });

  it('rejects if(false) approval gates', () => {
    const report = analyzeExecuteMemoryWrite(
      straightLine.replace(
        "if (policyResult.value.decision === 'approval-required')",
        'if (false)',
      ),
      'false-gate.ts',
    );
    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.includes('AMBIGUOUS_CONTROL_FLOW'))).toBe(
      true,
    );
  });

  it('rejects unrelated approval conditions', () => {
    const report = analyzeExecuteMemoryWrite(
      straightLine.replace(
        "if (policyResult.value.decision === 'approval-required')",
        'if (unrelatedFlag)',
      ),
      'unrelated-gate.ts',
    );
    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.includes('AMBIGUOUS_CONTROL_FLOW'))).toBe(
      true,
    );
  });

  it('rejects inverted approval conditions', () => {
    const report = analyzeExecuteMemoryWrite(
      straightLine.replace(
        "if (policyResult.value.decision === 'approval-required')",
        "if (policyResult.value.decision !== 'approval-required')",
      ),
      'inverted-gate.ts',
    );
    expect(report.ok).toBe(false);
  });

  it('rejects approval after write', () => {
    const report = analyzeExecuteMemoryWrite(
      straightLine.replace(
        `deriveMemoryWriteApprovalDemand({});
  if (policyResult.value.decision === 'approval-required') {
    if (command.approvalId === null) return err({ code: 'APPROVAL_REQUIRED' });
    const grant = await deps.approvals.lookup(command.approvalId, access.operation);
    if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });
    const validated = validateApproval(grant.value, demand, trustedNow);
    if (!validated.ok) return err({ code: 'APPROVAL_INVALID' });
    const consumed = await deps.approvals.consume(validated.value.approvalId, validated.value.nonce, access.operation);
    if (!consumed.ok) return err({ code: 'CONSUMPTION_FAILED' });
  }
  await deps.memory.write({}, access);`,
        `await deps.memory.write({}, access);
  deriveMemoryWriteApprovalDemand({});
  if (policyResult.value.decision === 'approval-required') {
    if (command.approvalId === null) return err({ code: 'APPROVAL_REQUIRED' });
    const grant = await deps.approvals.lookup(command.approvalId, access.operation);
    if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });
    const validated = validateApproval(grant.value, demand, trustedNow);
    if (!validated.ok) return err({ code: 'APPROVAL_INVALID' });
    const consumed = await deps.approvals.consume(validated.value.approvalId, validated.value.nonce, access.operation);
    if (!consumed.ok) return err({ code: 'CONSUMPTION_FAILED' });
  }`,
      ),
      'approval-after-write.ts',
    );
    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.includes('ORDER_VIOLATION'))).toBe(true);
  });

  it('rejects write in else/catch/finally and optional logical approval', () => {
    expect(
      analyzeExecuteMemoryWrite(
        `
export async function executeMemoryWrite(deps, access, command) {
  validateOperationContext(access.operation);
  readTrustedTimestamp(deps.clock);
  normalizeMemoryWriteContent(command.rawContent);
  markUntrusted(command.rawContent);
  evaluateMemorySecretBoundary({ contentSensitivity: command.contentSensitivity, rawContent: command.rawContent, rawMetadata: command.rawMetadata });
  await deps.scanner.scanText(command.rawContent, access.operation);
  await deps.scanner.scanMetadata(command.rawMetadata, access.operation);
  classifyData('owner');
  authorizeMemoryAccess(access, 'write', { ownerId: access.ownerId, namespace: command.targetNamespace });
  const policyResult = await deps.policy.evaluate({}, access);
  deriveMemoryWriteApprovalDemand({});
  if (policyResult.value.decision === 'approval-required') {
    const grant = await deps.approvals.lookup(command.approvalId, access.operation);
    if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });
    const validated = validateApproval(grant.value, demand, trustedNow);
    if (!validated.ok) return err({ code: 'APPROVAL_INVALID' });
    const consumed = await deps.approvals.consume(validated.value.approvalId, validated.value.nonce, access.operation);
    if (!consumed.ok) return err({ code: 'CONSUMPTION_FAILED' });
  } else {
    await deps.memory.write({}, access);
  }
  await deps.audit.record({}, access);
}
`,
        'write-in-else.ts',
      ).failures.some((failure) => failure.includes('AMBIGUOUS_CONTROL_FLOW')),
    ).toBe(true);

    expect(
      analyzeExecuteMemoryWrite(
        straightLine.replace(
          'await deps.memory.write({}, access);',
          'try { await deps.memory.write({}, access); } catch (error) { await deps.memory.write({}, access); } finally { await deps.memory.write({}, access); }',
        ),
        'write-in-try.ts',
      ).failures.some(
        (failure) =>
          failure.includes('UNSUPPORTED_CONTROL_FLOW') ||
          failure.includes('AMBIGUOUS_CONTROL_FLOW'),
      ),
    ).toBe(true);

    expect(
      analyzeExecuteMemoryWrite(
        straightLine.replace(
          "if (policyResult.value.decision === 'approval-required')",
          "policyResult.value.decision === 'approval-required' && true &&",
        ),
        'logical-and-gate.ts',
      ).ok,
    ).toBe(false);
  });

  it('rejects deny branch without terminating return', () => {
    const report = analyzeExecuteMemoryWrite(
      straightLine.replace(
        "if (command.approvalId === null) return err({ code: 'APPROVAL_REQUIRED' });",
        'if (command.approvalId === null) { const ignored = true; }',
      ),
      'non-terminating-deny.ts',
    );
    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.includes('AMBIGUOUS_CONTROL_FLOW'))).toBe(
      true,
    );
  });

  it('ignores a correctly ordered dead helper', () => {
    const report = analyzeExecuteMemoryWrite(
      `
function helper(deps, access, command) {
  validateOperationContext(access.operation);
  readTrustedTimestamp(deps.clock);
  normalizeMemoryWriteContent(command.rawContent);
  markUntrusted(command.rawContent);
  evaluateMemorySecretBoundary({ contentSensitivity: command.contentSensitivity, rawContent: command.rawContent, rawMetadata: command.rawMetadata });
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
  });

  it('fails closed for loops, callbacks, try/catch and logical stage calls', () => {
    expect(
      analyzeExecuteMemoryWrite(
        straightLine.replace(
          'await deps.scanner.scanText(command.rawContent, access.operation);',
          'for (const _ of [1]) { await deps.scanner.scanText(command.rawContent, access.operation); }',
        ),
        'loop.ts',
      ).failures.some(
        (failure) =>
          failure.includes('UNSUPPORTED_CONTROL_FLOW') ||
          failure.includes('AMBIGUOUS_CONTROL_FLOW'),
      ),
    ).toBe(true);
    expect(
      analyzeExecuteMemoryWrite(
        `
export async function executeMemoryWrite(deps, access, command) {
  validateOperationContext(access.operation);
  readTrustedTimestamp(deps.clock);
  normalizeMemoryWriteContent(command.rawContent);
  markUntrusted(command.rawContent);
  evaluateMemorySecretBoundary({ contentSensitivity: command.contentSensitivity, rawContent: command.rawContent, rawMetadata: command.rawMetadata });
  await deps.scanner.scanText(command.rawContent, access.operation);
  await deps.scanner.scanMetadata(command.rawMetadata, access.operation);
  classifyData('owner');
  authorizeMemoryAccess(access, 'write', { ownerId: access.ownerId, namespace: command.targetNamespace });
  const policyResult = await deps.policy.evaluate({}, access);
  deriveMemoryWriteApprovalDemand({});
  if (policyResult.value.decision === 'approval-required') {
    const grant = await deps.approvals.lookup(command.approvalId, access.operation);
    if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });
    const validated = validateApproval(grant.value, demand, trustedNow);
    if (!validated.ok) return err({ code: 'APPROVAL_INVALID' });
    const consumed = await deps.approvals.consume(validated.value.approvalId, validated.value.nonce, access.operation);
    if (!consumed.ok) return err({ code: 'CONSUMPTION_FAILED' });
  }
  const run = async () => { await deps.memory.write({}, access); };
  await run();
  await deps.audit.record({}, access);
}
`,
        'callback-write.ts',
      ).failures.some((failure) => failure.includes('AMBIGUOUS_CONTROL_FLOW')),
    ).toBe(true);
  });

  it.each([
    ['class method', `const Dead = class { run() { ${nestedCanonicalStages} } };`],
    ['static class method', `const Dead = class { static run() { ${nestedCanonicalStages} } };`],
    ['constructor', `const Dead = class { constructor() { ${nestedCanonicalStages} } };`],
    ['class getter', `const Dead = class { get run() { ${nestedCanonicalStages} return true; } };`],
    ['class setter', `const Dead = class { set run(value) { ${nestedCanonicalStages} } };`],
    ['class arrow property', `const Dead = class { run = () => { ${nestedCanonicalStages} }; };`],
    [
      'class function property',
      `const Dead = class { run = function () { ${nestedCanonicalStages} }; };`,
    ],
    ['class static block', `const Dead = class { static { ${nestedCanonicalStages} } };`],
    ['object method', `const dead = { run() { ${nestedCanonicalStages} } };`],
    ['object getter', `const dead = { get run() { ${nestedCanonicalStages} return true; } };`],
    ['object setter', `const dead = { set run(value) { ${nestedCanonicalStages} } };`],
    [
      'nested class expression',
      `const dead = true ? class { run() { ${nestedCanonicalStages} } } : null;`,
    ],
    ['array nested method', `const dead = [{ run() { ${nestedCanonicalStages} } }];`],
    ['object nested method', `const dead = { nested: { run() { ${nestedCanonicalStages} } } };`],
  ])('rejects stages inside a dead %s boundary', (_label, declaration) => {
    const report = analyzeExecuteMemoryWrite(
      `export async function executeMemoryWrite(deps, access, command) {
        ${declaration}
        return { ok: true };
      }`,
      'dead-nested-boundary.ts',
    );
    expect(report.ok).toBe(false);
    expect(
      report.failures.some((failure) => failure.includes('nested executable boundaries')),
    ).toBe(true);
  });

  it('rejects a method after return and nested stages beside harmless direct calls', () => {
    for (const source of [
      `export async function executeMemoryWrite(deps, access, command) {
        return { ok: true };
        class Dead { run() { ${nestedCanonicalStages} } }
      }`,
      straightLine.replace(
        'await deps.memory.write({}, access);',
        `const dead = { run() { ${nestedCanonicalStages} } };
         harmless();
         await deps.memory.write({}, access);`,
      ),
    ]) {
      const report = analyzeExecuteMemoryWrite(source, 'dead-after-return.ts');
      expect(report.ok).toBe(false);
      expect(
        report.failures.some((failure) => failure.includes('nested executable boundaries')),
      ).toBe(true);
    }
  });

  it.each([
    [
      '.ok only in a comment',
      "if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });",
      "// grant.ok\n    const note = 'not a guard';",
    ],
    [
      '.ok only in a string',
      "if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });",
      "const note = 'grant.ok';",
    ],
    [
      'validated.value only in a string',
      'validated.value.approvalId, validated.value.nonce',
      "unrelated.approvalId, unrelated.nonce /* 'validated.value' */",
    ],
    [
      'unrelated object ok',
      "if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });",
      "if (!other.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });",
    ],
    [
      'wrong lookup result checked',
      "if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });",
      "if (!wrongGrant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });",
    ],
    [
      'wrong validation result consumed',
      'validated.value.approvalId, validated.value.nonce',
      'otherValidation.value.approvalId, otherValidation.value.nonce',
    ],
    [
      'consume unrelated value',
      'validated.value.approvalId, validated.value.nonce',
      'unrelated.value.approvalId, unrelated.value.nonce',
    ],
  ])('rejects approval proof with %s', (_label, before, after) => {
    const report = analyzeExecuteMemoryWrite(
      straightLine.replace(before, after),
      'approval-ast.ts',
    );
    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.includes('must be checked'))).toBe(true);
  });

  it('rejects a shadowed approval result identifier', () => {
    const report = analyzeExecuteMemoryWrite(
      straightLine.replace(
        "if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });",
        "if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });\n    { const grant = { ok: true }; harmless(grant); }",
      ),
      'approval-shadow.ts',
    );
    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.includes('must be checked'))).toBe(true);
  });

  it.each([
    [
      'clock after write',
      straightLine
        .replace('  readTrustedTimestamp(deps.clock);\n', '')
        .replace(
          '  await deps.memory.write({}, access);',
          '  await deps.memory.write({}, access);\n  readTrustedTimestamp(deps.clock);',
        ),
    ],
    [
      'clock after consume',
      straightLine
        .replace('  readTrustedTimestamp(deps.clock);\n', '')
        .replace(
          '    if (!consumed.ok)',
          '    readTrustedTimestamp(deps.clock);\n    if (!consumed.ok)',
        ),
    ],
    [
      'clock in optional branch',
      straightLine.replace(
        '  readTrustedTimestamp(deps.clock);',
        '  enabled && readTrustedTimestamp(deps.clock);',
      ),
    ],
    [
      'clock in nested callback',
      straightLine.replace(
        '  readTrustedTimestamp(deps.clock);',
        '  const readClock = () => readTrustedTimestamp(deps.clock);',
      ),
    ],
    ['unrelated Date.now', straightLine.replace('readTrustedTimestamp(deps.clock)', 'Date.now()')],
  ])('rejects %s', (_label, source) => {
    const report = analyzeExecuteMemoryWrite(source, 'trusted-clock-order.ts');
    expect(report.ok).toBe(false);
    expect(
      report.failures.some(
        (failure) =>
          failure.includes('trusted-clock') ||
          failure.includes('ORDER_VIOLATION') ||
          failure.includes('AMBIGUOUS_CONTROL_FLOW'),
      ),
    ).toBe(true);
  });

  it.each([
    ['direct alias', 'const write = deps.memory.write; await write({}, access);'],
    ['destructured alias', 'const { write } = deps.memory; await write({}, access);'],
    [
      'renamed destructured alias',
      'const { write: persist } = deps.memory; await persist({}, access);',
    ],
    [
      'intermediate object',
      'const holder = { write: deps.memory.write }; await holder.write({}, access);',
    ],
    ['array alias', 'const writes = [deps.memory.write]; await writes[0]({}, access);'],
    ['bind', 'const write = deps.memory.write.bind(deps.memory); await write({}, access);'],
    ['call', 'await deps.memory.write.call(deps.memory, {}, access);'],
    ['apply', 'await deps.memory.write.apply(deps.memory, [{}, access]);'],
    ['sync wrapper', 'const write = () => deps.memory.write({}, access); await write();'],
    [
      'async wrapper',
      'const write = async () => await deps.memory.write({}, access); await write();',
    ],
    ['passed function', 'const invoke = (fn) => fn({}, access); await invoke(deps.memory.write);'],
    ['computed property', "await deps.memory['write']({}, access);"],
    ['optional call', 'await deps.memory.write?.({}, access);'],
    ['dependency alias', 'const ports = deps; await ports.memory.write({}, access);'],
    ['destructured dependency', 'const { memory } = deps; await memory.write({}, access);'],
    ['optional dependency', 'await deps?.memory.write({}, access);'],
    [
      'returned function',
      'const provide = () => deps.memory.write; const write = provide(); await write({}, access);',
    ],
    [
      'ternary alias',
      'const write = true ? deps.memory.write : deps.memory.write; await write({}, access);',
    ],
    ['logical alias', 'const write = deps.memory.write || fallback; await write({}, access);'],
  ])('rejects %s security-stage escape', (_label, replacement) => {
    const report = analyzeExecuteMemoryWrite(
      straightLine.replace('await deps.memory.write({}, access);', replacement),
      'alias-escape.ts',
    );
    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.includes('AMBIGUOUS'))).toBe(true);
  });

  it.each([
    ['lookup', 'const lookup = deps.approvals.lookup;'],
    ['validation', 'const check = validateApproval;'],
    ['consume', 'const consume = deps.approvals.consume;'],
  ])('rejects approval %s alias even with canonical calls retained', (_label, alias) => {
    const report = analyzeExecuteMemoryWrite(
      straightLine.replace(
        "if (policyResult.value.decision === 'approval-required') {",
        `if (policyResult.value.decision === 'approval-required') { ${alias}`,
      ),
      'approval-alias.ts',
    );
    expect(report.ok).toBe(false);
    expect(
      report.failures.some((failure) => failure.includes('AMBIGUOUS_SECURITY_REFERENCE')),
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

  const withoutTail = straightLine.replace(
    `  await deps.memory.write({}, access);
  await deps.audit.record({}, access);
}
`,
    '',
  );

  it.each([
    [
      'all stages after return',
      `export async function executeMemoryWrite(deps, access, command) {
  return { ok: true };
${straightLine.replace('export async function executeMemoryWrite(deps, access, command) {', '')}`,
    ],
    [
      'only memory write after return',
      `${withoutTail}
  return { ok: true };
  await deps.memory.write({}, access);
  await deps.audit.record({}, access);
}`,
    ],
    [
      'clock and write after return',
      `export async function executeMemoryWrite(deps, access, command) {
  return { ok: true };
  readTrustedTimestamp(deps.clock);
  await deps.memory.write({}, access);
}`,
    ],
    [
      'approval sequence after return',
      `export async function executeMemoryWrite(deps, access, command) {
  return { ok: true };
  const grant = await deps.approvals.lookup(command.approvalId, access.operation);
  const validated = validateApproval(grant.value, demand, trustedNow);
  const consumed = await deps.approvals.consume(validated.value.approvalId, validated.value.nonce, access.operation);
}`,
    ],
    [
      'all stages after throw',
      `export async function executeMemoryWrite(deps, access, command) {
  throw new Error('stop');
${straightLine.replace('export async function executeMemoryWrite(deps, access, command) {', '')}`,
    ],
    [
      'memory write after throw',
      `${withoutTail}
  throw new Error('stop');
  await deps.memory.write({}, access);
  await deps.audit.record({}, access);
}`,
    ],
    [
      'both if branches return then stages',
      `export async function executeMemoryWrite(deps, access, command) {
  if (flag) return { ok: true };
  else return { ok: false };
${straightLine.replace('export async function executeMemoryWrite(deps, access, command) {', '')}`,
    ],
    [
      'if return/throw then write',
      `export async function executeMemoryWrite(deps, access, command) {
  if (flag) return { ok: true };
  else throw new Error('stop');
  await deps.memory.write({}, access);
}`,
    ],
    [
      'nested block return then stages',
      `export async function executeMemoryWrite(deps, access, command) {
  {
    return { ok: true };
    await deps.memory.write({}, access);
  }
  await deps.audit.record({}, access);
}`,
    ],
    [
      'nested block throw then stages',
      `export async function executeMemoryWrite(deps, access, command) {
  {
    throw new Error('stop');
    readTrustedTimestamp(deps.clock);
  }
}`,
    ],
    [
      'unreachable object initializer write',
      `export async function executeMemoryWrite(deps, access, command) {
  return { ok: true };
  const bag = { w: deps.memory.write({}, access) };
}`,
    ],
    [
      'unreachable array initializer write',
      `export async function executeMemoryWrite(deps, access, command) {
  return { ok: true };
  const bag = [deps.memory.write({}, access)];
}`,
    ],
    [
      'dead class stages after return',
      `export async function executeMemoryWrite(deps, access, command) {
  return { ok: true };
  class Dead { run() { ${nestedCanonicalStages} } }
}`,
    ],
  ])('REV7-001 rejects unreachable security stages: %s', (_label, source) => {
    const report = analyzeExecuteMemoryWrite(source, 'rev7-unreachable.ts');
    expect(report.ok).toBe(false);
    expect(
      report.failures.some(
        (failure) =>
          failure.includes('UNREACHABLE_SECURITY_STAGE') ||
          failure.includes('nested executable boundaries') ||
          failure.includes('MISSING_STAGE'),
      ),
    ).toBe(true);
  });

  it('REV7-001 keeps ordinary non-security unreachable statements from crediting stages', () => {
    const report = analyzeExecuteMemoryWrite(
      `export async function executeMemoryWrite(deps, access, command) {
  return { ok: true };
  const note = 'harmless';
  harmless(note);
}`,
      'rev7-harmless-unreachable.ts',
    );
    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.includes('MISSING_STAGE'))).toBe(true);
    expect(report.failures.some((failure) => failure.includes('UNREACHABLE_SECURITY_STAGE'))).toBe(
      false,
    );
  });

  it.each([
    [
      'naked lookup',
      straightLine.replace(
        `  if (policyResult.value.decision === 'approval-required') {
    if (command.approvalId === null) return err({ code: 'APPROVAL_REQUIRED' });
    const grant = await deps.approvals.lookup(command.approvalId, access.operation);
    if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });
    const validated = validateApproval(grant.value, demand, trustedNow);
    if (!validated.ok) return err({ code: 'APPROVAL_INVALID' });
    const consumed = await deps.approvals.consume(validated.value.approvalId, validated.value.nonce, access.operation);
    if (!consumed.ok) return err({ code: 'CONSUMPTION_FAILED' });
  }
`,
        `  const grant = await deps.approvals.lookup(command.approvalId, access.operation);
`,
      ),
    ],
    [
      'naked validate',
      straightLine.replace(
        `  if (policyResult.value.decision === 'approval-required') {
    if (command.approvalId === null) return err({ code: 'APPROVAL_REQUIRED' });
    const grant = await deps.approvals.lookup(command.approvalId, access.operation);
    if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });
    const validated = validateApproval(grant.value, demand, trustedNow);
    if (!validated.ok) return err({ code: 'APPROVAL_INVALID' });
    const consumed = await deps.approvals.consume(validated.value.approvalId, validated.value.nonce, access.operation);
    if (!consumed.ok) return err({ code: 'CONSUMPTION_FAILED' });
  }
`,
        `  const validated = validateApproval({}, demand, trustedNow);
`,
      ),
    ],
    [
      'naked consume',
      straightLine.replace(
        `  if (policyResult.value.decision === 'approval-required') {
    if (command.approvalId === null) return err({ code: 'APPROVAL_REQUIRED' });
    const grant = await deps.approvals.lookup(command.approvalId, access.operation);
    if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });
    const validated = validateApproval(grant.value, demand, trustedNow);
    if (!validated.ok) return err({ code: 'APPROVAL_INVALID' });
    const consumed = await deps.approvals.consume(validated.value.approvalId, validated.value.nonce, access.operation);
    if (!consumed.ok) return err({ code: 'CONSUMPTION_FAILED' });
  }
`,
        `  const consumed = await deps.approvals.consume('id', 'nonce', access.operation);
`,
      ),
    ],
    [
      'full naked approval sequence',
      straightLine.replace(
        `  if (policyResult.value.decision === 'approval-required') {
    if (command.approvalId === null) return err({ code: 'APPROVAL_REQUIRED' });
    const grant = await deps.approvals.lookup(command.approvalId, access.operation);
    if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });
    const validated = validateApproval(grant.value, demand, trustedNow);
    if (!validated.ok) return err({ code: 'APPROVAL_INVALID' });
    const consumed = await deps.approvals.consume(validated.value.approvalId, validated.value.nonce, access.operation);
    if (!consumed.ok) return err({ code: 'CONSUMPTION_FAILED' });
  }
`,
        `  const grant = await deps.approvals.lookup(command.approvalId, access.operation);
  const validated = validateApproval(grant.value, demand, trustedNow);
  const consumed = await deps.approvals.consume(validated.value.approvalId, validated.value.nonce, access.operation);
`,
      ),
    ],
    [
      'extra naked lookup beside canonical gate',
      straightLine.replace(
        '  await deps.memory.write({}, access);',
        `  const extra = await deps.approvals.lookup(command.approvalId, access.operation);
  await deps.memory.write({}, access);`,
      ),
    ],
    [
      'approval in object initializer',
      straightLine.replace(
        '  await deps.memory.write({}, access);',
        `  const bag = { g: deps.approvals.lookup(command.approvalId, access.operation) };
  await deps.memory.write({}, access);`,
      ),
    ],
    [
      'approval in array initializer',
      straightLine.replace(
        '  await deps.memory.write({}, access);',
        `  const bag = [deps.approvals.consume('id', 'nonce', access.operation)];
  await deps.memory.write({}, access);`,
      ),
    ],
    [
      'approval in ternary',
      straightLine.replace(
        '  await deps.memory.write({}, access);',
        `  const x = true ? deps.approvals.lookup(command.approvalId, access.operation) : null;
  await deps.memory.write({}, access);`,
      ),
    ],
    [
      'approval in logical expression',
      straightLine.replace(
        '  await deps.memory.write({}, access);',
        `  enabled && deps.approvals.lookup(command.approvalId, access.operation);
  await deps.memory.write({}, access);`,
      ),
    ],
    [
      'trusted clock in initializer',
      straightLine.replace(
        '  readTrustedTimestamp(deps.clock);',
        '  const bag = { now: readTrustedTimestamp(deps.clock) };',
      ),
    ],
    [
      'memory write in initializer',
      straightLine.replace(
        '  await deps.memory.write({}, access);',
        '  const bag = { w: deps.memory.write({}, access) };',
      ),
    ],
    [
      'reassigned approval result',
      straightLine.replace(
        "if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });",
        "grant = { ok: true };\n    if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });",
      ),
    ],
    ['optional ok access', straightLine.replace('if (!grant.ok)', 'if (!grant?.ok)')],
    ['computed ok access', straightLine.replace('if (!grant.ok)', "if (!grant['ok'])")],
  ])('REV7-002/003 rejects %s', (_label, source) => {
    const report = analyzeExecuteMemoryWrite(source, 'rev7-approval.ts');
    expect(report.ok).toBe(false);
    expect(
      report.failures.some(
        (failure) =>
          failure.includes('naked approval') ||
          failure.includes('expression containers') ||
          failure.includes('must be checked') ||
          failure.includes('AMBIGUOUS') ||
          failure.includes('MISSING_STAGE') ||
          failure.includes('UNREACHABLE_SECURITY_STAGE'),
      ),
    ).toBe(true);
  });

  it('REV7-002 accepts the canonical guarded approval sequence', () => {
    expect(analyzeExecuteMemoryWrite(straightLine, 'rev7-canonical.ts').ok).toBe(true);
  });

  const withUnsupportedPrefix = (prefix: string): string =>
    `export async function executeMemoryWrite(deps, access, command) {
  ${prefix}
${straightLine
  .replace('export async function executeMemoryWrite(deps, access, command) {', '')
  .replace(/^\n/, '')}`;

  const expectUnsupported = (source: string, fileName: string) => {
    const report = analyzeExecuteMemoryWrite(source, fileName);
    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.includes('UNSUPPORTED_CONTROL_FLOW'))).toBe(
      true,
    );
    return report;
  };

  it.each([
    ['label with return then stages', 'labelReturn: { return { ok: true }; }'],
    ['label with throw then stages', "labelThrow: { throw new Error('stop'); }"],
    ['harmless label block', 'labelHarmless: { const x = 1; }'],
    ['nested label', 'outer: { inner: { const x = 1; } }'],
    ['label around if', 'labelIf: if (true) { const x = 1; }'],
    ['label around class/object expression', 'labelObj: { const dead = { run() { return 1; } }; }'],
    ['labeled break', 'loopLabel: for (const _ of [1]) { break loopLabel; }'],
    ['labeled continue', 'loopLabel: for (const _ of [1]) { continue loopLabel; }'],
    ['label before canonical production flow', 'beforeFlow: { const ready = true; }'],
  ])('REV8-001 rejects labeled control flow: %s', (_label, prefix) => {
    expectUnsupported(withUnsupportedPrefix(prefix), 'rev8-label.ts');
  });

  it.each([
    ['do return while false', 'do { return { ok: true }; } while (false);'],
    ['do throw while false', "do { throw new Error('stop'); } while (false);"],
    ['while true return', 'while (true) { return { ok: true }; }'],
    ['while true empty', 'while (true) {}'],
    ['while false then stages', 'while (false) {}'],
    ['for ever throw', "for (;;) { throw new Error('stop'); }"],
    ['for ever empty', 'for (;;) {}'],
    ['finite for then stages', 'for (let i = 0; i < 1; i++) {}'],
    ['for-in', 'for (const key in { a: 1 }) {}'],
    ['for-of', 'for (const item of [1]) {}'],
    ['loop without security stages', 'while (false) { const idle = true; }'],
    ['security stages inside loop', 'while (true) { await deps.memory.write({}, access); }'],
    [
      'approval sequence inside loop',
      `while (true) {
    const grant = await deps.approvals.lookup(command.approvalId, access.operation);
    const validated = validateApproval(grant.value, demand, trustedNow);
    await deps.approvals.consume(validated.value.approvalId, validated.value.nonce, access.operation);
  }`,
    ],
    ['trusted clock inside loop', 'while (true) { readTrustedTimestamp(deps.clock); }'],
    ['memory write inside loop', 'for (;;) { await deps.memory.write({}, access); }'],
    ['nested loop', 'while (true) { for (;;) { break; } }'],
    ['loop inside if', 'if (true) { while (false) {} }'],
    ['loop after return', 'return { ok: true };\n  while (false) {}'],
    ['loop after throw', "throw new Error('stop');\n  for (;;) {}"],
    ['loop beside valid canonical sequence', 'for (let i = 0; i < 1; i++) { const n = i; }'],
  ])('REV8-001 rejects loop family: %s', (_label, prefix) => {
    expectUnsupported(withUnsupportedPrefix(prefix), 'rev8-loop.ts');
  });

  it.each([
    ['switch without stages', 'switch (1) { case 1: break; default: break; }'],
    [
      'switch with stages in one case',
      'switch (1) { case 1: await deps.memory.write({}, access); break; }',
    ],
    [
      'switch return in all cases then stages',
      'switch (1) { case 1: return { ok: true }; default: return { ok: true }; }',
    ],
    ['switch without default', 'switch (value) { case 1: break; }'],
    ['try/catch without stages', 'try { const x = 1; } catch (error) { const y = 2; }'],
    ['try with stages', 'try { await deps.memory.write({}, access); } catch (error) {}'],
    [
      'catch with stages',
      'try { const x = 1; } catch (error) { await deps.memory.write({}, access); }',
    ],
    [
      'finally with stages',
      'try { const x = 1; } finally { await deps.memory.write({}, access); }',
    ],
    [
      'return in try then stages after',
      'try { return { ok: true }; } catch (error) {}\n  await deps.audit.record({}, access);',
    ],
    [
      'throw in catch then stages after',
      'try { const x = 1; } catch (error) { throw error; }\n  await deps.audit.record({}, access);',
    ],
    ['nested try', 'try { try { const x = 1; } catch (inner) {} } catch (outer) {}'],
    [
      'try inside approval gate',
      straightLine.replace(
        "if (command.approvalId === null) return err({ code: 'APPROVAL_REQUIRED' });",
        `if (command.approvalId === null) return err({ code: 'APPROVAL_REQUIRED' });
    try { const ready = true; } catch (error) {}`,
      ),
    ],
    ['bare break', 'while (true) { break; }'],
    ['bare continue', 'while (true) { continue; }'],
  ])('REV8-001 rejects switch/try/break: %s', (_label, sourceOrPrefix) => {
    const source = sourceOrPrefix.includes('export async function executeMemoryWrite')
      ? sourceOrPrefix
      : withUnsupportedPrefix(sourceOrPrefix);
    expectUnsupported(source, 'rev8-switch-try.ts');
  });

  it.each([
    ['canonical condition', "if (policyResult.value.decision === 'approval-required')", true],
    ['reversed operands', "if ('approval-required' === policyResult.value.decision)", true],
    ['wrong property chain', "if (policyResult.decision === 'approval-required')", false],
    ['wrong identifier', "if (otherResult.value.decision === 'approval-required')", false],
    ['wrong literal', "if (policyResult.value.decision === 'approval-needed')", false],
    ['template literal', 'if (policyResult.value.decision === `approval-required`)', false],
    [
      'concatenated string',
      "if (policyResult.value.decision === ('approval-' + 'required'))",
      false,
    ],
    ['computed property', "if (policyResult.value['decision'] === 'approval-required')", false],
    ['optional property', "if (policyResult.value?.decision === 'approval-required')", false],
    [
      'fake text in comment',
      "if (unrelatedFlag /* approval-required */) // policyResult.value.decision === 'approval-required'",
      false,
    ],
    [
      'fake text in string',
      "if (flag === 'policyResult.value.decision === \\'approval-required\\'')",
      false,
    ],
    ['condition through alias', "if (alias === 'approval-required')", false],
    ['loose equality', "if (policyResult.value.decision == 'approval-required')", false],
  ])('REV8-002 approval condition is AST-only: %s', (_label, condition, shouldPass) => {
    let source = straightLine.replace(
      "if (policyResult.value.decision === 'approval-required')",
      condition,
    );
    if (_label === 'condition through alias') {
      source = straightLine.replace(
        "if (policyResult.value.decision === 'approval-required') {",
        `const alias = policyResult.value.decision;
  if (alias === 'approval-required') {`,
      );
    }
    const report = analyzeExecuteMemoryWrite(source, 'rev8-condition.ts');
    expect(report.ok).toBe(shouldPass);
    if (!shouldPass) {
      expect(
        report.failures.some(
          (failure) =>
            failure.includes('AMBIGUOUS_CONTROL_FLOW') ||
            failure.includes('UNSUPPORTED_CONTROL_FLOW') ||
            failure.includes('MISSING_STAGE'),
        ),
      ).toBe(true);
    }
  });

  it('REV8-002 rejects approval condition inside unsupported loop', () => {
    expectUnsupported(
      withUnsupportedPrefix(
        `while (true) {
    if (policyResult.value.decision === 'approval-required') {
      const grant = await deps.approvals.lookup(command.approvalId, access.operation);
      if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });
      const validated = validateApproval(grant.value, demand, trustedNow);
      if (!validated.ok) return err({ code: 'APPROVAL_INVALID' });
      const consumed = await deps.approvals.consume(validated.value.approvalId, validated.value.nonce, access.operation);
      if (!consumed.ok) return err({ code: 'CONSUMPTION_FAILED' });
    }
  }`,
      ),
      'rev8-condition-in-loop.ts',
    );
  });

  it('REV8 keeps production and canonical fixtures passing', () => {
    const production = readFileSync('src/core/application/memory-write.service.ts', 'utf8');
    expect(analyzeExecuteMemoryWrite(production, 'memory-write.service.ts').ok).toBe(true);
    expect(analyzeExecuteMemoryWrite(straightLine, 'rev8-canonical.ts').ok).toBe(true);
  });

  const expectGeneratorTargetUnsupported = (source: string, fileName: string) => {
    const report = analyzeExecuteMemoryWrite(source, fileName);
    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.includes('UNSUPPORTED_CONTROL_FLOW'))).toBe(
      true,
    );
    return report;
  };

  const expectFailClosed = (source: string, fileName: string) => {
    const report = analyzeExecuteMemoryWrite(source, fileName);
    expect(report.ok).toBe(false);
    return report;
  };

  const canonicalBodyOnly = straightLine
    .replace('export async function executeMemoryWrite(deps, access, command) {', '')
    .replace(/^\n/, '');

  it.each([
    [
      'sync generator target without yield',
      `export function* executeMemoryWrite(deps, access, command) {
  return { ok: true };
}`,
    ],
    [
      'async generator target without yield',
      `export async function* executeMemoryWrite(deps, access, command) {
  return { ok: true };
}`,
    ],
    [
      'sync generator target with canonical stages',
      `export function* executeMemoryWrite(deps, access, command) {
${canonicalBodyOnly.replaceAll('await ', '')}`,
    ],
    [
      'async generator target with canonical stages',
      `export async function* executeMemoryWrite(deps, access, command) {
${canonicalBodyOnly}`,
    ],
    [
      'generator target with yield',
      `export async function* executeMemoryWrite(deps, access, command) {
  yield 1;
  return { ok: true };
}`,
    ],
    [
      'generator function expression target',
      `export const executeMemoryWrite = function* (deps, access, command) {
  return { ok: true };
};`,
    ],
    [
      'async generator function expression target',
      `export const executeMemoryWrite = async function* (deps, access, command) {
  return { ok: true };
};`,
    ],
    [
      'nested generator in ordinary target',
      `export async function executeMemoryWrite(deps, access, command) {
  const nested = function* () { yield 1; };
  return { ok: true };
}`,
    ],
    [
      'nested async generator in ordinary target',
      `export async function executeMemoryWrite(deps, access, command) {
  const nested = async function* () { yield 1; };
  return { ok: true };
}`,
    ],
  ])('REV9-001 rejects %s with UNSUPPORTED_CONTROL_FLOW', (_label, source) => {
    expectGeneratorTargetUnsupported(source, 'rev9-generator.ts');
  });

  it.each([
    [
      'object generator method',
      `const bag = {
  *executeMemoryWrite(deps, access, command) {
    return { ok: true };
  }
};`,
    ],
    [
      'class generator method',
      `class Memory {
  *executeMemoryWrite(deps, access, command) {
    return { ok: true };
  }
}`,
    ],
    [
      'class async generator method',
      `class Memory {
  async *executeMemoryWrite(deps, access, command) {
    return { ok: true };
  }
}`,
    ],
    [
      'static generator method',
      `class Memory {
  static *executeMemoryWrite(deps, access, command) {
    return { ok: true };
  }
}`,
    ],
  ])('REV9-001 fails closed for non-target %s', (_label, source) => {
    const report = expectFailClosed(source, 'rev9-method.ts');
    expect(
      report.failures.some(
        (failure) =>
          failure.includes('MISSING_TARGET') ||
          failure.includes('UNSUPPORTED_CONTROL_FLOW') ||
          failure.includes('AMBIGUOUS'),
      ),
    ).toBe(true);
  });

  it('REV9-001 accepts ordinary async and production targets', () => {
    expect(analyzeExecuteMemoryWrite(straightLine, 'rev9-async-canonical.ts').ok).toBe(true);
    const production = readFileSync('src/core/application/memory-write.service.ts', 'utf8');
    expect(analyzeExecuteMemoryWrite(production, 'memory-write.service.ts').ok).toBe(true);
  });

  it('REV9-001 accepts ordinary sync target when stages are direct', () => {
    const syncCanonical = straightLine
      .replace('export async function executeMemoryWrite', 'export function executeMemoryWrite')
      .replaceAll('await ', '');
    expect(analyzeExecuteMemoryWrite(syncCanonical, 'rev9-sync-canonical.ts').ok).toBe(true);
  });
});
