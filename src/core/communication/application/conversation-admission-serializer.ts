/**
 * Serializes accept→queued→enqueue publication per conversation so a later sequence
 * cannot publish before an earlier in-flight admission finishes enqueue.
 */
export const createConversationAdmissionSerializer = () => {
  const tails = new Map<string, Promise<unknown>>();

  return {
    async runExclusive<T>(conversationKey: string, work: () => Promise<T>): Promise<T> {
      const previous = tails.get(conversationKey) ?? Promise.resolve();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const chained = previous.catch(() => undefined).then(() => gate);
      tails.set(conversationKey, chained);
      await previous.catch(() => undefined);
      try {
        return await work();
      } finally {
        release();
        if (tails.get(conversationKey) === chained) tails.delete(conversationKey);
      }
    },
  };
};

export type ConversationAdmissionSerializer = ReturnType<
  typeof createConversationAdmissionSerializer
>;
