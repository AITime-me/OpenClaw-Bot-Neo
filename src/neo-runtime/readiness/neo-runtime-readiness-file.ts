import { join } from 'node:path';
import { open, rename, unlink, writeFile, type FileHandle } from 'node:fs/promises';
import type {
  NeoProcessReadinessPort,
  NeoRuntimeReadinessSnapshot,
} from '../ports/neo-process-ports.js';

export const NEO_READINESS_FILENAME = 'ready.json' as const;
export const NEO_READINESS_SCHEMA_VERSION = '2' as const;

const readinessPath = (executionRoot: string): string =>
  join(executionRoot, NEO_READINESS_FILENAME);

const tempPath = (executionRoot: string, pid: number): string =>
  join(executionRoot, `.ready-${String(pid)}.tmp`);

const boundedSnapshot = (snapshot: NeoRuntimeReadinessSnapshot): string =>
  JSON.stringify({
    schemaVersion: NEO_READINESS_SCHEMA_VERSION,
    pid: snapshot.pid,
    lifecycle: snapshot.lifecycle,
    runtimeReady: snapshot.runtimeReady,
    durableHostOpened: snapshot.durableHostOpened,
    startedAtUtc: snapshot.startedAtUtc,
    bootId: snapshot.bootId,
    startTimeTicks: snapshot.startTimeTicks,
  });

export const createNodeNeoRuntimeReadinessPort = (): NeoProcessReadinessPort => ({
  removeStale: async (executionRoot: string) => {
    try {
      await unlink(readinessPath(executionRoot));
    } catch {
      // Idempotent remove.
    }
  },
  publish: async (executionRoot, snapshot) => {
    const target = readinessPath(executionRoot);
    const temp = tempPath(executionRoot, snapshot.pid);
    try {
      await writeFile(temp, boundedSnapshot(snapshot), { encoding: 'utf8', mode: 0o640 });
      const handle: FileHandle = await open(temp, 'r+');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, target);
      return { ok: true as const };
    } catch {
      try {
        await unlink(temp);
      } catch {
        // ignore
      }
      return { ok: false as const, reason: 'Readiness publish failed.' };
    }
  },
  remove: async (executionRoot: string) => {
    try {
      await unlink(readinessPath(executionRoot));
    } catch {
      // Idempotent.
    }
  },
});

export type InMemoryReadinessState = {
  published: NeoRuntimeReadinessSnapshot | null;
  tempWrites: string[];
  removed: number;
};

export const createInMemoryNeoRuntimeReadinessPort = (): NeoProcessReadinessPort & {
  readonly state: InMemoryReadinessState;
} => {
  const state: InMemoryReadinessState = { published: null, tempWrites: [], removed: 0 };
  return {
    state,
    removeStale: (executionRoot: string) => {
      void executionRoot;
      state.removed += 1;
      state.published = null;
      return Promise.resolve();
    },
    publish: (_executionRoot, snapshot) => {
      state.tempWrites.push(boundedSnapshot(snapshot));
      state.published = Object.freeze({ ...snapshot });
      return Promise.resolve({ ok: true as const });
    },
    remove: (executionRoot: string) => {
      void executionRoot;
      state.removed += 1;
      state.published = null;
      return Promise.resolve();
    },
  };
};
