---
ticket: <slug>
title: <one-line title>
mode: standard
state: draft
status: active
owner: developer
created_at: <YYYY-MM-DD>
updated_at: <YYYY-MM-DD>
links:
  clickup: ""
  github: ""
---

# Ticket: <title>

> **This file is the single canonical record of the ticket's workflow state**
> (ADR-003, `project-config.yaml > lifecycle.state_record`). Commands read
> `state` from here and write transitions here — never inferring state from the
> existence or content of any other artifact.

## Field reference

| Field | Meaning |
|-------|---------|
| `ticket` | Stable, filesystem-safe slug (`^[A-Za-z0-9][A-Za-z0-9._-]*$`, FM-5). |
| `title` | One-line human title. |
| `mode` | Legacy single value — always `standard` (ADR-009; FM-3). |
| `state` | Current lifecycle state; one of `project-config.yaml > lifecycle.states` (ST-1). |
| `status` | `active` or `blocked` (TS-3). `blocked` is a flag, never a state. |
| `owner` | Responsible role/person — the single owner who also runs the gates (RA-1). |
| `created_at` / `updated_at` | Absolute dates (`YYYY-MM-DD`). |
| `links` | ClickUp task and GitHub PR (`links.github` is written only by `/publish-pr`, PB-3). |

## Lifecycle

```
draft → ready-for-research → research-complete → spec-complete → plan-complete
→ approved → implementation-in-progress → implemented → verified → closed
```

`closed` is terminal — no reopen; open a new ticket.

## State history

Append-only. One entry per transition, written by the command that performs it
(TS-4).

```yaml
- state: draft
  event: ticket-created
  by: ai_agent
  timestamp: <YYYY-MM-DD>
```
