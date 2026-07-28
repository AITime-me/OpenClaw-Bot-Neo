import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateExtensionManifest } from '../src/core/policy/extension-manifest.js';
import { scanSensitiveData } from '../src/core/policy/sensitive-data-scanner.js';
import { validateVoiceProfile } from '../src/core/policy/voice-profile.js';

const load = (path: string): { readonly raw: string; readonly value: unknown } => {
  const raw = readFileSync(path, 'utf8');
  return { raw, value: JSON.parse(raw) as unknown };
};

describe('example configuration semantic consistency', () => {
  it.each([
    'config/extensions/call-analysis.skill.example.json',
    'config/extensions/external-call-service.integration.example.json',
  ])('%s matches the manifest contract and remains disabled', (path) => {
    const config = load(path);
    const result = validateExtensionManifest(config.value);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.enabled).toBe(false);
      expect(result.value.provenance.status).toBe('unverified');
    }
    const scan = scanSensitiveData(config.raw);
    expect(scan.ok).toBe(true);
    if (scan.ok) expect(scan.value.findings).toHaveLength(0);
    expect(config.raw).not.toContain('OPENAI_API_KEY');
  });

  it('keeps call analysis separate from external service ingestion', () => {
    const skill = validateExtensionManifest(
      load('config/extensions/call-analysis.skill.example.json').value,
    );
    const integration = validateExtensionManifest(
      load('config/extensions/external-call-service.integration.example.json').value,
    );
    expect(skill.ok && skill.value.kind === 'business-skill').toBe(true);
    expect(integration.ok && integration.value.kind === 'integration').toBe(true);
    if (skill.ok) expect(skill.value.requestedPermissions).not.toContain('webhook-ingest');
    if (integration.ok)
      expect(integration.value.declaredCapabilities).not.toContain('analysis.call-transcript@1');
  });

  it('validates Neo profile as masculine, provider-independent and text-only fallback', () => {
    const config = load('config/voice/neo.example.json');
    const result = validateVoiceProfile(config.value);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.profile.genderPresentation).toBe('masculine');
    expect(result.profile.allowCrossGenderFallback).toBe(false);
    expect(result.profile.allowVoiceCloning).toBe(false);
    expect(result.profile.allowIdentityImitation).toBe(false);
    expect(result.profile.fallbackMode).toBe('text-only');
    expect(config.raw).not.toMatch(/"provider"|"voiceId"|"endpoint"|"apiKey"/);
  });

  it('preserves eight business skills and one technical multimodal skill', () => {
    const names = readdirSync('skills', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(names).toEqual(
      [
        'ai-scout',
        'business-analyst',
        'director',
        'integration-engineer',
        'marketing-strategist',
        'multimodal-workflow',
        'personal-assistant',
        'security-guard',
        'tech-watchdog',
      ].sort(),
    );
  });
});
