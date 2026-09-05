---
ticket: cu-z8pmx9kcvh
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-08-22
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcvh"
  github: ""
---

# Verification — 14 · Migrate chat storage to PostgreSQL

**Outcome: PASSED.** All 20 acceptance criteria mapped to an executed result.

## Runtime impact

**Yes — this ticket changes runtime behaviour**, on purpose and only where an
acceptance criterion asks for it:

- `CHAT_STORAGE_URI` is now read from the environment. A deployment that already
  sets it will, from this build on, actually be honoured by the chat store —
  before this it was ignored and the compiled-in SQLite default always won. **This
  is the one change an operator must check before deploying:** if
  `CHAT_STORAGE_URI` is set to something other than the default in an existing
  environment, this build will start using it.
- An unsupported `CHAT_STORAGE_URI` now aborts startup instead of being ignored.
- On the PostgreSQL path only, a schema-migration failure is now fatal. The SQLite
  path keeps logging and continuing, exactly as before.
- Six write paths became single-statement upserts. Same rows, same columns, same
  `created_at` semantics; fewer round trips and no lost-update window.
- `ListDueChatwootForwardEvents` claims rather than reads **on PostgreSQL only**.

With no configuration change, a SQLite deployment takes the same code path, the
same pragmas, the same pool size and the same schema it has today (AC-17).

**No deployment runtime file was modified** — verified below (AC-19).

## Environment

- Go 1.25.5, Windows, build tag `purego` (the default cgo path cannot run the
  SQLite tests here: `CGO_ENABLED=0`, pre-existing).
- PostgreSQL 16.15 (`postgres:16-alpine`) in a throwaway container.
- Base for comparison: a4526a7.

## Acceptance criteria

| AC | Criterion | How it was executed | Result |
|----|-----------|---------------------|--------|
| AC-1 | A driver branch selects PostgreSQL or SQLite from the URI | `dbdialect.Detect` covered by `TestDetect` (13 URI forms) + `TestDetectRejectsUnsupportedScheme`; exercised live by starting the binary on each backend | **PASS** |
| AC-2 | `CHAT_STORAGE_URI` bound to the environment | Started the binary with `CHAT_STORAGE_URI=postgres://…`; log read `chat storage backend: postgres` with no source edit | **PASS** |
| AC-3 | Every query uses the driver's placeholder form | The **entire** chat-storage suite ran against real PostgreSQL and passed. A wrong placeholder form is a hard driver error, so a surviving one could not pass | **PASS** |
| AC-4 | SQLite pragmas applied only on the SQLite path | `initChatStorage` calls `FormatChatStorageURI` inside the `DialectSQLite` branch only; the PostgreSQL connection carries the URI unmodified — and would fail to connect if it carried `_journal_mode`, which it does not | **PASS** |
| AC-5 | Pool raised for PostgreSQL; SQLite unchanged; explicit override wins | `configureChatStoragePool`: PostgreSQL 20/5 + lifetime bounds, SQLite 5/5 as before; `CHAT_STORAGE_MAX_OPEN_CONNS` overrides on both | **PASS** |
| AC-6 | Every migration valid on PostgreSQL | `TestPostgresMigrationsCarryNoSQLiteOnlyConstructs`, `TestPostgresMigrationsUseBigserialForGeneratedIDs`, `TestPostgresDDLSubstitutionIsWordAnchored`, `TestPostgresDDLLeavesTimestampAlone`, and — the one that proves it — `TestPostgresMigrationsExecuteOnARealServer`, which runs all 50 against the server and re-runs them as a no-op | **PASS** |
| AC-7 | Device scoping preserved; no query gains cross-device reach | Every device-scoping test in the existing suite passed on both engines. The two queries whose predicates were rewritten are covered directly: `TestGetLatestChatwootMessageLinkByConversationScoping` (4 combinations) and `…NeverCrossesAccounts` | **PASS** |
| AC-8 | Chats, messages, reactions, edits, transcripts and debug rows migrate without loss | `TestChatStorageMigrateEndToEnd`: seeded SQLite → `chatstorage-migrate` → PostgreSQL, then asserted counts **and values** (a boolean, a `BLOB`, a 5 GB `file_length`) | **PASS** |
| AC-9 | Per-table counts logged before and after; mismatch fails | Captured from the end-to-end run: a `before` line, a `copied` line and an `after` line per table for all ten tables; the count comparison returns an error naming every mismatched table | **PASS** |
| AC-10 | Chat and message counts match | End-to-end run: `chats source=2 destination=2`, `messages source=3 destination=3`; every other table matched too | **PASS** |
| AC-11 | Unsupported URI aborts naming the supported schemes | Ran the binary with `CHAT_STORAGE_URI=mysql://gowa:sup3rs3cret@db.internal:3306/chatstorage`. Output: `fatal … unsupported chat storage URI scheme "mysql"; supported forms are "file:" (SQLite), "postgres:" or "postgresql:" (PostgreSQL), or a bare filesystem path (SQLite)`. Neither the password nor the host appears | **PASS** |
| AC-12 | Startup logs the active backend | `chat storage backend: sqlite` and `chat storage backend: postgres` captured from two runs | **PASS** |
| AC-13 | No API response shape changes; no dashboard change | `git diff --name-only` contains no path under `src/views/` and no REST DTO; the `ui/rest` and `usecase` suites pass unchanged on both engines | **PASS** |
| AC-14 | The suite passes against PostgreSQL, and against SQLite unconditionally | `go test -tags purego ./...` on both. Identical outcome: one failure, `TestResolveDocumentMIME/Zip`, **pre-existing** — reproduced in a worktree at base commit a4526a7 | **PASS** |
| AC-15 | A wrong placeholder form is reported by a test | Two layers: `TestRepositoryStatementsCarryNoPositionalPlaceholders` (AST scan of string literals) and `TestHandleRejectsPlaceholderArityMismatch`. The **real** coverage is the PostgreSQL run of the suite, which was executed — so AC-15 is verified, not merely asserted | **PASS** |
| AC-16 | A role without CREATE fails startup and leaves no migration half-applied | Created a PostgreSQL role with `USAGE` but not `CREATE` on a fresh schema and started the binary. Output: `fatal … chat storage schema migration failed: pq: permission denied for schema ac16 … (42501)`. `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='ac16'` returned **0** | **PASS** |
| AC-17 | No configuration change ⇒ behaviour identical | The full suite passes on SQLite with no env var set; `TestSQLiteMigrationsAreRenderedVerbatim` proves the SQLite DDL is the migration list byte for byte; the SQLite pool and pragma path are untouched | **PASS** |
| AC-18 | Search and filter semantics identical for ASCII | The existing search/filter/pagination tests pass on both engines. `LOWER(c.name) LIKE ?` with a Go-lowered argument keeps chat-name search case-insensitive on PostgreSQL, which a bare `LIKE` would not have been | **PASS** |
| AC-19 | No deployment runtime file modified | `git diff --name-only` checked against the six-file list; none present | **PASS** |
| AC-20 | Concurrent writers lose no write; no duplicate Chatwoot forward | Six upserts remove the lost-update window. `TestListDueChatwootForwardEventsClaimsExclusivelyOnPostgres` runs 4 concurrent claimers over 40 due events and asserts no event is claimed twice; `TestClaimedChatwootForwardEventsAreNotImmediatelyDueAgain` asserts the lease holds and then expires | **PASS** |

