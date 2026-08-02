export async function finalizeHarnessOutput(opts: {
  writeLine: (s: string) => Promise<void>;
  lines: string[];
  code: number;
  setExitCode: (n: number) => void;
  /** When true, never overwrite an existing non-zero exitCode with 0. */
  preserveFatalExitCode?: boolean;
  getExistingExitCode?: () => number | undefined;
  exitNow?: (n: number) => void;
}): Promise<number> {
  for (const line of opts.lines) {
    await opts.writeLine(line);
  }

  let code = opts.code;
  if (opts.preserveFatalExitCode === true) {
    const existing = opts.getExistingExitCode?.() ?? undefined;
    if (typeof existing === 'number' && existing !== 0 && code === 0) {
      code = existing;
    }
  }

  opts.setExitCode(code);
  if (opts.exitNow !== undefined) {
    opts.exitNow(code);
  }
  return code;
}

export const writeStdoutLine = (line: string): Promise<void> =>
  new Promise((resolvePromise, rejectPromise) => {
    process.stdout.write(`${line}\n`, (error) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    });
  });
