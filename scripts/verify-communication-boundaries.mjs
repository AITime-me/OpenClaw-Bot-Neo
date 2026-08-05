import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeBoundaries } from './lib/boundary-checker.mjs';

const failures = [];

const listFiles = (root) => {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
};

const communicationRoot = 'src/core/communication';
if (!existsSync(communicationRoot)) {
  failures.push('ZERO_FILES: src/core/communication does not exist.');
} else {
  const files = listFiles(communicationRoot).filter((path) => path.endsWith('.ts'));
  if (files.length === 0)
    failures.push('ZERO_FILES: src/core/communication has no TypeScript files.');

  const requiredTrees = [
    'src/core/communication/domain',
    'src/core/communication/ports',
    'src/core/communication/policy',
  ];
  for (const tree of requiredTrees) {
    if (!existsSync(tree) || listFiles(tree).filter((path) => path.endsWith('.ts')).length === 0)
      failures.push(`MISSING_TREE: ${tree} is required and must contain TypeScript files.`);
  }

  const requiredPersistenceFacades = [
    'src/core/communication/domain/fresh-observed-admission-evidence.persistence.internal.ts',
    'src/core/communication/domain/authenticated-communication-principal.persistence.internal.ts',
    'src/core/communication/domain/validated-text-output.persistence.internal.ts',
  ];
  for (const facade of requiredPersistenceFacades) {
    if (!existsSync(facade))
      failures.push(`MISSING_PERSISTENCE_FACADE: ${facade} is required for Build 3.7C0.`);
  }

  const forbiddenTrees = [
    'src/core/communication/application',
    'src/communication',
    'src/core/communication/runtime',
    'src/core/communication/adapters',
    'src/host/storage/sqlite/communication',
  ];
  for (const tree of forbiddenTrees) {
    if (existsSync(tree))
      failures.push(`FORBIDDEN_TREE: ${tree} must not exist before Build 3.7C implementation.`);
  }

  if (existsSync('src/core/communication/index.ts'))
    failures.push('PACKAGE_PRIVATE: src/core/communication/index.ts must not exist.');

  const forbiddenImport =
    /(?:from\s+['"][^'"]*(?:telegram|openai|codex|openclaw|connectors\/|infrastructure\/|neo-runtime\/|host\/)[^'"]*['"]|require\(\s*['"][^'"]*(?:telegram|openai|codex|openclaw)[^'"]*['"]\s*\))/i;
  const forbiddenContract = /\b(?:tool_calls|OPENAI_API_KEY|CODEX_API_KEY|auth\.json|CODEX_HOME)\b/;
  const symbolBrand =
    /(?:Brand\s*=\s*Symbol\b|Symbol\s*\(\s*['"`][^'"`]*[Bb]rand|\[\s*[A-Za-z0-9_]*[Bb]rand\s*\]\s*:)/;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (forbiddenImport.test(source))
      failures.push(
        `FORBIDDEN_IMPORT: ${file} imports Telegram/OpenAI/Codex/OpenClaw/connector/infrastructure/host/runtime.`,
      );
    if (forbiddenContract.test(source))
      failures.push(
        `FORBIDDEN_CONTRACT: ${file} contains tool_calls or credential/session contract material.`,
      );
    if (file.endsWith('.internal.ts') && symbolBrand.test(source))
      failures.push(`SYMBOL_TRUST_BRAND: ${file} uses a Symbol property as security proof.`);
  }

  const domainBarrel = 'src/core/communication/domain/index.ts';
  if (existsSync(domainBarrel)) {
    const barrel = readFileSync(domainBarrel, 'utf8');
    if (
      /issueAuthenticatedCommunicationPrincipal|sealFreshObservedAdmissionEvidence|principalRegistry|sealValidatedTextOutput|validatedOutputRegistry|getAuthenticatedCommunicationPrincipalCanonical|validatedTextOutputRegistry|persistence\.internal|readValidatedTextOutputPlaintextForOfflineOutbox|readCommunicationPrincipalPersistenceClaims/.test(
        barrel,
      )
    ) {
      failures.push(
        'BARREL_LEAK: communication domain/index.ts must not export principal issuer, output sealer, persistence facades, or internal registries.',
      );
    }
  }

  const rootBarrels = [
    'src/index.ts',
    'src/core/domain/index.ts',
    'src/core/ports/index.ts',
    'src/core/policy/index.ts',
    'src/core/application/index.ts',
  ];
  for (const barrel of rootBarrels) {
    if (!existsSync(barrel)) continue;
    const source = readFileSync(barrel, 'utf8');
    if (/communication\//.test(source) || /core\/communication/.test(source))
      failures.push(`ROOT_BARREL_LEAK: ${barrel} must not export or import communication modules.`);
  }

  const packageJsonPath = 'package.json';
  if (!existsSync(packageJsonPath)) failures.push('PACKAGE_EXPORTS: package.json is missing.');
  else {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const exportKeys = Object.keys(pkg.exports ?? {});
    if (exportKeys.length !== 1 || exportKeys[0] !== '.')
      failures.push('PACKAGE_EXPORTS: only the documented root "." export is allowed.');
  }

  const report = analyzeBoundaries({
    rootDir: 'src',
    requiredLayers: [
      'core/communication/domain',
      'core/communication/ports',
      'core/communication/policy',
    ],
  });
  for (const violation of report.violations) {
    if (
      violation.code === 'MISSING_LAYER' &&
      !String(violation.message).includes('core/communication/')
    ) {
      continue;
    }
    failures.push(`${violation.code}: ${violation.message}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Communication boundary checks passed.');
