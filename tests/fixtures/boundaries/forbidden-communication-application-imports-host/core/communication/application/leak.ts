import { createLocalStoragePlan } from '../../../host/index.js';

export const leak = (): unknown => createLocalStoragePlan;
