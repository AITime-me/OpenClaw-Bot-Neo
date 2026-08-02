import type {
  NeoProcessKeepAliveLease,
  NeoProcessKeepAlivePort,
} from '../ports/neo-process-ports.js';

export const createNoOpNeoProcessKeepAlivePort = (): NeoProcessKeepAlivePort => {
  const noopLease: NeoProcessKeepAliveLease = Object.freeze({ release: () => {} });
  return Object.freeze({
    acquire: () => noopLease,
  });
};

export const createTrackingNeoProcessKeepAlivePort = (): TrackingNeoProcessKeepAlivePort => {
  let acquired = 0;
  let released = 0;
  let active = false;

  return Object.freeze({
    acquire: (): NeoProcessKeepAliveLease => {
      acquired += 1;
      active = true;
      let leaseReleased = false;
      return Object.freeze({
        release: (): void => {
          if (leaseReleased) return;
          leaseReleased = true;
          released += 1;
          active = false;
        },
      });
    },
    acquireCount: () => acquired,
    releaseCount: () => released,
    isActive: () => active,
  });
};

export type TrackingNeoProcessKeepAlivePort = NeoProcessKeepAlivePort & {
  readonly acquireCount: () => number;
  readonly releaseCount: () => number;
  readonly isActive: () => boolean;
};
