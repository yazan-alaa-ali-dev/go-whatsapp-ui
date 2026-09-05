---
ticket: show-message-history
stage: spec
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-07-29
links:
  clickup: https://app.clickup.com/t/86eyekrvm
  github:
---

# Spec — show-message-history

> Define *what* must be true when done. **No implementation details, no file
> names, no code.**

## Feature Name

Message History for webhook bot replies with delivery status

## Business Goal

Every reply the gateway sends back to a customer comes from the tenant's AI agent
webhook, and today that reply is invisible: it is not recorded, its send outcome
is discarded, and WhatsApp's delivery acknowledgements are never observed. When a
tenant reports "the bot never answered", there is no evidence either way and the
only recourse is reading server logs. This feature gives an ADMIN a first-class
record of every relayed reply — recipient, content, send outcome, and delivery
state — so a tenant dispute can be settled with evidence and a silent delivery
failure can be diagnosed without log access.

## User Story

> As an ADMIN of the WhatsApp gateway, I want a Message History screen that lists
> every reply the gateway sent back from the AI agent's webhook response, with the
> recipient, the content, whether the send succeeded or failed with its reason,
> and the WhatsApp delivery state (sent / delivered / read), so that I can prove
> to a tenant whether their customer actually received and read the bot's answer,
> and diagnose a silent delivery failure without reading server logs.

## Functional Requirements

- **REQ-1 — Record the relayed reply.** Every reply the gateway actually relays to
  a customer from a webhook response produces exactly one stored message record.
- **REQ-2 — Record only real send attempts.** No record is produced when the
  gateway does not attempt a send.
- **REQ-3 — Identify the recipient by phone number.** Each record carries the
  customer's phone number as WhatsApp identifies them, distinct from the raw chat
  identifier, so an operator can find a conversation by typing a plain number.
- **REQ-4 — Record the send outcome.** Each record states whether the send
  succeeded, and on failure carries a human-readable reason.
- **REQ-5 — Pair the reply with the message it answers.** Each reply record
  references the inbound customer message that triggered it.
- **REQ-6 — Track delivery state.** WhatsApp delivery acknowledgements update the
  matching record's status over time, within its tenant and number scope.
- **REQ-7 — Expose history through the admin messages list API.** The existing
  admin messages list gains direction, status, source, search, and sort
  capabilities while keeping its current contract intact.
- **REQ-8 — Expose a single-record detail API.** An admin can retrieve one full
  record, including untruncated content, failure reason, and the inbound message
  it answers.
- **REQ-9 — Authorize every read.** Message data is returned only to an
  authenticated admin. *(The tenant-scoped-caller half of this requirement was
  transferred out on 2026-07-29 — see Out of Scope and retired AC-32.)*
- **REQ-10 — Provide a Message History view in the admin dashboard.** An operator
  can browse, filter, search, sort, paginate, and inspect records from the admin
  console.
- **REQ-11 — Preserve retention behaviour.** The existing per-tenant-and-number
  record cap continues to apply, now counting inbound and outbound records
  together and removing the oldest first.
- **REQ-12 — Constrain the data vocabulary.** Direction, status, and source accept
  only their defined values, and request limits are bounded.
- **REQ-13 — Report failures to the audit surfaces.** Send failures and storage
  failures are reported to error monitoring with tenant and number context.
- **REQ-14 — Document the API.** The extended list endpoint and the new detail
  endpoint are described in the project's API documentation surface.
- **REQ-15 — Remain backward compatible.** Existing stored records and existing
  consumers of the messages API keep working with no migration.

## Non-Functional Requirements

- **NFR-1 — Zero added reply latency.** Recording must not delay the reply to the
  customer, and must not lengthen the existing human-like typing delay.
- **NFR-2 — Reply resilience.** A recording or storage failure must never prevent
  the reply from being delivered, and must never surface as an unhandled
  rejection on the fire-and-forget relay path.
