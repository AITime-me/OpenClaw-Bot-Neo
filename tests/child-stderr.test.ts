import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import {
  CHILD_STDERR_EVIDENCE_CAP,
  STDERR_TRUNCATION_MARKER,
  buildChildStartupDiagnostics,
  createChildStderrCollector,
  redactChildStderrSummary,
} from '../scripts/integration/lib/child-stderr.ts';
import { serializeChildStartupFailureDetail } from '../scripts/integration/lib/child-startup-evidence.ts';

const paths = {
  repositoryRoot: '/repo/openclaw',
  homePath: '/tmp/run/home',
  tmpPath: '/tmp/run/tmp',
  storageRoot: '/tmp/run/storage',
  executionRoot: '/tmp/run/exec',
};

describe('child stderr collector and redaction', () => {
  it('drains stderr and captures pre-READY module error', async () => {
    const collector = createChildStderrCollector();
    const stream = new PassThrough();
    stream.on('data', (chunk: Buffer | string) => {
      collector.ingest(chunk);
    });
    stream.write(
      Buffer.from(
        `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '${paths.repositoryRoot}/src/core/domain/identity.js'\n`,
      ),
    );
    stream.end();
    await new Promise((resolve) => stream.on('end', resolve));
    const diagnostics = buildChildStartupDiagnostics({
      exitCode: 1,
      messages: [],
      collector,
      paths,
    });
    expect(diagnostics.exitCode).toBe(1);
    expect(diagnostics.protocolEventCount).toBe(0);
    expect(diagnostics.diagnosticClass).toBe('CHILD_STARTUP_MODULE_LOAD');
    expect(diagnostics.stderrSummary).toContain('ERR_MODULE_NOT_FOUND');
    expect(diagnostics.stderrSummary).toContain('<REPO>');
    expect(diagnostics.stderrSummary.includes(paths.repositoryRoot)).toBe(false);
  });

  it('enforces evidence cap and truncation marker', () => {
    const collector = createChildStderrCollector(64, 16);
    collector.ingest('x'.repeat(200));
    const snap = collector.snapshot();
    expect(snap.truncated).toBe(true);
    const redacted = redactChildStderrSummary(snap.rawForRedaction, paths, [], 64, true);
    expect(redacted.truncated).toBe(true);
    expect(redacted.summary).toContain(STDERR_TRUNCATION_MARKER);
    expect(Buffer.byteLength(redacted.summary, 'utf8')).toBeLessThanOrEqual(64);
  });

  it('redacts HOME TMP STORAGE EXECUTION and file URLs', () => {
    const raw = [
      `repo=${paths.repositoryRoot}`,
      `home=${paths.homePath}`,
      `tmp=${paths.tmpPath}`,
      `storage=${paths.storageRoot}`,
      `exec=${paths.executionRoot}`,
      `fileurl=file://${paths.repositoryRoot}/src/x.ts`,
      'Error [ERR_MODULE_NOT_FOUND]',
    ].join('\n');
    const { summary } = redactChildStderrSummary(raw, paths);
    expect(summary).toContain('<REPO>');
    expect(summary).toContain('<HOME>');
    expect(summary).toContain('<TMP>');
    expect(summary).toContain('<STORAGE>');
    expect(summary).toContain('<EXECUTION>');
    expect(summary.includes(paths.repositoryRoot)).toBe(false);
    expect(summary.includes(paths.homePath)).toBe(false);
  });

  it('scrubs secrets and fail-closes remaining violations to <redacted>', () => {
    const secret = 'super-secret-token-value';
    const { summary } = redactChildStderrSummary(
      `leak ${secret} and /unredacted/absolute/path/here`,
      paths,
      [secret],
    );
    expect(summary).toBe('<redacted>');
  });

  it('redacts secrets split across chunks using retained lookahead', () => {
    const secret = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
    const collector = createChildStderrCollector(CHILD_STDERR_EVIDENCE_CAP, 64);
    const prefix = 'x'.repeat(CHILD_STDERR_EVIDENCE_CAP - 10);
    collector.ingest(prefix + secret.slice(0, 10));
    collector.ingest(secret.slice(10));
    const diagnostics = buildChildStartupDiagnostics({
      exitCode: 1,
      messages: [],
      collector,
      paths,
      secretValues: [secret],
    });
    expect(diagnostics.stderrSummary.includes(secret)).toBe(false);
  });

  it('does not hang when stderr exceeds pipe capacity', async () => {
    const collector = createChildStderrCollector();
    const stream = new PassThrough({ highWaterMark: 16 });
    stream.on('data', (chunk: Buffer | string) => {
      collector.ingest(chunk);
    });
    const writePromise = new Promise<void>((resolve, reject) => {
      const payload = Buffer.alloc(256 * 1024, 0x61);
      stream.write(payload, (error) => {
        if (error) reject(error);
        else {
          stream.end();
          resolve();
        }
      });
    });
    await expect(writePromise).resolves.toBeUndefined();
    const snap = collector.snapshot();
    expect(snap.totalBytesSeen).toBeGreaterThan(CHILD_STDERR_EVIDENCE_CAP);
    expect(snap.truncated).toBe(true);
  });

  it('handles stderr stream errors without throwing', () => {
    const collector = createChildStderrCollector();
    collector.markStreamError('EPIPE');
    const snap = collector.snapshot();
    expect(snap.rawForRedaction).toContain('stderr-stream-error:EPIPE');
  });

  it('success path omits failure stderr from scenario detail serializer usage', () => {
    const collector = createChildStderrCollector();
    collector.ingest('harmless warning\n');
    const diagnostics = buildChildStartupDiagnostics({
      exitCode: 0,
      messages: [{ event: 'READY' }, { event: 'CLOSED' }],
      collector,
      paths,
    });
    expect(diagnostics.diagnosticClass).toBe('CHILD_LIFECYCLE');
    // Gate attaches serializeChildStartupFailureDetail only on FAIL.
    const detail = serializeChildStartupFailureDetail(diagnostics);
    expect(detail).toContain('CHILD_LIFECYCLE');
  });

  it('preserves exit code and protocol event count in serialized evidence', () => {
    const collector = createChildStderrCollector();
    collector.ingest('Error [ERR_MODULE_NOT_FOUND]\n');
    const diagnostics = buildChildStartupDiagnostics({
      exitCode: 1,
      messages: [],
      collector,
      paths,
    });
    const detail = JSON.parse(serializeChildStartupFailureDetail(diagnostics)) as {
      exitCode: number;
      protocolEventCount: number;
      diagnosticClass: string;
    };
    expect(detail.exitCode).toBe(1);
    expect(detail.protocolEventCount).toBe(0);
    expect(detail.diagnosticClass).toBe('CHILD_STARTUP_MODULE_LOAD');
  });
});
