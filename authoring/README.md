# Authoring Runtime

Self-contained runtime for the **Authoring Domain**. This subtree implements
authoring workflows that turn raw human knowledge into a **qualified,
promotable** artifact and stop at the Promotion boundary.

## What is here (V1)

The first workflow: the **Manager Workflow**, and — so far — only its first
command, `manager.intake` (C1).

- `commands/manager-intake.md` — the `manager.intake` command contract.
- `templates/business-request.md` — the Business Request artifact template.
- `workspace/<slug>/business-request.md` — where `manager.intake` writes each
  Business Request instance (`workspace/.gitkeep` keeps the directory).

## Boundary (why this subtree is isolated)

Everything the Authoring runtime needs lives under `authoring/`. It takes **no
dependency on any other part of this repository** — no external commands, rules,
helpers, or runtime configuration. Each command contract states its own
preconditions and postconditions inline.

The frozen design canon (Core Concepts, Workflow Principles, Authority Model,
Artifact Taxonomy, Promotion Contract, Role Definitions, Authoring Architecture,
Authoring Workflow Family, Manager Workflow) is referenced **by name only**; it
is the domain's design and travels with it.

Because the subtree is self-contained and self-describing, it can be extracted
to its own repository later (e.g. `git subtree split -P authoring`) intact.

## Scope guardrails (V1 / C1)

- One command only: `manager.intake`. No structure / refine / qualify yet.
- Provenance is **knowledge-first**: the anchor is opened as an open placeholder
  and confirmed only at qualification (a later command). No live external
  integration.
- No generic engine, no descriptor framework, no shared-runtime extraction, no
  QA workflow, no promotion.
