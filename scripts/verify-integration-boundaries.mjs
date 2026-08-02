#!/usr/bin/env node
/**
 * Integration boundary verifier for scripts/integration.
 * Ensures production factory import is confined to lazy-production.ts.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { analyzeIntegrationBoundaries } from './lib/integration-boundary-policy.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const violations = analyzeIntegrationBoundaries({ rootDir: REPO_ROOT });

if (violations.length > 0) {
  process.stderr.write('Integration boundary violations:\n');
  for (const violation of violations) {
    process.stderr.write(`  - ${violation}\n`);
  }
  process.exit(1);
}

process.stdout.write('Integration boundaries verified.\n');
