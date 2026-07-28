import type { ISO8601 } from './identity.js';
export type MemorySourceKind =
  'owner' | 'crm' | 'website' | 'document' | 'transcript' | 'video' | 'external-chat' | 'monitor';
export interface MemorySource {
  readonly kind: MemorySourceKind;
  readonly reference: string;
  readonly observedAt: ISO8601;
}
