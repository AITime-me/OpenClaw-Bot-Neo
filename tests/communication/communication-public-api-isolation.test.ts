import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as publicApi from '../../src/index.js';
import * as domainBarrel from '../../src/core/domain/index.js';
import * as portsBarrel from '../../src/core/ports/index.js';
import * as policyBarrel from '../../src/core/policy/index.js';
import * as applicationBarrel from '../../src/core/application/index.js';

const forbiddenCommunicationExports = [
  'parseTransportTextObservation',
  'assembleTextPrompt',
  'authorizeCommunicationMemoryRead',
  'evaluateCommunicationKillSwitchSnapshot',
  'issueAuthenticatedCommunicationPrincipal',
  'sealFreshObservedAdmissionEvidence',
  'sealValidatedTextOutput',
  'isAuthenticatedCommunicationPrincipal',
  'isValidatedTextOutput',
  'deriveCommunicationIdempotencyKey',
  'LEGAL_TRANSITIONS',
  'COMMUNICATION_TURN_STATES',
  'getAuthenticatedCommunicationPrincipalCanonical',
  'principalRegistry',
  'validatedTextOutputRegistry',
] as const;

const assertNoCommunicationLeak = (exported: readonly string[], label: string): void => {
  for (const name of forbiddenCommunicationExports) {
    expect(exported, `${label} must not export ${name}`).not.toContain(name);
  }
  expect(
    exported.some((name) => /communication/i.test(name)),
    `${label} must not export communication-named symbols`,
  ).toBe(false);
  expect(exported.some((name) => /TextPrompt/i.test(name))).toBe(false);
  expect(exported.some((name) => /CommunicationPrincipal/i.test(name))).toBe(false);
  expect(exported.some((name) => /ValidatedTextOutput/i.test(name))).toBe(false);
};

describe('communication public API isolation', () => {
  it('keeps package.json exports limited to the root "." entry', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>;
    };
    const exportKeys = Object.keys(pkg.exports ?? {});
    expect(exportKeys).toEqual(['.']);
  });

  it('does not create a package-private communication root barrel', () => {
    expect(existsSync(join(process.cwd(), 'src/core/communication/index.ts'))).toBe(false);
  });

  it('does not export communication domain, policy, or port symbols from the package root', () => {
    assertNoCommunicationLeak(Object.keys(publicApi), 'package root');
  });

  it('does not leak communication through root-reachable core barrels', () => {
    assertNoCommunicationLeak(Object.keys(domainBarrel), 'core/domain barrel');
    assertNoCommunicationLeak(Object.keys(portsBarrel), 'core/ports barrel');
    assertNoCommunicationLeak(Object.keys(policyBarrel), 'core/policy barrel');
    assertNoCommunicationLeak(Object.keys(applicationBarrel), 'core/application barrel');
  });

  it('keeps issuer, sealer, and internal registries unavailable on the package root', () => {
    const root = publicApi as Record<string, unknown>;
    expect(root.issueAuthenticatedCommunicationPrincipal).toBeUndefined();
    expect(root.sealFreshObservedAdmissionEvidence).toBeUndefined();
    expect(root.sealValidatedTextOutput).toBeUndefined();
    expect(root.getAuthenticatedCommunicationPrincipalCanonical).toBeUndefined();
    expect(root.principalRegistry).toBeUndefined();
    expect(root.validatedTextOutputRegistry).toBeUndefined();
  });
});
