# Build 3.7G0 — Communication Encryption At-Rest Decisions

Build 3.7G0 records the **architecture-only** encryption live gate for durable text communication
persistence in `neo-communication.sqlite`. It freezes which fields encrypt, the AEAD envelope, the
sole key boundary, schema v1 offline vs live policy, rotation contract shape, and the exact
implementation map for the next encryption implementation commit. No runtime encryption code, no
live factory, no Telegram/OpenClaw/server/live provider wiring, no package-root exports.

## Status

BEGIN_BUILD_3_7G0_MARKERS
BUILD_ID: 3.7G0
BUILD_KIND: ARCHITECTURE_ONLY
IMPLEMENTATION_STATUS: CONTRACTS_ONLY
LIVE_ENCRYPTION: ARCHITECTURE_DECIDED
ENCRYPTION_IMPLEMENTATION: ABSENT
ENCRYPTION_ALGORITHM: AES_256_GCM_NODE_CRYPTO
KEY_IN_SQLITE: FORBIDDEN
KEY_SOURCE: NEO_COMMUNICATION_DATA_KEY_FILE
SILENT_PLAINTEXT_FALLBACK: FORBIDDEN
SCHEMA_V1_PLAINTEXT_OFFLINE: COMPATIBLE
SCHEMA_V1_PLAINTEXT_LIVE: REJECTED
MEMORY_COMMUNICATION_DB_MERGE: FORBIDDEN
PACKAGE_ROOT_EXPORTS: ABSENT
PRODUCTION_COMPOSITION: ABSENT
PROVIDER_ADAPTER: ABSENT
TELEGRAM_ADAPTER: ABSENT
BUILD_3_7F_STATUS: BLOCKED
DURABLE_LIVE_INTEGRATION: BLOCKED_PENDING_ENCRYPTION_IMPLEMENTATION
PRODUCTION_READY: FALSE
SECURITY_APPROVED: FALSE
IMPLEMENTATION_READY: TRUE
NEXT_STAGE: 3.7G_ENCRYPTION_IMPLEMENTATION
END_BUILD_3_7G0_MARKERS

`IMPLEMENTATION_READY: TRUE` means Decisions 1–14 freeze a complete fail-closed at-rest contract
sufficient for a later package-private encryption implementation Build. Architecture-only status
does **not** imply encryption code present, live composition, Telegram wiring, or security approval.

## Decision 1 — Live mode must not store conversational plaintext

In **live** durable composition, user and LLM conversational content must **not** be stored as
plaintext in `neo-communication.sqlite`.

- Offline Build 3.7C/3.7D factory (`createOfflineSqliteCommunicationPorts`) remains plaintext with
  fixed `encryptionEnabled=false` and `livePersistenceAllowed=false` (unchanged).
- Live factory (future) may open only when encryption is proven ready; otherwise readiness /
  startup is fail-closed and `encryptionLiveGateSatisfied` stays false →
  `ENCRYPTION_LIVE_GATE_BLOCKED`.
- Caller booleans are never encryption evidence.
- Memory DB (`neo-memory.sqlite`) and communication DB remain separate files and ownership trees
  (`MEMORY_COMMUNICATION_DB_MERGE: FORBIDDEN`).

## Decision 2 — Exact encrypted vs plaintext-open inventory (schema v1 basis)

Inventory is derived from the actual Build 3.7C schema in
`src/host/storage/sqlite/communication/sqlite-communication-schema.ts` (schema version **1**,
no BLOB columns today). Classification is by **security purpose**, not by SQL type.

### Encrypt-at-rest (conversational / validated text body)

| Table | Column (v1 name) | Reason |
|-------|------------------|--------|
| `outbox_entries` | `plaintext_payload` | Validated outbound text body |
| `conversation_snapshots` | `active_context_json` | Owner/assistant/system-notice `text` entries |
| `conversation_snapshots` | `summary_json` | Model-derived summary `text` |

These are the **only** columns that store user/LLM communication content today. Live mode must
persist them only as versioned AEAD ciphertext envelopes (Decision 4). Schema v2 may rename columns
for honesty (`payload_ciphertext`, `active_context_ciphertext`, `summary_ciphertext`) without
changing which logical fields encrypt.

### Plaintext-open (machine / FIFO / recovery / idempotency / TTL)

