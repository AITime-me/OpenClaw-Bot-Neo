# Build 3.7G0 — Communication Encryption At-Rest Decisions

Build 3.7G0 records the **architecture-only** encryption live gate for durable text communication
persistence in `neo-communication.sqlite`. It freezes which fields encrypt, the AEAD envelope, the
sole key boundary, schema v1 offline vs live v2 policy, audit metadata allowlist, conversation
field-codec coverage, live-gate port construction rules, and the exact implementation map for the
next encryption implementation commit. No runtime encryption code, no live factory, no
Telegram/OpenClaw/server/live provider wiring, no package-root exports.

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
KEY_FILE_FORMAT: BASE64_32
KEY_ID_DERIVATION: SHA256_HEX_OF_KEY_BYTES
SILENT_PLAINTEXT_FALLBACK: FORBIDDEN
SCHEMA_V1_PLAINTEXT_OFFLINE: COMPATIBLE
SCHEMA_V1_PLAINTEXT_LIVE: REJECTED
SCHEMA_V2_LIVE_ENCRYPTED: REQUIRED
AUTOMATIC_V1_TO_V2_MIGRATION: FORBIDDEN
LIVE_GATE_REQUIRES_ENCRYPTION_AWARE_PORTS: TRUE
AUDIT_METADATA_POLICY: EXACT_ALLOWLIST
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
  fixed `encryptionEnabled=false` and `livePersistenceAllowed=false` (unchanged behavior on
  schema v1).
- Live factory (future) may return a ready handle / gate evidence only under Decision 13.
- Caller booleans are never encryption evidence.
- Memory DB (`neo-memory.sqlite`) and communication DB remain separate files and ownership trees
  (`MEMORY_COMMUNICATION_DB_MERGE: FORBIDDEN`).

## Decision 2 — Exact encrypted vs plaintext-open inventory (schema v1 basis)

Inventory is derived from the actual Build 3.7C schema in
`src/host/storage/sqlite/communication/sqlite-communication-schema.ts` (offline schema version
**1**, no BLOB columns today). Classification is by **security purpose**, not by SQL type.

### Encrypt-at-rest (conversational / validated text body)

| Table | Column (v1 name) | Reason |
|-------|------------------|--------|
| `outbox_entries` | `plaintext_payload` | Validated outbound text body |
| `conversation_snapshots` | `active_context_json` | Owner/assistant/system-notice `text` entries |
| `conversation_snapshots` | `summary_json` | Model-derived summary `text` |

Live schema v2 may rename these for honesty (`payload_ciphertext`, `active_context_ciphertext`,
`summary_ciphertext`) without changing which logical fields encrypt. Live mode persists them only
as versioned AEAD ciphertext envelopes (Decision 4).

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

Encrypting the plaintext-open machine set is **forbidden** when it would break FIFO ordering,
recovery candidate listing, idempotency keys, TTL scrub selection, or state-machine transitions.

### Audit `metadata_json` — exact live allowlist (not scanner-only)

Port type `redactedMetadata: Record<string, string>` is too wide for live. SensitiveDataScanner
alone is **not** sufficient. Proven current application call sites are only:

| Call site | `operationKind` | `redactedMetadata` |
|-----------|-----------------|--------------------|
| `process-text-turn.service.ts` `recordStart` | `text-turn` | `{ phase: 'start' }` |
| `checkpoint-finalization.ts` `recordCompletion` | `text-turn` | `{ phase: 'completion', checkpointStatus: 'succeeded'\|'failed', deliveryStatus: 'delivered'\|'failed' }` |
| `recover-communication-turns.service.ts` `recordCompletion` | `text-turn` | `{ phase: 'completion', checkpointStatus: 'succeeded'\|'failed', deliveryStatus: 'delivered'\|'failed'\|'outcome_unknown' }` |

No current call site uses `operationKind` `deterministic-notice` or `checkpoint-reconciliation`.

