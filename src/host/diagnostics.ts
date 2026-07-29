/**
 * Honest local-composition diagnostics. Build 3.0 is not deployment-ready and does not
 * enforce OS/network sandbox isolation for injected dependencies.
 */
export interface LocalHostDiagnostics {
  readonly mode: 'local';
  readonly storage: 'in-memory';
  readonly durability: 'ephemeral';
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
