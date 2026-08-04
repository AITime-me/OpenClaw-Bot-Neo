export const SERVER_MANAGEMENT_CAPABILITIES = Object.freeze([
  'inspect-provider',
  'inspect-host',
  'inspect-services',
  'read-logs',
  'restart-service',
  'deploy-release',
  'rollback-release',
  'reboot-server',
] as const);

export type ServerManagementCapability = (typeof SERVER_MANAGEMENT_CAPABILITIES)[number];

export const SERVICE_MANAGEMENT_CAPABILITIES = Object.freeze([
  'inspect-status',
  'read-logs',
  'restart-service',
  'deploy-release',
  'rollback-release',
] as const);

export type ServiceManagementCapability = (typeof SERVICE_MANAGEMENT_CAPABILITIES)[number];

export const SERVER_LIFECYCLE_STATUSES = Object.freeze([
  'planned',
  'provisioning',
  'active',
  'degraded',
  'suspended',
  'decommissioning',
  'decommissioned',
  'unknown',
] as const);

export type ServerLifecycleStatus = (typeof SERVER_LIFECYCLE_STATUSES)[number];

export const SERVICE_TYPES = Object.freeze([
  'neo-runtime',
  'postgresql',
  'redis',
  'reverse-proxy',
  'nextjs-application',
  'worker',
  'telegram-bot',
  'n8n',
  'monitoring-agent',
  'other',
] as const);

export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SERVICE_RUNTIME_TYPES = Object.freeze([
  'systemd',
  'docker-compose',
  'node-process',
  'other',
] as const);

export type ServiceRuntimeType = (typeof SERVICE_RUNTIME_TYPES)[number];

export const SERVICE_CRITICALITY_LEVELS = Object.freeze([
  'low',
  'medium',
  'high',
  'critical',
] as const);
export type ServiceCriticality = (typeof SERVICE_CRITICALITY_LEVELS)[number];

export const SERVICE_DESIRED_STATES = Object.freeze(['stopped', 'running', 'unknown'] as const);
export type ServiceDesiredState = (typeof SERVICE_DESIRED_STATES)[number];

export const ENVIRONMENT_KINDS = Object.freeze([
  'production',
  'staging',
  'development',
  'studio',
  'lab',
  'test',
  'unknown',
] as const);

export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

export const OBSERVATION_SOURCE_KINDS = Object.freeze([
  'provider',
  'host',
  'health-endpoint',
  'reference',
] as const);

export type ObservationSourceKind = (typeof OBSERVATION_SOURCE_KINDS)[number];

export const CONTENT_TRUST_LEVELS = Object.freeze(['untrusted'] as const);
export type ContentTrust = (typeof CONTENT_TRUST_LEVELS)[number];

export const LOG_SOURCE_TYPES = Object.freeze([
  'systemd-journal',
  'file',
  'compose',
  'other',
] as const);
export type LogSourceType = (typeof LOG_SOURCE_TYPES)[number];
