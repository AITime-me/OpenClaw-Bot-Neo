import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { IncomingMessage, OutgoingMessage } from '../domain/index.js';
export interface ChannelPort {
  receive(context: OperationContext): Promise<Result<IncomingMessage, DomainError>>;
  send(message: OutgoingMessage, context: OperationContext): Promise<Result<void, DomainError>>;
}
