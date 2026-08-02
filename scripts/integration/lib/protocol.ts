import {
  GATE_PROTOCOL_VERSION,
  MAX_PROTOCOL_LINE_BYTES,
  isChildRole,
  type ChildRole,
  type ProtocolEvent,
} from './constants.ts';

const PROTOCOL_EVENTS = new Set<ProtocolEvent>([
  'READY',
  'WRITE_CONFIRMED',
  'READ_CONFIRMED',
  'READ_REJECTED',
  'ACCESS_DENIED',
  'HELD',
  'CLOSED',
  'FAILED',
]);

const MESSAGE_ALLOWED_KEYS = new Set(['v', 'runId', 'role', 'event', 'pid', 'errorCode', 'detail']);

const DETAIL_ALLOWED_KEYS = new Set([
  'recordId',
  'ownerId',
  'namespace',
  'contentSha256',
  'closeCount',
  'compositionCode',
  'recordHash',
  'errorCode',
  'expectedOwnerId',
  'expectedNamespace',
  'authorizationCode',
  'proofType',
  'domainCode',
]);

const COMMAND_ALLOWED_KEYS = new Set([
  'command',
  'ownerId',
  'namespace',
  'recordId',
  'expectedOwnerId',
  'expectedNamespace',
  'v',
]);

export type ProtocolMessage = {
  readonly v: typeof GATE_PROTOCOL_VERSION;
  readonly runId: string;
  readonly role: ChildRole;
  readonly event: ProtocolEvent;
  readonly pid: number;
  readonly errorCode?: string;
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
};

export type ParentCommand =
  | { readonly command: 'CLOSE'; readonly v?: number }
  | { readonly command: 'EXIT'; readonly v?: number }
  | {
      readonly command: 'WRITE';
      readonly ownerId: string;
      readonly namespace: string;
      readonly recordId: string;
      readonly v?: number;
    }
  | {
      readonly command: 'READ';
      readonly ownerId: string;
      readonly namespace: string;
      readonly recordId: string;
      /** When set and different from ownerId, triggers authorize OWNER_MISMATCH before DB. */
      readonly expectedOwnerId?: string;
      /** When set and different from namespace, may trigger NAMESPACE_ISOLATED before DB. */
      readonly expectedNamespace?: string;
      readonly v?: number;
    };

export type ProtocolParseError =
  | 'INVALID_JSON'
  | 'UNKNOWN_FIELDS'
  | 'INVALID_SCHEMA'
  | 'WRONG_VERSION'
  | 'WRONG_RUN_ID'
  | 'WRONG_ROLE'
  | 'UNKNOWN_EVENT'
  | 'DUPLICATE_TERMINAL'
  | 'OUT_OF_ORDER'
  | 'LINE_TOO_LONG'
  | 'UNKNOWN_COMMAND'
  | 'COMMAND_AFTER_TERMINAL'
  | 'PARTIAL_EOF'
  | 'EOF_WITHOUT_TERMINAL';

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isProtocolEvent = (value: unknown): value is ProtocolEvent =>
  typeof value === 'string' && PROTOCOL_EVENTS.has(value as ProtocolEvent);

export const serializeProtocolMessage = (message: ProtocolMessage): string =>
  `${JSON.stringify(message)}\n`;

export const serializeParentCommand = (command: ParentCommand): string =>
  `${JSON.stringify({ v: GATE_PROTOCOL_VERSION, ...command })}\n`;

export const parseProtocolLine = (
  line: string,
  expectedRunId: string,
  expectedRole: ChildRole,
):
  | { readonly ok: true; readonly value: ProtocolMessage }
  | { readonly ok: false; readonly error: ProtocolParseError } => {
  if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_LINE_BYTES) {
    return { ok: false, error: 'LINE_TOO_LONG' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return { ok: false, error: 'INVALID_JSON' };
  }
  if (!isPlainRecord(parsed)) return { ok: false, error: 'INVALID_SCHEMA' };

  for (const key of Object.keys(parsed)) {
    if (!MESSAGE_ALLOWED_KEYS.has(key)) return { ok: false, error: 'UNKNOWN_FIELDS' };
  }

  const v = parsed['v'];
  const runId = parsed['runId'];
  const role = parsed['role'];
  const event = parsed['event'];
  const pid = parsed['pid'];

  if (v !== GATE_PROTOCOL_VERSION) return { ok: false, error: 'WRONG_VERSION' };
  if (typeof runId !== 'string' || runId !== expectedRunId)
    return { ok: false, error: 'WRONG_RUN_ID' };
  if (typeof role !== 'string' || role !== expectedRole || !isChildRole(role)) {
    return { ok: false, error: 'WRONG_ROLE' };
  }
  if (!isProtocolEvent(event)) return { ok: false, error: 'UNKNOWN_EVENT' };
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return { ok: false, error: 'INVALID_SCHEMA' };
  }

  const errorCode = parsed['errorCode'];
  if (errorCode !== undefined && typeof errorCode !== 'string') {
    return { ok: false, error: 'INVALID_SCHEMA' };
  }

  const detailRaw = parsed['detail'];
  if (detailRaw !== undefined) {
    if (!isPlainRecord(detailRaw)) return { ok: false, error: 'INVALID_SCHEMA' };
    for (const key of Object.keys(detailRaw)) {
      if (!DETAIL_ALLOWED_KEYS.has(key)) return { ok: false, error: 'UNKNOWN_FIELDS' };
      const detailValue = detailRaw[key];
      if (
        typeof detailValue !== 'string' &&
        typeof detailValue !== 'number' &&
        typeof detailValue !== 'boolean'
      ) {
        return { ok: false, error: 'INVALID_SCHEMA' };
      }
    }
  }

  const message: ProtocolMessage = {
    v: GATE_PROTOCOL_VERSION,
    runId,
    role,
    event,
    pid,
    ...(typeof errorCode === 'string' ? { errorCode } : {}),
    ...(detailRaw !== undefined
      ? { detail: detailRaw as Readonly<Record<string, string | number | boolean>> }
      : {}),
  };
  return { ok: true, value: message };
};

