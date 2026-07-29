import type { SpawnSyncReturns, SpawnSyncOptions } from 'node:child_process';

export declare const npmExecutableFor: (platform?: string) => 'npm.cmd' | 'npm';

export declare const buildCheckEnvironment: (environment?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;

export declare const validateNpmCliPath: (options?: {
  readonly candidate?: unknown;
  readonly nodeExecutable?: string;
  readonly npmNodeExecutable?: string;
  readonly platform?: string;
  readonly realpath?: (path: string) => string;
}) => string | null;

export declare const runCheckSteps: (options?: {
  readonly platform?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly nodeExecutable?: string;
  readonly validateCliPath?: (options: {
    readonly candidate?: unknown;
    readonly nodeExecutable: string;
    readonly npmNodeExecutable?: string;
    readonly platform: string;
  }) => string | null;
  readonly spawn?: (
    command: string,
    args: readonly string[],
    options: SpawnSyncOptions,
  ) => SpawnSyncReturns<Buffer>;
}) => number;
