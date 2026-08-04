import type {
  Connector,
  ConnectorExecuteRequest,
  ConnectorExecutionResult,
} from '../sdk/connector.js';
import type {
  ConnectorId,
  ToolId,
  VerifiedToolManifest,
} from '../../core/domain/connector/index.js';
import {
  validateConnectorManifest,
  validateToolManifest,
} from '../../core/domain/connector/manifest-validation.js';

const CONNECTOR_ID = 'reference' as ConnectorId;

const buildTool = (raw: Record<string, unknown>): VerifiedToolManifest => {
  const result = validateToolManifest(raw);
  if (!result.ok) throw new Error(result.error.reason);
  return result.value;
};

export const REFERENCE_TOOLS: readonly VerifiedToolManifest[] = Object.freeze([
  buildTool({
    schemaVersion: 'connector-tool/1',
    toolId: 'reference.echo.read',
    connectorId: CONNECTOR_ID,
    version: '1.0.0',
    title: 'Echo Read',
    description: 'Deterministic read-only echo.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        message: { type: 'string', maxLength: 256 },
        mode: {
          type: 'string',
          enum: ['ok', 'unavailable', 'remote-error', 'invalid-output', 'timeout', 'cancel'],
        },
      },
      required: ['message'],
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { echoed: { type: 'string', maxLength: 256 } },
      required: ['echoed'],
    },
    capability: 'read',
    riskClass: 'low',
    sideEffectClass: 'READ_ONLY',
    approvalRequirement: 'never',
    timeoutMs: 5_000,
    idempotencySupport: 'none',
    cancellationSupport: 'cooperative',
    dataSensitivity: 'internal',
    networkRequirement: 'none',
    accountRequirement: 'none',
  }),
  buildTool({
    schemaVersion: 'connector-tool/1',
    toolId: 'reference.note.write',
    connectorId: CONNECTOR_ID,
    version: '1.0.0',
    title: 'Note Write',
    description: 'Deterministic in-memory note write.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { note: { type: 'string', maxLength: 256 } },
      required: ['note'],
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        stored: { type: 'boolean' },
        note: { type: 'string', maxLength: 256 },
      },
      required: ['stored', 'note'],
    },
    capability: 'create',
    riskClass: 'medium',
    sideEffectClass: 'LOW_RISK_WRITE',
    approvalRequirement: 'always',
    timeoutMs: 5_000,
    idempotencySupport: 'keyed',
    cancellationSupport: 'cooperative',
    dataSensitivity: 'internal',
    networkRequirement: 'none',
    accountRequirement: 'none',
  }),
  buildTool({
    schemaVersion: 'connector-tool/1',
    toolId: 'reference.finance.read',
    connectorId: CONNECTOR_ID,
    version: '1.0.0',
    title: 'Finance Read',
    description: 'Read-only financial analytics.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { account: { type: 'string', maxLength: 64 } },
      required: ['account'],
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { balance: { type: 'integer' } },
      required: ['balance'],
    },
    capability: 'read',
    riskClass: 'high',
    sideEffectClass: 'READ_ONLY',
    approvalRequirement: 'policy',
    timeoutMs: 5_000,
    idempotencySupport: 'none',
    cancellationSupport: 'cooperative',
    dataSensitivity: 'confidential',
    networkRequirement: 'none',
    accountRequirement: 'none',
  }),
]);

const notes = new Map<string, string>();

const delay = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

export const createReferenceConnector = (): Connector => ({
  connectorId: CONNECTOR_ID,
  initialize(): Promise<void> {
    notes.clear();
    return Promise.resolve();
  },
  health(): Promise<import('../sdk/connector.js').ConnectorHealthResult> {
    return Promise.resolve({ status: 'healthy', retryAfterMs: null });
  },
  listTools(): readonly VerifiedToolManifest[] {
    return REFERENCE_TOOLS;
  },
  discoverCapabilities(): readonly import('../../core/domain/connector/capabilities.js').ToolCapability[] {
    return ['read', 'create'];
  },
  async execute(request: ConnectorExecuteRequest): Promise<ConnectorExecutionResult> {
    const toolId = request.tool.toolId as string;
    if (toolId === 'reference.echo.read') {
      const message = (request.input as { message?: string }).message ?? '';
      const mode = (request.input as { mode?: string }).mode ?? 'ok';
      if (mode === 'unavailable')
        return {
          ok: false,
          error: { code: 'unavailable', reason: 'Unavailable.', category: 'internal' },
        };
      if (mode === 'remote-error')
        return {
          ok: false,
          error: {
            code: 'remote-error',
            reason: 'Simulated remote failure with secret=REDACTED body.',
            category: 'remote',
          },
        };
      if (mode === 'invalid-output') return { ok: true, output: { unexpected: true } };
      if (mode === 'timeout') {
        try {
          await delay(30_000, request.signal);
        } catch {
          return {
            ok: false,
            error: { code: 'cancelled', reason: 'Cancelled.', category: 'cancelled' },
          };
        }
        return { ok: false, error: { code: 'timeout', reason: 'Timed out.', category: 'timeout' } };
      }
      if (mode === 'cancel') {
        await delay(50, request.signal);
        if (request.signal.aborted)
          return {
            ok: false,
            error: { code: 'cancelled', reason: 'Cancelled.', category: 'cancelled' },
          };
      }
      return { ok: true, output: { echoed: message } };
    }
    if (toolId === 'reference.note.write') {
      const note = (request.input as { note?: string }).note ?? '';
      const key = request.idempotencyKey === null ? 'default' : (request.idempotencyKey as string);
      if (request.signal.aborted)
        return {
          ok: false,
          error: { code: 'cancelled', reason: 'Cancelled.', category: 'cancelled' },
        };
      notes.set(key, note);
      return { ok: true, output: { stored: true, note } };
    }
    if (toolId === 'reference.finance.read') return { ok: true, output: { balance: 42 } };
    return {
      ok: false,
      error: { code: 'unavailable', reason: 'Unknown tool.', category: 'internal' },
    };
  },
  shutdown(): Promise<void> {
    notes.clear();
    return Promise.resolve();
  },
});

export const createReferenceConnectorManifest = () => {
  const result = validateConnectorManifest({
    schemaVersion: 'connector-platform/1',
    connectorId: CONNECTOR_ID,
    title: 'Reference Connector',
    description: 'Offline deterministic reference connector for tests.',
    version: '1.0.0',
    declaredCapabilities: ['read', 'create'],
    networkRequirement: 'none',
    accountModel: 'none',
  });
  if (!result.ok) throw new Error(result.error.reason);
  return result.value;
};

export const asToolId = (value: string): ToolId => value as ToolId;
