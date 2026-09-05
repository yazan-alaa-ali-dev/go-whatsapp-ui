---
ticket: z8pmx9kzc8
title: 17 · Carry account_id and transport in the outbound webhook
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-08-25
updated_at: 2026-08-25
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzc8"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-web-multidevice/pull/15"
---

# Ticket: 17 · Carry account_id and transport in the outbound webhook

> **This file is the single canonical record of the ticket's workflow state.**

## Delivery note — staged workflow not used

At the owner's explicit instruction this ticket is **not** run through the seven
staged workflow commands. It is implemented directly, with one substitution the
owner asked for: the advisory review panel (`senior-reviewer`,
`security-reviewer`, `performance-reviewer` — the lenses `/review` dispatches)
reviews the plan **before** any code is written, and every finding is answered in
`plan.md > Panel response`.

Consequently `intake.md`, `research.md`, `review.md` and `comprehension.md` do
not exist; `spec.md`, `plan.md`, `implement.md` and `verify.md` are authored
directly as the record of what was specified, decided, changed and validated.

This mirrors the delivery shape of tickets `cu-z8pmx9kcvh` (14) and `z8pmx9kzc7`
(16), at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9kzc8>
- Execution order: 17 of 20 · depends on 16 · blocks 18
- Reference: `gowa-accounts-devices-scope-ar.html` rev 2 §03 — ticket **T2**
- Branch: `ticket/z8pmx9kzc8`, cut from `ticket/z8pmx9kzc7` — the tip carrying the
  account layer (migrations 51–61, `DeviceRecord.GowaAccountID`/`Transport`, the
  accounts API). The PR therefore targets that branch, not `main`.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-08-25 | draft | ai_agent | Ticket workspace created from the ClickUp task. |
| 2026-08-25 | spec-complete | ai_agent | `spec.md` authored directly (10 acceptance criteria, 5 functional and 4 non-functional requirements, 4 constraints). |
| 2026-08-25 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed by the advisory panel (senior / security / performance) before any code was written. |
| 2026-08-25 | spec-complete | ai_agent | `plan.md` revised: 23 of 30 panel findings adopted, 3 declined with reasons, 2 corrected — see `plan.md > Panel response`. **All three lenses independently found the same defect**, and it was the point of the ticket: revision 1 kept the "has a usable `webhook_url`" gate on a function that now returns the row, so `account_id` would have been `""` for every device on the global `WHATSAPP_WEBHOOK` fallback — the majority deployment. Row resolution and webhook projection became two functions answering two different questions. Two claims were corrected against the code: the forward path does **not** run on the whatsmeow event thread (it is a detached per-event goroutine), and signing does **not** remove replay (the signature covers the body alone, with no timestamp or nonce). Revision 1's byte-comparison test could not have passed — `json.Marshal` sorts map keys. |
| 2026-08-25 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9kzc8`; one new file, eleven modified. Five plan deviations recorded in `implement.md`, including the owner's override of the panel's agent fail-closed rule: signing is off deliberately as a testing configuration, so the two fields are sent regardless. |
| 2026-08-25 | verified | ai_agent | `verify.md`: all 10 acceptance criteria mapped to results. The full suite runs against **real PostgreSQL 16** as well as SQLite with an identical outcome on both: one pre-existing failure (`TestResolveDocumentMIME`, measured on this branch before any change), nothing new. `-race` could not run — it requires cgo and this host has no C toolchain — so AC-7's ordering is proved deterministically instead: the webhook delivery is synchronous and precedes the Chatwoot goroutine, so the keys being present at delivery means they were written before that goroutine existed. No deployment runtime file touched. |
