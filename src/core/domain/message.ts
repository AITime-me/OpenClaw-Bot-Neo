import type { CorrelationId, MessageId, OwnerId, ISO8601 } from './identity.js';
export interface ChannelReference {
  readonly kind: string;
  readonly opaqueId: string;
}
export interface IncomingMessage {
  readonly id: MessageId;
  readonly ownerId: OwnerId;
  readonly sourceChannel: ChannelReference;
  readonly receivedAt: ISO8601;
  readonly content: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}
export interface OutgoingMessage {
  readonly correlationId: CorrelationId;
  readonly target: ChannelReference;
  readonly content: string;
}
