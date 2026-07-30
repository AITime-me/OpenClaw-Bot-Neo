import { hostConfig } from '../../host/config/marker.js';
export const leak = (): string => hostConfig;
