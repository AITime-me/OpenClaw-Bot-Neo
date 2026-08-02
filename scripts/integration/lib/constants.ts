/** Build 3.3B3C4B durable composition Linux gate constants. */

export const GATE_OPT_IN_ENV = 'OPENCLAW_LINUX_DURABLE_COMPOSITION_GATE' as const;
export const GATE_EXPECTED_HEAD_ENV = 'OPENCLAW_LINUX_DURABLE_COMPOSITION_EXPECTED_HEAD' as const;
export const GATE_EXPECTED_LOCK_SHA256_ENV =
  'OPENCLAW_LINUX_DURABLE_COMPOSITION_EXPECTED_LOCK_SHA256' as const;

export const GATE_PROTOCOL_VERSION = 1 as const;
export const GATE_SCHEMA_VERSION = '3.3B3C4B' as const;
export const DISPOSABLE_ROOT_PREFIX = 'openclaw-b3c4-' as const;
export const MARKER_FILENAME = '.openclaw-b3c4-marker' as const;
export const MARKER_SCHEMA_VERSION = '1' as const;

export const REQUIRED_NODE_VERSION = '22.13.0' as const;
export const REQUIRED_NPM_VERSION = '10.9.2' as const;
/** Ubuntu 24.04 ships glibc 2.39. */
export const REQUIRED_GLIBC_MAJOR = 2 as const;
export const REQUIRED_GLIBC_MINOR = 39 as const;

export const EXIT_SUCCESS = 0;
export const EXIT_LOCK_CONTENTION = 10;
export const EXIT_ENVIRONMENT_GATE_FAILED = 20;
export const EXIT_COMPOSITION_FAILURE = 30;
export const EXIT_ASSERTION_FAILURE = 40;
export const EXIT_PROTOCOL_FAILURE = 50;

export const PASS_MARKER = 'BUILD_3_3B3C4_LINUX_COMPOSITION_GATE_PASSED' as const;

export const TRUSTED_LINUX_PATH =
  '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' as const;

export const MAX_PROTOCOL_LINE_BYTES = 16_384 as const;

export const STORAGE_ROOT_ALLOWED_FILENAMES = Object.freeze([
  'neo.primary.lock',
  'neo-memory.sqlite',
  'neo-memory.sqlite-wal',
  'neo-memory.sqlite-shm',
] as const);

export const REQUIRED_SCENARIO_KEYS = Object.freeze([
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
] as const);

export const CHILD_ENV_ALLOWLIST = Object.freeze([
  'PATH',
  'HOME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'TZ',
  GATE_OPT_IN_ENV,
  GATE_EXPECTED_HEAD_ENV,
  GATE_EXPECTED_LOCK_SHA256_ENV,
  'OPENCLAW_B3C4_RUN_ID',
  'OPENCLAW_B3C4_ROLE',
  'OPENCLAW_B3C4_PROTOCOL_VERSION',
  'OPENCLAW_B3C4_STORAGE_ROOT',
  'OPENCLAW_B3C4_STORAGE_REALPATH',
  'OPENCLAW_B3C4_STORAGE_DEV',
  'OPENCLAW_B3C4_STORAGE_INODE',
  'OPENCLAW_B3C4_EXECUTION_ROOT',
  'OPENCLAW_B3C4_EXECUTION_REALPATH',
  'OPENCLAW_B3C4_EXECUTION_DEV',
  'OPENCLAW_B3C4_EXECUTION_INODE',
  'OPENCLAW_B3C4_DISPOSABLE_PARENT_REALPATH',
  'OPENCLAW_B3C4_MARKER_DEV',
  'OPENCLAW_B3C4_MARKER_INODE',
  'OPENCLAW_B3C4_PARENT_CAPABILITY',
  'OPENCLAW_B3C4_REPOSITORY_ROOT',
  'OPENCLAW_B3C4_EXPECTED_UID',
  'OPENCLAW_B3C4_SCENARIO',
  'OPENCLAW_B3C4_USE_TEST_HOOKS',
  'OPENCLAW_B3C4_RECORD_ID',
  'OPENCLAW_B3C4_OWNER_ID',
] as const);

export const CHILD_ROLES = Object.freeze([
  'holder',
  'contender',
  'writer',
  'reader',
  'rollback',
  'flock-wait',
  'normal',
  'repeated-close',
] as const);

export type ChildRole = (typeof CHILD_ROLES)[number];

export const isChildRole = (value: string): value is ChildRole =>
  (CHILD_ROLES as readonly string[]).includes(value);

export type ProtocolEvent =
  | 'READY'
  | 'WRITE_CONFIRMED'
  | 'READ_CONFIRMED'
  | 'READ_REJECTED'
  | 'ACCESS_DENIED'
  | 'HELD'
  | 'CLOSED'
  | 'FAILED';

export const PRODUCTION_FACTORY_MODULE =
  '../../../src/host/durable/create-posix-durable-local-host.ts' as const;
