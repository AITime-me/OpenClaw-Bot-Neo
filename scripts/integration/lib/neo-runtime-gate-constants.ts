/** Build 3.4D Neo runtime Linux gate constants. */

export const NEO_GATE_OPT_IN_ENV = 'OPENCLAW_LINUX_NEO_RUNTIME_GATE' as const;
export const NEO_GATE_EXPECTED_HEAD_ENV = 'OPENCLAW_LINUX_NEO_RUNTIME_EXPECTED_HEAD' as const;
export const NEO_GATE_EXPECTED_LOCK_SHA256_ENV =
  'OPENCLAW_LINUX_NEO_RUNTIME_EXPECTED_LOCK_SHA256' as const;

export const NEO_GATE_SCHEMA_VERSION = '3.4D' as const;
export const NEO_GATE_PROTOCOL_VERSION = 1 as const;
export const NEO_DISPOSABLE_ROOT_PREFIX = 'openclaw-neo-34d-' as const;

export const REQUIRED_NODE_VERSION = '22.13.0' as const;
export const REQUIRED_NPM_VERSION = '10.9.2' as const;

export const NEO_GATE_EXIT_SUCCESS = 0 as const;
export const NEO_GATE_EXIT_ENVIRONMENT = 20 as const;
export const NEO_GATE_EXIT_RUNTIME = 30 as const;
export const NEO_GATE_EXIT_ASSERTION = 40 as const;
export const NEO_GATE_EXIT_PROTOCOL = 50 as const;

export const NEO_GATE_PASS_MARKER = 'BUILD_3_4_LINUX_NEO_RUNTIME_GATE_PASSED' as const;

export const NEO_RUNTIME_PROCESS_LOCK_EXIT = 10 as const;

export const REQUIRED_SCENARIO_KEYS = Object.freeze(['L1', 'L2', 'L3', 'L4', 'L5'] as const);

export type NeoRuntimeScenarioKey = (typeof REQUIRED_SCENARIO_KEYS)[number];

export const NEO_START_NEO_LAUNCHER = 'scripts/neo/start-neo.mjs' as const;
export const NEO_STATUS_LAUNCHER = 'scripts/neo/neo-status.mjs' as const;
export const NEO_COMPILED_PROCESS_ENTRY = 'dist/neo-runtime/cli/run-neo-process.js' as const;
export const NEO_COMPILED_STATUS_ENTRY = 'dist/neo-runtime/cli/read-neo-status.js' as const;

export const MAX_STDIO_BUFFER_BYTES = 65536;
export const DEFAULT_CHILD_TIMEOUT_MS = 60_000 as const;
export const DEFAULT_STATUS_WAIT_MS = 30_000 as const;
