---
ticket: cu-z8pmx9kcv6
stage: plan
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-15
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv6"
  github: ""
---

# Plan — cu-z8pmx9kcv6

> Decide the approach before changing code. Plan only — no implementation here.
>
> **Revision 4 (2026-08-15)** — three advisory panel rounds have run against this
> plan. Revision 2 closed the five Required Follow-up Actions in `review.md`;
> Revision 3 added JID normalization; Revision 4 corrects two defects the panel
> found in Revision 3's own additions and resolves a lens disagreement against
> the code. The approach is unchanged throughout. See "Revision log" at the end.

## Approach

Add a dedicated `message_debug` table to the chat store (four appended
migrations: table + three indexes) holding the diagnostics payload verbatim in a
`metadata_json` text column alongside nine promoted, typed columns and the
`created_at`/`updated_at` pair. Two methods — `SetMessageDebug` and
`GetMessageDebugBatch` — go on `IChatStorageRepository`, are implemented in
`SQLiteRepository`, and are delegated in the device-scoped wrapper. The write is
a portable `INSERT … ON CONFLICT(device_id, message_id) DO UPDATE` (the
construct already used at `sqlite_repository.go:891`, valid on both SQLite and
PostgreSQL — NFR-1), and the promoted values are derived inside the repository
from the payload it is given (REQ-6).

Two consequences of the owner's decisions shape the design:

- **Soft link (REQ-16).** The table carries `chat_jid` beside `device_id` and
  `message_id` but declares **no** `FOREIGN KEY`, unlike `message_edits`
  (migration 19). A debug row can therefore be written before its message row
  exists, which the asynchronous sent-message write (`usecase/send.go:74-78`)
  makes a real ordering case. The price is explicit cleanup (REQ-17) — which is
  already this repository's house pattern: `TruncateAllChats` and
  `DeleteDeviceData` delete dependants row-by-row even where an FK exists.
- **Byte-identical retention (REQ-2, AC-1).** The payload string received is
  stored **as given** and never re-marshalled; extraction parses a separate
  decoded copy. Re-marshalling would reorder keys and re-escape the Arabic text
  in the reference payload, breaking AC-1.

Because nothing cascades, cleanup completeness *is* the correctness of this
design. Every path that deletes a message or a chat therefore deletes the
matching diagnostics rows, and `chat_jid` is **required** at write time so no
row can be created that a chat-keyed delete cannot reach.

Alternatives rejected: a column on `messages` (the ticket's own rationale — eight
SQL sites to edit and a race with the async sent-message write); an enforced FK
(rejected by the owner on 2026-08-15 — it would make a debug write fail when the
message row has not landed, contradicting REQ-16/AC-15).

## Steps

1. **DTO.** Add a `MessageDebug` struct to the chat-storage domain with `db`
   tags matching the new columns: `DeviceID`, `MessageID`, `ChatJID`,
   `MetadataJSON`, `EnabledBy`, `Phone`, `Intent`, `Model`, `MessageType`,
   `MessageLen`, `SessionID`, `ThreadID`, `IntentComplete`, `CreatedAt`,
   `UpdatedAt` — following the `ChatwootMessageLink` shape.
