import { err, ok, type Result } from '../../core/domain/result.js';
import {
  createLocalHost,
  type CreateLocalHostInput,
  type LocalHost,
} from '../create-local-host.js';
import {
  parseLocalHostConfig,
  type LocalHostConfig,
  type LocalHostConfigDiagnostics,
  type LocalHostConfigFailure,
} from './parse-local-host-config.js';

export interface LocalHostConfigBootstrap {
  readonly host: LocalHost;
  readonly config: LocalHostConfig;
  readonly diagnostics: LocalHostConfigDiagnostics;
}

const compositionRejected = (): LocalHostConfigFailure => ({
  code: 'HOST_COMPOSITION_REJECTED',
  reason: 'Local host composition input was rejected.',
});

/**
 * Mirrors the expected shape checks performed by `createLocalHost` so known invalid
 * composition input becomes a typed Result without a catch-all that would mask
 * unexpected programmer errors.
 */
const rejectInvalidHostCompositionInput = (
  hostInput: unknown,
): LocalHostConfigFailure | undefined => {
  if (hostInput === null || typeof hostInput !== 'object' || Array.isArray(hostInput))
    return compositionRejected();

  const input = hostInput as Record<string, unknown>;
  const clock = input['clock'];
  if (clock === null || typeof clock !== 'object' || Array.isArray(clock))
    return compositionRejected();
  const clockRecord = clock as Record<string, unknown>;
  if (typeof clockRecord['now'] !== 'function') return compositionRejected();

  if (input['scanner'] !== undefined) {
    const scanner = input['scanner'];
    if (scanner === null || typeof scanner !== 'object' || Array.isArray(scanner))
      return compositionRejected();
    const scannerRecord = scanner as Record<string, unknown>;
    if (
      typeof scannerRecord['scanText'] !== 'function' ||
      typeof scannerRecord['scanMetadata'] !== 'function'
    )
      return compositionRejected();
  }

  if (input['policy'] !== undefined) {
    const policy = input['policy'];
    if (policy === null || typeof policy !== 'object' || Array.isArray(policy))
      return compositionRejected();
    const policyRecord = policy as Record<string, unknown>;
    if (typeof policyRecord['evaluate'] !== 'function') return compositionRejected();
  }

  return undefined;
};

/**
 * Pure local config bootstrap. Validates an explicit parsed config object, then composes an
 * existing local host from explicit hostInput. Does not derive memory policy, activate
 * providers, read files/environment, or mint trusted evidence.
 *
 * Expected invalid hostInput shapes return `HOST_COMPOSITION_REJECTED`. Unexpected
 * programmer errors from composition are not caught and must propagate.
 */
export function createLocalHostFromConfig(
  configInput: unknown,
  hostInput: CreateLocalHostInput,
): Result<LocalHostConfigBootstrap, LocalHostConfigFailure> {
  const parsed = parseLocalHostConfig(configInput);
  if (!parsed.ok) return parsed;

  const rejected = rejectInvalidHostCompositionInput(hostInput);
  if (rejected !== undefined) return err(rejected);

  const host = createLocalHost(hostInput);
  return ok(
    Object.freeze({
      host,
      config: parsed.value,
      diagnostics: parsed.value.diagnostics,
    }),
  );
}
