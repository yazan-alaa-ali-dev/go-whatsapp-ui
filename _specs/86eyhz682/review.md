---
ticket: 86eyhz682
stage: review
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: reviewer
updated: 2026-08-09
links:
  clickup: https://app.clickup.com/t/86eyhz682
  github:
---

# Review — 86eyhz682

> Review gate — run by the ticket owner themselves (self-review). A comprehension
> check at the gate is the integrity control. Evaluates the spec and plan before
> any implementation.

## Review Scope

`spec.md` (36 acceptance criteria, 9 test cases) and `plan.md` (17 steps, 5
files, decisions D-1 and D-2), read against the ClickUp ticket, `research.md`,
and the code the plan touches: `routes/tenants.js`, `routes/history.js`,
`models/Message.js` and `public/contacts.html`.

## Plan Summary

One new admin endpoint serves a conversation from MongoDB with an equality query
on `(tenantId, waNumberId, chatId)` sorted ascending on `(timestamp, createdAt)`
— exactly the index and the order ticket 2/4 built for it — behind the existing
admin authentication. The shared allow-list gains `chatId` and `metadataDebug`.
The contacts screen reads that endpoint by default, keeps the loaded page window
in memory and extends it on scroll, and moves the existing live read behind an
explicit "Fetch from WhatsApp" control that is disabled with a stated reason when
the session is unusable. Diagnostics appear only on records that carry them, and
the truncation marker gets its own notice. The live route is unchanged apart from
one log line.

## Risks

- **R-1 — the reading of AC-1.** `waNumberId` still arrives from the caller. The
  plan constrains it to a resource selector, deriving the tenant from the stored
  record and checking it against the token claim, so no client value widens
  scope. This is a documented interpretation, and it must be verifiable by test,
  not by assertion.
- **R-2 — unauthenticated returns 401, not the 403 the AC names.** Two ACs
  conflict; the plan keeps the shared middleware. Acceptable only because the
  refusal property itself is preserved and the screen treats both identically.
- **R-3 — `skip`-based paging.** Bounded by counting first and clamping the page
  to the last one. Worst case is a full-page walk of an indexed range.
- **R-4 — a second read per page (`countDocuments`).** Accepted: it is the same
  indexed prefix, and it is what makes both the clamp and the screen's "Latest"
  affordance possible.
- **R-5 — untrusted diagnostics rendered in an admin screen.** The plan keeps
  payloads out of the DOM entirely and prints only via `textContent`.
- **R-6 — the contact preview reads up to 200 recent messages for the number.**
  One bounded call against an existing endpoint and an existing index; chats with
  no record in that window keep WhatsApp's own preview.
- **R-7 — two tickets editing `contacts.html`.** 4/4 adds a per-contact control;
  this ticket reworks the conversation view. The ticket states they are
  independent; a textual conflict is possible but neither redefines the other's
  part.

## Assumptions

- Ticket 2/4 is present on the branch this work is cut from: `chatId`,
  `metadataDebug` and the conversation index all exist. (Verified — the branch is
  cut from `ticket/86eyhz67r`, since 2/4 is not yet merged to `main`.)
- Records written before 2/4 carry `chatId: null` and belong to no conversation;
  an equality filter on a real key excludes them naturally.
- `omni_agent` owns the debug flag and its TTL; the gateway sees only whether a
  payload arrived.

## Open Questions

- None blocking. R-1 and R-2 are decided, recorded, and carried into
  verification as explicit checks.

## Panel Findings (advisory)

| Lens | Severity | Finding | Ref (AC-n / step / file) | Owner's disposition |
|------|----------|---------|--------------------------|---------------------|
| senior | minor | The screen needs a way back to the newest messages once page 1 is the oldest 50; without one, a long conversation opens far from where the operator works. | step 12 / AC-21 | Accepted — add a "Latest" affordance driven by the page count the endpoint already returns. No API change. |
| senior | minor | `contacts.html` gains two data sources; the merge rule must be explicit or the preview will silently disagree with the conversation. | step 10 / AC-19 | Accepted — stored preview wins; WhatsApp's own preview is used only where nothing is stored, and that rule is stated in the file. |
| security | major | A chat id is a customer phone number. Any refusal log that names the conversation leaks one. | step 4 / AC-35 | Accepted — mask to the last four characters plus the suffix; asserted by test. |
| security | major | `metadataDebug` is attacker-influenced content rendered in an admin session. If it reaches the DOM as markup, this is stored XSS with an admin as the victim. | step 14 / NFR-3 | Accepted — payloads never enter the DOM; the panel prints with `textContent`, and the badge carries only an integer index. Asserted by test. |
| security | minor | The endpoint must reject operator objects (`?waNumberId[$ne]=`) like the existing list route does. | step 6 | Accepted — reuse `isScalar` before anything reaches a query; asserted by test. |
| performance | major | An unbounded page number becomes an unbounded `skip`. | step 7 / NFR-2 | Accepted — count first, clamp the page to the last one. |
| performance | minor | A mixed sort order would not walk the conversation index (the caveat written into `models/Message.js` for this ticket). | step 6 / AC-10 | Accepted — the order is wholly ascending, and the sort spec is asserted by test. |
| performance | minor | Re-fetching the conversation on every scroll would undo the gain. | step 12 / AC-21 | Accepted — the loaded window is kept in memory and only extended. |

## Decision

`APPROVED`

- Rationale: the plan satisfies every acceptance criterion with a traceable
  step, keeps the change inside five files with no deployment runtime file
  among them, leaves persistence and the live path's behaviour untouched, and is
  reversible by reverting a single presentation file. The two conflicts inside
  the ticket's own criteria (D-1, D-2) are decided explicitly, with the security
  property each criterion protects preserved in both cases and carried into
  verification as its own check. Every major panel finding is accepted and has a
  corresponding step.

## Approvals

> Single self-approval by the ticket owner (no distinct reviewer, no second approver).

- Approver (owner): developer (self-review; comprehension gate passed 3/3 — see
  `comprehension.md`)

## ADR reference

- ADR: none. D-1 and D-2 are ticket-local readings of conflicting criteria, not
  architectural decisions; they are recorded in `plan.md` and verified by test.

## Required Follow-up Actions

- none — implementation may begin.
