export type JsonPrimitive = null | boolean | number | string;
export type JsonArray = readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

export type JsonBoundsFailureCode =
  | 'UNSUPPORTED_VALUE'
  | 'TOO_DEEP'
  | 'TOO_MANY_KEYS'
  | 'TOO_MANY_ITEMS'
  | 'STRING_TOO_LONG'
  | 'KEY_TOO_LONG'
  | 'SERIALIZED_TOO_LARGE'
  | 'NON_PLAIN'
  | 'CYCLE';

export interface JsonBoundsFailure {
  readonly code: JsonBoundsFailureCode;
  readonly reason: string;
}
