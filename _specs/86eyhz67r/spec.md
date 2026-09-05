---
ticket: 86eyhz67r
stage: spec
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-08
links:
  clickup: https://app.clickup.com/t/86eyhz67r
  github:
---

# Spec — 86eyhz67r

> Define *what* must be true when done. **No implementation details, no file
> names, no code.**

## Feature Name

Complete outbound message recording on a unified conversation key, a single
clock, and measured storage caps.

## Business Goal

The stored message history is currently incomplete, mis-ordered and unbounded per
conversation, so nothing can be built on it. Only one outbound path records
anything; every other send — including anything the operator types on the phone —
leaves no trace. Records from the two directions are stamped from two different
clocks, one of them deliberately skewed by a human-typing delay, so a conversation
cannot be replayed in its true order. There is no conversation key, so a single
conversation cannot be read with one indexed query. And the storage cap is scoped
to the whole number, so one busy conversation reaching it erases every other
conversation's history.

Fixing these four things turns the message collection into a complete, correctly
ordered, bounded record — the foundation the debug-mode dashboard (ticket 3/4) is
read from, delivered without exhausting a 512 MB storage tier.

## User Story

> As SYSTEM (the WhatsApp gateway, recording a tenant's conversations), I want to
> be able to record every outbound message on the same conversation key and the
> same clock as inbound messages, under per-conversation storage limits, so that
> the stored history becomes a complete, correctly ordered and bounded record that
> a dashboard can safely be built on.

## Functional Requirements

- **FR-1 — Complete outbound capture.** Every outbound message sent on an
  in-scope session is recorded, regardless of which internal code path sent it,
  including a message the operator composes directly in the WhatsApp mobile app.
- **FR-2 — A single capture point.** Outbound capture happens in exactly one
  place, registered once per client. No send function anywhere gains a
  persistence call.
- **FR-3 — Exactly one record per message.** Where two writers describe the same
  message, they converge on one stored record identified by tenant + number +
  message id; whichever writes first creates it and the other enriches it.
- **FR-4 — Neither writer erases the other's fields.** Facts known only to the
  send path (the message a reply answers, whether the send succeeded, the failure
  reason, the captured debug metadata) survive a later write by the capture path,
  and facts known only to the capture path survive a later write by the send path.
- **FR-5 — A unified conversation key.** Every stored record carries a `chatId`
  identifying the conversation it belongs to: the chat the message was received
  from for inbound records, the chat it was sent to for outbound records. Both
  directions of one conversation therefore share one key. **Group chats are
  included**, keyed by the group's own chat identifier.
- **FR-6 — The conversation key never collides with sender identity.** `chatId`
  answers *where* a message belongs; the existing sender/recipient phone fields
  answer *who* sent or received it. In a group these differ by design — one
  conversation key, many senders. Neither field is derived from, nor overwritten
  by, the other.
- **FR-7 — One clock.** The ordering timestamp on records of both directions
  comes from the messaging platform's own message timestamp. The server clock is
  no longer an ordering source for stored messages.
- **FR-8 — A documented read order.** The canonical order for reading one
  conversation is by timestamp ascending, then record creation time ascending;
  the secondary key separates two messages sharing the same one-second timestamp.
- **FR-9 — A per-conversation cap.** The number of records retained for one
  conversation is capped at **150**. On overflow the oldest records *of that same
  conversation* are deleted first, in the documented read order.
- **FR-10 — Cap isolation.** A conversation reaching its cap deletes no record
  belonging to any other conversation.
- **FR-11 — A per-number cap.** The total records retained for one tenant +
  number are capped at **5,000**, deleting oldest-first across that number, so a
  number with very many conversations cannot exhaust storage. This is the storage
  ceiling; FR-10's isolation guarantee is a property of the per-conversation cap.
- **FR-12 — Age-based expiry.** Message records expire **90 days** after
  creation, bounding the accumulation of dead conversations without a scheduled
  job.
- **FR-13 — Debug metadata capture.** When the AI-agent webhook response carries
  a debug-metadata payload, it is stored on that reply's record in a
  `metadataDebug` field. Its absence is the normal case and produces no error, no
  warning, and no retry; the gateway never waits for it and never tracks its
  expiry.
- **FR-14 — Debug metadata size limit.** A payload exceeding **32 KB** is
  replaced by a marker recording that it was truncated and its byte count.
- **FR-15 — Debug metadata is recorded for failed sends too**, alongside the
  failure outcome.
- **FR-16 — Reply text purity.** The text delivered to the customer is
  byte-identical to the reply text supplied by the webhook. No diagnostic data
  passes through any send path.
- **FR-17 — A re-runnable backfill.** A one-shot backfill derives the
  conversation key for pre-existing records from their existing sender/recipient
  values, changes no other field, and modifies zero records on a second run.
- **FR-18 — Tenant safety.** Every recorded value for tenant and number is
  resolved from the session that produced the event, never from external input.
  An event whose tenant + number context cannot be resolved is dropped before any
  write.
- **FR-19 — Audit logging.** A storage failure is logged with tenant and number
  identifiers only. A cap deletion is logged with the number of records deleted
  and the conversation identifier. No log line carries message content, a full
  phone number, a secret, or a debug-metadata payload.
- **FR-20 — Storage-ceiling warning.** Crossing 70% of the 512 MB tier (358 MB)
  produces a warning, so the ceiling is discovered before a write fails.
- **FR-21 — Additive contract.** `chatId` and `metadataDebug` are additive
  fields. Every existing message-history and admin-message response keeps its
  current shape, and no webhook payload field exchanged with the AI agent is
  renamed or removed.
- **FR-22 — Automated coverage.** Hermetic tests cover ordering across both
  directions, conversation-key derivation, the per-conversation cap, and the
  32 KB truncation rule, and run as part of the project's test command.

## Non-Functional Requirements

- **NFR-1 — Recording never affects delivery.** Any storage failure is caught and
  logged; none is thrown to a caller, and none prevents or delays a message being
  sent.
- **NFR-2 — Bounded hot-path cost.** Cap enforcement uses index-covered queries;
  it must not introduce a collection scan on the per-message path.
- **NFR-3 — Storage discipline.** The change must reduce, not increase, the risk
  of exhausting the 512 MB tier. Added index cost is accounted for.
- **NFR-4 — No new runtime dependency** is introduced.
- **NFR-5 — Deterministic, hermetic tests.** Tests require no network, no
  database, and no messaging session, and are repeatable and non-interactive.
- **NFR-6 — Reversibility.** The change is additive and individually revertible;
  no existing stored record is rewritten except by the explicit backfill.
- **NFR-7 — No scheduled job** is introduced for expiry or cap enforcement.
- **NFR-8 — The storage-ceiling check is not evaluated per write** — it is
  throttled, so observability never becomes a hot-path cost.

## Constraints

- **C-1** No deployment runtime file may be modified.
- **C-2** No route file and no file under the public web assets directory may be
  modified. No new HTTP route and no new permission is introduced.
- **C-3** Capture must occur at a single point — the platform's
  outbound-message-created event — and never inside a send function.
- **C-4** The two caps are named constants defined once, not runtime
  configuration.
- **C-5** The legacy single-tenant send path is **excluded** — it is unused and
  slated for deletion, and it carries no tenant context (owner decision,
  2026-08-08). Requirement FR-1 applies to sessions that carry tenant + number
  context.
- **C-6** The deployment target is a 512 MB free storage tier.
- **C-7** The project has no test framework and no linter; tests are plain
  hermetic scripts wired into the existing test command.
- **C-8** The storage protection delivered by ticket 1/4 must not be undone:
  non-conversation chats (status broadcasts and channel posts) must remain
  unstored in **both** directions.
- **C-9** This ticket depends on ticket 1/4, which has shipped. The caps are
  sized against message records that no longer carry base64 media.

## Edge Cases

- **A send that fails** produces no outbound-message-created event. Recording the
  failure remains the responsibility of the existing send path, and such a record
  must still receive a platform-derived ordering timestamp — the timestamp of the
  message it answers — because the server clock is barred as an ordering source.
- **A successful send that returns no message id** cannot be correlated with its
  captured record. The captured record stands alone rather than a second document
  being created; the enrichment fields are absent for that record.
- **Inbound events reaching the outbound capture point** must be ignored, so
  inbound messages already recorded elsewhere are never stored twice.
- **Non-conversation chats** (status broadcasts, channel posts) must be dropped on
  the outbound side exactly as they already are on the inbound side.
- **Group conversations** produce one conversation key with many distinct senders;
  the AI-agent reply flow does not operate in groups, but group outbound messages
  from other flows are now recorded and counted against that group's cap.
- **Two writers racing** on the same message can collide on the uniqueness key;
  the collision must resolve into a single record rather than an error.
- **Records created before the conversation key existed** carry none, and are the
  backfill's responsibility; records whose key cannot be derived are skipped and
  counted rather than written with a placeholder.
- **A conversation whose key appears under two different platform identity forms**
  would split into two conversations. Reconciling platform identity forms is out
  of scope; the phone-number field remains the stable human-readable key.
- **A number with more than roughly 33 active conversations** reaches the
  per-number ceiling before most conversations reach their own cap; this is
  intended, and FR-10's isolation guarantee is scoped to the per-conversation cap.
- **Removing the old cap value** must not disturb unrelated numeric literals that
  merely contain the same digits.

## Open Questions

- Whether the messaging library emits the outbound-message-created event for
  messages composed on the operator's phone, and whether the destination chat is
  always populated on that event, cannot be confirmed from this repository — there
  is no existing use of that event to learn from. A fallback for resolving the
  destination chat may be required. To be settled at `/plan`.
- Whether the added index cost and the second per-message count query are
  acceptable on the 512 MB tier, to be stated at `/plan` as an explicit accepted
  trade-off.
- These are `/plan` concerns; neither blocks the acceptance criteria below.

## Acceptance Criteria Mapping

> Give each criterion a stable ID (AC-1, AC-2, …); `verify.md` references these.

| ID | Acceptance criterion | Maps to requirement |
|------|----------------------|---------------------|
| AC-1 | An outbound message sent through the generic send path is recorded exactly once, with outbound direction. | FR-1, FR-3 |
| AC-2 | An outbound message is recorded whatever internal path sent it — the messaging service, the agent message handler, shipment tracking, the admin and agent flows, and the webhook reply path. | FR-1 |
| AC-3 | A message the operator composes in the WhatsApp mobile app is recorded, carrying the same conversation key as the customer's inbound messages in that conversation. | FR-1, FR-5 |
| AC-4 | Outbound capture is registered exactly once per client, and re-attaching a session does not register it twice. | FR-2 |
| AC-5 | No persistence call exists inside any send function; no send function is modified. | FR-2, C-3 |
| AC-6 | An inbound event arriving at the outbound capture point is ignored, and no inbound message is stored twice. | FR-1, Edge Cases |
| AC-7 | A webhook reply produces exactly one stored record, not two, although two writers describe it. | FR-3 |
| AC-8 | That single reply record carries the identifier of the message it answers, and the debug metadata when the webhook supplied it. | FR-3, FR-13 |
| AC-9 | Fields known only to the send path are not erased by a later write from the capture path, and the reverse is equally true. | FR-4 |
| AC-10 | Two writers racing on the same message resolve into one record rather than an error. | FR-3, Edge Cases |
| AC-11 | Every stored record carries a conversation key: the originating chat for inbound records, the destination chat for outbound records. | FR-5 |
| AC-12 | A group conversation is recorded under the group's own conversation key, for both directions. | FR-5 |
| AC-13 | The conversation key is never derived from, nor overwritten by, the sender/recipient identity fields; a group yields one key with many senders. | FR-6 |
| AC-14 | A conversation can be read with one indexed query scoped to tenant, number and conversation key, ordered by time. | FR-5, NFR-2 |
| AC-15 | Records of both directions take their ordering timestamp from the messaging platform, and the server clock is no longer an ordering source for stored messages. | FR-7 |
| AC-16 | Six messages exchanged in a few seconds, alternating direction, read back in the same order the messaging app shows, with no reply preceding the message it answers. | FR-7, FR-8 |
| AC-17 | A record written for a failed reply carries a platform-derived ordering timestamp — that of the message it answers — not the server clock. | FR-7, Edge Cases |
| AC-18 | The canonical read order for one conversation is documented as timestamp ascending then creation time ascending. | FR-8 |
| AC-19 | A single named constant defines the per-conversation cap of 150, and no occurrence of the superseded cap value remains in the code. | FR-9, C-4 |
| AC-20 | Removing the superseded cap value leaves unrelated numeric literals that contain the same digits untouched. | FR-9, Edge Cases |
| AC-21 | The per-conversation cap is enforced on the scope tenant + number + conversation key. | FR-9 |
| AC-22 | A conversation exceeding its cap has only its own oldest records deleted; a second conversation with 20 stored messages still has all 20. | FR-9, FR-10 |
| AC-23 | Deletion on overflow removes records in the documented read order, oldest first. | FR-9, FR-8 |
| AC-24 | A second named constant bounds the total records for one tenant + number at 5,000, deleting oldest-first across that number. | FR-11, C-4 |
| AC-25 | Message records expire 90 days after creation, with no scheduled job introduced. | FR-12, NFR-7 |
| AC-26 | Cap enforcement uses index-covered queries and introduces no collection scan on the per-message path. | NFR-2 |
| AC-27 | Debug metadata supplied by the webhook is stored on that reply's record. | FR-13 |
| AC-28 | A debug-metadata payload larger than 32 KB is stored as a truncation marker carrying its byte count, and the record is still created successfully. | FR-14 |
| AC-29 | A webhook response with no debug metadata stores a null value, logs no warning or error, and the reply is delivered normally. | FR-13 |
| AC-30 | Debug metadata is recorded for a failed send attempt too, alongside the failure outcome. | FR-15 |
| AC-31 | The text delivered to the customer is byte-identical to the reply text supplied by the webhook, and no diagnostic field appears in the delivered message. | FR-16 |
| AC-32 | Run twice in a row, the backfill gives every eligible record a conversation key derived from its existing sender/recipient values, and the second run modifies zero records. | FR-17 |
| AC-33 | The backfill changes no field other than the conversation key, and skips and counts records whose key cannot be derived rather than writing a placeholder. | FR-17 |
| AC-34 | Every recorded tenant and number value is resolved from the session that produced the event, never from external input. | FR-18 |
| AC-35 | An event on a session whose tenant + number context cannot be resolved is dropped before any write, is logged without message content, and introduces no bypass ahead of the existing guard. | FR-18, FR-19 |
| AC-36 | No record outside the session's tenant is read, written or deleted. | FR-18 |
| AC-37 | Non-conversation chats (status broadcasts, channel posts) remain unstored in both directions, preserving ticket 1/4's protection. | C-8 |
| AC-38 | A storage failure is logged with tenant and number only — no message content, no full phone number — and is never thrown to a caller nor allowed to prevent delivery. | FR-19, NFR-1 |
| AC-39 | A cap deletion is logged with the number of records deleted and the conversation identifier, and no log line carries a secret or a debug-metadata payload. | FR-19 |
| AC-40 | Crossing 70% of the 512 MB tier produces a warning, and that check is not evaluated on every write. | FR-20, NFR-8 |
| AC-41 | Existing message-history and admin-message responses keep their current shape; the two new fields are additive, and no webhook payload field exchanged with the AI agent is renamed or removed. | FR-21 |
| AC-42 | Hermetic tests — no network, no database, no messaging session — cover ordering across both directions, conversation-key derivation, the per-conversation cap, and the 32 KB truncation rule. | FR-22, NFR-5 |
| AC-43 | Those tests are wired into the project's test command and pass. | FR-22 |
| AC-44 | No deployment runtime file, no route file, and no public web asset is modified, and no new HTTP route or permission is introduced. | C-1, C-2 |
| AC-45 | No new runtime dependency is introduced. | NFR-4 |

## Out of Scope

- Any screen, any dashboard, and any new read endpoint — owned by ticket 3/4.
- The response allow-list that shapes existing message-history responses — the
  two new fields deliberately stay invisible to the current API, and that file is
  not modified here.
- Applying the documented read order to existing read paths; this ticket
  documents the order and aligns deletion with it. Route files are out of scope.
- Media storage and offloading (ticket `86eye6ezn`).
- The debug API key, which the owner cancelled on 2026-08-06; the per-contact
  toggle authenticates with the number's existing webhook secret (ticket 4/4).
- The legacy single-tenant send path, excluded by owner decision (C-5).
- Reconciling the messaging platform's alternative identity forms for one
  contact; the phone-number field remains the stable human-readable key.
- Changing how a failed send is recorded by the existing send path, beyond giving
  its record a platform-derived ordering timestamp.
- Any change to deployment, infrastructure, or scheduled jobs.
