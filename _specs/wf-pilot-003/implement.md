---
ticket: wf-pilot-003
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-06-15
links:
  clickup:
  github:
---

# Implement — wf-pilot-003

> Record of what was actually built, following `plan.md`. Entry path: **initial**
> (from `approved`). Branch `ticket/wf-pilot-003` created from clean `main`.

## Changes made

All changes are exactly the plan's "Files to change" (additive, opt-in):

- `.claude/project-config.yaml` — added **two separate** blocks: `validation_checks`
  (seed `observability-json` → command + `pass_when`) and `validation_profiles`
  (seed `observability-config` requiring `observability-json` at `all-ac`).
- `.claude/rules/validation-model.md` — added the `VP` rule family (VP-1..VP-5)
  and added `VP` entries to the `/plan` and `/verify` invocation-map rows.
- `.claude/commands/plan.md` — VP-1/VP-4 precondition (profile/check existence,
  reference-by-id) + optional `Validation profile:` note.
- `.claude/commands/verify.md` — profile resolution (profile → checks → commands),
  local execution, command/exit/output-summary/result recording, AC mapping,
  VP-1 precondition, VP-2..VP-5 postconditions; no-profile path unchanged.
- `.claude/docs/command-architecture.md` — `/plan` + `/verify` contract notes.
- `.claude/docs/adr/ADR-006-validation-profiles.md` — **new** ADR (accepted).
- `_specs/_templates/plan.md` — optional `Validation profile:` line.
- `_specs/_templates/verify.md` — executed-checks columns (command, exit, output
  summary, result) + profile id line.
- `WORKFLOW_V1_RUNBOOK.md` — new "Validation profiles (config-driven, optional)"
  subsection.
- `WORKFLOW_V1_DEVELOPER_CHEAT_SHEET.md` — "Validation profiles (optional)" block.

## Commits

- `8f3c00e` — WF-PILOT-003: framework-agnostic, config-driven validation profiles
  (the 10 planned files + ticket.md transition). Local branch only; **not pushed**.
- A follow-up commit records this `implement.md` + the `implemented` transition.

## Deviations from plan

- None. Change set equals the plan's "Files to change" exactly; no unrelated file
  modified (IM-4). `ticket.md` was updated only as the canonical state record
  (TS-4). No `observability/**` runtime file was modified (the seed check *invokes*
  the existing read-only `scripts/validate_observability_json.py` but changes no
  script or runtime config).

## Validation run during implementation

- **Config structure (VP-4):** `validation_checks` and `validation_profiles` are
  separate top-level blocks; `command:` appears only under `validation_checks`,
  never under `validation_profiles`; the profile's `requires` lists `check`/`depth`
  only. No tabs (YAML-safe).
- **Seed check (VP-2 / VP-3):** `python scripts/validate_observability_json.py` →
  exit 0, deterministic "ok" output, and `git status` unchanged after running it
  (read-only w.r.t. the working tree).
- **Rules:** 5 `VP` rule rows present (VP-1..VP-5); invocation map updated for
  `/plan` and `/verify`.
- **Confinement (IM-4):** `git status` shows only the 10 planned files + ADR-006
  + `ticket.md` — no unrelated change.
- Full AC-1..AC-9 verification (incl. an end-to-end profile-resolved `/verify`
  run on a sample ticket) is deferred to `/verify` per the plan's strategy.
