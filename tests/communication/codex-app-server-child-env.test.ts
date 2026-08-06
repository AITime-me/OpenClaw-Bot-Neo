import { describe, expect, it } from 'vitest';
import { buildCodexAppServerChildEnv } from '../../src/communication/adapters/codex-app-server/codex-app-server-child-env.js';

describe('codex-app-server child env', () => {
  it('builds allowlisted env without PATH and with isolated temp/home', () => {
    const built = buildCodexAppServerChildEnv({
      codexHome: '/tmp/neo-codex-home',
      home: '/tmp/neo-codex-home',
      tempDir: '/tmp/neo-codex-home/tmp',
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.env.PATH).toBeUndefined();
    expect(built.env.CODEX_HOME).toBe('/tmp/neo-codex-home');
    expect(built.env.USERPROFILE).toBe('/tmp/neo-codex-home');
    expect(built.env.TMPDIR).toBe('/tmp/neo-codex-home/tmp');
  });

  it('rejects relative CODEX_HOME', () => {
    expect(
      buildCodexAppServerChildEnv({
        codexHome: 'relative',
        home: '/tmp/x',
        tempDir: '/tmp/x/tmp',
      }).ok,
    ).toBe(false);
  });
});
