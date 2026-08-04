export type JsonSchemaType = 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';

export interface JsonSchema {
  readonly type: JsonSchemaType;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: false;
  readonly enum?: readonly (string | number | boolean | null)[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly items?: JsonSchema;
}

export type SchemaValidationFailureCode =
  | 'INVALID_SCHEMA'
  | 'TYPE_MISMATCH'
  | 'MISSING_REQUIRED'
  | 'ADDITIONAL_PROPERTY'
  | 'ENUM_MISMATCH'
  | 'BOUND_VIOLATION'
  | 'TOO_DEEP';

export interface SchemaValidationFailure {
  readonly code: SchemaValidationFailureCode;
  readonly path: string;
  readonly reason: string;
}
