---
ticket: z8pmx9m6ah
title: 25 · Scoping and leak closure — device ownership, debug/transcript redaction, and per-principal WebSocket fan-out
mode: standard
state: closed
status: active
owner: developer
created_at: 2026-09-01
updated_at: 2026-09-01
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6ah"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-web-multidevice/pull/25"
---

# Ticket: 25 · Scoping and leak closure

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
(16), `z8pmx9kzc8` (17), `z8pmx9kzc9` (18), `z8pmx9m57v` (21), `z8pmx9m6ae` (22),
`z8pmx9m6af` (23) and `z8pmx9m6ag` (24), at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9m6ah>
- Execution order: 25 of the auth/RBAC series · depends on 22, 23 and 24 · blocks 26
- Reference: `gowa-auth-rbac-ar.html` rev 3 §07 (Device Scope), §08 (Redaction),
  §09 (Realtime)
- Branch: `ticket/z8pmx9m6ah`, cut from `ticket/z8pmx9m6ag` — the tip carrying
  ticket 24 (`Require()` on every route, the boot-time coverage assertion and the
  removal of basic auth). The PR therefore targets that branch, not `main`.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-09-01 | draft | ai_agent | Ticket workspace created from the ClickUp task. |
| 2026-09-01 | spec-complete | ai_agent | `spec.md` authored directly: 15 acceptance criteria, 11 functional and 5 non-functional requirements, 5 constraints, 13 test cases. |
| 2026-09-01 | spec-complete | ai_agent | `plan.md` revision 1 authored. Four claims in the ticket's own research were checked against the source first; one was false (the in-memory account **can** go stale — `AttachDeviceToAccount` writes the row and nothing updates the registry) and one more gap was found (making `FetchDevices` principal-filtering would break boot auto-connect, which calls it with `context.Background()`). |
| 2026-09-01 | spec-complete | ai_agent | Advisory panel (senior / security / performance) reviewed revision 1 **against the source**. **41 findings.** Three majors were reached independently by all three lenses, and one lens found a leak in the ticket's own AC-4. The worst: the planned `FETCH_DEVICES` unicast wrote from the per-connection reader goroutine, racing the hub — gorilla panics on a concurrent write and `RunHub` has no recover, so the whole process would go down. Also: `POST /devices` hard-codes an empty account while the seeded `user` role holds `devices.create`/`pair`, so shipping revision 1 would have made the role's own self-service flow a black hole; and the 404 body echoed the RESOLVED device id, so a by-JID probe returned another account's device *name*. |
| 2026-09-01 | spec-complete | ai_agent | `plan.md` revision 2. 31 findings adopted, 6 declined with reasons, 4 answered as correct-as-planned. Two ACs amended (AC-4 for the disclosure, AC-5 extended to `/app/devices`) and two added (AC-16 boot-time ownership coverage, AC-17 create-in-own-account) — all flagged for the owner to overrule. One panel suggestion was adopted only in a corrected form: reordering `MayAddressDevice` as proposed would have made a blank-account principal match a blank-account device, which is exactly the wildcard AC-2 forbids. |
| 2026-09-01 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9m6ah`: 11 new files, 30 modified. Baseline captured on the unmodified tree first (3 failing packages, 167 leaf failures, all traced to `CGO_ENABLED=0` with no C compiler plus one Windows MIME-registry quirk). Thirteen deviations recorded in `implement.md`, the largest being that `SystemPrincipal` was moved out of `pkg/auth` (an all-permissions principal in the leaf every package imports is a loaded gun) and that `shouldDeliver` had to be extracted from `broadcastMessage` because a surviving mutant proved the fan-out filter was untested. |
| 2026-09-01 | verified | ai_agent | `verify.md`: all 17 acceptance criteria mapped to results, 236 tests passing across the five touched packages, suite compared **mechanically** against the baseline (identical failing packages, identical 167 leaf failures, zero failures without a pre-existing cause). No deployment runtime file touched. Mutation-tested with six injected defects, all six detected — **two initially survived and both were gaps in the tests, not the code**, including a probe that addressed a device by its own id and so could never have shown the disclosure it was written to catch. Two items carried forward unresolved: `-race` could not run (it needs cgo) and no live boot was possible, so AC-16 rests on a route-set mirror. Eight residual risks recorded, the sharpest being that ticket 26 must require a non-blank account for non-admin roles or the first user it creates will see an empty fleet. |
| 2026-09-01 | closed | ai_agent | Verification passed; ticket closed. |
