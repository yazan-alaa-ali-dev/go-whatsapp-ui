---
ticket: 86eyg6x90
stage: intake
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-02
links:
  clickup: https://app.clickup.com/t/86eyg6x90
  github:
---

# Intake — 86eyg6x90

> First stage. Qualify the request only. **No technical planning allowed.**

## Ticket Reference

ClickUp task `86eyg6x90` — https://app.clickup.com/t/86eyg6x90
Seeded read-only via `scripts/clickup_intake.py 86eyg6x90`. The ClickUp task was
rewritten to the standard shape in `docs/Ticket-Structure-Guide (6).md` before
this intake, so its body now carries a User Story, grouped Acceptance Criteria,
and Given/When/Then Test Cases.

## Ticket Summary

Message history fails to load on the admin dashboard's contacts page. The
endpoint returns `Failed to fetch message history` with
`TypeError: Cannot read properties of undefined (reading 'waitForChatLoading')`
raised inside WhatsApp Web during `chat.fetchMessages`. Exactly one chat loads
successfully; all others fail. Separately, the messages that do render appear in
reverse conversation order on the contacts page. Both defects sit on the same
flow — the contacts page and the `POST /admin/get-messages` endpoint it calls —
and the ticket asks for both to be fixed.

## Ticket Metadata

- id / slug: 86eyg6x90
- title: Fix message-history fetch failure and reversed message order on the contacts dashboard
- owner: developer
- created: 2026-08-02
- links: clickup — https://app.clickup.com/t/86eyg6x90

## User Story

> As **an ADMIN (System Admin)**, I want to be able to **open any contact on the
> dashboard and read that chat's message history in correct chronological
> order**, so that **I can review a customer conversation without the request
> failing and without reading the conversation backwards**.

## Acceptance Criteria Presence Check

- Present? **yes**
- Notes: the ClickUp body groups them into named sub-sections with numbered,
  atomic items — Scope & Tenant Safety, Authorization, General Behavior (message
  history retrieval), Message Ordering (UI & API consistency), Error Handling &
  Resilience, Validation & Constraints, Audit & Logging. They are the *source*
  for `/spec`; stable `AC-n` ids are assigned there (TR-1), not here.

## Test Cases Presence Check

- Present? **yes**
- Notes: nine Given/When/Then scenarios covering the happy paths (chat below the
  limit, chat at/above the limit, the reported failing chat, every contact in the
  list), ordering (chronological render, API↔UI agreement), the error path
  (structured error, session survives), authorization failure, input validation,
  and cross-session isolation.

## Missing Information

Nothing blocking. Open items to resolve during `/research`, not before:

- Which chat currently succeeds and what distinguishes it — the leading
  hypothesis (recorded in the ClickUp body as an investigation note) is that it
  already holds ≥ `limit` messages in memory, so the failing WhatsApp-Web call is
  never reached. To be confirmed, not assumed.
- Whether the failure reproduces on a fresh session or only on the reported one,
  and on which environment (staging vs production container).

Scope note: the ticket carries two defects. They are kept in one ticket because
they are one user-visible outcome on one surface — "the contacts page shows the
conversation correctly" — and share the same request flow. If `/research` shows
the two fixes touch disjoint areas with independent risk, split the ordering fix
into its own ticket at `/plan`.

## Readiness Status

`READY`

- Justification: the request has a clear single outcome, a named actor, an
  identified surface (`public/contacts.html` + `POST /admin/get-messages`), a
  concrete reproduction (`waNumberId: 69959da0491781ef06b06511`,
  `number: 184911830995037@lid`, `limit: 30`), captured error evidence, testable
  acceptance criteria, and Given/When/Then test cases. No hard-stop condition
  applies: no deployment runtime file is implicated, and no acceptance criterion
  is ambiguous or untestable. Ready for read-only investigation at `/research`.
