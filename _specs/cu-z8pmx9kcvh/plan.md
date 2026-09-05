---
ticket: cu-z8pmx9kcvh
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-08-22
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcvh"
  github: ""
---

# Plan — 14 · Migrate chat storage to PostgreSQL

> **Revision 2.** The advisory panel (senior / security / performance — the three
> lenses `/review` dispatches) reviewed revision 1 before any code was written.
> 31 findings were adopted and 4 declined; every one is answered in
> **Panel response** at the end of this file. Revision 1's `TIMESTAMPTZ`
> substitution rule, `ctid` branch, `--chat-storage-uri` flag and `--truncate`
> flag were **removed** as a direct result, and six upsert sites, one untypable
> `INSERT … SELECT`, the migration transaction granularity, the subcommand boot
> path and the Chatwoot forward-queue claim were **added**.

## Approach

Three obstacles were measured in the code before this plan was written:

1. `cmd/root.go:999 initChatStorage()` opens `sqlite.DriverName` unconditionally
   and always applies SQLite pragmas via `sqlite.FormatChatStorageURI`.
2. `config.ChatStorageURI` has **no** entry in `initEnvConfig()` — the constant in
   `config/settings.go:101` is the only way to set it.
3. `infrastructure/chatstorage/sqlite_repository.go` (3307 lines) writes every
   statement in `?` form. `lib/pq` requires `$N`.

Rewriting 193 statements by hand is the expensive, error-prone answer. The cheap
and reviewable one is to make the placeholder form a property of the **handle**
rather than of each call site: the repository keeps its `?` source form — which
stays readable and stays the SQLite form — and a thin handle rebinds to `$N` on
the PostgreSQL path immediately before the driver sees the query. The repository
holds `dbHandle` (an interface) instead of `*sql.DB`, so **not one of the 193
call sites changes** and the diff is confined to the handle, the genuinely
dialect-specific statements, and startup wiring.

Rebinding is syntax only. The panel's most valuable contribution was the list of
things it cannot fix, each of which is now an explicit step:

- **Untypable SQL.** `storeMessageEditExec` writes `INSERT … SELECT ?,?,…`.
  PostgreSQL infers parameter types from the target columns of a `VALUES` list
  but *not* through a `SELECT`, so the rebound statement is syntactically valid
  and dies with `could not determine data type of parameter $1`.
- **Lost-update races.** Six sites do `UPDATE`, check `RowsAffected() == 0`, then
  `INSERT`. One SQLite file serialises that. A shared PostgreSQL database — the
  entire point of this ticket — lets two instances both see 0 and both insert;
  one takes a unique violation, and inside `StoreMessagesBatch` that violation
  aborts the whole history-sync transaction.
- **DDL.** `BLOB` and `INTEGER PRIMARY KEY AUTOINCREMENT` do not exist in
  PostgreSQL, and `BOOLEAN NOT NULL DEFAULT 1` is rejected. Migration 44 already
  documents the last of these.
- **Silent type mismatches.** Three places compare a boolean column to an integer
  (`is_read = 0`, `enabled = 1`, `archived = ?` bound as `1`/`0`). SQLite accepts
  them; PostgreSQL rejects them. Two `INTEGER` columns are `int4` on PostgreSQL
  and hold 64-bit values.
- **Semantics.** `LIKE` is ASCII-case-insensitive in SQLite and case-sensitive in
  PostgreSQL, so chat-name search would silently change behaviour.
- **Concurrency the storage change newly permits.** The Chatwoot forward queue is
  select-then-delete with no claim. On one SQLite file two workers cannot race;
  on shared PostgreSQL every due event is forwarded once per instance — a
  customer-visible duplicate.

Converting the six upserts to `ON CONFLICT … DO UPDATE` — already this file's own
idiom at `:926`, `:2416` and `:2695`, and portable since SQLite 3.24 — fixes the
race, halves the round trips on the per-message write path, and removes the
`LastInsertId` problem outright (`RETURNING id` works on both). After it, the
repository's **queries** carry no dialect branch at all; only the queue claim,
the DDL and startup do.

