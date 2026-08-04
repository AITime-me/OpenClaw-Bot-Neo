/** Bounded JSON and invocation limits for the connector platform foundation. */
export const CONNECTOR_JSON_MAX_DEPTH = 16;
export const CONNECTOR_JSON_MAX_OBJECT_KEYS = 128;
export const CONNECTOR_JSON_MAX_ARRAY_ITEMS = 128;
export const CONNECTOR_JSON_MAX_STRING_LENGTH = 16_384;
export const CONNECTOR_JSON_MAX_KEY_LENGTH = 256;
export const CONNECTOR_JSON_MAX_SERIALIZED_INPUT_BYTES = 65_536;
export const CONNECTOR_JSON_MAX_SERIALIZED_OUTPUT_BYTES = 65_536;

export const CONNECTOR_MIN_TIMEOUT_MS = 100;
export const CONNECTOR_MAX_MANIFEST_TIMEOUT_MS = 300_000;
export const CONNECTOR_PLATFORM_MAX_TIMEOUT_MS = 300_000;

export const CONNECTOR_MANIFEST_SCHEMA_VERSION = 'connector-platform/1' as const;
export const CONNECTOR_TOOL_MANIFEST_SCHEMA_VERSION = 'connector-tool/1' as const;

export const CONNECTOR_SECRET_PROVIDER_CONFIGURED = false as const;

/** Bounded non-secret account identity stored on AccountConnection. */
export const CONNECTOR_ACCOUNT_IDENTITY_MAX_LENGTH = 256;
export const CONNECTOR_ACCOUNT_IDENTITY_MAX_UTF8_BYTES = 512;
