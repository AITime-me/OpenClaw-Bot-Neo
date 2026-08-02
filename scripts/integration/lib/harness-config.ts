import {
  parseISO8601,
  parseMemoryRecordId,
  parseOwnerId,
  type ISO8601,
  type MemoryNamespace,
  type MemoryRecordId,
  type MemoryRetentionPolicy,
  type MemoryRole,
  type MemorySource,
  type OwnerId,
} from '../../../src/core/domain/index.ts';
import type { AuthenticatedMemoryAccessContext } from '../../../src/core/domain/memory-access.internal.ts';
import { sealAuthenticatedMemoryAccess } from '../../../src/core/domain/memory-access.internal.ts';
import type { CreatePosixDurableLocalHostInput } from '../../../src/host/durable/create-posix-durable-local-host.ts';
import { createExplicitAllowMemoryPolicy } from '../../../src/host/in-memory/memory-policy.ts';
import { HARNESS_CONTENT } from './harness-content.ts';

/** Inline structural type matching LocalHost.writeMemory command fields. */
export type HarnessMemoryWriteCommand = {
  readonly recordId: string;
  readonly targetNamespace: MemoryNamespace;
  readonly rawContent: string;
  readonly rawMetadata: Readonly<Record<string, unknown>>;
  readonly source: MemorySource;
  readonly retentionPolicy: MemoryRetentionPolicy;
  readonly approvalId: null;
};

export type HarnessMemoryReadRequest = {
  readonly recordId: MemoryRecordId;
  readonly expectedOwnerId: OwnerId;
  readonly expectedNamespace: MemoryNamespace;
};

export { HARNESS_CONTENT, harnessContentSha256 } from './harness-content.ts';
const HARNESS_CLOCK_ISO = '2026-01-15T12:00:00.000Z';
const HARNESS_ISSUED_AT = '2026-01-15T11:59:00.000Z';
const HARNESS_EXPIRES_AT = '2026-01-15T12:30:00.000Z';

const modelRouting = () =>
  Object.freeze({
    status: 'draft',
    schemaVersion: '1.0',
    modelIdentifiersConfirmed: false,
    defaultProviderMode: 'subscription-oauth-only',
    apiFallbackEnabled: false,
    paidFallbackEnabled: false,
    routes: Object.freeze([
      Object.freeze({
        risk: 'low',
        capabilityTier: 'validated-general-tier',
        toolProfile: 'read-only-low-risk',
        approval: 'policy-dependent',
        onUnavailable: 'fail-closed',
      }),
      Object.freeze({
        risk: 'medium',
        capabilityTier: 'validated-general-tier',
        toolProfile: 'read-only-restricted-tools',
        approval: 'required-for-external-or-write',
        onUnavailable: 'fail-closed',
      }),
      Object.freeze({
        risk: 'high',
        capabilityTier: 'validated-high-assurance-tier',
        toolProfile: 'high-risk-no-elevated-tools',
        approval: 'owner-required',
        fallbackToWeakerTier: false,
        onUnavailable: 'fail-closed',
      }),
      Object.freeze({
        risk: 'untrusted-input',
        capabilityTier: 'validated-untrusted-content-tier',
        toolProfile: 'untrusted-no-exec-no-network-no-elevated-tools',
        approval: 'owner-required-for-any-tool-expansion',
        onUnavailable: 'fail-closed',
      }),
    ]),
    onUnavailable: 'fail-closed',
  });

const memoryNamespaces = () =>
  Object.freeze({
    status: 'draft',
    schemaVersion: '1.0',
    defaultAccess: 'deny',
    namespaces: Object.freeze([
      'tvoe-vremya',
      'ai-my-time',
      'personal',
      'shared-public',
      'security-restricted',
    ]),
    activeNamespaceRequired: true,
    crossNamespaceAccess: false,
    crossProjectAccessRequiresOwnerApproval: true,
    securityRestrictedIsolated: true,
    personalIsolatedFromProjects: true,
    requiredMetadata: Object.freeze([
      'source',
      'observedAt',
      'confidence',
      'classification',
      'retentionClass',
    ]),
    embedding: Object.freeze({ mode: 'none', externalProviderEnabled: false }),
  });

const memoryClassification = () =>
  Object.freeze({
    status: 'draft',
    schemaVersion: '1.0',
    defaultClassification: 'security-restricted',
    classes: Object.freeze({
      public: Object.freeze({ externalProcessingAllowed: 'policy-dependent' }),
      internal: Object.freeze({ externalProcessingAllowed: false }),
      confidential: Object.freeze({ externalProcessingAllowed: false }),
      'commercial-secret': Object.freeze({
        storeAllowed: false,
        externalProcessingAllowed: false,
      }),
      'security-restricted': Object.freeze({
        storeAllowed: false,
        externalProcessingAllowed: false,
      }),
    }),
    sensitiveDataScan: Object.freeze({ required: true, failureEffect: 'deny' }),
  });

