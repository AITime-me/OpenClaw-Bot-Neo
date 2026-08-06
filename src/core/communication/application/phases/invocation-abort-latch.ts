/**
 * Race a deferred port invocation against abort/deadline. First terminal event latches.
 * The invocation is started via thunk so synchronous throws are treated as rejected.
 * Late resolve/reject are absorbed so they cannot mutate durable facts afterward.
 */
export type InvocationRace<T> =
  | { readonly kind: 'result'; readonly value: T }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'rejected'; readonly error: unknown };

export const raceInvocationWithAbort = <T>(
  start: () => Promise<T>,
  signal: AbortSignal | null,
): Promise<InvocationRace<T>> => {
  let invocation: Promise<T>;
  try {
    invocation = start();
  } catch (error) {
    return Promise.resolve({ kind: 'rejected', error });
  }

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
