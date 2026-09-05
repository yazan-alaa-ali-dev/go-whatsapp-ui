---
ticket: 86eyhz67r
stage: plan
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-08
links:
  clickup: https://app.clickup.com/t/86eyhz67r
  github:
---

# Plan — 86eyhz67r

> Decide the approach before changing code. Plan only — no implementation here.
>
> **Revision 4** (2026-08-08) — **narrow** revision (owner decision). Fixes the
> four required plan changes **H-1..H-4** and records **H-5..H-16** as binding
> implement-time constraints. Rounds 1 and 2 (F-*, G-*) remain closed; the
> approach, files, rollback and scope are unchanged from revision 3 except where
> H-1..H-4 require it.

## Approach

Capture outbound messages at **one** point — a `message_create` listener
registered next to the existing `message` and `message_ack` listeners — instead of
instrumenting the ~20 send sites spread across seven files. No send function is
touched, and a message composed on the operator's phone is captured for free.

The two writers that can describe one outbound message converge on the existing
unique key `{tenantId, waNumberId, messageId}` through an upsert with **disjoint
field ownership**. Delivery status is owned solely by the acknowledgement handler
and its forward-only guard.

All count-based per-number bounds run inside **one unconditionally throttled
block**, off the reply path. The debug-metadata retention bound is a `skip(N)`
over metadata-bearing records — no date cutoff, so it cannot degenerate — and it
is now backed by a **partial index** so a number with nothing to clear costs an
index seek rather than a walk of its whole record set (**H-2**).

**The message-id rule is branch-specific (H-1).** A failed send has no platform id
*and never produces a capture event*, so it cannot collide with one; it therefore
keeps a locally generated id, which is what stops every failure for a number
collapsing onto a single null-keyed document. A *successful* send that returns no
id is the opposite case — a capture event does exist — so the reply writer stands
aside rather than creating a second record.

Alternatives rejected: (a) a persistence call inside each send function —
forbidden by AC-5; (b) deriving the conversation key from the phone-number fields
— collides with sender identity in groups (AC-13); (c) enforcing bounds on a
schedule — AC-25/NFR-7 forbid a scheduled job.

## Revision log — round-3 follow-ups

| # | Follow-up | Resolution |
|---|-----------|------------|
| H-1 | Synthetic id lost on the failed-send branch | **Step 10**, rewritten to state both branches separately. Failed send ⇒ locally generated id retained (no capture event can ever exist for it, so no collision is possible). Successful send with no id ⇒ the reply writer performs no write. **Step 18** adds a test asserting two consecutive failed sends produce two records, each keeping its own debug metadata. |
| H-2 | Retention sweep probes the whole record set to find nothing | **Step 1** adds a partial index on tenant + number + creation time, restricted to records whose `metadataDebug` is an object. The sort-and-skip is then index-ordered and the id selection covered, so a number below the bound costs a seek, not a walk. **Step 6b** describes the cost accordingly. |
| H-3 | Conversation index lacks `createdAt` | **Step 1**. The index becomes tenant + number + conversation key + timestamp ascending + creation time ascending — it serves the AC-18 read order in both directions and makes the per-conversation deletion selection index-ordered, removing the last blocking sort from the per-message path. |
| H-4 | Export has no stated custody | **Step 15**. Owner decision: outside the repository tree, on operator-controlled storage, encrypted at rest, with an explicit deletion date once the ticket closes; `implement.md` records only a non-credentialed reference. |
| H-5..H-16 | — | Recorded verbatim under *Implement-time constraints*, so `/implement` remains bound by the plan (IM-4) and `/verify` has something to evidence against. |

## Steps

