/**
 * Honest local-composition diagnostics. Build 3.0 is not deployment-ready and does not
 * enforce OS/network sandbox isolation for injected dependencies.
 *
 * `storage` / `durability` widen for durable SQLite-backed LocalHost assembly (B3C2) while
 * ephemeral `createLocalHost()` continues to expose the in-memory constants below unchanged.
 */
export interface LocalHostDiagnostics {
  readonly mode: 'local';
  readonly storage: 'in-memory' | 'sqlite-local';
  readonly durability: 'ephemeral' | 'sqlite-local';
  readonly builtInNetworkClients: 'none';
  readonly automaticNetworkActivity: 'none';
  readonly networkIsolationEnforced: false;
  readonly defaultMemoryPolicy: 'deny';
  readonly deploymentReady: false;
}

export const LOCAL_HOST_DIAGNOSTICS: LocalHostDiagnostics = Object.freeze({
  mode: 'local',
  storage: 'in-memory',
  durability: 'ephemeral',
  builtInNetworkClients: 'none',
  automaticNetworkActivity: 'none',
  networkIsolationEnforced: false,
  defaultMemoryPolicy: 'deny',
  deploymentReady: false,
});

/**
 * Trusted diagnostics for a LocalHost assembled with a real SQLite MemoryPort.
 * Does not claim Neo wiring, systemd, durable approval/audit, or deployment readiness.
 */
export const SQLITE_BACKED_LOCAL_HOST_DIAGNOSTICS: LocalHostDiagnostics = Object.freeze({
  mode: 'local',
  storage: 'sqlite-local',
  durability: 'sqlite-local',
  builtInNetworkClients: 'none',
  automaticNetworkActivity: 'none',
  networkIsolationEnforced: false,
  defaultMemoryPolicy: 'deny',
  deploymentReady: false,
});
