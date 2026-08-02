import process from 'node:process';
import type { NeoProcessOutputPort } from '../ports/neo-process-ports.js';

const writeLine = (stream: NodeJS.WriteStream, line: string): void => {
  try {
    stream.write(`${line}\n`);
  } catch {
    // Output failure must not crash Neo orchestration.
  }
};

export const createNodeProcessOutputPort = (): NeoProcessOutputPort =>
  Object.freeze({
    writeStdoutLine: (line: string): void => {
      writeLine(process.stdout, line);
    },
    writeStderrLine: (line: string): void => {
      writeLine(process.stderr, line);
    },
  });
