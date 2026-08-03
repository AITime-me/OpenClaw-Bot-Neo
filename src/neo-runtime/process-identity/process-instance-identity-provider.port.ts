import type { Result } from '../../core/domain/result.js';

export type ProcessInstanceIdentity = {
  readonly pid: number;
  readonly bootId: string;
  readonly startTimeTicks: string;
};

export type ObservedProcessInstance = ProcessInstanceIdentity & {
  readonly state: string;
};

export type ProcessInstanceProbeFailure =
  | 'unsupported-platform'
  | 'process-absent'
  | 'probe-unavailable'
  | 'probe-invalid'
  | 'process-zombie';

export type ProcessInstanceIdentityProvider = {
  readonly captureSelf: () => Promise<Result<ProcessInstanceIdentity, ProcessInstanceProbeFailure>>;
  readonly observe: (
    pid: number,
  ) => Promise<Result<ObservedProcessInstance, ProcessInstanceProbeFailure>>;
  readonly readCurrentBootId: () => Promise<Result<string, ProcessInstanceProbeFailure>>;
};