export class ProtocolStateTracker {
  private terminalSeen = false;
  private readySeen = false;
  private lastEvent: ProtocolEvent | undefined;

  validateOrder(event: ProtocolEvent): ProtocolParseError | null {
    if (this.terminalSeen) return 'DUPLICATE_TERMINAL';
    if (event === 'READY') {
      if (this.readySeen) return 'OUT_OF_ORDER';
      this.readySeen = true;
    }
    if (event === 'ACCESS_DENIED' || event === 'READ_REJECTED') {
      if (!this.readySeen) return 'OUT_OF_ORDER';
    }
    if (event === 'HELD' || event === 'CLOSED' || event === 'FAILED') {
      this.terminalSeen = true;
    }
    if (this.lastEvent === 'WRITE_CONFIRMED' && event === 'READY') return 'OUT_OF_ORDER';
    this.lastEvent = event;
    return null;
  }

  hasTerminal(): boolean {
    return this.terminalSeen;
  }

  hasReady(): boolean {
    return this.readySeen;
  }
}

export type ParentCommandParseResult =
  | { readonly ok: true; readonly value: ParentCommand }
  | { readonly ok: false; readonly error: ProtocolParseError };

const isIdentityString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;

const isNamespace = (value: unknown): value is 'personal' | 'ai-my-time' =>
  value === 'personal' || value === 'ai-my-time';

export const parseParentCommandLine = (line: string): ParentCommandParseResult => {
  if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_LINE_BYTES) {
    return { ok: false, error: 'LINE_TOO_LONG' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return { ok: false, error: 'INVALID_JSON' };
  }
  if (!isPlainRecord(parsed)) return { ok: false, error: 'INVALID_SCHEMA' };
  for (const key of Object.keys(parsed)) {
    if (!COMMAND_ALLOWED_KEYS.has(key)) return { ok: false, error: 'UNKNOWN_FIELDS' };
  }
  const version = parsed['v'];
  if (version !== undefined && version !== GATE_PROTOCOL_VERSION) {
    return { ok: false, error: 'WRONG_VERSION' };
  }
  const command = parsed['command'];
  if (command === 'CLOSE' || command === 'EXIT') return { ok: true, value: { command } };
  if (command === 'WRITE' || command === 'READ') {
    const ownerId = parsed['ownerId'];
    const namespace = parsed['namespace'];
    const recordId = parsed['recordId'];
    if (!isIdentityString(ownerId) || !isNamespace(namespace) || !isIdentityString(recordId)) {
      return { ok: false, error: 'INVALID_SCHEMA' };
    }
    if (command === 'WRITE') {
      return { ok: true, value: { command, ownerId, namespace, recordId } };
    }
    const expectedOwnerId = parsed['expectedOwnerId'];
    const expectedNamespace = parsed['expectedNamespace'];
    if (expectedOwnerId !== undefined && !isIdentityString(expectedOwnerId)) {
      return { ok: false, error: 'INVALID_SCHEMA' };
    }
    if (expectedNamespace !== undefined && !isNamespace(expectedNamespace)) {
      return { ok: false, error: 'INVALID_SCHEMA' };
    }
    return {
      ok: true,
      value: {
        command,
        ownerId,
        namespace,
        recordId,
        ...(typeof expectedOwnerId === 'string' ? { expectedOwnerId } : {}),
        ...(typeof expectedNamespace === 'string' ? { expectedNamespace } : {}),
      },
    };
  }
  return { ok: false, error: 'UNKNOWN_COMMAND' };
};
