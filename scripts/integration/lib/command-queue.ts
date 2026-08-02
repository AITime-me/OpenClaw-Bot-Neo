import { parseParentCommandLine, type ParentCommand } from './protocol.ts';

export type CommandCategory = 'WRITE' | 'READ' | 'CLOSE' | 'EXIT' | 'UNKNOWN';

export type SerialQueueTrace =
  | 'WRITE_START'
  | 'WRITE_END'
  | 'READ_START'
  | 'READ_END'
  | 'CLOSE_START'
  | 'CLOSE_END'
  | 'EXIT_START'
  | 'EXIT_END'
  | 'FAILED'
  | 'REJECTED_AFTER_TERMINAL'
  | 'EOF_FAILED';

export type CommandHandlerOutcome =
  | { readonly kind: 'continue' }
  | { readonly kind: 'stop' }
  | { readonly kind: 'terminal-close' }
  | { readonly kind: 'terminal-fail'; readonly errorCode: string };

export type CommandHandler = (
  line: string,
  command: ParentCommand | null,
  category: CommandCategory,
) => Promise<CommandHandlerOutcome>;

export const classifyParentCommandLine = (line: string): CommandCategory => {
  const parsed = parseParentCommandLine(line.trim());
  if (!parsed.ok) return 'UNKNOWN';
  return parsed.value.command;
};

/**
 * Strictly serial interactive command executor.
 * Next command never starts until the previous handler fully resolves.
 * Terminal failure/close is sticky; later enqueues are rejected.
 */
export class SerialCommandQueue {
  private chain: Promise<void> = Promise.resolve();
  private terminal = false;
  private failed = false;
  private draining = false;
  private readonly trace: SerialQueueTrace[] = [];
  private readonly handler: CommandHandler;
  private readonly onTerminalFail: (errorCode: string) => void;
  private sequence = 0;

  constructor(options: {
    readonly handler: CommandHandler;
    readonly onTerminalFail: (errorCode: string) => void;
  }) {
    this.handler = options.handler;
    this.onTerminalFail = options.onTerminalFail;
  }

  isTerminal(): boolean {
    return this.terminal || this.failed;
  }

  isFailed(): boolean {
    return this.failed;
  }

  getTrace(): readonly SerialQueueTrace[] {
    return [...this.trace];
  }

  getSequence(): number {
    return this.sequence;
  }

  enqueue(line: string): void {
    if (this.terminal || this.failed) {
      this.trace.push('REJECTED_AFTER_TERMINAL');
      return;
    }
    this.draining = true;
    this.chain = this.chain
      .then(async () => {
        if (this.terminal || this.failed) {
          this.trace.push('REJECTED_AFTER_TERMINAL');
          return;
        }
        this.sequence += 1;
        const category = classifyParentCommandLine(line);
        this.pushStart(category);
        const parsed = parseParentCommandLine(line.trim());
        const command = parsed.ok ? parsed.value : null;
        let outcome: CommandHandlerOutcome;
        try {
          outcome = await this.handler(line, command, category);
        } catch {
          this.markFailed('HANDLER_THREW');
          return;
        }
        this.pushEnd(category);
        if (outcome.kind === 'terminal-fail') {
          this.markFailed(outcome.errorCode);
          return;
        }
        if (outcome.kind === 'terminal-close') {
          this.terminal = true;
          return;
        }
        if (outcome.kind === 'stop') {
          this.terminal = true;
        }
      })
      .catch(() => {
        if (!this.failed) this.markFailed('QUEUE_REJECTION');
      })
      .finally(() => {
        // drained flag updated after microtask chain settles via notifyDrain
      });
  }

  /** Wait until the current chain has no pending handlers. */
  async waitIdle(): Promise<void> {
    await this.chain;
    this.draining = false;
  }

  isDraining(): boolean {
    return this.draining;
  }

  /**
   * EOF while no terminal command processed → fail.
   * EOF after terminal → no-op.
   * EOF while queue still processing → wait for current handler, then fail if still non-terminal.
   */
  async handleEof(): Promise<'ok' | 'failed'> {
    await this.waitIdle();
    if (this.failed) return 'failed';
    if (this.terminal) return 'ok';
    this.markFailed('EOF_WITHOUT_TERMINAL');
    this.trace.push('EOF_FAILED');
    return 'failed';
  }

  private markFailed(errorCode: string): void {
    if (this.failed) return;
    this.failed = true;
    this.terminal = true;
    this.trace.push('FAILED');
    this.onTerminalFail(errorCode);
  }

  private pushStart(category: CommandCategory): void {
    if (category === 'WRITE') this.trace.push('WRITE_START');
    else if (category === 'READ') this.trace.push('READ_START');
    else if (category === 'CLOSE') this.trace.push('CLOSE_START');
    else if (category === 'EXIT') this.trace.push('EXIT_START');
  }

  private pushEnd(category: CommandCategory): void {
    if (category === 'WRITE') this.trace.push('WRITE_END');
    else if (category === 'READ') this.trace.push('READ_END');
    else if (category === 'CLOSE') this.trace.push('CLOSE_END');
    else if (category === 'EXIT') this.trace.push('EXIT_END');
  }
}
