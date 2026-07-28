import type { OwnerId } from './identity.js';
import type { MemoryNamespace } from './memory-namespace.js';
export interface MemoryQueryContext {
  readonly ownerId: OwnerId;
  readonly activeNamespace: MemoryNamespace;
  readonly requestedNamespaces: readonly MemoryNamespace[];
  readonly crossProjectApproved: boolean;
}
