---
ticket: 86eyhz68a
stage: review
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: reviewer
updated: 2026-08-09
links:
  clickup: https://app.clickup.com/t/86eyhz68a
  github:
---

# Review — 86eyhz68a

> Review gate — run by the ticket owner themselves (self-review). A comprehension
> check at the gate is the integrity control. Evaluates the spec and plan before
> any implementation.

## Review Scope

`spec.md` (38 acceptance criteria, 12 test cases) and `plan.md` (7 steps, 8
files, decisions D-1..D-6), read against the ClickUp ticket, `research.md`,
`docs/debug_mode.html` §1, `docs/debug_mode_integration.html` §5, and the code
the plan touches: `routes/tenants.js`, `services/agentWebhookService.js`,
`models/WhatsAppNumber.js` and `public/contacts.html`.

## Plan Summary

One new route, `POST /api/admin/debug/toggle`, reshapes an authenticated admin
request into the contract `omni_agent` already implements: a literal
`#debug on`/`#debug off`, the customer's phone, an optional `ttl_minutes`, and
the targeted number's own `webhookSecret` in `X-Agent-Signature`. The upstream
URL comes from `OMNI_AGENT_URL` when set and otherwise from the origin of that
number's own webhook endpoint, so nothing new has to be deployed. HTTPS is
enforced before any packet leaves the process. Nothing is stored. The
conversations screen grows two explicit buttons and an optional TTL box on each
contact row, and shows them as unavailable with a reason when the number is not
configured — learned from one additive field on the contact read it already
performs.

## Risks

- **R-1 — a single key with two blast radii.** The webhook key now also grants a
  control that can target any number `omni_agent` serves. This is the owner's
  recorded decision (`docs/debug_mode_integration.html` §5) and its price is
  documented there; the mitigation the same section demands — mandatory HTTPS,
  never returned, never logged — is what the plan implements. Accepted, not
  discovered.
- **R-2 — the key travels raw.** HMAC is disabled at
  `services/agentWebhookService.js:123-127`, so the HTTPS guard is the only
  protection, not defence in depth. The plan puts the guard before every network
  call and refuses rather than degrading. Correct, and it must be proven by a
  test that counts upstream calls, not by inspection.
- **R-3 — D-1 derives the upstream URL from `webhookUrl` when no env var is set.**
  It could send the toggle to a host that is not the debug endpoint's owner. The
  plan's own argument is the mitigation: that host is by definition the instance
  holding this number's key, so credential and destination stay pinned together.
  A wrong URL fails closed (404/JSON-parse failure), never silently succeeds.
- **R-4 — D-2 diverges from ticket 3/4 on 401 vs 403.** Two sibling tickets now
  answer differently for the same class of failure. Acceptable because the
  divergence is confined to one route, no middleware changes, and the property
  both ACs protect — refuse, and make no upstream call — is preserved either way.
- **R-5 — D-3 modifies an existing response.** AC-33 says "adds one route". The
  plan adds one route and one *additive* field to an existing response, which
  keeps every existing field's name and meaning; the same route already carries
  additive fields from ticket 3/4. Judged compliant, and recorded explicitly so
  it is not discovered later.
- **R-6 — D-4 can refuse a legitimate contact.** A conversation with nothing
  stored cannot be targeted. Since 2/4 persists every inbound and outbound
  message, the window is narrow; the alternative (trusting a caller-supplied
  phone, or reading the WhatsApp session) is worse on both safety and NFR-3.
- **R-7 — a full customer phone in the audit line (D-5).** It is what AC-37 asks
  for and what makes a privileged action auditable. Narrower than 3/4's masked
  bulk-read logs: one deliberate operator action, not a read path.
- **R-8 — a third ticket editing `contacts.html`.** The 3/4 suite asserts over
  that file's text, so the plan requires running it as a regression. Adequate.

## Panel Findings

Advisory only (ADR-010 / RP-2) — informs the decision, never makes it.

| Lens | Finding | Severity | Owner's disposition |
|------|---------|----------|---------------------|
| senior | The feature is two small modules plus a UI block, and reuses the existing admin gate, tenant-scope rule and conversation index rather than inventing parallel ones. No new abstraction is introduced for a single caller. | minor | Accepted as-is. |
| senior | D-6 declines to reuse `sendWebhookWithRetry`. Correct: its 3× ladder is tuned for fire-and-forget events, and a retry behind an operator's button is a worse failure mode than a reported one. | minor | Accepted. |
| security | The credential is loaded in exactly one function, is never selected for the availability check (`exists` only), and cannot be influenced by the caller. Ensure the test asserts non-exposure over *captured log output*, not only over response bodies. | major | Adopted — the suite captures `console.warn/info/error` and asserts the secret appears in none of them. |
| security | The 500-with-stack path must not exist for a route holding a credential in scope. Prefer a local catch to the shared async handler, which logs the raw error. | major | Adopted — the route has its own catch and returns a structured error with no stack. |
| performance | One bounded upstream attempt, one indexed `exists`, one `findById` for the URL and one for the secret. Nothing is unbounded and nothing loops. The availability check adds one `exists` to a route that already performs a live WhatsApp read — immaterial against that cost. | minor | Accepted. |
| performance | `Message.exists` uses the `(tenantId, waNumberId, chatId)` prefix of the conversation index from 2/4 — an index seek, not a scan. | minor | Accepted. |

## Traceability Check

- Every requirement REQ-1..REQ-8 and NFR-1..NFR-5 is covered by at least one AC;
  every AC-1..AC-38 names its requirement (`spec.md` tables).
- Every AC maps to at least one of TC-1..TC-12, and every plan step traces to an
  AC group: step 1 → AC-11..AC-18; step 2 → AC-1..AC-10, AC-19, AC-28..AC-30,
  AC-36, AC-37; step 3 → AC-33; step 4 → AC-26; step 5 → AC-21..AC-27, AC-31,
  AC-32; steps 6–7 → the whole verification surface.
- `plan.md` satisfies PL-1..PL-5: approach, steps, files to change, validation
  strategy, rollback, out of scope — all present and specific.

## Comprehension Check

Completed — see `comprehension.md` § "Review gate": 3/3 correct (CG-4 threshold
100% met). Questions were derived from `plan.md` decisions D-1, D-3 and D-6.

## Decision

`APPROVED`

## Rationale

The plan is the smallest change that satisfies the acceptance criteria: two new
files, one mount line, one additive field, one UI block, one test suite. It
stores nothing, so it has no migration and no state to get wrong. The three
handling conditions the design document makes mandatory — HTTPS before the wire,
never returned, never logged — are each an explicit step with an explicit test,
and the two `major` panel findings that strengthened them were adopted before
approval. The three open questions from intake are all closed with a stated
rationale, and the two places where this ticket knowingly departs from a literal
reading (D-2's status code, D-3's additive field) are recorded here rather than
left to be discovered at `/verify`.

## Required Follow-up Actions

None. Proceed to `/implement` on branch `ticket/86eyhz68a`, cut from
`ticket/86eyhz682` while 3/4 is unmerged (see `ticket.md` § Dependency).
