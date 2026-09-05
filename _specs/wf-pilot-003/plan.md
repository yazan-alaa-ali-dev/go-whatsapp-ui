---
ticket: wf-pilot-003
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-06-15
links:
  clickup:
  github:
---

# Plan — wf-pilot-003

> Decide the approach before changing code. Plan only — no implementation here.

## Approach

Add two **separate, additive** configuration concepts to `project-config.yaml`:
`validation_checks` (a catalog mapping each check-id to a command + pass
condition) and `validation_profiles` (each profile lists required check-ids with a
depth tag, and references **nothing but check-ids**). Extend the `/plan` and
`/verify` contracts so a ticket may optionally name one profile in its Validation
strategy, and `/verify` **resolves profile → checks → commands**, executes them
locally (deterministic, non-interactive, read-only), and records command, exit
code, output summary, and result mapped to `AC-n`. Add a `VP` rule family to the
validation model, an ADR, and bring the operator docs to parity. The workflow
logic stays framework-agnostic because every command lives in configuration; the
change is opt-in (no profile → unchanged behavior). Chosen over the prior
evidence-only model because the team requires real check execution, and over
embedding commands in `/verify` because that would couple the workflow to specific
frameworks.

### Design decisions (resolving the spec's open questions)

1. **Pass-condition vocabulary (minimal):** `pass_when: exit-zero` (default) or
   `exit-code:<n>`; an optional `output_contains: "<substr>"` may add a required
   substring. No richer DSL in V1.
2. **Output summary bounding / secrets:** always record the exit code plus a
   **bounded** output summary (cap ~20 lines / ~2000 chars, truncation marked);
   validation commands must not emit secrets (documented requirement).
3. **Unavailable command:** if a required command cannot run (not found / shell
   error), record result `error` ("could-not-run") — a non-pass that makes the
   overall outcome FAILED; never a silent pass.
4. **Depth vocabulary:** reuse the existing verification tiers exactly
   (`smoke` / `all-ac` / `rollback`, per `MO-6`). `/verify` runs required checks
   whose `depth` ≤ the ticket mode's tier (standard ⇒ `all-ac`).
5. **Cardinality:** **one profile per ticket** in V1 (optional). Multiple/
   composable profiles are out of scope.

### Target schema (separate concepts — C-1/C-2)

```yaml
validation_checks:                 # DEFINITIONS — commands live ONLY here
  observability-json:
    description: JSON observability configs parse and match their schema.
    command: "python scripts/validate_observability_json.py"
    pass_when: exit-zero           # exit-zero | exit-code:<n>
    # output_contains: "<substr>"  # optional additional pass condition

validation_profiles:               # SELECTION — references check-ids only
  observability-config:
    description: Validation required for JSON observability config changes.
    requires:
      - check: observability-json
        depth: all-ac              # smoke | all-ac | rollback
```

### Proposed `VP` rule family (added to the validation model)

- **VP-1 (ERROR):** if a ticket/plan names a profile, it must exist and every
  check it requires must be defined in `validation_checks` (checked at `/plan` and
  `/verify`).
- **VP-2 (ERROR):** validation commands are read-only w.r.t. implementation files
  (no working-tree diff introduced); reinforces `VF-7`.
- **VP-3 (ERROR):** validation commands must be deterministic and non-interactive.
- **VP-4 (ERROR):** profiles reference only check-ids; commands exist only in
  `validation_checks` (separation of the two concepts).
- **VP-5 (ERROR):** when no profile is referenced, `/verify` runs no execution
  path and behaves exactly as before (backward compatibility).

## Steps

1. Add the `validation_checks` block to `project-config.yaml` with the seed check
   `observability-json` (wrapping the existing read-only validator).
2. Add the separate `validation_profiles` block with the seed profile
   `observability-config` requiring `observability-json` at `all-ac`.
3. Add the `VP` rule family (VP-1..VP-5) to `validation-model.md` and add `VP`
   entries to the `/plan` and `/verify` rows of the invocation map.
4. Extend `.claude/commands/plan.md`: optional `Validation profile:` reference +
   VP-1 precondition (profile/check existence).
5. Extend `.claude/commands/verify.md`: resolve profile → checks → commands;
   execute locally; record command/exit-code/output-summary/result; map to
   `AC-n`; enforce VP-2/VP-3 (read-only, deterministic, non-interactive) and the
   unavailable-command rule; no-profile path unchanged (VP-5).
