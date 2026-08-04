/**
 * Test and development simulation controls for the offline infrastructure connector.
 * Not part of production ToolManifest input.
 */
import { INFRASTRUCTURE_OUTCOME_UNKNOWN_REASON } from '../../core/domain/infrastructure/constants.js';

export const INFRASTRUCTURE_CONNECTOR_SIMULATION_SCENARIOS = Object.freeze({
  serverInspect: ['ok', 'unavailable'] as const,
  serverResources: ['healthy', 'pressure', 'unavailable', 'invalid'] as const,
  serviceStatus: ['healthy', 'failed', 'unreachable'] as const,
  logFixture: ['default', 'secrets', 'truncated', 'multiline-key', 'ansi'] as const,
  drift: ['no-drift', 'lifecycle', 'service', 'capacity'] as const,
  restartMutation: ['ok', 'outcome-unknown', 'cancel'] as const,
  deployMutation: ['ok', 'outcome-unknown'] as const,
  rollbackMutation: ['ok', 'outcome-unknown'] as const,
  rebootMutation: ['ok', 'outcome-unknown'] as const,
} as const);

export type InfrastructureConnectorSimulation = {
  readonly serverInspect?: (typeof INFRASTRUCTURE_CONNECTOR_SIMULATION_SCENARIOS.serverInspect)[number];
  readonly serverResources?: (typeof INFRASTRUCTURE_CONNECTOR_SIMULATION_SCENARIOS.serverResources)[number];
  readonly serviceStatus?: (typeof INFRASTRUCTURE_CONNECTOR_SIMULATION_SCENARIOS.serviceStatus)[number];
  readonly logFixture?: (typeof INFRASTRUCTURE_CONNECTOR_SIMULATION_SCENARIOS.logFixture)[number];
  readonly drift?: (typeof INFRASTRUCTURE_CONNECTOR_SIMULATION_SCENARIOS.drift)[number];
  readonly restartMutation?: (typeof INFRASTRUCTURE_CONNECTOR_SIMULATION_SCENARIOS.restartMutation)[number];
  readonly deployMutation?: (typeof INFRASTRUCTURE_CONNECTOR_SIMULATION_SCENARIOS.deployMutation)[number];
  readonly rollbackMutation?: (typeof INFRASTRUCTURE_CONNECTOR_SIMULATION_SCENARIOS.rollbackMutation)[number];
  readonly rebootMutation?: (typeof INFRASTRUCTURE_CONNECTOR_SIMULATION_SCENARIOS.rebootMutation)[number];
};

export const DEFAULT_INFRASTRUCTURE_CONNECTOR_SIMULATION: InfrastructureConnectorSimulation =
  Object.freeze({
    serverInspect: 'ok',
    serverResources: 'healthy',
    serviceStatus: 'healthy',
    logFixture: 'default',
    drift: 'no-drift',
    restartMutation: 'ok',
    deployMutation: 'ok',
    rollbackMutation: 'ok',
    rebootMutation: 'ok',
  });

const OUTCOME_UNKNOWN_REASON = INFRASTRUCTURE_OUTCOME_UNKNOWN_REASON;

export const infrastructureMutationOutcomeUnknownError = (): {
  readonly ok: false;
  readonly error: {
    readonly code: 'unavailable';
    readonly reason: typeof OUTCOME_UNKNOWN_REASON;
    readonly category: 'internal';
  };
} => ({
  ok: false,
  error: {
    code: 'unavailable',
    reason: OUTCOME_UNKNOWN_REASON,
    category: 'internal',
  },
});

export const isInfrastructureOutcomeUnknownReason = (reason: string): boolean =>
  reason === OUTCOME_UNKNOWN_REASON;
