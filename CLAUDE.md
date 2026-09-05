# CLAUDE.md — Engineering Workflow v1

Governance contract for any AI agent (and human) working in this repository.
This file is authoritative. When in doubt, stop and ask the Workflow Owner.

## Mission

This repository hosts **gowa-ui** — the web dashboard (SPA) for the GOWA
multi-device WhatsApp API server. React 19 + TypeScript on Vite 8, Tailwind v4
with shadcn/ui, TanStack Query for server state, zustand for client state,
react-router-dom, an axios REST client and a WebSocket event stream. The build
(`vite-plugin-singlefile`) emits a single `dist/index.html` that the backend
downloads at runtime and serves at `/`.

The npm project root **is** the repository root; application code lives under
`src/` (see `AGENTS.md` for the repository map). The backend contract the UI
codes against is documented in `docs/gowa-frontend-reference-ar.html` — that
document is the reference for backend behaviour, superseding older assumptions
baked into the current UI.

The mission of the engineering workflow is to make every change **small,
reviewed, and verifiable**, moving through a fixed set of stages with explicit
review gates — never improvising scope or skipping review.

## Workflow stages

Canonical stages (see `.claude/project-config.yaml` and
`.claude/rules/workflow-rules.md` for full definitions):

1. `intake` — capture and qualify the request.
2. `research` — read-only investigation of the repo and impact.
3. `spec` — define what "done" means (criteria + test cases).
4. `plan` — decide the approach and concrete steps.
5. `review` — a reviewer reviews spec/plan before any code.
6. `implement` — apply the change per the approved plan.
7. `verify` — validate the change and review runtime impact.

Each stage produces an artifact under `_specs/<ticket>/` from the templates in
`_specs/_templates/`.

## Hard stop conditions

Stop immediately and request Workflow Owner direction if any of these occur:

- A change would touch **deployment runtime files** (`.github/workflows/ci.yml`,
  `.github/workflows/release.yml`, `vite.config.ts`, `package.json`,
  `index.html` — canonical list: `project-config.yaml > deployment_runtime.files`)
  outside an explicitly approved implement stage.
- The request requires deleting or rewriting existing workflow artifacts.
- Acceptance criteria are missing, ambiguous, or untestable.
- A stage's entry criteria are not met (e.g. implementing before plan approval).
- Scope grows beyond what the approved spec/plan describes.

## Forbidden actions

- Do **not** create workflow commands unless a phase explicitly authorizes it.
- Do **not** implement tickets during research, spec, plan, or review stages.
- Do **not** modify deployment runtime files as part of workflow/governance work.
- Do **not** delete `_specs/`, `.claude/commands/README.md`, or
  `.claude/project-config.yaml` (the canonical config).
- Do **not** skip stages or record a gate decision without completing the
  **comprehension check**. The single owner runs their own `/review` and
  `/verify` (self-review is expected; ADR-009) — there is no separate-reviewer
  requirement; the comprehension gate (CG-1..CG-4) is the control against
  rubber-stamping.

## Review gate requirements

- The gates `/review` and `/verify` are run per ticket by the **owner** themselves
  (self-review; ADR-009). Gate integrity comes from the **comprehension check**
  (the owner answers questions generated from the artifact), not a second person.
  They do **not** require an Engineering Manager.
- The `review` stage is a **mandatory gate**: no `implement` may begin until the
  owner accepts the `spec` and `plan` at `/review` (with the comprehension check
  completed).
- The owner signs off again at `verify` (comprehension check) before a ticket is
  considered done.
- Review decisions are recorded as `CHANGES_REQUESTED` / `REJECTED` / `APPROVED`
  against the relevant stage.
- At `/review`, an **advisory** AI panel (senior / security / performance,
  read-only) reviews the plan and records findings for the owner (ADR-010). It
  **informs** the decision — it never blocks or makes it; the comprehension gate
  remains the control.
- The **Workflow Owner** owns governance (workflow evolution, governance
  decisions, escalations, cross-project issues), not per-ticket sign-off. Escalate
  to the Workflow Owner only when a hard-stop or governance question arises.

## Small-change philosophy

- Prefer the smallest change that satisfies the acceptance criteria.
- One ticket = one focused outcome; split anything larger.
- Bias toward read-only investigation first; touch code last and minimally.
- Every change must be reversible and individually verifiable.
