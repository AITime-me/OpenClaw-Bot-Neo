import process from 'node:process';
import type { ProcessInstanceIdentityProvider } from './process-instance-identity-provider.port.js';
import { createLinuxProcfsProcessInstanceProvider } from './linux-procfs-process-instance-provider.js';
import { createFakeProcessInstanceProvider } from './fake-process-instance-provider.js';

const createUnsupportedProcessInstanceProvider = (): ProcessInstanceIdentityProvider =>
  createFakeProcessInstanceProvider({
    bootId: '',
    self: { pid: 0, bootId: '', startTimeTicks: '' },
    observedByPid: new Map(),
    platformSupported: false,
  });

export const createNodeProcessInstanceProvider = (): ProcessInstanceIdentityProvider => {
  if (process.platform === 'linux') {
    return createLinuxProcfsProcessInstanceProvider(process.pid);
  }
  return createUnsupportedProcessInstanceProvider();
};
