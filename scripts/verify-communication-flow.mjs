import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const failures = [];

const required = [
  'src/core/communication/application/communication-orchestrator.ts',
  'src/core/communication/application/per-conversation-turn-dispatcher.ts',
  'src/core/communication/application/recover-communication-turns.service.ts',
  'src/core/communication/application/process-text-turn.service.ts',
  'src/core/communication/application/phases/execution-gate.ts',
  'src/core/communication/application/phases/execution-after-audit.ts',
  'src/core/communication/application/phases/delivery-finalization.ts',
  'src/core/communication/application/phases/unknown-terminalization.ts',
  'src/core/communication/application/phases/checkpoint-finalization.ts',
  'src/core/communication/application/communication-runtime-ownership.ts',
  'src/communication/reference/create-reference-text-slice.ts',
];

for (const path of required) {
  if (!existsSync(path)) failures.push(`MISSING_FLOW_MODULE: ${path}`);
}

const parseSource = (path) => {
  const source = readFileSync(path, 'utf8');
  return {
    source,
    sourceFile: ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  };
};

const collectCalls = (sourceFile, name) => {
  const hits = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === name
    ) {
      hits.push(node.getStart(sourceFile));
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      hits.push(node.getStart(sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hits;
};

const processPath = 'src/core/communication/application/process-text-turn.service.ts';
const executionAfterAuditPath =
  'src/core/communication/application/phases/execution-after-audit.ts';
const deliveryFinalizationPath =
  'src/core/communication/application/phases/delivery-finalization.ts';
if (existsSync(processPath)) {
  const { source, sourceFile } = parseSource(processPath);
  if (!source.includes('evaluateConversationExecutionGate'))
    failures.push('FLOW: process-text-turn must invoke execution gate before memory/LLM.');
  if (!source.includes('executeAfterAuditStart'))
    failures.push('FLOW: process-text-turn must delegate post-audit execution to a typed phase.');
  const gateHits = collectCalls(sourceFile, 'evaluateConversationExecutionGate');
  const memoryHits = collectCalls(sourceFile, 'readAuthorizedContext');
  const llmHits = collectCalls(sourceFile, 'complete');
  if (gateHits.length === 0)
    failures.push('FLOW AST: missing evaluateConversationExecutionGate call.');
  if (
    memoryHits.length > 0 &&
    gateHits.length > 0 &&
    Math.min(...memoryHits) < Math.min(...gateHits)
  )
    failures.push('FLOW AST: memory readAuthorizedContext must not precede execution gate.');
  if (llmHits.length > 0 && gateHits.length > 0 && Math.min(...llmHits) < Math.min(...gateHits))
    failures.push('FLOW AST: llm.complete must not precede execution gate.');
}
if (existsSync(executionAfterAuditPath)) {
  const { source } = parseSource(executionAfterAuditPath);
  if (!source.includes('finalizeLlmOutcomeUnknown'))
    failures.push(
      'FLOW: execution-after-audit must route post-start LLM failures through unknown terminalization.',
    );
  if (!source.includes('finalizeDeliveryAfterValidatedOutput'))
    failures.push('FLOW: execution-after-audit must hand off to delivery finalization.');
  if (source.includes('evaluateConversationExecutionGate'))
    failures.push('FLOW: execution gate must remain before execution-after-audit (not inside it).');
}
if (existsSync(deliveryFinalizationPath)) {
  const { source } = parseSource(deliveryFinalizationPath);
  if (!source.includes('finalizeDeliveryOutcomeUnknown'))
    failures.push(
      'FLOW: delivery-finalization must route post-start delivery failures through unknown terminalization.',
    );
  if (!source.includes('finalizeCheckpointAfterDelivery'))
    failures.push('FLOW: delivery-finalization must finalize checkpoint outcomes after delivery.');
}

const checkpointPath = 'src/core/communication/application/phases/checkpoint-finalization.ts';
if (existsSync(checkpointPath)) {
  const { source } = parseSource(checkpointPath);
  if (!source.includes('barrier-active') && !source.includes('stale-revision'))
    failures.push('FLOW: checkpoint-finalization must handle non-success checkpoint outcomes.');
  if (!source.includes('checkpoint-failed'))
    failures.push('FLOW: checkpoint failure must record checkpoint-failed barrier.');
}

const dispatcherPath = 'src/core/communication/application/per-conversation-turn-dispatcher.ts';
if (existsSync(dispatcherPath)) {
  const { source } = parseSource(dispatcherPath);
  if (!source.includes('conversationSequence'))
    failures.push('FLOW: dispatcher jobs must carry trusted conversationSequence.');
  if (!source.includes('globalPending'))
    failures.push('FLOW: dispatcher must track global pending (queued+active), not only active.');
}

const recoveryPath = 'src/core/communication/application/recover-communication-turns.service.ts';
if (existsSync(recoveryPath)) {
  const { source } = parseSource(recoveryPath);
  if (!/PAGE_LIMIT|limit:\s*PAGE_LIMIT|limit:\s*100/.test(source))
    failures.push('FLOW: recovery must paginate listRecoveryCandidates.');
  if (!source.includes('recordDurableCheckpointBarrier') && !source.includes('requireBarrier'))
    failures.push('FLOW: recovery must not ignore barrier write results.');
}

const outboxPath =
  'src/host/storage/sqlite/communication/sqlite-communication-delivery-outbox-port.ts';
if (existsSync(outboxPath)) {
  const { source, sourceFile } = parseSource(outboxPath);
  let readMethod = null;
  const visit = (node) => {
    if (
      ts.isMethodDeclaration(node) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'readDeliveryOutcome'
    ) {
      readMethod = node.getText(sourceFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (readMethod === null) failures.push('FLOW: readDeliveryOutcome method missing.');
  else if (readMethod.includes('scrubBeforeMethod'))
    failures.push('FLOW: readDeliveryOutcome must not call scrubBeforeMethod (read-only).');
  if (
    !source.includes('Strictly read-only') &&
    readMethod &&
    readMethod.includes('scrubBeforeMethod')
  )
    failures.push('FLOW: outbox lookup scrub regression.');
}

const queue = 'src/core/communication/application/reference-queue-config.ts';
if (existsSync(queue)) {
  const source = readFileSync(queue, 'utf8');
  if (!/maxGlobalPending:\s*64/.test(source) || !/maxDepthPerConversation:\s*8/.test(source))
    failures.push('FLOW: reference queueConfig must be explicit 8/64.');
}

const reference = 'src/communication/reference/create-reference-text-slice.ts';
if (existsSync(reference)) {
  const source = readFileSync(reference, 'utf8');
  if (!source.includes('ports.queueConfig !== queueConfig'))
    failures.push('FLOW: reference composition must identity-check queueConfig.');
  if (!source.includes('ownershipKey'))
    failures.push('FLOW: reference composition must pass ownershipKey.');
}

const forbiddenLive = ['src/neo-runtime/production/create-production-text-communication.ts'];
for (const path of forbiddenLive) {
  if (existsSync(path))
    failures.push(`FLOW_FORBIDDEN_LIVE: ${path} must remain absent until production composition.`);
}

const adaptersRoot = 'src/communication/adapters';
if (existsSync(adaptersRoot)) {
  for (const name of readdirSync(adaptersRoot)) {
    if (name !== 'codex-app-server')
      failures.push(
        `FLOW_FORBIDDEN_ADAPTER: src/communication/adapters/${name} is not authorized.`,
      );
  }
  if (!existsSync('src/communication/adapters/codex-app-server/create-codex-app-server-route.ts'))
    failures.push('FLOW: missing create-codex-app-server-route.ts for Build 3.7E1.');
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Communication flow checks passed.');
