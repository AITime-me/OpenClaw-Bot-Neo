import { type ChildProcess, spawn, type SpawnOptions } from 'node:child_process';
import { GateAbortedError, type CleanupController } from './cleanup-controller.ts';
import {
  spawnChildSession,
  type ChildSessionHandle,
  type ChildSessionOptions,
} from './child-runner.ts';
import { globalProcessRegistry } from './process-registry.ts';

export type AbortSpawnHooks = {
  /**
   * Test seam: runs after first throwIfAborted and before the actual spawn.
   * May mark abort so spawn is skipped.
   */
  readonly beforeUnderlyingSpawn?: () => void;
  /** Inject spawn implementation (tests). */
  readonly spawnChildImpl?: (options: ChildSessionOptions) => ChildSessionHandle;
  /** Inject raw spawn (tests). */
  readonly rawSpawnImpl?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess;
};

/**
 * Abort-checked child session spawn.
 * throwIfAborted immediately before spawn; register is inside spawnChildSession;
 * post-spawn abort rethrows with child already registered.
 */
export const spawnCheckedChildSession = (
  options: ChildSessionOptions,
  cleanup: Pick<CleanupController, 'throwIfAborted' | 'isAborted'>,
  hooks: AbortSpawnHooks = {},
): ChildSessionHandle => {
  cleanup.throwIfAborted();
  hooks.beforeUnderlyingSpawn?.();
  cleanup.throwIfAborted();
  const spawnImpl = hooks.spawnChildImpl ?? spawnChildSession;
  const session = spawnImpl(options);
  if (cleanup.isAborted()) {
    throw new GateAbortedError(cleanup.isAborted() ? 'aborted-during-spawn' : 'aborted');
  }
  return session;
};

export type CheckedRawSpawnResult = {
  readonly process: ChildProcess;
  readonly registryId: string;
};

/**
 * Abort-checked raw process spawn (flock holder / helpers).
 * Registers immediately after spawn; post-spawn abort leaves process registered.
 */
export const spawnCheckedRawProcess = (
  command: string,
  args: readonly string[],
  spawnOptions: SpawnOptions,
  cleanup: Pick<CleanupController, 'throwIfAborted' | 'isAborted'>,
  hooks: AbortSpawnHooks = {},
): CheckedRawSpawnResult => {
  cleanup.throwIfAborted();
  hooks.beforeUnderlyingSpawn?.();
  cleanup.throwIfAborted();
  const rawSpawn = hooks.rawSpawnImpl ?? spawn;
  const child = rawSpawn(command, [...args], spawnOptions);
  const registryId = globalProcessRegistry.register(child);
  if (cleanup.isAborted()) {
    throw new GateAbortedError('aborted-during-spawn');
  }
  return { process: child, registryId };
};

/** True when a caller bypasses abort-checked wrappers (mutation detector for tests). */
export const ABORT_CHECKED_SPAWN_MARKER = 'spawnCheckedChildSession' as const;
