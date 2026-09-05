---
ticket: cu-z8pmx9kcvh
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-08-22
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcvh"
  github: ""
---

# Implementation — 14 · Migrate chat storage to PostgreSQL

Branch `ticket/cu-z8pmx9kcvh`, cut from `fix/stream-replaced-kills-process`
(a4526a7) — the current tip carrying migrations 48–50, which `main` does not have.

## Files changed

### New

| File | What it is |
|------|------------|
| `src/pkg/dbdialect/dbdialect.go` | `Detect` (URI → engine), `Rebind` (`?` → `$N`, literal/comment aware, returns the bound count), `DriverName` |
| `src/pkg/dbdialect/dbdialect_test.go` | 5 tests: every `Detect` branch, the no-URI-in-error assertion, `Rebind` including a 500-placeholder IN list |
| `src/infrastructure/chatstorage/dbhandle.go` | `dbHandle`/`txHandle` over `*sql.DB`/`*sql.Tx`; rebinds and enforces placeholder arity |
| `src/infrastructure/chatstorage/dbhandle_test.go` | handle + transaction rebinding, the arity guard, and the AST-based `$N`-in-source guard |
| `src/infrastructure/chatstorage/migrations_dialect_test.go` | DDL rendering: SQLite verbatim, PostgreSQL free of `AUTOINCREMENT`/`BLOB`/integer boolean defaults, word-anchoring, `TIMESTAMP` untouched, and the whole schema executed on a real server |
| `src/infrastructure/chatstorage/postgres_support_test.go` | the dual-engine harness: `CHAT_STORAGE_TEST_POSTGRES_URI` runs the existing suite against PostgreSQL, one schema per test |
| `src/infrastructure/chatstorage/chatwoot_conversation_lookup_test.go` | the four-combination cross-tenant routing table, plus a never-cross-accounts assertion |
| `src/infrastructure/chatstorage/chatwoot_forward_claim_test.go` | 4 concurrent claimers must partition the queue; a claimed event stays claimed for its lease and returns after it |
| `src/cmd/chatstorage_migrate.go` | the `chatstorage-migrate` command |
| `src/cmd/chatstorage_migrate_test.go` | the `initApp` guard table, `toBool`, and the end-to-end SQLite → PostgreSQL copy |
| `docs/chat-storage-postgresql.md` | operator note: configuring, migrating, privileges, pool sizing, known limits, running the suite against PostgreSQL |

### Modified

| File | Change |
|------|--------|
| `src/infrastructure/chatstorage/sqlite_repository.go` | handle type; six upserts; the untypable insert; three boolean comparisons; the `LIKE` parity fix; the bounded delete; the queue claim; `dialectDDL`; the atomic migration path; derived-field truncation |
| `src/cmd/root.go` | `chat_storage_uri` env binding; dialect branch and pool tuning in `initChatStorage`; backend log line; fatal schema failure on PostgreSQL; the migrate-subcommand guard |
| `src/config/settings.go` | four PostgreSQL pool constants |
| `.env.example` | `CHAT_STORAGE_URI` accepting PostgreSQL, `CHAT_STORAGE_MIGRATE_FROM`, `CHAT_STORAGE_MAX_OPEN_CONNS` |
| `src/infrastructure/chatstorage/sqlite_repository_test.go` | helper builds through the harness; `sqlite_master` test skipped on PostgreSQL |
| `src/infrastructure/chatstorage/sqlite_repository_debug_test.go` | two `EXPLAIN QUERY PLAN` blocks skipped on PostgreSQL; the retention plan assertion follows the new bounded delete |
| `src/infrastructure/chatstorage/sqlite_repository_debug_exists_test.go` | `EXPLAIN QUERY PLAN` test skipped on PostgreSQL |
| `src/infrastructure/chatstorage/sqlite_repository_edit_test.go` | builds through the harness; stops pinning the mattn driver by name; queries through the handle |

**No deployment runtime file was modified.** **No file under `src/views/` was
modified.**

## What was actually done

The repository keeps all 193 statements in `?` form. `SQLiteRepository.db` became
a `dbHandle` interface, so **not one call site changed** — the rewrite happens in
the handle. Beyond that, only what rebinding cannot fix was touched:

1. **`storeMessageEditExec`** — `INSERT … SELECT ?,…` is untypable on PostgreSQL
   (parameter types are inferred from a `VALUES` target, not through a `SELECT`).
   Now `VALUES … ON CONFLICT … DO NOTHING`.
2. **Six upserts** (`StoreChat`, `StoreMessage`, `StoreMessagesBatch`,
   `StoreReaction`, `UpsertChatwootMessageLink`, `SaveChatwootDeviceConfig`) —
   `UPDATE`-then-`INSERT` became `ON CONFLICT … DO UPDATE`. `created_at` is
   excluded from every `DO UPDATE`, reproducing what the `UPDATE` branch did.
   `SaveChatwootDeviceConfig` takes `RETURNING id`, which removed the
   `LastInsertId` problem with **no** dialect branch.
