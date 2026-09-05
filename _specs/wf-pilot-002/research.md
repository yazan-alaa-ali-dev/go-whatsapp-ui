---
ticket: wf-pilot-002
stage: research
mode: standard
status: complete
owner: ai_agent
updated: 2026-06-14
links:
  clickup:
  github:
---

# Research — wf-pilot-002

> Read-only phase. No implementation is allowed in this command.

## Goal

Enable `/start-ticket` to optionally seed a workspace from a ClickUp task (title,
description, URL), read-only, without changing anything downstream of intake.

## Relevant directories

- `.claude/commands/` — `start-ticket.md` is the command to extend.
- `.claude/rules/` — `validation-model.md` holds the rule catalogue + invocation map.
- `.claude/docs/` — `command-architecture.md` holds the `/start-ticket` contract;
  `adr/` for a decision record.
- `_specs/_templates/` — `ticket.md` and `intake.md` already carry a
  `links.clickup` front-matter field (no template change needed).

## Relevant config files

- `.claude/commands/start-ticket.md` — current inputs: `slug`, `title`, `mode`
  (standard|high_risk; rejects fast), `owner`, `links`; FM-3/FM-5/CMD-3 gates;
  writes `ticket.md` (state draft) + `intake.md`; initial history `ticket-created`.
- `.claude/rules/validation-model.md` — pattern for adding a rule family (e.g.
  `RS`, `SP`, `CU`) + the per-command invocation map row for `/start-ticket`.
- `.claude/docs/command-architecture.md` — `/start-ticket` contract + v1 scope note.

## Possibly affected services

- **External:** ClickUp REST API v2, read-only — `GET /api/v2/task/{task_id}`
  with `Authorization: <token>`. No internal service is affected; no observability
  runtime touched.

## Test / validation commands available

- `curl` (for the read-only GET) and `python` (already used) for any parsing.
- The workflow's own validation rules (new `CU` family) as machine checks.
- A dry-run against a real ClickUp task ID + token at verify time.

## Risks and unknowns

- **Credential handling:** a `CLICKUP_API_TOKEN` must be provided via env/secret
  and never committed (add a git-ignore / docs note). Security-sensitive.
- **Network availability:** headless/cron runs may lack network or token →
  the fetch must fail atomically (write nothing), leaving `/start-ticket`'s
  non-ClickUp path unaffected.
- **Description format:** ClickUp returns `description` (markdown) and
  `text_content` (plain); pick one deterministically.
- **Slug derivation / collisions:** default `cu-<task_id>` vs user-supplied slug;
  CMD-3 already blocks duplicate workspaces.

## Open questions

- Slug: default to `cu-<task_id>` or require an explicit slug? (Recommend allow
  both; default `cu-<task_id>`.)
- Store the full ClickUp description in `intake.md`, or a trimmed summary?
- Which description field — `description` (markdown) or `text_content` (plain)?

## Notes

- No code was changed during research.
- No observability runtime configs were modified.
