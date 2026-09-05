---
ticket: 86eyhz67r
stage: research
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: ai_agent
updated: 2026-08-08
links:
  clickup: https://app.clickup.com/t/86eyhz67r
  github:
---

# Research — 86eyhz67r

> Read-only phase. **No implementation is allowed in this command.**

## Goal

Record every outbound message — whatever code path sent it, including messages
the operator sends from the WhatsApp mobile app — on the same conversation key
(`chatId`) and the same WhatsApp clock (`msg.timestamp`) as inbound messages, via
a single `message_create` listener, and replace the unscoped 500-record cap with
per-conversation / per-number caps, a 90-day TTL, and captured `metadata_debug`.

## Relevant directories

- `services/` — the whole persistence layer and listener registration live here.
  `inboundHandlers.js` (1753 lines) is the primary file: it owns
  `enforceMessageCap` (:658), `nonConversationChatKind` (:740),
  `storeInboundMessage` (:757), `storeOutboundMessage` (:859),
  `handleMessageAck` (:970), `maybeSendWebhookReply` (:1029),
  `handleInboundMessage` (:1166) and `attachInboundHandlersToSession` (:1720).
  It also holds the log-redaction helpers `redactJid` (:38), `redactPhone` (:57),
  `redactWaIds` (:75) and `redactMsgId` (:91).
- `models/` — `Message.js` holds the schema and its five compound indexes;
  `OtpRecord.js:47` is the repo's only existing TTL-index precedent.
- `utils/` — `normalizeMsgId.js:78` restores `id._serialized` after the
  WhatsApp Web ≥ 2.3000 rename to `$1`; every id reader depends on it.
- `routes/` — the read side. `tenants.js` (1390 lines) holds
  `formatMessageRecord` (:1263) and the `/admin/messages` route (:1304);
  `admin.js`, `agent.js`, `messages.js`, `voice.js` and `history.js` each contain
  send sites. **This ticket declares every route file out of scope.**
- `scripts/` — where `test_inbound_persistence_slimming.js` (414 lines) already
  establishes the hermetic-test pattern this ticket must extend, and where the
  one-shot `chatId` backfill script will live.
- `config/swagger/` — `swaggerPaths.js` documents `/api/admin/messages` (:1596).

## Relevant config files

- `package.json` — `scripts.test` is currently the single command
  `node scripts/test_inbound_persistence_slimming.js`. The Testing acceptance
  criteria require new hermetic scripts wired into `npm test`, so this file must
  change. There is **no** test framework and **no** linter in the dependency
  tree; `mongoose ^8.9.0` and `whatsapp-web.js ^1.34.6` are the relevant runtime
  deps.
- `db.js` — exports `connectToDatabase` and `mongoose`; every store function
  awaits `connectToDatabase()` first, and the backfill script will need it too.
- `.env` / `.env.example` — runtime configuration. **Not** used by this ticket:
  the caps are literal named constants (decision D-11).
- `server.js:74` — `sessionManager.registerOnSessionCreated((session) => attachInboundHandlersToSession(session))`
  is the single wiring point through which the new listener will be registered.
- **Deployment runtime files — read for understanding only, never modified:**
  `docker-compose.yml`, `docker-compose.prod.yml`, `Dockerfile`,
  `docs/nginx-whatsapp.conf`, `docs/build-and-push-staging.yml`,
  `docs/deploy-staging.yml`. This ticket has no reason to touch any of them, and
  an acceptance criterion states so explicitly.

## Possibly affected services

- **`services/inboundHandlers.js`** — carries essentially the entire change: the
  new `message_create` registration alongside the existing `message` (:1728) and
  `message_ack` (:1757) guards, the rewrite of `enforceMessageCap` to a
  chat-scoped cap, the timestamp change in `storeOutboundMessage` (:908,
  currently `Math.floor(Date.now() / 1000)`), `chatId` on both writers, and
  `metadataDebug` capture inside `maybeSendWebhookReply`.
- **`models/Message.js`** — additive `chatId` and `metadataDebug` fields, the
  compound index `{tenantId, waNumberId, chatId, timestamp: -1}`, and a 90-day
  TTL index on `createdAt`.
- **`services/inboundSessionResolver.js`** — `resolveInboundContextFromSession`
  (23 lines) is the existing tenant-safety guard; it verifies the session is
  still the live session for its key before returning `{tenantId, waNumberId}`.
  The new listener reuses it unchanged — it is what satisfies the "no resolvable
  tenant context → drop before any write" criterion.
