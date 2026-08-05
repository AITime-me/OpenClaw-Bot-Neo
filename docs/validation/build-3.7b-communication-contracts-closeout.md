# Build 3.7B — Communication Offline Contracts Closeout

Build 3.7B implements **offline-only** communication contracts under `src/core/communication/`
(domain, ports, policy). No runtime composition, adapters, durable stores, or root package exports.

## Status

BEGIN_BUILD_3_7B_MARKERS
BUILD_ID: 3.7B
BUILD_KIND: OFFLINE_CONTRACT_IMPLEMENTATION
IMPLEMENTATION_STATUS: CONTRACTS_ONLY
OFFLINE_ONLY: TRUE
COMMUNICATION_PRINCIPAL: IMPLEMENTED
MEMORY_AUTHORIZATION_BOUNDARY: IMPLEMENTED
PORT_CONTRACTS: IMPLEMENTED
POLICY_CONTRACTS: IMPLEMENTED
BOUNDARY_VALIDATION: IMPLEMENTED
DURABLE_PERSISTENCE: ABSENT
PROVIDER_ADAPTER: ABSENT
LIVE_MODEL_CALLS: ABSENT
TELEGRAM_ADAPTER: ABSENT
SQLITE_IMPLEMENTATION: ABSENT
EXECUTABLE_COMMUNICATION_RUNTIME: ABSENT
PRODUCTION_COMPOSITION: ABSENT
PACKAGE_ROOT_EXPORTS: ABSENT
ENCRYPTION_IMPLEMENTATION: ABSENT
BUILD_3_7E1_STATUS: BLOCKED
BUILD_3_7F_STATUS: BLOCKED
PRODUCTION_READY: FALSE
SECURITY_APPROVED: FALSE
NEXT_STAGE: 3.7C
END_BUILD_3_7B_MARKERS

## Implemented (contracts only)

- `AuthenticatedCommunicationPrincipal` with WeakMap-only trust and package-private issuer in `.internal.ts`
- Communication memory read authorization policy and broker port contract (read-only, personal namespace)
- Turn ledger, audit, delivery outbox, kill-switch, LLM completion, and conversation-state port contracts
- Text prompt/output policies with fixed security/persona sections and scanner fail-closed behavior
- Boundary checker integration, communication boundary script, fixture trees, and contract tests

## Still absent

- Durable SQLite communication stores, live Telegram/provider adapters, executable runtime wiring
- Production composition, encryption live implementation, and package-root exports
- Build 3.7E1 live subscription probe and Build 3.7F operational approval remain **BLOCKED**

## Package-private note

`src/core/communication/**` is **package-private**. Consumers must not import it from outside the
repository; only boundary tests and internal policy modules may reach issuer/sealer internals via
explicit allowlists. Root barrels (`src/index.ts`, `src/core/domain/index.ts`, etc.) must not
re-export communication symbols.

## Next stage

Build **3.7C** follows after 3.7B contract validation. Builds 3.7E1 and 3.7F remain blocked until
offline contracts are integrated and live gates are explicitly approved.

Build 3.7B status: offline contracts implemented; live runtime absent.

Build 3.7E1 status: BLOCKED

Build 3.7F status: BLOCKED

Build 3.7B next stage: 3.7C
