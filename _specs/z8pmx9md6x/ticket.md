---
ticket: z8pmx9md6x
title: 1 · Route all API traffic through a same-origin proxy path
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-09-05
updated_at: 2026-09-05
links:
  clickup: "https://app.clickup.com/t/z8pmx9md6x"
  github: ""
---

# Ticket: 1 · Route all API traffic through a same-origin proxy path

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

This mirrors the delivery shape of ticket `z8pmx9kzc9` (18), at the owner's
request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9md6x>
- Execution order: **1 of 5** in the auth-foundation chain
  `z8pmx9md6x -> z8pmx9md6y -> z8pmx9md6z -> z8pmx9md70 -> z8pmx9md71`.
  Depends on nothing; **blocks** every ticket after it.
- Reference: `docs/gowa-frontend-reference-ar.html` §02 (base path & envelope),
  §03 (authentication), §10 (WebSocket).
- Branch: `ticket/z8pmx9md6x`, cut from clean `main`.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-09-05 | draft | ai_agent | Ticket workspace created from the ClickUp task. |
| 2026-09-05 | spec-complete | ai_agent | `spec.md` authored directly: 18 acceptance criteria, 11 functional and 5 non-functional requirements, 5 constraints, 9 test cases. |
| 2026-09-05 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed by the advisory panel (senior / security / performance) **against the source**, before any code was written. |
| 2026-09-05 | spec-complete | ai_agent | `plan.md` revised: **32 findings — 29 adopted, 3 declined with reasons**, and one revision-1 claim corrected outright. Four findings changed the design. The decisive one: revision 1 renamed the dev proxy entry `/gowa` to `/api` while keeping "the same rewrite" — `p.replace(/^\/gowa/, '')` — which under a `/api` prefix strips nothing, so every dev request would have 404'd, in the one file this repo treats as a hard-stop to edit twice. Two lenses independently found the same second defect from opposite directions (security via the trust boundary, performance via the reconnect loop): dropping the WebSocket credential leaves `/ws` refused forever, because `backoffDelay` caps the delay but nothing caps the attempt count. A third lens showed the spec's own headline property was overstated — the server still ships its host inside `qr_link`/`file_path`, so `spec.md` gained a *Known limits* section rather than claiming a property the code does not have. |
| 2026-09-05 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9md6x`; 17 files modified, 2 test files added. Four plan deviations recorded in `implement.md`. |
| 2026-09-05 | verified | ai_agent | `verify.md`: all 18 acceptance criteria mapped to executed results. Profile `ui-build` fully green (64 tests, up from a 47-test baseline). Because two of the new guards exist only because a lens found their absence, each was **mutation-tested** — removed, shown to fail the suite, and restored; restoring revision 1's own probe rule fails two tests. Verified live against the real gowa server: `:3000/api/devices` is 404 and `:3000/devices` is 401, and the dev proxy returns 401 — proving the corrected rewrite strips the prefix. `/health` returns `text/plain` `OK`, confirming the deliberate choice not to require JSON. The `/ws` upgrade returns 401, confirming the reconnect-loop scenario live. No browser pass was possible (extension unavailable); the two affected test cases are recorded as partial with their limit stated. One deployment runtime file changed: `vite.config.ts`, as listed in the approved plan. |
