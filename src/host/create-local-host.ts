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
import type { ClockPort, MemoryPolicyPort, SensitiveDataScannerPort } from '../core/ports/index.js';
import { authorizeMemoryAccess } from '../core/policy/namespace-isolation.js';
import { LOCAL_HOST_DIAGNOSTICS, type LocalHostDiagnostics } from './diagnostics.js';
import { createInMemoryApprovalStore } from './in-memory/approval-store.js';
import { createInMemoryAuditLog } from './in-memory/audit-log.js';
import { createDenyByDefaultMemoryPolicy } from './in-memory/memory-policy.js';
import { createInMemoryMemoryStore } from './in-memory/memory-store.js';
import { createInMemorySensitiveDataScanner } from './in-memory/sensitive-data-scanner.js';

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

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const assertClock = (clock: unknown): ClockPort => {
  if (!isObjectRecord(clock)) throw new TypeError('createLocalHost requires an injected clock.');
  const now = clock['now'];
  if (typeof now !== 'function')
    throw new TypeError('createLocalHost clock.now must be a function.');
  const nowFn = now as (this: object) => unknown;
  return {
    now: (): Date => {
      const value = nowFn.call(clock);
      if (!(value instanceof Date) || Number.isNaN(value.getTime()))
        throw new TypeError('createLocalHost clock.now must return a valid Date.');
      return value;
    },
  };
};

const assertScanner = (scanner: unknown): SensitiveDataScannerPort => {
  if (!isObjectRecord(scanner)) throw new TypeError('createLocalHost scanner must be an object.');
  const scanText = scanner['scanText'];
  const scanMetadata = scanner['scanMetadata'];
  if (typeof scanText !== 'function' || typeof scanMetadata !== 'function')
    throw new TypeError('createLocalHost scanner has an invalid shape.');
  const scanTextFn = scanText as SensitiveDataScannerPort['scanText'];
  const scanMetadataFn = scanMetadata as SensitiveDataScannerPort['scanMetadata'];
  return {
    scanText: (input, context) => scanTextFn.call(scanner, input, context),
    scanMetadata: (input, context) => scanMetadataFn.call(scanner, input, context),
  };
};

const assertPolicy = (policy: unknown): MemoryPolicyPort => {
  if (!isObjectRecord(policy)) throw new TypeError('createLocalHost policy has an invalid shape.');
  const evaluate = policy['evaluate'];
  if (typeof evaluate !== 'function')
    throw new TypeError('createLocalHost policy has an invalid shape.');
  const evaluateFn = evaluate as MemoryPolicyPort['evaluate'];
  return {
    evaluate: (request, access) => evaluateFn.call(policy, request, access),
  };
};

/**
 * Side-effect-free local composition root. Importing this module does nothing;
 * work starts only when the returned use-case methods are invoked.
 *
 * Stores are ephemeral and isolated per factory call. Composition does not create
 * built-in network clients; absolute network sandbox isolation is not enforced.
 * Credentials, Telegram, OpenClaw, OAuth, and production entrypoints are absent.
 */
export function createLocalHost(input: CreateLocalHostInput): LocalHost {
  if (!isObjectRecord(input))
    throw new TypeError('createLocalHost requires a composition input object.');
  const clock = assertClock(input['clock']);

  const approvals = createInMemoryApprovalStore();
  const memory = createInMemoryMemoryStore();
  const audit = createInMemoryAuditLog();
  const scanner = assertScanner(
    input['scanner'] === undefined ? createInMemorySensitiveDataScanner() : input['scanner'],
  );
  const policy = assertPolicy(
    input['policy'] === undefined ? createDenyByDefaultMemoryPolicy() : input['policy'],
  );

  const host: LocalHost = {
    diagnostics: LOCAL_HOST_DIAGNOSTICS,
    writeMemory: (access, command) =>
      executeMemoryWrite({ scanner, policy, approvals, memory, audit, clock }, access, command),
    readMemory: (access, request) => {
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
    seedLocalApprovalGrant: (grant) => {
      approvals.seed(grant);
    },
  };

  return Object.freeze(host);
}
