---
ticket: z8pmx9md70
title: 4 · Add silent refresh, 401 recovery and token rotation
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-09-06
updated_at: 2026-09-06
links:
  clickup: "https://app.clickup.com/t/z8pmx9md70"
  github: ""
---

# Ticket: 4 · Add silent refresh, 401 recovery and token rotation

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

This mirrors the delivery shape of tickets `z8pmx9md6x` (1), `z8pmx9md6y` (2)
and `z8pmx9md6z` (3), at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9md70>
- Execution order: **4 of 5** in the auth-foundation chain
  `z8pmx9md6x -> z8pmx9md6y -> z8pmx9md6z -> z8pmx9md70 -> z8pmx9md71`.
  Depends on the three tickets before it; **blocks** `z8pmx9md71`.
- Reference: `docs/gowa-frontend-reference-ar.html` §02 (the error-code
  catalogue and the public routes), §03 (`POST /auth/refresh`, rotation, reuse
  detection, the token epoch, rate limiting, and the `Authenticate`-identifies /
  `Require`-refuses middleware split), §10 (the WebSocket principal frozen at
  handshake).
- Branch: `ticket/z8pmx9md70`, cut from `ticket/z8pmx9md6z` rather than from
  `main`: PR #3 is still open and every premise of this ticket (the session
  store, the bearer interceptor, the route guard, the login screen) is that
  branch's work. The PR therefore targets `ticket/z8pmx9md6z` as its base.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-09-06 | draft | ai_agent | Ticket workspace created from the ClickUp task (read-only intake, `scripts/clickup_intake.py`). |
| 2026-09-06 | spec-complete | ai_agent | `spec.md` authored directly from the ClickUp acceptance criteria: 30 acceptance criteria, 15 functional and 5 non-functional requirements, 6 constraints, 18 test cases, and a *Known limits* section. |
| 2026-09-06 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed by the advisory panel (senior / security / performance) **against the source**, before any code was written. |
| 2026-09-06 | spec-complete | ai_agent | `plan.md` revised to revision 2: **35 findings — 31 adopted, 3 accepted as stated costs, 1 declined**. Eight changed the design and one changed `spec.md`. Four defects were found independently by two or more lenses: revision 1's single-flight promise had no `finally`, so a page would have refreshed exactly once and then replayed every request with a dead token; the replay path had no teardown, leaving a session `authenticated` while holding a credential the server refuses; the 401 branch lost the `status !== 'authenticated'` no-op, so a deliberate sign-out would have been reported to the user as "Your session expired"; and putting the token in the socket URL refilled the refused-handshake budget every rotation, breaking an invariant `ws.test.ts` states by name. The security lens found two more on its own: an in-flight refresh could resurrect a session the user had just ended, and revision 1's cookie-first refresh-token read — proposed to narrow a reuse-detection window — would have let a second principal signing in in another tab substitute themselves into this one. That last finding changed `spec.md > C-5`. |
| 2026-09-06 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9md70`: 2 files added, 9 edited, none deleted. Five plan deviations recorded in `implement.md` — three additive, one a test-harness correction (asserting the replay's bearer off a live axios config read the rotated token back on the *first* request, because a replay reuses the config that failed), and one an honest retraction: two guards the plan claimed were covered had no test that could fail without them. |
| 2026-09-06 | verified | ai_agent | `verify.md`: all 30 acceptance criteria mapped to executed results — 26 backed by an assertion, 2 by an assertion plus a read-through, 2 by a read-through alone, each labelled rather than averaged. Profile `ui-build` fully green: **215 tests, up from a 168-test baseline**, typecheck clean, lint clean at the same 4 pre-existing warnings, single-file build passing. Sixteen mutations were run against the new guards and **two survived**: the live-session gate (the case meant to cover it short-circuited on a null refresh token before the gate could matter — its real work is stopping a straggling 401 from spending the refresh token `endSession` deliberately keeps, and resurrecting a session the store had just ended) and `armedFor` (the delay is computed from an absolute deadline, so re-arming on every store write still fires at the right moment — the guard protects against timer churn, not a drifting deadline, and the test's own comment had claimed otherwise). Both gaps were closed and both mutations now die. No deployment runtime file changed. Two open items recorded: nothing was verified against a running gowa server, and C-1 still rules out a browser pass. |