2. **Contract.** Declare on `IChatStorageRepository`:
   `SetMessageDebug(ctx context.Context, deviceID, chatJID, messageID, metadataJSON string) error`
   and
   `GetMessageDebugBatch(ctx context.Context, deviceID string, messageIDs []string) (map[string]*MessageDebug, error)`.
   The `chatJID` parameter is a **deliberate deviation** from the signature in
   the ClickUp description: the soft link needs the conversation identifier, and
   the spec anticipates it (REQ-16, Open Questions). It is **required** — an
   empty `chatJID` is rejected exactly like an empty `deviceID` or `messageID`,
   because a row stored without it would be unreachable by the chat-keyed
   deletes in step 7 and would become an undeletable orphan holding the
   customer's phone number. The caller knows the conversation JID at send time,
   so this costs nothing and does not weaken REQ-16/AC-15 (which is about the
   *message row* not existing yet, not about the JID being unknown).
   The parameter-list form is kept over a `*MessageDebug` argument on purpose:
   it matches the contract named in the ticket description and stops a caller
   believing it should populate the promoted fields (REQ-6).
   `chatJID` is also **normalized at the write boundary exactly as the
   repository already normalizes it for a sent message** —
   `whatsapp.NormalizeJIDFromLID(ctx, jid, client).String()`, with the client
   taken from context when present (`sqlite_repository.go:2202-2204`). The goal
   is **byte-identical agreement with `messages.chat_jid`**, not a canonical
   JID: `.ToNonAD()` is deliberately **not** applied, because line 2204 does not
   apply it either, and stripping an AD suffix here alone would make
   `message_debug.chat_jid` diverge from `messages.chat_jid` and create the very
   mismatch this guard exists to prevent. A value that does not parse as a JID
   is rejected like an empty one.
   Reachability, however, does **not** rest on that normalization. Because
   `NormalizeJIDFromLID` is best-effort — it returns the `@lid` JID unchanged
   when no client is in context (`jid_utils.go:19-22`), which is likely
   precisely because NFR-6 pushes this write off the request path — the
   **message-scoped deletes are keyed chat-free** (step 7): on the primary key
   `(device_id, message_id)`, or on `message_id` alone for the legacy path. Only
   the two *chat*-scoped deletes must match `chat_jid`, and there the exposure is
   **identical to the three dependant tables that already live there**
   (`message_reactions`, `message_edits`, `chatwoot_message_links`, all deleted
   by the same passed-in `jid` at `:247-253, :280-286`). Matching the house
   convention is the standard here; being stricter than the tables beside it
   would be the bug.
   Two limits recorded rather than papered over: an `@lid` value can still be
   stored unnormalized when no client is available (it then survives a per-chat
   delete, though `DeleteDeviceData` and `TruncateAllChats` still reach it); and
   the shared helper itself logs the raw JID at warn and the resolved phone at
   debug (`jid_utils.go:20, 33`), a pre-existing exception to this ticket's
   "never log the value" rule (steps 4–5) that would cost a wrapper around a
   shared helper to suppress. The real guard is the producer: `implement.md`
   carries forward that ticket 04 must pass `SetMessageDebug` the same chat JID
   **and the same device id form** it used for the message row.
3. **Migrations 44–47**, appended to the end of `getMigrations()`, one statement
   each (NFR-3):
   - 44 — `CREATE TABLE IF NOT EXISTS message_debug` with `PRIMARY KEY
     (device_id, message_id)`, `metadata_json TEXT NOT NULL DEFAULT ''`, the
     nine promoted columns (`enabled_by`, `phone`, `intent`, `model`,
     `message_type` as `VARCHAR(255)`; `message_len` as `INTEGER`; `session_id`,
     `thread_id` as `VARCHAR(255)`; `intent_complete` as `BOOLEAN`), `chat_jid`,
     and `created_at`/`updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`. Every
     column `NOT NULL DEFAULT` its zero value so REQ-13 has a landing place.
     `intent_complete` uses **`DEFAULT FALSE`**, written out explicitly —
     migration 36's `DEFAULT 1` is **not** the template to copy, because
     PostgreSQL rejects an integer default on a boolean column (NFR-1, AC-22).
     **No `FOREIGN KEY`.**
   - 45 — `CREATE INDEX IF NOT EXISTS idx_message_debug_thread ON
     message_debug(device_id, thread_id)`.
   - 46 — `CREATE INDEX IF NOT EXISTS idx_message_debug_session ON
     message_debug(device_id, session_id)`.
   - 47 — `CREATE INDEX IF NOT EXISTS idx_message_debug_chat ON
     message_debug(chat_jid, message_id)`. This one exists for the **delete**
     paths, not for a read: the legacy `DeleteMessage(id, chatJID)` and both chat
     deletes filter on `chat_jid`, which the primary key cannot serve because it
     leads with `device_id`. Without it every such delete full-scans the table.
     `(chat_jid, message_id)` also serves `DeleteChatByDevice`'s
     `(chat_jid, device_id)` filter through its leading column, so no fourth
     index is needed.
   Re-check at implement time that 43 is still the last existing migration.
   The primary key deliberately omits `chat_jid` even though `messages` keys on
   `(id, chat_jid, device_id)`: REQ-8 mandates one record per
   `(device, message)`. The assumption this rests on — a message id is unique
   per device across chats — is recorded here so the divergence is a known
   decision, not an oversight.
