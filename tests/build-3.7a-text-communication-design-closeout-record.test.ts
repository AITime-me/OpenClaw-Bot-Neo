import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const CLOSEOUT_RECORD = join(
  REPO_ROOT,
  'docs/validation/build-3.7a-text-communication-design-closeout.md',
);
const ARCHITECTURE = join(REPO_ROOT, 'docs/communication/text-architecture.md');
const TRUST_MODEL = join(REPO_ROOT, 'docs/communication/text-trust-and-threat-model.md');
const STATE_MACHINES = join(REPO_ROOT, 'docs/communication/text-state-machines.md');
const IMPLEMENTATION_MAP = join(REPO_ROOT, 'docs/communication/text-implementation-map.md');

const BUILD_3_7A_BASE = 'b66237613edefffad0d691b863d7f2b8643fb5e1';
const FEATURE_BRANCH = 'build-3-7a-text-communication-design';
const DISPOSITION = 'BUILD_3_7A_TEXT_COMMUNICATION_DESIGN_CLOSED_DOCUMENTATION_ONLY';
const FINAL_STATUS = 'BUILD_3_7A_TEXT_COMMUNICATION_DESIGN_READY_FOR_INDEPENDENT_REVIEW';

const HISTORICAL_CLOSEOUTS = [
  'docs/validation/build-3.5b-connector-platform-core-closeout.md',
  'docs/validation/build-3.6b-infrastructure-fleet-foundation-closeout.md',
  'docs/validation/codex-review-6-r6-h01-readiness-race-closeout.md',
  'docs/validation/codex-review-6-r6-h02-durable-memory-secret-boundary-closeout.md',
  'docs/validation/codex-review-6-r6-m01-retryable-durable-owner-closeout.md',
  'docs/validation/codex-review-6-r6-m02-production-node-gate-systemd-closeout.md',
  'docs/validation/codex-review-6-r6-m03-live-process-identity-closeout.md',
  'docs/validation/codex-review-6-r6-low-hardening-package-closeout.md',
] as const;

