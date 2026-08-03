import { err, ok, type Result } from '../../core/domain/result.js';
import { NEO_PROC_STAT_MAX_BYTES, parseProcStat, type ParsedProcStat } from './parse-proc-stat.js';
import type {
  ObservedProcessInstance,
  ProcessInstanceIdentity,
  ProcessInstanceIdentityProvider,
  ProcessInstanceProbeFailure,
} from './process-instance-identity-provider.port.js';
import { readBoundedProcfsUtf8, type ProcfsOpenFn } from './read-bounded-procfs-utf8.js';
import { normalizeBootId } from './validate-boot-id.js';

const BOOT_ID_PATH = '/proc/sys/kernel/random/boot_id' as const;
const BOOT_ID_READ_MAX_BYTES = 128 as const;

const statPath = (pid: number): string => `/proc/${String(pid)}/stat`;

export type LinuxProcfsProcessInstanceProviderDeps = {
  readonly openFn?: ProcfsOpenFn;
};

const parseObserved = (
  pid: number,
  statText: string,
): Result<ParsedProcStat, ProcessInstanceProbeFailure> => {
  const parsed = parseProcStat(statText, pid);
  if (!parsed.ok) {
    if (parsed.reason === 'zombie-state') return err('process-zombie');
    if (parsed.reason === 'dead-state') return err('probe-invalid');
    return err('probe-invalid');
  }
  return ok(parsed.value);
};

export const createLinuxProcfsProcessInstanceProvider = (
  selfPid: number,
  deps: LinuxProcfsProcessInstanceProviderDeps = {},
): ProcessInstanceIdentityProvider => {
  const openFn = deps.openFn;

  const readBoundedUtf8 = (
    absolutePath: string,
    maxBytes: number,
  ): Promise<
    | { readonly ok: true; readonly text: string }
    | { readonly ok: false; readonly failure: ProcessInstanceProbeFailure }
  > => readBoundedProcfsUtf8(absolutePath, maxBytes, openFn);

  const readBootId = async (): Promise<Result<string, ProcessInstanceProbeFailure>> => {
    const read = await readBoundedUtf8(BOOT_ID_PATH, BOOT_ID_READ_MAX_BYTES);
    if (!read.ok) {
      return err(read.failure === 'process-absent' ? 'probe-unavailable' : read.failure);
    }
    const bootId = normalizeBootId(read.text);
    if (bootId === null) return err('probe-invalid');
    return ok(bootId);
  };

  const observePid = async (
    pid: number,
  ): Promise<Result<ObservedProcessInstance, ProcessInstanceProbeFailure>> => {
    if (!Number.isInteger(pid) || pid <= 0) return err('probe-invalid');
    const read = await readBoundedUtf8(statPath(pid), NEO_PROC_STAT_MAX_BYTES);
    if (!read.ok) return err(read.failure);
    const parsed = parseObserved(pid, read.text);
    if (!parsed.ok) return parsed;
    const boot = await readBootId();
    if (!boot.ok) return boot;
    return ok(
      Object.freeze({
        pid: parsed.value.pid,
        bootId: boot.value,
        startTimeTicks: parsed.value.startTimeTicks,
        state: parsed.value.state,
      }),
    );
  };

  return {
    captureSelf: async (): Promise<
      Result<ProcessInstanceIdentity, ProcessInstanceProbeFailure>
    > => {
      const observed = await observePid(selfPid);
      if (!observed.ok) return observed;
      return ok(
        Object.freeze({
          pid: observed.value.pid,
          bootId: observed.value.bootId,
          startTimeTicks: observed.value.startTimeTicks,
        }),
      );
    },
    observe: observePid,
    readCurrentBootId: readBootId,
  };
};
