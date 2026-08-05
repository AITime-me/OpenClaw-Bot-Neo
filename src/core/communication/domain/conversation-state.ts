import type { OwnerId } from '../../domain/identity.js';
import { deepFreeze } from '../../domain/immutable.js';
import type { ConversationId, ConversationRevision } from './communication-identity.js';

/** Model-derived summaries and assistant content are untrusted contextual material. */
export const MODEL_DERIVED_UNTRUSTED_TRUST = 'model-derived-untrusted' as const;
export type ModelDerivedUntrustedTrust = typeof MODEL_DERIVED_UNTRUSTED_TRUST;

export type ConversationContextTrust = 'untrusted' | ModelDerivedUntrustedTrust;

export type ConversationActiveContextRole = 'owner' | 'assistant' | 'system-notice';

export interface ConversationActiveContextEntry {
  readonly role: ConversationActiveContextRole;
  readonly text: string;
  readonly trust: ConversationContextTrust;
}

export interface ConversationModelDerivedSummary {
  readonly text: string;
  readonly trust: ModelDerivedUntrustedTrust;
}

export type ConversationPauseState = 'active' | 'paused' | 'degraded';

export type ConversationCheckpointMetadataStatus =
  'not_required' | 'pending' | 'succeeded' | 'failed';

export interface ConversationCheckpointMetadata {
  readonly status: ConversationCheckpointMetadataStatus;
  readonly revision: ConversationRevision;
}

/**
 * Immutable durable conversation checkpoint snapshot contract.
 * Raw transcript persistence is disabled by default and not represented here.
 */
export interface ConversationStateSnapshot {
  readonly conversationId: ConversationId;
  readonly ownerId: OwnerId;
  readonly revision: ConversationRevision;
  readonly activeContext: readonly ConversationActiveContextEntry[];
  readonly modelDerivedSummary: ConversationModelDerivedSummary | null;
  readonly pauseState: ConversationPauseState;
  readonly checkpoint: ConversationCheckpointMetadata;
}

export const freezeConversationStateSnapshot = (
  snapshot: ConversationStateSnapshot,
): ConversationStateSnapshot =>
  deepFreeze({
    ...snapshot,
    activeContext: Object.freeze(snapshot.activeContext.map((entry) => deepFreeze({ ...entry }))),
    modelDerivedSummary:
      snapshot.modelDerivedSummary === null
        ? null
        : deepFreeze({ ...snapshot.modelDerivedSummary }),
    checkpoint: deepFreeze({ ...snapshot.checkpoint }),
  });

export type ConversationStateKey = {
  readonly conversationId: ConversationId;
  readonly ownerId: OwnerId;
};

export const conversationStateKeysEqual = (
  left: ConversationStateKey,
  right: ConversationStateKey,
): boolean => left.conversationId === right.conversationId && left.ownerId === right.ownerId;
