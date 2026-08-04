import type {
  ApprovalId,
  ApprovalNonce,
  ActorId,
  CorrelationId,
  IdempotencyKey,
  OwnerId,
} from './identity.js';
import type { ConnectorId, ConnectionId, InvocationId, ToolId, InputDigest } from './identity.js';
import type { JsonObject } from './json.js';
import type { ToolSideEffectClass } from './capabilities.js';
import type { ToolExecutionError } from './errors.js';
import type { ISO8601 } from '../identity.js';

export interface ToolInvocationContext {
  readonly ownerId: OwnerId;
  readonly actorId: ActorId;
  readonly correlationId: CorrelationId;
  readonly signal: AbortSignal;
}

export interface ToolInvocationRequest {
  readonly invocationId: InvocationId;
  readonly toolId: ToolId;
  readonly connectionId: ConnectionId | null;
  readonly input: JsonObject;
  readonly approvalId: ApprovalId | null;
  readonly approvalNonce: ApprovalNonce | null;
  readonly idempotencyKey: IdempotencyKey | null;
  readonly timeoutOverrideMs: number | null;
}

export interface ApprovalRequestMetadata {
  readonly approvalId: ApprovalId;
  readonly nonce: ApprovalNonce;
  readonly invocationId: InvocationId;
  readonly toolId: ToolId;
  readonly connectorId: ConnectorId;
  readonly connectionId: ConnectionId | null;
  readonly inputDigest: InputDigest;
  readonly sideEffectClass: ToolSideEffectClass;
  readonly expiresAt: ISO8601;
}

export type ContentTrust = 'untrusted';

export interface ToolInvocationSuccess {
  readonly kind: 'success';
  readonly invocationId: InvocationId;
  readonly toolId: ToolId;
  readonly output: JsonObject;
  readonly contentTrust: ContentTrust;
  readonly bounded: true;
}

export interface ToolInvocationApprovalRequired {
  readonly kind: 'approval-required';
  readonly invocationId: InvocationId;
  readonly toolId: ToolId;
  readonly approvalRequest: ApprovalRequestMetadata;
}

export interface ToolInvocationFailure {
  readonly kind: 'failure';
  readonly invocationId: InvocationId;
  readonly toolId: ToolId;
  readonly error: ToolExecutionError;
}

export type ToolInvocationResult =
  ToolInvocationSuccess | ToolInvocationApprovalRequired | ToolInvocationFailure;
