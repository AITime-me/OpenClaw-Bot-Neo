---
name: multimodal-workflow
description: Expose shared channel-neutral media workflows to business skills.
status: draft
openclaw-compatibility: UNVERIFIED
---

# Multimodal Workflow

## Intent

Expose shared channel-neutral media workflows to business skills.

## Boundaries

This is a technical capability, not a ninth business role; do not duplicate provider processing in role skills.

- Default tool posture: read-only, no exec, no write, no secrets.
- External sends and consequential actions require explicit owner approval.
- Use channel-neutral core capabilities only.
- Return an explicit unavailable result when a capability is not configured.