- **Every in-scope send site becomes an implicit contributor without being
  edited.** A read-only sweep found roughly 20 `sendMessage` / `sendTextMessage`
  call sites across `services/messagingService.js` (:60, :108, :118, :146),
  `services/agentMessageHandler.js` (`sendTextMessage` :608 with 11 callers),
  `services/shipmentTracking.js` (:487, :493, :516, :537, :586, :620),
  `routes/admin.js` (:73, :168), `routes/agent.js` (:94) and
  `services/inboundHandlers.js` (:1092). None persists anything today. Capturing
  in the listener means none of them is modified — exactly what the "no
  persistence call is added inside any send function" criterion requires.
- **`services/messageQueue.js`** (449 lines) — wraps `sendTextMessage` as its
  send function; it inherits capture through the listener with no change.
- **`services/whatsapp.js` — explicitly OUT of scope (decision D-3).** It holds a
  module-level global single-tenant `client` (`sendMessageSafe` :176) used by
  `routes/messages.js` and `routes/voice.js`. The owner confirmed this path is
  unused and slated for deletion, so it is excluded rather than worked around.
- **`routes/tenants.js`** — *not modified*, but its `formatMessageRecord` is an
  explicit allow-list (:1263–1300), so the two new schema fields are invisible to
  the existing API by construction. That is what makes "existing history routes
  keep their current contract" true without touching the file.
- **`services/sessionManager.js`** — owns session creation and therefore when
  handlers attach; relevant to reasoning about reconnects and double attachment.

## Test / validation commands available

*(listed only — this stage runs nothing)*

- `npm test` — currently runs only `scripts/test_inbound_persistence_slimming.js`;
  the new hermetic scripts must be added to this script entry.
- `node scripts/test_inbound_persistence_slimming.js` — the existing suite;
  it drives the real `inboundHandlers.js` pipeline with every collaborator
  replaced in `require.cache` (no database, no network, no Puppeteer, no
  WhatsApp), attaches a fake session, and exits non-zero on any failed check.
  It already stubs `models/Message` with recording `findOneAndUpdate` / `create` /
  `countDocuments` / `find` / `deleteMany`, so cap and ordering assertions can be
  built on the same rig.
- `node scripts/<new-test>.js` — the same pattern for the new coverage
  (ordering across directions, `chatId` derivation, per-conversation cap, 32 KB
  truncation).
- `node --check <file>` — syntax validation; there is no linter configured.
- No database-backed or integration test command exists, and none should be
  introduced: the criteria require the tests to be hermetic.

## Design decisions (owner-approved, 2026-08-08)

> These resolve every conflict found below into one coherent design, so `/spec`
> and `/plan` can be written against a settled blueprint. Each decision names the
> conflict it removes.

**D-1 — `chatId` covers group chats, and never collides with sender identity.**
`chatId` is the **conversation key**: the raw serialized jid of the chat, stored
exactly as WhatsApp reports it and never normalized — `msg.from` when
`msg.fromMe` is false, `msg.to` when it is true. Group chats are included: a
group's key is its `@g.us` jid, for both directions.
*The conflict to avoid:* `extractSenderPhone` (:618) deliberately reads
`msg.author` / `msg.id.participant` for groups, because it answers a different
question — **who** sent the message. `chatId` answers **where** it was sent.
These two must stay separate: `senderPhone` / `toPhone` remain the identity
fields, `chatId` is never derived from them and never overwritten by them. The
existing `isGroup` boolean stays as it is. A single group therefore yields one
`chatId` with many senders, which is correct.

**D-2 — one clock: `msg.timestamp` for both directions.**
`storeOutboundMessage` stops using `Math.floor(Date.now() / 1000)` (:908).
*The conflict this raised:* a **failed** send emits no `message_create` event, so
it has no WhatsApp timestamp — yet `maybeSendWebhookReply` still writes a
`sendSucceeded: false` record (:1056, :1143). **Resolution:** a failed reply
inherits the timestamp of the inbound message it answers
(`messageData.timestamp`, itself a WhatsApp clock value read at :1198). It
therefore sorts adjacent to the message it replies to, and the documented
secondary key `createdAt` places it after. No `Date.now()` is used as an ordering
source anywhere. Sends that fail outside the reply path emit no event and are not
this ticket's concern — the criteria already assign failure recording to the
existing send path.
*Not a conflict:* the `local_<Date.now()>_<random>` fallback **id** (:895) may
keep using `Date.now()`; an identifier is not an ordering source.