1. **Extend the message schema.** Add `chatId` (string, default `null`) and
   `metadataDebug` (mixed, default `null`). Add **two** indexes:
   - the conversation index — tenant, number, `chatId`, `timestamp` ascending,
     `createdAt` ascending (**H-3**) — which serves both the canonical read order
     and index-ordered deletion selection;
   - a **partial** index — tenant, number, `createdAt` descending, restricted to
     records whose `metadataDebug` is an object (**H-2**) — which backs the
     retention sweep. Being partial, it indexes only carrier records, so its cost
     scales with the retention bound rather than the record ceiling.

   Document the canonical read order — timestamp ascending, then creation time
   ascending — in a comment beside the conversation index (the artifact for
   AC-18). Add comments recording that the expiry index is created **out of band**
   and must not be dropped by a future index sync, and that the `pre("validate")`
   hook is now inert because both writers upsert. The `source` enum is unchanged.
   → AC-11, AC-14, AC-18, AC-23, AC-26, AC-27
2. **Add the expiry-index script**: reports the collection's age distribution,
   requires an explicit confirmation flag, then creates the 90-day expiry index on
   `createdAt`. Never invoked at boot. Credentials from the existing database
   module and environment only. → AC-25, NFR-7
3. **Declare the constants once** — the caps (`MESSAGE_CAP_PER_CHAT = 150`,
   `MESSAGE_CAP_PER_NUMBER = 5000`), the debug-metadata bounds (max bytes 32768,
   max records per number 100, plus the clear batch size, sanitiser depth and
   sanitiser breadth required by **H-5** and **H-7**), the webhook body limit
   (**H-6**), the bound-sweep throttle interval, the size-check interval and
   threshold, and the expiry window. → AC-19, AC-24
4. **Add `resolveChatId(msg)`** — `msg.to` when `msg.fromMe`, else `msg.from`,
   falling back to `msg.id.remote`, returning null when none resolves. It reads
   only chat-identifier fields, never the sender/recipient phone fields, so the
   conversation key can never collide with sender identity. → AC-11, AC-12, AC-13
5. **Add `clampMetadataDebug(value)`** and the upsert wrapper that retries once on
   a duplicate-key error so a race between the two writers resolves into one
   record. → AC-10, AC-16
6. **Rewrite storage-bound enforcement** as one function with two parts:
   - **(a) Per-conversation, immediate and inline.** Runs **only** when the
     conversation key is a non-empty string — no query is ever filtered on a null
     key. Count scoped to tenant + number + key; on overflow select the excess
     within that conversation using the conversation index, which now supplies the
     `{timestamp, createdAt}` order directly (**H-3**), with an `_id`-only
     projection, then delete them.
   - **(b) Per-number, unconditionally throttled** and **fire-and-forget**
     (**H-8**), never awaited on the message path. Two bounds run inside it:
     - the record ceiling — count scoped to tenant + number; on overflow delete
       the excess ordered by creation time, which the existing index covers;
     - the debug-metadata retention — select `_id`s of carrier records via the
       partial index (**H-2**), newest-first, skipping the retention bound, in a
       batch of the declared size; clear `metadataDebug` on exactly those. Fewer
       carriers than the bound is an index seek returning nothing, and no write.
   Each deletion logs its count and the redacted conversation id. → AC-21, AC-22,
   AC-23, AC-24, AC-26, AC-39
7. **Convert the inbound writer to explicit `$set`** of only the fields it owns,
   adding `chatId`, and pass the conversation key to bound enforcement. → AC-9,
   AC-11
8. **Add the outbound capture handler.** Resolve tenant + number via the existing
   resolver and drop the event when it returns nothing; return immediately when
   `msg.fromMe` is false, before any await; normalise the message id before
   reading it; skip non-conversation chats using the existing classifier; then
   upsert the capture-owned fields and enforce the bounds. Catch everything — it
   must never throw. → AC-1, AC-2, AC-3, AC-6, AC-34, AC-35, AC-36, AC-37, AC-38
9. **Register the listener** inside the session-attachment path, guarded by
   `listenerCount("message_create") === 0`, mirroring the existing `message_ack`
   registration, with the same error-capture wrapper. → AC-4
