# Build 3.7C0 — Communication Persistence Decisions

Build 3.7C0 is an **architecture/contract corrective** ahead of offline SQLite persistence.
It records retention, recovery, checkpoint reconciliation, offline plaintext boundaries, and narrow
persistence facades. No SQLite schema, migrations, runtime, adapters, or production composition.

## Status

BEGIN_BUILD_3_7C0_MARKERS
BUILD_ID: 3.7C0
BUILD_KIND: PERSISTENCE_DECISIONS_CONTRACT
IMPLEMENTATION_STATUS: CONTRACTS_ONLY
BUILD_3_7C_MODE: OFFLINE_ONLY
DURABLE_SQLITE_IMPLEMENTATION: ABSENT
LIVE_ENCRYPTION: NOT_IMPLEMENTED
EXECUTABLE_COMMUNICATION_RUNTIME: ABSENT
PRODUCTION_COMPOSITION: ABSENT
PACKAGE_ROOT_EXPORTS: ABSENT
PROVIDER_ADAPTER: ABSENT
TELEGRAM_ADAPTER: ABSENT
BUILD_3_7E1_STATUS: BLOCKED
BUILD_3_7F_STATUS: BLOCKED
PRODUCTION_READY: FALSE
SECURITY_APPROVED: FALSE
NEXT_STAGE: 3.7C_IMPLEMENTATION
END_BUILD_3_7C0_MARKERS

## Decision 1 — Retention

- Turn rows, dedup tombstones, sequence counters, factual history, audit, checkpoint operations, and
  outbox tombstones are retained indefinitely.
- Conversation state stores only the current snapshot.
- Outbox plaintext payload TTL is at most 24 hours (`86400000` ms) and is logically scrubbed after
  expiry.
- Delivery outcome unknown remains immutable.
- Automatic VACUUM, compaction, and production cleanup are forbidden.
- Diagnostics fix `forensicEraseGuaranteed=false`.

Contract constants live in
`src/core/communication/ports/offline-communication-persistence.contract.ts`.

## Decision 2 — Recovery contract

`CommunicationRecoveryCandidate` includes:

- `turnId`
- nullable `correlationId` / `ownerId` / `conversationId`
- `observedAt` / `updatedAt`
- nullable `llmOutcome` / `errorCode`
- `CommunicationTurnRecord`
- non-empty `recoveryReasons`

Candidates do not contain authority, principal, admission evidence, output capability, payload, or
recipient, and do not authorize LLM, delivery, or resend.

Query validation is fail-closed:

- `states` must be an array of length 1..16 with only legal turn states and no duplicates;
- `limit` must be a `Number.isSafeInteger` in 1..100;
- `NaN`, `Infinity`, `-Infinity`, fractions, unsafe integers, and non-arrays → `CONFIG_INVALID`.

Ordering: `updatedAt`, `observedAt`, `turnId`.

## Decision 3 — reconcileCheckpoint

Eligible only: `pending → succeeded`, `failed → succeeded`.

Outcomes:

- `reconciled` → `revision`
- `already-reconciled` → `revision`
- `not-found`
- `not-eligible` → `status: not_required | succeeded` + `currentRevision`
- `stale-revision` → `currentRevision`
- `idempotency-conflict`
- `unavailable` → `reason`

Reconciliation must not create a snapshot, mutate context/summary/pause state, or invoke
LLM/delivery/memory/audit. Successful reconcile increments revision by 1. Fingerprint is computed
inside the port.

## Decision 4 — Offline plaintext boundary

Future package-private factory: `createOfflineSqliteCommunicationPorts`
(exact module `host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts`).

Fixed flags: `maxOutboxTtlMs=86400000`, `livePersistenceAllowed=false`, `encryptionEnabled=false`,
`deliveryExecutionAvailable=false`, `automaticResendAvailable=false`, `productionWired=false`.
Scrub expired plaintext on open and before every outbox method. Caller booleans are not encryption
evidence. Live factory is not implemented in this build.

## Decision 5 — Narrow persistence facades

```text
src/core/communication/domain/fresh-observed-admission-evidence.persistence.internal.ts
src/core/communication/domain/authenticated-communication-principal.persistence.internal.ts
src/core/communication/domain/validated-text-output.persistence.internal.ts
```

Exact export surfaces (wrappers only; no `export *`, no re-export of original internals):

- fresh-observed: `sealFreshObservedAdmissionEvidenceForPersistence(turnId)`
- principal: `AuthenticatedCommunicationPrincipalPersistenceClaims`,
  `readAuthenticatedCommunicationPrincipalPersistenceClaims(principal)`
  (claims: turnId, ownerId, conversationId, transportInstanceId, bindingVersion, observedAt —
  no `actorId`)
- validated-output: `ValidatedTextOutputPersistenceMetadata`,
  `isGenuineValidatedTextOutputForPersistence`,
  `readValidatedTextOutputMetadataForPersistence`,
  `readValidatedTextOutputPlaintextForOfflineOutbox`

Registries, issuer, sealer, and canonical getters are not exported.

Exact allowlisted importer only:
`host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts`
(wildcard forbidden). AST boundary checker enforces exact export names, no extra exports, no
`export *`, no re-export, exact importer path, no barrel re-export, and no dynamic import.
dependency-cruiser and negative fixtures cover sibling host, runtime, adapter, barrel, extra export,
export star, re-export, and direct original internals.

## Still absent

- SQLite schema, migrations, and port implementations
- Runtime, provider, Telegram, delivery execution, production composition
- Live encryption and live factory
- Build 3.7E1 and Build 3.7F remain **BLOCKED**

## Next stage

Build **3.7C_IMPLEMENTATION** may implement offline SQLite ports against these contracts.
Builds 3.7E1 and 3.7F remain blocked until offline persistence and live gates are explicitly approved.

Build 3.7C0 mode: OFFLINE_ONLY

Build 3.7E1 status: BLOCKED

Build 3.7F status: BLOCKED

Build 3.7C0 next stage: 3.7C_IMPLEMENTATION