Data movement is a separate operator command, not a startup step.

## Steps

### 1 — New package `src/pkg/dbdialect`

`dbdialect.go`:

- `type Dialect string`, `DialectSQLite`, `DialectPostgres`.
- `Detect(uri string) (Dialect, error)`:
  - trim surrounding quotes/space, as `database.go:32` already does for `DB_URI`;
  - `file:` prefix maps to SQLite;
  - `postgres:` or `postgresql:` prefix maps to PostgreSQL. This accepts one
    scheme more than the precedent at `database.go:37`, deliberately:
    `.env.example:13` records that `postgresql://` being rejected there once
    printed a password to the console, and `lib/pq` accepts both. The divergence
    is documented in the operator note.
  - any other `scheme://` is an error;
  - anything else (a bare filesystem path) maps to SQLite, which is what
    `sql.Open(sqlite.DriverName, "storages/chatstorage.db")` means today. The
    `scheme://` test requires two or more scheme characters, so a Windows path
    (`D:\…`) is never mistaken for a scheme.
  - **The error names the supported schemes and carries the offending scheme
    only — never the URI, never userinfo.** A chat-storage URI holds a password.
- `Rebind(d Dialect, query string) (string, error)` — returns the input unchanged
  on SQLite, or when the query holds no `?`. On PostgreSQL it walks the query and
  replaces each `?` with `$1..$N`, **skipping** single-quoted literals,
  double-quoted identifiers, `--` line comments and block comments, so a future
  query containing a literal `?` cannot be corrupted. The builder is grown once.
- `CountPlaceholders(d, query) int` — used by the handle's arity check.
- `DriverName(d Dialect) string` — `sqlite.DriverName` or `"postgres"`.

`dbdialect_test.go` covers every branch of both functions, asserts the
unsupported-scheme error names the schemes, and asserts it **does not contain**
the URI or a password.

### 2 — Rebinding handle in `infrastructure/chatstorage/dbhandle.go`

- `sqlExecutor` — the six methods the repository calls (`Exec`, `ExecContext`,
  `Query`, `QueryContext`, `QueryRow`, `QueryRowContext`).
- `dbHandle` = `sqlExecutor` + `Begin() (txHandle, error)` + `Close() error`
  (used by two tests) + `Dialect()`.
- `txHandle` = `sqlExecutor` + `Prepare` + `Commit` + `Rollback`.
- Both must keep satisfying the ad-hoc `interface{ Exec(...) }` that
  `storeMessageEditExec` (`:1969`) declares — it takes `r.db` and a `tx`.
- `rebindDB{db *sql.DB, dialect}` and `rebindTx{tx *sql.Tx, dialect}` implement
  them by rebinding the query and delegating.
- **Arity check.** On the PostgreSQL path the handle verifies that the highest
  `$N` it emitted equals `len(args)`. A parser gap that renumbers by one would
  otherwise shift same-typed arguments — `device_id` and `chat_jid` are both
  strings — and silently read another device's rows, exactly what AC-7 forbids.
  `Exec`/`Query` return the mismatch as an error. `QueryRow` cannot carry one, so
  it logs at error level and proceeds; PostgreSQL then rejects the bind itself
  (`bind message supplies N parameters, but prepared statement requires M`), so
  that path still fails closed.
- `SQLiteRepository.db` changes type from `*sql.DB` to `dbHandle`.
- `NewStorageRepository(db *sql.DB, d dbdialect.Dialect)` gains the dialect
  argument — two call sites in the whole tree (`cmd/root.go:1060`, the test
  helper).

The type keeps the name `SQLiteRepository`: renaming it churns ~140 lines across
eight test files for no behavioural gain and would collide with the other
in-flight ticket branches. A doc comment records that it now serves both
dialects.

### 3 — Dialect-aware DDL (`getMigrations`)

The 50 migrations stay one list in one place. The list is **index-positional**
(`InitializeSchema:2939` maps slice index to version), so a per-dialect fork
would have to stay index-aligned forever across an append-only surface.
`postgresDDL(stmt string) string` applies two documented, case-sensitive,
word-boundary-anchored substitutions on the PostgreSQL path only:

