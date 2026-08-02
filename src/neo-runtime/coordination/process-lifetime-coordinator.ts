export const createProcessLifetimeBarrier = (): {
  readonly wait: () => Promise<void>;
  readonly requestShutdown: () => void;
  readonly isRequested: () => boolean;
} => {
  let requested = false;
  let resolveBarrier: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    resolveBarrier = resolve;
  });

  return {
    wait: () => barrier,
    requestShutdown: () => {
      if (requested) return;
      requested = true;
      resolveBarrier?.();
    },
    isRequested: () => requested,
  };
};
