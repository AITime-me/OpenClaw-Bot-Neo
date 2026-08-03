import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { rename, unlink, type FileHandle } from 'node:fs/promises';
import type {
  NeoProcessReadinessPort,
  NeoRuntimeReadinessSnapshot,
} from '../ports/neo-process-ports.js';
import {
  createNodeReadinessTempOpenDriver,
  type ReadinessTempOpenDriver,
} from './readiness-temp-open-driver.js';

export const NEO_READINESS_FILENAME = 'ready.json' as const;
export const NEO_READINESS_SCHEMA_VERSION = '2' as const;
export const NEO_READINESS_TEMP_MAX_ATTEMPTS = 5 as const;

const readinessPath = (executionRoot: string): string =>
  join(executionRoot, NEO_READINESS_FILENAME);

const collisionResistantTempPath = (executionRoot: string): string =>
  join(executionRoot, `.ready-${randomBytes(16).toString('hex')}.tmp`);

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

const isEexist = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  Reflect.get(error, 'code') === 'EEXIST';

const publishWithTempDriver = async (
  executionRoot: string,
  snapshot: NeoRuntimeReadinessSnapshot,
  tempDriver: ReadinessTempOpenDriver,
): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const target = readinessPath(executionRoot);
  let ownedTemp: string | null = null;
  let handle: FileHandle | null = null;
  try {
    for (let attempt = 0; attempt < NEO_READINESS_TEMP_MAX_ATTEMPTS; attempt += 1) {
      const candidate = collisionResistantTempPath(executionRoot);
      try {
        handle = await tempDriver.openExclusiveTemp(candidate);
        ownedTemp = candidate;
        break;
      } catch (error: unknown) {
        if (isEexist(error)) continue;
        throw error;
      }
    }
    if (handle === null || ownedTemp === null) {
      return { ok: false as const, reason: 'Readiness publish failed.' };
    }
    const payload = boundedSnapshot(snapshot);
    const bytes = Buffer.from(payload, 'utf8');
    await handle.write(bytes, 0, bytes.length, 0);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(ownedTemp, target);
    ownedTemp = null;
    return { ok: true as const };
  } catch {
    if (handle !== null) {
      try {
        await handle.close();
      } catch {
        // ignore
      }
    }
    if (ownedTemp !== null) {
      try {
        await unlink(ownedTemp);
      } catch {
        // ignore
      }
    }
    return { ok: false as const, reason: 'Readiness publish failed.' };
  }
};

export function createNodeNeoRuntimeReadinessPortWithTempDriver(
  tempDriver: ReadinessTempOpenDriver,
): NeoProcessReadinessPort {
  return {
    removeStale: async (executionRoot: string) => {
      try {
        await unlink(readinessPath(executionRoot));
      } catch {
        // Idempotent remove.
      }
    },
    publish: (executionRoot, snapshot) =>
      publishWithTempDriver(executionRoot, snapshot, tempDriver),
    remove: async (executionRoot: string) => {
      try {
        await unlink(readinessPath(executionRoot));
      } catch {
        // Idempotent.
      }
    },
  };
}

export const createNodeNeoRuntimeReadinessPort = (): NeoProcessReadinessPort =>
  createNodeNeoRuntimeReadinessPortWithTempDriver(createNodeReadinessTempOpenDriver());

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
