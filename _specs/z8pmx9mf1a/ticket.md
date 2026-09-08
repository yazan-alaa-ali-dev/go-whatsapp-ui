---
ticket: z8pmx9mf1a
title: 10 · Build the users administration surface — creation, editing, roles and the credential reset
mode: standard
state: closed
status: active
owner: developer
created_at: 2026-09-08
updated_at: 2026-09-08
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf1a"
  github: ""
---

# Ticket: 10 · Build the users administration surface

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
`z8pmx9mf19` (9), at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9mf1a>
- Execution order: **5 of phase 2**. Depends on `z8pmx9mf16` (which typed all six
  `/auth/users` calls and added `usersKey`) and on `z8pmx9mf17` (which routed and
  guarded `/users` behind `users.manage`), and it becomes the second tab of the
  account detail screen `z8pmx9mf18`/`z8pmx9mf19` built — so the branch is cut
  from `ticket/z8pmx9mf19` rather than from `main`. The pull request targets
  `main`.
- References:
  - `docs/gowa-phase2-accounts-rbac-study-ar.html` — §10 (the admin user object,
    the "exactly one" account rule, the meaning of an absent field, the warning
    that must precede every save, the three rejections, the reset, the list),
    §13 (the three rules the codebase enforces), §14 (`Q-2` no roles endpoint,
    `Q-3` no `account_id` filter and no total).
  - `docs/gowa-frontend-reference-ar.html` — §07 (the six endpoints, the create
    body, the partial update, the special rejections, the admin user object).
- **This ticket adds no wire calls.** All six were typed in `z8pmx9mf16`;
  `src/api/users.ts` is untouched. What it adds is the screen and — the larger
  half — the decisions, in `src/lib/user-admin.ts`.
- **`src/lib/auth-messages.ts` is untouched**, which the first draft of the plan
  did not intend. See `plan.md > Panel response`, S5.

## State history

| # | When | From → To | By | Note |
|---|---|---|---|---|
| 1 | 2026-09-08 | — → `draft` | developer | Workspace created from the ClickUp task. |
| 2 | 2026-09-08 | `draft` → `spec-complete` | developer | `spec.md` authored: 34 requirements, 30 acceptance criteria, 17 test cases. |
| 3 | 2026-09-08 | `spec-complete` → `plan-complete` | developer | `plan.md` revision 1 authored and submitted to the advisory panel before any code was written. |
| 4 | 2026-09-08 | `plan-complete` → `approved` | developer | Panel returned 28 findings across three lenses; three were raised independently by two lenses. Revision 2 answers every one — 17 changed the design, 4 were made moot by another change, 3 added acceptance criteria (`AC-31` password redaction, `AC-32` bidi sanitisation, `AC-33` raw id in destructive confirmations) and `NFR-7`. Two findings were the difference between a correct implementation and a defective one: `SEC1` (a password reaching the screen through the server's own rejection text) and `S5` (amending shared rejection notices would have broken pinned tests and left a dangling promise on another surface). |
| 5 | 2026-09-08 | `approved` → `implementation-in-progress` | developer | Branch `ticket/z8pmx9mf1a` cut from `ticket/z8pmx9mf19`. |
| 6 | 2026-09-08 | `implementation-in-progress` → `implemented` | developer | 8 files added, 4 edited; 583 tests pass (baseline 508). Five deviations recorded in `implement.md` — including two real violations the new bidi rule caught in this ticket's own code, an hour after it was written. |
| 7 | 2026-09-08 | `implemented` → `verified` | developer | Verification PASSED: all 33 ACs mapped to a result; typecheck, lint, tests and build green; no deployment runtime file changed. |
| 8 | 2026-09-08 | `verified` → `closed` | developer | Verification PASSED. Terminal. |
