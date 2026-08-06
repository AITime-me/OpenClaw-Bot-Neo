import { describe, expect, it } from 'vitest';
import {
  createPerConversationTurnDispatcher,
  REFERENCE_COMMUNICATION_QUEUE_CONFIG,
} from '../../src/core/communication/application/index.js';
import { parseConversationId } from '../../src/core/communication/domain/index.js';

const must = <T>(result: { ok: true; value: T } | { ok: false }): T => {
  if (!result.ok) throw new Error('parse failed');
  return result.value;
};

type SequenceJob = { readonly conversationSequence: number };

const insertSorted = (queue: SequenceJob[], job: SequenceJob): void => {
  let index = queue.length;
  for (let i = 0; i < queue.length; i += 1) {
    const existing = queue[i];
    if (existing !== undefined && existing.conversationSequence > job.conversationSequence) {
      index = i;
      break;
    }
  }
  queue.splice(index, 0, job);
};

describe('Build 3.7D per-conversation turn dispatcher', () => {
  it('sorts queued jobs by trusted conversationSequence before execution', () => {
    const queue: SequenceJob[] = [{ conversationSequence: 2 }];
    insertSorted(queue, { conversationSequence: 1 });
    expect(queue.map((job) => job.conversationSequence)).toEqual([1, 2]);
  });

  it('executes trusted conversationSequence in order for one conversation', async () => {
    const dispatcher = createPerConversationTurnDispatcher(REFERENCE_COMMUNICATION_QUEUE_CONFIG);
    const conversationId = must(parseConversationId('conversation-fifo-unit'));
    const order: number[] = [];

    dispatcher.enqueue({
      conversationId,
      conversationSequence: 1,
      run: () => {
        order.push(1);
        return Promise.resolve();
      },
    });
    dispatcher.enqueue({
      conversationId,
      conversationSequence: 2,
      run: () => {
        order.push(2);
        return Promise.resolve();
      },
    });

    await dispatcher.whenIdle();
    expect(order).toEqual([1, 2]);
  });

  it('rejects enqueue when global pending capacity is full', async () => {
    const dispatcher = createPerConversationTurnDispatcher(REFERENCE_COMMUNICATION_QUEUE_CONFIG);
    let releaseBlockers: () => void = () => undefined;
    const blockersDone = new Promise<void>((resolve) => {
      releaseBlockers = resolve;
    });

    for (let index = 0; index < REFERENCE_COMMUNICATION_QUEUE_CONFIG.maxGlobalPending; index += 1) {
      const conversationId = must(parseConversationId(`conversation-global-${String(index)}`));
      const enqueued = dispatcher.enqueue({
        conversationId,
        conversationSequence: 1,
        run: async () => {
          await blockersDone;
        },
      });
      expect(enqueued.ok).toBe(true);
    }

    const overflowConversation = must(parseConversationId('conversation-global-overflow'));
    const overflow = dispatcher.enqueue({
      conversationId: overflowConversation,
      conversationSequence: 1,
      run: () => Promise.resolve(undefined),
    });
    expect(overflow.ok).toBe(false);
    if (overflow.ok) throw new Error('expected overflow');
    expect(overflow.reason).toBe('global-queue-full');

    releaseBlockers();
    await dispatcher.whenIdle();
  });
});
