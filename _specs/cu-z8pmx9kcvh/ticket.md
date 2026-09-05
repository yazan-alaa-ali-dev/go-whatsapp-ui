---
ticket: cu-z8pmx9kcvh
title: 14 · Migrate chat storage to PostgreSQL
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-08-22
updated_at: 2026-08-22
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcvh"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-web-multidevice/pull/11"
---

# Ticket: 14 · Migrate chat storage to PostgreSQL

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

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9kcvh>
- Execution order: 14 of 15 · depends on 03 · board origin `z8pmx9kbd2`
- Reference: `gowa-study-ar.html` §11 task 14, §12
- Branch: `ticket/cu-z8pmx9kcvh`, cut from `fix/stream-replaced-kills-process`
  — the current tip carrying migrations 48–50 (tickets 10 and 07), which `main`
  does not yet have. The PR therefore targets that branch, not `main`.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-08-22 | draft | ai_agent | Ticket workspace created from the ClickUp task. |
| 2026-08-22 | spec-complete | ai_agent | `spec.md` authored directly (19 acceptance criteria, 9 functional and 4 non-functional requirements, 4 constraints). |
| 2026-08-22 | spec-complete | ai_agent | `plan.md` authored, then reviewed by the advisory panel (senior / security / performance) before any code was written. |
| 2026-08-22 | spec-complete | ai_agent | `plan.md` revised: 31 panel findings adopted, 4 declined with reasons — see `plan.md > Panel response`. Five of the majors were design corrections verified against the code: an `INSERT … SELECT ?` that PostgreSQL cannot type; a `TIMESTAMP → TIMESTAMPTZ` rule that would have renamed the `timestamp` column of migration 2 and its index; `cobra.OnInitialize` booting the whole gateway in front of the data-copy subcommand; six `UPDATE`-then-`INSERT` upserts that race on a shared database; and AC-16 being unreachable because a schema-migration failure was non-fatal. `spec.md` was amended too: AC-18 is now scoped to ASCII, AC-16 is reworded, and AC-20 was added for concurrent-writer safety. |
| 2026-08-22 | implemented | ai_agent | Implementation applied on `ticket/cu-z8pmx9kcvh`; eleven new files, eight modified. Six plan deviations recorded in `implement.md`. |
| 2026-08-22 | verified | ai_agent | `verify.md`: all 20 acceptance criteria mapped to results. The full suite runs against **real PostgreSQL 16** as well as SQLite, with an identical outcome on both: one pre-existing failure (`TestResolveDocumentMIME/Zip`, reproduced at base commit a4526a7), nothing new. The PostgreSQL run found and fixed two real defects the SQLite suite passes cleanly. No deployment runtime file touched. |
