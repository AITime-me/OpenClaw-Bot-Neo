import type { ISO8601 } from '../identity.js';
import type { EventId } from '../identity.js';
import type { ServerId, ServiceId } from './identity.js';
import type { DriftKind } from './drift.js';
import type { ServerLifecycleStatus } from './capabilities.js';

export type InfrastructureDomainEvent =
  | {
      readonly kind: 'server.discovered';
      readonly eventId: EventId;
      readonly observedAt: ISO8601;
      readonly serverId: ServerId;
    }
  | {
      readonly kind: 'server.state.observed';
      readonly eventId: EventId;
      readonly observedAt: ISO8601;
      readonly serverId: ServerId;
      readonly lifecycleStatus: ServerLifecycleStatus;
    }
  | {
      readonly kind: 'server.health.changed';
      readonly eventId: EventId;
      readonly observedAt: ISO8601;
      readonly serverId: ServerId;
      readonly healthState: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
    }
  | {
      readonly kind: 'service.discovered';
      readonly eventId: EventId;
      readonly observedAt: ISO8601;
      readonly serviceId: ServiceId;
      readonly serverId: ServerId;
    }
  | {
      readonly kind: 'service.state.observed';
      readonly eventId: EventId;
      readonly observedAt: ISO8601;
      readonly serviceId: ServiceId;
      readonly serverId: ServerId;
    }
  | {
      readonly kind: 'service.health.changed';
      readonly eventId: EventId;
      readonly observedAt: ISO8601;
      readonly serviceId: ServiceId;
      readonly serverId: ServerId;
      readonly healthState: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
    }
  | {
      readonly kind: 'drift.detected';
      readonly eventId: EventId;
      readonly observedAt: ISO8601;
      readonly serverId: ServerId | null;
      readonly serviceId: ServiceId | null;
      readonly driftKind: DriftKind;
    };
