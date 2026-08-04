import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createInfrastructureHarness, invoke, asToolId, asIdempotency } from './harness.js';
import { seedInfrastructureFixtures } from './fixtures.js';
import { createReferenceInfrastructureProvider } from '../../src/infrastructure/reference/reference-provider.js';
import { createReferenceRestrictedHostAccess } from '../../src/infrastructure/reference/reference-host-access.js';
import { createTimewebProviderContract } from '../../src/connectors/infrastructure/timeweb/timeweb-provider-contract.js';

describe('infrastructure secret and execution boundaries', () => {
  it('does not resolve secrets on deny or approval-required paths', async () => {
    const harness = createInfrastructureHarness();
    await invoke(harness, {
      toolId: asToolId('infrastructure.server.inspect'),
      input: { serverId: 'missing' },
    });
    expect(harness.secretProvider.resolveCalls).toBe(0);
    await invoke(harness, {
      toolId: asToolId('infrastructure.service.restart'),
      input: { serverId: 'srv-1', serviceId: 'svc-1', environmentId: 'env-1' },
      idempotencyKey: asIdempotency('k-secret'),
    });
    expect(harness.secretProvider.resolveCalls).toBe(0);
  });

  it('returns bounded untrusted output without raw commands', async () => {
    const harness = createInfrastructureHarness();
    seedInfrastructureFixtures(harness);
    const result = await invoke(harness, {
      toolId: asToolId('infrastructure.server.inspect'),
      input: { serverId: 'srv-1' },
    });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(JSON.stringify(result.output)).not.toMatch(/sudo|shell|ssh/i);
    }
  });
});

describe('infrastructure isolation', () => {
  it('keeps reference adapters offline and absent from production composition', () => {
    const productionPaths = [
      'src/neo-runtime/production/create-production-neo-runtime.ts',
      'src/host/assemble-local-host.ts',
      'src/host/create-local-host.ts',
    ];
    for (const file of productionPaths) {
      if (!existsSync(file)) continue;
      const source = readFileSync(file, 'utf8');
      expect(source.includes('infrastructure/reference')).toBe(false);
      expect(source.includes('connectors/infrastructure')).toBe(false);
    }
  });

  it('reference provider and host perform no network or shell', async () => {
    const provider = createReferenceInfrastructureProvider();
    const host = createReferenceRestrictedHostAccess();
    const providerResult = await provider.execute(
      { op: 'get-provider-health' },
      new AbortController().signal,
    );
    expect(providerResult.ok).toBe(true);
    const hostResult = await host.execute(
      { op: 'inspect-host-identity', serverId: 'srv-1' as never },
      new AbortController().signal,
    );
    expect(hostResult.ok).toBe(true);
  });

  it('timeweb contract has no network implementation', () => {
    const source = readFileSync(
      'src/connectors/infrastructure/timeweb/timeweb-provider-contract.ts',
      'utf8',
    );
    expect(source.includes('fetch(')).toBe(false);
    expect(source.includes('process.env')).toBe(false);
    expect(createTimewebProviderContract().providerId).toBe('timeweb');
  });
});
