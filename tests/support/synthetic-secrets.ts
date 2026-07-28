/**
 * Synthetic samples only. Every value is assembled from fragments so no complete
 * secret-shaped literal exists in the repository.
 */
const join = (...parts: readonly string[]): string => parts.join('');

export const TELEGRAM_BOT_TOKEN = join('123456789', ':', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcd1234');
export const BEARER_HEADER = join('Authorization: Bearer ', 'qwertyuiopasdfghjklzxcvb0123');
export const BEARER_VALUE = 'qwertyuiopasdfghjklzxcvb0123';
export const URL_WITH_CREDENTIALS = join(
  'https://',
  'alice',
  ':',
  'wonderland',
  '@',
  'example.com/path',
);
export const URL_WITH_ENCODED_CREDENTIALS = join(
  'https://',
  'al%69ce',
  '%3A',
  'w0nderland',
  '@',
  'example.com/path',
);
export const CONNECTION_STRING = join(
  'postgresql://',
  'admin',
  ':',
  'trustno1',
  '@',
  'db.example.com/main',
);
export const PEM_BLOCK = [
  join('-----BEGIN', ' PRIVATE KEY-----'),
  'c3ludGhldGljLXBsYWNlaG9sZGVy',
  join('-----END', ' PRIVATE KEY-----'),
].join('\n');
export const UNTERMINATED_PEM = [
  join('-----BEGIN', ' PRIVATE KEY-----'),
  'dHJ1bmNhdGVkLXBsYWNlaG9sZGVy',
].join('\n');

export const QUOTED_PASSWORD_VALUE = 'correct horse battery staple';
export const QUOTED_PASSWORD_LINE = `password = "${QUOTED_PASSWORD_VALUE}"`;
export const QUOTED_API_KEY_VALUE = 'zXcVbNm QwErTyU 0987654321';
export const QUOTED_API_KEY_LINE = `api_key = "${QUOTED_API_KEY_VALUE}"`;
export const SINGLE_QUOTED_VALUE = 'single quoted value with spaces';
export const SINGLE_QUOTED_LINE = `client_secret='${SINGLE_QUOTED_VALUE}'`;
export const UNQUOTED_PASSWORD_VALUE = 'hunter two three';
export const UNQUOTED_PASSWORD_LINE = `password = ${UNQUOTED_PASSWORD_VALUE}`;
export const COOKIE_VALUE = 'session=abc123; refresh=def456';
export const COOKIE_LINE = `Cookie: ${COOKIE_VALUE}`;
