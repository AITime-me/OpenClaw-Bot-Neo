import type { CommunicationQueueConfig } from '../domain/communication-turn.js';

/**
 * Explicit frozen queue config for Build 3.7D reference composition.
 * Must be passed to both SQLite factory and dispatcher — never rely on default maxGlobalPending=1.
 */
export const REFERENCE_COMMUNICATION_QUEUE_CONFIG: CommunicationQueueConfig = Object.freeze({
  maxDepthPerConversation: 8,
  maxGlobalPending: 64,
});