**D-3 — the legacy single-tenant path is out of scope.**
`services/whatsapp.js`, `routes/messages.js` and `routes/voice.js` are excluded.
The owner confirmed the path is unused and will be deleted, so no bridge is
built for it. `/spec` must narrow the acceptance criterion that currently lists
`services/whatsapp.js` among the paths to cover, otherwise that AC is
unsatisfiable and would fail at `/verify`.

**D-4 — disjoint field ownership, so neither writer can erase the other.**
Both writers use `findOneAndUpdate` on `{tenantId, waNumberId, messageId}` with
`upsert: true` and an **explicit `$set` containing only the fields that writer
owns**. No writer ever mentions a key it does not own, so no `null` can overwrite
another writer's value. Keys whose value is `undefined` are omitted from `$set`
rather than written as `null`.

| Owner | Fields |
|---|---|
| `message_create` listener (WhatsApp truth) | `chatId`, `direction`, `from`, `to`, `timestamp`, `waMessageType`, `isGroup`, `isForwarded`, `isReply`, `originalMessageId`, `body`, `caption`, `filename`, media fields |
| `maybeSendWebhookReply` (gateway truth) | `source`, `toPhone`, `repliesToMessageId`, `sendSucceeded`, `failureReason`, `status`, `statusUpdatedAt`, `metadataDebug` |
| `handleMessageAck` (unchanged) | `status`, `statusUpdatedAt` |
| `$setOnInsert` only | `tenantId`, `waNumberId`, `messageId`, plus each writer's default for a field the other owns |

*Implementation caution:* mongoose treats a plain update object as an implicit
`$set` of **all** its keys — which is precisely how `storeInboundMessage`
(:817–821) currently erases fields. The explicit-`$set`-of-owned-keys rule must
be followed literally.
*Concurrency:* two upserts racing on the same unique key can raise a duplicate-key
error (`code 11000`). Catch it and retry the operation once; the retry finds the
now-existing document and updates it.

**D-5 — the `sendSucceeded` / `failureReason` invariant moves to its owner.**
The `pre("validate")` hook (`Message.js:168`) is document middleware and will not
run on an upsert, so it can no longer be the guard.
**Resolution — enforce it where it is already enforced:** `maybeSendWebhookReply`
is the sole owner of both fields (D-4) and already computes
`failureReason: sendSucceeded ? null : failureReason || null` (:913). Keeping that
expression at the single write site makes the invariant true by construction.
The hook is **left in place** (it still protects any `.create()` / `.save()`
elsewhere), and `runValidators: true, context: "query"` is added to the upserts so
schema-level rules (enum, required) still apply. This is a deliberate, documented
downgrade from document middleware to write-site enforcement — it must appear in
`plan.md`, not be discovered at review.

**D-6 — caps delete oldest-first, in a fixed order.**
Confirmed by the owner: on reaching a limit, the oldest records are deleted.
1. **Per-conversation** — `countDocuments({tenantId, waNumberId, chatId})`,
   covered by the new compound index. Over `MESSAGE_CAP_PER_CHAT` (150), delete
   the excess **within that chat only**, ordered `{timestamp: 1, createdAt: 1}`.
2. **Per-number** — `countDocuments({tenantId, waNumberId})`, covered by the
   existing `{tenantId, waNumberId, timestamp: -1}` index. Over
   `MESSAGE_CAP_PER_NUMBER` (5000), delete the excess **across the whole number**,
   same ordering.
Both counts are index-covered, so the hot path stays two indexed queries plus a
delete only when overflowing. Deletion ordering deliberately matches the
documented read order `{timestamp: 1, createdAt: 1}` — the current code sorts by
`createdAt` alone (:672), which would disagree with the new clock.
*No conflict with the caps' scopes:* the per-number sweep may remove records from
a quiet conversation, which is intended — it is the storage ceiling, not the
per-conversation fairness rule. The "one busy conversation does not erase the
others" criterion is about the **per-chat** cap and must be specified that way.

**D-7 — TTL is a floor, the caps are a ceiling.**
`MessageSchema.index({createdAt: 1}, {expireAfterSeconds: 7776000})` (90 days),
following the `OtpRecord.js:47` precedent. Age-based expiry and count-based caps
are independent and cannot contradict each other: TTL bounds dead conversations,
caps bound live ones. No scheduled job is added.

**D-8 — `metadataDebug` truncation is measured in bytes.**
`Buffer.byteLength(JSON.stringify(payload), "utf8")`; above 32768 store
`{truncated: true, bytes: N}` instead of the payload. Type `Mixed`, default
`null`. An absent `metadata_debug` is the normal case: `null`, no warning, no
retry. The reply text sent to the customer stays `parsed.reply` verbatim — the
diagnostic payload never touches a send function.

