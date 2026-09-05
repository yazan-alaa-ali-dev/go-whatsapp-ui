---
ticket: wf-pilot-002
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-06-14
links:
  clickup:
  github:
---

# Implement — wf-pilot-002

## Changes made

- `scripts/clickup_intake.py` — **new**; isolated read-only ClickUp fetch helper
  (stdlib `urllib`, GET only). The sole home of ClickUp HTTP logic.
- `.claude/commands/start-ticket.md` — added optional `clickup_id`; orchestrates
  the helper; slug-primary (`cu-<id>` fallback); maps title/description/url;
  CU-1/CU-2 preconditions.
- `.claude/rules/validation-model.md` — new `CU` rule family (CU-1..CU-5) +
  `/start-ticket` invocation-map row.
- `.claude/docs/command-architecture.md` — documented the `clickup_id` option,
  the fetch-helper boundary, and `CLICKUP_API_TOKEN` setup.
- `.claude/docs/adr/ADR-005-clickup-intake.md` — **new** ADR.

## Commits

- One commit on branch `ticket/wf-pilot-001` (SHA in execution output). Per EM
  instruction, all work stays on this branch (no new branch).

## Deviations from plan

- **Authorized branch deviation:** implementation was performed on
  `ticket/wf-pilot-001` (not a fresh `ticket/wf-pilot-002` branch). IM-3/GU-4
  (branch-from-clean-main) were **waived by explicit EM instruction** — all
  workflow/governance/ClickUp work is to be consolidated on one branch and merged
  later as a single integration effort.
- The commit bundles concurrent uncommitted framework edits already present in
  `start-ticket.md` / `validation-model.md` / `command-architecture.md` (the
  separate role-model correction), since they share those files. This is per the
  same consolidation instruction.

## Validation run during implementation

- CU-1 / AC-4 (atomic failure, no token):
  `CLICKUP_API_TOKEN= python scripts/clickup_intake.py test-123`
  → `CU-1 ERROR: CLICKUP_API_TOKEN is not set`, **exit 1**, nothing emitted.
- Usage guard: `python scripts/clickup_intake.py` → usage message, exit 1.
- CU-3 / AC-5 (read-only): only `method="GET"`; no POST/PUT/DELETE/PATCH.
- AC-3 (no `clickup_id` → unchanged): command guards the ClickUp path behind the
  optional input; default behavior is untouched.
- **Deferred to `/verify`:** AC-2 (live fetch populates ticket.md/intake.md with a
  real task id) and AC-6 — both require a real `CLICKUP_API_TOKEN` + task id.
