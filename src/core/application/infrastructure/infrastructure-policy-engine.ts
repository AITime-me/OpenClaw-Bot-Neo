import type { ToolPolicyEngine } from '../../ports/tool-policy-engine.port.js';
import type { ToolPolicyContext, ToolPolicyDecision } from '../../domain/connector/policy.js';
import type { ToolInvocationContext } from '../../domain/connector/invocation.js';
import { createDefaultDenyToolPolicyEngine } from '../connector/default-deny-tool-policy-engine.js';
import {
  INFRASTRUCTURE_HARD_DENIED_TOOL_IDS,
  INFRASTRUCTURE_FORBIDDEN_GENERIC_TOOL_IDS,
} from '../../domain/infrastructure/constants.js';

const HARD_DENIED = new Set<string>([
  ...INFRASTRUCTURE_HARD_DENIED_TOOL_IDS,
  ...INFRASTRUCTURE_FORBIDDEN_GENERIC_TOOL_IDS,
]);

export const createInfrastructureToolPolicyEngine = (): ToolPolicyEngine => {
  const base = createDefaultDenyToolPolicyEngine();
  return {
    evaluate(context: ToolPolicyContext, invocation: ToolInvocationContext): ToolPolicyDecision {
      const toolId = context.toolId as string;
      if (HARD_DENIED.has(toolId))
        return { decision: 'deny', reason: `Tool ${toolId} is hard-denied.` };
      if (toolId.startsWith('infrastructure.') && toolId.includes('financial'))
        return { decision: 'deny', reason: 'Financial infrastructure operations are hard-denied.' };
      return base.evaluate(context, invocation);
    },
  };
};
