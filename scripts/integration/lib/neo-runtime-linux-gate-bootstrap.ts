import { NEO_GATE_EXIT_PROTOCOL } from './neo-runtime-gate-constants.ts';

export const NEO_GATE_BOOTSTRAP_FAILED = 'NEO_GATE_BOOTSTRAP_FAILED' as const;

export type NeoRuntimeLinuxGateModule = {
  readonly runNeoRuntimeLinuxGate?: () => Promise<number>;
};

export const bootstrapNeoRuntimeLinuxGate = async (
  importGateModule: () => Promise<NeoRuntimeLinuxGateModule>,
  stderr: NodeJS.WritableStream = process.stderr,
): Promise<number> => {
  try {
    const mod = await importGateModule();
    if (typeof mod.runNeoRuntimeLinuxGate !== 'function') {
      stderr.write(`${NEO_GATE_BOOTSTRAP_FAILED}\n`);
      return NEO_GATE_EXIT_PROTOCOL;
    }
    const code = await mod.runNeoRuntimeLinuxGate();
    if (typeof code !== 'number') {
      stderr.write(`${NEO_GATE_BOOTSTRAP_FAILED}\n`);
      return NEO_GATE_EXIT_PROTOCOL;
    }
    return code;
  } catch {
    stderr.write(`${NEO_GATE_BOOTSTRAP_FAILED}\n`);
    return NEO_GATE_EXIT_PROTOCOL;
  }
};
