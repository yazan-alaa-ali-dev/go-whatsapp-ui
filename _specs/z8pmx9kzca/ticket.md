---
ticket: z8pmx9kzca
title: 19 · Fail over by priority inside a single account
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-08-27
updated_at: 2026-08-27
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzca"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-web-multidevice/pull/18"
---

# Ticket: 19 · Fail over by priority inside a single account

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

This mirrors the delivery shape of tickets `cu-z8pmx9kcvh` (14), `z8pmx9kzc7`
(16), `z8pmx9kzc8` (17) and `z8pmx9kzc9` (18), at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9kzca>
- Execution order: 19 of 20 · depends on 16, 17, 18 · blocks —
- Reference: `gowa-accounts-devices-scope-ar.html` rev 2 §05 — ticket **T4**
- Branch: `ticket/z8pmx9kzca`, cut from `ticket/z8pmx9kzc9` — the tip carrying the
  account layer, the webhook/agent account projection, and the reply-path
  transport gate. The PR therefore targets that branch, not `main`.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-08-27 | draft | ai_agent | Ticket workspace created from the ClickUp task. |
| 2026-08-27 | spec-complete | ai_agent | `spec.md` authored directly (22 acceptance criteria, 10 functional and 6 non-functional requirements, 7 constraints, 10 test cases). |
| 2026-08-27 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed by the advisory panel (senior / security / performance) **against the source**, before any code was written. |
| 2026-08-27 | spec-complete | ai_agent | `plan.md` revised: 28 of 40 panel findings adopted, 4 declined with reasons, 3 claims of revision 1 corrected — see `plan.md > Panel response`. Three of the four majors were raised independently by two or three lenses from different directions, and **all three lenses** rejected the same change (moving ticket 18's pre-flight refusal), which revision 1 had argued for on cost grounds while it inverted a ticket-18 acceptance test. The load-bearing correction came from answering them: revision 1's switch rule rested on "`ErrNotConnected` proves nothing was sent", and whatsmeow's source shows that sentinel is returned both before the frame is written and from the post-send reconnect retry — so revision 1 would have shipped the duplicate reply this ticket exists to prevent, and passed its own tests doing it. |
| 2026-08-27 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9kzca`; three new files, nine modified. Six plan deviations recorded in `implement.md`, two of them found by tests that failed for the right reason — a drift between the operator surface and the send path, and a per-attempt-budget test that its own mutation survived. |
| 2026-08-27 | verified | ai_agent | `verify.md`: all 24 acceptance criteria mapped to results. The full suite runs against **real PostgreSQL 16** as well as SQLite with an identical outcome on both: one pre-existing failure (`TestResolveDocumentMIME/Zip`, measured on the unmodified tree by stashing), nothing new. Because most of what this ticket adds is a *refusal* — and refusals pass tests by doing nothing — the three load-bearing guards were broken as **mutations** and shown to fail the suite, then reverted. AC-9 is recorded as satisfied by a cheaper design than the ticket's literal wording, with the lock arithmetic; AC-19 as satisfied by construction with nothing shipped for it; AC-22 as a recorded decision not to ship the index. The `-race` gap is recorded as real this time, since the change does add shared mutable state. No deployment runtime file touched, no migration appended. |
