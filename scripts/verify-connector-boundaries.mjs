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
  if (source.includes('connectors/reference'))
    failures.push(`REFERENCE_IN_PRODUCTION: ${file} imports reference connector.`);
}

const neoRuntimeFiles = listFiles('src/neo-runtime').filter((path) => path.endsWith('.ts'));
for (const file of neoRuntimeFiles) {
  const source = readFileSync(file, 'utf8');
  if (/connectors\/reference|application\/connector/.test(source))
    failures.push(`NEO_CONNECTOR_WIRING: ${file} references connector internals.`);
}

const executionRegistryPattern = /connector-execution-registry/;
const allowedExecutionImporters = new Set([
  'src/core/application/connector/tool-invocation-orchestrator.ts',
  'src/core/application/connector/in-memory-connector-registries.ts',
]);

for (const file of listFiles('src').filter((path) => path.endsWith('.ts'))) {
  const normalized = file.replace(/\\/g, '/');
  if (!executionRegistryPattern.test(readFileSync(file, 'utf8'))) continue;
  if (!allowedExecutionImporters.has(normalized))
    failures.push(`EXECUTION_REGISTRY_LEAK: ${normalized} imports executable connector registry.`);
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Connector boundaries verified.');
