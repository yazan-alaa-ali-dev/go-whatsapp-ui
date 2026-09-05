---
ticket: wf-004
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-06-17
links:
  clickup: https://app.clickup.com/t/86exzgdy8
  github:
---

# Implement — wf-004

> Record of what was actually built, following `plan.md`.

## Changes made

All seven files from `plan.md` "Files to change", and nothing else:

- `scripts/github_publish.py` *(new)* — isolated `git push` + `gh pr create`
  helper (the only home of git/gh logic, ADR-005 pattern). Prechecks `gh`
  availability (GH-1) and auth (GH-2) **before** any mutation (AC-9), pushes the
  branch (AC-1), opens a PR (AC-2), is idempotent (returns an existing open PR's
  URL instead of duplicating), and prints `{"pr_url": ...}`. No merge / auto-merge
  / branch deletion / status sync (ADR-007 decision 10).
- `.claude/commands/publish-pr.md` *(new)* — the `/publish-pr` command contract:
  precondition `state ∈ {verified, closed}` (PB-1) + branch exists (PB-2),
  artifact-derived title/body (AC-3/AC-4), helper orchestration, `links.github`
  write (AC-5), no-state-change / no GitHub read-back guarantees (PB-3/PB-4),
  atomic fail-safe (PB-5/PB-6).
- `.claude/docs/adr/ADR-007-github-pr-publish.md` *(new)* — records all ten fixed
  decisions; GitHub is delivery-only, never a state owner.
- `_specs/_templates/ticket.md` *(edit, additive)* — added optional
  `links: {clickup, github}` front-matter block + a field-reference row; required
  keys (FM-1) unchanged (AC-5 home).
- `.claude/docs/command-architecture.md` *(edit, additive)* — appended a
  `/publish-pr` contract section (orthogonal to the state machine); the existing
  seven command sections were not modified (AC-8).
- `.claude/rules/validation-model.md` *(edit, additive)* — added the `PB`
  (publish) rule group (PB-1..PB-7) and one invocation-map row; no existing rule
  altered (AC-8).
- `.claude/project-config.yaml` *(edit, additive)* — registered `publish-pr`
  under `role_authority.delivery_commands`; `features.github` already `true`.

## Commits

- `97618db` — WF-004: add /publish-pr command + isolated gh helper (delivery-only)
  — the seven planned files plus the wf-004 workflow artifacts, on branch
  `ticket/wf-004`.
- (this `implement.md` + the `ticket.md` → `implemented` transition are committed
  immediately after, on the same branch.)

## Deviations from plan

- None. All seven planned files were implemented as specified; no unlisted file
  was modified. No `observability/**` file was touched.
- A transient `scripts/__pycache__/` produced by the `py_compile` check was
  removed and not committed (build artifact, not a planned file).

## Validation run during implementation

> Non-pushing checks only — `/implement` never pushes (IM-9). The live
> push/PR run (AC-1..AC-5) is deferred to `/verify` per the plan.

- `python -m py_compile scripts/github_publish.py` — **PASS** (helper compiles).
- AC-9 / GH-1 fail-safe: invoked `publish(...)` with `gh` simulated missing
  (`shutil.which` → `None`) — **PASS**: aborted with
  `GH-1 ERROR: GitHub CLI (gh) is not installed or not on PATH`, before any push
  or PR (no mutation).
- `python scripts/github_publish.py --branch ticket/wf-004` (missing required
  args) — **PASS**: argparse rejects with "the following arguments are required:
  --title, --body-file" (no action taken).
- `git status` review — **PASS**: changes confined to the seven planned files +
  the `_specs/wf-004/` workspace; no `observability/**` change (IM-4/IM-5/GU-2).
