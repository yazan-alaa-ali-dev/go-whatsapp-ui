---
ticket: wf-004
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-06-17
links:
  clickup: https://app.clickup.com/t/86exzgdy8
  github:
---

# Plan — wf-004

> Decide the approach before changing code. Plan only — no implementation here.

## Approach

Deliver publishing as a **new, additive `/publish-pr` command** (Workflow-Owner
authorized) plus an **isolated helper** that holds all `git`/`gh` logic — exactly
the ADR-005 pattern (`clickup_intake.py`: command orchestrates, helper owns the
external I/O). The command runs only after a successful `/verify` (`state ∈
{verified, closed}`), generates the PR title/body from workflow artifacts, invokes
the helper to push the ticket branch and open a PR via `gh`, and records the
returned PR URL in `ticket.md > links.github`. Publishing is **orthogonal to the
state machine**: it writes only the `links.github` metadata field, never `state`
and never a state-history entry, so GitHub is a pure delivery surface (decisions
1, 2, 6, 7). This is preferred over extending `/implement` or `/verify` (decision
3) because it keeps the existing seven command contracts untouched (AC-8) and
isolates an inherently mutating, externally-dependent action.

## Design decisions (fixed requirements applied)

- **D1 — GitHub is a delivery surface only.** No workflow state is ever read from
  GitHub; the command performs no GitHub reads beyond opening/echoing the PR it
  creates (decisions 1, 7).
- **D2 — `ticket.md` stays canonical.** `/publish-pr` writes exactly one field
  (`links.github`) and never touches `state`/state-history; this is a metadata
  write, not a transition, so TS-4's "single state write point" is preserved
  (decisions 2, 6).
- **D3 — New command, not an extension.** `/publish-pr` is added under
  `.claude/commands/`; the existing seven commands are not edited (decision 3,
  AC-8).
- **D4 — Precondition `state ∈ {verified, closed}`.** Publishing is allowed only
  after a successful `/verify`; any earlier state aborts atomically (decision 4).
  `closed` is the normal post-`/verify` state and remains terminal — writing
  `links.github` on a closed ticket is metadata, not a reopen.
- **D5 — Isolated helper owns `git`+`gh`.** All push/PR logic lives in one
  single-purpose script (ADR-005 precedent); the command embeds no `git`/`gh`
  invocation logic, keeping it thin, testable, and swappable (decision 5, 9).
- **D6 — `gh` precheck → safe failure.** The helper verifies `gh` presence and
  authentication first; if either fails it emits a coded error, makes **no** push
  and **no** PR, and exits non-zero — leaving the repo and ticket untouched
  (decision 9, AC-9).
- **D7 — Title/body generated from artifacts.** Title from `ticket.md > title`;
  body assembled from `spec.md` (business goal + AC table), the ticket reference,
  and `links.clickup` (decision 8, AC-3/AC-4). Deterministic given the artifacts.
