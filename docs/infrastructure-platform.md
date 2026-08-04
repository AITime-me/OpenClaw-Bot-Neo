# Infrastructure Platform (Build 3.6B)

Build 3.6B adds an offline infrastructure fleet foundation without real Timeweb API clients,
SSH implementations, VPS purchase, production inventory, or deployment wiring.

## Purpose

The platform provides:

- branded infrastructure identifiers and bounded primitives;
- immutable in-memory Environment Registry, Server Inventory and Service Inventory;
- separate declared versus observed authority;
- provider-neutral `InfrastructureProvider` contracts;
- Timeweb provider contract only (no HTTP client);
- Restricted Host Access and Restricted SSH adapter contracts only;
- infrastructure `ToolManifest` definitions routed through Build 3.5B `ToolInvocationOrchestrator`;
- deterministic offline reference provider and reference host access for tests;
- pure drift comparison without autonomous repair.

## Mandatory Build 3.5B pipeline

Infrastructure tools register in `ToolRegistry` and execute only through the existing
`ToolInvocationOrchestrator`. There is no `InfrastructureOperationOrchestrator` and no parallel
policy, approval, secret, audit or execution pipeline.

1. Tool manifest validation.
2. Bounded input schema validation and canonical digest.
3. `ToolPolicyEngine` evaluation (infrastructure extends deny-by-default with hard-denied tools).
4. `ToolApprovalPort` / `ToolApprovalDecisionPort` for mutation tools.
5. Secret resolution only after authorization.
6. Connector-local execution through infrastructure connector façade.
7. Bounded untrusted output and safe audit events.

## Inventories are metadata only

Environment Registry, Server Inventory and Service Inventory:

- do not execute provider or host operations;
- do not resolve secrets or approve requests;
- do not mutate from connector output;
- expose no arbitrary commands.

Declared records are owner/operator authority. Provider and host observations are recorded
separately and remain `contentTrust=untrusted`.

## Policy and approval

| Class | Examples | Policy |
| --- | --- | --- |
| Read-only inventory/health | list, inspect, resources, drift | allow after policy |
| Confidential read | bounded service logs | allow; confidential sensitivity |
| Infrastructure mutation | restart, deploy, rollback, reboot | require explicit approval |
| Hard-denied | delete server, firewall, credential rotate, provider purchase/plan change | deny always |

Approval binds exact targets through canonical tool input digest (`serverId`, `serviceId`,
`environmentId`, `releaseId`, operation fields).

## Restricted Host Access

Typed read and mutation operations only. Forbidden public types include arbitrary command strings,
shell, argv from model, environment variable maps and sudo passthrough.

Future SSH adapter direction: fixed trusted command templates compiled from typed operations.
Remote helper agent is deferred behind the same port.

## Reference adapters

`src/infrastructure/reference` provides deterministic offline provider and host scenarios for
behavioural tests only. Reference adapters must not enter production Neo composition.

## Untrusted data

Provider, host and log output are untrusted. Logs are bounded, redacted, and never interpreted as
instructions. Drift detection reports only; no automatic repair or mutation retry.

## Status

Build 3.6B implemented locally on feature branch `build-3-6b-infrastructure-fleet-foundation`;
pending independent review.

- no Timeweb API client;
- no SSH implementation;
- no VPS;
- no production inventory wiring;
- no deployment;
- `DEPLOYMENT_READY=false`;
- `SECRET_PROVIDER_CONFIGURED=false`.
