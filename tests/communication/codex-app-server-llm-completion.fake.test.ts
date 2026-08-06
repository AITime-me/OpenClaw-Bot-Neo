import { describe, expect, it } from 'vitest';
import { createCodexAppServerLlmCompletion } from '../../src/communication/adapters/codex-app-server/codex-app-server-llm-completion.js';
import { createFakeCodexAppServerTransport } from '../../src/communication/adapters/codex-app-server/fake/fake-codex-app-server.js';
import { createCodexAppServerRoute } from '../../src/communication/adapters/codex-app-server/create-codex-app-server-route.js';
import { operationContext } from '../support/fixtures.js';
import type { LlmCompletionRequest } from '../../src/core/communication/domain/llm-completion.js';
import type { TextPrompt } from '../../src/core/communication/domain/text-prompt.js';
import {
  parseConversationId,
  parseTurnId,
} from '../../src/core/communication/domain/communication-identity.js';
import {
  parseCorrelationId,
  parseOwnerId,
  parsePolicyVersion,
} from '../../src/core/domain/index.js';

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!result.ok) throw new Error('parse failed');
  return result.value;
};

const stubPrompt = (): TextPrompt => {
  const ownerId = must(parseOwnerId('owner_test'));
  const conversationId = must(parseConversationId('conv_test'));
  const section = {
    kind: 'owner-text' as const,
    title: 't',
    body: 'ignored-for-probe',
    instructionsExecutable: false,
    trust: 'trusted-fixed' as const,
  };
  return {
    ownerId,
    conversationId,
    policyVersion: must(parsePolicyVersion('1')),
    sections: [section, section, section, section, section],
    totalUtf8Bytes: 1,
  };
};

const request = (): LlmCompletionRequest => ({
  prompt: stubPrompt(),
  turnId: must(parseTurnId('turn_test')),
  correlationId: must(parseCorrelationId('00000000-0000-4000-8000-000000000001')),
  conversationId: must(parseConversationId('conv_test')),
  ownerId: must(parseOwnerId('owner_test')),
  deadlineMs: 5_000,
  abortSignal: null,
});

describe('codex-app-server llm completion fake', () => {
  it('completes happy-path via fake transport without sqlite persistence hooks', async () => {
    const fake = createFakeCodexAppServerTransport('happy-path');
    const llm = createCodexAppServerLlmCompletion({
      transport: fake.transport,
      timeouts: { turnTimeoutMs: 500, preflightTimeoutMs: 500 },
    });
    const result = await llm.complete(request(), operationContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe('completed');
  });

  it('createCodexAppServerRoute exposes probe-only llm port', async () => {
    const fake = createFakeCodexAppServerTransport('account-null');
    const route = createCodexAppServerRoute(
      {
        pin: {
          absolutePath: '/tmp/does-not-matter',
          version: '0',
          sha256: '0'.repeat(64),
          argv: ['app-server'],
        },
        codexHome: '/tmp/neo-codex-home',
      },
      { transport: fake.transport },
    );
    const result = await route.llm.complete(request(), operationContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe('provider-unavailable');
  });
});
