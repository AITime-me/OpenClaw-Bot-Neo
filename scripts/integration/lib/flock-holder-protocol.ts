import { MAX_PROTOCOL_LINE_BYTES } from './constants.ts';
import { parseParentCommandLine, type ProtocolParseError } from './protocol.ts';

export type FlockHolderAction =
  | { readonly kind: 'continue' }
  | { readonly kind: 'close'; readonly command: 'EXIT' | 'CLOSE' }
  | {
      readonly kind: 'fail';
      readonly reason: ProtocolParseError | 'UNKNOWN_COMMAND' | 'COMMAND_AFTER_TERMINAL';
    };

export type FlockHolderMachine = {
  readonly terminalCommandSeen: boolean;
  readonly failed: boolean;
  readonly closed: boolean;
  readonly partialBuffer: string;
};

export const createFlockHolderMachine = (): FlockHolderMachine => ({
  terminalCommandSeen: false,
  failed: false,
  closed: false,
  partialBuffer: '',
});

export const flockHolderIngestChunk = (
  state: FlockHolderMachine,
  chunk: string,
): { readonly state: FlockHolderMachine; readonly actions: readonly FlockHolderAction[] } => {
  if (state.failed || state.closed) {
    return { state, actions: [] };
  }
  let partialBuffer = `${state.partialBuffer}${chunk}`;
  const actions: FlockHolderAction[] = [];
  let current: FlockHolderMachine = { ...state, partialBuffer };

  let newline = partialBuffer.indexOf('\n');
  while (newline >= 0) {
    const line = partialBuffer.slice(0, newline);
    partialBuffer = partialBuffer.slice(newline + 1);
    current = { ...current, partialBuffer };
    const result = flockHolderHandleCompleteLine(current, line.trim());
    current = result.state;
    actions.push(...result.actions);
    if (current.failed || current.closed) {
      return { state: current, actions };
    }
    newline = partialBuffer.indexOf('\n');
  }

  if (Buffer.byteLength(partialBuffer, 'utf8') > MAX_PROTOCOL_LINE_BYTES) {
    return {
      state: { ...current, failed: true, partialBuffer: '' },
      actions: [...actions, { kind: 'fail', reason: 'LINE_TOO_LONG' }],
    };
  }

  return { state: { ...current, partialBuffer }, actions };
};

export const flockHolderHandleCompleteLine = (
  state: FlockHolderMachine,
  line: string,
): { readonly state: FlockHolderMachine; readonly actions: readonly FlockHolderAction[] } => {
  if (state.failed || state.closed) return { state, actions: [] };
  if (state.terminalCommandSeen) {
    return {
      state: { ...state, failed: true },
      actions: [{ kind: 'fail', reason: 'COMMAND_AFTER_TERMINAL' }],
    };
  }
  if (line.length === 0) return { state, actions: [{ kind: 'continue' }] };

  const parsed = parseParentCommandLine(line);
  if (!parsed.ok) {
    return {
      state: { ...state, failed: true },
      actions: [{ kind: 'fail', reason: parsed.error }],
    };
  }
  if (parsed.value.command === 'EXIT' || parsed.value.command === 'CLOSE') {
    return {
      state: { ...state, terminalCommandSeen: true, closed: true },
      actions: [{ kind: 'close', command: parsed.value.command }],
    };
  }
  return {
    state: { ...state, failed: true },
    actions: [{ kind: 'fail', reason: 'UNKNOWN_COMMAND' }],
  };
};

/**
 * Fail-closed EOF: partial trailing data or missing EXIT/CLOSE → FAILED.
 * Clean EOF after terminal command is a no-op.
 */
export const flockHolderHandleEof = (
  state: FlockHolderMachine,
): { readonly state: FlockHolderMachine; readonly actions: readonly FlockHolderAction[] } => {
  if (state.failed || state.closed || state.terminalCommandSeen) {
    return { state, actions: [] };
  }
  if (state.partialBuffer.trim().length > 0) {
    return {
      state: { ...state, failed: true, partialBuffer: '' },
      actions: [{ kind: 'fail', reason: 'PARTIAL_EOF' }],
    };
  }
  return {
    state: { ...state, failed: true },
    actions: [{ kind: 'fail', reason: 'EOF_WITHOUT_TERMINAL' }],
  };
};
