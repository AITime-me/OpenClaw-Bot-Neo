import type { CodexExecutablePin } from './codex-app-server-executable-pin.js';
import { CLI_AUTH_CREDENTIALS_STORE } from './codex-app-server-protocol.js';

/** Normative credential store for isolated CODEX_HOME (Neo never reads credential files). */
export { CLI_AUTH_CREDENTIALS_STORE };

export type CodexAppServerTimeouts = {
  readonly preflightTimeoutMs: number;
  readonly threadStartTimeoutMs: number;
  readonly turnTimeoutMs: number;
  readonly exitWaitMs: number;
  readonly termGraceMs: number;
  readonly closeBudgetMs: number;
  readonly unsubscribeBudgetMs: number;
  readonly interruptBudgetMs: number;
  readonly totalActiveCleanupBudgetMs: number;
  readonly reapBudgetMs: number;
};

export const DEFAULT_CODEX_APP_SERVER_TIMEOUTS: CodexAppServerTimeouts = Object.freeze({
  preflightTimeoutMs: 15_000,
  threadStartTimeoutMs: 10_000,
  turnTimeoutMs: 60_000,
  exitWaitMs: 2_000,
  termGraceMs: 1_000,
  closeBudgetMs: 5_000,
  unsubscribeBudgetMs: 2_000,
  interruptBudgetMs: 2_000,
  totalActiveCleanupBudgetMs: 10_000,
  reapBudgetMs: 1_000,
});

export type CodexAppServerRouteConfig = {
  readonly pin: CodexExecutablePin;
  readonly codexHome: string;
  readonly home?: string;
  readonly lang?: string;
  readonly lcAll?: string;
  readonly tz?: string;
  readonly timeouts?: Partial<CodexAppServerTimeouts>;
};

export const resolveTimeouts = (
  partial?: Partial<CodexAppServerTimeouts>,
): CodexAppServerTimeouts =>
  Object.freeze({
    ...DEFAULT_CODEX_APP_SERVER_TIMEOUTS,
    ...(partial ?? {}),
  });
