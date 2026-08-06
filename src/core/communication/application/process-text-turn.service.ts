import { createHash } from 'node:crypto';
import type { OperationContext } from '../../domain/operation-context.js';
import { ok, type Result } from '../../domain/result.js';
import { communicationError, type CommunicationError } from '../domain/communication-errors.js';
import { parseCommunicationIdempotencyKey } from '../domain/communication-identity.js';
import { parseISO8601 } from '../../domain/identity.js';
import { applyCommunicationKillSwitchPolicy } from '../policy/communication-kill-switch-policy.js';
import type {
  ProcessTextTurnDeps,
  ProcessTextTurnInput,
  ProcessTextTurnSuccess,
} from './process-text-turn.types.js';
import { evaluateConversationExecutionGate } from './phases/execution-gate.js';
import { executeAfterAuditStart } from './phases/execution-after-audit.js';

export type {
  ProcessTextTurnDeps,
  ProcessTextTurnInput,
  ProcessTextTurnSuccess,
} from './process-text-turn.types.js';

const hex64 = (seed: string): string => createHash('sha256').update(seed).digest('hex');

const mustIdempotency = (seed: string) => {
  const parsed = parseCommunicationIdempotencyKey(hex64(seed));
  if (!parsed.ok) throw new TypeError('idempotency');
  return parsed.value;
};

const transition = async (
  deps: ProcessTextTurnDeps,
  input: ProcessTextTurnInput,
  expectedRevision: number,
  expectedState: Parameters<ProcessTextTurnDeps['ledger']['transition']>[0]['expectedState'],
  targetState: Parameters<ProcessTextTurnDeps['ledger']['transition']>[0]['targetState'],
  operationContext: OperationContext,
): Promise<Result<number, CommunicationError>> => {
  const result = await deps.ledger.transition(
    {
      turnId: input.turnId,
      expectedRevision: expectedRevision as never,
      expectedState,
      targetState,
      correlationId: input.correlationId,
    },
    operationContext,
  );
  if (!result.ok) return result;
  if (result.value.kind === 'transitioned') return ok(Number(result.value.turnRevision));
  if (result.value.kind === 'already-transitioned') return ok(expectedRevision);
  return {
    ok: false,
    error: communicationError('LEDGER_UNAVAILABLE', result.value.kind),
  };
};

/**
 * Package-private text-turn processor. Coordinates typed phases; does not ignore phase Results.
 */
export const processTextTurn = async (
  deps: ProcessTextTurnDeps,
  input: ProcessTextTurnInput,
  operationContext: OperationContext,
): Promise<Result<ProcessTextTurnSuccess, CommunicationError>> => {
  const revision = Number(input.turnRevision);

  const killObs = await deps.killSwitch.readSnapshot(operationContext);
  if (!killObs.ok)
    return {
      ok: false,
      error: communicationError('CONFIG_INVALID', 'Kill switch unavailable.'),
    };
  const kill = applyCommunicationKillSwitchPolicy(killObs.value);
  if (!kill.ok || kill.value.kind !== 'eligible')
    return {
      ok: false,
      error: communicationError('LLM_DISABLED', 'Communication kill switch blocked the turn.'),
    };

  const startTs = parseISO8601(new Date().toISOString());
  if (!startTs.ok)
    return { ok: false, error: communicationError('CONFIG_INVALID', 'audit start timestamp') };

  const auditStart = await deps.audit.recordStart(
    {
      turnId: input.turnId,
      correlationId: input.correlationId,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      operationKind: 'text-turn',
      policyVersion: input.policyVersion,
      idempotencyKey: mustIdempotency(`audit-start-${String(input.turnId)}`),
      timestamp: startTs.value,
      redactedMetadata: { phase: 'start' },
    },
    operationContext,
  );
  if (!auditStart.ok) return auditStart;
  if (auditStart.value.kind === 'rejected' || auditStart.value.kind === 'unavailable')
    return {
      ok: false,
      error: communicationError('AUDIT_START_FAILED', auditStart.value.reason),
    };

  const gate = await evaluateConversationExecutionGate(
    deps.conversationState,
    { ownerId: input.ownerId, conversationId: input.conversationId },
    operationContext,
  );
  if (!gate.ok) return gate;
  if (gate.value.kind === 'blocked') {
    const cancelled = await transition(
      deps,
      input,
      revision,
      'queued',
      'cancelled',
      operationContext,
    );
    if (!cancelled.ok) return cancelled;
    const completed = await transition(
      deps,
      input,
      cancelled.value,
      'cancelled',
      'completed',
      operationContext,
    );
    if (!completed.ok) return completed;
    return ok({ kind: 'completed-blocked-by-gate' });
  }

  return executeAfterAuditStart(deps, input, revision, operationContext);
};
