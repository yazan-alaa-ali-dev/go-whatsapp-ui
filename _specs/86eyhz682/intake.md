---
ticket: 86eyhz682
stage: intake
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-09
links:
  clickup: https://app.clickup.com/t/86eyhz682
  github:
---

# Intake — 86eyhz682

> First stage. Qualify the request only. **No technical planning allowed.**

## Ticket Reference

`86eyhz682` — ClickUp: <https://app.clickup.com/t/86eyhz682>
(list `whatsapp`, team `90182746553`). Item 3 of 4 in the debug-mode chain
derived from `docs/debug_mode_integration.html` (بند ٢ + بند ٣).

## Ticket Summary

The contacts dashboard reads every conversation live from WhatsApp through
Puppeteer, which costs seconds per open, offers no paging control, and fails
outright while the session is disconnected. This ticket adds a read endpoint
that serves one conversation from MongoDB, makes that the dashboard's default
path, keeps the existing live read as an on-demand fallback for history that
predates the gateway, and surfaces the per-message diagnostics recorded by
ticket 2/4 behind a 🔎 badge.

## Ticket Metadata

- id / slug: `86eyhz682`
- title: Debug mode 3/4 — Read dashboard conversations from MongoDB with a
  WhatsApp fallback and a diagnostics badge
- owner: developer
- created: 2026-08-09
- links: ClickUp `86eyhz682`; predecessor `86eyhz67r` (2/4); related
  `86eyg6x90` (live-path failure-cause classification), `86eyf1u2n`
  (tenant-scoped admin authorization), `86eye6ezn` (media offload),
  `86eyhz68a` (4/4, the per-contact Enable/Disable control)

## User Story

> As an ADMIN operating the contacts dashboard for a tenant, I want to read a
> conversation from MongoDB by default, with a WhatsApp fetch available on
> demand and a diagnostics badge on messages that carry one, so that
> conversations open in milliseconds, keep working while the WhatsApp session is
> down, and expose the AI agent's reasoning without a separate lookup.

## Acceptance Criteria Presence Check

- Present? **yes**
- Notes: 36 criteria across six groups (Scope & Tenant Safety, Authorization,
  the read endpoint, the hybrid screen, diagnostics display, Validation &
  Constraints, UI & API Consistency, Audit & Logging). All are observable from
  outside the implementation; each is testable.

## Test Cases Presence Check

- Present? **yes**
- Notes: nine Given/When/Then cases — conversation opens from MongoDB; opens
  while disconnected; old history on demand; badge only where diagnostics exist;
  truncated payload; cross-tenant refusal; unauthenticated refusal; invalid page
  size clamped; empty conversation is not an error.

## Missing Information

- **Which WhatsApp number a conversation belongs to.** The route named in the
  ticket (`GET /api/admin/conversations/:chatId/messages`) carries no number,
  while the ACs require every query to be filtered on `waNumberId`, and today's
  admin token carries no tenant or number claim at all. Resolved at `/plan`.
- **The HTTP code for an unauthenticated request.** The ACs ask for `403`; the
  shared admin middleware that the same ACs require this endpoint to reuse
  answers `401` for absent credentials. Resolved at `/plan`.
- Nothing else. The dependency on 2/4 is stated in the ticket and satisfied.

## Readiness Status

`READY`

- Justification: the request has a user story, unambiguous acceptance criteria
  with executable test cases, a named endpoint, a named file (`contacts.html`),
  a named function (`formatMessageRecord`), and an explicit out-of-scope list.
  The two open points above are interpretation calls inside the stated scope,
  not missing requirements; both are decided in `plan.md` and recorded there.
