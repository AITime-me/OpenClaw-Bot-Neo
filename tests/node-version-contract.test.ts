import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluateSupportedNodeVersion,
  formatUnsupportedNodeReason,
  parseNodeVersion,
  PRODUCTION_NODE_RANGE,
} from '../scripts/lib/node-version-contract.mjs';
import { evaluateNodeSupport } from '../scripts/check-node.mjs';
import {
  evaluateNodeSupport as evaluateTsNodeSupport,
  parseNodeVersion as parseTsNodeVersion,
  PRODUCTION_NODE_RANGE as TS_PRODUCTION_NODE_RANGE,
} from '../src/core/runtime/node-support.js';
import { NEO_RUNTIME_EXIT_UNSUPPORTED_RUNTIME } from '../src/neo-runtime/neo-runtime-exit-codes.js';
import { NEO_RUNTIME_EXIT_UNSUPPORTED_RUNTIME as LAUNCHER_UNSUPPORTED_RUNTIME } from '../scripts/lib/neo-launcher-exit-codes.mjs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  engines: { node: string };
};

const MATRIX_ALLOW = ['22.13.0', '22.13.1', '22.14.0', '22.99.99'];
const MATRIX_DENY = ['22.12.0', '22.12.99', '21.0.0', '23.0.0', '24.0.0', '', 'nope', 'v22.13.0'];

describe('node-version-contract canonical parser', () => {
  it('documents the production range label', () => {
    expect(PRODUCTION_NODE_RANGE).toBe('>=22.13.0 <23');
    expect(packageJson.engines.node).toBe(PRODUCTION_NODE_RANGE);
    expect(TS_PRODUCTION_NODE_RANGE.label).toBe(PRODUCTION_NODE_RANGE);
  });

  it('accepts supported Node 22 releases', () => {
    for (const version of MATRIX_ALLOW) {
      expect(evaluateSupportedNodeVersion(version).ok).toBe(true);
    }
  });

  it('rejects unsupported majors and floors', () => {
    for (const version of MATRIX_DENY) {
      expect(evaluateSupportedNodeVersion(version).ok).toBe(false);
    }
  });

  it('handles whitespace according to contract', () => {
    expect(evaluateSupportedNodeVersion('  22.13.0  ').ok).toBe(true);
    expect(parseNodeVersion('  22.13.0  ')?.major).toBe(22);
  });

  it('handles prerelease and build suffixes', () => {
    expect(evaluateSupportedNodeVersion('22.13.0-nightly').ok).toBe(true);
    expect(evaluateSupportedNodeVersion('22.12.0-rc.1').ok).toBe(false);
    expect(evaluateSupportedNodeVersion('22.14.0+build').ok).toBe(true);
  });

  it('rejects v-prefixed versions', () => {
    expect(parseNodeVersion('v22.13.0')).toBeNull();
    expect(evaluateSupportedNodeVersion('v22.13.0').ok).toBe(false);
  });

  it('formats bounded unsupported reasons', () => {
    const decision = evaluateSupportedNodeVersion('23.0.0');
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      const message = formatUnsupportedNodeReason('23.0.0', decision);
      expect(message).toContain(PRODUCTION_NODE_RANGE);
      expect(message.length).toBeLessThan(256);
    }
  });

  it('does not require npm or environment flags', () => {
    expect(evaluateSupportedNodeVersion('22.13.0').ok).toBe(true);
  });
});

describe('node-version-contract CI/runtime parity', () => {
  it('check-node and canonical helper agree on the matrix', () => {
    for (const version of [...MATRIX_ALLOW, ...MATRIX_DENY]) {
      const canonical = evaluateSupportedNodeVersion(version);
      const checkNode = evaluateNodeSupport(version);
      expect(checkNode.ok).toBe(canonical.ok);
    }
  });

  it('TypeScript node-support agrees with canonical helper on the matrix', () => {
    for (const version of [...MATRIX_ALLOW, ...MATRIX_DENY]) {
      const canonical = evaluateSupportedNodeVersion(version);
      const ts = evaluateTsNodeSupport(version);
      expect(ts.ok).toBe(canonical.ok);
      expect(parseTsNodeVersion(version)).toEqual(parseNodeVersion(version));
    }
  });

  it('launcher exit code agrees with runtime exit table', () => {
    expect(LAUNCHER_UNSUPPORTED_RUNTIME).toBe(NEO_RUNTIME_EXIT_UNSUPPORTED_RUNTIME);
    expect(NEO_RUNTIME_EXIT_UNSUPPORTED_RUNTIME).toBe(3);
  });
});
