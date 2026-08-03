import { err, ok } from '../../src/core/domain/index.js';
import {
  parseActorId,
  parseApprovalId,
  parseApprovalNonce,
  parseCorrelationId,
  parseISO8601,
  parseMemoryRecordId,
  parseOwnerId,
  parsePayloadDigest,
  parseResourceRef,
  type ActorId,
  type ApprovalGrant,
  type ApprovalId,
  type ApprovalNonce,
  type CorrelationId,
  type DomainError,
  type ISO8601,
  type MemoryAccessContext,
  type MemoryNamespace,
  type MemoryRecordId,
  type MemoryRetentionPolicy,
  type MemoryRole,
  type MemorySource,
  type MemoryWriteDecision,
  type MetadataScanReport,
  type OperationContext,
  type OwnerId,
  type PayloadDigest,
  type ProjectScope,
  type ResourceRef,
  type Result,
  type SafeMemoryAuditEvent,
  type ScanReport,
  type VerifiedMemoryWrite,
} from '../../src/core/domain/index.js';
import {
  scanSensitiveData,
  scanSensitiveMetadata,
} from '../../src/core/policy/sensitive-data-scanner.js';
import type { MemoryWriteCommand, MemoryWriteDeps } from '../../src/core/application/index.js';
import {
  deriveMemoryWriteApprovalDemand,
  memoryWriteTarget,
} from '../../src/core/application/memory-write.service.js';
import {
  sealAuthenticatedMemoryAccess,
  type AuthenticatedMemoryAccessContext,
} from '../../src/core/domain/memory-access.internal.js';
import {
  issueSecretBoundaryClearance,
  sealSanitizedMetadata,
  sealSanitizedText,
  sealVerifiedMemoryWrite,
} from '../../src/core/domain/sanitized.internal.js';

export const iso = (value: string): ISO8601 => {
  const parsed = parseISO8601(value);
  if (!parsed.ok) throw new Error(parsed.error.reason);
  return parsed.value;
};
export const asOwner = (value = 'owner-1'): OwnerId => {
  const parsed = parseOwnerId(value);
  if (!parsed.ok) throw new Error(parsed.error.reason);
  return parsed.value;
};
export const asActor = (value = 'actor-1'): ActorId => {
  const parsed = parseActorId(value);
  if (!parsed.ok) throw new Error(parsed.error.reason);
  return parsed.value;
};
export const asCorrelation = (value = 'req-1'): CorrelationId => {
  const parsed = parseCorrelationId(value);
  if (!parsed.ok) throw new Error(parsed.error.reason);
  return parsed.value;
};
export const asRecordId = (value = 'record-1'): MemoryRecordId => {
  const parsed = parseMemoryRecordId(value);
  if (!parsed.ok) throw new Error(parsed.error.reason);
  return parsed.value;
};
export const asApprovalId = (value = 'approval-1'): ApprovalId => {
  const parsed = parseApprovalId(value);
  if (!parsed.ok) throw new Error(parsed.error.reason);
  return parsed.value;
};
export const asNonce = (value = 'nonce-1'): ApprovalNonce => {
  const parsed = parseApprovalNonce(value);
  if (!parsed.ok) throw new Error(parsed.error.reason);
  return parsed.value;
};
export const asDigest = (value = 'a'.repeat(64)): PayloadDigest => {
  const parsed = parsePayloadDigest(value);
  if (!parsed.ok) throw new Error(parsed.error.reason);
  return parsed.value;
};
export const asResource = (value = 'memory/personal/record-1'): ResourceRef => {
  const parsed = parseResourceRef(value);
  if (!parsed.ok) throw new Error(parsed.error.reason);
  return parsed.value;
};

export const NOW = '2026-07-01T12:00:00.000Z';

export const operationContext = (overrides: Partial<OperationContext> = {}): OperationContext => ({
  signal: new AbortController().signal,
  timeoutMs: 5_000,
  deadline: iso('2026-07-01T12:00:30.000Z'),
  ...overrides,
});

export const projectScope = (overrides: Partial<ProjectScope> = {}): ProjectScope => ({
  primary: 'personal',
  permitted: ['personal'],
  crossProjectPermitted: false,
  ...overrides,
});

/** Ordinary structural context — not authorization proof. */
export const accessContext = (
  overrides: Partial<MemoryAccessContext> = {},
): MemoryAccessContext => ({
  ownerId: asOwner(),
  actorId: asActor(),
  role: 'personal-assistant' satisfies MemoryRole,
  activeNamespace: 'personal' satisfies MemoryNamespace,
  projectScope: projectScope(),
  correlationId: asCorrelation(),
  operation: operationContext(),
  ...overrides,
});