10. **Rework the webhook-reply writer** to upsert. `$set` only `source`,
    `toPhone`, `repliesToMessageId`, `sendSucceeded`, `failureReason` and
    `metadataDebug`; `status` and `statusUpdatedAt` are `$setOnInsert`-only,
    leaving the acknowledgement handler their sole `$set` owner. `$setOnInsert`
    the fields needed if this writer creates the record first, including the
    ordering timestamp taken from the inbound message it answers.

    **The message-id rule has two distinct branches (H-1):**
    - **Failed send** (`sendSucceeded: false`, no platform id): a **locally
      generated id is retained**, exactly as today. No capture event exists or can
      ever exist for a send that failed, so the generated id cannot collide with
      one — and without it the upsert key would be a null id, causing every
      failure for that number to overwrite a single document and destroying
      failure history along with its debug metadata.
    - **Successful send that returned no platform id**: the reply writer performs
      **no write** and logs at info. A capture record already exists for that
      message, so writing would create the second document AC-7 forbids; the
      enrichment fields are simply absent for that record.

    Preserve and comment the `failureReason: sendSucceeded ? null : …` expression
    as the single enforcement point of that invariant. → AC-7, AC-8, AC-9, AC-15,
    AC-17, AC-30
11. **Capture, guard and bound the debug metadata.** Reject a webhook response
    body beyond the declared limit and skip metadata capture for it — **the guard
    suppresses metadata capture only and never affects reply parsing or delivery**
    (**H-6**). Accept `metadata_debug` only when it is a plain object; anything
    else stores null. Sanitise keys **recursively**, walking objects nested inside
    arrays, stripping `$`-prefixed and dotted keys and the prototype-polluting
    keys, under the declared depth and breadth bounds (**H-5**). Measure with
    `Buffer.byteLength` inside a guard so a serialisation failure stores null.
    Above the byte limit — or beyond the shape bounds — store the truncation
    marker with its byte count, so there is exactly one representation of "not
    stored verbatim". The reply text passed to the send call stays exactly
    `parsed.reply`. → AC-27, AC-28, AC-29, AC-30, AC-31
12. **Add the throttled database-size warning** — at most one check per declared
    interval, fire-and-forget from the store path, warning once per crossing of
    70% of 512 MB, failures swallowed, state bounded and per-process. → AC-40
13. **Update every comment stating the old 500-record limit** and remove the
    literal from the enforcement code, touching only the identified sites. The
    minimum-typing-delay literal that also contains those digits is left alone.
    → AC-19, AC-20
14. **Record the pre-deploy measurement** in `implement.md`: record count, age
    distribution, and how many conversations hold more than `MESSAGE_CAP_PER_CHAT`
    records — so the size of both the expiry deletion and the cap trim is known in
    advance. → AC-25
15. **Take and verify a collection export**, as a stated precondition of running
    either the backfill (step 19) or the expiry-index script (step 2). **Custody
    (H-4):** the export lives **outside the repository tree**, on
    operator-controlled storage, **encrypted at rest**, with an **explicit
    deletion date** once the ticket closes. `implement.md` records only a
    **non-credentialed reference** to it — never a URI carrying credentials, and
    never the export itself.
16. **Verify the expiry index exists** as read-only evidence for AC-25. Step 2 is
    run once per environment by the operator performing the deploy, after step 15
    and before `/verify` records AC-25. → AC-25
17. **Adjust the existing hermetic suite's stubs**, pre-authorised: the `Message`
    stub unwraps `$set` / `$setOnInsert` before recording and gains an
    `updateMany` recorder, and the database stub exposes whatever the throttled
    size check reads. No existing assertion is weakened or removed. → AC-42
18. **Add the new hermetic test script** covering: ordering across both directions
    (AC-16); conversation-key derivation for 1:1 and group chats and its
    independence from the phone fields (AC-13); the null-key guard issuing no
    delete; the per-conversation cap and its isolation; the metadata retention
    bound including the under-bound no-write case and tenant + number scoping;
    **key sanitisation, including nested `$`/dotted keys, prototype keys, and
    objects inside arrays** (**H-5**); the byte and shape truncation rules and the
    non-object, oversized-body and unserialisable cases; **that the body guard
    suppresses capture without affecting the reply** (**H-6**); the delivery-status
    non-downgrade; the `sendSucceeded` / `failureReason` invariant; **two
    consecutive failed sends producing two records, each keeping its own debug
    metadata** (**H-1**); the successful-no-id case producing exactly one record
    (AC-7); the inbound-event guard; the unresolvable-context drop; the
    non-conversation skip; and backfill derivation and idempotency. → AC-42
