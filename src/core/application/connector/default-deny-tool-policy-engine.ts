import type { ToolPolicyEngine } from '../../ports/tool-policy-engine.port.js';
import type { ToolPolicyContext, ToolPolicyDecision } from '../../domain/connector/policy.js';
import type { ToolInvocationContext } from '../../domain/connector/invocation.js';
import { isFinancialAction, isWriteLikeSideEffect } from '../../domain/connector/capabilities.js';

export const createDefaultDenyToolPolicyEngine = (): ToolPolicyEngine => ({
  evaluate(context: ToolPolicyContext, _invocation: ToolInvocationContext): ToolPolicyDecision {
    void _invocation;
    if (isFinancialAction(context.sideEffectClass))
      return { decision: 'deny', reason: 'FINANCIAL actions are hard-denied.' };
    if (!context.connectionActive && context.connectionId !== null)
      return { decision: 'deny', reason: 'Connection is not active.' };
    if (!context.capabilityAllowed)
      return { decision: 'deny', reason: 'Capability is not allowed for this connection.' };
    if (context.cancellationSupport === 'none' && isWriteLikeSideEffect(context.sideEffectClass))
      return {
        decision: 'deny',
        reason: 'Write-like tools without cooperative cancellation are denied.',
      };
    if (context.sideEffectClass === 'READ_ONLY') return { decision: 'allow' };
    if (
      context.sideEffectClass === 'LOW_RISK_WRITE' ||
      context.sideEffectClass === 'EXTERNAL_COMMUNICATION' ||
      context.sideEffectClass === 'DESTRUCTIVE' ||
      context.sideEffectClass === 'INFRASTRUCTURE' ||
      context.sideEffectClass === 'CREDENTIAL_OR_SECURITY_CHANGE'
    )
      return { decision: 'require-approval', reason: 'Side effect requires approval.' };
    return { decision: 'deny', reason: 'Denied by default policy.' };
  },
});
