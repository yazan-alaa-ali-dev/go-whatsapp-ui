---
ticket: 86eyhz67r
stage: implement
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-08
links:
  clickup: https://app.clickup.com/t/86eyhz67r
  github:
---

# Implement — 86eyhz67r

> Record of what was actually built, following `plan.md` revision 4 and the
> binding implement-time corrections I-1..I-17 recorded in `review.md`.

Branch `ticket/86eyhz67r`, created from clean `main` at `e803d4d`.

**Resumed 2026-08-08** after `/verify` returned FAILED, to close the two test
coverage gaps it identified (AC-7, AC-8). No production code changed on the
resume — only `scripts/test_outbound_capture_and_caps.js` gained checks. See
"Resume — coverage added" below.

## Changes made

- **`models/Message.js`** — added `chatId` (conversation key, string, default
  null) and `metadataDebug` (mixed, default null). Added the conversation index
  `{tenantId, waNumberId, chatId, timestamp: 1, createdAt: 1}` and the partial
  index `metadata_debug_retention`
  (`{tenantId, waNumberId, createdAt: -1}` with
  `partialFilterExpression: {metadataDebug: {$type: "object"}}`). Documented the
  canonical read order and its mixed-direction caveat beside the conversation
  index, recorded that the expiry index is created out of band and would be
  dropped by a future `syncIndexes()`, and recorded that the `pre("validate")`
  hook is now inert. The `source` enum is unchanged.
- **`services/inboundHandlers.js`** — the bulk of the change:
  - eleven named constants replacing the unscoped 500-record cap;
  - `isChatIdentifier` / `resolveChatId` — the conversation key, read only from
    chat-identifier fields, with `msg.id.remote` as fallback;
  - `clampMetadataDebug` + a recursive `sanitizeMetadataValue` with depth,
    breadth and cycle detection;
  - `upsertMessageRecord` — explicit `$set`/`$setOnInsert` with a duplicate-key
    retry;
  - `enforceStorageBounds` — per-conversation cap inline and key-guarded;
    per-number ceiling and debug-metadata retention behind one unconditional
    60-second throttle, detached with a log-and-swallow catch;
  - `maybeWarnDatabaseSize` — throttled, reads logical size;
  - `storeInboundMessage` converted to explicit `$set` of owned fields + `chatId`;
  - `storeOutboundMessage` converted to an upsert with disjoint ownership and the
    two-branch message-id rule;
  - `maybeSendWebhookReply` — recipient-phone resolution hoisted above the send,
    body-size guard, metadata capture, answered-message timestamp;
  - `handleOutboundMessageCreate` + its `message_create` registration;
  - stale 500-limit comments updated;
  - pure helpers exported for the hermetic tests.
- **`scripts/create_message_ttl_index.js`** *(new)* — reports the collection's
  age distribution and how many records the expiry index would delete, then
  creates it only behind `--confirm`.
- **`scripts/backfill_message_chat_id.js`** *(new)* — exported pure
  `deriveChatId`, plus a dry-run-by-default, `--tenant`/`--limit`-scopable,
  `_id`-range-batched backfill that writes `chatId` and nothing else.
- **`scripts/test_outbound_capture_and_caps.js`** *(new)* — 57 hermetic checks.
- **`scripts/test_inbound_persistence_slimming.js`** — pre-authorised stub
  changes only: `unwrapUpdate` flattens `$set`/`$setOnInsert`, a flexible
  `queryChain` accepts `skip`, and an `updateMany` recorder was added. No
  assertion was weakened or removed.
- **`package.json`** — `test` now runs both suites.

## Changes prepared (uncommitted)

> `/implement` creates **no commit** (IM-9 / ADR-008); there are no SHAs to
> record here. The single publishable commit is created later by `/publish-pr`.

- `models/Message.js` — modified
- `services/inboundHandlers.js` — modified
- `scripts/test_inbound_persistence_slimming.js` — modified
- `package.json` — modified
- `scripts/create_message_ttl_index.js` — new
- `scripts/backfill_message_chat_id.js` — new
- `scripts/test_outbound_capture_and_caps.js` — new
- `_specs/86eyhz67r/` — workflow artifacts

`git status` shows exactly these and nothing else (IM-4).

## Deviations from plan

All are the binding corrections recorded in `review.md`; each overrides the plan
text it contradicts, as that review specified.