| Area | Columns | Why open |
|------|---------|----------|
| `communication_meta` | `id`, `schema_version` | Schema gate |
| `turns` | all columns | State machine, FIFO sequence, recovery ordering; `llm_outcome` is an enum outcome, not model text |
| `turn_dedup` | all | Idempotency tombstones |
| `sequence_counters` | all | Conversation sequencing |
| `factual_history` | all | Append-only status facts |
| `conversation_snapshots` | `owner_id`, `conversation_id`, `revision`, `pause_state`, `checkpoint_status`, `checkpoint_revision`, `fingerprint`, `updated_at` | CAS / barrier / reconcile; fingerprint remains a digest, not ciphertext |
| `checkpoint_ops` | all | Checkpoint/barrier/reconcile idempotency |
| `audit_start` / `audit_completion` | ids, statuses, timestamps, `policy_version`, `operation_kind`, `error_code`, delivery/checkpoint/audit status fields | Two-phase audit machine |
| `outbox_entries` | PK parts (`turn_id`, `correlation_id`, `output_digest`), `expires_at`, `sealed_binding_version`, `scrubbed`, `created_at` | TTL scrub, pending load **without** body, digests |
| `outbox_outcomes` | all | Immutable delivery facts |
| `outbox_reconcile_ops` | all | Reconcile idempotency |

Encrypting the plaintext-open set is **forbidden** when it would break FIFO ordering, recovery
candidate listing, idempotency keys, TTL scrub selection, or state-machine transitions.

### Audit `metadata_json` (explicit non-body)

`audit_start.metadata_json` and `audit_completion.metadata_json` remain **plaintext-open** under
current contracts: redacted `Record<string,string>` after sensitive scan (canonical start metadata
is phase markers, not transcript). They are **not** treated as conversational body. If a future
contract allows freeform owner text in audit metadata, that change requires a new decision package
before encryption scope expands.

### Non-goals

- Do not encrypt indexes, status enums, digests, or foreign keys.
- Do not encrypt memory-database content in this package.
- Do not claim forensic erase; offline `forensicEraseGuaranteed=false` remains.

## Decision 3 — Algorithm and dependency boundary

Use **only** standard Node.js `node:crypto` authenticated encryption:

- Algorithm token: `AES_256_GCM_NODE_CRYPTO` (`aes-256-gcm`).
- No new npm cryptography dependency unless a later decision package proves necessity.
- Existing opaque `SecretData` / `sealSecretData` patterns may hold key material in process memory;
  they do not replace AEAD.

## Decision 4 — Versioned AEAD envelope

Every encrypted field value is a single versioned envelope (stored as TEXT, typically base64 of a
binary frame, or an unambiguous UTF-8 tagged encoding chosen by the implementation Build):

| Field | Requirement |
|-------|-------------|
| `envelopeVersion` | Positive integer; v1 of the envelope format starts at `1` |
| `keyId` | Non-empty stable id of the data key that produced the ciphertext |
| `nonce` | Unique 12-byte nonce per encrypt operation (never reused with the same key) |
| `ciphertext` | AES-256-GCM ciphertext of the UTF-8 plaintext field bytes |
| `tag` | 16-byte authentication tag |

**AAD (associated authenticated data)** must bind at minimum:

```text
neo-communication|<schemaVersion>|<table>|<rowPrimaryKeyCanonical>|<fieldName>|<keyId>
```

Exact canonicalization of composite primary keys is fixed in the implementation Build, but AAD
**must** include table identity, field identity, and row identity so ciphertext cannot be safely
swapped across records or columns. Decrypt must pass the same AAD; mismatch → auth failure.

## Decision 5 — Sole runtime key boundary

Encryption key material:

- **Never** stored in SQLite, tracked config, logs, audit sinks, prompts, or diagnostics payloads.
- **Sole source** for live composition: environment variable
  `NEO_COMMUNICATION_DATA_KEY_FILE=<absolute-path-outside-repository>` pointing to a key file owned
  by the operator (same outside-repo posture as other credential files).
- File contents: exactly 32 raw bytes **or** a single-line base64 encoding of 32 bytes (format
  chosen and validated fail-closed by the implementation Build).
- Loaded once at live factory / readiness into process-memory opaque secret storage; not re-read
  per row unless a later rotation design requires it.
- `keyId` is a non-secret label derived or configured alongside the key file (for example a
  filename stem or adjacent `*.keyid` sidecar policy fixed by implementation). Key bytes themselves
  never appear in envelopes beyond enabling AEAD.

Forbidden key sources for this gate: values embedded in repo config, SQLite rows, Codex/
Telegram credential files, `OPENAI_API_KEY`, and any memory-database material.

## Decision 6 — Missing / invalid key ⇒ fail-closed readiness

Live composition startup / readiness:

- Missing `NEO_COMMUNICATION_DATA_KEY_FILE`, unreadable path, wrong length, or invalid encoding →
  **fail-closed**: factory must not return live ports; diagnostics keep `encryptionEnabled=false`;
  kill-switch observation must not claim `encryptionLiveGateSatisfied=true`.
- Offline factory ignores this env var and remains plaintext offline-only.

## Decision 7 — Decrypt / auth failure ⇒ fail-closed

- Authentication tag failure, AAD mismatch, unknown `envelopeVersion`, unknown `keyId` (with no
  decrypt key available), truncated envelope, or ambiguous encoding → **fail-closed**.
- Ports must not return partial plaintext, raw ciphertext-as-text, or best-effort substrings.
- Mapped outcomes stay in the existing unavailable / policy-reject style of the owning port
  (`unavailable`, `ENCRYPTION_LIVE_GATE_BLOCKED`, or a dedicated typed failure introduced by the
  implementation Build without silent success).

## Decision 8 — Schema v1 plaintext policy (offline compatible / live rejected)

| Mode | Schema v1 plaintext rows | Policy |
|------|--------------------------|--------|
| Offline (`createOfflineSqliteCommunicationPorts`) | Allowed | Compatible; scrub + TTL unchanged |
| Live composition | Forbidden | Reject at open/readiness; no silent migration that leaves plaintext readable |
| Decrypt path when encryption required | Envelope required | Missing envelope ≠ plaintext fallback (`SILENT_PLAINTEXT_FALLBACK: FORBIDDEN`) |

Live implementation must bump communication schema to a version that stores ciphertext for the
encrypted inventory (Decision 2) and proves `encryptionEnabled=true` only after AEAD round-trip
self-check at open. Explicit offline→encrypted migration tooling, if needed, is a **separate**
later Build; this package forbids silent in-place “treat column bytes as plaintext when decrypt
fails”.

## Decision 9 — Key / version rotation contract (no rotation service yet)

Architecture requires envelope `keyId` + `envelopeVersion` so rotation is possible later:

- Encrypt with the **current** data key only.
- Decrypt may accept a bounded set of previous `keyId`s still held in process memory.
- Full rotation service, re-encrypt job, and multi-key file choreography are **out of scope** for
  3.7G0 and the first encryption implementation Build unless that Build’s closeout explicitly adds
  them.
- Dropping a `keyId` without re-encrypt makes historical ciphertext permanently unreadable
  (fail-closed) — accepted.

## Decision 10 — Scanner / policy before encrypt; persistence encrypts before SQLite

Order is normative and security-critical:

```text
plaintext from domain/application
→ sensitive-data scanner + product policy (fail-closed)
→ persistence adapter receives only already-allowed plaintext
→ AEAD encrypt with Decision 4 AAD
→ SQLite bind/sink
```

- Scanner and policy never see ciphertext as a substitute for plaintext review.
- SQLite adapters must not write cleartext for Decision 2 encrypted fields in live mode.
- Reverse path: SQLite read → decrypt/auth → plaintext to trusted consumer; never skip auth.

## Decision 11 — Port-specific treatment (not “all TEXT columns”)

| Port | Encrypt? | Notes |
|------|----------|-------|
| Delivery outbox | Yes — payload body only | `put` encrypts; TTL/scrub/outcome/reconcile metadata stay open; `loadPending` may continue without body |
| Conversation state | Yes — `active_context` / `summary` bodies only | Revision/fingerprint/pause/checkpoint metadata stay open |
| Turn ledger | No | No conversational text columns |
| Factual history | No | Status facts only |
| Audit | No body encryption under Decision 2 | `metadata_json` stays open redacted metadata |
| Checkpoint ops / outcomes / dedup / sequences | No | Machine idempotency |

## Decision 12 — Package-private encryption implementation

- Encryption codecs, key loader, and live factory stay **package-private**.
- **No** root exports via `src/index.ts` / `package.json` `"exports"`.
- Preferred module root for implementation:
  `src/host/storage/sqlite/communication/encryption/`
- Optional narrow port/contract under `src/core/communication/ports/` may describe capability flags
  without exposing key bytes.
- No 3.7F Telegram adapter, OpenClaw route, production server wiring, or live provider composition
  in 3.7G0 or as a hidden side-effect of the first encryption implementation commit.

## Decision 13 — Live gate satisfaction criteria (architecture)

`encryptionLiveGateSatisfied` may become true only when **all** hold:

1. Live communication factory path is used (not offline plaintext factory).
2. Schema version is the encrypted live schema (not plaintext-only v1).
3. Data key loaded successfully from `NEO_COMMUNICATION_DATA_KEY_FILE`.
4. AEAD self-check encrypt/decrypt with AAD succeeds at open.
5. Diagnostics report `encryptionEnabled=true` from factory evidence, not caller booleans.

