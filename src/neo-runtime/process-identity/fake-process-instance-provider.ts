import { err, ok, type Result } from '../../core/domain/result.js';
import type {
  ObservedProcessInstance,
  ProcessInstanceIdentity,
  ProcessInstanceIdentityProvider,
  ProcessInstanceProbeFailure,
} from './process-instance-identity-provider.port.js';

export type FakeObservedProcess =
  | ObservedProcessInstance
  | { readonly kind: 'absent' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'zombie' };

export type FakeProcessInstanceProviderState = {
  readonly bootId: string;
  readonly self: ProcessInstanceIdentity;
  readonly observedByPid: ReadonlyMap<number, FakeObservedProcess>;
  readonly platformSupported: boolean;
};

export const createFakeProcessInstanceProvider = (
  state: FakeProcessInstanceProviderState,
): ProcessInstanceIdentityProvider => {
  const unsupported = (): Promise<Result<never, ProcessInstanceProbeFailure>> =>
    Promise.resolve(err('unsupported-platform'));

  const mapObservedFailure = (
    observed: FakeObservedProcess,
  ): Result<ObservedProcessInstance, ProcessInstanceProbeFailure> => {
    if ('kind' in observed) {
      if (observed.kind === 'absent') return err('process-absent');
      if (observed.kind === 'unavailable') return err('probe-unavailable');
      if (observed.kind === 'zombie') return err('process-zombie');
      return err('probe-invalid');
    }
    return ok(observed);
  };

  return {
    captureSelf: () => {
      if (!state.platformSupported) return unsupported();
      return Promise.resolve(ok(Object.freeze({ ...state.self })));
    },
    observe: (pid) => {
      if (!state.platformSupported) return unsupported();
      const observed = state.observedByPid.get(pid);
      if (observed === undefined) return Promise.resolve(err('process-absent'));
      return Promise.resolve(mapObservedFailure(observed));
    },
    readCurrentBootId: () => {
      if (!state.platformSupported) return unsupported();
      return Promise.resolve(ok(state.bootId));
    },
  };
};
