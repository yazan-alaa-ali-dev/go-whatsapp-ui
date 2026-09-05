---
ticket: wf-004
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-06-17
links:
  clickup: https://app.clickup.com/t/86exzgdy8
  github:
---

# Spec — wf-004

> Define *what* must be true when done. **No implementation details, no file
> names, no code.**

## Feature Name

GitHub PR Publish

## Business Goal

A reviewed implementation branch currently lives only locally — the workflow
never pushes. Teams that review and merge through GitHub cannot see or act on the
work there. Publishing the branch as a Pull Request lets delivery and code review
happen on GitHub while the workflow keeps its own canonical state, giving
traceability from the ticket to the PR without ceding control of the workflow to
GitHub.

## User Story

> As a workflow user, I want to publish a reviewed implementation branch as a
> GitHub Pull Request, so that delivery and code review can happen through GitHub
> while `ticket.md` remains the canonical workflow state owner.

## Functional Requirements

- **FR-1** — The implementation branch for a ticket can be published (pushed) to
  the GitHub remote.
- **FR-2** — A Pull Request can be opened for that branch through the GitHub CLI.
- **FR-3** — The PR title is generated from the ticket's workflow artifacts, not
  hand-typed.
- **FR-4** — The PR body is generated from the ticket's workflow artifacts.
- **FR-5** — The resulting PR URL is recorded in the ticket's `links.github`.
- **FR-6** — Publishing performs no workflow-state transition; `ticket.md`
  remains the single canonical owner of workflow state.
- **FR-7** — GitHub state (PR open/merged/closed, checks, reviews) never
  determines, reads into, or mutates workflow state — the flow is one-way
  (workflow → GitHub).
- **FR-8** — The seven existing workflow commands (`/start-ticket`, `/research`,
  `/spec`, `/plan`, `/review`, `/implement`, `/verify`) continue to behave
  exactly as before; the publish capability is additive and changes none of them.
- **FR-9** — When the GitHub CLI is unavailable or unauthenticated, publishing
  fails safely: it reports a clear error, makes no partial push or PR, and leaves
  workflow artifacts and state unchanged.

## Non-Functional Requirements

- **Read-only toward workflow state** — the capability records a PR URL but never
  changes `state` (reinforces FR-6/FR-7 and ADR-003).
- **Safe, atomic failure** — any failure (missing/unauthenticated CLI, no remote,
  no push rights, network error) leaves the repository and ticket in their prior
  state; no partial artifacts are written (consistent with the workflow's
  existing atomicity guarantees).
- **Decoupling** — the workflow must not become dependent on GitHub; GitHub is an
  optional publish target, and the workflow remains fully usable without it.
- **Traceability** — a published ticket can be traced to its PR via the recorded
  `links.github`, mirroring how `links.clickup` traces intake.
- **Determinism** — given the same artifacts, the generated PR title/body are
  reproducible.

## Constraints

- `ticket.md` is the sole canonical owner of workflow state (ADR-003); no state
  is derived from GitHub.
- `closed` is terminal and there is no "published" state — the publish action
  must be orthogonal to the lifecycle state machine.
- No `observability/**` runtime file is touched (this is workflow tooling, not a
  runtime change → `mode: standard`).
- Existing command contracts must not be modified (FR-8 / AC-8).
- GitHub access is one-way and limited to publishing the branch and opening/
  reading back a PR; no workflow state is ever read from GitHub.

## Edge Cases

- The branch (or a PR for it) already exists on the remote — re-publish must
  behave predictably (no duplicate/conflicting PR, no error that corrupts state).
- The GitHub CLI is not installed, or installed but not authenticated (AC-9).
- No GitHub remote is configured, or the user lacks push permission.
- The ticket has no implementation branch yet (publishing attempted too early).
- A network failure occurs mid-publish (after push, before PR creation).
- Required artifacts for generating the title/body are missing or empty.

## Open Questions

- **AC-5 storage location:** `ticket.md` front-matter currently has no `links`
  field (`links.github` lives in artifact front-matter today). Does "stored in
  `ticket.md links.github`" require adding a `links` block to the canonical
  `ticket.md`, and if so is that authoritative for the PR URL? (Resolve in
  `/plan`; may need a deliberate template decision / ADR.)
- **AC-8 / governance:** Is a new publish command authorized (existing seven stay
  unchanged), or is the capability delivered without a new workflow command? At
  what lifecycle point may publishing occur?
- **Precondition state:** Must a ticket be `implemented`, `verified`, or `closed`
  before its branch may be published?
- **PR content sources:** Exactly which artifacts feed the title (FR-3) and body
  (FR-4) — e.g. ticket title, spec summary, AC list, verify outcome?

## Acceptance Criteria Mapping

> Give each criterion a stable ID (AC-1, AC-2, …); `verify.md` references these.

| ID   | Acceptance criterion | Maps to requirement |
|------|----------------------|---------------------|
| AC-1 | A branch can be pushed to origin. | FR-1 |
| AC-2 | A Pull Request can be created through the GitHub CLI. | FR-2 |
| AC-3 | PR title is generated from workflow artifacts. | FR-3 |
| AC-4 | PR body is generated from workflow artifacts. | FR-4 |
| AC-5 | PR URL is stored in `ticket.md` `links.github`. | FR-5 |
| AC-6 | `ticket.md` remains the canonical workflow state owner. | FR-6 |
| AC-7 | GitHub state never drives workflow state. | FR-7 |
| AC-8 | Existing workflow commands remain unchanged. | FR-8 |
| AC-9 | Publishing fails safely when `gh` is unavailable or unauthenticated. | FR-9 |

## Out of Scope

- Reading or syncing GitHub state back into the workflow (status, checks,
  reviews, merge state) — explicitly forbidden by FR-7.
- Merging the PR, managing reviewers/labels/milestones, or any post-creation PR
  management.
- Any change to `observability/**` runtime configuration.
- Any change to the existing seven command contracts or the state machine.
- Bidirectional GitHub integration or webhooks.
