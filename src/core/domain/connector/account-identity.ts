import {
  CONNECTOR_ACCOUNT_IDENTITY_MAX_LENGTH,
  CONNECTOR_ACCOUNT_IDENTITY_MAX_UTF8_BYTES,
} from './constants.js';
import type { AccountIdentityFailure } from './connection.js';
import { err, ok, type Result } from '../result.js';

const CREDENTIAL_FIELD_PATTERN =
  /^(password|secret|token|apiKey|api_key|credential|privateKey|cookie|bearer)$/i;

const BEARER_TOKEN_PATTERN = /^Bearer\s+/i;

const hasControl = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

export const validateAccountIdentity = (value: unknown): Result<string, AccountIdentityFailure> => {
  if (typeof value !== 'string')
    return err({ code: 'EMPTY', reason: 'Account identity must be a string.' });
  if (value.length === 0)
    return err({ code: 'EMPTY', reason: 'Account identity must not be empty.' });
  if (value.includes('\0'))
    return err({ code: 'NUL', reason: 'Account identity must not contain NUL.' });
  if (hasControl(value))
    return err({
      code: 'CONTROL_CHAR',
      reason: 'Account identity must not contain control characters.',
    });
  if (value.length > CONNECTOR_ACCOUNT_IDENTITY_MAX_LENGTH)
    return err({ code: 'TOO_LONG', reason: 'Account identity exceeds maximum length.' });
  const utf8Bytes = new TextEncoder().encode(value).length;
  if (utf8Bytes > CONNECTOR_ACCOUNT_IDENTITY_MAX_UTF8_BYTES)
    return err({ code: 'UTF8_TOO_LARGE', reason: 'Account identity exceeds maximum UTF-8 size.' });
  if (CREDENTIAL_FIELD_PATTERN.test(value))
    return err({
      code: 'CREDENTIAL_FIELD',
      reason: 'Account identity looks like a credential field.',
    });
  if (BEARER_TOKEN_PATTERN.test(value))
    return err({ code: 'CREDENTIAL_FIELD', reason: 'Account identity looks like a bearer token.' });
  return ok(value);
};
