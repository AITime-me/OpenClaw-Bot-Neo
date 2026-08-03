import { describe, expect, it } from 'vitest';
import { executeMemoryWrite } from '../src/core/application/memory-write.service.js';
import { ok } from '../src/core/domain/index.js';
import {
  isSecretData,
  isSecretReference,
  readSecretMaterialForTrustedConsumer,
  sealSecretData,
  sealSecretReference,
} from '../src/core/domain/secret.internal.js';
import {
  sealSanitizedMetadata,
  sealSanitizedText,
  sealVerifiedMemoryWrite,
  issueSecretBoundaryClearance,
  verifiedMemoryWriteHasClearance,
} from '../src/core/domain/sanitized.internal.js';
import type { SecretsPort } from '../src/core/ports/secrets.port.js';
import { createInMemoryMemoryStore, createLocalHost } from '../src/host/index.js';
import { createExplicitAllowMemoryPolicy } from '../src/host/in-memory/memory-policy.js';
import * as publicApi from '../src/index.js';
import {
  asRecordId,
  authenticatedAccess,
  createHarness,
  fixedClock,
  writeCommand,
} from './support/fixtures.js';

/** Synthetic credential-shaped value unknown to current scanner literal/assignment detectors. */
const SYNTHETIC_UNKNOWN_SECRET = 'syn-cred-v0:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';