describe('Build 3.7A text communication design closeout record', () => {
  const record = readFileSync(CLOSEOUT_RECORD, 'utf8');
  const architecture = readFileSync(ARCHITECTURE, 'utf8');
  const trustModel = readFileSync(TRUST_MODEL, 'utf8');
  const stateMachines = readFileSync(STATE_MACHINES, 'utf8');
  const implementationMap = readFileSync(IMPLEMENTATION_MAP, 'utf8');

  it('exists with design-only build identities', () => {
    expect(record).toContain(BUILD_3_7A_BASE);
    expect(record).toContain(FEATURE_BRANCH);
    expect(record).toContain('documentation / validation only');
    expect(record).toContain('DESIGN_ONLY=true');
    expect(record).toContain(DISPOSITION);
    expect(record).toContain(FINAL_STATUS);
  });

  it('states design complete with implementation absent', () => {
    expect(record).toContain('documentation / validation-only');
    expect(record).toContain('COMMUNICATION_RUNTIME_IMPLEMENTED=false');
    expect(record).toContain('does **not** implement');
    expect(architecture).toContain('design only');
    expect(architecture).toContain('Text communication runtime code is **absent**');
    expect(implementationMap).toContain('**3.7A** — design documentation only');
  });

  it('does not claim live Telegram or live LLM implemented', () => {
    expect(record).toContain('TELEGRAM_ADAPTER_IMPLEMENTED=false');
    expect(record).toContain('LLM_PROVIDER_ROUTE_IMPLEMENTED=false');
    expect(record).toContain('live Telegram integration');
    expect(record).toContain('No live Telegram');
    expect(record).not.toMatch(/Telegram adapter implemented/i);
    expect(record).not.toMatch(/LLM provider route implemented/i);
    expect(record).not.toMatch(/live Telegram.*(ready|complete|deployed)/i);
  });

  it('marks subscription route as hypothesis gated by 3.7E0 feasibility', () => {
    expect(record).toContain('SUBSCRIPTION_ROUTE_FEASIBILITY=unresolved-hypothesis');
    expect(record).toContain('Build 3.7E0 — Subscription Route Feasibility');
    expect(record).toContain('PASS` | `FAIL` | `UNRESOLVED');
    expect(architecture).toContain('Unresolved hypothesis');
    expect(architecture).toContain('3.7E0');
    expect(implementationMap).toContain('3.7E0');
  });

  it('separates communication principal from memory capability', () => {
    expect(record).toContain('AuthenticatedCommunicationPrincipal');
    expect(record).toContain('AuthenticatedMemoryAccess');
    expect(record).toContain('Communication principal ≠ memory authority');
    expect(architecture).toContain('AuthenticatedCommunicationPrincipal');
    expect(architecture).toContain('AuthenticatedMemoryAccess');
    expect(architecture).toContain('Two opaque capability families');
    expect(trustModel).toContain('AuthenticatedCommunicationPrincipal');
  });

  it('marks durable ledger, conversation state, audit, and outbox as future components', () => {
    expect(record).toContain(
      'durable communication turn ledger, conversation state, audit, or delivery outbox',
    );
    expect(architecture).toContain('CommunicationTurnLedgerPort');
    expect(architecture).toContain('ConversationStatePort');
    expect(architecture).toContain('delivery outbox');
    expect(architecture).toContain('Absent today (target only)');
    expect(stateMachines).toContain('No durable');
    expect(implementationMap).toContain('communication-turn-ledger.port.ts');
    expect(implementationMap).toContain('conversation-state.port.ts');
    expect(implementationMap).toContain('delivery-outbox.port.ts');
    expect(implementationMap).toContain('communication-audit.port.ts');
  });

  it('forbids automatic replay/resend on outcome-unknown', () => {
    expect(record).toContain('LLM_OUTCOME_UNKNOWN');
    expect(record).toContain('DELIVERY_OUTCOME_UNKNOWN');
    expect(record).toContain('forbids automatic model replay');
    expect(record).toContain('forbids automatic resend');
    expect(stateMachines).toContain('**no automatic** model re-invoke');
    expect(stateMachines).toContain('**no automatic** resend');
    expect(trustModel).toContain('forbids automatic resend');
    expect(trustModel).toContain('no automatic resend');
  });

  it('records encryption as live blocker for persisted conversational content', () => {
    expect(record).toContain('ENCRYPTION_ENABLED=false');
    expect(record).toContain('Encryption is a live blocker for persisted conversational content');
    expect(trustModel).toContain('encryption live gate');
    expect(trustModel).toContain('BLOCKER for live');
    expect(architecture).toContain('encrypted-before-live');
    expect(trustModel).toContain('TC-B01');
  });

  it('treats future mobile messenger as equal adapter peer', () => {
    expect(record).toContain('future private mobile messenger');
    expect(record).toContain('Telegram is temporary');
    expect(architecture).toContain('private mobile app / closed messenger');
    expect(architecture).toContain('Telegram must be removable');
    expect(implementationMap).toContain('channels/mobile');
  });

  it('keeps connector and infrastructure tools unwired to text agent', () => {
    expect(record).toContain('connector or infrastructure tools attached to the text agent');
    expect(record).toContain('Connector/infrastructure tools must not attach');
    expect(architecture).toContain('must **not** auto-wire');
    expect(trustModel).toContain('Out of text-turn trust graph');
    expect(implementationMap).toContain('forbidden-communication-imports-connector');
    expect(implementationMap).toContain('forbidden-communication-imports-infrastructure');
  });

  it('does not claim production or security readiness', () => {
    expect(record).toContain('SECURITY_APPROVAL_COMPLETE=false');
    expect(record).toContain('DEPLOYMENT_READY=false');
    expect(record).toContain('AUTHORITATIVE_SECURITY_VALIDATION=false');
    expect(record).toContain('No production readiness');
    expect(record).toContain('No security approval');
    expect(record).not.toMatch(/production-ready/i);
    expect(record).not.toMatch(/security approval (was|is) complete/i);
    expect(record).toContain('Independent review of Build 3.7A');
  });

  it('does not create runtime diagnostics in this Build and lists future flags as absent', () => {
    expect(record).toContain('No new runtime diagnostics');
    expect(record).toContain('new runtime diagnostic fields');
    expect(record).toContain('textCommunicationProductionReady');
    expect(record).toContain('telegramAdapterActivated');
    expect(record).toContain('llmProviderActivated');
    expect(record).toContain('oauthSessionConfigured');
    expect(record).toContain('durableReplayStore');
    expect(record).toContain('durableCommunicationAudit');
    expect(record).toContain('connectorToolsAttachedToTextAgent');
    expect(record).toContain('openClawRuntimeIntegrated');
    expect(architecture).toContain('Build 3.7A does not add runtime diagnostic fields');
  });

  it('leaves historical closeout records unchanged', () => {
    for (const relativePath of HISTORICAL_CLOSEOUTS) {
      const absolutePath = join(REPO_ROOT, relativePath);
      expect(() => readFileSync(absolutePath, 'utf8')).not.toThrow();
    }
    expect(record).toContain('are **not** rewritten');
  });
});
