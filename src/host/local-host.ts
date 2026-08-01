import type {
  MemoryWriteCommand,
  MemoryWriteFailure,
  MemoryWriteOutcome,
} from '../core/application/index.js';
import type {
  ApprovalGrant,
  AuthenticatedMemoryAccessContext,
  DomainError,
  MemoryReadRequest,
  MemoryRecord,
  Result,
} from '../core/domain/index.js';
import type { ClockPort, MemoryPolicyPort, SensitiveDataScannerPort } from '../core/ports/index.js';
import type { LocalHostDiagnostics } from './diagnostics.js';

/**
 * Explicit composition input. Trusted clock evidence cannot be invented inside host;
 * callers must inject a ClockPort. Authenticated access is supplied per use-case call.
 * Memory policy defaults to deny-by-default; allow must be injected explicitly.
 */
export interface CreateLocalHostInput {
  readonly clock: ClockPort;
  readonly scanner?: SensitiveDataScannerPort;
  readonly policy?: MemoryPolicyPort;
}

/**
 * App-private local host surface for Build 3.0 integration checks.
 * Not a service locator; not published via package exports.
 */
export interface LocalHost {
  readonly diagnostics: LocalHostDiagnostics;
  writeMemory(
    access: AuthenticatedMemoryAccessContext,
    command: MemoryWriteCommand,
  ): Promise<Result<MemoryWriteOutcome, MemoryWriteFailure>>;
  readMemory(
    access: AuthenticatedMemoryAccessContext,
    request: MemoryReadRequest,
  ): Promise<Result<MemoryRecord, DomainError>>;
  /**
   * Local-only helper: stores a plain ApprovalGrant for ApprovalPort lookup/consume.
   * Does not seal ValidatedApproval, does not create AuthenticatedMemoryAccessContext,
   * and is not an approval issuance authority.
   */
  seedLocalApprovalGrant(grant: ApprovalGrant): void;
}
