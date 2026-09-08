---
ticket: z8pmx9mf1b
title: 11 · Add account settings and wrap the operational screens in the account
mode: standard
state: closed
status: active
owner: developer
created_at: 2026-09-08
updated_at: 2026-09-08
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf1b"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-ui/pull/12"
---

# Ticket: 11 · Add account settings and wrap the operational screens in the account

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

This mirrors the delivery shape of tickets `z8pmx9md6x` (1) through
`z8pmx9mf1a` (10), at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9mf1b>
- Execution order: **6 of 6, the last ticket of phase 2**. Depends on
  `z8pmx9mf17` (the account lens, the home dispatcher and `mayEnterAccount`) and
  on `z8pmx9mf18`/`z8pmx9mf19` (the account detail screen the settings tab joins).
  The branch is cut from `ticket/z8pmx9mf1a` — the tip of the phase — and the
  pull request targets `main`.
- References:
  - `docs/gowa-phase2-accounts-rbac-study-ar.html` — §09 (the two switches, the
    copy that must not promise delivery, what the fallback does not cover, the
    `channel`-before-`message_id` rule), §11 (the ordinary user's experience: the
    four hidden controls, the context chip, the two empty states), §13 (the three
    rules the codebase enforces), §14 (`Q-4` no account name for a principal
    without `accounts.manage`).
  - `docs/gowa-frontend-reference-ar.html` — §05 (`sms_fallback_enabled` is
    always present), §08/§09 (`PATCH /accounts/{id}/sms-fallback`,
    `POST /send/message` and `SendMessageResponse.channel`), §11 (hide rather
    than disable).
- **This ticket adds one wire field and no new endpoint.**
  `setAccountSmsFallback` was typed in `z8pmx9mf16` and is called for the first
  time here; `SendMessageResponse.channel` is the single field added to
  `src/api/send.ts`.

## State history

| # | When | From → To | By | Note |
|---|---|---|---|---|
| 1 | 2026-09-08 | — → `draft` | developer | Workspace created from the ClickUp task. |
| 2 | 2026-09-08 | `draft` → `spec-complete` | developer | `spec.md` authored: 28 requirements, 35 acceptance criteria, 17 test cases. |
| 3 | 2026-09-08 | `spec-complete` → `plan-complete` | developer | `plan.md` revision 1 authored and submitted to the advisory panel before any code was written. |
| 4 | 2026-09-08 | `plan-complete` → `approved` | developer | The panel returned **35 findings** across three lenses. Fourteen changed the design, five were adopted as written, four were made moot by another change, and five were recorded without change. Three lenses independently found the same real bug — a successful `PATCH …/sms-fallback` leaving the switch showing a stale value, because nothing invalidated the five-minute `accountsKey()` cache. Two findings removed work rather than adding it: gating `/messaging` (which would have dragged `navigation.ts` with it) and gating the group participants panel (which would have half-gated a sheet of eight forms) were both cut as scope creep, taking a module, a test and two files with them. One security finding changed the shape of the code: `SendMessageResult` now **omits** `message_id` from the type, so the reference's "read `channel` before `message_id`" obligation is a compile error rather than a comment, and `deliveryChannel` fails safe on a channel it does not recognise. |
| 5 | 2026-09-08 | `approved` → `implementation-in-progress` | developer | Branch `ticket/z8pmx9mf1b` cut from `ticket/z8pmx9mf1a`. |
| 6 | 2026-09-08 | `implementation-in-progress` → `implemented` | developer | 6 files added, 11 edited — exactly the planned list; 636 tests pass (baseline 583). Five deviations recorded in `implement.md`, including a deliberate mutation run: four violations were injected to prove the new negative rules actually fire, and exactly those four failed. |
| 7 | 2026-09-08 | `implemented` → `verified` | developer | Verification PASSED: all 35 ACs and 17 TCs mapped to a result; typecheck, lint, tests and build green; no deployment runtime file changed. |
| 8 | 2026-09-08 | `verified` → `closed` | developer | Verification PASSED. Terminal — and the last ticket of phase 2. |
