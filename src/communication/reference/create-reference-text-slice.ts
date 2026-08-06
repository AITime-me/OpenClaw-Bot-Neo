import type { PolicyVersion } from '../../core/domain/identity.js';
import { parsePolicyVersion } from '../../core/domain/identity.js';
import type { SensitiveDataScannerPort } from '../../core/ports/sensitive-data-scanner.port.js';
import type { CommunicationTurnLedgerPort } from '../../core/communication/ports/communication-turn-ledger.port.js';
import type { CommunicationAuditPort } from '../../core/communication/ports/communication-audit.port.js';
import type { CommunicationDeliveryOutboxPort } from '../../core/communication/ports/communication-delivery-outbox.port.js';
import type { ConversationStatePort } from '../../core/communication/ports/conversation-state.port.js';
import type { CommunicationQueueConfig } from '../../core/communication/domain/communication-turn.js';
import {
  createCommunicationOrchestrator,
  type CommunicationOrchestrator,
} from '../../core/communication/application/communication-orchestrator.js';
import { REFERENCE_COMMUNICATION_QUEUE_CONFIG } from '../../core/communication/application/reference-queue-config.js';
import { createReferenceIdentityBinding } from './reference-identity-binding.js';
import {
  createReferenceLlmCompletion,
  type ReferenceLlmScenario,
} from './reference-llm-completion.js';
import {
  createReferenceTextDelivery,
  type ReferenceDeliveryScenario,
} from './reference-text-delivery.js';
import { createReferenceMemoryAuthorization } from './reference-memory-authorization.js';
import { createReferenceKillSwitch } from './reference-kill-switch.js';
import { createReferenceIdGenerator } from './reference-id-generator.js';

export type ReferenceOfflinePorts = {
  readonly ledger: CommunicationTurnLedgerPort;
  readonly audit: CommunicationAuditPort;
  readonly outbox: CommunicationDeliveryOutboxPort;
  readonly conversationState: ConversationStatePort;
  readonly ownershipKey: string;
  readonly queueConfig: CommunicationQueueConfig;
};

export type ReferenceTextSliceOptions = {
  readonly ports: ReferenceOfflinePorts;
  readonly scanner: SensitiveDataScannerPort;
  readonly llmScenario?: ReferenceLlmScenario;
  readonly deliveryScenario?: ReferenceDeliveryScenario;
  readonly policyVersion?: PolicyVersion;
  readonly transportInstanceId?: string;
  readonly bindingVersion?: string;
};

export type ReferenceTextSlice = {
  readonly orchestrator: CommunicationOrchestrator;
  readonly queueConfig: typeof REFERENCE_COMMUNICATION_QUEUE_CONFIG;
  readonly llm: ReturnType<typeof createReferenceLlmCompletion>;
  readonly delivery: ReturnType<typeof createReferenceTextDelivery>;
  readonly killSwitch: ReturnType<typeof createReferenceKillSwitch>;
};

/**
 * Verified offline reference composition (Build 3.7D corrective).
 * Requires ports opened with the same frozen REFERENCE_COMMUNICATION_QUEUE_CONFIG object.
 */
export const createVerifiedOfflineReferenceComposition = (
  options: ReferenceTextSliceOptions,
): ReferenceTextSlice => createReferenceTextSlice(options);

/**
 * Offline reference composition for Build 3.7D.
 * Fail-closed unless ports.queueConfig is the identical REFERENCE_COMMUNICATION_QUEUE_CONFIG object.
 */
export const createReferenceTextSlice = (
  options: ReferenceTextSliceOptions,
): ReferenceTextSlice => {
  const queueConfig = REFERENCE_COMMUNICATION_QUEUE_CONFIG;
  if (options.ports.queueConfig !== queueConfig) {
    throw new TypeError(
      'Reference composition requires ports opened with REFERENCE_COMMUNICATION_QUEUE_CONFIG identity.',
    );
  }
  if (typeof options.ports.ownershipKey !== 'string' || options.ports.ownershipKey.length === 0) {
    throw new TypeError('Reference composition requires ports.ownershipKey.');
  }

  const llm = createReferenceLlmCompletion(options.llmScenario ?? 'completed');
  const delivery = createReferenceTextDelivery(options.deliveryScenario ?? 'delivered');
  const killSwitch = createReferenceKillSwitch();
  const policyVersion =
    options.policyVersion ??
    (() => {
      const parsed = parsePolicyVersion('1.0.0');
      if (!parsed.ok) throw new TypeError('policy');
      return parsed.value;
    })();

  const orchestrator = createCommunicationOrchestrator({
    ledger: options.ports.ledger,
    audit: options.ports.audit,
    outbox: options.ports.outbox,
    conversationState: options.ports.conversationState,
    binding: createReferenceIdentityBinding(),
    ids: createReferenceIdGenerator(),
    llm,
    delivery,
    memory: createReferenceMemoryAuthorization(),
    killSwitch,
    scanner: options.scanner,
    queueConfig,
    expectedQueueConfig: options.ports.queueConfig,
    ownershipKey: options.ports.ownershipKey,
    policyVersion,
    transportInstanceId: options.transportInstanceId ?? 'transport-ref-1',
    bindingVersion: options.bindingVersion ?? 'binding-v1',
  });

  return Object.freeze({
    orchestrator,
    queueConfig,
    llm,
    delivery,
    killSwitch,
  });
};

export { REFERENCE_COMMUNICATION_QUEUE_CONFIG };
