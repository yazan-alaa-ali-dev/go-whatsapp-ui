---
ticket: 86eyhz682
stage: plan
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-09
links:
  clickup: https://app.clickup.com/t/86eyhz682
  github:
---

# Plan — 86eyhz682

> Decide the approach before changing code. Plan only — no implementation here.

## Approach

Add one admin read endpoint that serves a single conversation straight from
MongoDB with an indexed equality query, widen the shared message allow-list by
two fields, and rework the contacts screen to read from that endpoint by default
while keeping the existing live read behind an explicit control. Nothing about
persistence, capture or the live path's behaviour changes: the live route gains
one log line and nothing else.

The alternative — replacing the live path outright — was rejected by the ticket
itself and by the data: MongoDB holds nothing from before the gateway connected,
and the in-page backtracking plus failure-cause classification from `86eyg6x90`
are already paid for. Keeping them as an on-demand fallback costs nothing.

## Decisions on the two open points

**D-1 — how the WhatsApp number reaches the endpoint.** The ticket fixes the
route as `GET /api/admin/conversations/:chatId/messages`, which carries no
number, while AC-3 requires every query to filter on `waNumberId` and AC-1
forbids scope from being client-asserted. Today's admin token carries neither a
tenant nor a number claim (`routes/adminAuth.js:37`), so *some* selector must
come from the caller; the question is only what it is allowed to decide.

Decision: keep the route exactly as named and accept `waNumberId` as a
**resource selector**, never as an authorization input. The number's own stored
record supplies the tenant, and that tenant is then checked against the caller's
token claim through the existing `resolveAdminTenantScope`. A caller-supplied
`tenantId` is not read on this route at all. The security property AC-1 exists
to guarantee therefore holds in full: no client value can widen scope, and a
foreign `chatId` is either refused or simply matches nothing.

Rejected alternative: moving the number into the path
(`/admin/wa-numbers/:id/conversations/:chatId/messages`). It satisfies the
letter of "not a query parameter" but renames the contract the ticket fixes in
seven places, including its test cases — a worse trade than a documented
reading of one clause.

**D-2 — the status code for an unauthenticated request.** AC-7 asks for 403;
AC-6 requires reusing the same authentication as the existing admin routes, and
that middleware answers **401** for absent or invalid credentials, which is also
the correct HTTP semantic. Changing it would alter every admin route in the
service — outside this ticket's scope and a regression risk for other callers.

Decision: reuse the middleware unchanged. Unauthenticated → 401, wrongly-scoped
→ 403. Both refuse, both return a structured error, neither returns message
data, which is the property AC-7 protects. The screen treats 401 and 403
identically, so the operator-visible behaviour is exactly what the AC describes.

## Steps

1. Extend `formatMessageRecord` with `chatId` and `metadataDebug`, additively,
   leaving every existing key untouched (AC-31, AC-32).
2. Add conversation constants — default page size 50, maximum 200, maximum
   conversation-key length, and the accepted chat suffixes (`@c.us`, `@g.us`,
   `@lid`, mirroring the live path so `status@broadcast` and `@newsletter`
   stay unreachable).
3. Add a conversation-key validator that *accepts or rejects* and never
   rewrites: the stored key is the raw jid, so normalising here would look up a
   different conversation.
4. Add a log-masking helper for conversation keys — a chat id *is* the
   customer's phone number, and AC-35 forbids logging one whole.
5. Add clamps: page size to `[1, 200]` with a non-numeric value falling back to
   the default; page number to a positive integer (AC-12, AC-29).
6. Add `GET /api/admin/conversations/:chatId/messages` behind `adminAuth`:
   reject operator objects, validate the key, validate and load the number,
   resolve the tenant from that record and check it against the token claim
   (403 + masked log on mismatch), then count, clamp the page against the count,
   and read with equality on `{tenantId, waNumberId, chatId}` sorted
   `{timestamp: 1, createdAt: 1}` (AC-1..AC-3, AC-9, AC-10, AC-34).