| SQLite source | PostgreSQL | Why |
|---|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `BIGSERIAL PRIMARY KEY` | no `AUTOINCREMENT` (migrations 28, 36) |
| `BLOB` | `BYTEA` | no `BLOB` type (migration 2) |

Revision 1 also proposed `TIMESTAMP` → `TIMESTAMPTZ`. **Dropped.** Migration 2
names a *column* `timestamp` (`:3016`) and indexes it (`:3046`); a
case-insensitive replace would rename both and break every query selecting it,
and no acceptance criterion asks for it. Plain PostgreSQL `TIMESTAMP` round-trips
`time.Time` correctly because `cmd/root.go:73` pins `time.Local = time.UTC` —
the reasoning migration 48's comment (`:3256-3263`) already records.

Three corrections are made **in the migration source** instead, because each is
accepted identically by both engines and so needs no substitution rule:

- migration 36 `enabled BOOLEAN NOT NULL DEFAULT 1` → `DEFAULT TRUE`;
- migration 2 `file_length INTEGER` → `BIGINT` — it is written from a proto
  `uint64` and PostgreSQL `INTEGER` is `int4`, which would reject a >2 GB media
  length that SQLite accepts;
- migration 40 `chatwoot_config_id INTEGER` → `BIGINT` — it is compared against
  the `int64` config id at `:1038`/`:1049`.

Editing already-applied migration text is safe: the version counter means it
never re-runs, SQLite's type affinity makes `BIGINT` and `INTEGER` the same
column, and `1` and `TRUE` are the same value there.

**Migration transaction granularity.** `runMigration` (`:2972`) commits one
transaction per migration, so a failure part-way through leaves the schema half
applied — AC-16 says it must not. On the PostgreSQL path, where DDL is
transactional, `InitializeSchema` runs **all** pending migrations plus the
version bumps in **one** transaction. SQLite keeps today's per-migration
transaction, so AC-17 is untouched. The ignored error at `:2985`
(`_, _ = tx.Exec("DELETE FROM schema_info …")`) is checked on the PostgreSQL
path — there a failed statement poisons the transaction and surfaces as a
confusing "current transaction is aborted" on the next statement.

### 4 — Statements that rebinding cannot fix

1. **`storeMessageEditExec`** (`:1987`) — `INSERT … SELECT ?,?,… WHERE NOT EXISTS`
   is untypable on PostgreSQL. Rewrite as
   `INSERT … VALUES (…) ON CONFLICT (original_message_id, edit_event_id, device_id) DO NOTHING`,
   using migration 19's primary key. Same semantics, one statement, both engines.
2. **The six upsert sites** — `StoreChat:38`, `StoreMessage:331`,
   `StoreMessagesBatch:405`, `StoreReaction:450`, `UpsertChatwootMessageLink:775`,
   `SaveChatwootDeviceConfig:1080` — become
   `INSERT … ON CONFLICT (<primary key>) DO UPDATE SET col = excluded.col …`.
   `created_at` is left out of every `DO UPDATE`, which reproduces exactly
   today's behaviour (the UPDATE branch never wrote it).
   `SaveChatwootDeviceConfig` additionally takes `RETURNING id`, which is
   portable (SQLite ≥ 3.35) and removes the `LastInsertId` problem — `lib/pq`
   does not implement it — with **no** dialect branch.
   `StoreMessagesBatch` keeps one prepared statement instead of two and commits
   in bounded chunks so a history sync does not hold one transaction open across
   thousands of round trips.
3. **`GetLatestUnreadChatwootMessageLinkByChat`** (`:894`) — `is_read = 0`
   becomes `is_read = FALSE` (portable; SQLite has understood `FALSE` since 3.23).
4. **`GetChatwootDeviceConfigByInbox`** (`:1203`) — `enabled = 1` becomes
   `enabled = TRUE`.
