---
ticket: wf-pilot-003
stage: review
mode: standard
status: complete
owner: reviewer
updated: 2026-06-15
links:
  clickup:
  github:
---

# Review — wf-pilot-003

> Review gate. The reviewer evaluates the spec and plan before any implementation.
> Separation of duties: the plan/spec author is `ai_agent`; this gate decision is
> made by a human reviewer (distinct actor). `allow_self_review.standard` is
> `false`, so the author did not self-approve; the AI only recorded the human
> reviewer's decision.

## Review Scope

`spec.md` (AC-1..AC-9, corrected configuration-driven execution model) and
`plan.md` (config-driven validation profiles) for wf-pilot-003. ADR-003 and the
existing `MO`/`VF`/`GU` rule families were used as the consistency baseline.

## Plan Summary

Add two **separate**, additive configuration concepts to `project-config.yaml`:
`validation_checks` (check-id → command + pass condition; commands live only here)
and `validation_profiles` (profiles reference check-ids + a depth tag only).
`/plan` may optionally name one profile; `/verify` resolves profile → checks →
commands, executes them locally (deterministic, non-interactive, read-only), and
records command/exit-code/output-summary/result mapped to `AC-n`. A new `VP` rule
family (VP-1..VP-5), ADR-006, two template tweaks, and operator-doc parity round
it out. Opt-in: no profile → unchanged behavior. Seed check wraps the existing
read-only `scripts/validate_observability_json.py`.

## Risks

- Executing config-defined commands at `/verify` — mitigated: commands originate
  only from versioned, review-gated config; VP-2 keeps them read-only (reinforces
  VF-7); VP-3 requires deterministic/non-interactive.
- Environment/platform dependence with no CI fallback — accepted for V1 (local,
  config-driven); unavailable command is recorded as an explicit `error`/FAILED,
  never a silent pass.
- Output capture size/secrets — mitigated by bounded summary + no-secrets rule.
- Observability guardrail integrity — unchanged; `GU-2`/`MO-3`/`IM-5` remain
  authoritative and independent of profiles.

## Assumptions

- Standard mode is correct: the change touches `.claude/**` governance/config,
  templates, and root docs — **no `observability/**` runtime file** — so it is not
  high_risk.
- One profile per ticket in V1 is sufficient.
- Adding new validation support is a configuration-only edit (no command-logic
  change), preserving framework-agnosticism.

## Open Questions

- None blocking. The five spec open questions are resolved as explicit design
  decisions in `plan.md` (pass-condition vocabulary, output bounding/secrets,
  unavailable-command outcome, depth vocabulary reuse, single-profile cardinality).

## Decision

`APPROVED`

- Rationale: config-driven validation profiles, additive and reversible. The plan
  satisfies PL-1..PL-5 with explicit AC-1..AC-9 traceability in the validation
  strategy; keeps checks and profiles as separate concepts (C-1/C-2); confines
  execution to local, read-only, deterministic commands; changes no state machine,
  gate, role, mode, or closure; and touches no observability runtime. Scope is
  bounded and every change is reversible on the ticket branch.

## Approvals

> `standard` requires 1 approver. `high_risk` requires 2.

- Approver 1 (reviewer): human reviewer (gate driven by the human; author
  `ai_agent` did not self-review)
- Approver 2 (high_risk only): n/a (standard mode)

## ADR reference

> Required for `high_risk`; otherwise "none".

- ADR: none required for approval (standard mode). The plan delivers
  `ADR-006-validation-profiles.md` as an implementation artifact.

## Required Follow-up Actions

- none. Implement strictly per `plan.md` "Files to change"; the branch
  `ticket/wf-pilot-003` is created by `/implement` from clean `main` (GU-4).
