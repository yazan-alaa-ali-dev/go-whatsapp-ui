---
ticket: z8pmx9mf18
title: 8 · Build the accounts list and the account lifecycle
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-09-07
updated_at: 2026-09-07
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf18"
  github: ""
---

# Ticket: 8 · Build the accounts list and the account lifecycle

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
`z8pmx9mf17` (7), at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9mf18>
- Execution order: **3 of phase 2**. Depends on `z8pmx9mf16` (the accounts API
  layer and the account scope store) and on `z8pmx9mf17` (the routes this screen
  lives on), so the branch is cut from `ticket/z8pmx9mf17` rather than from
  `main`. **Blocks** nothing directly; tickets 9, 10 and 11 build the tabs and
  the switch behind the account detail route this ticket leaves in place.
- References:
  - `docs/gowa-phase2-accounts-rbac-study-ar.html` — §07 (the list, creation and
    the three properties of the delete that reshape the whole surface), §14
    (`Q-5` no single-account read and no name edit, `Q-7` no device count on the
    account object).
  - `docs/gowa-frontend-reference-ar.html` — §05 (the account object and the
    endpoint table), and the OpenAPI text for `POST /accounts` and
    `DELETE /accounts/{account_id}`.
- **This is the first ticket in phase 2 that destroys data.** Purging a device
  destroys its WhatsApp session keys and re-pairing needs physical access to the
  customer's phone. Every design decision below is downstream of that.

## State history

| # | When | From → To | By | Note |
|---|---|---|---|---|
| 1 | 2026-09-07 | — → `draft` | developer | Workspace created from the ClickUp task. |
| 2 | 2026-09-07 | `draft` → `spec-complete` | developer | `spec.md` authored: 21 requirements, 26 acceptance criteria, 14 test cases. |
| 3 | 2026-09-07 | `spec-complete` → `plan-complete` | developer | `plan.md` revision 1 authored and submitted to the advisory panel. |
| 4 | 2026-09-07 | `plan-complete` → `approved` | developer | Panel reported 30 findings across three lenses; two lenses independently found the same missing cache invalidation. Revision 2 answers every finding; 11 changed the design and 2 changed `spec.md` (`AC-13` confirms on the account id, `AC-21a`/`AC-21b` added). |
| 5 | 2026-09-07 | `approved` → `implemented` | developer | 5 files added, 8 edited; 451 tests pass (baseline 407). |
| 6 | 2026-09-07 | `implemented` → `verified` | developer | `ui-source` + `ui-build` green; all 26 ACs mapped; 16 mutations killed (1 after an added case), 3 controls behaved. |