4. **Extraction helper** (unexported, in the repository): decode the payload into
   `map[string]any`, then read each promoted field defensively — absent, `null`
   or wrong type yields the zero value and a debug-level log, never an error
   (REQ-13, AC-12). Nested reads (`message.type`, `message.len`, `session.id`,
   `thread.id`, `thread.intent_complete`) tolerate a missing or non-object
   parent. JSON numbers decode as `float64`; `message_len` converts through that.
   **Extraction logs name the field and the message id only — never the value**,
   because `phone` and `thread_id` carry the customer's number and logs are not
   covered by the storage-level protections (REQ-14).
   The decode target stays `map[string]any` **on purpose**: a typed struct
   holding only the nine promoted fields would allocate less, but
   `encoding/json` returns an `UnmarshalTypeError` when a field has the wrong
   type, which — since the decode error *is* the validity check (step 5) — would
   reject the whole payload and break REQ-13/AC-12, the requirement that a
   wrongly-typed field degrade to its zero value. The extra allocation of the
   ignored subtrees is the price of that tolerance, and it is bounded by the
   size cap.
5. **`SetMessageDebug`.** Reject, before any write and with nothing stored, in
   this order:
   1. an empty `deviceID`, `chatJID` or `messageID`, or a `chatJID` that does not
      parse as a JID;
   2. a payload whose length exceeds `maxMessageDebugBytes` — a package
      constant fixed at **262144 (256 KiB)**, roughly two orders of magnitude
      above the ~1 KB reference payload, so it bounds abuse without rejecting
      real growth. The size check runs **before** the decode: bounding the
      decode is the whole point of the cap;
   3. a payload that does not decode into a JSON **object**.
   Every rejection **returns an error** and logs a warning carrying the message
   id and a reason class (`empty-argument`, `oversize`, `invalid-json`) —
   **never the payload, and never a decoder error that could quote payload
   bytes** (the same PII rule as step 4). The returned error is what a test
   asserts on; the producer ticket is the one that must not propagate it
   (AC-13).
   Validity is established by the **single** `json.Unmarshal` that step 4 needs
   anyway — its error *is* the validity check, so no separate `json.Valid` pass
   is made (REQ-12, AC-9 are satisfied identically at half the JSON cost). Note
   that decoding into `map[string]any` also rejects a top-level array, string or
   number: **intended** — a `metadata_debug` that is not an object has no
   promotable fields.
   The **same rule extends to the database-failure path**: log reason class
   `db-error` plus the message id and return a wrapped sentinel, never the raw
   driver error — a driver error can quote bound parameter values (PostgreSQL's
   error `DETAIL` especially, after the engine swap), and the producer would log
   it a second time. `implement.md` carries that constraint forward to ticket 04.
   Otherwise upsert with the original string unchanged, `created_at` and
   `updated_at` both supplied Go-side from `time.Now()` on insert (matching
   `StoreMessage` / `UpsertChatwootMessageLink`, and avoiding SQLite's
   one-second `CURRENT_TIMESTAMP` resolution making AC-14 flaky), `created_at`
   preserved and `updated_at` advanced on conflict (AC-14), using `ExecContext`
   so the `ctx` parameter is honoured rather than accepted and ignored. On a
   database error, log a warning carrying the message id and return it.
   *The size cap is defensive hardening that goes beyond the letter of REQ-12:
   `spec.md` states no size requirement, but the payload comes from another
   team's service and is stored verbatim, so an unbounded row and an unbounded
   decode are both reachable from outside. Recorded here rather than silently
   added. The cap bounds **bytes only**; pathological nesting is left to
   `encoding/json`'s own recursion limit, which errors rather than crashing.*