7. Count before reading so an over-maximum page clamps to the last page: an
   unbounded page number is otherwise an unbounded `skip` that the index still
   has to walk (NFR-2).
8. Never consult `sessionManager` on this route — that absence is what makes
   AC-13 true by construction.
9. Add one `console.info` at the entry of the live admin route recording tenant
   and number, so the fallback's frequency is measurable (AC-36). Behaviour,
   backtracking and cause classification are not touched (AC-18).
10. In `contacts.html`, load the newest stored message per conversation in one
    bounded call to the existing list endpoint and use it for the contact-list
    preview, falling back to WhatsApp's own preview only where nothing is stored
    (AC-19).
11. Derive the contact list from stored conversations when WhatsApp cannot be
    read at all, so a disconnected session still leaves conversations reachable
    (AC-20).
12. Open a conversation from the new endpoint, keep the loaded page window in
    memory, and extend it on scroll — older pages prepend, newer pages append,
    with scroll position preserved (AC-16, AC-21).
13. Move the live read behind a "Fetch from WhatsApp" control that sends the
    same request body it sends today, keeps the same warning handling, and is
    disabled with a stated reason when the session is unusable (AC-17, AC-20).
14. Render the 🔎 badge only when `metadataDebug` is non-null, holding payloads
    in a JS array indexed by message position — never serialised into the DOM —
    and open them in a panel that prints via `textContent` (AC-22, AC-23,
    NFR-3).
15. Present the truncation marker as its own notice with the byte count, not as
    JSON and not as an error (AC-24).
16. Show a dedicated refusal state on 401/403 with the conversation view hidden
    outright (AC-8), and add no global debug-state indicator anywhere (AC-25).
17. Add a hermetic test script and wire it into `npm test`.

## Files to change

- `routes/tenants.js` — the two new allow-list fields, the conversation
  constants and helpers, and the new read endpoint.
- `routes/history.js` — one additive `console.info` on the live admin route.
  Nothing else in this file changes.
- `public/contacts.html` — stored-first conversation view, paging, the live
  fallback control, the diagnostics badge and panel, the refusal state.
- `scripts/test_conversation_read_endpoint.js` — new hermetic test script.
- `package.json` — add that script to `scripts.test`.

No deployment runtime file is in this list, and none may be touched (AC-4).
`models/Message.js`, `services/inboundHandlers.js` and the capture path are
deliberately absent (AC-5).

## Validation strategy

- Validation profile: none.
- `node scripts/test_conversation_read_endpoint.js` — mounts the real router on
  a real Express app bound to an ephemeral loopback port, with the database,
  session manager and WhatsApp collaborators replaced in `require.cache`, and
  drives the endpoint over HTTP. Covers ordering and tie-breaks, page and
  page-size clamping, filter key order, absence of any session lookup,
  cross-tenant refusal and its log, malformed keys, empty conversations,
  diagnostics pass-through including the truncation marker, and the additive
  list contract. The dashboard half is covered by source assertions over
  `public/contacts.html`, which has no test harness.
- `npm test` — the new script plus both existing suites, to prove 1/4 and 2/4
  still hold.
- `node -e "require('./routes/tenants.js')"` — router loads.
- Parse-check the dashboard's script block with `node --check`.

## Rollback

- Primary, non-destructive: revert `public/contacts.html`. The screen returns to
  reading live from WhatsApp; the new endpoint stays deployed and unused, and no
  data is affected either way — this ticket writes nothing.
- Full: revert the commit. There is no migration, no index change and no schema
  change to undo; the two added response fields are additive, so any consumer
  that ignored them is unaffected by their disappearance.

## Out of scope

- Media rendering from storage (`86eye6ezn`).
- The per-contact Enable/Disable control (`86eyhz68a`, 4/4).
- Any change to persistence, capture, caps, indexes or retention.
- Any change to the live path's behaviour.
- Any deployment runtime file.