5. **`buildChatFilterQuery`** (`:181`) — `c.archived = ?` is bound with the
   integers `1`/`0`; bind the `bool`. SQLite stores it as 0/1 exactly as before.
6. **`GetLatestChatwootMessageLinkByConversation`** (`:844`) — the
   `(? = 1 AND …)` / `(? = 0 OR …)` trick makes PostgreSQL infer `int4` for
   `configID`, an `int64`. Build the two optional conditions in Go instead. This
   is a **cross-tenant routing control** — the comment at `:845-849` records that
   the legacy-zero branch is what stops a legacy account-0 link matching
   account-wide — so it gets a table test over all four
   (`allowLegacyZero` × `configID == 0`) combinations asserting the new predicate
   selects exactly the old row set.
7. **`DeleteMessageDebugOlderThanAllDevices`** (`:2584`) — the bounded delete uses
   `WHERE rowid IN (…)`; PostgreSQL has no `rowid`. Rather than branch to `ctid`,
   bound by the table's own primary key:
   `WHERE (device_id, message_id) IN (SELECT device_id, message_id … ORDER BY created_at LIMIT ?)`.
   Row values in `IN` are supported by SQLite ≥ 3.15 and by PostgreSQL, so the
   dialect branch disappears. Measured on this schema, SQLite still drives the
   subquery from `idx_message_debug_created_at` and the delete from the primary
   key — no table scan, which is the guarantee `debug_retention.go:17` claims.
   The `ORDER BY` is new and makes the bound deterministic on both engines.
8. **`ListDueChatwootForwardEvents`** (`:936`) — select-then-delete with no claim.
   Harmless behind one SQLite writer; on a shared database every instance
   forwards every due event. On the PostgreSQL path, claim atomically:
   `UPDATE … SET next_attempt_at = <now + lease> WHERE id IN (SELECT id … ORDER BY … LIMIT ? FOR UPDATE SKIP LOCKED) RETURNING <columns>`.
   The lease is the existing retry window, so a crashed worker's events become
   due again on their own. SQLite keeps today's statement.

### 5 — Search semantics parity

`buildChatFilterQuery`'s `c.name LIKE ?` becomes `LOWER(c.name) LIKE ?` with the
argument lowered in Go — the idiom `SearchMessages` (`:592`) already uses. Without
it, chat-name search silently becomes case-sensitive on PostgreSQL (AC-18). On
SQLite the behaviour is unchanged for ASCII, which is what it does today; AC-18
is scoped to ASCII for exactly this reason, since SQLite's `LOWER()` is ASCII-only
while PostgreSQL's is locale-aware.

### 6 — Startup wiring (`cmd/root.go`)

- `initEnvConfig()`: bind `chat_storage_uri` (AC-2), guarded on non-empty like
  `db_uri` beside it. `chat_storage_max_open_conns` is already bound at `:150`.
  **No CLI flag** is added: AC-2 asks for the environment, and a flag would put a
  database password in `ps` output and shell history. `redactedSettings()`
  (`:385`) already treats `uri` as sensitive, so the env key is redacted.
- `initChatStorage()`:
  - `dbdialect.Detect(config.ChatStorageURI)`; on error return it — the existing
    `logrus.Fatalf` at `:1056` makes it the aborting startup AC-11 asks for.
  - SQLite keeps today's path exactly: `FormatChatStorageURI` + pragmas, pool 5.
  - PostgreSQL uses `sql.Open("postgres", uri)` with **no** pragma formatting,
    `MaxOpenConns` 20, `MaxIdleConns` 5 (today's code copies max into idle, which
    at four instances would pin 80 idle backends against PostgreSQL's default
    `max_connections` of 100), `ConnMaxLifetime` 30 m and `ConnMaxIdleTime` 5 m so
    a pooler-killed connection is not handed to a caller as `EOF`. An explicit
    `CHAT_STORAGE_MAX_OPEN_CONNS` still wins on both paths.
  - The open/ping error is wrapped **without** the URI.
  - Returns the dialect alongside the handle; `initApp` logs
    `chat storage backend: postgres|sqlite` (AC-12). The URI is never logged.
