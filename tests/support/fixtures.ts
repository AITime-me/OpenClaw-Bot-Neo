import { err, ok } from '../../src/core/domain/index.js';
import type {
  ActorId,
  ApprovalGrant,
  ApprovalId,
  ApprovalNonce,
  CorrelationId,
  DomainError,
  ISO8601,
  MemoryAccessContext,
  MemoryNamespace,
  MemoryRecordId,
  MemoryRetentionPolicy,
  MemoryRole,
  MemorySource,
  MemoryWriteDecision,
  MetadataScanReport,
  OperationContext,
  OwnerId,
  PayloadDigest,
  ProjectScope,
  ResourceRef,
  Result,
  SafeMemoryAuditEvent,
  ScanReport,
  VerifiedMemoryWrite,
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
  sealSanitizedMetadata,
  sealSanitizedText,
} from '../../src/core/domain/sanitized.internal.js';

export const iso = (value: string): ISO8601 => value as ISO8601;
export const asOwner = (value = 'owner-1'): OwnerId => value as OwnerId;
export const asActor = (value = 'actor-1'): ActorId => value as ActorId;
export const asCorrelation = (value = 'req-1'): CorrelationId => value as CorrelationId;
export const asRecordId = (value = 'record-1'): MemoryRecordId => value as MemoryRecordId;
export const asApprovalId = (value = 'approval-1'): ApprovalId => value as ApprovalId;
export const asNonce = (value = 'nonce-1'): ApprovalNonce => value as ApprovalNonce;
export const asDigest = (value = 'digest-1'): PayloadDigest => value as PayloadDigest;
export const asResource = (value = 'memory/personal/record-1'): ResourceRef => value as ResourceRef;

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
    recordId: command.recordId,
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