3. **Three boolean/integer comparisons** — `is_read = FALSE`, `enabled = TRUE`,
   and `c.archived` bound as a `bool`.
4. **`GetLatestChatwootMessageLinkByConversation`** — the `? = 1` / `? = 0` guards
   became Go-side conditions.
5. **`LOWER(c.name) LIKE ?`** — chat-name search stays case-insensitive.
6. **The bounded retention delete** — `rowid` became the table's own primary key
   as a row value, so there is no dialect branch at all.
7. **`ListDueChatwootForwardEvents`** — on PostgreSQL it claims with
   `FOR UPDATE SKIP LOCKED` and a five-minute lease.
8. **DDL** — `dialectDDL` substitutes `AUTOINCREMENT` → `BIGSERIAL` and `BLOB` →
   `BYTEA` (word-anchored) on the PostgreSQL path only; `DEFAULT 1` → `DEFAULT TRUE`
   and two `INTEGER` → `BIGINT` were corrected in the migration source.
9. **Migrations run in one transaction on PostgreSQL**, so a privilege failure
   leaves nothing half-applied.

## Deviations from the plan

Six, all adopted during implementation and all recorded here.

| # | Deviation | Why |
|---|-----------|-----|
| D-1 | **`ctid` branch dropped** in favour of a primary-key row-value bound in `DeleteMessageDebugOlderThanAllDevices`. | The plan carried the panel's `ctid` suggestion and its row-value alternative. The row-value form was measured on this schema first: SQLite still drives the subquery from `idx_message_debug_created_at` and the delete from the primary key. It removes a dialect branch entirely, so it won. |
| D-2 | **`extractMessageDebug` now truncates its derived fields to 255 bytes.** Not in the plan at all. | Found by running the suite against PostgreSQL: SQLite ignores a `VARCHAR(255)` length, PostgreSQL enforces it, so an agent payload with a long `enabled_by`/`intent`/`session.id` would have dropped the **whole** diagnostics row. `metadata_json` still keeps the payload verbatim, as migration 44 requires; only the derived filtering copies are bounded — the same choice `SetMessageTranscript` already makes for its engine-reported fields. |
| D-3 | **`sqlite_repository_edit_test.go` no longer pins `sqlite3` by name.** | It opened `sql.Open("sqlite3", ":memory:")` directly, which cannot run under the `purego` build tag. Routing it through the harness both fixed that and let the edit/cascade suite run on PostgreSQL. |
| D-4 | **`AC-20` was added to `spec.md`** (concurrent writers lose no write; no duplicate Chatwoot forward). | The upsert conversion and the queue claim are real behaviour this ticket delivers, and an unmapped behaviour cannot be verified. Two panel findings drove them; the AC makes them checkable. |
| D-5 | **The AC-15 source guard parses instead of grepping.** | Several comments in the file legitimately discuss `$N`, so a plain `strings.Contains` failed on its own documentation. It now walks the AST and inspects string literals only. |
| D-6 | **No `--dry-run`-only refusal path was needed for a non-empty destination in dry-run mode** — the emptiness check runs before the dry-run return, so `--dry-run` reports the problem too. | Strictly better than the plan's ordering; noted so the behaviour is not a surprise. |

## Validation run

All from `src/`. `-tags purego` throughout: the default (cgo) build cannot run the
SQLite tests in this environment (`CGO_ENABLED=0`), which is pre-existing.

| Command | Result |
|---------|--------|
| `go build ./...` and `go build -tags purego ./...` | clean |
| `go vet ./...` and `go vet -tags purego ./...` | clean |
| `gofmt -l` over every touched file | clean |
| `go test -tags purego ./...` | 1 failure: `TestResolveDocumentMIME/Zip` |
| `CHAT_STORAGE_TEST_POSTGRES_URI=… go test -tags purego ./...` | **the same 1 failure, nothing else** |

`TestResolveDocumentMIME/Zip` was confirmed pre-existing by running it in a
worktree at the base commit a4526a7: it fails there identically
(`application/x-zip-compressed` vs `application/zip` — a Windows registry MIME
mapping). It touches no chat-storage code.

PostgreSQL under test: 16.15, in a throwaway container.

## Notes carried forward

- `getSchemaVersion` creates `schema_info` outside the atomic migration
  transaction. A role that can create that one bookkeeping table but nothing else
  would leave it behind, empty. It is idempotent and carries no version rows, so
  a retry after the grant proceeds normally.
- Follow-ups recorded rather than done (see `plan.md > Panel response > Declined`):
  a `messages(device_id, chat_jid, timestamp DESC)` index, dropping the unusable
  `idx_chats_name`, and collapsing `CreateMessage`'s two chat lookups.
