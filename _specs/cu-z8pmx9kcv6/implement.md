---
ticket: cu-z8pmx9kcv6
stage: implement
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-15
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv6"
  github: ""
---

# Implement — cu-z8pmx9kcv6

> Record of what was actually built, following `plan.md` (Revision 4).

Entry path: **initial** (state was `approved`). Branch `ticket/cu-z8pmx9kcv6`
created from clean `main` (IM-3). Note that `main` was two commits behind the
previous ticket's branch, but those commits touch `_specs/cu-z8pmx9kcv5/` only —
no source — so branching from `main` dropped no dependency.

## Changes made

- `src/domains/chatstorage/chatstorage.go` — added the `MessageDebug` DTO: the
  verbatim `MetadataJSON` plus the nine promoted fields, `ChatJID`, and the
  `CreatedAt`/`UpdatedAt` pair, with `db` tags matching the new columns. The
  doc comment records that `MetadataJSON` is the source of truth and that the
  row is not constrained to its message.
- `src/domains/chatstorage/interfaces.go` — declared `SetMessageDebug` and
  `GetMessageDebugBatch` on `IChatStorageRepository`.
- `src/infrastructure/chatstorage/sqlite_repository.go`:
  - migrations **44–47** appended (table, thread index, session index, chat
    index), one statement each; `intent_complete BOOLEAN NOT NULL DEFAULT
    FALSE`, no `FOREIGN KEY`;
  - `SetMessageDebug` — argument guards, chat-JID validation and normalization,
    the 256 KiB cap checked before the decode, a single `json.Unmarshal` that
    doubles as the validity check, and a portable
    `INSERT … ON CONFLICT(device_id, message_id) DO UPDATE` via `ExecContext`
    that preserves `created_at` and advances `updated_at`;
  - `GetMessageDebugBatch` — empty-`deviceID` rejection, an empty-slice
    short-circuit that runs no SQL, 500-id chunking through the new
    `chunkMessageDebugIDs` helper, and `QueryContext` with `device_id` always
    bound;
  - `extractMessageDebug` plus four typed readers — every promoted field
    degrades to its zero value on absent/null/wrong-typed input, logging field
    name and message id only;
  - `ErrMessageDebugRejected`, `maxMessageDebugBytes`, `messageDebugChunkSize`;
  - `message_debug` cleanup added to all six delete paths: `DeleteChat`,
    `DeleteChatByDevice`, `DeleteMessage`, `DeleteMessageByDevice`,
    `DeleteDeviceData`, `TruncateAllChats`.
- `src/infrastructure/whatsapp/chatstorage_wrapper.go` — both methods delegated
  on `deviceChatStorage` with the established blank-device fallback.
- `src/infrastructure/chatstorage/sqlite_repository_debug_test.go` — **new**,
  19 tests covering the reference payload round-trip, promoted values, index
  usage, replacement semantics, batch shape, device isolation, every rejection
  case, null/unknown/wrongly-typed fields, the pre-message write, all six
  cleanup paths, both batch edges, and migration append-only + portability.

## Changes prepared (uncommitted)

> `/implement` creates **no commit** (IM-9 / ADR-008); there are no SHAs to
> record here. List the changed files — the single publishable commit is created
> later by `/publish-pr` (the git delivery boundary).

- `src/domains/chatstorage/chatstorage.go` — modified
- `src/domains/chatstorage/interfaces.go` — modified
- `src/infrastructure/chatstorage/sqlite_repository.go` — modified
- `src/infrastructure/whatsapp/chatstorage_wrapper.go` — modified
- `src/infrastructure/chatstorage/sqlite_repository_debug_test.go` — new

Exactly the five files listed in `plan.md > Files to change`; nothing else was
touched (IM-4). No deployment runtime file was modified (IM-5 / GU-2).
(`gallery/database.png` shows as untracked but predates this ticket and is not
part of this work.)

## Deviations from plan

