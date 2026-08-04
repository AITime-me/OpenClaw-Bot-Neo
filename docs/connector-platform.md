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

## Persistence and reference connector

Registries and approval grants are in-memory only in Build 3.5B. The reference connector under
`src/connectors/reference` is test/dev only and must not be imported by production composition.

Real connectors (GitHub, amoCRM, email, Telegram, Timeweb) are deferred.

## Status

- Build 3.5B closed on feature branch `build-3-5b-connector-platform-core` after security
  corrective re-review (`APPROVE_WITH_NOTES_BUILD_3_5B_SECURITY_CORRECTIVE_FOR_CLOSEOUT`).
- Disposition:
  `BUILD_3_5B_CONNECTOR_PLATFORM_CORE_CLOSED_WITH_TRUSTED_APPROVAL_PRIVATE_EXECUTION_BOUNDED_DATA_AND_SAFE_INVOCATION_PIPELINE`.
- See
  [closeout record](validation/build-3.5b-connector-platform-core-closeout.md).
- Transfer/integration into `main` remains a separate owner-directed Git operation.
- `SECRET_PROVIDER_CONFIGURED=false`.
- No production Secret Provider, OAuth, network, real connectors, or production composition wiring.
- Durable approval/audit persistence absent. Diagnostics remain false.