19. **Add the backfill script**, exporting a pure derivation function and, when
    run directly, batching `$set: {chatId}` updates by `_id` range. Dry-run by
    default, reporting counts and a breakdown by derived key shape; writes require
    an explicit flag; optional tenant and record-limit scoping. It derives **only**
    from the chat-identifier fields, never the phone fields, and skips and counts
    any record whose derived value fails the chat-identifier predicate (**H-15**).
    Credentials from the existing database module and environment only.
    **Runner and timing (H-10):** run by the operator performing the deploy, after
    step 15's verified export and after the code is deployed, with the dry-run
    inspection an explicit precondition of the write run; the write run must
    precede `/verify` recording AC-32/AC-33. → AC-32, AC-33
20. **Wire the new script into the test command** alongside the existing suite.
    → AC-43

## Implement-time constraints (binding)

Recorded here so `/implement` is bound by the plan (IM-4) and `/verify` has
something to evidence against. Each is a constraint on *how* the steps above are
carried out, not a new file or a new outcome.

- **H-5 — Sanitiser bounds.** Depth and breadth limits are named constants
  declared in step 3. Exceeding either yields the same truncation marker as the
  byte limit. The strip list covers `$`-prefixed keys, dotted keys, and
  `__proto__` / `constructor` / `prototype`. Objects nested inside arrays are
  walked.
- **H-6 — Body guard.** The webhook body limit is a named constant. The guard
  suppresses debug-metadata capture only; it must never affect reply parsing or
  delivery to the customer.
- **H-7 — Clear batch.** The retention clear's batch size is a named constant, and
  convergence across successive sweeps is intended and expected.
- **H-8 — Fire-and-forget.** The throttled per-number block is not awaited on the
  message path; the per-conversation sweep stays inline.
- **H-9 — Throttle hygiene.** The throttle key is stamped **before** the async
  work begins, so concurrent messages do not all start a sweep. The map has an
  explicit size bound and eviction policy, and the first sweep per key is
  jittered within the interval so a restart does not trigger a simultaneous sweep
  across every active number.
- **H-10 — Backfill ownership.** As stated in step 19.
- **H-11 — Bounds are eventual.** Because the throttle is unconditional, the
  per-number record ceiling and the metadata-carrier bound are **steady-state
  ceilings with a convergence window of one throttle interval**, not instantaneous
  limits. A burst can overshoot both between sweeps; the Storage budget figures
  are steady-state, not peak.
- **H-12 — Delivery-status consumer.** The admin messages endpoint exposes a
  `status` filter, and that filter's results change: a reply's status now stays
  null until an acknowledgement rather than being written as "sent". Worse, the
  acknowledgement handler **updates rather than upserts**, so an acknowledgement
  arriving before the capture insert is dropped — a message that never receives a
  later acknowledgement keeps a null status permanently, where today it would read
  "sent". This is stated, not fixed: changing the acknowledgement handler to upsert
  is beyond this ticket's criteria. Ticket 3/4 should read `direction` and
  `sendSucceeded`, not `status`, to determine whether a message was sent.
- **H-13 — AC-26 evidence.** AC-26 is evidenced against the **per-message path**
  (its "no collection scan" clause): one upsert plus one index-covered count, with
  the per-conversation selection now index-ordered via the H-3 index. The
  throttled block is off that path by construction.
- **H-14 — Sanitisation evidence.** `/verify` cites the key-sanitisation and
  body-guard test cases **by name** as the evidence for AC-27 and AC-42, since no
  acceptance criterion asserts those properties directly.
- **H-15 — Chat-identifier predicate.** A derived conversation key is accepted
  only when it is a string matching the platform's chat-identifier form; anything
  else is skipped and counted. The predicate is shared by step 4 and step 19 so
  the two cannot drift.
- **H-16 — Size metric.** The storage warning states which metric it reads.
  Clearing the metadata field shrinks documents logically but not allocated
  storage, so a check reading allocated storage will lag the logical figure; the
  chosen metric is recorded in `implement.md` alongside the reading.

