import { type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';

type RegisteredProcess = {
  readonly id: string;
  readonly child: ChildProcess;
  exited: boolean;
};

export class ProcessRegistry {
  private readonly processes = new Map<string, RegisteredProcess>();

  register(child: ChildProcess): string {
    const id = randomBytes(8).toString('hex');
    this.processes.set(id, { id, child, exited: false });
    return id;
  }

  markExited(id: string): void {
    const entry = this.processes.get(id);
    if (entry !== undefined) entry.exited = true;
  }

  hasAlive(): boolean {
    for (const entry of this.processes.values()) {
      if (!entry.exited && entry.child.exitCode === null && entry.child.signalCode === null) {
        return true;
      }
    }
    return false;
  }

  listAlivePids(): number[] {
    const pids: number[] = [];
    for (const entry of this.processes.values()) {
      if (
        !entry.exited &&
        entry.child.pid !== undefined &&
        entry.child.exitCode === null &&
        entry.child.signalCode === null
      ) {
        pids.push(entry.child.pid);
      }
    }
    return pids;
  }

  clear(): void {
    this.processes.clear();
  }

  private killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
    if (child.pid === undefined) return;
    if (process.platform === 'linux') {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // fall through
      }
    }
    try {
      child.kill(signal);
    } catch {
      // best effort
    }
  }

  async terminateAll(options: {
    readonly graceMs: number;
    readonly killMs: number;
  }): Promise<{ readonly terminated: boolean; readonly orphans: number[] }> {
    const alive = [...this.processes.values()].filter(
      (entry) => !entry.exited && entry.child.exitCode === null && entry.child.signalCode === null,
    );

    for (const entry of alive) {
      this.killProcessGroup(entry.child, 'SIGTERM');
    }

    if (alive.length > 0 && options.graceMs > 0) {
      await new Promise<void>((resolvePromise) => {
        setTimeout(resolvePromise, options.graceMs);
      });
    }

    const stillAlive = [...this.processes.values()].filter(
      (entry) => !entry.exited && entry.child.exitCode === null && entry.child.signalCode === null,
    );

    for (const entry of stillAlive) {
      this.killProcessGroup(entry.child, 'SIGKILL');
    }

    if (stillAlive.length > 0 && options.killMs > 0) {
      await new Promise<void>((resolvePromise) => {
        setTimeout(resolvePromise, options.killMs);
      });
    }

    const orphans = this.listAlivePids();
    return { terminated: orphans.length === 0, orphans };
  }
}

export const globalProcessRegistry = new ProcessRegistry();

export const resetProcessRegistryForTests = (): void => {
  globalProcessRegistry.clear();
};
