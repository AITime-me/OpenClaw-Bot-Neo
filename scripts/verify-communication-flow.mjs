import { existsSync, readFileSync } from 'node:fs';

const failures = [];

const required = [
  'src/core/communication/application/communication-orchestrator.ts',
  'src/core/communication/application/per-conversation-turn-dispatcher.ts',
  'src/core/communication/application/recover-communication-turns.service.ts',
  'src/core/communication/application/process-text-turn.service.ts',
  'src/core/communication/application/index.ts',
  'src/communication/reference/create-reference-text-slice.ts',
  'src/communication/reference/reference-llm-completion.ts',
  'src/communication/reference/reference-text-delivery.ts',
];

for (const path of required) {
  if (!existsSync(path)) failures.push(`MISSING_FLOW_MODULE: ${path}`);
}

const orchestrator = 'src/core/communication/application/communication-orchestrator.ts';
if (existsSync(orchestrator)) {
  const source = readFileSync(orchestrator, 'utf8');
  if (!/recoverCommunicationTurns/.test(source))
    failures.push('FLOW: orchestrator must invoke fail-safe recovery before ingress.');
  if (!/ingressEnabled/.test(source))
    failures.push('FLOW: orchestrator must gate ingress behind recovery success.');
  if (!/createPerConversationTurnDispatcher/.test(source))
    failures.push('FLOW: orchestrator must use per-conversation FIFO dispatcher.');
}

const recovery = 'src/core/communication/application/recover-communication-turns.service.ts';
if (existsSync(recovery)) {
  const source = readFileSync(recovery, 'utf8');
  if (/issueAuthenticatedCommunicationPrincipal|sealValidatedTextOutput/.test(source))
    failures.push('FLOW: recovery must not rehydrate principal or ValidatedTextOutput.');
  if (!/readDeliveryOutcome/.test(source))
    failures.push('FLOW: recovery must use read-only outbox outcome lookup.');
  if (!/LLM_OUTCOME_UNKNOWN|outcome-unknown/.test(source))
    failures.push('FLOW: recovery must handle llm_started without durable result as unknown.');
}

const queue = 'src/core/communication/application/reference-queue-config.ts';
if (existsSync(queue)) {
  const source = readFileSync(queue, 'utf8');
  if (!/maxGlobalPending:\s*64/.test(source) || !/maxDepthPerConversation:\s*8/.test(source))
    failures.push('FLOW: reference queueConfig must be explicit 8/64.');
}

const forbiddenLive = [
  'src/communication/adapters',
  'src/neo-runtime/production/create-production-text-communication.ts',
];
for (const path of forbiddenLive) {
  if (existsSync(path))
    failures.push(`FLOW_FORBIDDEN_LIVE: ${path} must remain absent in Build 3.7D.`);
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Communication flow checks passed.');
