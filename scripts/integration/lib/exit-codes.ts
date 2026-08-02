import type { ProtocolEvent } from './constants.ts';
import {
  EXIT_ASSERTION_FAILURE,
  EXIT_COMPOSITION_FAILURE,
  EXIT_ENVIRONMENT_GATE_FAILED,
  EXIT_LOCK_CONTENTION,
  EXIT_PROTOCOL_FAILURE,
  EXIT_SUCCESS,
} from './constants.ts';

export const mapEventToExpectedExit = (event: ProtocolEvent): number => {
  switch (event) {
    case 'CLOSED':
      return EXIT_SUCCESS;
    case 'HELD':
      return EXIT_LOCK_CONTENTION;
    case 'FAILED':
      return EXIT_COMPOSITION_FAILURE;
    case 'READY':
    case 'WRITE_CONFIRMED':
    case 'READ_CONFIRMED':
    case 'READ_REJECTED':
    case 'ACCESS_DENIED':
      return EXIT_SUCCESS;
    default:
      return EXIT_PROTOCOL_FAILURE;
  }
};

export const isTerminalEvent = (event: ProtocolEvent): boolean =>
  event === 'CLOSED' || event === 'HELD' || event === 'FAILED';

export {
  EXIT_ASSERTION_FAILURE,
  EXIT_COMPOSITION_FAILURE,
  EXIT_ENVIRONMENT_GATE_FAILED,
  EXIT_LOCK_CONTENTION,
  EXIT_PROTOCOL_FAILURE,
  EXIT_SUCCESS,
};