const securityPolicy = () =>
  Object.freeze({
    status: 'draft',
    schemaVersion: '1.0',
    defaultEffect: 'deny',
    readOnlyFirst: true,
    paymentActionsAllowed: false,
    externalWritesAllowed: false,
    ownerApproval: Object.freeze({
      required: true,
      bindToTargetAndPayload: true,
      expires: true,
      replayAllowed: false,
    }),
    sensitiveDataScanner: Object.freeze({
      requiredBeforeAllSinks: true,
      deterministic: true,
      failureEffect: 'deny',
    }),
    reverseTrustAllowed: false,
  });

const requireParsed = <T>(
  parsed: { readonly ok: true; readonly value: T } | { readonly ok: false },
): T => {
  if (!parsed.ok) throw new Error('Harness identity parse failed.');
  return parsed.value;
};

const asOwner = (value: string): OwnerId => requireParsed(parseOwnerId(value));
const asRecordId = (value: string): MemoryRecordId => requireParsed(parseMemoryRecordId(value));
const asIso = (value: string): ISO8601 => requireParsed(parseISO8601(value));

export const fixedHarnessClock = (): { now: () => Date } => ({
  now: () => new Date(HARNESS_CLOCK_ISO),
});

export const buildHarnessCompositionInput = (
  storageRoot: string,
  repositoryRoot: string,
  expectedUid: number,
): CreatePosixDurableLocalHostInput => ({
  config: {
    modelRouting: modelRouting(),
    memoryNamespaces: memoryNamespaces(),
    memoryClassification: memoryClassification(),
    securityPolicy: securityPolicy(),
  },
  host: {
    clock: fixedHarnessClock(),
    policy: createExplicitAllowMemoryPolicy(),
  },
  storageBinding: {
    platform: 'posix',
    storageRoot,
  },
  storagePolicy: {
    expectedUid,
    allowedModeBits: 0o700,
    repositoryRoot,
  },
});

const harnessOperationContext = () => ({
  signal: new AbortController().signal,
  timeoutMs: 5_000,
  deadline: asIso('2026-01-15T12:00:30.000Z'),
});

const harnessRetentionPolicy = (): MemoryRetentionPolicy => ({
  expiresAt: asIso('2027-01-01T00:00:00.000Z'),
  reviewAt: asIso('2026-10-01T00:00:00.000Z'),
  deleteOnExpiry: true,
});

const harnessOwnerSource = (): MemorySource => ({
  kind: 'owner',
  reference: 'harness-owner-note',
  observedAt: asIso(HARNESS_CLOCK_ISO),
});

export const buildHarnessMemoryAccess = (
  ownerId = 'harness-owner',
  activeNamespace: 'personal' | 'ai-my-time' = 'personal',
): AuthenticatedMemoryAccessContext => {
  const operation = harnessOperationContext();
  const sealed = sealAuthenticatedMemoryAccess(
    {
      ownerId,
      actorId: 'harness-actor',
      roles: ['personal-assistant' satisfies MemoryRole],
      activeNamespace,
      projectScope: {
        primary: activeNamespace,
        permitted: [activeNamespace],
        crossProjectPermitted: false,
      },
      channelId: 'harness-channel',
      sessionId: 'harness-session',
      issuedAt: HARNESS_ISSUED_AT,
      expiresAt: HARNESS_EXPIRES_AT,
      correlationId: 'harness-correlation',
    },
    operation,
    fixedHarnessClock().now(),
  );
  if (sealed === null) throw new Error('Failed to seal harness authenticated access.');
  return sealed;
};

export const buildHarnessWriteCommand = (recordId: string): HarnessMemoryWriteCommand => ({
  recordId,
  targetNamespace: 'personal',
  rawContent: HARNESS_CONTENT,
  rawMetadata: { origin: 'harness-integration', version: 'v1' },
  source: harnessOwnerSource(),
  retentionPolicy: harnessRetentionPolicy(),
  approvalId: null,
});

export const buildHarnessReadRequest = (
  recordId: string,
  ownerId = 'harness-owner',
  namespace: 'personal' | 'ai-my-time' = 'personal',
): HarnessMemoryReadRequest => ({
  recordId: asRecordId(recordId),
  expectedOwnerId: asOwner(ownerId),
  expectedNamespace: namespace,
});
