---
ticket: z8pmx9mf16
title: 6 · Add the account scope store and the accounts/users API layer
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-09-07
updated_at: 2026-09-07
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf16"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-ui/pull/6"
---

# Ticket: 6 · Add the account scope store and the accounts/users API layer

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

This mirrors the delivery shape of tickets `z8pmx9md6x` (1) through
`z8pmx9md71` (5), at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9mf16>
- Execution order: **1 of phase 2**. Depends on `z8pmx9md71` (the typed
  permissions layer) — this ticket's device-list hook gates its filter on
  `PERMISSIONS.ACCOUNTS_MANAGE` and its error copy sits beside
  `PERMISSION_DENIED`. **Blocks** every other phase-2 ticket (7, 8, 9, 10):
  nothing else in the phase can start before the scope primitive and the
  request layer exist.
- References:
  - `docs/gowa-phase2-accounts-rbac-study-ar.html` — §02 (the central idea),
    §04 (the scope model: an account is a lens, a device is the scope), §12
    (the API layer, the query keys, the change to `RegistryDevice`), §14 (the
    eight open backend questions, Q-1..Q-8).
  - `docs/gowa-frontend-reference-ar.html` — §05 (the `Account` object and the
    nine account endpoints), §06 (`GET /devices?account_id=`, the device
    object, the 404-not-403 rule), §07 (`/auth/users` and the absent-field
    meaning of `PATCH`), §02 (the error table).
- Branch: `ticket/z8pmx9mf16`, cut from `ticket/z8pmx9md70` at the merge of
  PR #5 — the tip of the stacked auth-foundation chain, which is where tickets
  1–5 actually live. `main` still carries PR #1 alone, so cutting from it would
  have produced a branch without the session store, the permissions layer or
  the proxy this ticket builds on. The PR therefore targets
  `ticket/z8pmx9md70` as its base.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-09-07 | draft | ai_agent | Ticket workspace created from the ClickUp task (read-only intake, `scripts/clickup_intake.py`). |
| 2026-09-07 | spec-complete | ai_agent | `spec.md` authored directly from the ClickUp acceptance criteria: 29 acceptance criteria, 13 functional and 5 non-functional requirements, 6 constraints, 16 test cases and a *Known limits* section. |
| 2026-09-07 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed by the advisory panel (senior / security / performance) **against the source**, before any code was written. |
| 2026-09-07 | spec-complete | ai_agent | `plan.md` revised to revision 2: **35 findings — 27 adopted, 5 accepted as stated costs or limits, 2 declined, 1 premise corrected outright**. Six changed the design. The decisive one: revision 1 declared four wire shapes undocumented and chose "the most defensible reading" for each, following the study's own no-guessing method — but the reference embeds a **complete OpenAPI specification** that revision 1 never read, having stopped at the prose sections. All four were documented, and one guess was wrong: the device-order body is `{ order: string[] }`, not `{ device_ids: string[] }`, so every reorder call would have answered `400` in the one endpoint whose failure is silent. Three defects were found independently by two or more lenses: the new store trips two existing source-policy allowlists the plan never listed, so the first validation run would have gone red and the implementer would have widened two *security* allowlists off-plan; the proposed `stripStrings` helper breaks in three distinct ways, one of them deleting real code by pairing the apostrophes in two strings already inside the file it was meant to exempt; and the `roles` narrowing regex is evaded by both a destructuring rename and an object literal. The security lens also showed that classifying an uncoded rejection by caller context reconstructs a username-enumeration oracle the server documents itself as withholding — `POST /auth/users` answers one `409` for "the username, the email, **or** the inline account id" — so eleven notices became eight, none naming which field collided. |
| 2026-09-07 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9mf16`: 10 files added, 7 edited, none deleted. Five plan deviations recorded in `implement.md`. The largest is that the plan's most elaborate mechanism — a non-destructive string-literal scanner so `auth-messages.ts` could name a role in copy — turned out to be unnecessary: applying the panel's own finding about not naming which of three joined causes collided left the file with zero mentions of the word, so it stays out of the allowlist and the base rule guards it unchanged. Two others were forced by the environment (zustand's `persist` degrades to a plain store with no `localStorage`, so the versioned name is asserted on the source instead, over both persisted stores) and by a distinction the plan did not spell out (`field in device` and `device[field] !== undefined` differ for a key holding `undefined`, and the second answers "absent" for a field that is present). |
| 2026-09-07 | verified | ai_agent | `verify.md`: all 29 acceptance criteria mapped to executed results and all 16 test cases run. Profile `ui-build` fully green: **357 tests in 25 files, up from a 278-in-20 baseline**, typecheck clean, lint at the same 4 pre-existing warnings, single-file build passing. Twenty-three mutations were run against the new guards — 21 killed, 2 controls correct — plus one killed by the compiler (`queryFn: listDevices` unwrapped collapses the query's data type and breaks three call sites). Two spec premises were corrected: `TC-12` anticipated only `email` as a legitimately-blank field, while `account_id: ''` is forwarded rather than dropped so the server's documented 400 is the message; and `AC-27` asked for eleven notices where the wire documents eight, because splitting one 409 into "duplicate username / email / account id" would rebuild the user-enumeration oracle the backend deliberately gives up. The bundle question the panel raised was settled with a number: `dist/index.html` grew 1,024,629 → 1,026,213 bytes (+1,584), and a grep of the built file shows **none** of the unused exports ship — not the two API modules, not the three spare key builders, not the eight notices. Three open items: nothing was verified against a running gowa server, `C-4` still rules out a browser pass, and signing out now also clears the device selection (a deliberate, stated behaviour change). |
