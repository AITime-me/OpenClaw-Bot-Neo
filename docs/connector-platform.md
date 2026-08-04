# Connector Platform (Build 3.5B)

Build 3.5B adds a connector platform foundation without production wiring, real integrations,
OAuth, network clients, or a production Secret Provider.

## Purpose

The platform provides:

- connector domain contracts and bounded JSON models;
- Connector SDK lifecycle contracts;
- in-memory connector catalog, tool, connection and health registries;
- capability manifests and validated tool manifests;
- deny-by-default `ToolPolicyEngine`;
- digest-bound single-use `ToolApprovalPort` with separate `ToolApprovalDecisionPort`;
- safe `ToolAuditPort` and `ConnectorSecretProvider` ports;
- mandatory `ToolInvocationOrchestrator` pipeline;
- offline reference connector for tests only.

## Mandatory invocation pipeline

1. Safe invocation-requested audit.
2. Resolve tool and connector manifests.
3. Validate manifest relationship.
4. Bound and schema-validate input.
5. Resolve account connection when required.
6. Select `SecretReference` metadata only.
7. Evaluate policy.
8. Create or consume approval when required.
9. Resolve opaque secret handle only after authorization.
10. Execute connector with timeout and cooperative cancellation.
11. Bound and schema-validate output.
12. Mark output `contentTrust=untrusted`.
13. Update health and emit bounded audit events.

Policy denial, capability denial, and missing approval must not call `ConnectorSecretProvider`.

## Approval requires trusted decision

`ToolApprovalPort.createRequest` creates a `pending` record only. A separate trusted
`ToolApprovalDecisionPort` (`grant`, `deny`, `revoke`) is required before
`consumeGrant` can succeed. Approval identifiers and nonces are cryptographically random.
The requesting execution actor cannot self-grant.

## Executable connector access

Public `ConnectorCatalog` exposes manifest metadata only. Executable `Connector` instances are
available only through the orchestrator-private `ConnectorExecutionRegistry`.

## Capability versus authorization

`ToolCapability` discovery in manifests is not authorization. `ToolPolicyEngine` and connection
`allowedCapabilities` enforce authorization after manifest validation.

## Side-effect classes and financial hard deny

`ToolSideEffectClass.FINANCIAL` represents actions that move money or change financial state.
Such tools are rejected at manifest validation and hard-denied by default policy.

Read-only financial analysis uses `READ_ONLY` with appropriate data sensitivity and policy
decisions; it is not treated as a financial action merely because the domain is finance.

## Approval binding

Approvals bind `invocationId`, `toolId`, `connectorId`, `connectionId`, canonical input digest,
`sideEffectClass`, expiry, requesting actor, approving actor, and single-use nonce. Canonical
digest uses sorted object keys and SHA-256.

## Secret resolution timing

Only `AccountConnection` and `SecretReference` metadata are available before policy and approval.
`ConnectorSecretProvider.resolveHandle` runs only after policy allows execution and any required
approval is consumed.

## Audit safety

Audit events contain bounded metadata and digest prefixes only. No full input, output, remote
body, secret material, or opaque handle identifiers.

## Untrusted output

Connector output is always `contentTrust=untrusted` in `ToolInvocationResult`, even after schema
validation. Connectors must not create platform results, audit events, or policy decisions.

## Cancellation limits

Cancellation is cooperative via `AbortSignal`. Connectors that ignore the signal are not hard-
stopped. Late write-like completion after abort may report `executionState=outcome-unknown`.
Platform errors do not echo raw connector reason text.

## Connector-local execution outcome

Connector-local failures may carry a closed typed `executionOutcome`:
`known-failure` (default) or `outcome-unknown`. Only write-like tools may normalize validated
`outcome-unknown` into `ToolInvocationResult.executionState=outcome-unknown`. Free-form `reason`
text is display/debug metadata only and has no mapping authority. `READ_ONLY` failures that claim
`outcome-unknown` remain ordinary bounded failures. Malformed outcome values fail closed as
`known-failure`. The field is connector-platform owned and is not ToolManifest/model input.
`ToolInvocationOrchestrator` imports no infrastructure modules; free-form `reason` text has no
mapping authority.

Build 3.6B infrastructure connector uses this contract for uncertain write-like mutations without
coupling the shared orchestrator to infrastructure-specific strings. Idempotency remains manifest-
declared only; no durable cross-process idempotency is claimed.

## Persistence and reference connector

Registries and approval grants are in-memory only in Build 3.5B. The reference connector under
`src/connectors/reference` is test/dev only and must not be imported by production composition.

Real connectors (GitHub, amoCRM, email, Telegram, Timeweb) are deferred.

## Approval clock

In-memory approval ports require an explicit injected `ClockPort`. Expiry is evaluated when a
trusted decision attempts to grant a pending request; expiry is evaluated when execution attempts to
consume a granted approval; `createRequest` stores the requested expiry; deny and revoke are
terminal state transitions and do not need an expiry evaluation to become more permissive; no
expired approval can become executable. Grant and consume expiry checks use the same injected clock
domain (`now < expiresAt` is valid; `now === expiresAt` is expired). Malformed stored expiry
timestamps fail closed as expired; malformed clock readings return bounded `MALFORMED` failures.
Expired approval cannot resolve secrets or execute a connector.

## Status

- Build 3.5B integrated into local `main` via fast-forward after feature-branch closeout; approval
  clock corrective at `2237bd726eb1f65374d835e2584724718da325a5`.
- Post-integration Windows EOL mismatch was worktree-only (`core.autocrlf=true`); committed blobs
  and index remained LF; no EOL corrective commit required.
- Approval clock corrective independently approved
  (`BUILD_3_5B_APPROVAL_CLOCK_CORRECTIVE_REREVIEW_APPROVED_WITH_NOTES`); full local postcheck green
  (47/47 focused, 1771 passed / 3 skipped).
- Dispositions:
  `BUILD_3_5B_APPROVAL_CLOCK_CORRECTIVE_CLOSED_WITH_SINGLE_INJECTED_TIME_DOMAIN`;
  `BUILD_3_5B_CONNECTOR_PLATFORM_CORE_CLOSED_WITH_TRUSTED_APPROVAL_PRIVATE_EXECUTION_BOUNDED_DATA_AND_SAFE_INVOCATION_PIPELINE`.
- Feature branch `build-3-5b-connector-platform-core` remains at `16bf1f4` pending owner-directed
  synchronization.
- See
  [closeout record](validation/build-3.5b-connector-platform-core-closeout.md).
- `SECRET_PROVIDER_CONFIGURED=false`.
- Build 3.6B infrastructure fleet foundation closed on feature branch with final corrective-2
  approval; see [infrastructure closeout](validation/build-3.6b-infrastructure-fleet-foundation-closeout.md).
  `main` integration and push pending.
- No production Secret Provider, OAuth, network, real connectors, or production composition wiring.
- Durable approval/audit persistence absent. Diagnostics remain false. No push performed.
