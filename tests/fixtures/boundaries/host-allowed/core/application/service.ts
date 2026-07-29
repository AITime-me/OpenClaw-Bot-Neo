import type { Rule } from '../policy/rule.js';
import type { StorePort } from '../ports/store.port.js';
export const service = (store: StorePort, rule: Rule): string => (rule(store) ? 'ok' : 'denied');