- `InitializeSchema()` failure (`:1065`) is `logrus.Fatalf` **on the PostgreSQL
  path** and stays `logrus.Errorf` on SQLite. AC-16 needs the abort; the comment
  at `:1062-1064` explains why making it fatal for pre-existing SQLite
  deployments would be a behaviour change, and AC-17/CON-4 forbid that.
- **Subcommand guard.** `cobra.OnInitialize(initEnvConfig, initApp)` (`:81`) runs
  for *every* subcommand, so without a guard `chatstorage-migrate` would open the
  configured store, run migrations against it, start whatsmeow and load devices
  before copying a row. `initApp` returns early when the resolved command is the
  migrate command. This guard is on the shared startup path, so `rest` and `mcp`
  are covered by the existing tests plus a unit test on the resolver.

### 7 — Data migration command `src/cmd/chatstorage_migrate.go`

`gowa chatstorage-migrate` — source and destination default to
`CHAT_STORAGE_MIGRATE_FROM` / `CHAT_STORAGE_URI` in the environment, with
`--from` / `--to` as an explicit override, so a password need not appear in
`argv`. Behaviour:

- opens both sides through the same `dbdialect` code as startup;
- runs `InitializeSchema()` on the destination;
- **refuses** to run when any destination table is non-empty, and names the
  tables. There is no `--truncate`: dropping a live chat store — which holds
  `chatwoot_device_configs.api_token` — is not a flag, it is an operator decision
  taken deliberately outside this tool. The refusal message says so.
- `--dry-run` prints the per-table source counts and the destination emptiness
  check, and copies nothing;
- copies table by table in FK-safe order (chats, messages, devices,
  message_reactions, message_edits, chatwoot_message_links,
  chatwoot_forward_queue, chatwoot_device_configs, message_debug,
  message_transcript) using `pq.CopyIn`, streaming the source cursor and
  committing every 5 000 rows, so neither side accumulates the table in memory;
- **converts per column**: SQLite returns `int64` 0/1 for `is_from_me`,
  `archived`, `is_read`, `enabled` and `intent_complete`, and PostgreSQL's
  `boolean` rejects it; `BLOB` columns pass through as `[]byte`; timestamps are
  scanned as `time.Time`. Counts alone cannot catch a coercion bug, so the
  command also spot-checks one chat and one message field-by-field after the copy;
- resets the two `BIGSERIAL` sequences with `setval` after copying explicit ids —
  otherwise the first live insert collides with a copied row, and a wrong config
  id "would silently unscope every link written for this config" (`:1112-1117`) —
  and then asserts each sequence's next value exceeds `MAX(id)`;
- logs `table=<t> source=<n> destination=<m>` per table before and after (AC-9)
  and **fails** on any mismatch (AC-10), naming in the error every table already
  committed so the operator knows exactly what the destination holds.

### 8 — Tests

- `pkg/dbdialect/dbdialect_test.go` — `Detect`, `Rebind`, `CountPlaceholders`,
  and the no-URI-in-error assertion (AC-1, AC-11).
- `infrastructure/chatstorage/dbhandle_test.go` — rebinding on/off per dialect
  through `Exec`/`Query`/`QueryRow`/`Begin`/`Prepare`, and the arity check.
- `infrastructure/chatstorage/migrations_dialect_test.go` — the rendered
  PostgreSQL DDL contains no `AUTOINCREMENT`, no word-boundary `BLOB` and no
  `DEFAULT 1`; the SQLite rendering is byte-identical to the source list
  (AC-6, AC-17); and, when a PostgreSQL test database is configured, every
  rendered statement actually **executes** — which is what proves it, and which
  also settles whether `text` (migration 49, used as an identifier at `:2691`)
  parses.
- A table test over the four `GetLatestChatwootMessageLinkByConversation`
  combinations (step 4 item 6).
- A test that the `chatstorage-migrate` command is recognised by the `initApp`
  guard and `rest`/`mcp` are not.
