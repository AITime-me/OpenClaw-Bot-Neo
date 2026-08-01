/**
 * App-private durable composition diagnostics for Build 3.3B3C1.
 * Claims lifecycle controller implementation only — not real resource wiring.
 */
export interface DurableLocalHostOwnerDiagnostics {
  readonly ownerLifecycleImplemented: true;
  readonly operationGateImplemented: true;
  readonly orderedShutdownImplemented: true;
  readonly retryableCloseImplemented: true;
  readonly realPosixRootWired: false;
  readonly realProcessLockWired: false;
  readonly realSqliteMemoryWired: false;
  readonly durableMemoryActive: false;
  readonly cooperativeSecondInstanceProtectionActiveForDurableHost: false;
  readonly processLockWiredToNeo: false;
  readonly localHostProductionWired: false;
  readonly systemdLayerConfigured: false;
  readonly durableApprovalPort: false;
  readonly durableAuditPort: false;
  readonly secretProviderConfigured: false;
  readonly encryptionEnabled: false;
  readonly distributedFilesystemSupported: false;
  readonly deploymentReady: false;
}

export const DURABLE_LOCAL_HOST_OWNER_DIAGNOSTICS: DurableLocalHostOwnerDiagnostics = Object.freeze(
  {
    ownerLifecycleImplemented: true,
    operationGateImplemented: true,
    orderedShutdownImplemented: true,
    retryableCloseImplemented: true,
    realPosixRootWired: false,
    realProcessLockWired: false,
    realSqliteMemoryWired: false,
    durableMemoryActive: false,
    cooperativeSecondInstanceProtectionActiveForDurableHost: false,
    processLockWiredToNeo: false,
    localHostProductionWired: false,
    systemdLayerConfigured: false,
    durableApprovalPort: false,
    durableAuditPort: false,
    secretProviderConfigured: false,
    encryptionEnabled: false,
    distributedFilesystemSupported: false,
    deploymentReady: false,
  },
);
