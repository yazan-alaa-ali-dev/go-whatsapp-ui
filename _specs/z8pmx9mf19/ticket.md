---
ticket: z8pmx9mf19
title: 9 · Build the account devices surface — membership, reply order, send state and webhooks
mode: standard
state: closed
status: active
owner: developer
created_at: 2026-09-08
updated_at: 2026-09-08
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf19"
  github: ""
---

# Ticket: 9 · Build the account devices surface

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
`z8pmx9mf18` (8), at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9mf19>
- Execution order: **4 of phase 2**. Depends on `z8pmx9mf16` (the accounts API
  layer, which already types all nine account calls) and on `z8pmx9mf18` (the
  account detail screen this surface becomes a tab of), so the branch is cut
  from `ticket/z8pmx9mf18` rather than from `main`. Tickets 10 (users tab) and
  11 (the SMS fallback switch) build the remaining tabs behind the same shell.
- References:
  - `docs/gowa-phase2-accounts-rbac-study-ar.html` — §08 (the two sources and
    the left join, the order endpoint, the closed send-state list, the three
    creation endpoints), §14 (`Q-1` whether `POST /devices` attaches, `Q-6` no
    detach endpoint, `Q-8` `fallback_allowed` optional).
  - `docs/gowa-frontend-reference-ar.html` — §05 (the account device object),
    §06 (device endpoints, the `404` that never says "permission"), and the
    OpenAPI text for `GET/PATCH /devices/{id}/webhook` and
    `PATCH /devices/{id}/webhook/enabled`.
- **This ticket adds the first wire calls of phase 2 that are not already typed.**
  `PATCH /devices/{id}/webhook/enabled` has no client at all, and
  `GET /devices/{id}/webhook` is typed without the `webhook_enabled` field the
  reference documents on it. Both are added here.

## State history

| # | When | From → To | By | Note |
|---|---|---|---|---|
| 1 | 2026-09-08 | — → `draft` | developer | Workspace created from the ClickUp task. |
| 2 | 2026-09-08 | `draft` → `spec-complete` | developer | `spec.md` authored: 33 requirements, 34 acceptance criteria, 16 test cases. |
| 3 | 2026-09-08 | `spec-complete` → `plan-complete` | developer | `plan.md` revision 1 authored and submitted to the advisory panel. |
| 4 | 2026-09-08 | `plan-complete` → `approved` | developer | Panel reported 26 findings across three lenses; five were raised independently by two lenses. Revision 2 answers every finding; 12 changed the design, 4 were made moot by a design change, and 2 changed `spec.md` (`AC-17`/`AC-18` keep `POST /devices` on the device dashboard, `AC-23` narrowed to the `404` oracle; `AC-17a`, `AC-35`, `AC-36`, `AC-37` added). |
| 5 | 2026-09-08 | `approved` → `implementation-in-progress` | developer | Branch `ticket/z8pmx9mf19` cut from `ticket/z8pmx9mf18`. |
| 6 | 2026-09-08 | `implementation-in-progress` → `implemented` | developer | 9 files added, 9 edited; 508 tests pass (baseline 451). Four deviations recorded in `implement.md`. |
| 7 | 2026-09-08 | `implemented` → `verified` | developer | `ui-source` + `ui-build` green; all 38 ACs mapped to a result; 26 mutants introduced and killed — three only after a corrupted rule that could never match was found and rewritten. |
| 8 | 2026-09-08 | `verified` → `closed` | developer | Verification PASSED. Terminal. |
