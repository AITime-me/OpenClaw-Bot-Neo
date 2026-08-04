import type { ToolPolicyContext, ToolPolicyDecision } from '../domain/connector/policy.js';
import type { ToolInvocationContext } from '../domain/connector/invocation.js';

export interface ToolPolicyEngine {
  evaluate(context: ToolPolicyContext, invocation: ToolInvocationContext): ToolPolicyDecision;
}
