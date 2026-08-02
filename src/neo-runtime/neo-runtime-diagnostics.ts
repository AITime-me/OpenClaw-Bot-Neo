/**
 * Honest Neo runtime diagnostics. Records disposable Linux runtime/systemd evidence where approved.
 * Does not claim production deployment, security approval, or channel readiness.
 */
export interface NeoRuntimeDiagnostics {
  readonly neoRuntimeLifecycleFoundationImplemented: true;
  readonly neoCompiledProcessBoundaryImplemented: true;
  readonly neoSignalConfigReadinessFoundationImplemented: true;
  readonly processLockWiredToNeo: true;
  readonly neoSecondInstanceProtectionActive: true;
  readonly systemdLayerConfigured: true;
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
  processLockWiredToNeo: true,
  neoSecondInstanceProtectionActive: true,
  systemdLayerConfigured: true,
  deploymentReady: false,
  securityApprovalComplete: false,
  secretProviderConfigured: false,
  encryptionEnabled: false,
  durableApprovalPort: false,
  durableAuditPort: false,
});
