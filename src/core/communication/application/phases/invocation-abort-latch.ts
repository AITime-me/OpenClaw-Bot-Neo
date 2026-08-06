/**
 * Race a port invocation against abort/deadline. First terminal event latches.
 * Late resolve/reject are absorbed so they cannot mutate durable facts afterward.
 */
export type InvocationRace<T> =
  | { readonly kind: 'result'; readonly value: T }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'rejected'; readonly error: unknown };

export const raceInvocationWithAbort = <T>(
  invocation: Promise<T>,
  signal: AbortSignal | null,
): Promise<InvocationRace<T>> => {
  if (signal?.aborted) {
    void invocation.then(
      () => undefined,
      () => undefined,
    );
    return Promise.resolve({ kind: 'aborted' });
  }

  return new Promise((resolve) => {
    let settled = false;
    const latch = (result: InvocationRace<T>): void => {
      if (settled) return;
      settled = true;
      if (signal !== null) signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = (): void => {
      latch({ kind: 'aborted' });
      void invocation.then(
        () => undefined,
        () => undefined,
      );
    };
    if (signal !== null) signal.addEventListener('abort', onAbort, { once: true });
    invocation.then(
      (value) => {
        latch({ kind: 'result', value });
      },
      (error: unknown) => {
        latch({ kind: 'rejected', error });
      },
    );
  });
};
