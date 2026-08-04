import type { ClockPort } from '../../ports/clock.port.js';
import type { ToolPolicyEngine } from '../../ports/tool-policy-engine.port.js';
import type { ToolApprovalPort } from '../../ports/tool-approval.port.js';
import type { ToolAuditPort } from '../../ports/tool-audit.port.js';
import type { ConnectorSecretProvider } from '../../ports/connector-secret-provider.port.js';
import type { ConnectorCatalog } from './connector-catalog.port.js';
import type { ConnectorExecutionRegistry } from './connector-execution-registry.port.js';
import type { ToolRegistry } from './tool-registry.port.js';
import type { AccountConnectionRegistry } from './account-connection-registry.port.js';
import type { ConnectorHealthRegistry } from './connector-health-registry.port.js';
import type {
  ToolInvocationContext,
  ToolInvocationRequest,
  ToolInvocationResult,
} from '../../domain/connector/invocation.js';
import type { ToolExecutionError } from '../../domain/connector/errors.js';
import { computeInputDigest } from '../../domain/connector/canonical-digest.js';
import {
  boundJsonObject,
  boundConnectorOutput,
  digestPrefix,
} from '../../domain/connector/json-bounds.js';
import {
  redactSchemaFailure,
  validateJsonAgainstSchema,
} from '../../domain/connector/json-schema-validator.js';
import { validateToolAgainstConnector } from '../../domain/connector/manifest-validation.js';
import { iso8601FromDate } from '../../domain/identity.js';
import { CONNECTOR_PLATFORM_MAX_TIMEOUT_MS } from '../../domain/connector/constants.js';
import type { SafeToolAuditEvent } from '../../domain/connector/policy.js';
import type { SecretReferenceMetadata } from '../../domain/connector/secret.js';
import type { ConnectorHealthSnapshot } from '../../domain/connector/health.js';
import type { ConnectorId, ConnectionId, InputDigest } from '../../domain/connector/identity.js';
import type { ToolApprovalRequestBinding } from '../../domain/connector/approval.js';
import type { ConnectorExecutionResult } from '../../../connectors/sdk/connector.js';
import type { ConnectorExecutionError } from '../../../connectors/sdk/connector.js';
import { isWriteLikeSideEffect } from '../../domain/connector/capabilities.js';
import { INFRASTRUCTURE_OUTCOME_UNKNOWN_REASON } from '../../domain/infrastructure/constants.js';
import type { VerifiedToolManifest } from '../../domain/connector/manifest-validation.js';

export interface ToolInvocationOrchestratorDeps {
  readonly connectorCatalog: ConnectorCatalog;
  readonly connectorExecution: ConnectorExecutionRegistry;
  readonly toolRegistry: ToolRegistry;
  readonly connectionRegistry: AccountConnectionRegistry;
  readonly healthRegistry: ConnectorHealthRegistry;
  readonly policyEngine: ToolPolicyEngine;
  readonly approvalPort: ToolApprovalPort;
  readonly auditPort: ToolAuditPort;
  readonly secretProvider: ConnectorSecretProvider;
  readonly clock: ClockPort;
}

const failure = (
  invocationId: ToolInvocationRequest['invocationId'],
  toolId: ToolInvocationRequest['toolId'],
  error: ToolExecutionError,
): ToolInvocationResult => ({ kind: 'failure', invocationId, toolId, error });

const audit = async (
  deps: ToolInvocationOrchestratorDeps,
  event: SafeToolAuditEvent,
  context: ToolInvocationContext,
): Promise<ToolExecutionError | null> => {
  const result = await deps.auditPort.record(event, context);
  if (result.ok) return null;
  return {
    code: 'internal-error',
    reason: 'Audit recording failed.',
    executionState:
      event.kind === 'execution-finished' || event.kind === 'invocation-completed'
        ? 'outcome-unknown'
        : 'not-started',
  };
};

const effectiveTimeout = (manifestTimeout: number, override: number | null): number => {
  const capped = Math.min(manifestTimeout, CONNECTOR_PLATFORM_MAX_TIMEOUT_MS);
  if (override === null || !Number.isFinite(override) || override <= 0) return capped;
  return Math.min(capped, override);
};