/** Trusted authenticated evidence via the same sealer the gateway uses. */
export const authenticatedAccess = (
  overrides: {
    readonly ownerId?: string;
    readonly actorId?: string;
    readonly role?: MemoryRole;
    readonly activeNamespace?: MemoryNamespace;
    readonly projectScope?: ProjectScope;
    readonly correlationId?: string;
    readonly channelId?: string;
    readonly sessionId?: string;
    readonly issuedAt?: string;
    readonly expiresAt?: string;
    readonly operation?: OperationContext;
  } = {},
): AuthenticatedMemoryAccessContext => {
  const operation = overrides.operation ?? operationContext();
  const scope = overrides.projectScope ?? projectScope();
  const sealed = sealAuthenticatedMemoryAccess(
    {
      ownerId: overrides.ownerId ?? asOwner(),
      actorId: overrides.actorId ?? asActor(),
      roles: [overrides.role ?? 'personal-assistant'],
      activeNamespace: overrides.activeNamespace ?? 'personal',
      projectScope: {
        primary: scope.primary,
        permitted: [...scope.permitted],
        crossProjectPermitted: scope.crossProjectPermitted,
      },
      channelId: overrides.channelId ?? 'test-channel',
      sessionId: overrides.sessionId ?? 'test-session',
      issuedAt: overrides.issuedAt ?? '2026-07-01T11:59:00.000Z',
      expiresAt: overrides.expiresAt ?? '2026-07-01T12:30:00.000Z',
      correlationId: overrides.correlationId ?? asCorrelation(),
    },
    operation,
    new Date(NOW),
  );
  if (sealed === null) throw new Error('Failed to seal authenticated access for tests.');
  return sealed;
};

export const retentionPolicy = (): MemoryRetentionPolicy => ({
  expiresAt: iso('2027-01-01T00:00:00.000Z'),
  reviewAt: iso('2026-10-01T00:00:00.000Z'),
  deleteOnExpiry: true,
});

export const ownerSource = (): MemorySource => ({
  kind: 'owner',
  reference: 'owner-note',
  observedAt: iso(NOW),
});

export const externalSource = (): MemorySource => ({
  kind: 'external-chat',
  reference: 'public-channel',
  observedAt: iso(NOW),
});

export const fixedClock = (value: string = NOW) => ({
  now: () => new Date(value),
});

export const grant = (overrides: Partial<ApprovalGrant> = {}): ApprovalGrant => ({
  approvalId: asApprovalId(),
  ownerId: asOwner(),
  actorId: asActor(),
  effect: 'write',
  target: memoryWriteTarget('personal', asRecordId()),
  namespace: 'personal',
  projectScope: projectScope(),
  payloadDigest: asDigest(),
  issuedAt: iso('2026-07-01T11:59:00.000Z'),
  expiresAt: iso('2026-07-01T12:05:00.000Z'),
  nonce: asNonce(),
  status: 'pending',
  ...overrides,
});

export const writeCommand = (overrides: Partial<MemoryWriteCommand> = {}): MemoryWriteCommand => ({
  recordId: asRecordId(),
  targetNamespace: 'personal',
  rawContent: 'Напоминание о встрече в четверг.',
  rawMetadata: { origin: 'owner-note' },
  source: ownerSource(),
  retentionPolicy: retentionPolicy(),
  approvalId: null,
  ...overrides,
});

/** Seals a verified memory write with mandatory secret-boundary clearance for sink tests. */
export const verifiedMemoryWriteForTests = (
  overrides: {
    readonly recordId?: MemoryRecordId;
    readonly ownerId?: OwnerId;
    readonly namespace?: MemoryNamespace;
    readonly content?: string;
    readonly metadata?: Readonly<Record<string, string>>;
    readonly updatedAt?: ISO8601;
  } = {},
): VerifiedMemoryWrite => {
  const write = sealVerifiedMemoryWrite(
    {
      recordId: overrides.recordId ?? asRecordId(),
      ownerId: overrides.ownerId ?? asOwner(),
      namespace: overrides.namespace ?? 'personal',
      content: sealSanitizedText(overrides.content ?? 'note-body', 'allow'),
      metadata: sealSanitizedMetadata(overrides.metadata ?? { origin: 'test' }, 'allow'),
      source: ownerSource(),
      provenance: {
        capturedAt: iso(NOW),
        initiatedBy: overrides.ownerId ?? asOwner(),
        transformation: 'owner-stated',
        ownerApproved: false,
        crossProjectAccess: false,
      },
      privacyClassification: 'confidential',
      trustLevel: 'owner-stated',
      retentionPolicy: retentionPolicy(),
      approvalId: null,
      createdAt: iso(NOW),
      updatedAt: overrides.updatedAt ?? iso(NOW),
    },
    issueSecretBoundaryClearance(),
  );
  if (write === null) throw new Error('failed to seal verified write for tests');
  return write;
};