- **NFR-3 — Delivery-tracking resilience.** Processing an acknowledgement must
  never throw into the WhatsApp client or disconnect the session.
- **NFR-4 — Tenant isolation.** Every read is scoped by tenant; no query path may
  return another tenant's record.
- **NFR-5 — Log hygiene.** No message body, recipient number, or media payload is
  written to any log line at info level.
- **NFR-6 — UI/API consistency.** Every filter offered in the UI corresponds to a
  documented query parameter; the UI performs no client-side-only filtering, and
  both surfaces use the same status and source vocabularies.
- **NFR-7 — Bounded queries.** List responses are paginated and capped so a single
  request cannot request an unbounded result set.
- **NFR-8 — Error-response consistency.** API errors use the same structured error
  shape as the existing admin endpoints.

## Constraints

- The reply relay is invoked fire-and-forget from the inbound path; anything added
  to it must respect that (no blocking, no escaping rejection).
- Reply content is produced by a separate AI project and reaches the gateway only
  as a field of the webhook response; the gateway relays it and does not generate
  it.
- Stored records are already required to carry a tenant and a WhatsApp number, and
  a record's WhatsApp message id is unique within that tenant-and-number scope.
- WhatsApp message ids must be normalized before storage; the current relay path
  does not normalize, and an unnormalized id resolves to nothing after the
  WhatsApp Web key rename.
- Inbound message storage keeps its current behaviour and fields; this feature
  adds records rather than changing existing ones.
- The per-tenant-and-number cap of 500 records is retained and now shared between
  directions.
- The repository has no test framework; only a syntax-level check is defined, so
  runtime behaviours are not automatically testable.

## Edge Cases

- The webhook response is not JSON, has no reply field, or has an empty reply.
- The inbound message came from a group chat.
- The session has no active WhatsApp client at relay time.
- The send throws (for example, the recipient identifier cannot be resolved, or
  the underlying browser call times out).
- The send returns no message id at all.
- The recipient's chat identifier carries no phone number and the contact lookup
  fails.
- An acknowledgement arrives for a message that has no record.
- A later acknowledgement carries a lower state than one already recorded.
- An acknowledgement arrives for a record whose send already failed.
- Records stored before this feature exist with no direction value.
- The database is unreachable at the moment a reply is relayed.
- A list request asks for more records than the allowed maximum.
- A filter is supplied with a value outside its allowed vocabulary.
- A query returns no records at all.

## Open Questions

- When the recipient's identifier carries no phone number and the contact lookup
  fails, the specification requires a null phone number; the existing sender-phone
  resolution behaviour returns the raw identifier instead. Which behaviour wins,
  and is changing the shared resolution behaviour (which also feeds the outbound
  webhook payload for inbound messages) acceptable?
- The admin messages endpoint is authenticated by an admin token that carries no
  tenant or role claim today. What mechanism backs the requirement that a
  tenant-scoped caller receives 403 for another tenant's records — a tenant-scoped
  route, a claim check, or something else?
- Stored records currently require a sender identity. What value should an
  outbound record carry for it — the gateway's own number, the recipient, or
  should the field become optional for outbound records?
- Sharing the 500-record cap between directions roughly halves retained inbound
  history for a busy number. Is that acceptable, or should the cap be raised or
  made direction-aware?
- Should Message History be rendered as a section within the admin dashboard (as
  stated) or as a separate page reached by the dashboard's existing navigation
  behaviour, which redirects rather than renders in place?
- With no test framework in the repository, what evidence satisfies the
  verification gate for the runtime criteria (acknowledgement ordering, recipient
  resolution, send-failure recording) — a documented manual runtime procedure, or
  is introducing a test harness part of this work?
- This specification covers persistence, delivery tracking, two API surfaces, and
  a new UI view. The governance rules require one ticket to deliver one focused
  outcome and anything larger to be split. Should this be split into separate
  tickets, and if so, at what boundary?