- **I-1 (mandatory).** The retention sweep filters on
  `metadataDebug: {$type: "object"}`, **not** `{$ne: null}` as `plan.md` step 6b
  reads. The two must be byte-identical to the index's `partialFilterExpression`
  or MongoDB will not select the partial index — negations are excluded from its
  containment algebra — and the sweep would silently fall back to scanning the
  number's whole record set. No "not null" predicate exists anywhere in the sweep.
- **I-2.** The truncation marker is a plain object, so one predicate describes
  every carrier and the largest payloads cannot escape the sweep.
- **I-5.** `resolveChatId` applies the shared `isChatIdentifier` predicate, not
  only the backfill.
- **I-6.** Concrete values chosen for the constants the plan named without
  values: sanitiser depth 8, sanitiser breadth 128, webhook body limit 256 KB.
- **I-7.** The failed branch's `$setOnInsert` includes `chatId` and
  `status: "failed"`.
- **I-8.** `resolveRecipientPhone` is resolved **before** `sendMessage`, so a
  post-send throw cannot produce a second record with a spurious failed status.
- **I-9.** `sendSucceeded` is left to the reply writer; ticket 3/4 should read
  `direction` (and `sendSucceeded` where present), not `source` — see below.
- **I-10.** The detached sweep carries an explicit log-and-swallow `.catch`.
- **I-11.** Kept stamp-before-await (load-bearing). Eviction removes only entries
  older than one interval. **Jitter was dropped** as disproportionate for a map
  holding tens of entries, per the review's own simplification note.
- **I-15.** The chat-identifier predicate is defined and shared; the backfill
  duplicates it deliberately so the script has no runtime import.
- **I-16.** `METADATA_DEBUG_CLEAR_BATCH` = 250 and `BOUND_SWEEP_MAP_MAX` = 1024
  rather than 500 each, purely so AC-19's literal sweep cannot produce a false
  positive on an unrelated constant.

**Two additional deviations not requested by the review:**

- **Cycle detection added to the sanitiser.** The plan said an unserialisable
  payload stores null. As first written, a circular payload instead exhausted the
  depth bound and became a truncation marker. A cycle is genuinely unserialisable
  rather than merely deep, so `sanitizeMetadataValue` now tracks ancestors and
  raises a distinct error, and `clampMetadataDebug` returns null for it — matching
  the plan. Caught by the new suite, which failed on this before the fix.
- **Pure helpers exported from `services/inboundHandlers.js`**
  (`isChatIdentifier`, `resolveChatId`, `clampMetadataDebug`, and the constants).
  The reply path carries a deliberate 1.5–6 s human-typing delay, so asserting
  sanitisation and key-derivation rules through it would have made the suite slow
  for no gain. No behaviour changed; only the export list grew.

## Validation run during implementation

- `node --check` on `models/Message.js`, `services/inboundHandlers.js`,
  `scripts/create_message_ttl_index.js`, `scripts/backfill_message_chat_id.js`,
  `scripts/test_outbound_capture_and_caps.js`,
  `scripts/test_inbound_persistence_slimming.js` — all parse.
