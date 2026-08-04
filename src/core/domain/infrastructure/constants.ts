export const INFRASTRUCTURE_CONNECTOR_ID = 'infrastructure' as const;
export const INFRASTRUCTURE_REFERENCE_PROVIDER_ID = 'reference-provider' as const;
export const INFRASTRUCTURE_REFERENCE_HOST_ID = 'reference-host' as const;

export const INFRASTRUCTURE_HARD_DENIED_TOOL_IDS = Object.freeze([
  'infrastructure.server.delete',
  'infrastructure.firewall.change',
  'infrastructure.credential.rotate',
  'infrastructure.provider.purchase',
  'infrastructure.provider.plan.change',
] as const);

export type InfrastructureHardDeniedToolId = (typeof INFRASTRUCTURE_HARD_DENIED_TOOL_IDS)[number];

export const INFRASTRUCTURE_FORBIDDEN_GENERIC_TOOL_IDS = Object.freeze([
  'infrastructure.execute',
  'infrastructure.shell',
  'infrastructure.ssh',
  'infrastructure.command',
] as const);

export const DEFAULT_OBSERVATION_STALE_MS = 300_000;
