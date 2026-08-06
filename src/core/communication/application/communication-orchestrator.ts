import type { OperationContext } from '../../domain/operation-context.js';
import type { PolicyVersion } from '../../domain/identity.js';
import { ok, type Result } from '../../domain/result.js';
import { communicationError, type CommunicationError } from '../domain/communication-errors.js';
import {
  deriveCommunicationIdempotencyKey,
  parseCommunicationBindingVersion,
  parseTransportInstanceId,
  type TurnRevision,
} from '../domain/communication-identity.js';
import { parseTransportTextObservation } from '../domain/transport-text-observation.js';
import { issueAuthenticatedCommunicationPrincipal } from '../domain/authenticated-communication-principal.internal.js';
import type { CommunicationTurnLedgerPort } from '../ports/communication-turn-ledger.port.js';
import type { CommunicationAuditPort } from '../ports/communication-audit.port.js';
import type { CommunicationDeliveryOutboxPort } from '../ports/communication-delivery-outbox.port.js';
import type { ConversationStatePort } from '../ports/conversation-state.port.js';
import type { CommunicationIdentityBindingPort } from '../ports/communication-identity-binding.port.js';
import type { CommunicationIdGeneratorPort } from '../ports/communication-id-generator.port.js';
import type { LlmCompletionPort } from '../ports/llm-completion.port.js';
import type { TextDeliveryPort } from '../ports/text-delivery.port.js';
import type { CommunicationMemoryAuthorizationPort } from '../ports/communication-memory-authorization.port.js';
import type { CommunicationKillSwitchPort } from '../ports/communication-kill-switch.port.js';
import type { SensitiveDataScannerPort } from '../../ports/sensitive-data-scanner.port.js';
import type { CommunicationQueueConfig } from '../domain/communication-turn.js';
import {
  createCommunicationRuntimeDiagnostics,
  type CommunicationRuntimeDiagnostics,
  type CommunicationRuntimeLifecycle,
} from './communication-runtime-diagnostics.js';
import { createPerConversationTurnDispatcher } from './per-conversation-turn-dispatcher.js';
import { recoverCommunicationTurns } from './recover-communication-turns.service.js';
import { processTextTurn } from './process-text-turn.service.js';
import { parseISO8601 } from '../../domain/identity.js';
import {
  tryAcquireCommunicationRuntimeOwnership,
  type CommunicationRuntimeOwnershipHandle,
} from './communication-runtime-ownership.js';
import { createConversationAdmissionSerializer } from './conversation-admission-serializer.js';

export type CommunicationOrchestratorDeps = {
  readonly ledger: CommunicationTurnLedgerPort;
  readonly audit: CommunicationAuditPort;
  readonly outbox: CommunicationDeliveryOutboxPort;
  readonly conversationState: ConversationStatePort;
  readonly binding: CommunicationIdentityBindingPort;
  readonly ids: CommunicationIdGeneratorPort;
  readonly llm: LlmCompletionPort;
  readonly delivery: TextDeliveryPort;
  readonly memory: CommunicationMemoryAuthorizationPort;
  readonly killSwitch: CommunicationKillSwitchPort;
  readonly scanner: SensitiveDataScannerPort;
  readonly queueConfig: CommunicationQueueConfig;
  /** Must match effective ports.queueConfig by object identity for verified composition. */
  readonly expectedQueueConfig?: CommunicationQueueConfig;
  readonly ownershipKey: string;
  readonly policyVersion: PolicyVersion;
  readonly transportInstanceId: string;
  readonly bindingVersion: string;
  readonly defaultDeadlineMs?: number;
};

export type CommunicationOrchestrator = {
  readonly start: (
    operationContext: OperationContext,
  ) => Promise<Result<{ readonly recovered: number }, CommunicationError>>;
  readonly submitObservation: (
    observation: unknown,
    operationContext: OperationContext,
  ) => Promise<
    Result<{ readonly accepted: true } | { readonly duplicate: true }, CommunicationError>
  >;
  readonly whenIdle: () => Promise<void>;
  readonly beginDrain: () => void;
  readonly close: () => Promise<Result<void, CommunicationError>>;
  readonly diagnostics: () => CommunicationRuntimeDiagnostics;
  readonly sideEffects: { llmCalls: number; deliveryCalls: number; memoryCalls: number };
};

/**
 * Channel-independent offline communication orchestrator (Build 3.7D corrective).
 */
