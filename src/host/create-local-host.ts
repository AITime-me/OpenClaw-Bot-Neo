import type { ClockPort, MemoryPolicyPort, SensitiveDataScannerPort } from '../core/ports/index.js';
import { assembleLocalHostFromPorts } from './assemble-local-host.js';
import { LOCAL_HOST_DIAGNOSTICS } from './diagnostics.js';
import { createInMemoryApprovalStore } from './in-memory/approval-store.js';
import { createInMemoryAuditLog } from './in-memory/audit-log.js';
import { createDenyByDefaultMemoryPolicy } from './in-memory/memory-policy.js';
import { createInMemoryMemoryStore } from './in-memory/memory-store.js';
import { createInMemorySensitiveDataScanner } from './in-memory/sensitive-data-scanner.js';
import type { CreateLocalHostInput, LocalHost } from './local-host.js';

export type { CreateLocalHostInput, LocalHost } from './local-host.js';

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

  return assembleLocalHostFromPorts({
    memory,
    approvals,
    audit,
    scanner,
    policy,
    clock,
    diagnostics: LOCAL_HOST_DIAGNOSTICS,
  });
}
