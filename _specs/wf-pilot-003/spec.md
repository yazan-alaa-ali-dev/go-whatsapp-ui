---
ticket: wf-pilot-003
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-06-15
links:
  clickup:
  github:
---

# Spec — wf-pilot-003

> Define *what* must be true when done. **No implementation details, no file
> names, no code.**
>
> **Revision note:** this spec was corrected (authorized pre-approval correction)
> from an earlier evidence-only/manual model to a **configuration-driven
> execution** model: validation commands live in configuration, profiles select
> which checks are required, and the verification gate executes the resolved
> commands. State remains `research-complete`; no plan exists yet.

## Feature Name

Framework-agnostic, configuration-driven validation profiles.

## Business Goal

Give the workflow a reusable, consistent way to require and **execute** the right
validation checks for a class of change, where the commands are **configuration**
rather than logic baked into the workflow. This makes "validated" mean the same
thing across tickets, lets new kinds of validation be added by editing
configuration alone, and keeps the workflow independent of any language, test
framework, or execution environment — with no automation or external dependency.

## User Story

> As a workflow governance architect, I want validation profiles that select
> which configured checks must run at verification, so that the workflow executes
> real, consistent validation while remaining agnostic to the specific commands,
> tools, and frameworks involved.

## Functional Requirements

- **FR-1 — Check definitions (configuration).** Configuration provides a catalog
  of named validation checks; each check maps a stable check identifier to a
  command and a pass condition. Commands exist **only** in check definitions.
- **FR-2 — Profiles select checks.** A validation profile declares **which**
  checks are required (by check identifier, with a depth tag) and references
  **nothing but check identifiers** — it contains no commands.
- **FR-3 — Optional reference.** A ticket may reference at most one profile to
  declare the validation required for its verification. Referencing is optional.
- **FR-4 — Resolve → look up → execute → record.** At verification the gate
  resolves the referenced profile to its required checks, looks up each check's
  command from configuration, executes it, and records the command, exit code,
  output summary, and pass/fail result.
- **FR-5 — Map results to acceptance criteria.** Each executed check result is
  mapped to the acceptance criterion/criteria it covers.

## Non-Functional Requirements

- **NFR-1 — Framework-agnostic.** The workflow logic contains no framework- or
  tool-specific command; all such specifics reside in configuration.
- **NFR-2 — Deterministic & non-interactive.** Validation commands must produce a
  stable, repeatable result and require no human interaction or input.
- **NFR-3 — Local & dependency-free.** Execution is local and configuration-driven
  only — no external runner, CI/CD system, or network service is involved.
- **NFR-4 — Auditable.** The command, exit code, output summary, result, and
  acceptance-criterion mapping are recorded so an independent reviewer can
  reproduce the judgement.

## Constraints

- **C-1 — Separate concepts.** The catalog of check definitions and the set of
  profiles are **distinct concepts and remain separate**.
- **C-2 — Reference discipline.** Profiles may reference only check identifiers;
  commands exist only in check definitions.
- **C-3 — Configuration, not state.** Profiles, check definitions, and results are
  configuration/records — never workflow state. The canonical ticket record
  remains the sole owner of workflow state.
- **C-4 — Read-only on implementation.** Validation commands must be read-only
  with respect to implementation files; verification does not mutate the
  implementation.
- **C-5 — Additive and opt-in.** When no profile is referenced, planning and
  verification behave exactly as before this change.
- **C-6 — Guardrails unchanged.** Existing mode and observability guardrails
  remain authoritative and independent of any profile; no observability runtime is
  touched by this work.
- **C-7 — No external integration.** No GitHub, CI/CD, MCP, or external-runner
  integration; execution is local in V1.

## Edge Cases

- A ticket references **no** profile → current (pre-change) behavior.
- A profile references a check identifier that is **not defined** in the catalog →
  a precondition error; nothing advances or executes.
- A required check's command is **missing or unrunnable** in the local
  environment → recorded as an explicit failure with its error, never a silent
  pass.
- A profile defines **zero** required checks → low-assurance; must be surfaced
  rather than silently passing.
- A command that is **non-deterministic or interactive** → disallowed by NFR-2;
  must not be used as a validation check.
- Command output is **large or sensitive** → a bounded summary is recorded, not
  unbounded logs, and commands must not emit secrets.
- The highest verification depth (rollback rehearsal) coincides with required
  checks → both must be satisfied for a pass.

## Open Questions

> Recorded as blocking-for-planning; to be resolved during `/plan`.

- What is the minimal **pass-condition vocabulary** for a check — exit-code only,
  or also an output-substring match?
- How is a check's **output summary** bounded (truncation rule), and how are
  secrets kept out of the recorded summary?
- When a required command is **unavailable**, is the result a plain failure or a
  distinct "could-not-run" outcome — and how is that recorded?
- Should the profile **depth** tag reuse the existing verification-depth
  vocabulary exactly, or define a profile-local notion of depth?
- Is **one profile per ticket** sufficient (working assumption), or are
  multiple/composable profiles needed?

## Acceptance Criteria Mapping

> Each criterion has a stable ID; `verify.md` will reference these.

| ID   | Acceptance criterion | Maps to requirement |
|------|----------------------|---------------------|
| AC-1 | Configuration defines named validation checks, each mapping a check identifier to a command and a pass condition (definitions are configuration). | FR-1 |
| AC-2 | A validation profile declares which checks are required (by check identifier, with a depth tag) and contains no command strings itself. | FR-2, C-2 |
| AC-3 | At verification, the gate resolves the ticket's selected profile and, for each required check at the applicable depth, looks up its command from configuration (never a hardcoded command). | FR-4, C-2 |
| AC-4 | Verification executes each resolved command locally and records the command, exit code, output summary, and pass/fail result. | FR-4, NFR-4 |
| AC-5 | Each executed check result is mapped to the acceptance criterion/criteria it covers. | FR-5 |
| AC-6 | The workflow logic contains no framework-specific command; adding or changing a check requires only a configuration change, not a change to workflow logic. | NFR-1 |
| AC-7 | The canonical ticket record remains the sole owner of workflow state; profiles, check definitions, and results are configuration/records, not state. | C-3 |
| AC-8 | With no profile referenced, planning and verification behave exactly as before; previously closed tickets remain valid and require no migration. | C-5 |
| AC-9 | Validation commands are deterministic, non-interactive, and read-only with respect to implementation files; no external automation, CI/CD, GitHub, MCP, or external runner is introduced (execution is local/config-driven). | NFR-2, NFR-3, C-4, C-7 |

## Out of Scope

- Any external runner, CI/CD, GitHub, GitHub Actions, Jenkins, GitLab, or MCP
  integration (commands are executed locally, driven by configuration).
- Changes to the state machine, gates, role model, approval counts, modes, or
  closure strategy.
- Any modification to observability runtime files.
- A resolution to the binary (pass/fail) verification-outcome limitation.
- Non-deterministic or interactive validation commands.
- Bidirectional or status synchronization of any kind.
