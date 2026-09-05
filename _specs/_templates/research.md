---
ticket: <slug>
stage: research
mode: standard
status: complete
owner: ai_agent
updated: <YYYY-MM-DD>
links:
  clickup: ""
  github: ""
---

# Research — <title>

> Read-only investigation. Start from `AGENTS.md` (repo map) and the nested
> `AGENTS.md` files under `src/`, then verify every claim against the actual
> code — never quote the map without confirming it.

## Relevant directories  <!-- RS-1 -->

| Path | Why it matters |
|------|----------------|
| | |

## Relevant config files  <!-- RS-2 -->

| File | Relevance |
|------|-----------|
| | |

<Deployment runtime files are read here only to understand them — never modified.>

## Possibly affected services / layers  <!-- RS-3 -->

<`domains/` → `usecase/` → `ui/rest` + `ui/mcp`, `infrastructure/whatsapp`,
`infrastructure/chatstorage`, `infrastructure/chatwoot`, `views/` — list only
what this ticket actually touches.>

## Available validation commands  <!-- RS-3 -->

Listed, **not run** at this stage. Canonical set:
`project-config.yaml > validation_checks`.

| Check | Command |
|-------|---------|
| go-build | `go build -C src ./...` |
| go-vet | `go vet -C src ./...` |
| go-test | `go test -C src ./...` |

## Risks & unknowns  <!-- RS-4 -->

- 

## Open questions  <!-- RS-5 -->

- 

## Notes

- This stage is **read-only**: no source file, config, or deployment runtime file
  was modified (GU-1).
- No validation or test command was executed.
