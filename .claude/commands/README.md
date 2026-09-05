# `.claude/commands/`

Home for the ticket-workflow slash commands of Engineering Workflow v1, as used
in the **gowa-ui** repository (the GOWA web dashboard).

Lifecycle stages (in order):

| Command | Stage | Ticket state after a successful run |
|---------|-------|-------------------------------------|
| `/start-ticket` | intake | `draft` |
| `/research` | research | `ready-for-research` |
| `/spec` | spec | `research-complete` |
| `/plan` | plan | `spec-complete` |
| `/review` | review (gate) | `approved` / `spec-complete` / `closed` |
| `/implement` | implement | `implemented` (or blocked) |
| `/verify` | verify (gate) | `closed` (or back to implementation) |

Plus one delivery command, orthogonal to the state machine:

| Command | Purpose |
|---------|---------|
| `/publish-pr` | Create the single publishable commit, push `ticket/<slug>`, open the PR. Performs **no** state transition. |

Each command operates on a ticket workspace under `_specs/<ticket>/` and writes
the corresponding artifact there. The canonical definitions live in
[`../project-config.yaml`](../project-config.yaml) (stages, state machine,
validation profiles), [`../rules/workflow-rules.md`](../rules/workflow-rules.md)
(stage gates and guardrails), and
[`../rules/validation-model.md`](../rules/validation-model.md) (rule codes).

Repository specifics the commands rely on:

- The npm project root **is** the repo root — validation commands run there
  verbatim (`npm run typecheck` / `lint` / `test` / `build`; see
  `project-config.yaml > validation_checks`). Application code lives in `src/`.
- Tickets touching application source should name the `ui-source` validation
  profile in `plan.md`; use `ui-build` when the change can break the bundle
  (build config, entry document, dependencies, assets).
- [`../../AGENTS.md`](../../AGENTS.md) is the repo map `/research` starts from,
  and [`../../docs/gowa-frontend-reference-ar.html`](../../docs/gowa-frontend-reference-ar.html)
  is the authoritative backend contract (auth, device scoping, WS, permissions).
- Deployment runtime files (`.github/workflows/ci.yml`,
  `.github/workflows/release.yml`, `vite.config.ts`, `package.json`,
  `index.html` — canonical: `project-config.yaml > deployment_runtime.files`)
  are a hard stop unless listed in an approved `plan.md`.