## Acceptance Criteria Mapping

> Give each criterion a stable ID (AC-1, AC-2, …); `verify.md` references these.

| ID    | Acceptance criterion | Maps to requirement |
|-------|----------------------|---------------------|
| AC-1  | Every reply actually relayed to a customer from a webhook response produces exactly one stored record. | REQ-1 |
| AC-2  | Each reply record carries a non-null tenant and WhatsApp number, resolved from the same session context the inbound message used. | REQ-1, NFR-4 |
| AC-3  | Each reply record stores: outbound direction, the recipient chat identifier actually used for sending, the resolved recipient phone number, the reply content, the WhatsApp message id, the source value identifying it as a webhook reply, and the send timestamp. | REQ-1 |
| AC-4  | The stored WhatsApp message id is normalized, so it is never null as a result of the WhatsApp Web message-key rename. | REQ-1 |
| AC-5  | No record is created when the webhook call failed, the response body is not JSON, the reply field is missing or empty, or the chat is a group. | REQ-2 |
| AC-6  | The recipient phone number is stored in international format with no chat-identifier suffix, resolved by the same contact-resolution behaviour used for inbound senders. | REQ-3 |
| AC-7  | For a recipient whose chat identifier carries no phone number, the stored phone number is resolved via the contact record and never contains that identifier. | REQ-3 |
| AC-8  | When the phone number cannot be resolved, the stored phone number is null and the raw chat identifier remains available on the record; no placeholder or fabricated number is stored. | REQ-3 |
| AC-9  | On a successful send the record stores a success outcome and the WhatsApp message id returned by the send. | REQ-4 |
| AC-10 | When the send throws, the record stores a failure outcome, a failed status, and a failure reason set to the thrown error's message. | REQ-4 |
| AC-11 | When the relay cannot send because the session has no active client, a record is written with a failure outcome and a failure reason naming the missing client. | REQ-4 |
| AC-12 | When the send returns no message id, the record is still written with a success outcome and a locally generated id, so two such records never collide on the uniqueness constraint. | REQ-4 |
| AC-13 | Each reply record references the inbound customer message it answers, by that message's WhatsApp id, so the two can be shown as a pair. | REQ-5 |
| AC-14 | Recording happens after the send call returns, does not lengthen the typing delay, and a recording error is caught inside the relay and never becomes an unhandled rejection. | NFR-1, NFR-2 |
| AC-15 | A delivery-acknowledgement listener is registered once per session and is never attached twice. | REQ-6 |
| AC-16 | Each acknowledgement updates the matching record by WhatsApp message id within its tenant and number scope, setting the status and a status-updated timestamp. | REQ-6, NFR-4 |
| AC-17 | Acknowledgement codes map to statuses as: failed, pending, sent, delivered, read, played. | REQ-6, NFR-6 |
| AC-18 | Status only moves forward: a later, lower acknowledgement never downgrades a record that already reached a higher state, and its status-updated timestamp is unchanged. | REQ-6 |
| AC-19 | An acknowledgement for a message id with no record is ignored without creating a record, throwing, or dropping the session. | REQ-6, NFR-3 |
| AC-20 | A record whose send failed keeps its failed status and failure reason; no acknowledgement overwrites it. | REQ-6, REQ-4 |
| AC-21 | The admin messages list accepts its existing filters unchanged (tenant, number, sender, message type, group, reply, forwarded, start date, end date, limit, skip). | REQ-7, REQ-15 |
| AC-22 | The admin messages list additionally accepts direction, status, and source filters. | REQ-7 |
| AC-23 | The admin messages list accepts a search term matched against the WhatsApp message id, the content, the recipient phone number, and the sender — so a plain customer number matches with or without a leading plus. | REQ-7 |
| AC-24 | The admin messages list accepts a sort field (created, updated, or message timestamp) and a sort direction, defaulting to created-descending. | REQ-7 |
| AC-25 | Each returned record includes direction, recipient identifier, recipient phone number, status, status-updated timestamp, send outcome, failure reason, and source, in addition to the fields returned today. | REQ-7 |
| AC-26 | The admin messages list response keeps its current shape, so existing consumers do not break. | REQ-7, REQ-15 |
| AC-27 | The detail endpoint returns one full record including the untruncated content and, when present, the failure reason and the id of the inbound message it answers. | REQ-8 |
| AC-28 | A detail request for an unknown record returns 404 with a structured error body. | REQ-8, NFR-8 |
| AC-29 | An invalid filter value returns 400 with a structured error naming the offending parameter, and returns no records. | REQ-12, NFR-8 |
| AC-30 | Both the list and detail endpoints require a valid admin token. | REQ-9 |
| AC-31 | A request with a missing, expired, or malformed admin token returns 401 and no message data. | REQ-9 |
| AC-32 | *(retired — transferred to ClickUp task [86eyf1u2n](https://app.clickup.com/t/86eyf1u2n) on 2026-07-29 by owner decision; see Out of Scope. The ID is retired and never reused.)* | — |
| AC-33 | A history query filtered to one tenant never returns a record belonging to another tenant. | NFR-4 |
| AC-34 | The Message History view is not rendered until an admin token is present in the dashboard configuration, and with no token no message data is requested or displayed. | REQ-9, REQ-10 |
| AC-35 | The admin dashboard offers a Message History entry point that opens the history view. | REQ-10 |
| AC-36 | The view renders a table with the columns, in order: index, WhatsApp id, sent-to, source, content, status, created, updated, actions. | REQ-10 |
| AC-37 | The sent-to column shows the recipient's phone number in international format with no chat-identifier suffix, and falls back to the raw chat identifier when the phone number is null — never blank, never a fabricated number. | REQ-3, REQ-10 |
| AC-38 | Source is rendered as a badge using this product's values (webhook reply, inbound). | REQ-10, NFR-6 |
| AC-39 | Status is rendered as a coloured badge: green for sent, delivered, read, and played; grey for pending; red for failed. | REQ-10, NFR-6 |
| AC-40 | A filter bar above the table offers a search box, a status dropdown defaulting to all statuses, a source dropdown defaulting to all sources, a sort-by dropdown defaulting to created date, a direction dropdown defaulting to descending, and a clear control. | REQ-10 |
| AC-41 | The clear control resets every filter to its default and reloads the unfiltered first page in the default sort order. | REQ-10 |
| AC-42 | Long content is truncated in the cell with an ellipsis, and the row action opens the full record from the detail endpoint. | REQ-10, REQ-8 |
| AC-43 | The detail view of a failed record shows its failure reason, and the detail view of a reply also shows the inbound customer message it answers. | REQ-10, REQ-5 |
| AC-44 | The table is paginated and shows the total record count. | REQ-10, NFR-7 |
| AC-45 | An API error surfaces as an inline error message and leaves the table empty; no stale rows from a previous query remain visible. | REQ-10, NFR-8 |
| AC-46 | An empty result set shows an explicit empty-state message rather than a blank table. | REQ-10 |
| AC-47 | The record cap of 500 per tenant-and-number counts inbound and outbound records together and deletes the oldest first, preserving the existing behaviour. | REQ-11 |
| AC-48 | Inbound message storage keeps its current behaviour and fields; this change adds records and does not alter existing ones. | REQ-11, REQ-15 |
| AC-49 | Direction accepts only inbound or outbound; any other value is rejected. | REQ-12 |
| AC-50 | Status accepts only pending, sent, delivered, read, played, or failed. | REQ-12 |
| AC-51 | The failure reason is null whenever the send outcome is success. | REQ-12, REQ-4 |
| AC-52 | A requested limit above 200 records is clamped to 200 rather than rejected. | REQ-12, NFR-7 |
| AC-53 | A failed reply send is reported to error monitoring with the tenant, the number, and the recipient, using the existing error-reporting helper. | REQ-13 |
| AC-54 | A record-storage failure is logged with the existing message-storage log prefix and reported to error monitoring as a database-subsystem failure. | REQ-13 |
| AC-55 | No message content, recipient number, or media payload is written to any log line at info level. | NFR-5 |
| AC-56 | Every filter offered in the UI maps to a documented query parameter on the list endpoint; the UI applies no client-side-only filtering. | NFR-6 |
| AC-57 | The UI and the API expose the same status vocabulary and the same source vocabulary. | NFR-6 |
| AC-58 | API errors are returned in the same structured shape as the existing admin endpoints. | NFR-8 |
| AC-59 | The extended list endpoint and the new detail endpoint are documented in the project's API documentation surface alongside the existing entry. | REQ-14 |
| AC-60 | Records stored before this change, which carry no direction, are treated as inbound on read and render in the history with no data migration. | REQ-15 |
| AC-61 | The existing standalone messages page continues to load the same records without error and without modification. | REQ-15 |
| AC-62 | When the database is unreachable, the storage failure is logged and reported and no unhandled rejection is raised. *(Narrowed 2026-07-30 — the "the reply is still delivered to the customer" half was transferred out; see Out of Scope.)* | NFR-2, REQ-13 |

## Out of Scope

- **Tenant-scoped admin authorization (transferred 2026-07-29).** Former AC-32 —
  "a tenant-scoped caller reading another tenant's records receives 403" — was
  removed from this ticket by owner decision at the `/verify` gate and now lives
  in ClickUp task
  [86eyf1u2n](https://app.clickup.com/t/86eyf1u2n).
  **Why:** the enforcement code shipped and is live (`resolveAdminTenantScope`),
  but the only admin-token issuer signs `{sub, role: "platform_admin"}` with no
  `tenantId` claim, so the 403 branch is unreachable by any token the system
  produces. Making it reachable means changing `routes/adminAuth.js` and
  `middleware/adminAuth.js` — both outside this ticket's approved "Files to
  change" list, so it could not be done here without a plan revision. AC-33
  (query-level tenant filtering) stays in scope and is satisfied.
- **Reply delivery during a database outage (transferred 2026-07-30).** The second
  half of the original AC-62 — "when the database is unreachable, the reply is
  still delivered to the customer" — was removed from this ticket by owner
  decision at the `/verify` gate and needs its own ticket
  (**ClickUp task: _to be created_**).
  **Why:** executed evidence (see `implement.md` → plan step 30) shows the reply is
  never sent during an outage, because the per-number webhook URL is read from
  MongoDB (`agentWebhookService.getWebhookConfig` → `WhatsAppNumber.findById`). With
  the database down the gateway cannot learn where to send the webhook, so no
  webhook response — and therefore no reply — exists. **This is pre-existing
  behaviour, not a regression:** the same lookup gated the reply before this
  ticket; the ticket's runtime verification exposed it. Satisfying it requires
  resolving webhook configuration independently of the storage path, i.e. changing
  `services/agentWebhookService.js` and/or `handleInboundMessage` — neither is in
  this ticket's approved "Files to change" list, so it could not be done here
  without a plan revision. The retained half of AC-62 (storage failure is logged
  and reported, no unhandled rejection) stays in scope and is satisfied by executed
  evidence. **Impact worth flagging on the new ticket:** a MongoDB outage silently
  stops *all* AI-agent replies, not just their recording.
- The retired AI-agent and customer-support reply paths.
- A retry action to resend a failed reply (a new mutation path; its own ticket).
- OTP sends, shipment-group sends, and admin-initiated sends.
- The live WhatsApp-Web history endpoints.
- The existing standalone messages page, which stays as it is.
- Any change to how inbound messages are stored today.
- Any change to deployment runtime configuration.
