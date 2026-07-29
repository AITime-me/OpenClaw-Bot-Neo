import {
  err,
  ok,
  type CorrelationId,
  type OperationContext,
  type Result,
} from '../domain/index.js';
import {
  sealCurrentExtensionPolicySnapshot,
  type CurrentExtensionPolicySnapshot,
} from '../domain/extension-policy.internal.js';
import type { ActiveExtensionRegistration } from '../domain/extension-registry-entry.internal.js';
import type { RuntimeRiskEvidence } from '../domain/extension-runtime-risk.internal.js';
import { exactPlainRecord, filledString } from '../domain/observation-validation.js';
import { resolveExtensionPermissions } from '../policy/extension-permissions.js';
import type { ExtensionPermissionDecision } from '../domain/extension-permission.js';
import type { ClockPort } from '../ports/index.js';
import type {
  CurrentExtensionPolicyPort,
  SecurityGuardDecisionPort,
  TrustedRoutingObservationPort,
} from '../ports/trusted-derivation.port.js';
import {
  classifyExtensionRuntimeRisk,
  parseRoutingObservation,
  parseSecurityGuardObservation,
  snapshotRuntimeRiskOperationRequest,
  type RuntimeRiskClassificationFailure,
} from './runtime-risk-classification.service.js';

export interface ExtensionPermissionGatewayDeps {
  readonly routing: TrustedRoutingObservationPort;
  readonly securityGuard: SecurityGuardDecisionPort;
  readonly policy: CurrentExtensionPolicyPort;
  readonly clock: ClockPort;
}

export interface ExtensionPermissionResolveRequest {
  readonly extensionId: string;
  readonly extensionVersion: string;
  readonly correlationId: CorrelationId;
  readonly operationCategory: string;
  readonly sourceReference: string;
  readonly operationHints?: {
    readonly externalEffect?: boolean;
    readonly untrustedContentPresent?: boolean;
  };
}

export type ExtensionPermissionGatewayFailure =
  | RuntimeRiskClassificationFailure
  | {
      readonly code:
        | 'ROUTING_UNAVAILABLE'
        | 'SECURITY_UNAVAILABLE'
        | 'POLICY_UNAVAILABLE'
        | 'INVALID_OBSERVATION'
        | 'NOT_ACTIVE'
        | 'PERMISSION_DENIED';
      readonly reason: string;
    };

export interface ExtensionPermissionGatewayOutcome {
  readonly decision: ExtensionPermissionDecision;
  readonly runtimeRiskEvidence: RuntimeRiskEvidence;
  readonly policy: CurrentExtensionPolicySnapshot;
}

export interface ExtensionPermissionGateway {
  resolve(
    registration: ActiveExtensionRegistration,
    request: ExtensionPermissionResolveRequest,
    context: OperationContext,
  ): Promise<Result<ExtensionPermissionGatewayOutcome, ExtensionPermissionGatewayFailure>>;
}

/**
 * Trusted composition boundary for extension permission/risk decisions.
 * Request-level callers supply operation identity only — never trust floors, grants,
 * policy version, or current time.
 */
export function createExtensionPermissionGateway(
  deps: ExtensionPermissionGatewayDeps,
): ExtensionPermissionGateway {
  return {
    async resolve(registration, request, context) {
      const plain = exactPlainRecord(
        request,
        [
          'extensionId',
          'extensionVersion',
          'correlationId',
          'operationCategory',
          'sourceReference',
        ],
        ['operationHints'],
      );
      if (
        plain === null ||
        !filledString(plain.extensionId) ||
        !filledString(plain.extensionVersion)
      )
        return err({
          code: 'INVALID_OBSERVATION',
          reason: 'Extension permission request was rejected.',
        });
      const operation = snapshotRuntimeRiskOperationRequest({
        correlationId: plain.correlationId,
        operationCategory: plain.operationCategory,
        sourceReference: plain.sourceReference,
        ...(Object.prototype.hasOwnProperty.call(plain, 'operationHints')
          ? { operationHints: plain.operationHints }
          : {}),
      });
      if (operation === null)
        return err({
          code: 'INVALID_OBSERVATION',
          reason: 'Runtime operation request was rejected.',
        });
      const extensionId = plain.extensionId;
      const extensionVersion = plain.extensionVersion;
      const now = deps.clock.now();
      const expected = {
        extensionId,
        extensionVersion,
        correlationId: operation.correlationId,
      };

      const policyResult = await deps.policy.currentPolicy(expected, context);
      if (!policyResult.ok)
        return err({
          code: 'POLICY_UNAVAILABLE',
          reason: 'Current extension policy dependency failed.',
        });
      const policy = sealCurrentExtensionPolicySnapshot(policyResult.value, now, {
        extensionId,
        extensionVersion,
      });
      if (policy === null)
        return err({
          code: 'INVALID_OBSERVATION',
          reason: 'Current policy observation was rejected.',
        });

      const routingResult = await deps.routing.observe(
        {
          extensionId,
          extensionVersion,
          correlationId: operation.correlationId,
          operationCategory: operation.operationCategory,
          sourceReference: operation.sourceReference,
        },
        context,
      );
      if (!routingResult.ok)
        return err({
          code: 'ROUTING_UNAVAILABLE',
          reason: 'Trusted routing observation dependency failed.',
        });
      const routing = parseRoutingObservation(
        routingResult.value,
        {
          ...expected,
          sourceReference: operation.sourceReference,
        },
        now,
      );
      if (routing === null)
        return err({
          code: 'INVALID_OBSERVATION',
          reason: 'Routing observation was rejected.',
        });

      const guardResult = await deps.securityGuard.decide(
        {
          extensionId,
          extensionVersion,
          correlationId: operation.correlationId,
          operationCategory: operation.operationCategory,
        },
        context,
      );
      if (!guardResult.ok)
        return err({
          code: 'SECURITY_UNAVAILABLE',
          reason: 'Security Guard dependency failed.',
        });
      const securityGuard = parseSecurityGuardObservation(guardResult.value, expected, now);
      if (securityGuard === null)
        return err({
          code: 'INVALID_OBSERVATION',
          reason: 'Security Guard observation was rejected.',
        });

      const classified = classifyExtensionRuntimeRisk(
        { clock: deps.clock },
        registration,
        policy,
        routing,
        securityGuard,
        operation,
        context,
      );
      if (!classified.ok) return classified;

      const securityAllowed = securityGuard.denied
        ? []
        : policy.securityAllowed.filter((permission) =>
            securityGuard.allowedPermissions.includes(permission),
          );

      const decision = resolveExtensionPermissions({
        registration,
        runtimeRiskEvidence: classified.value,
        correlationId: operation.correlationId,
        policy: {
          deploymentAllowed: policy.deploymentAllowed,
          roleAllowed: policy.roleAllowed,
          securityAllowed,
          riskAllowed: policy.riskAllowed,
        },
        now,
      });

      return ok({
        decision,
        runtimeRiskEvidence: classified.value,
        policy,
      });
    },
  };
}