## Storage budget

- Post-ticket-1/4 records carry no base64, so a message document is on the order
  of 1–3 KB including index overhead. At `MESSAGE_CAP_PER_NUMBER = 5000` that is
  roughly **5–15 MB per tenant+number**.
- Debug metadata is bounded to the newest **100 metadata-carrying records** per
  number at 32 KB worst case — **≈ 3.2 MB per number**, and far less in practice.
- Combined steady-state worst case **≈ 8–18 MB per tenant+number**, so the 358 MB
  warning fires around **20–30 numbers at full cap**. Per **H-11** these are
  steady-state ceilings with a one-interval convergence window, not instantaneous
  limits.
- **The per-number ceiling is campaign-dominated.** Campaign and bulk sends create
  one conversation per recipient holding very few records each, so the
  per-conversation cap never trims them and they accumulate directly against the
  ceiling — a large campaign can evict real conversation history that ticket 3/4
  reads. Stated rather than solved.

## Accepted consequences

- **The cap change deletes data once the backfill lands.** Every existing
  conversation holding more than 150 records is trimmed on its next message,
  irreversibly. This is the intended effect of FR-9; step 14 measures its size
  beforehand and step 15's export is the recovery path.
- **`source` reports capture-created records as "inbound".** Leaving the enum
  alone was correct — extending it would break an out-of-scope filter — but
  `direction` carries the true meaning and ticket 3/4 should read it.
- **Delivery status is written later, and an early acknowledgement can be lost
  permanently** — see **H-12**.
- **The `pre("validate")` hook is inert.** Both writers upsert, so the
  `sendSucceeded` / `failureReason` invariant rests entirely on one commented
  expression and its test assertion.
- **Throttles are per-process.** Across replicas the rates multiply and restarts
  reset them; they are cost controls, not correctness guarantees.
- **Retention widens.** Operator-composed phone messages and group message bodies
  are stored up to 90 days and are already readable through the existing admin
  messages endpoint via the allow-listed `body` field.
- **Debug metadata is untrusted, tenant-visible data.** It is length-guarded,
  type-checked, recursively key-sanitised, shape-bounded and size-bounded, but its
  *content* is not validated; whatever renders it must escape it.
- **A production export exists for the life of this ticket** — constrained by
  **H-4**, and deleted on the recorded date once the ticket closes.

## Follow-up tickets to open

Named here so they exist before the conditions that need them. Opening them is
outside this command's write scope.

- **A global, cross-number storage ceiling** — today's bounds are per
  tenant+number, so 20–30 numbers at cap fill the tier and the warning has no
  reclamation path behind it.
- **Index-budget cleanup** — several single-field indexes are redundant with
  existing compound prefixes.
- **Acknowledgement-handler upsert** — so an acknowledgement arriving before the
  capture insert is not lost (**H-12**).

## Files to change

- `models/Message.js` — the `chatId` and `metadataDebug` fields, the conversation
  index (now carrying `createdAt`), the partial index backing the retention sweep,
  the read-order comment (AC-18), the out-of-band expiry-index note, and the
  inert-hook note. The `source` enum is **not** changed and the expiry index is
  **not** declared here.
- `services/inboundHandlers.js` — the constants and helpers, the two-part bound
  enforcement with its unconditional throttle, the inbound writer's explicit
  `$set`, the outbound capture handler, its listener registration, the reworked
  reply writer with its two-branch message-id rule and guarded metadata capture,
  the throttled size warning, and the stale 500-limit comments.
- `scripts/create_message_ttl_index.js` *(new)* — age-distribution report, then
  the expiry index behind an explicit confirmation flag.
- `scripts/backfill_message_chat_id.js` *(new)* — pure derivation function plus a
  dry-run-by-default, tenant-scopable, `_id`-batched backfill.
- `scripts/test_outbound_capture_and_caps.js` *(new)* — hermetic tests.
- `scripts/test_inbound_persistence_slimming.js` — pre-authorised stub changes
  only: unwrap `$set`/`$setOnInsert`, add an `updateMany` recorder, and expose
  what the size check reads. No assertion weakened or removed.
- `package.json` — extend the `test` script.

**No other file is modified.** No route file, no public web asset, no deployment
runtime file, no webhook service, no legacy single-tenant send path (AC-44, C-1,
C-2, C-5).

## Validation strategy

- Validation profile: none

  *(Reason: the only check defined in `project-config.yaml > validation_checks` is
  the Node syntax check. This ticket also requires the hermetic suite to run and
  pass, which has no check definition, and adding one is governance work outside
  this ticket — VP-5.)*

- **Syntax** — the Node syntax check over each changed and added JavaScript file.
- **Automated tests** — the project's test command; both suites pass, covering
  everything listed in step 18. The existing suite passing is the regression
  signal for ticket 1/4's protection.
- **Manual smoke observation** — send one message from the WhatsApp mobile app and
  confirm a record appears with the same conversation key as that customer's
  inbound messages and a platform timestamp. The only non-synthetic evidence for
  AC-3.
- **Pre-deploy measurement (step 14)** and **verified export (step 15)** —
  recorded in `implement.md` before any deleting operation runs, with the export
  referenced per **H-4**.
- **Expiry-index existence check** — read-only confirmation, the evidence for
  AC-25.
- **Named test-case evidence (H-14)** — `/verify` cites the key-sanitisation and
  body-guard cases by name for AC-27 and AC-42.
- **AC-26 reading (H-13)** — evidenced against the per-message path.
- **Index measurement** — record measured index sizes at `/verify`, including the
  two added here.
- **Literal sweep** — no `500` cap literal survives in the enforcement path, and
  the minimum-typing-delay literal is untouched (AC-19, AC-20).
- **Scope check** — `git status` and the diff show exactly the seven files listed
  and nothing else (AC-44, IM-4).
- **Contract check** — the response allow-list and the `source` vocabulary are
  unmodified (AC-41); no new dependency in the manifest (AC-45).
- **Deferred to `/verify`** — every AC-1..AC-45 mapped to a result, `all-ac`
  depth (MO-6).

Accepted trade-off: the per-message cost is one upsert plus one index-covered
count, with the per-conversation selection now index-ordered (**H-3**) and **all**
per-number work behind a single unconditional throttle, fire-and-forget
(**H-8**).

## Rollback

- **Primary path — revert the listener registration only (step 9).** Stops all new
  outbound capture immediately while leaving the schema fields, the guarded bounds
  and the reply-path improvements in place. Non-destructive: no bound constant
  changes, so nothing is mass-deleted.
- **Full revert is destructive and is the fallback, not the default.** It restores
  the previous unscoped 500-per-number cap over a collection now holding every
  outbound message, deleting history down to 500 records per number. If a full
  revert is required, raise the old constant or disable enforcement in the same
  change.
- **The expiry index must be dropped explicitly.** It exists only if someone ran
  step 2; once it does, reverting the code neither removes it nor restores deleted
  records. Drop the index first, then revert. The step 15 export is the recovery
  path.
- The two schema-declared indexes are harmless if left behind.
- If the backfill has run, reverting leaves `chatId` populated on old records —
  inert, provided the derivation was correct, which the dry-run breakdown
  establishes before any write.

## Out of scope

- Any screen, dashboard, or new read endpoint — ticket 3/4.
- Modifying the response allow-list or the `source` vocabulary constant.
- Changing the acknowledgement handler to upsert (**H-12**) — recorded as a
  follow-up ticket.
- Applying the documented read order to existing read paths; route files are not
  touched.
- A global, cross-number storage ceiling, and excluding campaign traffic from the
  per-number cap.
- Removing index entries made redundant by existing compound prefixes.
- Media storage and offloading (ticket `86eye6ezn`).
- The debug API key, cancelled by the owner on 2026-08-06.
- The legacy single-tenant send path (C-5).
- Reconciling the messaging platform's alternative identity forms for one contact.
- Any change to deployment, infrastructure, or scheduled jobs.
- Adding a validation check definition to the project configuration.