**D-9 — the 358 MB warning is throttled, never per-write.**
A `db.stats()` call on every stored message is unacceptable on the hot path.
Evaluate lazily from the store path at most **once per hour** (cached result,
non-blocking, failures swallowed), and log the crossing of 70% of 512 MB once per
transition rather than on every check.

**D-10 — the backfill script is idempotent by filter, and unit-tested pure.**
`scripts/backfill_message_chat_id.js`: selects only records missing a `chatId`
(`{chatId: {$in: [null, undefined]}}`), derives
`chatId = direction === "outbound" ? to : from`, and writes `$set: {chatId}` and
nothing else, in batched `bulkWrite`s. Re-running it matches zero records, so the
second run modifies nothing. Records whose derivation yields no value are skipped
and counted, never written with a placeholder. The **derivation function is
exported and covered by a hermetic test**; the script itself needs a real
connection and is run manually, which keeps the test suite database-free.

**D-11 — the caps are literal named constants.**
`MESSAGE_CAP_PER_CHAT = 150` and `MESSAGE_CAP_PER_NUMBER = 5000`, each declared
once at module level in `services/inboundHandlers.js`. Not env-overridable — the
criterion says "a single named constant … defined once".

**D-12 — logging reuses the existing redaction helpers.**
A cap deletion logs the deleted count and `redactJid(chatId)`. A storage failure
logs `tenantId` / `waNumberId` only — no body, no full number. No log line
carries a `metadata_debug` payload. These helpers already exist at :38–:91 and
must be used rather than re-invented.

**D-13 — the listener normalizes ids first, or the two writers desynchronize.**
The `message_create` handler must call `normalizeMsgId(msg)` before reading
`msg.id._serialized`, exactly as the `message` listener does (:1731). WhatsApp Web
≥ 2.3000 renamed `_serialized` to `$1` (`utils/normalizeMsgId.js:78`), so an
unnormalized read yields `null` — the upsert key would not match the id
`maybeSendWebhookReply` computes at :1107, and one logical message would become
two documents. Registration is guarded by
`client.listenerCount("message_create") === 0`, mirroring :1757, and the handler
returns immediately when `msg.fromMe` is false so inbound is never double-stored.

**D-14 — the outbound path must reuse the non-conversation filter.**
`nonConversationChatKind` (:740) is applied only inside `storeInboundMessage`
(:761). The new writer must apply it to the resolved `chatId` too, or outbound
`status@broadcast` and `@newsletter` records start accumulating again and undo
ticket `86eyhz678`, which was merged four days ago specifically to remove them
(74.4% of stored bytes). Groups and 1:1 chats are unaffected — the helper
classifies on the chat id alone.

**D-15 — the "no literal 500" sweep must not corrupt the typing delay.**
The cap literal appears at :665, :666, :667 and in comments at :648, :748, :839,
:1619. `services/inboundHandlers.js:1087` also contains `1500`
(`Math.max(words * perWordMs + jitterMs, 1500)`) — the minimum typing delay,
entirely unrelated. A blind search-and-replace of `500` would break human-like
typing. The change must be made at the identified sites only.

**D-16 — a successful send that returns no id writes only from the listener.**
`maybeSendWebhookReply` writes its reply-owned fields only when it has the real
`messageId` (:1107) or when the send **failed** (no event will ever exist, so the
`local_` id cannot duplicate anything). In the rare case of a successful send
that returns no id, the reply path writes nothing and logs it at info level: the
listener's record still carries the message, while `repliesToMessageId` and
`metadataDebug` are absent for that record. This is preferred over inventing a
correlation key that would produce two documents for one message — the "exactly
one record" criterion outranks the enrichment.

## Risks and unknowns

Each risk below is either resolved by the decision named, or remains a genuine
unknown to be confirmed at `/plan`.

- **Upsert loses the document validator.** → Resolved by **D-5** (write-site
  enforcement by the field's sole owner + `runValidators` on the query).
- **`$set` erases the other writer's fields.** → Resolved by **D-4** (disjoint
  ownership, explicit `$set`, `undefined` omitted rather than nulled).
- **The legacy single-tenant client cannot be covered.** → Resolved by **D-3**
  (out of scope; the AC must be narrowed at `/spec`).
