---
ticket: z8pmx9m6af
title: 23 · Login and tokens — JWT access/refresh service, /auth endpoints, and the Authenticate middleware
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-08-31
updated_at: 2026-08-31
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6af"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-web-multidevice/pull/23"
---

# Ticket: 23 · Login and tokens — JWT access/refresh service, /auth endpoints, and the Authenticate middleware

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
(16), `z8pmx9kzc8` (17), `z8pmx9kzc9` (18), `z8pmx9m57v` (21) and `z8pmx9m6ae`
(22), at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9m6af>
- Execution order: 23 of the auth/RBAC series · depends on 22 · blocks 24, 25, 26
- Reference: `gowa-auth-rbac-ar.html` rev 3 §04 (Tokens), §05 (the guard)
- Branch: `ticket/z8pmx9m6af`, cut from `ticket/z8pmx9m6ae` — the tip carrying
  ticket 22 (the identity schema, the permission catalogue, bcrypt and the
  bootstrap admin). The PR therefore targets that branch, not `main`.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-08-31 | draft | ai_agent | Ticket workspace created from the ClickUp task. |
| 2026-08-31 | spec-complete | ai_agent | `spec.md` authored directly: 14 acceptance criteria, 10 functional and 6 non-functional requirements, 5 constraints, 14 test cases. |
| 2026-08-31 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed by the advisory panel (senior / security / performance) **against the source**, before any code was written. 47 findings. |
| 2026-08-31 | spec-complete | ai_agent | `plan.md` revised. Six findings changed the design, three were declined with reasons, and three revision-1 claims were **factually wrong about this repository**. **Three defects were reached independently by two lenses each.** The worst: revision 1 asserted "Fiber v3 takes middleware as trailing variadic handlers" — the opposite is true (`app.Add` builds the chain first-argument-first), so the rate limiter would have been registered and **never executed**, and TC-11 as planned would have certified it. Second: the refresh path had **no way to read its user** — `refresh_tokens` carries only `user_id` and the only user read in existence is `GetUserByUsername`. Third: a 30-second cache ticker that all three lenses rejected — invented, against the repo's precedent, 8,640 round trips/day/process to a remote Supabase, and constructed in `initApp`, which runs for `gowa mcp` too. Also adopted: the empty-password enumeration oracle (`VerifyPassword` skips bcrypt on an empty input, so the cheapest probe defeated AC-4), login never checking `status`, family revocation firing on ordinary browser tab races, and ~2,880 never-swept rows per active session. |
| 2026-08-31 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9m6af`; sixteen new files, twelve modified. Six deviations recorded in `implement.md`. Baseline captured on the unmodified tree first: one pre-existing failure, `TestResolveDocumentMIME/Zip`. The concurrency test was corrected before it was trusted — its first run returned **zero** successes (a harness artifact: the bare test DSN sets no `busy_timeout`, unlike production), and a gate that always returned false would have passed it identically. |
| 2026-08-31 | verified | ai_agent | `verify.md`: all 14 acceptance criteria mapped to results, suite green against the baseline, no deployment runtime file touched. The rate limiter was **mutation-tested** — reverted to the plan's original trailing-handler form, confirmed the test fails, then restored — because that is the one defect a green test would otherwise have hidden. Two items are carried forward and explicitly **not** resolved: the PostgreSQL run was blocked by a machine-wide DNS outage (recorded with the exact re-run command, and the tests fail rather than skip, so the gap is visible), and E-1 — ticket 22's escalated Supabase `anon` grant, which this ticket **weaponises**: with it open, anyone with the public anon key can insert a `refresh_tokens` row and mint an admin token with no password. Three acceptance criteria were amended after review and are flagged for the owner to overrule. |
