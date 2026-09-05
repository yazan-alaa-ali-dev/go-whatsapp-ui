---
ticket: z8pmx9m6ae
title: 22 · Identity foundation — users/roles/permissions schema, password hashing, permission catalogue and bootstrap admin
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-08-31
updated_at: 2026-08-31
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6ae"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-web-multidevice/pull/22"
---

# Ticket: 22 · Identity foundation — users/roles/permissions schema, password hashing, permission catalogue and bootstrap admin

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
(16), `z8pmx9kzc8` (17), `z8pmx9kzc9` (18) and `z8pmx9m57v` (21), at the owner's
request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9m6ae>
- Execution order: 22 of the auth/RBAC series · blocks 23, 24, 25, 26
- Reference: `gowa-auth-rbac-ar.html` rev 3 §02 (Model), §03 (Schema), §06 (Permissions)
- Branch: `ticket/z8pmx9m6ae`, cut from `ticket/z8pmx9m57v` — the tip carrying
  ticket 21 (the account owning its devices). The PR therefore targets that
  branch, not `main`.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-08-31 | draft | ai_agent | Ticket workspace created from the ClickUp task. |
| 2026-08-31 | spec-complete | ai_agent | `spec.md` authored directly: 12 acceptance criteria, 9 functional and 6 non-functional requirements, 5 constraints, 12 test cases. |
| 2026-08-31 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed by the advisory panel (senior / security / performance) **against the source**, before any code was written. 31 findings. |
| 2026-08-31 | spec-complete | ai_agent | `plan.md` revised. Six findings changed the design, four were declined with reasons, three revision-1 claims were corrected. **Two lenses independently rejected the same two things from opposite directions**: the `pkg/auth` seeder placement + narrow `SeedStore` port (senior: `pkg/` holds leaf helpers and every consumer already takes the full interface; and revision 1's cycle rationale was simply false — `pkg/utils` already imports `domains/chatstorage`), and the refresh-token method set (senior: ticket-23 scope the spec excludes; security: the sketched pair **cannot express atomic rotation**, so a stolen token would be indistinguishable from the legitimate one). The performance lens found the seeder as planned was ~122 network round-trips and 61 commits **on every boot**, plus ~61 dead tuples per restart forever. Corrections: `migrations[50:]` fails loudly rather than silently; the interface has ~78 methods, not ~120; and `newTestDB` does **not** honour the chat-storage URI — it reads `CHAT_STORAGE_TEST_POSTGRES_URI` and skips silently when unset, so revision 1's stated PostgreSQL run could have passed while proving nothing. |
| 2026-08-31 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9m6ae`; seven new files, eleven modified. Five deviations recorded in `implement.md` — two of them defects the new tests caught in my own code: `BootstrapAdmin` trimmed the password (contradicting its own comment, so a password with trailing whitespace would have been stored silently different from what the operator typed), and the success log named a different username than the one stored. Baseline captured on the unmodified tree first: one pre-existing failure, `TestResolveDocumentMIME/Zip`. |
| 2026-08-31 | verified | ai_agent | `verify.md`: all 12 acceptance criteria mapped to results. Suite green against the baseline. The plan's open risk — that `CREATE TABLE IF NOT EXISTS users` might adopt a pre-existing table — was **resolved with evidence** rather than deferred: probed against the live database before the migrations were appended (`search_path` excludes `auth`; `to_regclass` is NULL for all four names). One finding is **escalated, not fixed**: Supabase grants `anon` full DML on every new `public` table with RLS off — already true today for message content and webhook secrets, but this ticket adds `password_hash` and `token_hash` to that set. Remediation SQL is in `plan.md > E-1`. |
