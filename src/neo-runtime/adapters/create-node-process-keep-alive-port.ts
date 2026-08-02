import { clearInterval, setInterval } from 'node:timers';
import type {
  NeoProcessKeepAliveLease,
  NeoProcessKeepAlivePort,
} from '../ports/neo-process-ports.js';

/** Ref'd no-op interval retained until coordinated shutdown completes. */
export const NEO_PROCESS_KEEP_ALIVE_INTERVAL_MS = 3_600_000 as const;

export const createNodeProcessKeepAlivePort = (): NeoProcessKeepAlivePort => {
  let leaseActive = false;
  let activeTimer: ReturnType<typeof setInterval> | undefined;

  return Object.freeze({
    acquire: (): NeoProcessKeepAliveLease => {
      if (leaseActive) {
        throw new Error('Neo process keep-alive lease is already active.');
      }
      leaseActive = true;
      activeTimer = setInterval(() => {
        // Retain a ref'd handle until coordinated shutdown completes.
      }, NEO_PROCESS_KEEP_ALIVE_INTERVAL_MS);
      let released = false;
      return Object.freeze({
        release: (): void => {
          if (released) return;
          released = true;
          if (activeTimer !== undefined) {
            clearInterval(activeTimer);
            activeTimer = undefined;
          }
          leaseActive = false;
        },
      });
    },
  });
};