Until the encryption implementation Build closes these proofs, durable live integration remains
`BLOCKED_PENDING_ENCRYPTION_IMPLEMENTATION` (E1 durable wiring stays blocked by encryption).

## Decision 14 — Exact implementation map (next encryption implementation commit)

Normative file / interface map for **NEXT_STAGE: 3.7G_ENCRYPTION_IMPLEMENTATION**. Architecture
package does not create these files.

### New package-private modules

```text
src/host/storage/sqlite/communication/encryption/communication-aead-envelope.ts
src/host/storage/sqlite/communication/encryption/communication-data-key.ts
src/host/storage/sqlite/communication/encryption/communication-field-cipher.ts
src/host/storage/sqlite/communication/create-live-sqlite-communication-ports.ts
```

| Module | Responsibility |
|--------|----------------|
| `communication-aead-envelope.ts` | Encode/decode versioned envelope; nonce uniqueness; reject unknown versions |
| `communication-data-key.ts` | Load `NEO_COMMUNICATION_DATA_KEY_FILE`; validate 32-byte key; expose `keyId` + opaque `SecretData`; never log material |
| `communication-field-cipher.ts` | `encryptField` / `decryptField` with Decision 4 AAD; fail-closed on auth errors |
| `create-live-sqlite-communication-ports.ts` | Live factory: key load + AEAD self-check + schema gate; sets `encryptionEnabled=true` only on success |

### Schema / serialization touchpoints

```text
src/host/storage/sqlite/communication/sqlite-communication-constants.ts
src/host/storage/sqlite/communication/sqlite-communication-schema.ts
src/host/storage/sqlite/communication/sqlite-communication-serialization.ts
src/host/storage/sqlite/communication/sqlite-communication-delivery-outbox-port.ts
src/host/storage/sqlite/communication/sqlite-conversation-state-port.ts
src/host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts
```

- Add schema **v1 → v2** migration (or equivalent live schema) renaming/storing ciphertext for
  Decision 2 fields; keep plaintext-open machine columns unchanged.
- Offline factory remains schema v1 plaintext path; must refuse to claim live encryption.
- **Encrypt boundary:** inside outbox `put` and conversation `checkpoint` **after** scanner-allowed
  plaintext is in hand, **before** SQLite bind.
- **Decrypt boundary:** inside paths that need body plaintext (delivery consume / conversation
  `load` for prompt assembly). `loadPending` should keep avoiding body decrypt when body unused.

### Contracts / kill-switch / diagnostics (package-private)

```text
src/core/communication/ports/offline-communication-persistence.contract.ts
src/core/communication/ports/communication-delivery-outbox.port.ts
src/core/communication/policy/communication-kill-switch-policy.ts
src/core/communication/application/communication-runtime-diagnostics.ts
```

- Preserve offline fixed `encryptionEnabled: false`.
- Wire live readiness so missing key cannot satisfy `encryptionLiveGateSatisfied`.
- Keep `encryption-required` / `ENCRYPTION_LIVE_GATE_BLOCKED` semantics consistent.

### Operator surface (no secrets in repo)

```text
.env.example  — document NEO_COMMUNICATION_DATA_KEY_FILE=<path-outside-repository> only
```

### Tests and live gate (implementation Build)

```text
tests/host-sqlite-communication-encryption.test.ts
tests/communication/communication-encryption-live-gate.test.ts
tests/communication/communication-encryption-envelope.test.ts
tests/host-sqlite-communication-ports.test.ts  — offline plaintext regression unchanged
scripts/verify-communication-boundaries.mjs    — allowlist encryption modules; forbid root export
```

Required behavioral coverage:

- exact probe/offline profile still passes plaintext offline;
- live open without key → fail-closed;
- encrypt/decrypt round-trip with AAD;
- ciphertext swap across rows/fields → auth failure;
- decrypt failure returns no partial plaintext;
- schema v1 plaintext rejected by live factory;
- no silent plaintext fallback;
- public API isolation (no root export of encryption helpers).

### Explicitly out of scope for the implementation commit

- Telegram / 3.7F adapters
- OpenClaw / server / production composition
- Full key-rotation service
- Merging memory and communication databases
- Live Codex durable wiring (remains blocked until encryption implementation + gate proofs close)

## Non-claims

- Encryption runtime is **absent** (`ENCRYPTION_IMPLEMENTATION: ABSENT`).
- Production and security approval remain **FALSE**.
- Build 3.7F remains **BLOCKED**.
- This package does not change production TypeScript behavior.
