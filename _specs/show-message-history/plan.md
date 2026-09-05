---
ticket: show-message-history
stage: plan
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-07-29
links:
  clickup: https://app.clickup.com/t/86eyekrvm
  github:
---

# Plan — show-message-history

> Decide the approach before changing code. Plan only — no implementation here.

## Approach

Extend the existing `Message` collection with an outbound shape rather than
introducing a second collection, so the retention cap, the tenant/number scoping,
and the existing admin list endpoint all keep working unchanged (AC-21, AC-26,
AC-47, AC-61). The webhook relay records its own outcome **after** the send call
returns, inside its existing `try/catch`, so nothing is added before or during the
typing delay and no rejection can escape the fire-and-forget call (AC-14, AC-62).
Delivery state arrives from a new per-session `message_ack` listener that updates
records by WhatsApp id within tenant+number scope, guarded by a monotonic status
rank so acknowledgements can only move a record forward (AC-15..AC-20).

Alternatives rejected: a separate `OutboundMessage` collection (breaks the shared
cap in AC-47 and forces the list endpoint to merge two sources); awaiting
persistence before the send (violates AC-14); and reusing `extractSenderPhone`
unchanged for the recipient (returns the raw `@lid` identifier where AC-8 requires
`null`).

**Six decisions resolve the spec's open questions.** Each is an assumption this
plan commits to; the review gate is where they are ratified or sent back:

- **D1 — Recipient phone.** Add a *new* recipient-resolution helper rather than
  changing `extractSenderPhone`. The existing helper returns the raw `@lid` JID on
  contact-lookup failure and also feeds the inbound webhook payload; changing it
  would alter inbound behaviour that AC-48 protects. The new helper returns `null`
  on failure, satisfying AC-8 with no ripple.
