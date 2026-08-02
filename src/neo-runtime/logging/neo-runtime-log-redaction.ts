/** Bounded redaction for structured Neo runtime log lines. */
export const redactNeoRuntimeLogText = (text: string): string =>
  text
    .replace(/\/(?:var|run|etc|home|opt)[^\s'"]+/g, '<path>')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<email>')
    .replace(/\b(token|secret|password|apikey|api_key)\b/gi, '<redacted>');
