---
ticket: wf-pilot-002
stage: intake
mode: standard
status: complete
owner: developer
updated: 2026-06-14
links:
  clickup:
  github:
---

# Intake — wf-pilot-002

## Ticket Reference

wf-pilot-002 — second Engineering Workflow v1 pilot. **Started manually** (there
is no ClickUp intake yet — this ticket builds it), per the bootstrap exception.

## Ticket Summary

Add optional, read-only ClickUp intake to `/start-ticket`: given a ClickUp task
ID, fetch the task's title, description, and URL and use them to populate a new
workflow workspace (`ticket.md` + `intake.md`). One-way, read-only; `ticket.md`
remains the canonical workflow state owner.

## Ticket Metadata

- id / slug: wf-pilot-002
- title: Add read-only ClickUp intake support to /start-ticket
- owner: developer
- created: 2026-06-14
- links: (none — bootstrap; no ClickUp source for this ticket)

## User Story

> As a developer, I want to start a workflow ticket from an existing ClickUp task
> by ID, so that title/description/link are carried in automatically instead of
> being retyped.

## Acceptance Criteria Presence Check

- Present? no — defined in `spec.md`.

## Test Cases Presence Check

- Present? no — defined in `spec.md` / executed in `verify.md`.

## Missing Information

- None blocking. Design is fixed (Option C: direct REST, read-only; see prior
  ClickUp integration design). A test ClickUp task ID + token will be needed at
  verify time.

## Readiness Status

`READY`

- Justification: Scope, constraints, and design approach are confirmed; small,
  reversible, standard-mode change.
