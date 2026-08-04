import type { ToolSideEffectClass } from './capabilities.js';
import type {
  ApprovalId,
  ApprovalNonce,
  ActorId,
  ConnectorId,
  ConnectionId,
  InvocationId,
  ToolId,
  InputDigest,
} from './identity.js';
import type { ISO8601 } from '../identity.js';

export type ToolApprovalStatus =
  'pending' | 'granted' | 'consumed' | 'expired' | 'revoked' | 'denied';

export interface ToolApprovalBinding {
  readonly invocationId: InvocationId;
  readonly toolId: ToolId;
  readonly connectorId: ConnectorId;
  readonly connectionId: ConnectionId | null;
  readonly inputDigest: InputDigest;
  readonly sideEffectClass: ToolSideEffectClass;
  readonly expiresAt: ISO8601;
  readonly requestingActorId: ActorId;
  readonly approvingActorId: ActorId | null;
  readonly nonce: ApprovalNonce;
}

export type ToolApprovalRequestBinding = Omit<ToolApprovalBinding, 'nonce' | 'approvingActorId'>;

export interface ToolApprovalGrant {
  readonly approvalId: ApprovalId;
  readonly binding: ToolApprovalBinding;
  readonly status: ToolApprovalStatus;
}

export type ToolApprovalFailureCode =
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'CONSUMED'
  | 'REVOKED'
  | 'DENIED'
  | 'NOT_GRANTED'
  | 'MISMATCH'
  | 'MALFORMED'
  | 'FINANCIAL_DENIED';

export interface ToolApprovalFailure {
  readonly code: ToolApprovalFailureCode;
  readonly reason: string;
}