- **D2 — Tenant isolation (AC-32).** Enforce scoping from the admin JWT claims in
  the two handlers: when the token carries a `tenantId` claim, every query is
  forced to that tenant and a request naming a different tenant returns 403. A
  token with no such claim (today's platform-admin token) keeps full access, so
  no existing caller breaks. No new middleware, no change to `adminAuth`.
- **D3 — Sender identity on an outbound record.** Store the gateway's own JID
  (from the connected client's info) as `from`, and relax the model's `from`
  requirement to apply only when `direction !== "outbound"`. Inbound writes always
  set `from`, so inbound validation is unchanged (AC-48); an unresolvable gateway
  JID then degrades to a stored `null` instead of silently dropping the record.
- **D4 — Shared cap (AC-47).** Extract the existing cap-enforcement block from
  `storeInboundMessage` into a private helper called by both the inbound and
  outbound paths. The inbound path keeps identical behaviour; the cap counts both
  directions because it counts documents by tenant+number, which it already does.
- **D5 — Message History placement.** Render the view as a new section inside the
  dashboard rather than a redirect to a new page, because AC-34 gates rendering on
  the admin token already held in the dashboard's configuration panel. This
  departs from the existing `navigateToMessages` redirect pattern; AC-35 and AC-34
  are the governing criteria.
- **D6 — Verification evidence.** Name the `node-source` profile for the changed
  JavaScript and record a documented manual runtime procedure for the criteria a
  syntax check cannot reach (AC-15..AC-20, AC-62). Introducing a test framework is
  **not** in scope for this ticket.

**Scope note (not a scope change):** this plan covers all 62 acceptance criteria
across five files, which sits against CLAUDE.md's one-ticket-one-outcome rule. The
natural split is Phase 1+2 (persistence and delivery tracking) / Phase 3+4 (API and
docs) / Phase 5 (UI). The plan is written whole; splitting is the owner's decision
at `/review`.

## Steps

**Phase 1 — Data model (AC-3, AC-8, AC-9..AC-12, AC-49..AC-51, AC-60)**

1. Add outbound fields to the message schema: `direction` (enum `inbound` /
   `outbound`, default `inbound`), `to`, `toPhone` (default `null`), `source`
   (enum `inbound` / `webhook_reply`, default `inbound`), `sendSucceeded`,
   `failureReason` (default `null`), `status` (enum `pending` / `sent` /
   `delivered` / `read` / `played` / `failed`), `statusUpdatedAt`, and
   `repliesToMessageId` (default `null`) for the inbound pairing.
2. Relax `from` to be required only when `direction !== "outbound"` (D3), leaving
   inbound validation unchanged.
3. Add a validator enforcing that `failureReason` is `null` whenever
   `sendSucceeded` is `true` (AC-51).
4. Add an index supporting acknowledgement lookups by tenant + number + message
   id, and one supporting the new list sorts; leave the existing unique index on
   `{tenantId, waNumberId, messageId}` untouched.

**Phase 2 — Recording and delivery tracking (AC-1..AC-20, AC-47, AC-53..AC-55, AC-62)**

5. Extract the existing 500-record cap block from `storeInboundMessage` into a
   private `enforceMessageCap(tenantIdObj, waNumberIdObj)` helper and call it from
   the same place, preserving current behaviour exactly (D4, AC-47, AC-48).
6. Add a private `resolveRecipientPhone(msg)` helper (D1): for a plain chat id,
   normalize the number part; for an `@lid` id, resolve via the contact record and
   normalize; return `null` on any failure — never the raw identifier (AC-6..AC-8).
7. Add a private `storeOutboundMessage({...})` that writes one record with the
   Phase 1 fields, normalizes the WhatsApp id before storing, substitutes a
   locally generated id when the send returned none, calls `enforceMessageCap`,
   and catches every error — logging with the existing `[MESSAGE_STORAGE]` prefix
   and reporting to Sentry with `subsystem: "db"` (AC-4, AC-12, AC-54, AC-62).
8. In the webhook relay, capture the result of the send call, and after it returns
   record a success entry with `status: "sent"`, the resolved recipient phone, the
   inbound message's WhatsApp id as the pairing reference, and
   `source: "webhook_reply"` (AC-1..AC-3, AC-9, AC-13).
9. In the relay's `catch`, record a failure entry with `sendSucceeded: false`,
   `status: "failed"`, and `failureReason` from the thrown error, and report it to
   Sentry with tenant, number, and recipient context (AC-10, AC-53).
10. In the relay's no-client branch, record a failure entry naming the missing
    client, then return as it does today (AC-11).
11. Leave every existing early return untouched so a failed webhook, non-JSON
    body, empty reply, or group chat still produces no record (AC-5). Verify by
    inspection that no recording call precedes the typing delay (AC-14).
12. Add a `handleMessageAck(session, msg, ack)` that normalizes the id, maps the
    acknowledgement code to a status, and updates the matching record only when
    the new status outranks the stored one and the record did not fail to send —
    expressed as a conditional update so a lower code is a no-op and an unknown id
    matches nothing (AC-16..AC-20).
13. Register a `message_ack` listener in `attachInboundHandlersToSession`, guarded
    by a `listenerCount` check mirroring the existing `message` listener, with its
    own `.catch` so nothing throws into the client (AC-15, AC-19).
14. Confirm no new info-level log line carries a body, recipient number, or media
    payload (AC-55).

**Phase 3 — Admin API (AC-21..AC-33, AC-52, AC-58)**

15. In the list handler, add `direction`, `status`, and `source` filters with
    vocabulary validation, returning 400 with a structured error naming the
    offending parameter on any invalid value (AC-22, AC-29, AC-49, AC-50).
16. Treat a `direction=inbound` filter as "inbound or field absent" so pre-change
    records are included with no migration (AC-60).
17. Add a `search` filter matched case-insensitively against message id, body,
    `toPhone`, and `from`, with the leading `+` tolerated, composed with the other
    filters so combinations narrow rather than replace (AC-23).
18. Add `sortBy` (`createdAt` / `updatedAt` / `timestamp`) and `sortDir`, defaulting
    to `createdAt` descending, replacing the current fixed sort (AC-24).
19. Clamp `limit` to a maximum of 200 instead of rejecting a larger value (AC-52).
20. Add the new fields to the formatted response objects, leaving every existing
    field and the response envelope untouched (AC-25, AC-26, AC-61).
21. Apply the D2 tenant-claim scoping to the list handler: force the tenant filter
    when the admin token carries a tenant claim, and return 403 on a mismatch
    (AC-32, AC-33).
22. Add a `GET /admin/messages/:id` handler behind the same `adminAuth`, returning
    the full untruncated record plus `failureReason` and the paired inbound
    message id, 404 with a structured error for an unknown id, and the same D2
    tenant scoping (AC-27, AC-28, AC-30, AC-31, AC-58).

**Phase 4 — API documentation (AC-56, AC-57, AC-59)**

23. Extend the existing `/api/admin/messages` documentation entry with the new
    query parameters and response fields, and add a documented entry for the
    detail endpoint, using the same status and source vocabularies as the code.

**Phase 5 — Dashboard view (AC-34..AC-46)**

24. Add a Message History entry point to the dashboard's button group that reveals
    a new history section, rendering nothing and requesting nothing until an admin
    token is present in the configuration panel (AC-34, AC-35).
25. Render the table with the columns in order: index, WA ID, Sent To, Source,
    Content, Status, Created, Updated, Actions — with Sent To showing `toPhone` and
    falling back to the raw recipient identifier when it is null (AC-36, AC-37).
26. Render Source and Status as badges using the API's vocabularies, with the
    status colour mapping green / grey / red (AC-38, AC-39, AC-57).
27. Add the filter bar — search box, Status, Source, Sort By, Direction, and Clear
    — with every control mapped to a query parameter and no client-side-only
    filtering; Clear resets to defaults and reloads the unfiltered first page
    (AC-40, AC-41, AC-56).
28. Truncate long content with an ellipsis and wire the row's eye action to the
    detail endpoint, showing the failure reason and the paired inbound message in
    the detail view (AC-42, AC-43).
29. Add pagination over the existing limit/skip contract with the total count, an
    inline error state that clears the table rather than leaving stale rows, and an
    explicit empty-state message (AC-44..AC-46).

**Phase 6 — Validation**

30. Run the `node-source` profile over every changed JavaScript file and record the
    result per acceptance criterion, plus the manual runtime procedure for the
    criteria a syntax check cannot reach (D6).

## Files to change

- `models/Message.js` — add the outbound fields, the conditional `from`
  requirement, the `failureReason` validator, and the supporting indexes.
- `services/inboundHandlers.js` — extract `enforceMessageCap`; add
  `resolveRecipientPhone`, `storeOutboundMessage`, and `handleMessageAck`; record
  success/failure/no-client outcomes inside the existing webhook relay; register
  the guarded `message_ack` listener.
- `routes/tenants.js` — extend the `GET /admin/messages` handler (filters,
  search, sort, clamp, new response fields, tenant-claim scoping) and add the
  `GET /admin/messages/:id` handler.
- `config/swagger/swaggerPaths.js` — document the new query parameters, the new
  response fields, and the detail endpoint.
- `public/dashboard.html` — add the Message History section: entry point, table,
  filter bar, badges, pagination, detail view, and error/empty states.

**No deployment runtime file is touched** (`docker-compose.yml`,
`docker-compose.prod.yml`, `Dockerfile`, `docs/nginx-whatsapp.conf`,
`docs/build-and-push-staging.yml`, `docs/deploy-staging.yml`) — GU-2 / IM-5.

## Validation strategy

- Validation profile: `node-source`
- The profile covers the four changed JavaScript files. `public/dashboard.html` is
  not JavaScript source and is **not** covered by it — its criteria (AC-34..AC-46)
  are verified by inspection plus the manual procedure below.
- Every acceptance criterion is mapped in `verify.md` to one of three evidence
  kinds, and the kind is stated per criterion:
  - **profile** — the `node-source` result for the changed files.
  - **inspection** — the criterion is a structural property readable in the diff
    (field present, guard preserved, early return untouched, vocabulary shared).
  - **runtime** — requires a live session; covered by the manual procedure.
- Manual runtime procedure (recorded in `implement.md`, results in `verify.md`):
  send an inbound message to a connected number whose webhook returns a non-empty
  reply, and confirm the record appears with `sent` and advances to `delivered`
  and `read`; repeat with a group chat and with a reply-less webhook response to
  confirm no record; force a send failure to confirm the failure reason; stop the
  database to confirm the reply is still delivered and no unhandled rejection is
  raised.
- Existing-consumer check: load the standalone messages page against the extended
  endpoint and confirm unchanged behaviour (AC-61).

## Rollback

- All changes land as a single publishable commit on `ticket/show-message-history`;
  reverting that commit restores every file to its current state.
- No data migration is performed, so a revert leaves only additive, unread fields
  on any records written in the meantime — harmless to the pre-change code paths.
- The schema changes are additive and defaulted, so records written before or
  after a revert remain readable by both versions.
- If only the UI proves faulty, the dashboard section can be reverted on its own;
  the API remains backward compatible because the response envelope and existing
  fields are unchanged.

## Out of scope

- The retired AI-agent and customer-support reply paths.
- A retry action to resend a failed reply.
- OTP, shipment-group, and admin-initiated sends.
- The live WhatsApp-Web history endpoints.
- `public/messages.html` — verified as an existing consumer, not modified.
- Any change to how inbound messages are stored today.
- Introducing a test framework or test harness (D6).
- Any change to deployment runtime files.
