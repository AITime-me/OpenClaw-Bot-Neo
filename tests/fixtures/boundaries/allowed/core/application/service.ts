import { createHash } from 'node:crypto';
import type { Rule } from '../policy/rule.js';
import type { StorePort } from '../ports/store.port.js';
export const service = (store: StorePort, rule: Rule): string =>
  createHash('sha256')
    .update(String(rule(store)))
    .digest('hex');
