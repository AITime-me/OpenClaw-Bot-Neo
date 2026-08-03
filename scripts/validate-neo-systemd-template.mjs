#!/usr/bin/env node
/**
 * Dependency-free validator for deploy/systemd/openclaw-neo.service.template.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TEMPLATE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../deploy/systemd/openclaw-neo.service.template',
);

const REQUIRED_SECTIONS = ['Unit', 'Service', 'Install'];

const UNIT_DIRECTIVES = Object.freeze({
  Description: 'OpenClaw Neo personal assistant runtime',
  After: 'local-fs.target',
  StartLimitIntervalSec: '300',
  StartLimitBurst: '5',
});

const SERVICE_DIRECTIVES = Object.freeze({
  Type: 'simple',
  User: 'openclaw-neo',
  Group: 'openclaw-neo',
  WorkingDirectory: '/opt/openclaw-neo',
  ExecStart:
    '/usr/bin/node /opt/openclaw-neo/scripts/neo/start-neo.mjs --config /etc/openclaw/neo/config.json --storage-binding /etc/openclaw/neo/storage-binding.json --storage-policy /etc/openclaw/neo/storage-policy.json --execution-root /run/openclaw/neo',
  Restart: 'on-failure',
  RestartSec: '5',
  RestartPreventExitStatus: '10 3',
  TimeoutStartSec: '60',
  TimeoutStopSec: '45',
  KillMode: 'mixed',
  KillSignal: 'SIGTERM',
  FinalKillSignal: 'SIGKILL',
  SendSIGKILL: 'yes',
  RuntimeDirectory: 'openclaw/neo',
  RuntimeDirectoryMode: '0750',
  StateDirectory: 'openclaw-neo',
  StateDirectoryMode: '0750',
  ConfigurationDirectory: 'openclaw/neo',
  ConfigurationDirectoryMode: '0750',
  UMask: '0027',
  NoNewPrivileges: 'yes',
  PrivateTmp: 'yes',
  PrivateDevices: 'yes',
  ProtectSystem: 'strict',
  ProtectHome: 'yes',
  ProtectKernelTunables: 'yes',
  ProtectKernelModules: 'yes',
  ProtectControlGroups: 'yes',
  RestrictSUIDSGID: 'yes',
  LockPersonality: 'yes',
  RestrictRealtime: 'yes',
  SystemCallArchitectures: 'native',
  CapabilityBoundingSet: '',
  AmbientCapabilities: '',
  ReadWritePaths: '/var/lib/openclaw-neo /run/openclaw/neo',
  StandardOutput: 'journal',
  StandardError: 'journal',
});

const INSTALL_DIRECTIVES = Object.freeze({
  WantedBy: 'multi-user.target',
});

const FORBIDDEN_PATTERNS = [
  /\.ts\b/i,
  /experimental-strip-types/i,
  /ts-source-resolve/i,
  /\btsx\b/i,
  /ts-node/i,
  /\bsh\s+-c\b/i,
  /\bbash\s+-c\b/i,
  /EnvironmentFile=/i,
  /LoadCredential=/i,
  /network-online\.target/i,
  /RestrictAddressFamilies=/i,
  /\b(password|token|apikey|api_key)\s*=/i,
];

const parseTemplate = (content) => {
  const sections = new Map();
  let current = null;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const sectionMatch = /^\[(.+)\]$/.exec(line);
    if (sectionMatch !== null) {
      current = sectionMatch[1];
      if (!sections.has(current)) sections.set(current, new Map());
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1 || current === null) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    const bucket = sections.get(current);
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key).push(value);
  }
  return sections;
};

const assertDirective = (violations, section, bucket, key, expected) => {
  const values = bucket.get(key);
  if (values === undefined || values.length !== 1) {
    violations.push(`${section}.${key} must appear exactly once.`);
    return;
  }
  if (values[0] !== expected) {
    violations.push(`${section}.${key} must equal the approved production value.`);
  }
};

export const validateNeoSystemdTemplate = (content) => {
  const violations = [];
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) violations.push(`Forbidden pattern: ${pattern}`);
  }
  if (/\bExecStop=/.test(content)) violations.push('ExecStop must not be present.');
  if (/\$HOME\b|\$TMPDIR\b|\b\/tmp\b|\b\/home\b/i.test(content)) {
    violations.push('Template must not reference HOME/TMP paths.');
  }

  const sections = parseTemplate(content);
  for (const section of REQUIRED_SECTIONS) {
    if (!sections.has(section)) violations.push(`Missing [${section}] section.`);
  }

  const unit = sections.get('Unit') ?? new Map();
  for (const [key, value] of Object.entries(UNIT_DIRECTIVES)) {
    assertDirective(violations, 'Unit', unit, key, value);
  }
  if (unit.has('StartLimitIntervalSec') && sections.get('Service')?.has('StartLimitIntervalSec')) {
    violations.push('StartLimit directives must be in [Unit] only.');
  }

  const service = sections.get('Service') ?? new Map();
  for (const [key, value] of Object.entries(SERVICE_DIRECTIVES)) {
    assertDirective(violations, 'Service', service, key, value);
  }
  const execStart = service.get('ExecStart')?.[0] ?? '';
  if (!execStart.includes('start-neo.mjs')) {
    violations.push('ExecStart must use compiled start-neo.mjs launcher.');
  }
  if (execStart.includes('dist/neo-runtime/cli/run-neo-process.js')) {
    violations.push('ExecStart must not launch compiled run-neo-process.js directly.');
  }
  if (!execStart.startsWith('/usr/bin/node /opt/openclaw-neo/')) {
    violations.push('ExecStart must use absolute /usr/bin/node and install root paths.');
  }
  if (service.has('ExecStartPre')) {
    violations.push('ExecStartPre must not be present.');
  }
  const restartPrevent = service.get('RestartPreventExitStatus')?.[0] ?? '';
  if (!/\b10\b/.test(restartPrevent) || !/\b3\b/.test(restartPrevent)) {
    violations.push(
      'RestartPreventExitStatus must include 10 (process lock) and 3 (unsupported Node runtime).',
    );
  }

  const install = sections.get('Install') ?? new Map();
  for (const [key, value] of Object.entries(INSTALL_DIRECTIVES)) {
    assertDirective(violations, 'Install', install, key, value);
  }

  if (!content.includes('deploymentReady remains false')) {
    violations.push('Template comments must state deploymentReady remains false.');
  }
  if (!content.includes('Validated in disposable Ubuntu 24.04/systemd during Build 3.4F')) {
    violations.push('Template comments must state disposable Build 3.4F systemd validation.');
  }
  if (!content.includes('not security-approved')) {
    violations.push('Template comments must state security approval is absent.');
  }

  return violations;
};

const isCli =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isCli) {
  const content = readFileSync(TEMPLATE_PATH, 'utf8');
  const violations = validateNeoSystemdTemplate(content);
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`${violation}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Neo systemd template validation passed.\n');
  }
}
