---
ticket: wf-005
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-06-17
links:
  clickup: https://app.clickup.com/t/86exzgz8q
  github:
---

# Spec — wf-005

> Define *what* must be true when done. **No implementation details, no file
> names, no code.**

## Feature Name

Workflow Delivery & Next-Step Refinement

## Business Goal

Improve the usability and consistency of Workflow V1 by simplifying the delivery
lifecycle and making the next expected workflow action explicit after every
command. The workflow should be easier to operate for both new and experienced
team members, easier to verify, and less prone to delivery mistakes — while
preserving all existing governance principles.

## User Story

> As a workflow user, I want the workflow to clearly tell me what the next
> expected action is after each command, and I want publishing to be the single
> delivery boundary for git and GitHub operations, so that workflow execution is
> easier to understand, easier to verify, and less prone to delivery mistakes.

## Functional Requirements

- **FR-1 — Next-step guidance everywhere.** Every workflow command must present
  explicit next-step guidance when it completes.
- **FR-2 — Guidance content.** That guidance must identify: the current workflow
  state; the next legal command; any required manual actions; optional actions;
  and, when applicable, terminal-state conditions.
- **FR-3 — Blocked guidance.** When a command's outcome is blocked, the guidance
  must clearly explain what has to be completed before the workflow can continue.
- **FR-4 — Terminal guidance.** When a command's outcome is terminal, the
  guidance must clearly indicate that no further workflow action is required.
- **FR-5 — No commit at implementation.** Commit creation must no longer be
  performed as part of implementation.
- **FR-6 — No commit at verification.** Commit creation must no longer be
  performed as part of verification.
- **FR-7 — Single git delivery boundary.** Publishing must become the single git
  delivery boundary responsible for preparing publishable changes before any
  push or pull-request creation.
- **FR-8 — Complete published PR.** A published pull request must always include
  the implementation changes, the implementation artifacts, the verification
  artifacts, and the ticket-closure updates.

## Non-Functional Requirements

- **NFR-1 — Canonical state preserved.** The canonical ticket state record
  remains the single owner of workflow state; delivery surfaces never own it.
- **NFR-2 — Delivery surface only.** GitHub remains a one-way delivery surface
  and never becomes a workflow state owner (no GitHub state is read back into the
  workflow).
- **NFR-3 — Governance unchanged.** Existing workflow governance, lifecycle
  states, approval gates, and the state machine remain unchanged in meaning.
- **NFR-4 — Agnostic.** The solution remains framework-agnostic and
  execution-environment agnostic.
- **NFR-5 — Consistency.** Next-step guidance must be consistent in structure and
  vocabulary across all commands, and must agree with the canonical state machine.

## Constraints

- The canonical state machine, approval requirements, and ticket-state ownership
  must not change in meaning (governance is preserved, not redesigned).
- The change must not modify the observability runtime; it concerns workflow
  operation only.
- No external service (CI/CD, MCP, GitHub status/comment/approval/merge
  synchronization, branch auto-deletion) may be introduced as a dependency.

## Edge Cases

- A command produces a **blocked** outcome: guidance must state the unblocking
  condition and the next action (FR-3), not a generic "done" message.
- A command produces a **terminal** outcome (closed ticket, or a rejected plan):
  guidance must state that no further workflow action is required (FR-4).
- Publishing is attempted when the delivery prerequisites are not met (e.g. the
  publishable changes or branch are not yet prepared): the single delivery
  boundary must fail safely without leaving a partial delivery.
- Verification runs but, by design, makes no commit (FR-6): the absence of a
  commit must not be treated as missing evidence.

## Open Questions

- **OQ-1 (AC-5 intent).** Does "no commit during implementation" mean no commit
  is created at all until publishing (a working-tree handoff), or that only the
  push/PR is deferred while commits still occur earlier? This determines the
  delivery-boundary behaviour and must be settled before planning.
- **OQ-2 (AC-8 artifact set).** What is the exact, ordered set of changes the
  single delivery boundary must include in the PR (implementation changes +
  implementation artifacts + verification artifacts + closure updates), and how
  does that interact with verification performing closure?
- **OQ-3 (governance record).** Does this change require a new architectural
  decision record (superseding/extending the existing publishing decision), and
  should the ticket remain `standard` or be re-classified given its blast radius?
  (Resolved at `/plan` / `/review`; does not change the acceptance criteria.)

## Acceptance Criteria Mapping

> Stable IDs mirror the source numbering (AC-1..AC-12); `verify.md` references these.

| ID    | Acceptance criterion | Maps to requirement |
|-------|----------------------|---------------------|
| AC-1  | Every workflow command provides explicit next-step guidance at completion. | FR-1 |
| AC-2  | Next-step guidance identifies: current workflow state; next legal command; required manual actions; optional actions; and terminal-state conditions when applicable. | FR-2 |
| AC-3  | Blocked outcomes clearly explain what must be completed before the workflow can continue. | FR-3 |
| AC-4  | Terminal outcomes clearly indicate that no further workflow action is required. | FR-4 |
| AC-5  | Commit creation is no longer performed during implementation. | FR-5 |
| AC-6  | Commit creation is no longer performed during verification. | FR-6 |
| AC-7  | Publishing becomes the single git delivery boundary responsible for preparing publishable changes before push/PR creation. | FR-7 |
| AC-8  | A published PR always includes: implementation changes, implementation artifacts, verification artifacts, and ticket-closure updates. | FR-8 |
| AC-9  | The canonical ticket state record remains the canonical workflow state owner. | NFR-1 |
| AC-10 | GitHub remains a delivery surface only and never becomes a workflow state owner. | NFR-2 |
| AC-11 | Existing workflow governance, lifecycle, approval gates, and the state machine remain unchanged. | NFR-3 |
| AC-12 | The solution remains framework-agnostic and execution-environment agnostic. | NFR-4 |

## Out of Scope

- GitHub status synchronization.
- GitHub comments synchronization.
- GitHub approval synchronization.
- GitHub merge automation.
- Branch auto-deletion.
- MCP integration.
- CI/CD ownership of workflow state.
- Changes to workflow lifecycle states.
- Changes to approval requirements.
- Changes to ticket-state ownership.
