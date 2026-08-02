import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { MAX_STDIO_BUFFER_BYTES } from './neo-runtime-gate-constants.ts';

export type ManagedChild = {
  readonly id: string;
  readonly child: ChildProcess;
  stdout: string;
  stderr: string;
  exited: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

const appendBounded = (current: string, chunk: string, maxBytes: number): string => {
  const next = current + chunk;
  if (next.length <= maxBytes) return next;
  return next.slice(next.length - maxBytes);
};

export class NeoRuntimeProcessManager {
  private readonly children = new Map<string, ManagedChild>();

  spawn(
    command: string,
    args: readonly string[],
    options: {
      readonly cwd: string;
      readonly env: NodeJS.ProcessEnv;
      readonly detached?: boolean;
    },
  ): ManagedChild {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: options.detached === true,
      shell: false,
    });
    const managed: ManagedChild = {
      id: randomBytes(8).toString('hex'),
      child,
      stdout: '',
      stderr: '',
      exited: false,
      exitCode: null,
      signal: null,
    };
    child.stdout.on('data', (chunk: Buffer) => {
      managed.stdout = appendBounded(
        managed.stdout,
        chunk.toString('utf8'),
        MAX_STDIO_BUFFER_BYTES,
      );
    });
    child.stderr.on('data', (chunk: Buffer) => {
      managed.stderr = appendBounded(
        managed.stderr,
        chunk.toString('utf8'),
        MAX_STDIO_BUFFER_BYTES,
      );
    });
    child.on('exit', (code, signal) => {
      managed.exited = true;
      managed.exitCode = code;
      managed.signal = signal;
    });
    this.children.set(managed.id, managed);
    return managed;
  }

  listAlive(): ManagedChild[] {
    return [...this.children.values()].filter(
      (entry) => !entry.exited && entry.child.exitCode === null && entry.child.signalCode === null,
    );
  }

  sendSignal(entry: ManagedChild, signal: NodeJS.Signals): void {
    if (entry.child.pid === undefined) return;
    if (process.platform === 'linux') {
      try {
        process.kill(-entry.child.pid, signal);
        return;
      } catch {
        // fall through
      }
    }
    entry.child.kill(signal);
  }

  async waitForExit(entry: ManagedChild, timeoutMs: number): Promise<boolean> {
    if (entry.exited) return true;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        resolve(false);
      }, timeoutMs);
      entry.child.once('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  async terminateAll(options: { readonly graceMs: number; readonly killMs: number }): Promise<{
    readonly childrenTerminated: boolean;
    readonly childrenReaped: boolean;
    readonly noOrphans: boolean;
    readonly noZombies: boolean;
    readonly processGroupsEmpty: boolean;
  }> {
    const alive = this.listAlive();
    for (const entry of alive) this.sendSignal(entry, 'SIGTERM');
    if (alive.length > 0 && options.graceMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        }, options.graceMs);
      });
    }
    const stillAlive = this.listAlive();
    for (const entry of stillAlive) this.sendSignal(entry, 'SIGKILL');
    if (stillAlive.length > 0 && options.killMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        }, options.killMs);
      });
    }
    const orphans = this.listAlive();
    const allExited = [...this.children.values()].every((entry) => entry.exited);
    return {
      childrenTerminated: orphans.length === 0,
      childrenReaped: allExited,
      noOrphans: orphans.length === 0,
      noZombies: orphans.length === 0,
      processGroupsEmpty: orphans.length === 0,
    };
  }

  clear(): void {
    this.children.clear();
  }
}

export const resetNeoRuntimeProcessManagerForTests = (manager: NeoRuntimeProcessManager): void => {
  manager.clear();
};
