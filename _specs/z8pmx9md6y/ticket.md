---
ticket: z8pmx9md6y
title: 2 · Build the single-source-of-truth auth session store on cookies
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-09-05
updated_at: 2026-09-05
links:
  clickup: "https://app.clickup.com/t/z8pmx9md6y"
  github: ""
---

# Ticket: 2 · Build the single-source-of-truth auth session store on cookies

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

This mirrors the delivery shape of ticket `z8pmx9md6x` (1), at the owner's
request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9md6y>
- Execution order: **2 of 5** in the auth-foundation chain
  `z8pmx9md6x -> z8pmx9md6y -> z8pmx9md6z -> z8pmx9md70 -> z8pmx9md71`.
  Depends on `z8pmx9md6x`; **blocks** the three tickets after it.
- Reference: `docs/gowa-frontend-reference-ar.html` §03 (the token pair,
  `GET /auth/me`, the token epoch), §04 (RBAC — `permissions[]`, not role names).
- Branch: `ticket/z8pmx9md6y`, cut from `ticket/z8pmx9md6x` rather than from
  `main`: PR #1 is still open, and this ticket's every premise (the same-origin
  `/api` prefix, the deleted credential, the health probe) is that branch's work.
  Cutting from `main` would produce a branch whose plan does not describe the
  code it sits on. The PR therefore targets `ticket/z8pmx9md6x` as its base.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-09-05 | draft | ai_agent | Ticket workspace created from the ClickUp task (read-only intake, `scripts/clickup_intake.py`). |
| 2026-09-05 | spec-complete | ai_agent | `spec.md` authored directly from the ClickUp acceptance criteria: 19 acceptance criteria, 11 functional and 6 non-functional requirements, 5 constraints, 9 test cases, and a *Known limits* section stating plainly what a JS-written cookie does **not** buy. |
| 2026-09-05 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed by the advisory panel (senior / security / performance) **against the source**, before any code was written. |
| 2026-09-05 | spec-complete | ai_agent | `plan.md` revised to revision 2: **24 findings — 19 adopted, 3 declined with reasons, 2 noted**. Six findings changed the design. The decisive one: revision 1's source-policy guard banned `zustand persist` and any mention of web storage outside one file, and `src/stores/device.ts` already uses **both** (`persist` + `createJSONStorage(() => localStorage)`) while `src/stores/recipient.ts` uses `persist` — so the guard would have failed on its first run and forced an unplanned edit to two files holding no credential. It was rewritten credential-scoped, which is also strictly stronger. Three lenses then found the same second defect from different directions: a boot `/auth/me` 401 racing the health probe made the post-reload landing screen nondeterministic; fixed by excluding the public `/auth/*` endpoints from `markUnauthorized`, because their 401 means "no session", not "this origin is refused". Two more were real defects in revision 1: `boot()` called `/auth/me` without checking expiry (REQ-7 says *unexpired*), and `fetchMe()` could return `undefined` and still report `authenticated`, since `ResponseData.results` is optional. A security lens closed a leak class before it existed — the bearer header is now attached to relative URLs only, because axios ignores `baseURL` for an absolute URL and this backend hands out absolute `qr_link`/`file_path` values. |
| 2026-09-05 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9md6y`: 8 files added (3 source, 4 test, 1 ADR), 5 files edited. Four plan deviations recorded in `implement.md`, all additive. |
| 2026-09-05 | verified | ai_agent | `verify.md`: all 19 acceptance criteria mapped to executed results; 8 of 9 test cases PASS, 1 recorded PARTIAL with its limit stated (TC-2's "user is presented with the login screen" half cannot exist until `z8pmx9md6z`). Profile `ui-build` fully green — **109 tests, up from a 64-test baseline**, typecheck and lint clean, and the single-file build proves rollup accepts the repository's first import cycle. Every guard added by this ticket was **mutation-tested**: a token written to `localStorage` from a non-store module turns four rules red; a `document.cookie` read outside the adapter, an `atob(` call, and the removal of the same-origin check on the bearer header each turn their own assertion red. Restoring revision 1's blanket `persist` rule reproduces the senior lens's major finding exactly. No deployment runtime file changed. ADR-012 records the cookie decision, its explicit non-claim about XSS, and the four costs the panel measured. |
