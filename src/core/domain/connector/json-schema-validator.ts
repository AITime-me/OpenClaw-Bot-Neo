import {
  CONNECTOR_JSON_MAX_ARRAY_ITEMS,
  CONNECTOR_JSON_MAX_DEPTH,
  CONNECTOR_JSON_MAX_OBJECT_KEYS,
  CONNECTOR_JSON_MAX_STRING_LENGTH,
} from './constants.js';
import type { JsonValue } from './json.js';
import type { JsonSchema, SchemaValidationFailure } from './schema.js';
import { err, ok, type Result } from '../result.js';

const SCHEMA_TYPES = new Set(['object', 'string', 'number', 'integer', 'boolean', 'array']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fail = (code: SchemaValidationFailure['code'], path: string, reason: string) =>
  err({ code, path, reason });

export const validateJsonSchemaDefinition = (
  raw: unknown,
  depth = 0,
): Result<JsonSchema, SchemaValidationFailure> => {
  if (depth > CONNECTOR_JSON_MAX_DEPTH)
    return fail('TOO_DEEP', '$', 'Schema exceeds maximum nesting depth.');
  if (!isRecord(raw)) return fail('INVALID_SCHEMA', '$', 'Schema must be an object.');
  if (typeof raw.type !== 'string' || !SCHEMA_TYPES.has(raw.type))
    return fail('INVALID_SCHEMA', '$', 'Schema type is unsupported.');
  const type = raw.type as JsonSchema['type'];
  const allowed = new Set(['type']);
  const optional = [
    'properties',
    'required',
    'additionalProperties',
    'enum',
    'minimum',
    'maximum',
    'minLength',
    'maxLength',
    'minItems',
    'maxItems',
    'items',
  ];
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key) && !optional.includes(key))
      return fail('INVALID_SCHEMA', '$', `Unsupported schema field "${key}".`);
  }
  if (type === 'object') {
    if (raw.additionalProperties !== false)
      return fail('INVALID_SCHEMA', '$', 'Object schemas must set additionalProperties=false.');
    if (raw.properties !== undefined) {
      if (!isRecord(raw.properties))
        return fail('INVALID_SCHEMA', '$.properties', 'properties must be an object.');
      const keys = Object.keys(raw.properties);
      if (keys.length > CONNECTOR_JSON_MAX_OBJECT_KEYS)
        return fail('INVALID_SCHEMA', '$.properties', 'Too many properties.');
      const properties: Record<string, JsonSchema> = {};
      for (const key of keys) {
        const child = validateJsonSchemaDefinition(raw.properties[key], depth + 1);
        if (!child.ok) return child;
        properties[key] = child.value;
      }
      const required =
        raw.required === undefined
          ? undefined
          : Array.isArray(raw.required) &&
              raw.required.every((item) => typeof item === 'string') &&
              raw.required.length <= keys.length
            ? raw.required
            : null;
      if (required === null)
        return fail('INVALID_SCHEMA', '$.required', 'required must be a string array.');
      return ok({
        type,
        properties,
        ...(required ? { required: Object.freeze([...required]) } : {}),
        additionalProperties: false,
      });
    }
    return ok({ type, additionalProperties: false });
  }
  if (type === 'array') {
    if (raw.items === undefined) return fail('INVALID_SCHEMA', '$', 'Array schema requires items.');
    const items = validateJsonSchemaDefinition(raw.items, depth + 1);
    if (!items.ok) return items;
    const maxItems =
      raw.maxItems === undefined
        ? undefined
        : typeof raw.maxItems === 'number' && raw.maxItems >= 0
          ? raw.maxItems
          : null;
    if (maxItems === null)
      return fail('INVALID_SCHEMA', '$.maxItems', 'maxItems must be a number.');
    const minItems =
      raw.minItems === undefined
        ? undefined
        : typeof raw.minItems === 'number'
          ? raw.minItems
          : undefined;
    return ok({
      type,
      items: items.value,
      ...(minItems === undefined ? {} : { minItems }),
      ...(maxItems === undefined ? {} : { maxItems }),
    });
  }
  let minimum: number | undefined;
  let maximum: number | undefined;
  let minLength: number | undefined;
  let maxLength: number | undefined;
  if (raw.enum !== undefined) {
    if (!Array.isArray(raw.enum) || raw.enum.length === 0)
      return fail('INVALID_SCHEMA', '$.enum', 'enum must be a non-empty array.');
  }
  for (const bound of ['minimum', 'maximum', 'minLength', 'maxLength'] as const) {
    if (raw[bound] !== undefined) {
      if (typeof raw[bound] !== 'number')
        return fail('INVALID_SCHEMA', `$.${bound}`, `${bound} must be a number.`);
      if (bound === 'minimum') minimum = raw[bound];
      if (bound === 'maximum') maximum = raw[bound];
      if (bound === 'minLength') minLength = raw[bound];
      if (bound === 'maxLength') maxLength = raw[bound];
    }
  }
  if (type === 'string' && maxLength === undefined) maxLength = CONNECTOR_JSON_MAX_STRING_LENGTH;
  return ok({
    type,
    ...(raw.enum !== undefined
      ? { enum: Object.freeze([...(raw.enum as readonly (string | number | boolean | null)[])]) }
      : {}),
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
    ...(minLength === undefined ? {} : { minLength }),
    ...(maxLength === undefined ? {} : { maxLength }),
  });
};

