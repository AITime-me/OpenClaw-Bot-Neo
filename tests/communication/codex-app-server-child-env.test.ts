import { describe, expect, it } from 'vitest';
import { buildCodexAppServerChildEnv } from '../../src/communication/adapters/codex-app-server/codex-app-server-child-env.js';

describe('codex-app-server child env', () => {
  it('builds allowlisted env without PATH', () => {
    const built = buildCodexAppServerChildEnv({
      codexHome: '/tmp/neo-codex-home',
      noColor: '1',
      term: 'dumb',
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.env.CODEX_HOME).toBe('/tmp/neo-codex-home');
    expect(built.env.HOME).toBe('/tmp/neo-codex-home');
    expect(built.env.PATH).toBeUndefined();
    expect(built.env.OPENAI_API_KEY).toBeUndefined();
  });

  it('rejects relative CODEX_HOME', () => {
    const built = buildCodexAppServerChildEnv({ codexHome: 'relative-home' });
    expect(built.ok).toBe(false);
  });
});
