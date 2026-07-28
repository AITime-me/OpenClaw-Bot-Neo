import type { ISO8601 } from './identity.js';
export type QuotaWindow =
  | {
      readonly kind: 'chatgpt-codex-subscription';
      readonly startsAt: ISO8601;
      readonly endsAt: ISO8601;
      readonly remaining: number | null;
    }
  | {
      readonly kind: 'openai-platform-api';
      readonly startsAt: ISO8601;
      readonly endsAt: ISO8601;
      readonly usageUnits: number;
    }
  | {
      readonly kind: 'other-api-provider';
      readonly provider: string;
      readonly startsAt: ISO8601;
      readonly endsAt: ISO8601;
      readonly usageUnits: number;
    };