describe('R6-H02 secret boundary', () => {
  it('rejects scanner-unknown but secret-provenance content before product policy', async () => {
    const harness = createHarness({ policyDecision: { decision: 'allow' } });
    const result = await executeMemoryWrite(
      harness.deps,
      authenticatedAccess(),
      writeCommand({
        rawContent: SYNTHETIC_UNKNOWN_SECRET,
        contentSensitivity: 'secret-class',
      }),
    );
    expect(result).toEqual({ ok: false, error: { code: 'SECRET_CLASS_DENIED' } });
    expect(harness.calls).toEqual([]);
    expect(harness.calls).not.toContain('policy.evaluate');
    expect(harness.writes).toHaveLength(0);
    expect(harness.auditEvents).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_UNKNOWN_SECRET);
  });

  it('keeps scanner-recognized credential denial before product policy', async () => {
    const harness = createHarness({ policyDecision: { decision: 'allow' } });
    const result = await executeMemoryWrite(
      harness.deps,
      authenticatedAccess(),
      writeCommand({ rawContent: 'api_key=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SCAN_DENIED');
    expect(harness.calls).not.toContain('policy.evaluate');
    expect(harness.writes).toHaveLength(0);
  });

  it('allows ordinary personal text through permissive product policy', async () => {
    const harness = createHarness({ policyDecision: { decision: 'allow' } });
    const result = await executeMemoryWrite(harness.deps, authenticatedAccess(), writeCommand());
    expect(result.ok).toBe(true);
    expect(harness.calls).toContain('policy.evaluate');
    expect(harness.writes).toHaveLength(1);
    expect(harness.writes[0]).toBeDefined();
    expect(verifiedMemoryWriteHasClearance(harness.writes[0])).toBe(true);
  });

  it('rejects nested SecretData in metadata without leaking material', async () => {
    const secret = sealSecretData('nested-synthetic-material');
    const harness = createHarness({ policyDecision: { decision: 'allow' } });
    const result = await executeMemoryWrite(
      harness.deps,
      authenticatedAccess(),
      writeCommand({ rawMetadata: { nested: { token: secret } } }),
    );
    expect(result).toEqual({ ok: false, error: { code: 'SECRET_CLASS_DENIED' } });
    expect(JSON.stringify(result)).not.toContain('nested-synthetic-material');
    expect(harness.writes).toHaveLength(0);
  });

  it('rejects forged verified writes without mandatory clearance in in-memory sink', async () => {
    const memory = createInMemoryMemoryStore();
    const access = authenticatedAccess();
    const content = sealSanitizedText('note', 'allow');
    const metadata = sealSanitizedMetadata({ origin: 'test' }, 'allow');
    const forgedClearance = { kind: 'secret-boundary-clearance' };
    const withoutClearance = sealVerifiedMemoryWrite(
      {
        recordId: asRecordId(),
        ownerId: access.ownerId,
        namespace: 'personal',
        content,
        metadata,
        source: {
          kind: 'owner',
          reference: 'note',
          observedAt: '2026-07-01T12:00:00.000Z' as never,
        },
        provenance: {
          capturedAt: '2026-07-01T12:00:00.000Z' as never,
          initiatedBy: access.ownerId,
          transformation: 'owner-stated',
          ownerApproved: false,
          crossProjectAccess: false,
        },
        privacyClassification: 'confidential',
        trustLevel: 'owner-stated',
        retentionPolicy: {
          expiresAt: '2027-01-01T00:00:00.000Z' as never,
          reviewAt: '2026-10-01T00:00:00.000Z' as never,
          deleteOnExpiry: true,
        },
        approvalId: null,
        createdAt: '2026-07-01T12:00:00.000Z' as never,
        updatedAt: '2026-07-01T12:00:00.000Z' as never,
      },
      forgedClearance as never,
    );
    expect(withoutClearance).toBeNull();

    const cleared = sealVerifiedMemoryWrite(
      {
        recordId: asRecordId('record-cleared'),
        ownerId: access.ownerId,
        namespace: 'personal',
        content,
        metadata,
        source: {
          kind: 'owner',
          reference: 'note',
          observedAt: '2026-07-01T12:00:00.000Z' as never,
        },
        provenance: {
          capturedAt: '2026-07-01T12:00:00.000Z' as never,
          initiatedBy: access.ownerId,
          transformation: 'owner-stated',
          ownerApproved: false,
          crossProjectAccess: false,
        },
        privacyClassification: 'confidential',
        trustLevel: 'owner-stated',
        retentionPolicy: {
          expiresAt: '2027-01-01T00:00:00.000Z' as never,
          reviewAt: '2026-10-01T00:00:00.000Z' as never,
          deleteOnExpiry: true,
        },
        approvalId: null,
        createdAt: '2026-07-01T12:00:00.000Z' as never,
        updatedAt: '2026-07-01T12:00:00.000Z' as never,
      },
      issueSecretBoundaryClearance(),
    );
    expect(cleared).not.toBeNull();
    if (cleared === null) return;
    const structural = { ...cleared };
    const written = await memory.write(structural, access);
    expect(written.ok).toBe(false);
    if (written.ok) return;
    expect(written.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('opaque secret primitives', () => {
  it('seals SecretData without useful string conversion', () => {
    const secret = sealSecretData('synthetic-material-value');
    expect(isSecretData(secret)).toBe(true);
    const toString = Object.getOwnPropertyDescriptor(secret, 'toString')?.value as
      (() => string) | undefined;
    expect(toString?.call(secret)).toBe('[opaque-secret]');
    expect(isSecretData({ kind: 'secret-data' })).toBe(false);
    expect(readSecretMaterialForTrustedConsumer(secret)).toBe('synthetic-material-value');
  });

  it('seals SecretReference without material', () => {
    const reference = sealSecretReference('ref-001', 'synthetic-provider');
    expect(isSecretReference(reference)).toBe(true);
    const toString = Object.getOwnPropertyDescriptor(reference, 'toString')?.value as
      (() => string) | undefined;
    expect(toString?.call(reference)).toBe('[opaque-secret]');
    expect(reference.referenceId).toBe('ref-001');
  });

  it('types SecretsPort resolve as opaque SecretData', async () => {
    const port: SecretsPort = {
      resolve: () => Promise.resolve(ok(sealSecretData('lease-material'))),
    };
    const resolved = await port.resolve('ref', {
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      deadline: '2026-07-01T12:00:30.000Z' as never,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(isSecretData(resolved.value)).toBe(true);
    expect(typeof (resolved.value as unknown as string)).not.toBe('string');
  });

  it('keeps secret seal helpers off the package root', () => {
    const names = Object.keys(publicApi);
    for (const forbidden of [
      'sealSecretData',
      'issueSecretBoundaryClearance',
      'readSecretMaterialForTrustedConsumer',
      'evaluateMemorySecretBoundary',
    ])
      expect(names).not.toContain(forbidden);
  });
});

describe('Neo deny-by-default compatibility', () => {
  it('keeps default local host memory policy deny-by-default', async () => {
    const host = createLocalHost({ clock: fixedClock() });
    const result = await host.writeMemory(authenticatedAccess(), writeCommand());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('POLICY_DENIED');
  });

  it('does not change explicit allow-policy behavior for ordinary non-secret text', async () => {
    const host = createLocalHost({
      clock: fixedClock(),
      policy: createExplicitAllowMemoryPolicy(),
    });
    const result = await host.writeMemory(authenticatedAccess(), writeCommand());
    expect(result.ok).toBe(true);
  });
});