export const createCommunicationOrchestrator = (
  deps: CommunicationOrchestratorDeps,
): CommunicationOrchestrator => {
  if (deps.expectedQueueConfig !== undefined && deps.expectedQueueConfig !== deps.queueConfig) {
    throw new TypeError(
      'Orchestrator queueConfig identity mismatch with expectedQueueConfig (fail closed).',
    );
  }

  let lifecycle: CommunicationRuntimeLifecycle = 'new';
  let ingressEnabled = false;
  let generation = 0;
  let ownership: CommunicationRuntimeOwnershipHandle | null = null;
  const sideEffects = { llmCalls: 0, deliveryCalls: 0, memoryCalls: 0 };
  const dispatcher = createPerConversationTurnDispatcher(deps.queueConfig);
  const admission = createConversationAdmissionSerializer();
  const transportInstanceId = parseTransportInstanceId(deps.transportInstanceId);
  const bindingVersion = parseCommunicationBindingVersion(deps.bindingVersion);
  if (!transportInstanceId.ok || !bindingVersion.ok)
    throw new TypeError('Orchestrator transport/binding identity is invalid.');

  const failRuntime = (): void => {
    lifecycle = 'failed';
    ingressEnabled = false;
    dispatcher.beginDrain();
    generation += 1;
  };

  const diagnostics = (): CommunicationRuntimeDiagnostics =>
    createCommunicationRuntimeDiagnostics({ lifecycle, ingressEnabled });

  const start = async (
    operationContext: OperationContext,
  ): Promise<Result<{ readonly recovered: number }, CommunicationError>> => {
    if (lifecycle !== 'new' && lifecycle !== 'failed')
      return {
        ok: false,
        error: communicationError('CONFIG_INVALID', 'Orchestrator already started.'),
      };
    lifecycle = 'recovering';
    ingressEnabled = false;

    if (ownership === null) {
      const acquired = tryAcquireCommunicationRuntimeOwnership(deps.ownershipKey);
      if (!acquired.ok) {
        lifecycle = 'failed';
        return acquired;
      }
      ownership = acquired.value;
    }

    const recovered = await recoverCommunicationTurns(
      {
        ledger: deps.ledger,
        outbox: deps.outbox,
        conversationState: deps.conversationState,
      },
      operationContext,
      sideEffects,
    );
    if (!recovered.ok) {
      lifecycle = 'failed';
      ingressEnabled = false;
      ownership.release();
      ownership = null;
      return recovered;
    }
    lifecycle = 'running';
    ingressEnabled = true;
    return ok({ recovered: recovered.value.recovered });
  };

  const submitObservation = async (
    rawObservation: unknown,
    operationContext: OperationContext,
  ): Promise<
    Result<{ readonly accepted: true } | { readonly duplicate: true }, CommunicationError>
  > => {
    if (!ingressEnabled || lifecycle !== 'running')
      return {
        ok: false,
        error: communicationError('CONFIG_INVALID', 'Ingress is disabled.'),
      };

    const observation = parseTransportTextObservation(rawObservation);
    if (!observation.ok)
      return {
        ok: false,
        error: communicationError('INVALID_OBSERVATION', observation.error.reason),
      };

    const turnId = deps.ids.generateTurnId();
    const correlationId = deps.ids.generateCorrelationId();
    if (!turnId.ok || !correlationId.ok)
      return {
        ok: false,
        error: communicationError('CONFIG_INVALID', 'ID generation failed.'),
      };

    const idempotencyKey = deriveCommunicationIdempotencyKey({
      transportInstanceId: transportInstanceId.value,
      externalConversationReference: observation.value.externalConversationReference,
      externalMessageReference: observation.value.externalMessageReference,
      bindingVersion: bindingVersion.value,
    });

    const observedAt = parseISO8601(new Date().toISOString());
    if (!observedAt.ok)
      return {
        ok: false,
        error: communicationError('CONFIG_INVALID', 'observedAt invalid.'),
      };

    const observed = await deps.ledger.observeTransportEvent(
      {
        idempotencyKey,
        transportInstanceId: transportInstanceId.value,
        turnId: turnId.value,
        observedAt: observedAt.value,
      },
      operationContext,
    );
    if (!observed.ok) return observed;
    if (observed.value.kind === 'duplicate-existing') return ok({ duplicate: true });
    if (observed.value.kind !== 'fresh-observed')
      return {
        ok: false,
        error: communicationError('LEDGER_UNAVAILABLE', observed.value.kind),
      };
    const freshObserved = observed.value;

    const binding = await deps.binding.resolveBinding(
      {
        observation: observation.value,
        transportInstanceId: transportInstanceId.value,
        bindingVersion: bindingVersion.value,
        idempotencyKey,
        admissionEvidence: freshObserved.admissionEvidence,
      },
      operationContext,
    );
    if (!binding.ok)
      return {
        ok: false,
        error: communicationError('AUTHENTICATION_UNCERTAIN', 'Binding failed.'),
      };
    if (binding.value.kind !== 'bound')
      return {
        ok: false,
        error: communicationError('AUTHENTICATION_REJECTED', binding.value.reason),
      };
    const bound = binding.value.binding;

    const principal = issueAuthenticatedCommunicationPrincipal({
      turnId: turnId.value,
      ownerId: bound.ownerId,
      actorId: bound.actorId,
      conversationId: bound.conversationId,
      transportInstanceId: transportInstanceId.value,
      bindingVersion: bindingVersion.value,
      observedAt: observedAt.value,
      admissionEvidence: freshObserved.admissionEvidence,
    });
    if (!principal.ok)
      return {
        ok: false,
        error: communicationError('AUTHENTICATION_REJECTED', principal.error.reason),
      };

    return admission.runExclusive(String(bound.conversationId), async () => {
      if (!ingressEnabled || lifecycle !== 'running')
        return {
          ok: false as const,
          error: communicationError('CONFIG_INVALID', 'Ingress is disabled.'),
        };

      let revision: number = Number(freshObserved.turnRevision);
      const auth = await deps.ledger.recordAuthenticationResult(
        {
          turnId: turnId.value,
          expectedRevision: freshObserved.turnRevision,
          correlationId: correlationId.value,
          outcome: { kind: 'authenticated', principal: principal.value },
        },
        operationContext,
      );
      if (!auth.ok) return auth;
      if (auth.value.kind !== 'recorded' && auth.value.kind !== 'already-recorded')
        return {
          ok: false as const,
          error: communicationError('LEDGER_UNAVAILABLE', auth.value.kind),
        };
      if (auth.value.kind === 'recorded') revision = Number(auth.value.turnRevision);

      const accepted = await deps.ledger.acceptConversationTurn(
        {
          turnId: turnId.value,
          expectedRevision: revision as never,
          correlationId: correlationId.value,
        },
        operationContext,
      );
      if (!accepted.ok) return accepted;
      if (accepted.value.kind === 'queue-full' || accepted.value.kind === 'global-queue-full')
        return {
          ok: false as const,
          error: communicationError(
            accepted.value.kind === 'queue-full' ? 'QUEUE_FULL' : 'GLOBAL_QUEUE_FULL',
            accepted.value.kind,
          ),
        };
      if (accepted.value.kind !== 'accepted' && accepted.value.kind !== 'already-accepted')
        return {
          ok: false as const,
          error: communicationError('LEDGER_UNAVAILABLE', accepted.value.kind),
        };
      const conversationSequence = Number(accepted.value.conversationSequence);
      if (accepted.value.kind === 'accepted') revision = Number(accepted.value.turnRevision);

      const queued = await deps.ledger.transition(
        {
          turnId: turnId.value,
          expectedRevision: revision as never,
          expectedState: 'accepted',
          targetState: 'queued',
          correlationId: correlationId.value,
        },
        operationContext,
      );
      if (!queued.ok) return queued;
      if (queued.value.kind === 'transitioned') revision = Number(queued.value.turnRevision);

      const jobGeneration = generation;
      const enqueued = dispatcher.enqueue({
        conversationId: bound.conversationId,
        conversationSequence,
        run: async () => {
          if (lifecycle === 'failed') return;
          let result: Result<
            { kind: 'completed' } | { kind: 'completed-blocked-by-gate' },
            CommunicationError
          >;
          try {
            result = await processTextTurn(
              {
                ledger: deps.ledger,
                audit: deps.audit,
                outbox: deps.outbox,
                conversationState: deps.conversationState,
                llm: deps.llm,
                delivery: deps.delivery,
                memory: deps.memory,
                scanner: deps.scanner,
                killSwitch: deps.killSwitch,
                isGenerationCurrent: (g) => g === generation,
                noteLlmCall: () => {
                  sideEffects.llmCalls += 1;
                },
                noteDeliveryCall: () => {
                  sideEffects.deliveryCalls += 1;
                },
                noteMemoryCall: () => {
                  sideEffects.memoryCalls += 1;
                },
              },
              {
                turnId: turnId.value,
                correlationId: correlationId.value,
                principal: principal.value,
                ownerId: bound.ownerId,
                conversationId: bound.conversationId,
                observation: observation.value,
                turnRevision: revision as TurnRevision,
                policyVersion: deps.policyVersion,
                abortSignal: AbortSignal.timeout(deps.defaultDeadlineMs ?? 5_000),
                deadlineMs: deps.defaultDeadlineMs ?? 5_000,
                generation: jobGeneration,
              },
              operationContext,
            );
          } catch {
            failRuntime();
            return;
          }
          if (!result.ok) failRuntime();
        },
      });
      if (!enqueued.ok)
        return {
          ok: false as const,
          error: communicationError(
            enqueued.reason === 'global-queue-full' ? 'GLOBAL_QUEUE_FULL' : 'QUEUE_FULL',
            enqueued.reason,
          ),
        };
      return ok({ accepted: true as const });
    });
  };

  const beginDrain = (): void => {
    ingressEnabled = false;
    if (lifecycle === 'running') lifecycle = 'draining';
    dispatcher.beginDrain();
    generation += 1;
  };

  const close = async (): Promise<Result<void, CommunicationError>> => {
    beginDrain();
    await dispatcher.whenIdle();
    lifecycle = 'closed';
    ingressEnabled = false;
    ownership?.release();
    ownership = null;
    return ok(undefined);
  };

  return {
    start,
    submitObservation,
    whenIdle: () => dispatcher.whenIdle(),
    beginDrain,
    close,
    diagnostics,
    sideEffects,
  };
};
