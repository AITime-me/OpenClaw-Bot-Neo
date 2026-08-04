# Connector Platform (Build 3.5B)

Build 3.5B adds a connector platform foundation without production wiring, real integrations,
OAuth, network clients, or a production Secret Provider.

## Purpose

The platform provides:

- connector domain contracts and bounded JSON models;
- Connector SDK lifecycle contracts;
- in-memory connector, tool, connection and health registries;
- capability manifests and validated tool manifests;
- deny-by-default `ToolPolicyEngine`;
- digest-bound single-use `ToolApprovalPort`;
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
`sideEffectClass`, expiry, approving actor, and single-use nonce. Canonical digest uses sorted
object keys and SHA-256.

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
stopped. Write-like tools with `cancellationSupport=none` are denied by default policy.

## Persistence and reference connector

Registries and approval grants are in-memory only in Build 3.5B. The reference connector under
`src/connectors/reference` is test/dev only and must not be imported by production composition.

Real connectors (GitHub, amoCRM, email, Telegram, Timeweb) are deferred.

## Status

- Build 3.5B implemented locally.
- `SECRET_PROVIDER_CONFIGURED=false`.
- No production Secret Provider, OAuth, network, or production composition wiring.
- Pending independent review.