6. **`GetMessageDebugBatch`.** Reject an empty `deviceID` with an error, for
   symmetry with step 5 — otherwise a caller passing `""` silently reads the
   `device_id = ''` partition instead of failing. Return an empty map
   immediately for an empty id slice, executing no SQL (REQ-18, AC-17). Otherwise chunk the ids at 500 and
   build `IN (…)` placeholders per chunk — the pattern already used by
   `loadMessageReactions` (`sqlite_repository.go:625-660`) — always filtering on
   `device_id` (REQ-10) and using `QueryContext`. Select every column so the
   result carries the verbatim payload **and** all promoted fields (REQ-9, AC-6).
7. **Explicit cleanup (REQ-17, AC-16)** — add a `message_debug` delete to each
   existing path, beside the `message_reactions` delete already there. All six:
   - `DeleteMessage(id, chatJID)` — keyed on **`message_id` alone**,
     device- and chat-agnostic. Deliberately *not* keyed on `chat_jid`: the
     primary key already makes a message id unique per device, so dropping
     `chat_jid` from the predicate removes any dependence on best-effort JID
     normalization without widening what is deleted beyond what this path
     already removes from `messages`.
   - `DeleteMessageByDevice(deviceID, id, chatJID)` — keyed on the primary key
     `(device_id, message_id)`, likewise chat-free.
   - `DeleteChat(jid)` and `DeleteChatByDevice(deviceID, jid)` — keyed on
     `chat_jid` (plus `device_id` for the scoped variant). These are where every
     other message-dependant table is already cleaned; omitting them would leave
     orphans behind every chat deletion.
   - `DeleteDeviceData(deviceID)` — by `device_id`, inside its transaction.
   - `TruncateAllChats()` — unfiltered, inside its transaction.
8. **Wrapper delegation (REQ-20, AC-19).** Add both methods to
   `deviceChatStorage`, applying the established `if targetDeviceID == "" {
   targetDeviceID = r.deviceID }` fallback so the device identity is injected
   automatically. Note for the consumer tickets: this fallback fills only a
   *blank* device id — it is a convenience, not an isolation boundary.
