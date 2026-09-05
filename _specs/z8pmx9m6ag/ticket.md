---
ticket: z8pmx9m6ag
title: 24 · Enforcement — Require() on every route, boot-time policy coverage, and complete removal of basic auth
mode: standard
state: closed
status: active
owner: developer
created_at: 2026-09-01
updated_at: 2026-09-01
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6ag"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-web-multidevice/pull/24"
---

# Ticket: 24 · Enforcement — Require() on every route, boot-time policy coverage, and complete removal of basic auth

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
(16), `z8pmx9kzc8` (17), `z8pmx9kzc9` (18), `z8pmx9m57v` (21), `z8pmx9m6ae` (22)
and `z8pmx9m6af` (23), at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9m6ag>
- Execution order: 24 of the auth/RBAC series · depends on 22 and 23 · blocks 25, 26
- Reference: `gowa-auth-rbac-ar.html` rev 3 §05 (Guard), §06 (Permissions), §10 (Rollout)
- Branch: `ticket/z8pmx9m6ag`, cut from `ticket/z8pmx9m6af` — the tip carrying
  ticket 23 (the JWT service, the `/auth` endpoints and the `Authenticate`
  middleware). The PR therefore targets that branch, not `main`.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-09-01 | draft | ai_agent | Ticket workspace created from the ClickUp task. |
| 2026-09-01 | spec-complete | ai_agent | `spec.md` authored directly: 12 acceptance criteria, 10 functional and 5 non-functional requirements, 5 constraints, 12 test cases. |
| 2026-09-01 | spec-complete | ai_agent | `plan.md` revision 1 authored. Three claims were checked against Fiber v3.4.0 and the repository **before** planning, and one of the reference document's was false: §05 prescribes the guard as a trailing handler, and a probe showed a trailing handler never runs — the design as documented would have wired ~104 routes and enforced nothing. |
| 2026-09-01 | spec-complete | ai_agent | Advisory panel (senior / security / performance) reviewed revision 1 **against the source**. 38 findings. **Three majors were reached independently by all three lenses.** The worst: `DeviceMiddleware`, installed by `Group("", …)`, is matched before every device-scoped route and terminates without `c.Next()` — so ~75 routes would have answered 400/404 to an anonymous caller instead of 401, an unauthenticated device-enumeration oracle, while a route matrix built on a bare `fiber.New()` passed. Also: filtering Fiber `use` routes out of the coverage walk hid the terminal `/statics` mount and made AC-3's entry for it dead code; and `AUTH_JWT_SECRET` absent would have booted a server that refuses every caller while `/health` answered OK. |
| 2026-09-01 | spec-complete | ai_agent | `plan.md` revision 2. 27 findings adopted, 4 declined with reasons, 7 answered as correct-as-planned. Three ACs amended (AC-3 7→8 entries, AC-4 25→23 permissions, AC-12 extended to `docs/openapi.yaml`) and one added (AC-13, fatal without `AUTH_JWT_SECRET`) — all flagged for the owner to overrule. One revision-1 claim was itself corrected: the Fiber handler-ordering rule is not a new discovery, `ui/rest/auth.go:59-66` already records it from ticket 23. |
| 2026-09-01 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9m6ag`: 9 new files, 2 deleted, 32 modified. 95 `Require(...)` call sites. Thirteen deviations recorded in `implement.md`, the largest being that the ticket's own `pkg/auth/coverage.go` location is an import cycle. Baseline captured on the unmodified tree first: 3 packages failing, all 160 leaf failures traced to `CGO_ENABLED=0` with no C compiler on this machine. `gofmt -w` rewrote line endings in eleven files whose content did not change; all eleven were restored so the change set contains only real changes. |
| 2026-09-01 | verified | ai_agent | `verify.md`: all 13 acceptance criteria mapped to results, 115 tests passing across the three touched packages, suite compared **mechanically** against the baseline (identical failing packages, identical 160 leaf failures, identical 153 cgo-stub messages, zero failures without a cgo cause). No deployment runtime file touched. The suite was **mutation-tested** with four injected defects — including the reference document's own trailing-guard form — and all four were detected. Two items are carried forward and explicitly **not** resolved: `-race` could not run (it requires cgo), and no live boot was possible, so AC-13 rests on code inspection. Eight residual risks are recorded for the owner, the sharpest being that no non-admin user may be created until ticket 25 ships. |
| 2026-09-01 | closed | ai_agent | Verification passed; ticket closed. |