**Live exact allowlist** (reject before SQLite bind; unknown key/value/freeform text forbidden):

```text
operationKind = text-turn
  start:
    keys = { phase }
    phase = start
  completion:
    keys = { phase, checkpointStatus, deliveryStatus }
    phase = completion
    checkpointStatus ∈ { succeeded, failed }
    deliveryStatus ∈ { delivered, failed, outcome_unknown }

operationKind ∈ { deterministic-notice, checkpoint-reconciliation }
  → REJECT until a future decision package adds proven call-site allowlists
```

Therefore `audit_start.metadata_json` / `audit_completion.metadata_json` remain **plaintext-open
only when they match this allowlist**. They are **not** in the encrypt-at-rest inventory because
the allowlist is fully proven for every current path. If a future path needs freeform text or
cannot be allowlisted, that path’s `metadata_json` must move into encrypt-at-rest via a new
decision package.

**Implementation regression requirement:** an arbitrary non-secret sentence injected into audit
metadata must be rejected and must not persist as plaintext in SQLite.

### Non-goals

- Do not encrypt indexes, status enums, digests, or foreign keys.
- Do not encrypt memory-database content in this package.
- Do not claim forensic erase; offline `forensicEraseGuaranteed=false` remains.

## Decision 3 — Algorithm and dependency boundary

Use **only** standard Node.js `node:crypto` authenticated encryption:

- Algorithm token: `AES_256_GCM_NODE_CRYPTO` (`aes-256-gcm`).
- 12-byte nonce; 16-byte authentication tag.
- No new npm cryptography dependency.
- Existing opaque `SecretData` / `sealSecretData` patterns may hold key material in process memory;
  they do not replace AEAD.

## Decision 4 — Versioned AEAD envelope

Every encrypted field value is a single versioned envelope stored as TEXT (canonical encoding fixed
by the implementation Build, but must be unambiguous and reject ambiguous forms):

| Field | Requirement |
|-------|-------------|
| `envelopeVersion` | Positive integer; envelope format starts at `1` |
| `keyId` | Deterministic non-secret id from Decision 5 (`SHA256_HEX_OF_KEY_BYTES`) |
| `nonce` | Unique 12-byte nonce per encrypt operation (never reused with the same key) |
| `ciphertext` | AES-256-GCM ciphertext of the UTF-8 plaintext field bytes |
| `tag` | 16-byte authentication tag |

**AAD (associated authenticated data)** must bind at minimum:

```text
neo-communication|<schemaVersion>|<table>|<rowPrimaryKeyCanonical>|<fieldName>|<keyId>
```

AAD **must** include table identity, field identity, and row identity so ciphertext cannot be
safely swapped across records or columns. Decrypt must pass the same AAD; mismatch → auth failure.
Composite primary-key canonicalization is fixed in the implementation Build and must be stable.

## Decision 5 — Sole runtime key boundary (frozen format)

Encryption key material:

- **Never** stored in SQLite, tracked config, logs, audit sinks, prompts, or diagnostics payloads.
- **Sole source** for live composition: environment variable
  `NEO_COMMUNICATION_DATA_KEY_FILE=<absolute-path>` (no silent alternate source: not cwd-relative
  lookup, not in-repo defaults, not SQLite, not other credential files).
- **Canonical key-file format (`KEY_FILE_FORMAT: BASE64_32`):** exactly one line of
  standard base64 decoding to **exactly 32 bytes**. Raw binary key files are **rejected**.
- **Canonical `keyId` (`KEY_ID_DERIVATION: SHA256_HEX_OF_KEY_BYTES`):** lowercase hex SHA-256 of
  the decoded 32 key bytes. No filename-stem / sidecar / operator-chosen keyId.
- Path requirements (all mandatory, fail-closed):
  - absolute path;
  - resolved via canonical/real path (no symlink escape into forbidden roots);
  - regular file;
  - outside the repository root;
  - outside the communication DB / storage root used by the live factory.
