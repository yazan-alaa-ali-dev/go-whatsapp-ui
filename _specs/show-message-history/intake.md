---
ticket: show-message-history
stage: intake
mode: standard # single workflow form — no other modes (ADR-009)
status: in_progress # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-07-29
links:
  clickup: https://app.clickup.com/t/86eyekrvm
  github:
---

# Intake — show-message-history

> First stage. Qualify the request only. **No technical planning allowed.**

## Ticket Reference

- slug: `show-message-history`
- ClickUp task: https://app.clickup.com/t/86eyekrvm ("show message history")
- Repo source of truth named by the ticket: `docs/TICKET-show-message-history.md`
- Technical grounding stated by the ticket: branch `add-bot-for-createOrUpdate-shipment`, commit `94b2fb8`

## Ticket Summary

Replies that the gateway relays back to a customer from the AI agent's webhook
response are today invisible — they are never persisted, their send result is
discarded, and WhatsApp delivery acknowledgements are never observed. The request
is to make that reply path visible to an ADMIN: persist each relayed reply,
track its delivery state, expose it through the admin messages API, and add a
Message History view to the dashboard.

Full requirement text (properties, acceptance criteria, and test cases) lives in
the ClickUp task and in `docs/TICKET-show-message-history.md`; it is not
duplicated here.

## Ticket Metadata

- id / slug: `show-message-history`
- title: show message history
- owner: developer
- created: 2026-07-29
- links: clickup — https://app.clickup.com/t/86eyekrvm ; github — (none yet)
- backbone (ClickUp): Session/Thread/Message
- actor (ClickUp): ADMIN, SYSTEM
- tenant scope: all tenants (multi-tenant feature)

## User Story

> As an ADMIN of the WhatsApp gateway, I want a Message History screen listing
> every reply the gateway sent back from the AI agent's webhook response — with
> the recipient, the content, whether the send succeeded or failed and why, and
> the WhatsApp delivery state (sent / delivered / read) — so that I can prove to
> a tenant whether their customer received and read the bot's answer, and
> diagnose a silent delivery failure without reading server logs.

## Acceptance Criteria Presence Check

- Present yes
- Notes:

## Test Cases Presence Check

- Present yes
- Notes:

## Missing Information

## Readiness Status

READY

- Justification:
