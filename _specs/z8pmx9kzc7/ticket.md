---
ticket: z8pmx9kzc7
title: 16 · Add the account layer above devices
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-08-25
updated_at: 2026-08-25
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzc7"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-web-multidevice/pull/12"
---

# Ticket: 16 · Add the account layer above devices

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

This mirrors the delivery shape of ticket `cu-z8pmx9kcvh` (14 · Migrate chat
storage to PostgreSQL), at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9kzc7>
- Execution order: 16 of 20 · depends on — · blocks 17, 18, 19, 20
- Reference: `gowa-accounts-devices-scope-ar.html` rev 2 §01, §02, §07 — ticket **T1**
- Branch: `ticket/z8pmx9kzc7`, cut from `ticket/cu-z8pmx9kcvh` — the tip carrying
  the PostgreSQL port (migrations 1–50, the rebinding handle, `runMigrationsAtomically`).
  The PR therefore targets that branch, not `main`.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-08-25 | draft | ai_agent | Ticket workspace created from the ClickUp task. |
| 2026-08-25 | spec-complete | ai_agent | `spec.md` authored directly (26 acceptance criteria, 8 functional and 4 non-functional requirements, 4 constraints). |
| 2026-08-25 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed by the advisory panel (senior / security / performance) before any code was written. |
| 2026-08-25 | spec-complete | ai_agent | `plan.md` revised: 25 of 30 panel findings adopted, 4 declined with reasons, 1 corrected — see `plan.md > Panel response`. Four of the majors changed the design before code: the token resolver was re-shaped to take an ACCOUNT ID rather than a caller-supplied reference (so the allowlist cannot be bypassed at resolve time); the allowlist PREFIX itself became validated, since a configured prefix of `D` reaches `DB_URI`; every repository method now refuses a blank account id, because `''` addresses the whole un-accounted fleet rather than nothing; and the five copied auth guards became one middleware on a path-scoped group. The performance lens's claim that `GetDeviceRecordByJID` has no production callers was corrected against the code — it is reached per forwarded event. `spec.md` gained NFR-5: an account is a grouping within one trust domain, not an authorization boundary. |
| 2026-08-25 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9kzc7`; eleven new files, ten modified. Six plan deviations recorded in `implement.md`. |
| 2026-08-25 | verified | ai_agent | `verify.md`: all 26 acceptance criteria mapped to results. The full suite runs against **real PostgreSQL 16** as well as SQLite with an identical outcome on both: one pre-existing failure (`TestResolveDocumentMIME`), nothing new. A pre-existing database is rolled back to version 50 and upgraded to 61 with its rows intact, on both engines — on PostgreSQL through the single-transaction batch path a real boot takes. No deployment runtime file touched. |