const absorbLateCompletion = (promise: Promise<unknown>): void => {
  void promise.then(() => undefined).catch(() => undefined);
};

const mapAbortedExecution = (
  signal: AbortSignal,
  sideEffectClass: VerifiedToolManifest['sideEffectClass'],
): ToolExecutionError & {
  readonly health: {
    readonly status: ConnectorHealthSnapshot['status'];
    readonly failureCategory: ConnectorHealthSnapshot['failureCategory'];
  };
} => {
  const timedOut = signal.reason === 'timeout';
  const writeLike = isWriteLikeSideEffect(sideEffectClass);
  return {
    code: timedOut ? 'timeout' : 'cancelled',
    reason: timedOut ? 'Execution timed out.' : 'Execution was cancelled.',
    executionState: writeLike ? 'outcome-unknown' : 'completed',
    health: {
      status: 'degraded',
      failureCategory: timedOut ? 'timeout' : 'cancelled',
    },
  };
};

const mapConnectorFailure = (
  error: ConnectorExecutionError,
  signal: AbortSignal,
  sideEffectClass: VerifiedToolManifest['sideEffectClass'],
): ToolExecutionError & {
  readonly health: {
    readonly status: ConnectorHealthSnapshot['status'];
    readonly failureCategory: ConnectorHealthSnapshot['failureCategory'];
  };
} => {
  const writeLike = isWriteLikeSideEffect(sideEffectClass);
  if (
    !signal.aborted &&
    error.code === 'unavailable' &&
    error.reason === INFRASTRUCTURE_OUTCOME_UNKNOWN_REASON &&
    writeLike
  ) {
    return {
      code: 'internal-error',
      reason: 'Mutation outcome is unknown.',
      executionState: 'outcome-unknown',
      health: { status: 'degraded', failureCategory: 'remote' },
    };
  }
  if (signal.aborted)
    return {
      code: signal.reason === 'timeout' ? 'timeout' : 'cancelled',
      reason: signal.reason === 'timeout' ? 'Execution timed out.' : 'Execution was cancelled.',
      executionState: 'completed',
      health: {
        status: 'degraded',
        failureCategory: signal.reason === 'timeout' ? 'timeout' : 'cancelled',
      },
    };
  switch (error.code) {
    case 'unavailable':
      return {
        code: 'connector-unavailable',
        reason: 'Connector is unavailable.',
        executionState: 'completed',
        health: { status: 'unavailable', failureCategory: 'remote' },
      };
    case 'timeout':
      return {
        code: 'timeout',
        reason: 'Connector execution timed out.',
        executionState: 'completed',
        health: { status: 'degraded', failureCategory: 'timeout' },
      };
    case 'cancelled':
      return {
        code: 'cancelled',
        reason: 'Connector execution was cancelled.',
        executionState: 'completed',
        health: { status: 'degraded', failureCategory: 'cancelled' },
      };
    case 'remote-error':
      return {
        code: 'remote-error',
        reason: 'Remote connector error.',
        executionState: 'completed',
        health: { status: 'degraded', failureCategory: 'remote' },
      };
    case 'invalid-output':
      return {
        code: 'invalid-remote-response',
        reason: 'Connector returned invalid output.',
        executionState: 'completed',
        health: { status: 'degraded', failureCategory: 'invalid-response' },
      };
    default:
      return {
        code: 'internal-error',
        reason: 'Connector execution failed.',
        executionState: 'completed',
        health: { status: 'unavailable', failureCategory: 'internal' },
      };
  }
};

const updateHealth = (
  deps: ToolInvocationOrchestratorDeps,
  connectorId: ConnectorId,
  connectionId: ConnectionId | null,
  health: {
    readonly status: ConnectorHealthSnapshot['status'];
    readonly failureCategory: ConnectorHealthSnapshot['failureCategory'];
  },
): void => {
  const now = iso8601FromDate(new Date());
  const previous = deps.healthRegistry.get(connectorId, connectionId);
  deps.healthRegistry.update({
    connectorId,
    connectionId,
    status: health.status,
    lastSuccessAt: health.status === 'healthy' ? now : (previous?.lastSuccessAt ?? null),
    lastFailureAt: health.status === 'healthy' ? (previous?.lastFailureAt ?? null) : now,
    failureCategory: health.failureCategory,
    retryAfterMs: health.status === 'unavailable' ? 30_000 : null,
  });
};