const validateAgainst = (
  schema: JsonSchema,
  value: JsonValue,
  path: string,
  depth: number,
): Result<void, SchemaValidationFailure> => {
  if (depth > CONNECTOR_JSON_MAX_DEPTH)
    return fail('TOO_DEEP', path, 'Value exceeds maximum nesting depth.');
  switch (schema.type) {
    case 'boolean':
      return typeof value === 'boolean'
        ? ok(undefined)
        : fail('TYPE_MISMATCH', path, 'Expected boolean.');
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value))
        return fail('TYPE_MISMATCH', path, 'Expected number.');
      if (schema.minimum !== undefined && value < schema.minimum)
        return fail('BOUND_VIOLATION', path, 'Number is below minimum.');
      if (schema.maximum !== undefined && value > schema.maximum)
        return fail('BOUND_VIOLATION', path, 'Number is above maximum.');
      if (schema.enum !== undefined && !schema.enum.some((item) => item === value))
        return fail('ENUM_MISMATCH', path, 'Value not in enum.');
      return ok(undefined);
    }
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value))
        return fail('TYPE_MISMATCH', path, 'Expected integer.');
      if (schema.minimum !== undefined && value < schema.minimum)
        return fail('BOUND_VIOLATION', path, 'Number is below minimum.');
      if (schema.maximum !== undefined && value > schema.maximum)
        return fail('BOUND_VIOLATION', path, 'Number is above maximum.');
      if (schema.enum !== undefined && !schema.enum.some((item) => item === value))
        return fail('ENUM_MISMATCH', path, 'Value not in enum.');
      return ok(undefined);
    }
    case 'string': {
      if (typeof value !== 'string') return fail('TYPE_MISMATCH', path, 'Expected string.');
      if (schema.minLength !== undefined && value.length < schema.minLength)
        return fail('BOUND_VIOLATION', path, 'String is too short.');
      if (schema.maxLength !== undefined && value.length > schema.maxLength)
        return fail('BOUND_VIOLATION', path, 'String is too long.');
      if (schema.enum !== undefined && !schema.enum.some((item) => item === value))
        return fail('ENUM_MISMATCH', path, 'Value not in enum.');
      return ok(undefined);
    }
    case 'array': {
      if (!Array.isArray(value)) return fail('TYPE_MISMATCH', path, 'Expected array.');
      if (schema.minItems !== undefined && value.length < schema.minItems)
        return fail('BOUND_VIOLATION', path, 'Array has too few items.');
      if (schema.maxItems !== undefined && value.length > schema.maxItems)
        return fail('BOUND_VIOLATION', path, 'Array has too many items.');
      if (value.length > CONNECTOR_JSON_MAX_ARRAY_ITEMS)
        return fail('BOUND_VIOLATION', path, 'Array exceeds platform item limit.');
      if (!schema.items) return ok(undefined);
      for (let index = 0; index < value.length; index += 1) {
        const item = validateAgainst(
          schema.items,
          value[index] as JsonValue,
          `${path}[${String(index)}]`,
          depth + 1,
        );
        if (!item.ok) return item;
      }
      return ok(undefined);
    }
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value))
        return fail('TYPE_MISMATCH', path, 'Expected object.');
      const object = value as Record<string, JsonValue>;
      const keys = Object.keys(object);
      if (keys.length > CONNECTOR_JSON_MAX_OBJECT_KEYS)
        return fail('BOUND_VIOLATION', path, 'Object has too many keys.');
      const properties = schema.properties ?? {};
      const required = schema.required ?? [];
      for (const key of required) {
        if (!Object.hasOwn(object, key))
          return fail('MISSING_REQUIRED', `${path}.${key}`, 'Required property is missing.');
      }
      for (const key of keys) {
        if (!Object.hasOwn(properties, key))
          return fail(
            'ADDITIONAL_PROPERTY',
            `${path}.${key}`,
            'Additional property is not allowed.',
          );
        const child = validateAgainst(
          properties[key] as JsonSchema,
          object[key] as JsonValue,
          `${path}.${key}`,
          depth + 1,
        );
        if (!child.ok) return child;
      }
      return ok(undefined);
    }
    default:
      return fail('INVALID_SCHEMA', path, 'Unsupported schema type.');
  }
};

export const validateJsonAgainstSchema = (
  schema: JsonSchema,
  value: JsonValue,
): Result<void, SchemaValidationFailure> => validateAgainst(schema, value, '$', 0);

export const redactSchemaFailure = (failure: SchemaValidationFailure): string =>
  `${failure.code} at ${failure.path}`;
