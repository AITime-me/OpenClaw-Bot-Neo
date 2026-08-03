export type LaunchNeoProcessDeps = {
  readonly nodeVersion?: string;
  readonly importRunNeoProcess: () => Promise<{
    runNeoProcessFromNode: () => Promise<{ exitCode: number }>;
  }>;
  readonly stderr?: { write: (chunk: string) => void };
};

export declare const launchNeoProcess: (
  deps: LaunchNeoProcessDeps,
) => Promise<{ exitCode: number }>;
