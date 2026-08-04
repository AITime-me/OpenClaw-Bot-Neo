import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const failures = [];

const listFiles = (root) => {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
};

const productionPaths = [
  'src/neo-runtime/production/create-production-neo-runtime.ts',
  'src/neo-runtime/production/production-config-bootstrap.ts',
  'src/host/assemble-local-host.ts',
  'src/host/create-local-host.ts',
];

for (const file of productionPaths) {
  if (!existsSync(file)) continue;
  const source = readFileSync(file, 'utf8');
  if (source.includes('infrastructure/reference'))
    failures.push(`REFERENCE_INFRA_IN_PRODUCTION: ${file} imports reference infrastructure.`);
  if (source.includes('connectors/infrastructure'))
    failures.push(`INFRA_CONNECTOR_IN_PRODUCTION: ${file} wires infrastructure connector.`);
}

const neoRuntimeFiles = listFiles('src/neo-runtime').filter((path) => path.endsWith('.ts'));
for (const file of neoRuntimeFiles) {
  const source = readFileSync(file, 'utf8');
  if (
    /infrastructure\/reference|core\/application\/infrastructure|connectors\/infrastructure/.test(
      source,
    )
  )
    failures.push(`NEO_INFRA_WIRING: ${file} references infrastructure internals.`);
}

for (const file of listFiles('src/core/domain/infrastructure').filter((path) =>
  path.endsWith('.ts'),
)) {
  const source = readFileSync(file, 'utf8');
  if (/node:https?|node:net|node:tls|ssh2|child_process/.test(source))
    failures.push(`INFRA_DOMAIN_NETWORK: ${file} imports network or SSH.`);
}

for (const file of listFiles('src/connectors/infrastructure/timeweb').filter((path) =>
  path.endsWith('.ts'),
)) {
  const source = readFileSync(file, 'utf8');
  if (/fetch\(|axios|node:https?|process\.env/.test(source))
    failures.push(`TIMEWEB_NETWORK_CLIENT: ${file} contains network client or env access.`);
}

const forbiddenOrchestratorPattern = /createInfrastructureOperationOrchestrator/;
for (const file of listFiles('src').filter((path) => path.endsWith('.ts'))) {
  const normalized = file.replace(/\\/g, '/');
  const source = readFileSync(file, 'utf8');
  if (forbiddenOrchestratorPattern.test(source))
    failures.push(
      `DUPLICATE_ORCHESTRATOR: ${normalized} defines alternate infrastructure orchestrator.`,
    );
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Infrastructure boundaries verified.');
