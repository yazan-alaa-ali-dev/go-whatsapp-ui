---
ticket: z8pmx9mf17
title: 7 · Derive navigation and the home surface from permissions
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-09-07
updated_at: 2026-09-07
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf17"
  github: ""
---

# Ticket: 7 · Derive navigation and the home surface from permissions

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
`z8pmx9mf16` (6), at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9mf17>
- Execution order: **2 of phase 2**. Depends on `z8pmx9mf16` (the account scope
  store and the accounts/users API layer) — this ticket is that store's first
  UI consumer, and the branch is cut from `ticket/z8pmx9mf16` rather than from
  `main` for that reason. **Blocks** tickets 8, 9 and 10: they build the screens
  behind the routes this ticket opens.
- References:
  - `docs/gowa-phase2-accounts-rbac-study-ar.html` — §05 (the permission →
    surface map, and the `.manage` / `.manage.all` distinction), §06 (the route
    model, the three houses, and the account context bar), §13 (the three
    codebase rules this phase collides with).
  - `docs/gowa-frontend-reference-ar.html` — §04 (the permission catalogue and
    the golden rule), §11 (the common traps, including "hide the button rather
    than let it be rejected").
- **This is the ticket where the source-policy collision of study §13 is
  settled** — once, rather than in every ticket after it.

## State history

| # | When | From → To | By | Note |
|---|---|---|---|---|
| 1 | 2026-09-07 | — → `draft` | developer | Workspace created from the ClickUp task. |
| 2 | 2026-09-07 | `draft` → `spec-complete` | developer | `spec.md` authored: 22 acceptance criteria, 14 test cases. |
| 3 | 2026-09-07 | `spec-complete` → `plan-complete` | developer | `plan.md` revision 1 authored and submitted to the advisory panel. |
| 4 | 2026-09-07 | `plan-complete` → `approved` | developer | Panel reported 26 findings across three lenses; two lenses independently found the same URL scope hole. Revision 2 answers every finding; `spec.md` gained `AC-12a` and `AC-15a` as a result. |
| 5 | 2026-09-07 | `approved` → `implemented` | developer | 13 files added, 4 edited; 407 tests pass (baseline 357). |
| 6 | 2026-09-07 | `implemented` → `verified` | developer | `ui-source` + `ui-build` green; all 22 ACs mapped; 29 mutations killed (2 by the compiler), 3 controls behaved. |