- **D8 — `links` home in `ticket.md`.** `ticket.md` has no `links` block today, so
  an **optional `links: {clickup, github}` block** is added to the ticket template
  (additive; does not change FM-1's required keys) to give AC-5 a canonical home.
- **D9 — Minimal, additive footprint.** No tokens, MCP, CI/CD, comment/status
  sync, auto-merge, or branch deletion; idempotent re-publish returns the existing
  PR URL rather than erroring or duplicating (decision 10).
- **D10 — Governance kept consistent.** Because every command in this repo is
  rule-bound and documented, the new command is recorded in an ADR, the command
  architecture doc, the validation model (a new `PB` rule group), and registered
  in `project-config.yaml` — all **additive**, no existing contract rewritten.

## Steps

1. Add an isolated helper that, given a branch + title + body, (a) prechecks `gh`
   availability/auth and aborts safely if absent/unauthenticated (AC-9), (b)
   pushes the branch to `origin` (AC-1), (c) creates the PR via `gh` (AC-2), and
   (d) prints the PR URL as JSON. Re-publish detects an existing PR and returns
   its URL (idempotent). No branch deletion, no merge (decision 10).
2. Add the `/publish-pr` command contract: validate `ticket.md` (state ∈
   {verified, closed}; branch `ticket/<slug>` exists), generate title/body from
   artifacts (AC-3/AC-4), invoke the helper, then write the returned URL into
   `ticket.md > links.github` (AC-5) without any state change (AC-6/AC-7).
3. Add the optional `links` block to the `ticket.md` template so `links.github`
   has a canonical home (supports AC-5) without altering required front-matter.
4. Record the decision as a new ADR (GitHub-as-delivery-surface), referencing
   wf-004 and mirroring ADR-005's structure.
5. Document `/publish-pr` additively in the command-architecture doc (new command
   section + note that it is orthogonal to the state machine) and add a `PB` rule
   group plus an invocation-map row to the validation model. Do **not** edit the
   existing seven command sections (AC-8).
6. Register `publish-pr` in `project-config.yaml` (delivery/author command) —
   additive only.

## Files to change

- `scripts/github_publish.py` *(new)* — isolated push + PR helper; `gh` precheck,
  `git push`, `gh pr create`, idempotent existing-PR lookup, JSON `{pr_url}` out,
  coded fail-safe errors. The only home of `git`/`gh` publish logic (AC-1, AC-2,
  AC-9).
- `.claude/commands/publish-pr.md` *(new)* — the `/publish-pr` command contract:
  preconditions (state ∈ {verified, closed}, branch exists), artifact-derived
  title/body (AC-3/AC-4), helper orchestration, `links.github` write (AC-5),
  no-state-change guarantee (AC-6/AC-7), atomic safe-failure (AC-9).
- `_specs/_templates/ticket.md` *(edit, additive)* — add optional
  `links: { clickup, github }` front-matter block; required keys unchanged (AC-5).
- `.claude/docs/adr/ADR-007-github-pr-publish.md` *(new)* — records decisions
  1–10; GitHub is delivery-only, never a state owner.
- `.claude/docs/command-architecture.md` *(edit, additive)* — append a
  `/publish-pr` contract section and state that publishing is orthogonal to the
  state machine; existing seven sections untouched (AC-8).
- `.claude/rules/validation-model.md` *(edit, additive)* — add a `PB` (publish)
  rule group (preconditions, no-state-write, fail-safe, links-write) and one
  invocation-map row; no existing rule altered (AC-8).
- `.claude/project-config.yaml` *(edit, additive)* — register `publish-pr` under
  `role_authority` as a delivery/author command; `features.github` already true.

## Validation strategy

- Validation profile: none. *(The only defined profile, `observability-config`,
  validates JSON observability configs and does not apply here; VP-5 — free-form
  validation, no profile-execution path.)*
- **AC-9 (deterministic, no network):** run the helper with `gh` removed from
  `PATH` and again while unauthenticated → expect non-zero exit, a coded error, no
  branch pushed, no PR, and `ticket.md` unchanged.
- **AC-1/AC-2/AC-3/AC-4/AC-5 (controlled live run):** on the `ticket/wf-004`
  branch, run `/publish-pr`; confirm the branch appears on `origin`, a PR is
  created with the artifact-derived title/body, the command prints the PR URL, and
  `ticket.md > links.github` now holds that URL. Re-run to confirm idempotency
  (same URL, no duplicate PR).
- **AC-6/AC-7 (inspection):** capture `ticket.md > state` and state-history before
  and after publishing → identical (no transition, no history entry); confirm the
  command issues no GitHub state reads beyond the PR it creates.
- **AC-8 (inspection):** `git diff` shows the existing seven command files and
  their contracts are unmodified; all command-architecture/validation-model edits
  are additive new sections only.

## Rollback

- Every change is additive and reversible. To revert: delete the new files
  (`scripts/github_publish.py`, `.claude/commands/publish-pr.md`,
  `ADR-007-github-pr-publish.md`) and revert the additive edits to the ticket
  template, command-architecture doc, validation model, and project-config — the
  workflow returns to its exact pre-wf-004 behavior.
- No `observability/**` runtime file is touched, so there is no runtime rollback.
- For any artifacts created on GitHub during validation (pushed branch / PR),
  cleanup is **manual** (close the PR, delete the remote branch by hand) — the
  command never auto-deletes branches or merges (decision 10).

## Risks

- **R1 — Writing `links.github` to a `closed` ticket** could look like mutating a
  terminal ticket. Mitigation: it is a metadata-only write; `state` and
  state-history are never touched (D2); documented explicitly in the command and ADR.
- **R2 — Adding `links` to `ticket.md`** edits a canonical template. Mitigation:
  additive optional block; required keys (FM-1) unchanged; mirrors the artifact
  `links` convention already in use.
- **R3 — Live validation creates a real PR/branch** on `origin`. Mitigation:
  controlled single run on the ticket's own branch; manual cleanup documented;
  idempotent re-run avoids duplicates.
- **R4 — `gh`/network/SSH dependency** at publish time. Mitigation: precheck +
  atomic safe failure (D6, AC-9); the workflow remains fully usable without GitHub.
- **R5 — Scope creep into status/comment sync or merge.** Mitigation: explicitly
  out of scope (decision 10); enforced by the new `PB` rules and the ADR.

## Acceptance criteria coverage mapping

| AC   | Covered by | How it is satisfied |
|------|------------|---------------------|
| AC-1 | helper step 1b | `git push -u origin ticket/<slug>` |
| AC-2 | helper step 1c | `gh pr create` opens the PR |
| AC-3 | command step 2 | title generated from `ticket.md > title` |
| AC-4 | command step 2 | body generated from `spec.md` + ticket ref + `links.clickup` |
| AC-5 | command step 2 + template step 3 | PR URL written to `ticket.md > links.github` |
| AC-6 | design D2 | command writes only `links.github`; never `state` |
| AC-7 | design D1 | no GitHub state read into the workflow; one-way only |
| AC-8 | steps 5–6 (additive) | existing seven commands/contracts unmodified |
| AC-9 | helper step 1a | `gh` precheck → coded error, no push/PR, no ticket change |

## Out of scope

- Reading/syncing GitHub state (status, checks, reviews, comments, merge) into the
  workflow — forbidden by decisions 7 & 10.
- Merging PRs, auto-merge, reviewer/label/milestone management, branch deletion.
- Any GitHub API token, MCP server, or CI/CD integration (decision 10; `gh`'s
  existing SSH auth is used as-is).
- Any `observability/**` runtime change, and any change to the existing seven
  command contracts or the state machine.