- `npm test` — **PASS**. The pre-existing inbound-persistence suite passes
  unchanged (the regression signal for ticket 1/4's protection), and the new
  suite reports **73 passed, 0 failed**, covering: one-record convergence in both
  write orders and the successful-no-id branch; conversation-key derivation
  for 1:1 and groups and its independence from the phone fields; outbound
  capture, the inbound-event guard, the unresolvable-context drop and the
  non-conversation skip; WhatsApp-clock ordering with the `createdAt` tie-break;
  the per-conversation cap, its isolation from a quiet conversation, oldest-first
  deletion and redacted logging; **no delete issued on a null conversation key**;
  metadata sanitisation including nested `$`/dotted keys, prototype keys and
  objects inside arrays; depth, breadth, byte and cycle handling; **two
  consecutive failed sends producing two records, each keeping its own debug
  metadata**; the oversized-body guard suppressing capture without affecting the
  reply; and backfill derivation.
- **Literal sweep** — the only remaining `500` in `services/inboundHandlers.js`
  is in a comment describing the cap that was removed; the `1500` minimum
  typing-delay literal at `:1509` is untouched (AC-19, AC-20).
- **Scope check** — `git status` lists exactly the seven planned files plus the
  ticket workspace (AC-44, IM-4).
- **Contract check** — `routes/tenants.js` (`formatMessageRecord`, the `source`
  vocabulary) is unmodified, so the two new fields stay invisible to existing
  responses (AC-41); `package.json` gained no dependency (AC-45).

## Resume — coverage added (2026-08-08)

`/verify` failed AC-7 and AC-8 because nothing proved the ticket's central
guarantee: that the capture listener and the reply path converge on **one**
record. The upsert made it structurally likely; likely is not verified. Sixteen
checks were added to `scripts/test_outbound_capture_and_caps.js` (57 → 73), all
passing:

- **Both write orders.** Capture-first-then-reply, and reply-first-then-capture.
  Each asserts exactly one record survives for the shared `messageId`, and that
  the *other* writer's fields are still intact afterwards — which is executed
  evidence for AC-9's non-erasure claim in both directions, where before it
  rested on reading the two field lists.
- **AC-8** — the single record carries `repliesToMessageId` and the debug
  metadata, is marked `webhook_reply`, and records that the send succeeded.
- **AC-31** — the text handed to the send path is byte-identical to
  `parsed.reply`, and carries no diagnostic field.
- **The successful-send-with-no-id branch** — no outbound record is created by
  the reply writer, and no `local_` id is minted. This is the branch that would
  otherwise produce the second document AC-7 forbids.

These drive the real reply path, so each scenario absorbs the deliberate
1.5–6 s human-typing delay; the suite now takes roughly ten seconds. That is the
right trade for proving the guarantee the whole ticket exists to provide.

`client.sendMessage` in the harness became configurable (and now records the
text it was handed) so the no-id branch and reply purity could be exercised. No
production code changed on the resume.

## Not performed here — required before this ticket can be verified or deployed

These need a live database, a connected WhatsApp session, or staging access, none
of which exist in this working tree. They are **not** optional: three acceptance
criteria cannot be evidenced without them.

- **Plan step 14 — pre-deploy measurement.** Record count, age distribution, and
  how many conversations exceed `MESSAGE_CAP_PER_CHAT`, so the size of both the
  expiry deletion and the cap trim is known in advance.
  `node scripts/create_message_ttl_index.js` (no flag) prints the age
  distribution without changing anything.
- **Plan step 15 — verified export.** Precondition of BOTH the backfill and the
  expiry-index script. Custody per H-4/I-4: outside the repository tree, on
  operator-controlled storage, encrypted at rest, with an explicit deletion date
  once the ticket closes. Record a **non-credentialed reference** and that
  deletion date here when it is taken.
- **Plan step 16 — expiry index.** `node scripts/create_message_ttl_index.js
  --confirm`, once per environment, after the export. Then confirm the index
  exists — this is the evidence for **AC-25**, which cannot otherwise be recorded
  as met.
- **Plan step 19 — backfill run.** Dry run first and inspect the derived-key
  shape breakdown, then `--write`. Evidence for **AC-32 / AC-33**. Note this is
  what activates the per-conversation cap on historical records and therefore
  triggers the irreversible trim.
- **Manual smoke observation.** Send one message from the WhatsApp mobile app and
  confirm a record appears with the same conversation key as that customer's
  inbound messages and a platform timestamp. This is the only non-synthetic
  evidence for **AC-3**, whose underlying library premise (that `message_create`
  fires for phone-composed messages) cannot be confirmed from this repository.
- **Staging query-plan run (I-4).** Evidence for **AC-26**: the retention sweep
  must show an index scan on `metadata_debug_retention` with no collection scan
  and keys examined proportional to the carrier count; the per-conversation
  selection must show an index scan with **no sort stage**. This is the check that
  would have caught I-1, so it should not be skipped.
- **Index measurement** — record measured index sizes **after** the backfill, not
  before (I-13), since the conversation index is churned as `chatId` is populated.

## Consumer note for ticket 3/4

Capture-created records fall back to the schema default `source: "inbound"`,
because extending the enum would break the out-of-scope `/admin/messages?source=`
filter. Read **`direction`** to tell inbound from outbound. Delivery `status` now
stays null until an acknowledgement arrives rather than being written as "sent",
and the acknowledgement handler updates rather than upserts, so an acknowledgement
that arrives before the capture insert is dropped and that record keeps a null
status permanently — a follow-up ticket is recorded for that in `plan.md`.
