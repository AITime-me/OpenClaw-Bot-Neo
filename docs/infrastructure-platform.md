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

Provider, host and log output are untrusted. Logs pass through a single production sanitization path:
bound raw input → ANSI/control neutralization → full-buffer secret redaction (including multiline PEM)
→ line and byte caps. Drift detection reports only; no automatic repair or mutation retry.

Uncertain mutation completion never maps to tool success. Connectors express uncertainty via the
generic typed connector-local `executionOutcome=outcome-unknown` (not free-form reason text). The
shared `ToolInvocationOrchestrator` maps write-like typed uncertainty to failure with
`executionState=outcome-unknown`. Secret-shape inventory predicates are deterministic and stateless.

Declared inventory writes validate identifiers, capacities, addressing and paths at runtime before
sealing immutable copies. Production tool schemas do not accept reference `scenario`/`mode` controls,
`executionState`/`executionOutcome`, or arbitrary SSH `templateId`.

## Status

Build 3.6B **closed** on feature branch `build-3-6b-infrastructure-fleet-foundation` after
independent source review, two security corrective packages, and final corrective-2 approval with
INFO notes. Documentation closeout committed locally; integration into local `main` and remote push
remain pending owner-directed.

Review history:

- initial source review **BLOCKED** (`BLOCK_BUILD_3_6B_INFRASTRUCTURE_FLEET_FOUNDATION`);
- first security corrective re-review **BLOCKED**
  (`BUILD_3_6B_INFRASTRUCTURE_SECURITY_CORRECTIVE_REREVIEW_BLOCKED`);
- final corrective-2 re-review **approved with INFO notes**
  (`BUILD_3_6B_INFRASTRUCTURE_CORRECTIVE_2_REREVIEW_APPROVED_WITH_NOTES_FOR_CLOSEOUT`).

Final dispositions:

- `BUILD_3_6B_INFRASTRUCTURE_SECURITY_CORRECTIVES_CLOSED_WITH_STATELESS_SECRET_DETECTION_AND_TYPED_OUTCOME_UNKNOWN`;
- `BUILD_3_6B_INFRASTRUCTURE_FLEET_FOUNDATION_CLOSED_WITH_BOUNDED_INVENTORIES_RESTRICTED_OPERATIONS_AND_UNTRUSTED_OBSERVATIONS`.

See [closeout record](validation/build-3.6b-infrastructure-fleet-foundation-closeout.md).

Still absent / deferred:

- no Timeweb API client;
- no SSH implementation;
- no VPS;
- no production inventory wiring;
- no deployment;
- no production connector wiring;
- `DEPLOYMENT_READY=false`;
- `SECRET_PROVIDER_CONFIGURED=false`;
- `SECURITY_APPROVAL_COMPLETE=false`;
- `AUTHORITATIVE_SECURITY_VALIDATION=false`;
- `ENCRYPTION_ENABLED=false`.