- `newTestSQLiteRepository` gains a PostgreSQL mode: when
  `CHAT_STORAGE_TEST_POSTGRES_URI` is set it creates a per-test schema, runs
  against it and drops it on cleanup; unset keeps today's SQLite temp file. The
  **existing** suite then runs unchanged against both backends (AC-14). The four
  SQLite-only assertions (`sqlite_master`, `EXPLAIN QUERY PLAN` twice,
  `PRAGMA foreign_keys`) get a skip guard — `sqlite_repository_debug_test.go:124`
  already anticipates this ticket in a comment.
- The AC-15 grep for `$1`-style placeholders in `sqlite_repository.go` is kept
  because it is cheap, but the honest statement is recorded in `verify.md`:
  rebinding is syntactic, so the real coverage for AC-15 is the PostgreSQL run of
  the suite (AC-14). A skipped PostgreSQL run means AC-15 is **unverified**, not
  passed.

## Files to change

| File | Change |
|------|--------|
| `src/pkg/dbdialect/dbdialect.go` | **new** — detection, rebinding, placeholder count, driver name |
| `src/pkg/dbdialect/dbdialect_test.go` | **new** — unit tests |
| `src/infrastructure/chatstorage/dbhandle.go` | **new** — rebinding `*sql.DB`/`*sql.Tx` handles + arity check |
| `src/infrastructure/chatstorage/dbhandle_test.go` | **new** — handle tests |
| `src/infrastructure/chatstorage/migrations_dialect_test.go` | **new** — DDL rendering + placeholder-form guard |
| `src/infrastructure/chatstorage/postgres_support_test.go` | **new** — PostgreSQL test-harness helper |
| `src/infrastructure/chatstorage/chatwoot_conversation_lookup_test.go` | **new** — the four-combination routing test |
| `src/cmd/chatstorage_migrate.go` | **new** — `chatstorage-migrate` command |
| `src/cmd/chatstorage_migrate_test.go` | **new** — subcommand guard test |
| `src/infrastructure/chatstorage/sqlite_repository.go` | handle type, upserts, untypable insert, boolean/LIKE fixes, bounded delete, queue claim, `postgresDDL`, migration transaction |
| `src/infrastructure/chatstorage/sqlite_repository_test.go` | helper takes a dialect; SQLite-only test skipped on PostgreSQL |
| `src/infrastructure/chatstorage/sqlite_repository_debug_test.go` | SQLite-only plan assertions skipped; the retention plan assertion follows the new bounded delete |
| `src/infrastructure/chatstorage/sqlite_repository_debug_exists_test.go` | SQLite-only plan assertion skipped |
| `src/infrastructure/chatstorage/sqlite_repository_edit_test.go` | `PRAGMA foreign_keys` skipped on PostgreSQL |
| `src/cmd/root.go` | env binding, dialect branch, pool tuning, backend log, fatal schema failure on PostgreSQL, subcommand guard |
| `src/config/settings.go` | PostgreSQL pool constants |
| `.env.example` | document `CHAT_STORAGE_URI` accepting a `postgres://` URI |
| `docs/chat-storage-postgresql.md` | **new** — operator note: pointing the store at PostgreSQL, running the data migration, and the known limits |
| `_specs/cu-z8pmx9kcvh/*` | ticket artifacts |

No deployment runtime file is in this list (AC-19, CON-1). No file under
`src/views/` is in this list (AC-13).

## Validation strategy

- `go build ./...`, `go vet ./...`, and the same two under `-tags purego`.
- `go test -tags purego ./...` from `src/` — the full suite on SQLite, the default
  path, proving AC-17.
- `go test -tags purego ./infrastructure/chatstorage/... ./pkg/dbdialect/...` with
  `CHAT_STORAGE_TEST_POSTGRES_URI` pointed at a real PostgreSQL 16 — the same
  suite against PostgreSQL (AC-14, and the real coverage for AC-3/AC-6/AC-15).
  If no instance is reachable the run is recorded as **skipped** in `verify.md`,
  not claimed as passed.
