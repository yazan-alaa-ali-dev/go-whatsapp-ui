---
ticket: z8pmx9md6z
title: 3 · Replace the connect screen with JWT login, logout and a route guard
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-09-06
updated_at: 2026-09-06
links:
  clickup: "https://app.clickup.com/t/z8pmx9md6z"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-ui/pull/3"
---

# Ticket: 3 · Replace the connect screen with JWT login, logout and a route guard

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

This mirrors the delivery shape of tickets `z8pmx9md6x` (1) and `z8pmx9md6y` (2),
at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9md6z>
- Execution order: **3 of 5** in the auth-foundation chain
  `z8pmx9md6x -> z8pmx9md6y -> z8pmx9md6z -> z8pmx9md70 -> z8pmx9md71`.
  Depends on both tickets before it; **blocks** the two after it.
- Reference: `docs/gowa-frontend-reference-ar.html` §02 (the error-code
  catalogue and the public routes), §03 (`POST /auth/login`, `POST /auth/logout`,
  rate limiting, the token epoch, and the `Authenticate`-identifies /
  `Require`-refuses middleware split).
- Branch: `ticket/z8pmx9md6z`, cut from `ticket/z8pmx9md6y` rather than from
  `main`: PRs #1 and #2 are still open, and this ticket's every premise (the
  same-origin `/api` prefix, the auth store, the cookie adapter, the bearer
  interceptor) is those branches' work. The PR therefore targets
  `ticket/z8pmx9md6y` as its base.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-09-06 | draft | ai_agent | Ticket workspace created from the ClickUp task (read-only intake, `scripts/clickup_intake.py`). |
| 2026-09-06 | spec-complete | ai_agent | `spec.md` authored directly from the ClickUp acceptance criteria: 26 acceptance criteria, 18 functional and 6 non-functional requirements, 6 constraints, 11 test cases, and a *Known limits* section stating what the ticket does not buy. The sharpest constraint is C-1: the repository has no component renderer, and adding one would edit `package.json` — a hard stop — so anything that must be provable has to live outside a React render. |
| 2026-09-06 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed by the advisory panel (senior / security / performance) **against the source**, before any code was written. |
| 2026-09-06 | spec-complete | ai_agent | `plan.md` revised to revision 2: **36 findings — 33 adopted, 1 declined with reasons, 2 noted**. Seven changed the design. The decisive one, reached independently by two lenses: revision 1 tore a session down the same way whether the user asked for it or the server refused a token, so an involuntary 401 would have fired `POST /auth/logout` and revoked the 30-day refresh-token family that `z8pmx9md70` is built on — and would have silently reversed `z8pmx9md6y`'s explicit decision to keep that token through a boot 401. Sign-out is now two actions split on *who ended the session*. The senior lens also found a latent bug in `ws.ts`: `stop()` never clears `abandonedUrl`, so a sign-out followed by a sign-in would open no socket for the life of the tab. Two lenses found the cache teardown was level-triggered and did not cancel in-flight requests, letting the previous session's data resolve into the next user's cache. A second probe-gated query (`use-app-info.ts`) was missing from the file list, `afterLoginPath` had a signature that would have stringified a Location to `[object Object]` and silently dropped AC-7, and the connection banner would have lied on any deployment that proxies `/api` but not `/health`. |
| 2026-09-06 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9md6z`: 8 files added, 13 edited, 1 deleted (`src/pages/connect.tsx`). Five plan deviations recorded in `implement.md`, four additive and one an honest retraction — the plan promised a mutation test that C-1 makes impossible. |
| 2026-09-06 | verified | ai_agent | `verify.md`: all 26 acceptance criteria mapped to executed results — 15 backed by an assertion, 3 by an assertion plus a read-through, 8 by a read-through alone, each labelled rather than averaged. Profile `ui-build` fully green: **168 tests, up from a 109-test baseline**, typecheck clean, lint clean with no warning added, and the single-file build passing with the import cycle extended. Nine mutations were run against the new guards and **one survived**: the password containment rule was written `/password/` and could not match `setPassword` — the exact gap the security lens had named at review, still present in the written rule. The rule was green, the suite was green, and the rule did not work; it is a substring match now and all three password mutations are red against it. No deployment runtime file changed. One open item recorded rather than glossed: nothing was verified against a running gowa server, because none was reachable from this environment. |
