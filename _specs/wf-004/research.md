---
ticket: wf-004
stage: research
mode: standard
status: complete
owner: ai_agent
updated: 2026-06-17
links:
  clickup: https://app.clickup.com/t/86exzgdy8
  github:
---

# Research — wf-004

> Read-only phase. **No implementation is allowed in this command.**

## Goal

Enable publishing a reviewed implementation branch (`ticket/<slug>`) to GitHub as
a Pull Request — pushing to `origin` and opening a PR via the GitHub CLI — with
PR title/body generated from workflow artifacts and the PR URL recorded in the
ticket, while `ticket.md` stays the sole canonical owner of workflow state and
GitHub state never drives the workflow.

## Relevant directories

- `.claude/commands/` — workflow command contracts (`start-ticket`, `research`,
  `spec`, `plan`, `review`, `implement`, `verify`). AC-8 requires these to remain
  **unchanged**; a publish capability must not alter them. A new publish command,
  if authorized, would be added here.
- `scripts/` — isolated helpers. `clickup_intake.py` is the precedent: external
  integration logic lives in a single-purpose script the command *orchestrates*
  (ADR-005). A GitHub publish helper would belong here by the same pattern.
- `.claude/docs/adr/` — architectural decisions. ADR-005 (ClickUp intake) is the
  closest analogue; this work likely warrants a sibling ADR for GitHub publish.
- `.claude/docs/` — `command-architecture.md` (command contracts §1, branch
  strategy §3, state machine §2) and `ticket-standard.md` (artifact/front-matter
  standard — relevant to where `links.github` is recorded).
- `.claude/rules/` — `validation-model.md` (rule codes) and `workflow-rules.md`
  (gates, guardrails, closure). New behavior must be expressed as rules here, not
  ad-hoc logic.
- `_specs/_templates/` & `_specs/<ticket>/` — `ticket.md` front-matter shape
  (relevant to AC-5: where the PR URL is stored).

## Relevant config files

- `.claude/project-config.yaml` — `features.github: true` is already set;
  `lifecycle` (states; `closed` is terminal), `closure` (no `/close`; `/verify`
  and `/review` own transitions), and `validation_checks` / `validation_profiles`
  (config-driven, local-only check pattern; gh publish is explicitly **not** a
  validation check — those are read-only and local).
- `_specs/_templates/ticket.md` — canonical state record. **Its front-matter has
  no `links` field today** (`ticket, title, mode, state, status, owner,
  created_at, updated_at`); `links.clickup`/`links.github` currently live in the
  *artifact* front-matter (intake/research/etc.). This bears directly on AC-5.
- `scripts/clickup_intake.py` — reference implementation of an isolated read-only
  external helper (stdlib only, token from env, single operation, fail-fast with
  coded errors, nothing written on failure).

## Possibly affected services

- **GitHub (external, `origin` = `git@github.com:ramaaz-tech/opt.git`, SSH)** —
  the push target and PR host. New outbound dependency at publish time.
- **GitHub CLI (`gh`)** — present and authenticated in this environment
  (`gh 2.94.0`; logged in as `ahmad-alalony-ramaaz`, SSH protocol). AC-9 requires
  safe failure when `gh` is absent/unauthenticated.
- **Workflow tooling itself** — a new command/helper and supporting rules/ADR.
- **Observability runtime (`observability/**`)** — **not affected**; this ticket
  introduces no runtime change (supports `mode: standard`).

## Test / validation commands available

> Listed for reference only — none were run as part of research, except read-only
> environment probes (`gh --version`, `gh auth status`, `git remote -v`).

- `gh --version` — confirm the GitHub CLI is installed (AC-2, AC-9 guard).
- `gh auth status` — confirm authentication state (AC-9 guard).
- `git remote -v` / `git rev-parse --abbrev-ref HEAD` — confirm `origin` and the
  current branch (AC-1).
- `git push -u origin ticket/<slug>` — push the implementation branch (AC-1).
- `gh pr create --title ... --body ...` — open the PR (AC-2, AC-3, AC-4); prints
  the PR URL (AC-5).
- `gh pr view --json url` — read back the PR URL (AC-5).
- `python scripts/validate_observability_json.py` — existing config check
  (unrelated to this ticket; cited only as the in-repo validation-harness pattern).

## Risks and unknowns

- **AC-5 vs. current `ticket.md` shape (high).** `ticket.md` front-matter has no
  `links` block; `links.github` exists only in artifact front-matter. Honoring
  "stored in `ticket.md links.github`" likely means **adding a `links` field to
  the canonical `ticket.md` template**, which edits a canonical file and the
  state record. Must be resolved in `/spec` (and may need an ADR / template
  change scoped carefully so it is not a state-machine change).
- **New command vs. AC-8 "existing commands unchanged" (high).** CLAUDE.md
  forbids creating workflow commands "unless a phase explicitly authorizes it."
  Publishing implies a **new** command/capability (existing seven untouched). The
  ticket appears to authorize the capability, but creating a command is a
  governance decision — confirm authorization before `/plan`.
- **Placement in the lifecycle (medium).** `closed` is terminal and there is no
  "published" state. To satisfy AC-6/AC-7 the publish action must be **orthogonal
  to the state machine** (like the `blocked` flag) and must never read/write
  workflow `state` from GitHub. When publishing is allowed relative to
  `implemented`/`verified`/`closed` is undecided.
- **gh/network/auth dependency (medium).** Publishing depends on an external
  service, network, SSH push rights, and `gh` auth. AC-9 demands a clean,
  non-mutating failure when `gh` is missing or unauthenticated.
- **Isolation pattern (low).** Following ADR-005, gh/git logic should live in a
  single isolated helper (e.g. `scripts/github_publish.py`) rather than embedded
  in a command. Needs confirming as the chosen approach in `/plan`.
- **Idempotency/re-publish (low).** Behavior when the branch is already pushed or
  a PR already exists (update vs. no-op vs. error) is unspecified.

## Open questions

- AC-5: Does "`ticket.md links.github`" require adding a `links` block to the
  canonical `ticket.md` front-matter, or recording the URL in an artifact's
  `links.github`? Which file is authoritative for the PR URL?
- AC-8 / governance: Is a new `/publish` (or similarly named) command authorized,
  and at what lifecycle point is it invoked (post-`implemented`? post-`verified`?
  only after `closed`)? Or is publish a non-command script?
- Must the ticket be `verified`/`closed` before publishing, or may any
  `implemented` `ticket/<slug>` branch be published?
- Should the gh/git logic be isolated in `scripts/github_publish.py` mirroring
  ADR-005 (command orchestrates, helper holds all external logic)?
- Does this ticket warrant a dedicated ADR (the GitHub-publish analogue of
  ADR-005)? Standard mode makes an ADR optional, but the integration is notable.
- What exact artifacts feed the PR title (AC-3) and body (AC-4) — e.g. ticket
  title + spec summary + AC list + verify result?

## Notes

- No code was changed during research.
- No observability runtime configs were modified.