- End-to-end: create a SQLite store with data, run `chatstorage-migrate` into
  PostgreSQL, compare counts and spot-checked field values (AC-8, AC-9, AC-10).
- Manual: start with an unsupported URI and capture the abort message, and check
  it contains no URI (AC-11); start on SQLite and capture the backend log line
  (AC-12); revoke `CREATE` from the role and confirm startup aborts with the
  privilege error and an empty schema (AC-16).
- `git diff --stat` against the deployment runtime file list (AC-19) and against
  `src/views/` (AC-13).

## Rollback

Every change is additive or dialect-guarded, and the default `CHAT_STORAGE_URI`
is unchanged, so the SQLite path is the same code path it is today. Rollback is
`git revert` of the single publishable commit.

The data migration needs no rollback on the **source** side: it opens the SQLite
store read-only and never writes to it. On the **destination** side it refuses to
touch a non-empty database at all, so a failed run leaves only tables it created
and rows it committed — the error names them, and the operator drops that
database. Restoring a destination that already held data is out of the tool's
hands and requires a backup taken before the run; the operator note says so.

## Out of scope

As `spec.md > Out of scope`.

## Panel response

The advisory panel reviewed revision 1. 31 findings adopted, 4 declined.

### Adopted — design corrections (would have shipped a defect)

| # | Lens | Finding | Change |
|---|------|---------|--------|
| 1 | senior | `storeMessageEditExec` writes `INSERT … SELECT ?,…`; PostgreSQL cannot infer parameter types through a `SELECT`. Rebinding produces valid-but-dead SQL on the edit hot path. | Step 4.1 — rewritten to `VALUES … ON CONFLICT DO NOTHING`. |
| 2 | senior | `TIMESTAMP` → `TIMESTAMPTZ` would rename the `timestamp` **column** in migration 2 and its index, breaking ~15 queries. | Step 3 — rule **dropped**. |
| 3 | senior | `cobra.OnInitialize(initEnvConfig, initApp)` runs for every subcommand, so `chatstorage-migrate` would boot the whole gateway first. | Step 6 — explicit guard, plus a test. |
| 4 | senior + perf | Six `UPDATE`-then-`INSERT` upserts race on a shared database; in `StoreMessagesBatch` one collision aborts a whole history sync. | Step 4.2 — all six become `ON CONFLICT … DO UPDATE`. |
| 5 | senior + security | AC-16 unreachable: `InitializeSchema` failure is `logrus.Errorf` and startup continues (`root.go:1065`). | Step 6 — fatal on the PostgreSQL path only, so AC-17 holds. |
| 6 | security | AC-16's "no partially migrated schema" is false: `runMigration` commits per migration. | Step 3 — one transaction for all pending migrations on PostgreSQL. |
| 7 | security | The unsupported-URI error would echo the URI, the exact bug `.env.example:13` warns about. | Step 1 — error carries the scheme only; a test asserts the URI is absent. |
| 8 | perf | The Chatwoot forward queue has no claim; on a shared database every instance forwards every due event. | Step 4.8 — `FOR UPDATE SKIP LOCKED` lease claim on the PostgreSQL path. |
| 9 | senior | `file_length INTEGER` is `int4` on PostgreSQL and is written from a proto `uint64`. | Step 3 — source changed to `BIGINT` (also `chatwoot_config_id`). |
| 10 | security | A `Rebind` miscount fails **open**: same-typed args shift and read another device's rows. | Step 2 — arity check in the handle. |
| 11 | senior | `dbHandle` missed `Close()` (two tests) and the ad-hoc `execer` interface at `:1969`. | Step 2 — both listed. |

### Adopted — hardening and honesty

