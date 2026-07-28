import type { StorePort } from '../ports/store.port.js';
export type Rule = (store: StorePort) => boolean;
