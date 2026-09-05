---
ticket: z8pmx9kzc9
title: 18 · Resolve the account and enforce the transport check on the reply path
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-08-25
updated_at: 2026-08-25
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzc9"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-web-multidevice/pull/17"
---

# Ticket: 18 · Resolve the account and enforce the transport check on the reply path

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
(16) and `z8pmx9kzc8` (17), at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9kzc9>
- Execution order: 18 of 20 · depends on 16, 17 · blocks 19
- Reference: `gowa-accounts-devices-scope-ar.html` rev 2 §04 rule 01/02 — ticket **T3**
- Branch: `ticket/z8pmx9kzc9`, cut from `ticket/z8pmx9kzc8` — the tip carrying the
  account layer (migrations 51–61, `DeviceRecord.GowaAccountID`/`Transport`) and
  the webhook/agent account projection. The PR therefore targets that branch, not
  `main`.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-08-25 | draft | ai_agent | Ticket workspace created from the ClickUp task. |
| 2026-08-25 | spec-complete | ai_agent | `spec.md` authored directly (12 acceptance criteria, 8 functional and 5 non-functional requirements, 5 constraints, 9 test cases). |
| 2026-08-25 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed by the advisory panel (senior / security / performance) **against the source**, before any code was written. |
| 2026-08-25 | spec-complete | ai_agent | `plan.md` revised: 19 of 31 panel findings adopted, 2 declined with reasons, 3 claims of revision 1 corrected — see `plan.md > Panel response`. **Two lenses independently found the same structural defect from opposite directions** (security via trust boundaries, performance via the cost of a re-read): revision 1 put `AccountID`/`Transport` on the delivery args as flat fields beside `Client`, so ticket 19 would swap the client to a sibling and the gate would validate one device while sending on another. Revision 1 would have passed its own tests and shipped a gate that disarms itself one ticket later. Three corrections: a nil whatsmeow client returns `ErrClientIsNil` rather than panicking (so revision 1's TC-1 test could not tell a working gate from a broken one); the ticket's TC-5 — "no read is performed at all" — is false, since the row read precedes the agent call; and the "green path is 1 read" figure is a pair, 1 or 2, whose second read is invisible to the seam revision 1 proposed to count with. |
| 2026-08-25 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9kzc9`; one new file, two modified. Five plan deviations recorded in `implement.md`. The baseline was measured on the unmodified tree before the first edit with a throwaway test file, which was then deleted. |
| 2026-08-25 | verified | ai_agent | `verify.md`: all 12 acceptance criteria mapped to results. The full suite runs against **real PostgreSQL 16** as well as SQLite with an identical outcome on both: one pre-existing failure (`TestResolveDocumentMIME`, measured on this branch before any change), nothing new. Because the gate is unreachable in production today (no API can write `transport = 'meta_cloud'`), a green test proves less than usual — so both plausible breakages were introduced deliberately as **mutations** and shown to fail the suite, then reverted. AC-6 passes on its send half and on the realizable population of its UI half, and carries an explicitly **stated limit** for a hand-edited row holding both a live whatsmeow session and `meta_cloud`; the test originally planned for it was a tautology and was dropped rather than recorded as a false pass. No deployment runtime file touched. |
