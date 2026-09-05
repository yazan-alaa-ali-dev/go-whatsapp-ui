---
ticket: wf-pilot-003
stage: intake
mode: standard
status: complete
owner: developer
updated: 2026-06-15
links:
  clickup:
  github:
---

# Intake — wf-pilot-003

> First stage. Qualify the request only. **No technical planning allowed.**

## Ticket Reference

wf-pilot-003 — internal governance/configuration ticket (no external tracker link).

## Ticket Summary

Introduce **framework-agnostic, configuration-driven validation profiles**. The
workflow configuration defines named validation checks (check identifier →
command + pass condition); profiles declare *which* checks are required; and the
verification gate resolves the selected profile → its checks → their commands,
executes them locally, and records command, exit code, output summary, and result
mapped to `AC-n`. Commands live only in check definitions, so the workflow logic
holds no framework-specific command and stays agnostic to languages, tools, and
runners. No GitHub, CI/CD, MCP, or external runner — execution is local in V1.
`ticket.md` remains the sole canonical owner of workflow state; profiles, checks,
and results are configuration/records, not state.

## Ticket Metadata

- id / slug: wf-pilot-003
- title: Framework-agnostic validation profiles (config-driven execution)
- owner: developer
- created: 2026-06-15
- links: (none)

## User Story

> As a workflow governance architect, I want validation profiles that describe
> required validation evidence (not executable commands), so that the workflow
> can demand consistent, reusable proof of validation while remaining agnostic to
> how and where that proof is produced.

## Acceptance Criteria Presence Check

- Present? yes (defined in `spec.md`, AC-1..AC-8).
- Notes: criteria assert evidence-requirement semantics, the no-execution
  property, the evidence-gate behavior of verify, framework- and
  execution-agnosticism, canonical state ownership, backward compatibility, and
  validity of existing tickets.

## Test Cases Presence Check

- Present? no (deferred to `spec.md` acceptance criteria + later `plan.md`
  validation strategy; intake qualifies the request only).
- Notes: concrete test cases are not authored at intake.

## Missing Information

- Open design questions remain (pass-condition vocabulary, output-summary
  bounding/secret handling, unavailable-command outcome, depth vocabulary,
  single-vs-multiple profile). These are recorded as Open Questions in
  `research.md` / `spec.md` and must be resolved during planning. They do not
  block specification.

## Readiness Status

`READY`

- Justification: the request has a clear goal, a bounded outcome (additive,
  configuration-only governance change), declared constraints, and testable
  acceptance criteria. It touches no observability runtime and is `standard`
  mode. Sufficient to proceed to read-only research and specification.
