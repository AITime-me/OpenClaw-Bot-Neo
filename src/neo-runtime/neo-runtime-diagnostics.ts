/**
 * Honest Neo runtime diagnostics. Does not claim deployment, systemd, or channel readiness.
 */
export interface NeoRuntimeDiagnostics {
  readonly neoRuntimeLifecycleFoundationImplemented: true;
  readonly neoCompiledProcessBoundaryImplemented: true;
  readonly neoSignalConfigReadinessFoundationImplemented: true;
  readonly processLockWiredToNeo: false;
  readonly neoSecondInstanceProtectionActive: false;
  readonly systemdLayerConfigured: false;
  readonly deploymentReady: false;
  readonly securityApprovalComplete: false;
  readonly secretProviderConfigured: false;
  readonly encryptionEnabled: false;
  readonly durableApprovalPort: false;
  readonly durableAuditPort: false;
}

export const NEO_RUNTIME_DIAGNOSTICS: NeoRuntimeDiagnostics = Object.freeze({
  neoRuntimeLifecycleFoundationImplemented: true,
  neoCompiledProcessBoundaryImplemented: true,
  neoSignalConfigReadinessFoundationImplemented: true,
  processLockWiredToNeo: false,
  neoSecondInstanceProtectionActive: false,
  systemdLayerConfigured: false,
  deploymentReady: false,
  securityApprovalComplete: false,
  secretProviderConfigured: false,
  encryptionEnabled: false,
  durableApprovalPort: false,
  durableAuditPort: false,
});
