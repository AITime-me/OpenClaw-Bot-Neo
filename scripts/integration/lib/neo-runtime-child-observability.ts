import { redactNeoGateText } from './redaction.ts';

export type NeoChildObservability = {
  readonly childStdoutSummary: string;
  readonly childStderrSummary: string;
  readonly unsettledTopLevelAwaitWarning: boolean;
  readonly observedRuntimeEventNames: readonly string[];
  readonly shutdownTimeoutEventObserved: boolean;
  readonly neoChildAliveBeforeSignal: boolean | null;
};

export const UNSETTLED_TOP_LEVEL_AWAIT_PATTERN = /unsettled top-level await/i;

/** Only verified Neo structured runtime event names are counted as observability evidence. */
const VERIFIED_NEO_RUNTIME_EVENT_PATTERN = /^neo\.(runtime|signal|config)\.[a-z0-9_]+$/;

const isVerifiedNeoRuntimeEventName = (value: string): boolean =>
  VERIFIED_NEO_RUNTIME_EVENT_PATTERN.test(value);

export const extractObservedRuntimeEventNames = (
  stdout: string,
  stderr: string,
): readonly string[] => {
  const names = new Set<string>();
  for (const chunk of [stdout, stderr]) {
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(trimmed) as { readonly event?: unknown };
        if (typeof parsed.event === 'string' && isVerifiedNeoRuntimeEventName(parsed.event)) {
          names.add(parsed.event);
        }
      } catch {
        // Ignore non-JSON lines.
      }
    }
  }
  return Object.freeze([...names].sort());
};

export const summarizeNeoChildObservability = (input: {
  readonly stdout: string;
  readonly stderr: string;
  readonly neoChildAliveBeforeSignal?: boolean | null;
}): NeoChildObservability => {
  const childStdoutSummary = redactNeoGateText(input.stdout.trim().slice(-256));
  const childStderrSummary = redactNeoGateText(input.stderr.trim().slice(-256));
  const observedRuntimeEventNames = extractObservedRuntimeEventNames(input.stdout, input.stderr);
  return Object.freeze({
    childStdoutSummary,
    childStderrSummary,
    unsettledTopLevelAwaitWarning: UNSETTLED_TOP_LEVEL_AWAIT_PATTERN.test(
      `${input.stdout}\n${input.stderr}`,
    ),
    observedRuntimeEventNames,
    shutdownTimeoutEventObserved: observedRuntimeEventNames.includes(
      'neo.runtime.shutdown_timeout',
    ),
    neoChildAliveBeforeSignal: input.neoChildAliveBeforeSignal ?? null,
  });
};
