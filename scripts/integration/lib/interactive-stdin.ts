import { MAX_PROTOCOL_LINE_BYTES } from './constants.ts';
import type { ProtocolParseError } from './protocol.ts';

/**
 * Interactive child stdin/EOF state machine (pure).
 * Complements SerialCommandQueue: tracks partial lines and terminal/EOF outcomes.
 */
export type InteractiveEofAction =
  | { readonly kind: 'lines'; readonly lines: readonly string[] }
  | { readonly kind: 'fail'; readonly reason: ProtocolParseError }
  | { readonly kind: 'noop' };

export type InteractiveStdinState = {
  readonly terminalCommandSeen: boolean;
  readonly terminalEventEmitted: boolean;
  readonly failed: boolean;
  readonly partialBuffer: string;
  readonly eofSeen: boolean;
};

export const createInteractiveStdinState = (): InteractiveStdinState => ({
  terminalCommandSeen: false,
  terminalEventEmitted: false,
  failed: false,
  partialBuffer: '',
  eofSeen: false,
});

export const interactiveMarkTerminalCommand = (
  state: InteractiveStdinState,
): InteractiveStdinState => ({
  ...state,
  terminalCommandSeen: true,
});

export const interactiveMarkTerminalEvent = (
  state: InteractiveStdinState,
): InteractiveStdinState => ({
  ...state,
  terminalEventEmitted: true,
});

export const interactiveMarkFailed = (state: InteractiveStdinState): InteractiveStdinState => ({
  ...state,
  failed: true,
  terminalEventEmitted: true,
});

export const interactiveIngestChunk = (
  state: InteractiveStdinState,
  chunk: string,
): { readonly state: InteractiveStdinState; readonly actions: readonly InteractiveEofAction[] } => {
  if (state.failed || state.eofSeen) {
    return { state, actions: [{ kind: 'noop' }] };
  }
  let partialBuffer = `${state.partialBuffer}${chunk}`;
  const lines: string[] = [];
  let newline = partialBuffer.indexOf('\n');
  while (newline >= 0) {
    const line = partialBuffer.slice(0, newline);
    partialBuffer = partialBuffer.slice(newline + 1);
    lines.push(line);
    newline = partialBuffer.indexOf('\n');
  }
  if (Buffer.byteLength(partialBuffer, 'utf8') > MAX_PROTOCOL_LINE_BYTES) {
    return {
      state: { ...state, failed: true, terminalEventEmitted: true, partialBuffer: '' },
      actions: [
        ...(lines.length > 0 ? [{ kind: 'lines' as const, lines }] : []),
        { kind: 'fail', reason: 'LINE_TOO_LONG' },
      ],
    };
  }
  const next: InteractiveStdinState = { ...state, partialBuffer };
  if (lines.length === 0) return { state: next, actions: [{ kind: 'noop' }] };
  return { state: next, actions: [{ kind: 'lines', lines }] };
};

/**
 * Fail-closed EOF for interactive roles.
 * Clean EOF after terminal command/event → noop.
 * Partial trailing JSON or missing CLOSE/EXIT → FAILED.
 */
export const interactiveHandleEof = (
  state: InteractiveStdinState,
): { readonly state: InteractiveStdinState; readonly actions: readonly InteractiveEofAction[] } => {
  if (state.failed) {
    return { state: { ...state, eofSeen: true }, actions: [{ kind: 'noop' }] };
  }
  if (state.terminalCommandSeen || state.terminalEventEmitted) {
    return { state: { ...state, eofSeen: true }, actions: [{ kind: 'noop' }] };
  }
  if (state.partialBuffer.trim().length > 0) {
    return {
      state: {
        ...state,
        failed: true,
        terminalEventEmitted: true,
        eofSeen: true,
        partialBuffer: '',
      },
      actions: [{ kind: 'fail', reason: 'PARTIAL_EOF' }],
    };
  }
  return {
    state: { ...state, failed: true, terminalEventEmitted: true, eofSeen: true },
    actions: [{ kind: 'fail', reason: 'EOF_WITHOUT_TERMINAL' }],
  };
};
