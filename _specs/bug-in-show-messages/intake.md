---
ticket: bug-in-show-messages
stage: intake
mode: standard # single workflow form — no other modes (ADR-009)
status: in_progress # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-01
links:
  clickup: https://app.clickup.com/t/86eyeknvp
  github:
---

# Intake — bug-in-show-messages

> First stage. Qualify the request only. **No technical planning allowed.**

## Ticket Reference

- Slug: `bug-in-show-messages`
- ClickUp task: [86eyeknvp — "bug in show messages"](https://app.clickup.com/t/90182746553/86eyeknvp)
  (list `whatsapp` `901818435079`); the task description carries the full ticket
  body (properties, user story, acceptance criteria, test cases, evidence) and two
  screenshots of the failure.
- Repo copy of that ticket body: `docs/TICKET-bug-in-show-messages.md`
  (drafted per `docs/Ticket-Structure-Guide (6).md`).

## Ticket Summary

The dashboard's Contacts & Messages screen (`contacts.html?waNumberId=<id>`) cannot
show contacts or their messages: the contacts request answers **500 Internal Server
Error**, the list pane shows "Error: Failed to fetch contacts" and the header stays
on "Loading…", so no conversation can be opened. The server log reports
`Error fetching contacts: r: r` thrown out of `client.getChats()` — raised inside
Puppeteer's `page.evaluate`, i.e. inside whatsapp-web.js's injected browser-side
code — and surfacing at the contacts route.

> The ClickUp description holds the full request (10,377 characters); it is
> referenced above rather than duplicated here, per the template's "one or two
> sentences" rule.

## Ticket Metadata

- id / slug: `bug-in-show-messages`
- title: `bug in show messages` (ClickUp task name; the action-oriented title used
  in the ticket body is _"Fix the Contacts & Messages screen failing to load
  contacts"_)
- owner: `developer`
- created: 2026-08-01
- links:
  - clickup: https://app.clickup.com/t/86eyeknvp
  - github: _(not published yet — set by `/publish-pr`)_

## User Story

> As **an ADMIN of the WhatsApp gateway**, I want to be able to **open the Contacts
> & Messages screen for a connected WhatsApp number, see the contact list load, and
> read the message history of the contact I select**, so that **I can check what a
> customer actually sent and received without opening WhatsApp on the phone or
> reading server logs**.

## Acceptance Criteria Presence Check

- Present yes
- Notes:

## Test Cases Presence Check

- Present yes
- Notes:

## Missing Information

## Readiness Status

ready

- Justification:
