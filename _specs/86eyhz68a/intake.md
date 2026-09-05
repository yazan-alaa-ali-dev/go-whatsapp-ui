---
ticket: 86eyhz68a
stage: intake
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-09
links:
  clickup: https://app.clickup.com/t/86eyhz68a
  github:
---

# Intake — 86eyhz68a

> First stage. Qualify the request only. **No technical planning allowed.**

## Ticket Reference

`86eyhz68a` — ClickUp: <https://app.clickup.com/t/86eyhz68a>
(list `whatsapp`, team `90182746553`). Item 4 of 4 in the debug-mode chain
derived from `docs/debug_mode_integration.html` (بند ٥, as revised by the owner
decision recorded there).

## Ticket Summary

Debug mode has a storage half (2/4) and a display half (3/4), but no way to turn
it on. The activation contract has been agreed since `docs/debug_mode.html` §1 —
`POST /debug/toggle` on `omni_agent`, authenticated with the webhook key — and
was never carried into the integration plan. This ticket implements the gateway
side of it: one thin proxy route, and an Enable/Disable control on the contact
row of the conversations screen, so an admin can diagnose one conversation on
demand without touching any other customer.

## Ticket Metadata

- id / slug: `86eyhz68a`
- title: Debug mode 4/4 — Enable debug mode per contact from the dashboard using
  the webhook key
- owner: developer
- created: 2026-08-09
- links: ClickUp `86eyhz68a`; chain siblings `86eyhz678` (1/4, shipped),
  `86eyhz67r` (2/4, stores `metadataDebug`), `86eyhz682` (3/4, displays it);
  related `86eyf1u2n` (tenant-scoped admin authorization)

## User Story

> As an ADMIN operating a tenant's conversations, I want to be able to turn
> `omni_agent`'s debug mode on or off for one specific contact with a button in
> the dashboard, so that I can diagnose a single conversation on demand, without
> touching any other customer and without leaving debug mode on forever.

## Acceptance Criteria Presence Check

- Present? **yes**
- Notes: 38 criteria across six groups (Scope & Tenant Safety, Authorization,
  the toggle route, the control in the UI, Validation & Constraints, UI & API
  Consistency, Audit & Logging). Each is observable from outside the
  implementation; each is testable without `omni_agent` being reachable.

## Test Cases Presence Check

- Present? **yes**
- Notes: twelve Given/When/Then cases — enable from the conversations screen;
  the literal off command; omitted TTL; one contact does not affect another; the
  diagnostic field starts arriving; no state stored or restored; a plaintext
  channel refused; a number with no secret; the key never exposed; an upstream
  failure not reported as success; a malformed request; another tenant's
  contact; an unauthenticated request.

## Missing Information

- **Where `omni_agent` lives.** The ACs write the destination as
  `{OMNI_AGENT_URL}/debug/toggle`, but no such setting exists in the repository
  and the ACs also forbid modifying a deployment runtime file — so a *required*
  new environment variable could not be deployed. Resolved at `/plan`.
- **The HTTP code for an unauthenticated request.** The ACs and TC-12 ask for
  `403`; the shared admin middleware the same ACs require this route to reuse
  answers `401` for absent credentials, and ticket 3/4 decided to keep `401`
  for its read route. Resolved at `/plan`.
- **How the UI learns a number has no webhook secret** before the operator
  clicks, given that AC-33 allows only one new route. Resolved at `/plan`.
- Nothing else. The credential decision (webhook key, no `debugApiKey`) is
  already settled in the ticket and in `docs/debug_mode_integration.html` §5.

## Readiness Status

`READY`

- Justification: the request carries a user story, a fixed upstream contract
  quoted literally, unambiguous acceptance criteria with executable test cases,
  named files (`models/WhatsAppNumber.js:52`, `:66-73`,
  `services/agentWebhookService.js:123-127`, `:357`, `routes/agent.js:101`), and
  an explicit out-of-scope list. The three open points above are interpretation
  calls inside the stated scope, not missing requirements; all three are decided
  in `plan.md` and recorded there.