9. **Tests** in a new colocated test file, using the existing
   `newTestSQLiteRepository(t)` helper: the reference payload round-trip and
   byte-identity, promoted-value assertions, index usage via `EXPLAIN QUERY
   PLAN`, re-record replacement and `updated_at` advance, batch read shape,
   cross-device isolation, malformed input, a payload at and just over
   `maxMessageDebugBytes`, a missing and an unparseable `chatJID`, an empty
   `deviceID` on both methods, null/unknown/wrong-typed fields,
   write-before-message, **all six** cleanup paths — including one that writes
   through the device-scoped wrapper and then removes the row via
   `DeleteDeviceData`, proving the stored `device_id` form matches what the
   cleanup expects — and the empty/1200-id batch edges.
   Instead of an `@lid` delete case: assert that the stored `chat_jid` equals
   the value `messages.chat_jid` would hold for the same input. An executable
   LID-divergence test is **not** written — `newTestSQLiteRepository` has no
   whatsmeow client, so `NormalizeJIDFromLID` is an identity function there and
   such a test would pass even if the normalization call were deleted outright.
   That half of AC-16 is recorded at `/verify` as inspection evidence, not as an
   executed assertion.
   Two assertions need a named mechanism rather than a bare call. AC-17 ("no
   query executed") is asserted by calling `GetMessageDebugBatch` with an empty
   id slice on a repository whose `*sql.DB` has been **closed**: any SQL would
   error, so an empty map with a nil error proves none ran. AC-18 ("split across
   more than one query") is asserted by extracting the chunking into a small
   helper and unit-testing its chunk count for 1200 ids, plus asserting the
   1200-id result is complete. (`sql.DBStats` is **not** usable for either — it
   exposes connection counters only, no query counter.) The AC-4 plan assertion
   checks that
   `EXPLAIN QUERY PLAN` **names the new index**, and the test does not run
   `ANALYZE` — on a near-empty table the planner has no statistics and a
   cost-based choice could otherwise flip. Note in the test file that
   `EXPLAIN QUERY PLAN` is SQLite-only, so the engine-swap ticket finds it.

## Files to change

- `src/domains/chatstorage/chatstorage.go` — add the `MessageDebug` DTO (step 1).
- `src/domains/chatstorage/interfaces.go` — declare the two methods on
  `IChatStorageRepository` (step 2).
- `src/infrastructure/chatstorage/sqlite_repository.go` — migrations 44–47, the
  extraction helper, `SetMessageDebug`, `GetMessageDebugBatch`, and the six
  cleanup additions (steps 3–7).
- `src/infrastructure/whatsapp/chatstorage_wrapper.go` — delegate both methods
  (step 8).
- `src/infrastructure/chatstorage/sqlite_repository_debug_test.go` — **new** —
  the test cases above (step 9).

No other file is touched. **No deployment runtime file is in scope** (GU-2,
IM-5); if one turns out to be needed, that is a hard stop.

## Validation strategy

- Validation profile: `go-source`
- Every acceptance criterion is covered by an automated test in the new test
  file, except the three below, whose evidence is stated here so `/verify` does
  not have to invent it:
  - **AC-4** (index, not scan) — recorded as **index-exists plus query-plan**
    evidence: the test asserts `EXPLAIN QUERY PLAN` names the new indexes for a
    thread and a session query. Because no shipped code queries by thread or
    session yet, the test verifies a query it writes itself; the product-level
    assertion belongs to the ticket that adds the query surface. No query method
    is added here to satisfy it.
  - **AC-22** (portability) — verified by inspection of the new SQL: no
    `INSERT OR REPLACE`, no `AUTOINCREMENT`, no `JSON`/`JSONB` type name, no
    integer default on a boolean, `ON CONFLICT … DO UPDATE` only. There is no
    second engine in CI to run against, so this is a **construct-level review
    check**, not an executed one — and it does not cover the repo-wide `?`
    placeholder style, which is the actual PostgreSQL blocker and belongs to the
    engine-swap ticket.
  - **AC-13** (a failing write never aborts its caller) — only the repository
    half is testable here: the write logs a warning carrying the message id,
    leaves no partial row, and returns the error. **No producer exists in this
    ticket**, so the "caller continues" half belongs to the ticket that wires one
    up (04/06/07). `/verify` should record it as partially covered rather than
    claim full coverage.
- **NFR-6** ("diagnostics are not on the send critical path") has **no mechanism
  in this ticket** and no AC: `SetMessageDebug` is a plain synchronous write, so
  the guarantee rests entirely on the producer calling it off the request path —
  mirroring the goroutine at `usecase/send.go:74`. `/verify` must **not** claim
  NFR-6 coverage; `implement.md` must carry the constraint forward for ticket 04.
  A second, concrete reason for that constraint: the JID normalization added in
  step 2 is free for a non-`lid` JID and cheap for a cached one, but a cold-cache
  `@lid` miss takes whatsmeow's LID-map write lock across a database round trip
  — which, after `cu-z8pmx9kcv5` moved the session store to PostgreSQL, is a
  network round trip serializing concurrent LID resolution. Off the send path,
  that cost is irrelevant; on it, it would not be.
- Memory bound worth carrying to the consumer tickets: `GetMessageDebugBatch`
  selects `metadata_json` for every id, so one 500-id chunk is bounded at
  500 × `maxMessageDebugBytes` ≈ 128 MB worst case, though ~0.5 MB with the
  ~1 KB reference payload. The AC-18 test will not surface this; the ticket that
  builds a list view should inherit the number rather than rediscover it.
- `implement.md` must also carry forward, for the consumer tickets, that
  `metadata_json` is **untrusted third-party input** stored verbatim with
  unknown keys: it must be escaped on render and never logged raw (stored-XSS
  and log-injection are the consumers' risk, not this ticket's), and that
  the PII column inventory — `phone`, `thread_id` (which embeds the phone) and
  `chat_jid`, two of them indexed — is recorded for the engine-swap ticket to
  weigh. Note also that the 256 KiB cap is enforced **Go-side only**, against an
  unconstrained `TEXT` column: any other writer (engine-swap tooling, admin SQL)
  bypasses it.
- **AC-23** (no deployment runtime file changed) — checked against the changed
  file list at `/verify`.

## Rollback

- Nothing is committed at `/implement` (IM-9), so reverting before delivery is
  `git checkout -- <files>` plus deleting the new test file, or discarding the
  `ticket/cu-z8pmx9kcv6` branch entirely. After delivery, revert the single PR
  commit.
- The schema is **additive only**: no existing migration or table is altered.
  Reverting the code alone is safe *in isolation* — `InitializeSchema` applies
  only migrations at or above the stored version, so an older binary applies
  nothing and fails nothing, leaving an unused table at schema version 47.
  **But a post-delivery revert must also drop the table and roll the recorded
  version back**, in two statements: `DROP TABLE message_debug` and
  `DELETE FROM schema_info WHERE version > 43`. (`schema_info` is a row-per-
  version table read as `MAX(version)` — `sqlite_repository.go:2315, 2337` — so
  the rollback is a delete, not an update.) Leaving the version at 47 against a
  43-migration binary means migrations 44–47 later appended by a sibling ticket
  (04/06/07/14) are silently skipped, diverging the schema. This cleanup is
  therefore **required on a post-delivery revert**, not optional.
- No data is migrated or rewritten, so there is nothing to restore.

## Out of scope

- Wiring any producer to call `SetMessageDebug`, and any REST/MCP/UI surface
  that reads diagnostics (tickets 04, 06, 07, 14).
- Moving the chat/message store to PostgreSQL, and any driver, URI or connection
  configuration change.
- Promoting `source`, `memory`, `api`, `tokens` or `langsmith` to columns.
- A promoted-fields-only read variant that avoids materialising every payload —
  belongs to the consumer ticket that builds a list view.
- Backfilling diagnostics for existing messages.
- **Retention or purging policy** beyond the six cleanup paths in step 7. The
  per-row size cap (step 5) bounds how large a single row can get, but not how
  many rows accumulate — and the columns that accumulate include the customer's
  phone number, twice, indexed. Recommended: open the retention ticket **before
  the first producer (04) ships**, not merely before the table grows large.
- Any change to a deployment runtime file.
- Updating the stale migration counts in `AGENTS.md` (they say 29; the real
  count is 43) — a documentation fix that belongs to its own ticket.

## Revision log

**Revision 2 (2026-08-15)** — addresses `review.md > Required Follow-up Actions`
after `CHANGES_REQUESTED`:

1. ✅ Cleanup added to `DeleteChat` and `DeleteChatByDevice` — step 7 now lists
   **six** paths, not four.
2. ✅ `chatJID` is now **required** at write time — step 2, enforced in step 5.
3. ✅ Migration **47**, an index on `(chat_jid, message_id)`, added so the
   chat-keyed deletes do not full-scan — step 3.
4. ✅ Payload **size cap** enforced before the write and logged like AC-9, with
   its beyond-REQ-12 status stated openly — step 5.
5. ✅ Minor corrections: `DEFAULT FALSE` written explicitly and migration 36
   named as the wrong template (step 3); a single `json.Unmarshal` replaces
   `json.Valid` + `Unmarshal` (step 5); `ExecContext`/`QueryContext` honour `ctx`
   (steps 5–6); extraction logs carry field name + message id only (step 4);
   Rollback now requires dropping the table and resetting `schema_info` to 43;
   NFR-6 is stated as uncovered here and carried forward to the producer ticket
   (Validation strategy).

One panel finding was **dismissed knowingly**: the suggestion to replace the
parameter list with a `*MessageDebug` argument (step 2 explains why). Retention
remains out of scope by design, with the recommendation recorded above.

**Revision 3 (2026-08-15)** — folds in the second panel round on Revision 2:

1. ✅ **`chatJID` normalized at the write boundary** through the same helper the
   repository already uses for sent messages, with an unparseable JID rejected —
   the one `major` the second round found, and a real reopening of the orphan
   hole (step 2, tested in step 9 with an `@lid` JID).
2. ✅ The size cap is now a **named constant with a value** — 256 KiB — checked
   **before** the decode, with the boundary asserted in the tests (steps 5, 9).
3. ✅ Rejection behaviour is explicit: an error is returned, and the log carries
   the message id and a reason class only — never the payload or a decoder error
   quoting it (step 5).
4. ✅ Rollback states the two actual statements, `DROP TABLE` plus
   `DELETE FROM schema_info WHERE version > 43`, rather than "reset to 43".
5. ✅ Named mechanisms for the two assertions that a bare call cannot prove
   (`sql.DBStats` deltas for AC-17/AC-18), and AC-4 pinned to the index name with
   no `ANALYZE` (step 9).
6. ✅ Recorded rather than changed: timestamps supplied Go-side so AC-14 cannot
   flake; the top-level-object requirement stated as intended; the PK's omission
   of `chat_jid` and the uniqueness assumption behind it; the cap bounding bytes
   only; and the untrusted-input / PII notes carried forward to the consumer
   tickets (Validation strategy).

**Revision 4 (2026-08-15)** — the third panel round reviewed Revision 3 and found
two `major` defects **in Revision 3's own additions**, plus a contradiction
between lenses that had to be resolved against the code:

1. ✅ **`.ToNonAD()` reverted.** Two lenses recommended appending it; the third
   showed it would be wrong, and the code agrees — `sqlite_repository.go:2204`
   stores `normalizedJID.String()` with no `.ToNonAD()`, so applying it to
   `message_debug` alone would make its `chat_jid` diverge from
   `messages.chat_jid` and *create* the mismatch. The rule is now stated as
   byte-identical agreement with the message row, not canonicalization (step 2).
2. ✅ **Reachability no longer depends on normalization.** The message-scoped
   deletes are keyed chat-free — the primary key, or `message_id` alone for the
   legacy path — so a best-effort helper cannot strand a row (step 7). The two
   chat-scoped deletes keep the same exposure as the three dependant tables
   already deleted there, which is the house standard.
3. ✅ **`sql.DBStats` replaced.** It exposes connection counters only and has no
   query counter, so the AC-17/AC-18 mechanism written in Revision 3 was
   unimplementable. AC-17 now uses a closed `*sql.DB`; AC-18 unit-tests the
   chunking helper (step 9).
4. ✅ **The `@lid` delete test dropped as vacuous** — with no whatsmeow client in
   the test helper, `NormalizeJIDFromLID` is the identity function, so the test
   would pass even with the normalization deleted. Replaced with a stored-form
   assertion; that half of AC-16 is inspection evidence at `/verify` (step 9).
5. ✅ Also folded: the `db-error` path obeys the same no-PII logging rule and
   returns a wrapped sentinel, never the raw driver error (step 5); an empty
   `deviceID` is rejected on the read path too (step 6); a cleanup test writes
   through the wrapper and deletes via `DeleteDeviceData` to prove the
   `device_id` form matches (step 9); the LID-cache lock cost and the
   500 × 256 KiB chunk memory bound are recorded (Validation strategy); the
   retention recommendation is sharpened to *before producer 04 ships*; and the
   cap is noted as Go-side only against an unconstrained `TEXT` column.

Recorded honestly rather than fixed: LID normalization stays best-effort, so an
`@lid` row written with no client in context still survives a *per-chat* delete
(`DeleteDeviceData` and `TruncateAllChats` still reach it), and the shared JID
helper logs the raw JID and resolved phone itself.

A second panel finding was **dismissed with reasons**: replacing `map[string]any`
with a typed struct for extraction. It would allocate less, but `encoding/json`
errors on a wrongly-typed field, and since that decode error is the validity
check, the whole payload would be rejected — breaking REQ-13/AC-12 (step 4).
Also declined as speculative: adding `created_at` to the thread/session indexes
for an ordering no shipped code performs yet.
