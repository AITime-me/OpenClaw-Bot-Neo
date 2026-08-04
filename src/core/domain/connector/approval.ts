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

export type ToolApprovalStatus = 'pending' | 'granted' | 'consumed' | 'expired' | 'revoked';

export interface ToolApprovalBinding {
  readonly invocationId: InvocationId;
  readonly toolId: ToolId;
  readonly connectorId: ConnectorId;
  readonly connectionId: ConnectionId | null;
  readonly inputDigest: InputDigest;
  readonly sideEffectClass: ToolSideEffectClass;
  readonly expiresAt: ISO8601;
  readonly approvingActorId: ActorId;
  readonly nonce: ApprovalNonce;
}

export interface ToolApprovalGrant {
  readonly approvalId: ApprovalId;
  readonly binding: ToolApprovalBinding;
  readonly status: ToolApprovalStatus;
}

export type ToolApprovalFailureCode =
  'NOT_FOUND' | 'EXPIRED' | 'CONSUMED' | 'REVOKED' | 'MISMATCH' | 'MALFORMED';

export interface ToolApprovalFailure {
  readonly code: ToolApprovalFailureCode;
  readonly reason: string;
}