| # | Lens | Finding | Change |
|---|------|---------|--------|
| 12 | security | `--truncate` can silently destroy a live store including `api_token` rows. | Step 7 — flag **removed**; refuse and explain. `--dry-run` added. |
| 13 | security | A mid-run failure leaves the destination partly populated with no stated recovery. | Step 7 + Rollback — the error names every committed table. |
| 14 | security | `--from`/`--to` put a password in `argv`. | Step 7 — environment by default, flags as override. |
| 15 | senior | `--chat-storage-uri` is not required by any AC and leaks into `ps`. | Step 6 — flag dropped. |
| 16 | security | The rewritten conversation lookup is a cross-tenant routing control with no test. | Step 4.6 + step 8 — four-combination table test. |
| 17 | security | `postgresDDL`'s `BLOB` rule was unanchored; token-absence is a weak assertion. | Step 3 + step 8 — word-boundary anchor, and the rendered DDL is **executed** against real PostgreSQL. |
| 18 | security | `_, _ = tx.Exec("DELETE FROM schema_info …")` poisons a PostgreSQL transaction. | Step 3 — error checked on the PostgreSQL path. |
| 19 | security | `setval` is the control that stops an id collision mis-scoping Chatwoot links. | Step 7 — post-migration assertion that `nextval > MAX(id)`. |
| 20 | security | Open/ping errors could echo the URI via `lib/pq`. | Step 6 — wrapped without the URI; added to manual validation. |
| 21 | senior | `dbdialect.Detect` diverges from `database.go:37` without saying so. | Step 1 — divergence stated and justified (`postgresql://`). |
| 22 | senior | The AC-15 `$1` grep proves nothing; every real defect here is invisible to it. | Step 8 — kept, but a skipped PostgreSQL run is recorded as AC-15 **unverified**. |
| 23 | senior | The copy loses data at the column level, which row counts pass cleanly. | Step 7 — per-column conversion named, plus a field-by-field spot check. |
| 24 | perf | Pool of 25 with idle = max, and no lifetime, exhausts `max_connections` at four instances and hands out dead pooler connections. | Step 6 — 20/5 with `ConnMaxLifetime`/`ConnMaxIdleTime`. |
| 25 | perf | Parameterised INSERT and one transaction per table make the copy slow and unbounded. | Step 7 — `pq.CopyIn`, streamed, committing every 5 000 rows. |
| 26 | perf | `ctid IN (subquery)` can degrade to a sequential scan; a PK row-value bound is better and portable. | Step 4.7 — row-value bound; `ctid` branch removed. Plan measured on this schema. |
| 27 | perf | Keep rebinding uncached — it is <1 % of a round trip — but make it allocation-lean. | Step 1 — early return, single `Grow`. |
| 28 | perf + senior | AC-18 cannot claim identical semantics: SQLite's `LOWER()` is ASCII-only, PostgreSQL's is locale-aware. | `spec.md` AC-18 scoped to ASCII. |
| 29 | senior | `text` as an identifier (migration 49) is one keyword away from a runtime-only failure. | Step 8 — covered by executing the DDL on real PostgreSQL. |
| 30 | perf | A new index migration takes `ACCESS EXCLUSIVE` and blocks the other instances. | Operator note. |
| 31 | senior | `docs/` was not an unambiguous Files-to-change entry (IM-4). | Named: `docs/chat-storage-postgresql.md`. |

### Declined

| # | Lens | Finding | Why declined |
|---|------|---------|--------------|
| A | perf | Add migration 51 `messages(device_id, chat_jid, timestamp DESC)` while the schema is open. | Real, but no AC needs it, and appending to the index-positional migration list is the one part of this file that conflicts with the other in-flight ticket branches. Recorded as a follow-up ticket instead. |
| B | perf | Drop `idx_chats_name` — it is unusable behind a leading `%` and pure write cost. | Same reason, plus dropping an index is a separate, independently reversible decision. Recorded as a follow-up. |
| C | security | `GetChats` is only device-scoped when `filter.DeviceID != ""`, and `DeleteChat` has no device predicate. | Pre-existing and unchanged by this ticket. Stated plainly in `spec.md > Out of scope` and in `verify.md` so the AC-7 result is not read as a clean bill of health. |
| D | perf | Collapse `CreateMessage`'s two `GetChatByDevice` calls into one. | A behaviour-preserving refactor of a function this ticket otherwise does not touch; it is scope creep against the small-change philosophy. Recorded as a follow-up. |
