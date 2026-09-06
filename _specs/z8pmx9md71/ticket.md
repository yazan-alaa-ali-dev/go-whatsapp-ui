---
ticket: z8pmx9md71
title: 5 · Expose a typed permissions layer from /auth/me
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-09-06
updated_at: 2026-09-06
links:
  clickup: "https://app.clickup.com/t/z8pmx9md71"
  github: ""
---

# Ticket: 5 · Expose a typed permissions layer from /auth/me

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

This mirrors the delivery shape of tickets `z8pmx9md6x` (1), `z8pmx9md6y` (2),
`z8pmx9md6z` (3) and `z8pmx9md70` (4), at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9md71>
- Execution order: **5 of 5** in the auth-foundation chain
  `z8pmx9md6x -> z8pmx9md6y -> z8pmx9md6z -> z8pmx9md70 -> z8pmx9md71`.
  Depends on `z8pmx9md6y` (the session store) and `z8pmx9md6z` (login and the
  route guard). Blocks nothing — it is the last of the chain.
- Reference: `docs/gowa-frontend-reference-ar.html` §03 (`GET /auth/me` and the
  `AuthUserView` it answers with), §04 (the three seeded roles, the `user`
  role's nine literal permissions, and the full permission catalogue), §09 (the
  redaction rule — a masked field is a *deleted key*), §11 (the migration list
  and the common traps, "relying on the role name" among them).
- Branch: `ticket/z8pmx9md71`, cut from `ticket/z8pmx9md70` rather than from
  `main`: PR #4 is still open and the store this ticket reads `permissions[]`
  out of, plus the interceptor whose 403 behaviour it locks in, are that
  branch's work. The PR therefore targets `ticket/z8pmx9md70` as its base.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-09-06 | draft | ai_agent | Ticket workspace created from the ClickUp task (read-only intake, `scripts/clickup_intake.py`). |
| 2026-09-06 | spec-complete | ai_agent | `spec.md` authored directly from the ClickUp acceptance criteria: 28 acceptance criteria, 12 functional and 5 non-functional requirements, 6 constraints, 15 test cases and a *Known limits* section. |
| 2026-09-06 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed by the advisory panel (senior / security / performance) **against the source**, before any code was written. |
| 2026-09-06 | spec-complete | ai_agent | `plan.md` revised to revision 2: **40 findings — 31 adopted, 6 accepted as stated costs or limits, 2 declined, 1 corrected**. Six changed the design and one changed `spec.md`. Three defects were found independently by two or more lenses: revision 1's three-prop `<Can>` union forced either a conditional hook call or three store subscriptions per instance, and failed *open* under a spread; the new `permissions`-owner source rule would have red-failed on its first run, because `stripComments` does not strip string literals and `auth-messages.ts` — a file this ticket edits — contains "Your permissions were updated" in its sign-out copy; and NFR-2's identity guarantee was broader than the store allows. The security lens also showed the role rule could be destructured, `switch`ed or lookup-tabled around, which changed it from matching comparisons to matching the field. One mitigation was **corrected rather than adopted**: gating the 403 message on the gowa envelope code is impossible — §02's error table gives the 403 row no code at all — so the plan takes the other half of that finding and keeps the server's text alongside the sentence. |
| 2026-09-06 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9md71`: 8 files added, 6 edited, none deleted. Five plan deviations recorded in `implement.md` — two forced by tooling (a React hook cannot be called outside a render, so the selectors are exported and tested against the real store; `{ has_debug?: boolean }` is a TypeScript weak type that rejects the very payload it exists for), one an honest correction (a rotation does *not* change the permission array's identity when the new principal shares the array — a spread copies it by reference; only a principal parsed from the wire does), one a reported mutation survivor, and one a wider rule than planned. |
| 2026-09-06 | verified | ai_agent | `verify.md`: all 28 acceptance criteria mapped to executed results — 24 backed by an assertion, 2 by the compiler, 1 by a read-through, and AC-22 recorded as a partial because no admin surface exists in this UI to hide. Profile `ui-build` fully green: **278 tests, up from a 215-test baseline**, typecheck clean, lint at the same 4 pre-existing warnings, single-file build passing. Twenty mutations were run against the new guards: 18 killed, 2 negative controls correctly not flagged, and **1 survived** — `hasField`'s `key in value` rewritten as `value[key] !== undefined` passed every test, because nothing asserted that a key holding `undefined` is still present. The gap was closed and the mutation now dies. No deployment runtime file changed. Three open items recorded: nothing was verified against a running gowa server, C-1 still rules out a browser pass, and AC-22 has nothing to observe. |
