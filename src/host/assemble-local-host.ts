import {
  executeMemoryWrite,
  type MemoryWriteCommand,
  type MemoryWriteFailure,
  type MemoryWriteOutcome,
} from '../core/application/index.js';
import {
  err,
  type ApprovalGrant,
  type AuthenticatedMemoryAccessContext,
  type DomainError,
  type MemoryReadRequest,
  type MemoryRecord,
  type Result,
} from '../core/domain/index.js';
import type {
  ApprovalPort,
  ClockPort,
  MemoryAuditPort,
  MemoryPolicyPort,
  MemoryPort,
  SensitiveDataScannerPort,
} from '../core/ports/index.js';
import { authorizeMemoryAccess } from '../core/policy/namespace-isolation.js';
import type { LocalHostDiagnostics } from './diagnostics.js';
import type { LocalHost } from './local-host.js';

/**
 * App-private LocalHost assembly ports. Shared by ephemeral `createLocalHost` and durable
 * POSIX composition so security/policy/audit orchestration is not duplicated.
 * Not exported from host/package barrels.
 */
export interface LocalHostAssemblyPorts {
  readonly memory: MemoryPort;
  readonly approvals: ApprovalPort & {
    readonly seed: (grant: ApprovalGrant) => void;
  };
  readonly audit: MemoryAuditPort;
  readonly scanner: SensitiveDataScannerPort;
  readonly policy: MemoryPolicyPort;
  readonly clock: ClockPort;
  readonly diagnostics: LocalHostDiagnostics;
}

/**
 * Pure LocalHost surface assembly from already-created ports and honest diagnostics.
 * Does not create stores, open storage, or load native modules.
 */
export function assembleLocalHostFromPorts(ports: LocalHostAssemblyPorts): LocalHost {
  const { memory, approvals, audit, scanner, policy, clock, diagnostics } = ports;

  const host: LocalHost = {
    diagnostics,
    writeMemory: (
      access: AuthenticatedMemoryAccessContext,
      command: MemoryWriteCommand,
    ): Promise<Result<MemoryWriteOutcome, MemoryWriteFailure>> =>
      executeMemoryWrite({ scanner, policy, approvals, memory, audit, clock }, access, command),
    readMemory: (
      access: AuthenticatedMemoryAccessContext,
      request: MemoryReadRequest,
    ): Promise<Result<MemoryRecord, DomainError>> => {
      const decision = authorizeMemoryAccess(access, 'read', {
        ownerId: request.expectedOwnerId,
        namespace: request.expectedNamespace,
      });
      if (!decision.allowed)
        return Promise.resolve(
          err({
            code: 'POLICY_DENIED',
            reason: `${decision.code}: ${decision.reason}`,
          }),
        );
      return memory.read(request, access);
    },
    seedLocalApprovalGrant: (grant: ApprovalGrant): void => {
      approvals.seed(grant);
    },
  };

  return Object.freeze(host);
}
