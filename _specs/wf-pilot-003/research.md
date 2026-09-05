---
ticket: wf-pilot-003
stage: research
mode: standard
status: complete
owner: ai_agent
updated: 2026-06-15
links:
  clickup:
  github:
---

# Research — wf-pilot-003

> Read-only phase. **No implementation is allowed in this command.**
>
> **Revision note:** corrected (with the spec) from an evidence-only model to a
> **configuration-driven execution** model — validation commands live in
> configuration, profiles select required checks, and `/verify` resolves and
> executes the commands.

## Goal

Determine how framework-agnostic, **configuration-driven** validation profiles can
be added so that: (a) the workflow configuration defines named validation checks
(check identifier → command + pass condition); (b) profiles declare *which* checks
are required (by identifier, with depth); (c) `/verify` resolves the selected
profile → its checks → their commands, executes them locally, and records command,
exit code, output summary, and result, mapped to `AC-n` — all without changing the
state machine, gates, role model, or state ownership, and while the workflow logic
itself holds no framework-specific command.

## Relevant directories

- `.claude/` — governance home; all workflow rules/config/docs/commands live here.
- `.claude/rules/` — `validation-model.md` (rule families incl. `MO`, `VF`, `GU`)
  and `workflow-rules.md` (stage gates, guardrails). Where verification depth and
  gate behavior are defined.
- `.claude/docs/` — `command-architecture.md` (per-command contracts) and `adr/`
  (decision records, incl. state ownership).
- `.claude/commands/` — the implemented commands; `plan.md` and `verify.md` are
  the two touched conceptually by this feature.
- `_specs/` — ticket workspaces and `_templates/` (artifact shapes, incl.
  `plan.md`, `verify.md`).
- `scripts/` — existing repo utilities, including a real validator that is a
  natural candidate for a configured check definition.
- `observability/` — runtime stack (Loki/Grafana/Prometheus/Alertmanager).
  **Read-only here; must not be modified by this work.**

## Relevant config files

- `.claude/project-config.yaml` — canonical single source of truth for `lifecycle`
  (state machine), `modes` (incl. `verification` depth: `all-ac` /
  `all-ac+rollback`), `closure`, `roles`, and `separation_of_duties`. Candidate
  home for the two **separate** new concepts: a catalog of validation check
  definitions and a set of validation profiles.
- `.claude/rules/validation-model.md` — `MO-6` (verification depth) and the `VF`
  family (verification rules, AC coverage `VF-2`/`TR-2`, read-only `VF-7`,
  observability statement `VF-9`). The rule layer the profile mechanism must
  compose with, not contradict.
- `.claude/docs/command-architecture.md` — `/plan` and `/verify` command
  contracts (preconditions, postconditions, ownership).
- `_specs/_templates/plan.md` — carries the "Validation strategy" section
  (`PL-4`) where a profile reference would be named.
- `_specs/_templates/verify.md` — carries the AC→result table where the executed
  checks (command, exit code, output summary, result) would be recorded.
- `.claude/docs/adr/ADR-003-ticket-state-ownership.md` — establishes `ticket.md`
  as the sole state owner; constrains profiles/checks/results to configuration and
  records, never state.

## Possibly affected services

- **No runtime/observability service is affected.** The observability stack is
  untouched; this is a governance/configuration + documentation change.
- Affected "surfaces" are workflow tooling and docs: the `/plan` contract (names a
  profile), the `/verify` contract (resolves a profile, looks up and executes the
  configured commands, records results), and the operator docs
  (`WORKFLOW_V1_RUNBOOK.md`, `WORKFLOW_V1_DEVELOPER_CHEAT_SHEET.md`).

## Test / validation commands available

> Listed for awareness only — **not run** during research. Under the corrected
> model these are examples of commands that would be wrapped as **configured
> check definitions** (check identifier → command), never named inside the
> workflow logic.

- `python scripts/validate_observability_json.py` — existing JSON config
  validator (added by WF-PILOT-001); deterministic, non-interactive, read-only —
  a natural first configured check.
- `git status --short` / `git status -- observability` — confinement checks
  (writes stay inside `_specs/<ticket>/`; observability untouched); usable to
  assert a validation command did not mutate implementation files (`VF-7`).
- The `validation-model.md` rule codes — the reviewer's checklist; no executor
  required.
- Note: external CI systems (GitHub Actions, Jenkins, GitLab) and MCP are **out of
  scope**; execution is local and configuration-driven in V1.

## Risks and unknowns

- **Arbitrary command execution / trust** — `/verify` would run shell commands.
  Impact: high. Mitigation: commands originate only from versioned, review-gated
  configuration (any new check passes through `/review`); no external/untrusted
  input.
- **Mutation breaking `VF-7`** — a configured command could alter files. Impact:
  high. Mitigation: validation commands must be read-only; reviewer confirms at
  the gate that introduces a check; a no-diff assertion after a run is feasible.
- **Environment / platform dependence** — a command may be absent or
  shell-specific (this repo is win32 with a bash tool available); no CI fallback.
  Impact: medium. Mitigation: a missing/unrunnable command is recorded as an
  explicit failure; document local prerequisites and the assumed shell.
- **Output capture: size & secrets** — raw output could be large or leak secrets.
  Impact: medium. Mitigation: record a bounded summary (command, exit code,
  truncated output, result); commands must not emit secrets.
- **Non-determinism / flakiness** — a flaky command yields unstable verdicts.
  Impact: medium. Mitigation: NFR requires deterministic, non-interactive
  commands; recorded command+output aids reproduction.
- **Observability guardrail bypass** — a check must not become a path to touch
  `observability/**`. Impact: high. Mitigation: `GU-2`/`MO-3`/`IM-5` remain
  independent and authoritative; validation commands are read-only.
- **Profile/check drift** — a profile references an undefined check identifier.
  Impact: medium. Mitigation: precondition check at both `/plan` and `/verify`.
- **Binary verify outcome gap** — V1 `/verify` has only PASSED/FAILED; if a
  required command is unavailable there is no "pending" outcome (known V1
  limitation from WF-PILOT-002). Impact: medium; explicitly out of scope here.

## Open questions

- What is the minimal **pass-condition vocabulary** for a check — exit-code only,
  or also an output-substring match?
- How is a check's **output summary** bounded (truncation), and how are secrets
  kept out of the recorded summary?
- When a required command is **unavailable**, is the result a plain failure or a
  distinct "could-not-run" outcome, and how is it recorded?
- Should the profile **depth** tag reuse the existing verification-depth
  vocabulary (`smoke`/`all-ac`/`rollback`) exactly, or a profile-local notion?
- Is **one profile per ticket** sufficient (working assumption), or are
  multiple/composable profiles needed?

> Resolved by the corrected design decisions (no longer open): check definitions
> and profiles are separate concepts; profiles reference only check identifiers;
> commands exist only in check definitions; `/verify` resolves profile → checks →
> commands and executes them; commands must be deterministic, non-interactive, and
> read-only; the workflow logic stays framework-agnostic; no GitHub/CI-CD/MCP/
> external runner.

## Notes

- No code was changed during research.
- No observability runtime configs were modified.