/** Builds a grant whose digest matches the actual operation that executeMemoryWrite will derive. */
export const grantForCommand = (
  command: MemoryWriteCommand = writeCommand(),
  access: AuthenticatedMemoryAccessContext = authenticatedAccess(),
  overrides: Partial<ApprovalGrant> = {},
): ApprovalGrant => {
  const content = sealSanitizedText(command.rawContent, 'allow');
  const metadata = sealSanitizedMetadata(
    Object.fromEntries(
      Object.entries(command.rawMetadata).map(([key, value]) => [key, String(value)]),
    ),
    'allow',
  );
  const demand = deriveMemoryWriteApprovalDemand({
    access,
    targetNamespace: command.targetNamespace,
    recordId: asRecordId(command.recordId),
    content,
    metadata,
    projectScope: access.projectScope,
  });
  return grant({
    ownerId: demand.ownerId,
    actorId: demand.actorId,
    effect: demand.effect,
    target: demand.target,
    namespace: demand.namespace,
    projectScope: demand.projectScope,
    payloadDigest: demand.payloadDigest,
    ...overrides,
  });
};

const scannerFailure: DomainError = { code: 'NOT_CONFIGURED', component: 'sensitive-data-scanner' };

export interface HarnessOptions {
  readonly scanTextResult?: Result<ScanReport, DomainError>;
  readonly scanMetadataResult?: Result<MetadataScanReport, DomainError>;
  readonly policyDecision?: MemoryWriteDecision;
  readonly policyFails?: boolean;
  readonly lookupGrant?: ApprovalGrant;
  readonly lookupFails?: boolean;
  readonly consumeFails?: boolean;
  readonly memoryFails?: boolean;
  readonly auditFails?: boolean;
  readonly clock?: { now(): Date };
  readonly concurrentConsume?: boolean;
}

export interface Harness {
  readonly calls: string[];
  readonly writes: VerifiedMemoryWrite[];
  readonly auditEvents: SafeMemoryAuditEvent[];
  readonly deps: MemoryWriteDeps;
  readonly consumeAttempts: number[];
}

const toDomainResult = <T>(
  value: Result<T, { readonly reason: string }>,
): Result<T, DomainError> => (value.ok ? ok(value.value) : err(scannerFailure));

/** Fake ports that record the call order so the security sequence can be asserted. */
export function createHarness(options: HarnessOptions = {}): Harness {
  const calls: string[] = [];
  const writes: VerifiedMemoryWrite[] = [];
  const auditEvents: SafeMemoryAuditEvent[] = [];
  const consumeAttempts: number[] = [];
  let consumeCount = 0;
  const deps: MemoryWriteDeps = {
    scanner: {
      scanText: (input) => {
        calls.push('scanText');
        return Promise.resolve(options.scanTextResult ?? toDomainResult(scanSensitiveData(input)));
      },
      scanMetadata: (input) => {
        calls.push('scanMetadata');
        return Promise.resolve(
          options.scanMetadataResult ?? toDomainResult(scanSensitiveMetadata(input)),
        );
      },
    },
    policy: {
      evaluate: () => {
        calls.push('policy.evaluate');
        return Promise.resolve(
          options.policyFails === true
            ? err(scannerFailure)
            : ok(options.policyDecision ?? { decision: 'allow' }),
        );
      },
    },
    approvals: {
      lookup: (approvalId) => {
        calls.push('approvals.lookup');
        return Promise.resolve(
          options.lookupFails === true
            ? err<DomainError>({ code: 'NOT_CONFIGURED', component: 'approval-storage' })
            : ok(options.lookupGrant ?? grant({ approvalId })),
        );
      },
      consume: () => {
        calls.push('approvals.consume');
        consumeCount += 1;
        consumeAttempts.push(consumeCount);
        if (options.concurrentConsume === true && consumeCount > 1)
          return Promise.resolve(
            err<DomainError>({ code: 'EXTERNAL_FAILURE', operation: 'consume', retryable: false }),
          );
        return Promise.resolve(
          options.consumeFails === true
            ? err<DomainError>({ code: 'EXTERNAL_FAILURE', operation: 'consume', retryable: false })
            : ok(undefined),
        );
      },
    },
    memory: {
      query: () => {
        calls.push('memory.query');
        return Promise.resolve(ok([]));
      },
      read: () => {
        calls.push('memory.read');
        return Promise.resolve(err<DomainError>({ code: 'NOT_CONFIGURED', component: 'memory' }));
      },
      write: (write) => {
        calls.push('memory.write');
        if (options.memoryFails === true)
          return Promise.resolve(
            err<DomainError>({ code: 'CAPABILITY_UNAVAILABLE', capability: 'memory' }),
          );
        writes.push(write);
        return Promise.resolve(ok(write.recordId));
      },
      delete: () => {
        calls.push('memory.delete');
        return Promise.resolve(ok(undefined));
      },
    },
    audit: {
      record: (event) => {
        calls.push('audit.record');
        if (options.auditFails === true)
          return Promise.resolve(
            err<DomainError>({ code: 'EXTERNAL_FAILURE', operation: 'audit', retryable: true }),
          );
        auditEvents.push(event);
        return Promise.resolve(ok(undefined));
      },
    },
    clock: options.clock ?? fixedClock(),
  };
  return { calls, writes, auditEvents, deps, consumeAttempts };
}