6. Update `.claude/docs/command-architecture.md` `/plan` and `/verify` contracts
   to describe profile resolution and config-driven execution.
7. Extend `_specs/_templates/plan.md` (optional `Validation profile:` line) and
   `_specs/_templates/verify.md` (executed-checks columns: command, exit code,
   output summary, result, AC).
8. Add `.claude/docs/adr/ADR-006-validation-profiles.md` (config-driven execution;
   separation of checks/profiles; local-only; ticket.md stays canonical).
9. Update `WORKFLOW_V1_RUNBOOK.md` (new "Validation Profiles" subsection) and
   `WORKFLOW_V1_DEVELOPER_CHEAT_SHEET.md` (profile note) for documentation parity.
10. Validate per the strategy below.

## Files to change

- `.claude/project-config.yaml` — add **two separate** additive blocks:
  `validation_checks` (seed `observability-json`) and `validation_profiles` (seed
  `observability-config`). No existing keys altered.
- `.claude/rules/validation-model.md` — add the `VP` rule family (VP-1..VP-5) and
  `VP` entries in the `/plan` and `/verify` invocation-map rows.
- `.claude/commands/plan.md` — optional profile reference + VP-1 precondition.
- `.claude/commands/verify.md` — resolve/look-up/execute/record steps; VP-2/VP-3
  enforcement; AC mapping; unchanged no-profile path.
- `.claude/docs/command-architecture.md` — `/plan` + `/verify` contract updates.
- `.claude/docs/adr/ADR-006-validation-profiles.md` — **new** ADR.
- `_specs/_templates/plan.md` — optional `Validation profile:` line in Validation
  strategy.
- `_specs/_templates/verify.md` — executed-checks recording columns.
- `WORKFLOW_V1_RUNBOOK.md` — new "Validation Profiles" subsection.
- `WORKFLOW_V1_DEVELOPER_CHEAT_SHEET.md` — profile note.

**Not changed:** any `observability/**` runtime file; the state machine, gates,
roles, modes, or closure; `scripts/` (the seed check *invokes* the existing
read-only validator but does not modify it or any script).

## Validation strategy

Standard mode ⇒ depth `all-ac`: every `AC-n` mapped to an executed check/result in
`verify.md`. Because the feature does not exist until implemented, WF-PILOT-003's
own verification uses direct commands + a throwaway sample ticket (created and
removed during verify), not a profile reference.

- **AC-1:** inspect `project-config.yaml` → `validation_checks` defines a check
  with `command` + `pass_when`.
- **AC-2:** inspect a profile → lists check-ids + depth only; contains no command
  string (grep the `validation_profiles` block for `command:` → none).
- **AC-3:** trace `verify.md` command doc: it resolves profile → check → command
  from config (no hardcoded command); demonstrate on a sample ticket whose plan
  names `observability-config`.
- **AC-4:** run the sample through `/verify`; confirm `verify.md` records the
  command, exit code, bounded output summary, and pass/fail result.
- **AC-5:** confirm each recorded result is mapped to an `AC-n`.
- **AC-6:** grep `.claude/commands/verify.md` (workflow logic) for framework/tool
  command names → none; demonstrate that adding a second check is a
  `project-config.yaml`-only edit (no command-logic change).
- **AC-7:** confirm `ticket.md` still owns state and no state is derived from a
  profile/check/result (inspection + ADR-006).
- **AC-8:** run `/plan` and `/verify` on a no-profile sample → behavior identical
  to pre-change (no execution path triggered).
- **AC-9:** run the seed check twice → identical result (deterministic), no prompt
  (non-interactive); `git status` after run is clean (read-only / VP-2); grep the
  whole change for GitHub/CI/Jenkins/GitLab/MCP/external-runner wiring → none.

## Rollback

All changes are additive and reversible on the ticket branch: revert the two
config blocks, the `VP` rules + invocation-map edits, the `/plan` and `/verify`
contract/command edits, the template additions, the ADR, and the doc updates. No
data migration; no existing ticket is altered, so closed tickets remain valid
without action.

## Out of scope

- Any external runner, CI/CD, GitHub, GitHub Actions, Jenkins, GitLab, or MCP
  integration (execution is local, config-driven).
- Changes to the state machine, gates, role model, approval counts, modes, or
  closure strategy.
- Any modification to observability runtime files.
- Multiple/composable profiles per ticket; non-deterministic or interactive
  commands; a resolution to the binary (pass/fail) verification-outcome limitation.
- Retroactively assigning profiles to existing/closed tickets.
