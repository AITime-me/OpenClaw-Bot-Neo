import {
  evaluateSupportedNodeVersion,
  formatUnsupportedNodeReason,
} from '../lib/node-version-contract.mjs';
import { NEO_RUNTIME_EXIT_UNSUPPORTED_RUNTIME } from '../lib/neo-launcher-exit-codes.mjs';

/**
 * Production Neo process launcher gate. Validates Node before any runtime import.
 *
 * @param {{
 *   nodeVersion?: string;
 *   importRunNeoProcess: () => Promise<{ runNeoProcessFromNode: () => Promise<{ exitCode: number }> }>;
 *   stderr?: { write: (chunk: string) => void };
 * }} deps
 * @returns {Promise<{ exitCode: number }>}
 */
export const launchNeoProcess = async ({
  nodeVersion = process.versions.node,
  importRunNeoProcess,
  stderr = process.stderr,
} = {}) => {
  const decision = evaluateSupportedNodeVersion(nodeVersion);
  if (!decision.ok) {
    stderr.write(`${formatUnsupportedNodeReason(nodeVersion, decision)}\n`);
    return { exitCode: NEO_RUNTIME_EXIT_UNSUPPORTED_RUNTIME };
  }
  const module = await importRunNeoProcess();
  const result = await module.runNeoProcessFromNode();
  return { exitCode: result.exitCode };
};