## Commands and outcomes

```
src/ $ go build ./... && go build -tags purego ./...        clean
src/ $ go vet ./...   && go vet -tags purego ./...          clean
src/ $ gofmt -l <every touched file>                        clean

src/ $ go test -tags purego ./...
       FAIL usecase  TestResolveDocumentMIME/Zip            (pre-existing)
       every other package ok

src/ $ CHAT_STORAGE_TEST_POSTGRES_URI=postgres://…  go test -tags purego ./...
       FAIL usecase  TestResolveDocumentMIME/Zip            (the same one)
       every other package ok
```

Pre-existing-failure proof, in a worktree at the base commit:

```
basewt/src $ go test -tags purego ./usecase/ -run TestResolveDocumentMIME
             FAIL  resolveDocumentMIME() = "application/x-zip-compressed",
                   want "application/zip"
```

Identical before and after, and it touches no chat-storage code.

## Defects this verification found and fixed

The PostgreSQL run is not a formality — it found two real defects that the SQLite
suite passes cleanly, both fixed before this outcome was recorded:

1. **`extractMessageDebug` could drop a whole diagnostics row.** SQLite ignores
   `VARCHAR(255)`; PostgreSQL enforces it, so a payload with a long derived field
   failed the insert. The derived fields are now clipped to the column width;
   `metadata_json` still stores the payload verbatim.
2. **The edit suite queried the raw pool with `?` placeholders**, which is a syntax
   error on PostgreSQL. It now queries through the repository's handle.

## Not verified / limits of this run

- The **default (cgo) build tag** was built and vetted but its SQLite tests cannot
  run in this environment (`CGO_ENABLED=0`). This is pre-existing and applies to
  every ticket in this chain.
- **Multi-instance operation was not run end to end.** The queue claim is verified
  by concurrent claimers inside one process against a real server, which is what
  exercises `SKIP LOCKED`; two full service instances against one database were
  not started.
- **Load and plan quality on PostgreSQL were not measured.** The index set is the
  SQLite one, carried across unchanged and deliberately not tuned here.
- **Pre-existing device-scope gaps remain** and are out of scope, as
  `spec.md > Out of scope` states: `GetChats` is device-scoped only when the caller
  supplies a `DeviceID`, and `DeleteChat` deletes by `chat_jid` with no device
  predicate. AC-7 says no query *gains* a cross-device reach — not that every query
  has one today. **The AC-7 pass should not be read as a clean bill of health on
  device isolation overall.**
- **The debug-retention sweeper is still guarded by an in-process mutex**, so two
  instances can sweep concurrently. The sweep is idempotent and bounded, so the
  cost is duplicate work rather than data loss. Documented, not solved.