- Loaded once at live factory / readiness into process-memory opaque secret storage.

Forbidden key sources: repo config, SQLite rows, Codex/Telegram credential files,
`OPENAI_API_KEY`, memory-database material, relative paths, and any second env/file fallback.

## Decision 6 — Missing / invalid key ⇒ fail-closed readiness

Live composition startup / readiness:

- Missing `NEO_COMMUNICATION_DATA_KEY_FILE`, non-absolute path, failed realpath, non-regular file,
  path inside repo or communication storage root, wrong base64, or decoded length ≠ 32 →
  **fail-closed**: factory must not return a ready live handle; diagnostics keep
  `encryptionEnabled=false`; kill-switch observation must not claim
  `encryptionLiveGateSatisfied=true`.
- Offline factory ignores this env var and remains plaintext offline-only.

## Decision 7 — Decrypt / auth failure ⇒ fail-closed

- Authentication tag failure, AAD mismatch, unknown `envelopeVersion`, unknown `keyId` (with no
  decrypt key available), truncated envelope, or ambiguous encoding → **fail-closed**.
- Ports must not return partial plaintext, raw ciphertext-as-text, or best-effort substrings.
- Mapped outcomes stay in the existing unavailable / policy-reject style of the owning port
  (`unavailable`, `ENCRYPTION_LIVE_GATE_BLOCKED`, or a dedicated typed failure introduced by the
  implementation Build without silent success).

## Decision 8 — Schema split: offline v1 vs live encrypted v2 (no automatic migration)

Exact split (`AUTOMATIC_V1_TO_V2_MIGRATION: FORBIDDEN`):

| Concern | Policy |
|---------|--------|
| Existing offline factory `createOfflineSqliteCommunicationPorts` | Remains **schema v1 plaintext**; continues to verify the existing V1 contract; behavior unchanged |
| First live factory | Uses a **separate encrypted schema v2** contract + verifier (`SCHEMA_V2_LIVE_ENCRYPTED: REQUIRED`) |
| Empty live DB | Created **directly as v2** (no intermediate plaintext v1) |
| Existing v1 DB opened by live factory | **REJECTED** fail-closed (`SCHEMA_V1_PLAINTEXT_LIVE: REJECTED`) |
| First 3.7G encryption implementation | **No** automatic/silent v1→v2 migration code |
| Explicit offline-v1 → encrypted-v2 migration tooling | **Separate future Build** only |

Decrypt path when encryption is required: envelope required; missing envelope ≠ plaintext fallback
(`SILENT_PLAINTEXT_FALLBACK: FORBIDDEN`).

## Decision 9 — Key / version rotation contract (no rotation service yet)

Architecture requires envelope `keyId` + `envelopeVersion` so rotation is possible later:

- Encrypt with the **current** data key only.
- Decrypt may accept a bounded set of previous `keyId`s still held in process memory.
- Full rotation service, re-encrypt job, and multi-key file choreography are **out of scope** for
  3.7G0 and the first encryption implementation Build.
- Dropping a `keyId` without re-encrypt makes historical ciphertext permanently unreadable
  (fail-closed) — accepted.

## Decision 10 — Scanner / policy before encrypt; persistence encrypts before SQLite

Order is normative and security-critical:

```text
plaintext from domain/application
→ sensitive-data scanner + product policy (fail-closed)
→ live audit metadata exact allowlist (Decision 2) before audit SQLite bind
→ persistence adapter receives only already-allowed plaintext
→ AEAD encrypt with Decision 4 AAD (encrypted inventory)
→ SQLite bind/sink
```

- Scanner and policy never see ciphertext as a substitute for plaintext review.
- SQLite adapters must not write cleartext for Decision 2 encrypted fields in live mode.
- Reverse path: SQLite read → decrypt/auth → plaintext to trusted consumer; never skip auth.

## Decision 11 — Port-specific treatment and unified conversation field codec

