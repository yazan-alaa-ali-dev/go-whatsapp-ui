---
ticket: 86eyhz682
title: Debug mode 3/4 — Read dashboard conversations from MongoDB with a WhatsApp fallback and a diagnostics badge
mode: standard           # single workflow form — no other modes (ADR-009)
state: closed            # AUTHORITATIVE workflow state (see allowed values below)
status: active           # orthogonal health flag: active | blocked
owner: developer         # accountable role/person (em | developer | ai_agent | name)
created_at: 2026-08-09   # YYYY-MM-DD
updated_at: 2026-08-09   # YYYY-MM-DD (bumped on every state change)
links:                   # OPTIONAL delivery links — metadata only, NOT workflow state
  clickup: https://app.clickup.com/t/86eyhz682
  github: https://github.com/yazan-alaa-ali-dev/whats-app-server/pull/34
---

# Ticket Record — 86eyhz682: Debug mode 3/4 — Read dashboard conversations from MongoDB with a WhatsApp fallback and a diagnostics badge

> **This file is the single canonical owner of the ticket's workflow state.**
> Commands read `state` from here and write transitions back here. Stage
> artifacts (`intake.md` … `verify.md`) never own workflow state; their local
> `status` describes only their own progress. See
> [ADR-003](../../.claude/docs/adr/ADR-003-ticket-state-ownership.md).

## Field reference

| Field        | Required | Purpose                                              | Allowed values |
|--------------|----------|------------------------------------------------------|----------------|
| `ticket`     | yes      | Canonical id/slug; ties artifacts + branch together. | slug `^[A-Za-z0-9][A-Za-z0-9._-]*$` |
| `title`      | yes      | Human-readable summary.                              | free text |
| `mode`       | yes      | Legacy single-value field — the one workflow form (canonical here; artifacts mirror it). | `standard` (sole value; ADR-009) |
| `state`      | yes      | **Authoritative** workflow state.                   | `draft`, `ready-for-research`, `research-complete`, `spec-complete`, `plan-complete`, `approved`, `implementation-in-progress`, `implemented`, `verified`, `closed` |
| `status`     | yes      | Orthogonal health flag (transitions blocked while `blocked`). | `active` \| `blocked` |
| `owner`      | yes      | Accountable owner.                                  | `em` \| `developer` \| `ai_agent` \| name |
| `created_at` | yes      | Creation date.                                      | `YYYY-MM-DD` |
| `updated_at` | yes      | Last state change; bumped on every transition.      | `YYYY-MM-DD` |
| `links`      | no       | Optional delivery links (metadata only; never workflow state). `github` is set by `/publish-pr`. | `{clickup, github}` URLs (may be empty) |

`state` values and their legal transitions are defined canonically in
`.claude/project-config.yaml > lifecycle`. `status: blocked` corresponds to the
orthogonal "blocked" flag in the validation model (ST-3) and halts advancement.

## Dependency

This ticket is 3/4 of the debug-mode chain. It depends on
[86eyhz67r](../86eyhz67r/ticket.md) (2/4), which introduced `chatId`,
`metadataDebug`, the conversation index and the canonical read order this
ticket reads through. The implementation branch is therefore cut from
`ticket/86eyhz67r`, not from `main`, for as long as 2/4 is unmerged.

## State history (required)

Append one entry per state change; never edit or remove past entries.
`/start-ticket` writes the initial `ticket-created` entry shown below; each later
command appends one entry for the transition it performs.

```yaml
- state: draft
  event: ticket-created
  by: ai_agent
  timestamp: 2026-08-09
- state: ready-for-research
  event: research-started
  by: ai_agent
  timestamp: 2026-08-09
- state: research-complete
  event: research-validated
  by: ai_agent
  timestamp: 2026-08-09
- state: spec-complete
  event: spec-validated
  by: developer
  timestamp: 2026-08-09
- state: plan-complete
  event: plan-validated
  by: reviewer
  timestamp: 2026-08-09
- state: approved
  event: plan-approved
  by: reviewer
  timestamp: 2026-08-09
- state: implementation-in-progress
  event: implementation-started
  by: developer
  timestamp: 2026-08-09
- state: implemented
  event: implementation-completed
  by: developer
  timestamp: 2026-08-09
- state: verified
  event: verification-passed
  by: reviewer
  timestamp: 2026-08-09
- state: closed
  event: ticket-closed
  by: reviewer
  timestamp: 2026-08-09
```

Each entry's fields: `state` (the state after the event), `event` (what
happened, e.g. `ticket-created`, `intake-ready`, `approved`), `by` (actor:
`ai_agent` | `em` | `developer` | name), `timestamp` (`YYYY-MM-DD`).
