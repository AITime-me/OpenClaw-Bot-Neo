import type { ISO8601 } from '../identity.js';
import { deepFreeze } from '../immutable.js';
import type { ServerId, ServiceId } from './identity.js';
import type { ContentTrust, LogSourceType } from './capabilities.js';

export interface InfrastructureLogRequest {
  readonly serverId: ServerId;
  readonly serviceId: ServiceId;
  readonly since: ISO8601 | null;
  readonly maximumLines: number;
  readonly maximumBytes: number;
  readonly logSourceType: LogSourceType;
}

export interface InfrastructureLogResult {
  readonly lines: readonly string[];
  readonly contentTrust: ContentTrust;
  readonly truncated: boolean;
  readonly originalSizeKnown: boolean;
  readonly returnedBytes: number;
  readonly redactionCount: number;
  readonly controlCharacterReplacementCount: number;
  readonly observedAt: ISO8601;
}

export const sealLogResult = (result: InfrastructureLogResult): InfrastructureLogResult =>
  deepFreeze({
    ...result,
    lines: Object.freeze([...result.lines]),
  });

export interface SanitizedLogChunk {
  readonly text: string;
  readonly truncated: boolean;
}
