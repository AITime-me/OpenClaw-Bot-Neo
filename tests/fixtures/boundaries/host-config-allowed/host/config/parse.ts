import { parseModelRoutingConfig } from '../../core/config/index.js';
export const parse = (value: unknown): unknown => parseModelRoutingConfig(value);