1. **`ErrMessageDebugRejected` is declared in `sqlite_repository.go`, not in the
   domain package.** The plan called for a "wrapped sentinel", and the natural
   home would be `src/domains/chatstorage/errors.go` beside
   `ErrMissingDeviceContext` — but that file is **not** in the approved "Files to
   change" list, and widening the change set silently would be scope creep
   (IM-4). Consequence: a consumer wanting `errors.Is` must import the
   infrastructure package. Worth moving to the domain package in the producer
   ticket, which will touch these files anyway.
2. **Chat-JID validation is stricter than "does not parse".** `types.ParseJID`
   proved lenient — the string `"not a jid"` parses as a server-only JID — so the
   check also requires a non-empty `User` and `Server`. Without this the plan's
   stated rejection would not have fired; a test proved it.
3. **The `EXPLAIN QUERY PLAN` assertion is scoped as the plan directed** (index
   name, no `ANALYZE`), and is marked in the test file as SQLite-only for the
   engine-swap ticket.

No deviation changes the approach, the schema, or any acceptance criterion.

## Constraints carried forward to the consumer tickets (04 / 06 / 07 / 14)

Recorded here because `plan.md` requires it and the producer does not exist yet:

- **NFR-6** — `SetMessageDebug` is a plain synchronous write. The producer must
  call it **off the request path**, mirroring the goroutine at
  `usecase/send.go:74`. A second, concrete reason: normalizing an `@lid` chat JID
  can take whatsmeow's LID-map write lock across a database round trip, which is
  now a network round trip since the session store moved to PostgreSQL.
- **AC-13's other half** — the producer must not propagate the error
  `SetMessageDebug` returns; a failed diagnostics write must never abort a reply.
  It must also not log the returned error raw.
- **JID and device-id form** — the producer must pass the same `chat_jid` and the
  same `device_id` form it used for the message row. LID normalization here is
  best-effort: with no whatsmeow client in context the helper returns the `@lid`
  JID unchanged, and such a row would survive a per-chat delete (though
  `DeleteDeviceData` and `TruncateAllChats` still reach it).
- **`metadata_json` is untrusted third-party input** stored verbatim with unknown
  keys: escape it on render, never log it raw (stored-XSS / log-injection).
- **PII inventory** — `phone`, `thread_id` (which embeds the phone) and
  `chat_jid` all carry the customer's number, two of them indexed. The 256 KiB
  cap is enforced Go-side only, against an unconstrained `TEXT` column.
- **Memory bound** — a 500-id chunk is bounded at 500 × 256 KiB worst case
  (~0.5 MB with a real payload). A promoted-fields-only read variant belongs to
  the ticket that builds a list view.
- **Retention** — still out of scope, and recommended **before producer 04
  ships**, not merely before the table grows large.

## Validation run during implementation

Profile `go-source`. The default build has `CGO_ENABLED=0` in this environment,
so the CGO SQLite driver is a stub; tests were therefore also run with
`-tags purego` (`modernc.org/sqlite`), the repo's supported alternative.

- `go build -C src ./...` — **PASS** (no output).
- `go vet -C src ./...` — **PASS** (no output).
- `go test -C src -tags purego ./infrastructure/chatstorage/...` — the 19 new
  tests **PASS**; one pre-existing failure remains (below).
- `go test -C src -tags purego ./...` — every package **ok** except two
  **pre-existing** failures, both verified against the pristine baseline by
  stashing this ticket's changes and re-running:
  - `TestSQLiteRepositoryEditTestSuite` — `sqlite_repository_edit_test.go:28`
    opens `go-sqlite3` directly to enable foreign keys, which needs CGO. Fails
    identically on the untouched tree.
  - `usecase.TestResolveDocumentMIME/Zip` — Windows resolves `.zip` to
    `application/x-zip-compressed` rather than `application/zip`. Fails
    identically on the untouched tree.

Neither failure touches `message_debug`, and neither is caused by this change.
`/verify` should re-run the profile and record them as pre-existing environment
failures rather than regressions.