| Port | Encrypt? | Notes |
|------|----------|-------|
| Delivery outbox | Yes — payload body only | `put` encrypts; TTL/scrub/outcome/reconcile metadata stay open; `loadPending` may continue without body |
| Conversation state | Yes — `active_context` / `summary` bodies only | All accesses use one encryption-aware row/field codec (below) |
| Turn ledger | No | No conversational text columns |
| Factual history | No | Status facts only |
| Audit | Allowlist-only plaintext metadata (Decision 2) | Not encrypt-at-rest while allowlist holds |
| Checkpoint ops / outcomes / dedup / sequences | No | Machine idempotency |

### Unified encryption-aware conversation codec

Live conversation-state must use a **single** encryption-aware row/field codec for
`active_context` / `summary` on **every** current path that reads, copies, re-encodes, or
decodes those fields, including at least:

- `load`
- `checkpoint`
- `recordCheckpointBarrier` (including protective empty snapshot create and existing-row barrier
  that currently decodes for fingerprint then rewrites field bytes)
- `reconcileCheckpoint` (currently decodes snapshot JSON then keeps field bytes)

Byte-identical ciphertext passthrough is allowed only when the codec authenticates the envelope
under the correct AAD for that row/field (or proves the bytes are already the sealed envelope for
that identity). Raw plaintext JSON must never be written by live ports.

**Implementation tests must prove:** barrier and recovery operate on encrypted snapshots; tampered
ciphertext fails closed with no partial plaintext.

## Decision 12 — Package-private encryption implementation

- Encryption codecs, key loader, and live factory stay **package-private**.
- **No** root exports via `src/index.ts` / `package.json` `"exports"`.
- Preferred module root for implementation:
  `src/host/storage/sqlite/communication/encryption/`
- Optional narrow port/contract under `src/core/communication/ports/` may describe capability flags
  without exposing key bytes.
- No 3.7F Telegram adapter, OpenClaw route, production server wiring, or live provider composition
  in 3.7G0 or as a hidden side-effect of the first encryption implementation commit.

## Decision 13 — Live gate satisfaction criteria (encryption-aware ports required)

`encryptionLiveGateSatisfied=true` is **not** satisfied by a standalone AEAD self-check alone.

Live factory may return a ready handle / gate evidence only when **all** hold:

1. Live communication factory path is used (not offline plaintext factory).
2. Schema verifier is the **encrypted v2** contract (not plaintext v1).
3. Data key loaded successfully under Decision 5.
4. Factory has **actually constructed** encryption-aware **outbox** and **conversation-state**
   ports that hold a sealed/internal cipher capability (`LIVE_GATE_REQUIRES_ENCRYPTION_AWARE_PORTS:
   TRUE`).
5. Diagnostics report `encryptionEnabled=true` from that factory evidence, not caller booleans.

**Forbidden gate evidence:**