export const createToolInvocationOrchestrator = (deps: ToolInvocationOrchestratorDeps) => ({
  async invoke(
    request: ToolInvocationRequest,
    context: ToolInvocationContext,
  ): Promise<ToolInvocationResult> {
    const tool = deps.toolRegistry.get(request.toolId);
    if (tool === null)
      return failure(request.invocationId, request.toolId, {
        code: 'tool-not-found',
        reason: 'Tool is not registered.',
        executionState: 'not-started',
      });

    const connectorManifest = deps.connectorCatalog.getManifest(tool.connectorId);
    if (connectorManifest === null)
      return failure(request.invocationId, request.toolId, {
        code: 'connector-not-found',
        reason: 'Connector is not registered.',
        executionState: 'not-started',
      });

    const connectorId: ConnectorId = tool.connectorId;
    let digestPrefixValue: string | null = null;

    const auditEvent = (
      partial: Pick<SafeToolAuditEvent, 'kind' | 'outcome' | 'errorCode'>,
    ): SafeToolAuditEvent => ({
      invocationId: request.invocationId,
      toolId: request.toolId,
      connectorId,
      connectionId: request.connectionId,
      inputDigestPrefix: digestPrefixValue,
      metadataFieldCount: 0,
      ...partial,
    });

    const requestedAudit = await audit(
      deps,
      auditEvent({ kind: 'invocation-requested', outcome: 'unknown', errorCode: null }),
      context,
    );
    if (requestedAudit !== null)
      return failure(request.invocationId, request.toolId, requestedAudit);

    const relationship = validateToolAgainstConnector(tool, connectorManifest);
    if (!relationship.ok) {
      await audit(
        deps,
        auditEvent({ kind: 'validation-result', outcome: 'deny', errorCode: 'invalid-input' }),
        context,
      );
      return failure(request.invocationId, request.toolId, {
        code: 'invalid-input',
        reason: relationship.error.reason.slice(0, 256),
        executionState: 'not-started',
      });
    }

    const boundedInput = boundJsonObject(request.input);
    if (!boundedInput.ok) {
      await audit(
        deps,
        auditEvent({ kind: 'validation-result', outcome: 'deny', errorCode: 'invalid-input' }),
        context,
      );
      return failure(request.invocationId, request.toolId, {
        code: 'invalid-input',
        reason: boundedInput.error.reason.slice(0, 256),
        executionState: 'not-started',
      });
    }

    const inputValidation = validateJsonAgainstSchema(tool.inputSchema, boundedInput.value);
    if (!inputValidation.ok) {
      await audit(
        deps,
        auditEvent({ kind: 'validation-result', outcome: 'deny', errorCode: 'invalid-input' }),
        context,
      );
      return failure(request.invocationId, request.toolId, {
        code: 'invalid-input',
        reason: redactSchemaFailure(inputValidation.error).slice(0, 256),
        executionState: 'not-started',
      });
    }

    const inputDigest: InputDigest = computeInputDigest(boundedInput.value);
    digestPrefixValue = digestPrefix(inputDigest);

    if (tool.idempotencySupport === 'keyed' && request.idempotencyKey === null)
      return failure(request.invocationId, request.toolId, {
        code: 'invalid-input',
        reason: 'Idempotency key is required for this tool.',
        executionState: 'not-started',
      });

    let connectionActive = true;
    let capabilityAllowed = true;
    let secretMetadata: SecretReferenceMetadata | null = null;

    if (tool.accountRequirement === 'required') {
      if (request.connectionId === null)
        return failure(request.invocationId, request.toolId, {
          code: 'connection-not-found',
          reason: 'Connection is required.',
          executionState: 'not-started',
        });
      const connection = deps.connectionRegistry.get(request.connectionId);
      if (connection === null)
        return failure(request.invocationId, request.toolId, {
          code: 'connection-not-found',
          reason: 'Connection is not registered.',
          executionState: 'not-started',
        });
      if (connection.connectorId !== tool.connectorId)
        return failure(request.invocationId, request.toolId, {
          code: 'connection-not-found',
          reason: 'Connection connector mismatch.',
          executionState: 'not-started',
        });
      if (connection.status !== 'active')
        return failure(request.invocationId, request.toolId, {
          code: 'connection-not-found',
          reason: 'Connection is not active.',
          executionState: 'not-started',
        });
      connectionActive = true;
      capabilityAllowed = connection.allowedCapabilities.includes(tool.capability);
      if (!capabilityAllowed)
        return failure(request.invocationId, request.toolId, {
          code: 'capability-denied',
          reason: 'Capability is not allowed for this connection.',
          executionState: 'not-started',
        });
      if (connection.secretReference !== null)
        secretMetadata = {
          secretReferenceId: connection.secretReference.secretReferenceId,
          connectorId: connection.secretReference.connectorId,
        };
    }

    const policyDecision = deps.policyEngine.evaluate(
      {
        invocationId: request.invocationId,
        toolId: request.toolId,
        connectorId,
        connectionId: request.connectionId,
        sideEffectClass: tool.sideEffectClass,
        capability: tool.capability,
        connectionActive,
        capabilityAllowed,
        cancellationSupport: tool.cancellationSupport,
      },
      context,
    );

    await audit(
      deps,
      auditEvent({
        kind: 'policy-decision',
        outcome:
          policyDecision.decision === 'allow'
            ? 'allow'
            : policyDecision.decision === 'deny'
              ? 'deny'
              : 'require-approval',
        errorCode: policyDecision.decision === 'deny' ? 'policy-denied' : null,
      }),
      context,
    );

    if (policyDecision.decision === 'deny')
      return failure(request.invocationId, request.toolId, {
        code: 'policy-denied',
        reason: policyDecision.reason.slice(0, 256),
        executionState: 'not-started',
      });

    const requestBinding: ToolApprovalRequestBinding = {
      invocationId: request.invocationId,
      toolId: request.toolId,
      connectorId,
      connectionId: request.connectionId,
      inputDigest,
      sideEffectClass: tool.sideEffectClass,
      expiresAt: iso8601FromDate(new Date(deps.clock.now().getTime() + 300_000)),
      requestingActorId: context.actorId,
    };

    if (policyDecision.decision === 'require-approval') {
      if (request.approvalId === null) {
        const created = await deps.approvalPort.createRequest(requestBinding, context);
        await audit(
          deps,
          auditEvent({
            kind: 'approval-decision',
            outcome: 'require-approval',
            errorCode: 'approval-required',
          }),
          context,
        );
        if (!created.ok)
          return failure(request.invocationId, request.toolId, {
            code: 'approval-denied',
            reason: created.error.reason.slice(0, 256),
            executionState: 'not-started',
          });
        return {
          kind: 'approval-required',
          invocationId: request.invocationId,
          toolId: request.toolId,
          approvalRequest: {
            approvalId: created.value.approvalId,
            nonce: created.value.binding.nonce,
            invocationId: request.invocationId,
            toolId: request.toolId,
            connectorId,
            connectionId: request.connectionId,
            inputDigest,
            sideEffectClass: tool.sideEffectClass,
            expiresAt: requestBinding.expiresAt,
          },
        };
      }
      if (request.approvalNonce === null)
        return failure(request.invocationId, request.toolId, {
          code: 'approval-denied',
          reason: 'Approval nonce is required.',
          executionState: 'not-started',
        });
      const consumeBinding = {
        ...requestBinding,
        approvingActorId: null,
        nonce: request.approvalNonce,
      };
      const consumed = await deps.approvalPort.consumeGrant(
        request.approvalId,
        request.approvalNonce,
        consumeBinding,
        context,
      );
      await audit(
        deps,
        auditEvent({
          kind: 'approval-decision',
          outcome: consumed.ok ? 'allow' : 'deny',
          errorCode: consumed.ok ? null : 'approval-denied',
        }),
        context,
      );
      if (!consumed.ok) {
        const code =
          consumed.error.code === 'EXPIRED'
            ? 'approval-expired'
            : consumed.error.code === 'NOT_GRANTED' || consumed.error.code === 'DENIED'
              ? 'approval-denied'
              : 'approval-denied';
        return failure(request.invocationId, request.toolId, {
          code,
          reason: consumed.error.reason.slice(0, 256),
          executionState: 'not-started',
        });
      }
    }

    if (context.signal.aborted) {
      await audit(
        deps,
        auditEvent({ kind: 'invocation-completed', outcome: 'failure', errorCode: 'cancelled' }),
        context,
      );
      return failure(request.invocationId, request.toolId, {
        code: 'cancelled',
        reason: 'Execution was cancelled.',
        executionState: 'not-started',
      });
    }

    const connector = deps.connectorExecution.getConnector(tool.connectorId);
    if (connector === null)
      return failure(request.invocationId, request.toolId, {
        code: 'connector-unavailable',
        reason: 'Connector runtime is unavailable.',
        executionState: 'not-started',
      });

    const timeoutMs = effectiveTimeout(tool.timeoutMs, request.timeoutOverrideMs);
    const timeoutController = new AbortController();
    const onCallerAbort = (): void => {
      timeoutController.abort(context.signal.reason ?? 'cancelled');
    };
    context.signal.addEventListener('abort', onCallerAbort, { once: true });
    const timeoutId = setTimeout(() => {
      timeoutController.abort('timeout');
    }, timeoutMs);

    const startAudit = await audit(
      deps,
      auditEvent({ kind: 'execution-started', outcome: 'unknown', errorCode: null }),
      context,
    );
    if (startAudit !== null) {
      clearTimeout(timeoutId);
      context.signal.removeEventListener('abort', onCallerAbort);
      return failure(request.invocationId, request.toolId, startAudit);
    }

    let secretHandle = null as import('../../domain/connector/secret.js').OpaqueSecretHandle | null;
    if (secretMetadata !== null) {
      const resolved = await deps.secretProvider.resolveHandle(secretMetadata, context);
      if (!resolved.ok) {
        clearTimeout(timeoutId);
        context.signal.removeEventListener('abort', onCallerAbort);
        return failure(request.invocationId, request.toolId, {
          code: 'secret-unavailable',
          reason: resolved.error.reason.slice(0, 256),
          executionState: 'started',
        });
      }
      secretHandle = resolved.value;
    }

    const executeRequest = {
      tool,
      input: boundedInput.value,
      secretHandle,
      idempotencyKey: request.idempotencyKey,
      signal: timeoutController.signal,
      context: { connectorId, invocationLabel: request.invocationId },
    };

    const executionPromise = connector
      .execute(executeRequest)
      .then((result) => result)
      .catch((): ConnectorExecutionResult => ({
        ok: false,
        error: {
          code: 'unavailable',
          reason: 'Connector execution failed.',
          category: 'internal',
        },
      }));

    const abortPromise = new Promise<'aborted'>((resolve) => {
      if (timeoutController.signal.aborted) {
        resolve('aborted');
        return;
      }
      timeoutController.signal.addEventListener(
        'abort',
        () => {
          resolve('aborted');
        },
        { once: true },
      );
    });

    const race = await Promise.race([
      executionPromise.then((connectorResult) => ({ kind: 'done' as const, connectorResult })),
      abortPromise.then(() => ({ kind: 'aborted' as const })),
    ]);

    clearTimeout(timeoutId);
    context.signal.removeEventListener('abort', onCallerAbort);

    if (race.kind === 'aborted') {
      absorbLateCompletion(executionPromise);
      const mapped = mapAbortedExecution(timeoutController.signal, tool.sideEffectClass);
      updateHealth(deps, connectorId, request.connectionId, mapped.health);
      await audit(
        deps,
        auditEvent({ kind: 'execution-finished', outcome: 'failure', errorCode: mapped.code }),
        context,
      );
      const completionAudit = await audit(
        deps,
        auditEvent({ kind: 'invocation-completed', outcome: 'failure', errorCode: mapped.code }),
        context,
      );
      if (completionAudit !== null)
        return failure(request.invocationId, request.toolId, completionAudit);
      return failure(request.invocationId, request.toolId, mapped);
    }

    const connectorResult = race.connectorResult;

    if (!connectorResult.ok) {
      const mapped = mapConnectorFailure(
        connectorResult.error,
        timeoutController.signal,
        tool.sideEffectClass,
      );
      updateHealth(deps, connectorId, request.connectionId, mapped.health);
      await audit(
        deps,
        auditEvent({ kind: 'execution-finished', outcome: 'failure', errorCode: mapped.code }),
        context,
      );
      const completionAudit = await audit(
        deps,
        auditEvent({ kind: 'invocation-completed', outcome: 'failure', errorCode: mapped.code }),
        context,
      );
      if (completionAudit !== null)
        return failure(request.invocationId, request.toolId, completionAudit);
      return failure(request.invocationId, request.toolId, mapped);
    }

    if (timeoutController.signal.aborted) {
      absorbLateCompletion(Promise.resolve(connectorResult));
      const mapped = mapAbortedExecution(timeoutController.signal, tool.sideEffectClass);
      updateHealth(deps, connectorId, request.connectionId, mapped.health);
      await audit(
        deps,
        auditEvent({ kind: 'execution-finished', outcome: 'failure', errorCode: mapped.code }),
        context,
      );
      const completionAudit = await audit(
        deps,
        auditEvent({ kind: 'invocation-completed', outcome: 'failure', errorCode: mapped.code }),
        context,
      );
      if (completionAudit !== null)
        return failure(request.invocationId, request.toolId, completionAudit);
      return failure(request.invocationId, request.toolId, mapped);
    }

    const boundedOutput = boundConnectorOutput(connectorResult.output);
    if (!boundedOutput.ok) {
      const error: ToolExecutionError = {
        code: 'invalid-remote-response',
        reason: 'Connector output failed platform bounds.',
        executionState: 'completed',
      };
      updateHealth(deps, connectorId, request.connectionId, {
        status: 'degraded',
        failureCategory: 'invalid-response',
      });
      await audit(
        deps,
        auditEvent({ kind: 'execution-finished', outcome: 'failure', errorCode: error.code }),
        context,
      );
      const completionAudit = await audit(
        deps,
        auditEvent({ kind: 'invocation-completed', outcome: 'failure', errorCode: error.code }),
        context,
      );
      if (completionAudit !== null)
        return failure(request.invocationId, request.toolId, completionAudit);
      return failure(request.invocationId, request.toolId, error);
    }

    const outputValidation = validateJsonAgainstSchema(tool.outputSchema, boundedOutput.value);
    if (!outputValidation.ok) {
      const error: ToolExecutionError = {
        code: 'invalid-remote-response',
        reason: redactSchemaFailure(outputValidation.error).slice(0, 256),
        executionState: 'completed',
      };
      updateHealth(deps, connectorId, request.connectionId, {
        status: 'degraded',
        failureCategory: 'invalid-response',
      });
      await audit(
        deps,
        auditEvent({ kind: 'execution-finished', outcome: 'failure', errorCode: error.code }),
        context,
      );
      const completionAudit = await audit(
        deps,
        auditEvent({ kind: 'invocation-completed', outcome: 'failure', errorCode: error.code }),
        context,
      );
      if (completionAudit !== null)
        return failure(request.invocationId, request.toolId, completionAudit);
      return failure(request.invocationId, request.toolId, error);
    }

    updateHealth(deps, connectorId, request.connectionId, {
      status: 'healthy',
      failureCategory: 'none',
    });
    await audit(
      deps,
      auditEvent({ kind: 'execution-finished', outcome: 'success', errorCode: null }),
      context,
    );
    const completionAudit = await audit(
      deps,
      auditEvent({ kind: 'invocation-completed', outcome: 'success', errorCode: null }),
      context,
    );
    if (completionAudit !== null)
      return failure(request.invocationId, request.toolId, {
        ...completionAudit,
        executionState: 'outcome-unknown',
      });

    return {
      kind: 'success',
      invocationId: request.invocationId,
      toolId: request.toolId,
      output: boundedOutput.value,
      contentTrust: 'untrusted',
      bounded: true,
    };
  },
});

export type ToolInvocationOrchestrator = ReturnType<typeof createToolInvocationOrchestrator>;
