---
ticket: z8pmx9m6aj
title: 26 · User and account administration — admin creates an account and its users, assigns roles, and links devices
mode: standard
state: closed
status: active
owner: developer
created_at: 2026-09-01
updated_at: 2026-09-01
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6aj"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-web-multidevice/pull/26"
---

# Ticket: 26 · User and account administration

> **This file is the single canonical record of the ticket's workflow state.**

## Delivery note — staged workflow not used

At the owner's explicit instruction this ticket is **not** run through the seven
staged workflow commands. It is implemented directly, with one substitution the
owner asked for: the advisory review panel (`senior-reviewer`, `security-reviewer`,
`performance-reviewer` — the lenses `/review` dispatches) reviews the plan **before**
any code is written, and every finding is answered in `plan.md > Panel response`.

Consequently `intake.md`, `research.md`, `review.md` and `comprehension.md` do not
exist; `spec.md`, `plan.md`, `implement.md` and `verify.md` are authored directly as
the record of what was specified, decided, changed and validated.

This mirrors the delivery shape of tickets `cu-z8pmx9kcvh` (14), `z8pmx9kzc7` (16),
`z8pmx9kzc8` (17), `z8pmx9kzc9` (18), `z8pmx9m57v` (21), `z8pmx9m6ae` (22),
`z8pmx9m6af` (23), `z8pmx9m6ag` (24) and `z8pmx9m6ah` (25), at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9m6aj>
- Execution order: 26 of the auth/RBAC series · depends on 22, 23, 24 and 25 · last
  of the series
- Reference: `gowa-auth-rbac-ar.html` rev 3 §02 (Model), §06 (Permissions), §12
  (owner decisions)
- Branch: `ticket/z8pmx9m6aj`, cut from `ticket/z8pmx9m6ah` — the tip carrying
  ticket 25 (device ownership, redaction, per-principal WebSocket fan-out). The PR
  therefore targets that branch, not `main`.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-09-01 | draft | ai_agent | Ticket workspace created from the ClickUp task. |
| 2026-09-01 | spec-complete | ai_agent | `spec.md` authored directly: 15 acceptance criteria, 12 functional and 6 non-functional requirements, 6 constraints, 14 test cases. Three ACs added beyond the ClickUp list — AC-13 (a created user must carry a real account, closing ticket 25's carried-forward risk), AC-14 (the surface cannot lock the deployment out of itself) and AC-15 (a committed write is visible to the next request). |
| 2026-09-01 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed **against the source** by the advisory panel (senior / security / performance). **31 findings, 11 major.** One would have stopped the build: `chatstorage_wrapper.go` delegates the whole `IChatStorageRepository` and mirrors all eleven identity methods, so seven new methods do not compile until they are mirrored there — revision 1 did not list the file. The security lens found a live privilege escalation (nothing stopped a `users.manage` holder granting themselves `admin`, or resetting the administrator's password), a PATCH DTO that could not tell "absent" from "empty" and so would blank `account_id`, and the same hole defeating AC-14. The senior lens found the rollback story false: `AUTH_BOOTSTRAP_ADMIN` cannot fire against a populated table, so the last-admin guard is not optional. |
| 2026-09-01 | spec-complete | ai_agent | `plan.md` revision 2. **24 findings adopted, 4 declined with reasons, 3 answered as correct as planned.** Two of the plan's own claims were **factually wrong** and were corrected against the source: `Refresh` does not revoke a family on an epoch mismatch (only on a status change), and the planned "read the permission union back from the rebuilt cache" is unreachable — `IAuthUsecase` exposes no lookup by user id. Four ACs amended and AC-16 added (the privilege ceiling), all flagged for the owner. |
| 2026-09-01 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9m6aj`: 11 new files, 9 modified, 95 new tests. Eight deviations recorded in `implement.md`. The largest: the revoke moved *inside* `DeleteUser`'s transaction so AC-5 is genuinely atomic, and the lockout interlock was **corrected after the tests caught it** — it originally refused to disable an *ordinary* user in a deployment with no live administrator, a refusal about someone who never held the permission. |
| 2026-09-01 | verified | ai_agent | `verify.md`: all 16 acceptance criteria mapped to results. The repository ships a **`purego` SQLite driver needing no cgo**, so unlike the previous ticket the whole suite ran here: under that tag the result is **identical to a baseline captured on a git worktree at `bf5a28d`** — one failing test, a pre-existing Windows MIME quirk. Under cgo the 35 extra failures are the new repository tests hitting the baseline's own missing-C-compiler cause, in the baseline's own packages. Mutation-tested with seven injected defects, **all seven detected**, including both of the security lens's majors. Eight residual risks recorded, the sharpest being last-admin write skew on PostgreSQL at READ COMMITTED (SQLite, the default deployment, is unaffected). |
| 2026-09-01 | closed | ai_agent | Verification passed; ticket closed. |