- legacy / offline plaintext ports injected into a live composition;
- AEAD self-check without encryption-aware outbox + conversation-state construction;
- caller-supplied `encryptionLiveGateSatisfied=true`.

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
src/host/storage/sqlite/communication/encryption/communication-conversation-field-codec.ts
src/host/storage/sqlite/communication/create-live-sqlite-communication-ports.ts
```

| Module | Responsibility |
|--------|----------------|
| `communication-aead-envelope.ts` | Encode/decode versioned envelope; nonce uniqueness; reject unknown versions |
| `communication-data-key.ts` | Load `NEO_COMMUNICATION_DATA_KEY_FILE`; enforce `BASE64_32` + path rules; derive `keyId = SHA-256 hex`; opaque `SecretData`; never log material |
| `communication-field-cipher.ts` | `encryptField` / `decryptField` with Decision 4 AAD; fail-closed on auth errors |
| `communication-conversation-field-codec.ts` | Unified active_context/summary encode-decode for load/checkpoint/barrier/reconcile |
| `create-live-sqlite-communication-ports.ts` | Live factory: key load + **v2 schema create/verify** + construct encryption-aware outbox/conversation ports with sealed cipher; ready/gate only after that construction |

### Schema / serialization touchpoints

```text
src/host/storage/sqlite/communication/sqlite-communication-constants.ts
src/host/storage/sqlite/communication/sqlite-communication-schema.ts
src/host/storage/sqlite/communication/sqlite-communication-serialization.ts
src/host/storage/sqlite/communication/sqlite-communication-delivery-outbox-port.ts
src/host/storage/sqlite/communication/sqlite-conversation-state-port.ts
src/host/storage/sqlite/communication/sqlite-communication-audit-port.ts
src/host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts
```

- Keep offline factory on **schema v1 plaintext verifier** unchanged.
- Add a **separate live encrypted schema v2** create/verify path; empty live DB is created as v2.
- Live open of existing v1 DB → reject. **Do not** ship automatic/silent v1→v2 migration in the
  first 3.7G implementation commit.
- **Encrypt boundary:** inside live outbox `put` and conversation codec write paths **after**
  scanner-allowed plaintext is in hand, **before** SQLite bind.
- **Decrypt boundary:** inside paths that need body plaintext (delivery consume / conversation
  load/decode for prompt, fingerprint, barrier, reconcile). `loadPending` should keep avoiding body
  decrypt when body unused.
- Live audit port enforces Decision 2 exact metadata allowlist before bind.

### Contracts / kill-switch / diagnostics (package-private)

```text
src/core/communication/ports/offline-communication-persistence.contract.ts
src/core/communication/ports/communication-delivery-outbox.port.ts
src/core/communication/policy/communication-kill-switch-policy.ts
src/core/communication/application/communication-runtime-diagnostics.ts
```

- Preserve offline fixed `encryptionEnabled: false`.
- Wire live readiness so missing key, v1 DB, plaintext ports, or incomplete factory construction
  cannot satisfy `encryptionLiveGateSatisfied`.
- Keep `encryption-required` / `ENCRYPTION_LIVE_GATE_BLOCKED` semantics consistent.

### Operator surface (no secrets in repo)

```text
.env.example  — document NEO_COMMUNICATION_DATA_KEY_FILE=<absolute-path-outside-repository> only
              — document BASE64_32 key file format; never embed key bytes
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

- offline v1 plaintext factory behavior unchanged;
- live open without key → fail-closed;
- live open of existing v1 DB → rejected;
- empty live DB created as v2;
- no automatic v1→v2 migration path present;
- encrypt/decrypt round-trip with AAD; ciphertext swap across rows/fields → auth failure;
- decrypt/tamper failure returns no partial plaintext;
- **acceptance:** write real owner/LLM text through real live outbox + conversation-state ports →
  raw SQLite inspection shows plaintext absent and envelope present;
- **acceptance:** legacy/plaintext port injection cannot produce ready gate /
  `encryptionLiveGateSatisfied=true`;
- barrier + reconcile/recovery on encrypted snapshot succeed; tampered ciphertext fail-closed;
- audit metadata allowlist: arbitrary non-secret sentence rejected and not stored plaintext;
- key file: only `BASE64_32`; `keyId = SHA-256 hex` of key bytes; forbidden paths rejected;
- public API isolation (no root export of encryption helpers).

### Explicitly out of scope for the implementation commit

- Telegram / 3.7F adapters
- OpenClaw / server / production composition
- Full key-rotation service
- Automatic or silent v1→v2 migration
- Explicit offline-v1 → encrypted-v2 migration tooling (future Build)
- Merging memory and communication databases
- Live Codex durable wiring (remains blocked until encryption implementation + gate proofs close)

## Non-claims

- Encryption runtime is **absent** (`ENCRYPTION_IMPLEMENTATION: ABSENT`).
- Production and security approval remain **FALSE**.
- Build 3.7F remains **BLOCKED**.
- This package does not change production TypeScript behavior.