- **Ticket 1/4's protection bypassed outbound.** → Resolved by **D-14**.
- **A failed send has no WhatsApp timestamp.** → Resolved by **D-2**.
- **The `local_` id defeats the upsert.** → Resolved by **D-16**.
- **Cap scoping changes query cost.** → Mitigated by **D-6** (both counts
  index-covered). *Residual:* the per-message query count goes from one to two.
  On an M0 tier this is expected to be negligible but is not measured; `/plan`
  should state it as an accepted trade-off.
- **Index and storage budget on an M0 512 MB tier.** `Message` already carries
  four compound indexes plus ~nine single-field ones. **D-1** and **D-7** add two
  more, and index bytes count against the very ceiling this ticket defends.
  *Residual:* the added index cost is not measured. Medium impact, low
  likelihood of being decisive after base64 removal freed 99.1% of the bytes.
- **Cap arithmetic interacts.** 150 per conversation against 5000 per number
  means a number with more than ~33 active conversations reaches the per-number
  cap first, so per-conversation isolation weakens on the busiest numbers. **D-6**
  makes this explicit and intended rather than surprising.
- **Unverified whatsapp-web.js behaviour — the one true unknown.** That
  `message_create` fires for messages sent from the phone, and that `msg.to` is
  populated on every such event (including `@lid` chats), is assumed by the
  criteria and cannot be confirmed from this repo: there is no existing
  `message_create` usage to learn from. `/plan` must either cite the library's
  documented behaviour or carry a fallback (`msg.to || (await msg.getChat()).id._serialized`).
- **`@lid` vs `@c.us` identity split.** If WhatsApp reports one direction of a
  conversation under an `@lid` jid and the other under `@c.us`, one conversation
  would split into two `chatId`s. `messagingService.js:115` shows the codebase
  already contends with LID quirks. **D-1** stores the raw jid deliberately;
  `toPhone` remains the stable human-readable key, and reconciling LID identities
  is out of scope here. Flagged so `/plan` records it rather than meeting it in
  production.
- **Line references in the ClickUp description have drifted** after ticket 1/4
  landed. The old-limit comments cited at `:648`, `:724`, `:1569` are now at
  `:648`, `:665`–`:667`, `:748`, `:839` and `:1619`; `msg.fromMe` is at `:1169`
  (cited `:1130`), the inbound timestamp at `:1198` (cited `:1159`), the outbound
  timestamp at `:908` (cited `:869`), the typing delay at `:1086` (cited `:1048`)
  and the `message_ack` registration at `:1757` (cited `:1707`). Intent is
  unchanged; the anchors are stale and `/spec` should use the corrected ones.

## Open questions

All ten questions raised by this research were put to the owner and answered on
2026-08-08. They are recorded here with their decisions; the design section above
carries the resulting rules.

1. **Are group chats in scope for `chatId`?** → **Yes.** Group chats are
   included, and the design must keep the conversation key from colliding with
   sender identity (**D-1**).
2. **What timestamp does a failed send carry?** → **Unify the clock as the ticket
   states**; the failed reply inherits the answered message's WhatsApp timestamp
   (**D-2**).
3. **Is the legacy single-tenant path in scope?** → **No** — unused and slated
   for deletion (**D-3**).
4. **Which writer owns which fields?** → **Implement the correct method with no
   conflict**: disjoint ownership with explicit `$set` (**D-4**).
5. **What replaces the `pre("validate")` invariant?** → **Use the best
   approach**: write-site enforcement by the sole owner, hook retained,
   `runValidators` on the query (**D-5**).
6. **How do the caps and TTL interact?** → **Delete the oldest on reaching the
   storage limit** (**D-6**, **D-7**).
7. **Where is the 358 MB warning evaluated?** → Best practice: throttled, never
   per-write (**D-9**).
8. **Constants or env-overridable caps?** → Literal named constants (**D-11**).
9. **Backfill script name and validation?** → `scripts/backfill_message_chat_id.js`,
   idempotent by filter, pure derivation function unit-tested (**D-10**).
10. **Is the read order applied or only documented?** → Only documented here;
    route files are out of scope and the read change belongs to ticket 3/4
    (**D-6** aligns deletion ordering with it).

**Still open — to be settled at `/plan`, not blocking `/spec`:**

- Confirmation of `message_create` semantics in `whatsapp-web.js ^1.34.6` for
  phone-originated messages and for `msg.to` on `@lid` chats, and whether a
  `getChat()` fallback is required.
- Whether the added index cost and the second per-message `countDocuments` are
  acceptable on the M0 tier, stated as an explicit accepted trade-off.
- The exact narrowing wording for the acceptance criterion that currently names
  `services/whatsapp.js` (**D-3**), which `/spec` must author.

## Notes

- No code was changed during research.
- No deployment runtime files were modified.
