---
ticket: wf-pilot-002
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-06-14
links:
  clickup:
  github:
---

# Spec — wf-pilot-002

> Define what must be true when done. No implementation details, no file names,
> no code.

## Feature Name

Read-only ClickUp intake for ticket creation.

## Business Goal

Let developers initialize a workflow ticket from an existing ClickUp task so the
task's title, description, and link are carried in automatically — reducing
manual re-entry and preserving traceability to the source task.

## User Story

> As a developer, I want to start a workflow ticket by referencing a ClickUp task
> ID, so that the new workspace is pre-populated from that task.

## Functional Requirements

- Ticket creation accepts an **optional** ClickUp task identifier.
- When provided, the system fetches the task's **title, description, and URL**
  from ClickUp, **read-only**.
- The fetched title seeds the ticket title; the description seeds the intake
  summary; the task URL is recorded as the ClickUp link for traceability.
- When **not** provided, ticket creation behaves exactly as it does today.

## Non-Functional Requirements

- Read-only toward ClickUp: no writes, no status/comment changes, no task
  creation/closure.
- Credentials are supplied via a secret/environment value and never stored in
  committed files.
- The integration depends on one external read; failures must be handled cleanly.

## Constraints

- `ticket.md` remains the **single canonical owner** of workflow state; ClickUp
  is only an external intake source (no workflow-state mapping).
- No change to any stage after intake; the rest of the lifecycle is unchanged.
- No observability runtime files are touched.

## Edge Cases

- No identifier supplied → unchanged current behavior.
- Identifier supplied but task not found / unauthorized / no network → creation
  must fail atomically, creating no partial workspace.
- Missing credential → fail with a clear message, create nothing.
- A workspace for the derived identifier already exists → blocked (no duplicate).

## Open Questions

- None blocking (defaults: derive slug from the task id; choose a single
  description field) — to be fixed in the plan.

## Acceptance Criteria Mapping

| ID   | Acceptance criterion                                                                          | Maps to requirement |
|------|----------------------------------------------------------------------------------------------|---------------------|
| AC-1 | Ticket creation accepts an optional ClickUp task identifier.                                  | Functional #1       |
| AC-2 | With a valid identifier, title/description/URL are fetched read-only and populate the new `ticket.md` + `intake.md`. | Functional #2/#3 |
| AC-3 | With no identifier, behavior is identical to current `/start-ticket`.                         | Functional #4       |
| AC-4 | On fetch failure (not found / unauthorized / no token / no network), nothing is written (atomic). | NFR / Edge cases |
| AC-5 | No write of any kind is sent to ClickUp.                                                      | NFR (read-only)     |
| AC-6 | `ticket.md` remains the canonical state owner; no workflow-state is derived from ClickUp.     | Constraint          |

## Out of Scope

- Status sync, comment sync, ClickUp writes, task creation, task closure,
  bidirectional sync, and workflow-state mapping.
