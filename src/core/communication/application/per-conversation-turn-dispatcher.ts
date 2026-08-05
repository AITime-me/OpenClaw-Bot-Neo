import type { CommunicationQueueConfig } from '../domain/communication-turn.js';
import type { ConversationId } from '../domain/communication-identity.js';

export type DispatcherJob = {
  readonly conversationId: ConversationId;
  readonly run: () => Promise<void>;
};

/**
 * Per-conversation FIFO dispatcher: at most one active turn per conversation;
 * different conversations may run in parallel. Bounded by shared queueConfig.
 */
export const createPerConversationTurnDispatcher = (queueConfig: CommunicationQueueConfig) => {
  const queues = new Map<string, DispatcherJob[]>();
  const active = new Map<string, boolean>();
  let globalActive = 0;
  let draining = false;
  const waiters: Array<() => void> = [];

  const notifyIdle = (): void => {
    if (globalActive === 0 && [...queues.values()].every((q) => q.length === 0)) {
      while (waiters.length > 0) waiters.shift()?.();
    }
  };

  const pump = (conversationKey: string): void => {
    if (draining && (queues.get(conversationKey)?.length ?? 0) === 0) {
      active.set(conversationKey, false);
      notifyIdle();
      return;
    }
    if (active.get(conversationKey) === true) return;
    const queue = queues.get(conversationKey);
    if (queue === undefined || queue.length === 0) {
      active.set(conversationKey, false);
      notifyIdle();
      return;
    }
    if (globalActive >= queueConfig.maxGlobalPending) return;
    const job = queue.shift();
    if (job === undefined) return;
    active.set(conversationKey, true);
    globalActive += 1;
    void job.run().finally(() => {
      globalActive = Math.max(0, globalActive - 1);
      active.set(conversationKey, false);
      pump(conversationKey);
      // Attempt other conversations waiting on global capacity.
      for (const key of queues.keys()) {
        if (key !== conversationKey) pump(key);
      }
      notifyIdle();
    });
  };

  return {
    enqueue(job: DispatcherJob): { ok: true } | { ok: false; reason: 'draining' | 'queue-full' } {
      if (draining) return { ok: false, reason: 'draining' };
      const key = job.conversationId;
      const queue = queues.get(key) ?? [];
      if (queue.length >= queueConfig.maxDepthPerConversation)
        return { ok: false, reason: 'queue-full' };
      queue.push(job);
      queues.set(key, queue);
      pump(key);
      return { ok: true };
    },
    beginDrain(): void {
      draining = true;
    },
    whenIdle(): Promise<void> {
      if (globalActive === 0 && [...queues.values()].every((q) => q.length === 0))
        return Promise.resolve();
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
    get diagnostics() {
      return Object.freeze({
        globalActive,
        conversationCount: queues.size,
        draining,
      });
    },
  };
};

export type PerConversationTurnDispatcher = ReturnType<typeof createPerConversationTurnDispatcher>;
