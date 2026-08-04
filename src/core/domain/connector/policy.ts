import type { ToolSideEffectClass } from './capabilities.js';
import type { ConnectorId, ConnectionId, InvocationId, ToolId } from './identity.js';

export type ToolPolicyDecision =
  | { readonly decision: 'allow' }
  | { readonly decision: 'deny'; readonly reason: string }
  | { readonly decision: 'require-approval'; readonly reason: string };

export interface ToolPolicyContext {
  readonly invocationId: InvocationId;
  readonly toolId: ToolId;
  readonly connectorId: ConnectorId;
  readonly connectionId: ConnectionId | null;
  readonly sideEffectClass: ToolSideEffectClass;
  readonly capability: import('./capabilities.js').ToolCapability;
  readonly connectionActive: boolean;
  readonly capabilityAllowed: boolean;
  readonly cancellationSupport: import('./capabilities.js').CancellationSupport;
}

export type ToolAuditEventKind =
  | 'invocation-requested'
  | 'validation-result'
  | 'policy-decision'
  | 'approval-decision'
  | 'execution-started'
  | 'execution-finished'
  | 'invocation-completed';

export interface SafeToolAuditEvent {
  readonly kind: ToolAuditEventKind;
  readonly invocationId: InvocationId;
  readonly toolId: ToolId;
  readonly connectorId: ConnectorId;
  readonly connectionId: ConnectionId | null;
  readonly inputDigestPrefix: string | null;
  readonly outcome: 'allow' | 'deny' | 'require-approval' | 'success' | 'failure' | 'unknown';
  readonly errorCode: string | null;
  readonly metadataFieldCount: number;
}
