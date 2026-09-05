---
ticket: wf-005
stage: intake
mode: standard          # standard | high_risk  (fast deferred, not in v1)
status: in_progress     # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-06-17
links:
  clickup: https://app.clickup.com/t/86exzgz8q
  github:
---

# Intake — wf-005

> First stage. Qualify the request only. **No technical planning allowed.**

## Ticket Reference

wf-005 — ClickUp task [86exzgz8q](https://app.clickup.com/t/86exzgz8q)

## Ticket Summary

Improve the usability and consistency of Workflow V1 by (a) making the next
expected workflow action explicit after every command, and (b) making
publishing the single git/GitHub delivery boundary — while preserving all
existing governance, lifecycle, approval gates, and `ticket.md` state
ownership.

<!-- Seeded verbatim from ClickUp description (read-only): -->

Business Goal — Improve the usability and consistency of Workflow V1 by
simplifying the delivery lifecycle and making the next expected workflow action
explicit after every command. The workflow should be easier to operate for both
new and experienced team members while preserving all existing governance
principles.

User Story — As a workflow user, I want the workflow to clearly tell me what the
next expected action is after each command, and I want publishing to be the
single delivery boundary for git and GitHub operations, so that workflow
execution is easier to understand, easier to verify, and less prone to delivery
mistakes.

Acceptance Criteria (as supplied; to be formalized with stable AC-n IDs at
`/spec`):
- AC-1 Every workflow command provides explicit next-step guidance at completion.
- AC-2 Next-step guidance identifies: current workflow state; next legal command;
  required manual actions; optional actions; terminal state conditions when
  applicable.
- AC-3 Blocked outcomes clearly explain what must be completed before the
  workflow can continue.
- AC-4 Terminal outcomes clearly indicate that no further workflow action is
  required.
- AC-5 Commit creation is no longer performed during implementation.
- AC-6 Commit creation is no longer performed during verification.
- AC-7 Publishing becomes the single git delivery boundary responsible for
  preparing publishable changes before push/PR creation.
- AC-8 A published PR always includes: implementation changes; implement
  artifacts; verification artifacts; ticket closure updates.
- AC-9 `ticket.md` remains the canonical workflow state owner.
- AC-10 GitHub remains a delivery surface only and never becomes a workflow
  state owner.
- AC-11 Existing workflow governance, lifecycle, approval gates, and state
  machine remain unchanged.
- AC-12 The solution remains framework-agnostic and execution-environment
  agnostic.

Out of Scope — GitHub status synchronization; GitHub comments synchronization;
GitHub approval synchronization; GitHub merge automation; branch auto-deletion;
MCP integration; CI/CD ownership of workflow state; changes to workflow
lifecycle states; changes to approval requirements; changes to `ticket.md`
ownership.

## Ticket Metadata

- id / slug: wf-005
- title: WF-005: Workflow Delivery & Next-Step Refinement
- owner: developer
- created: 2026-06-17
- links: clickup=https://app.clickup.com/t/86exzgz8q

## User Story

> As a workflow user, I want the workflow to clearly tell me what the next
> expected action is after each command, and I want publishing to be the single
> delivery boundary for git and GitHub operations, so that workflow execution is
> easier to understand, easier to verify, and less prone to delivery mistakes.

## Acceptance Criteria Presence Check

- Present? yes
- Notes: 12 acceptance criteria (AC-1..AC-12) supplied in the ClickUp task.
  These will be formalized with stable IDs and mapped to requirements at `/spec`.

## Test Cases Presence Check

- Present? no
- Notes: No explicit test cases supplied; to be authored at `/spec` so each
  AC-n maps to at least one test case.

## Missing Information

- Test cases per acceptance criterion (to be defined at `/spec`).
- Confirmation of mode: seeded as `standard`. Note AC-5/AC-6/AC-7 change command
  behaviour (commit/delivery boundary) but do **not** touch `observability/**`
  runtime; revisit whether `high_risk` is warranted during `/research`/`/spec`.

## Readiness Status

`READY`

- Justification: Awaiting Workflow Owner / author review to confirm scope, mode,
  and to complete the readiness checks. Mark `READY` once confirmed, then run
  `/research`.
