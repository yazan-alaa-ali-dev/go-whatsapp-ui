---
ticket: cu-z8pmx9kcv6
stage: research
mode: standard
status: complete
owner: ai_agent
updated: 2026-08-15
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv6"
  github: ""
---

# Research — 03 · Create the message debug storage layer

> Read-only investigation. Start from `AGENTS.md` (repo map) and the nested
> `AGENTS.md` files under `src/`, then verify every claim against the actual
> code — never quote the map without confirming it.

## Relevant directories  <!-- RS-1 -->

| Path | Why it matters |
|------|----------------|
| `src/infrastructure/chatstorage/` | Holds `sqlite_repository.go` — the single concrete implementation of the chat-storage contract, including the inline migration list and all SQL. The `message_debug` table, its migrations and both new methods land here. |
| `src/domains/chatstorage/` | `interfaces.go` declares `IChatStorageRepository` (verified: 60+ methods, `InitializeSchema()` last at line 117). `chatstorage.go` holds the DTOs; a `MessageDebug` struct (if one is needed) belongs here. |
| `src/infrastructure/whatsapp/` | `chatstorage_wrapper.go` defines `deviceChatStorage`, the device-scoped wrapper that must delegate every interface method (AC "General Behavior" 4). Verified pattern at lines 79–104: plain delegation, or `deviceID`-fallback (`if targetDeviceID == "" { targetDeviceID = r.deviceID }`) for device-scoped methods. |
| `src/cmd/` | `root.go:622` `initChatStorage()` opens the chat DB and `root.go:667-668` builds the repository and calls `InitializeSchema()` — the path that will execute migrations 44–46 at startup. |
| `src/usecase/` | Consumer layer. `send.go:74-78` confirms the ticket's premise: the sent-message row is written in a detached goroutine (`context.WithoutCancel`, 15s timeout) after the HTTP response, which is why debug data belongs in its own table rather than a `messages` column. No usecase change is expected in this ticket. |
| `src/pkg/sqlite/` | `DriverName` and `FormatChatStorageURI` — build-tag split: CGO `sqlite3` (`sqlite_cgo.go:11`) vs purego `sqlite` (`sqlite_purego.go:11`). Determines the SQL dialect the new migrations must satisfy. |

## Relevant config files  <!-- RS-2 -->

| File | Relevance |
|------|-----------|
| `src/config/settings.go:76` | `ChatStorageURI = "file:storages/chatstorage.db"` — the chat store default. Also `ChatStorageEnableWAL`, `ChatStorageEnableForeignKeys`, `ChatStorageMaxOpenConns` consumed by `initChatStorage()`. |
| `src/cmd/root.go:622-645` | `initChatStorage()`: `sql.Open(sqlite.DriverName, connStr)` — **there is no `postgres:` branch here**. Contrast with `src/infrastructure/whatsapp/database.go:35-37`, the *session* store, which does have one (the subject of ticket `cu-z8pmx9kcv5`). |
| `src/.env.example` | Where a chat-storage env var would be documented if configuration changed. No change expected for this ticket. |
| `.claude/project-config.yaml` | `validation_checks` / `validation_profiles`; the `go-source` profile (`go-build`, `go-vet`, `go-test`) is the one applicable to this ticket. |
| Deployment runtime files (`docker-compose.yml`, `docker/golang.Dockerfile`, `docker/entrypoint.sh`, `.github/workflows/*.yaml`) | Read-only context only. Not in scope (intake: deployment runtime impact = **No**); modifying one is a hard-stop (GU-2, IM-5). |

<Deployment runtime files are read here only to understand them — never modified.>

## Possibly affected services / layers  <!-- RS-3 -->

Only the storage layer and its contract:

- `domains/chatstorage` — add `SetMessageDebug` / `GetMessageDebugBatch` to `IChatStorageRepository` (+ any DTO).
- `infrastructure/chatstorage` — migrations 44/45/46, the two methods, JSON field extraction, tests.
- `infrastructure/whatsapp` — `chatstorage_wrapper.go` delegation (mandatory: `AGENTS.md > ANTI-PATTERNS` forbids adding interface methods without updating both the wrapper and the concrete repository).

**Not affected:** `usecase/`, `ui/rest`, `ui/mcp`, `views/`, `infrastructure/chatwoot`. Confirmed by the owner at intake (open question 3): this ticket is storage-layer only; wiring a producer is tickets 04/06/07/14.

**Implementations that must stay in sync:** exactly two — `SQLiteRepository` and `deviceChatStorage`. 35 files reference `IChatStorageRepository`, but the test doubles (`webhook_forward_test.go:16-17`, `:263-264`) **embed** the interface, so adding methods will not break them.

## Available validation commands  <!-- RS-3 -->

Listed, **not run** at this stage. Canonical set:
`project-config.yaml > validation_checks`.

| Check | Command |
|-------|---------|
| go-build | `go build -C src ./...` |
| go-vet | `go vet -C src ./...` |
| go-test | `go test -C src ./...` |

Applicable profile: `go-source` (all three checks, depth `all-ac`).

Test precedent for this package: `newTestSQLiteRepository(t)`
(`sqlite_repository_test.go:15-29`) opens a real SQLite DB in `t.TempDir()` and
runs `InitializeSchema()` — new migrations are exercised automatically by every
existing test in the package.

## Risks & unknowns  <!-- RS-4 -->

- **Linking to `messages` changes the primary key the ACs state (highest-impact
  finding after the owner's answers).** The owner confirmed the debug row is
  linked to `messages` (Q5). The precedent is migration 19 (`message_edits`,
  lines 2448-2460): `FOREIGN KEY (original_message_id, chat_jid, device_id)
  REFERENCES messages(id, chat_jid, device_id) ON DELETE CASCADE`, and foreign
  keys are on by default (`settings.go:77`, `ChatStorageEnableForeignKeys =
  true`). Because the `messages` primary key is `(id, chat_jid, device_id)`, a
  real FK **requires `chat_jid` in `message_debug`** — but ClickUp's AC "Scope &
  Tenant Safety" 1 specifies the primary key `(device_id, message_id)`
  *without* `chat_jid`, and the ticket's own rationale argues the debug row must
  not depend on the message row. Three consequences `/spec` must settle:
  (i) the table needs a `chat_jid` column the AC table does not list;
  (ii) `SetMessageDebug(ctx, deviceID, messageID, metadataJSON)` as specified
  carries no `chat_jid`, so either the signature grows a parameter or the
  repository looks the chat up — and the lookup fails when the message row does
  not exist yet; (iii) **write-ordering race:** the sent-message row is written
  in a detached goroutine (`send.go:74-78`), so a debug write can arrive before
  its parent row and an enforced FK would then *reject* it, contradicting AC
  "Audit & Logging" 1 ("never aborts the caller"). A softer link (same key
  columns, cleanup handled in the existing delete paths, no enforced FK) avoids
  the race; an enforced FK gives automatic `ON DELETE CASCADE`.
  **DECIDED (owner, 2026-08-15): the softer link with explicit cleanup.** The
  debug row references the message by its key columns but declares **no**
  `FOREIGN KEY` constraint, so a debug write never fails because its parent row
  has not landed yet (preserving AC "Audit & Logging" 1 against the
  `send.go:74-78` race). In exchange, `/spec` must state removal explicitly —
  `DeleteMessageByDevice`, `DeleteDeviceData`, `TruncateAllChats` — because
  nothing cascades automatically (the leftover-row hazard the chat-storage
  `AGENTS.md` ANTI-PATTERNS warns about).
- **Returning the promoted columns widens the contract (Q2).** The owner's
  answer — return *all* stored values — means the batch method returns a typed
  struct, so the DTO, the `SELECT` column list, and the AC wording all have to
  agree. AC "General Behavior" 3 as written ("carrying the raw JSON") is
  narrower than what was asked for.
- **The backend answer is resolved but the portability constraint stands.** The
  intake answered open question 1 with "PostgreSQL"; the owner has since
  clarified that PostgreSQL currently backs only the **session** store, and the
  chat store is **SQLite-only today** — verified: `initChatStorage()`
  (`root.go:625`) opens `sqlite.DriverName` with no `postgres:` branch, and
  `ChatStorageURI` defaults to `file:storages/chatstorage.db`. Moving the
  chat/message store to PostgreSQL is the separate ticket this one *blocks*
  (14). The constraint that follows: migrations 44–46 and both methods must be
  written in **portable** SQL so they survive that switch unchanged — matching
  the existing header comment `// Compatible with SQLite, MySQL, and
  PostgreSQL` (line 2346) and the ACs' "SQLite variable limit" wording. No
  driver or config change is in scope here.
- **Dialect portability of the new DDL.** Existing migrations use
  `VARCHAR(255)`, `TEXT`, `BOOLEAN DEFAULT FALSE`, `TIMESTAMP DEFAULT
  CURRENT_TIMESTAMP` — all portable. Risky constructs to avoid: `INSERT OR
  REPLACE` (SQLite-only; PostgreSQL needs `ON CONFLICT … DO UPDATE`), SQLite's
  `JSON`/`JSONB` type names, and `AUTOINCREMENT`. AC "General Behavior" 1
  (insert-or-replace) is exactly where a SQLite-only construct is most tempting.
- **Placeholder style.** All existing SQL uses `?` (e.g. `runMigration` at
  line 2337, the batch query at line 660). PostgreSQL uses `$1`; a future driver
  switch is a repo-wide concern, not this ticket's — but the new SQL should not
  make it worse.
- **One statement per migration is enforced by the runner.** `runMigration`
  (line 2324-2343) does a single `tx.Exec(migration)`. This confirms AC
  "Validation & Constraints" 2: the table and each index must be separate
  entries (hence 44, 45, 46).
- **Byte-identical JSON round-trip (AC "Schema — raw payload" 1, "UI & API
  Consistency" 1).** Storing the payload in a `TEXT` column preserves bytes
  only if the repository stores the *received* string and never re-marshals it
  (Go's `encoding/json` reorders map keys and re-escapes). Extraction for the
  promoted columns must therefore parse a *copy* and never write back the parsed
  form. This is the subtlest correctness requirement in the ticket.
- **Zero-value extraction must never abort the write (AC "Validation &
  Constraints" 3).** With `intent`/`model`/`memory`/`api`/`tokens`/`langsmith`
  all `null` today, the extractor has to treat null / absent / wrong-type
  uniformly as the zero value, while still rejecting a payload that is not valid
  JSON at all (AC 5) — two behaviours that must not be collapsed into one check.
- **Chunking precedent already exists.** `loadMessageReactions`
  (lines 625-660) chunks IDs at 500 with `strings.Repeat`-style placeholder
  building. AC "Validation & Constraints" 8 asks for the same shape;
  the plan should reuse that pattern rather than invent one.
- **Migration numbering is confirmed but time-sensitive.** The list currently
  ends at **Migration 43** (line 2564), so 44/45/46 are indeed the next free
  numbers (intake open question 2 — confirmed). If another ticket lands a
  migration first, these numbers shift; `/plan` should re-check rather than
  assume.
- **Stale documentation.** Both `AGENTS.md:49` and
  `src/infrastructure/chatstorage/AGENTS.md:15` claim "currently 29 migrations";
  the actual count is 43. The repo map is out of date here — verified against
  the code, as required.

## Open questions  <!-- RS-5 -->

All five were answered by the owner on 2026-08-15 (recorded here; the resulting
acceptance criteria are `/spec`'s job).

- **Q1 — ANSWERED (owner).** PostgreSQL exists in this deployment and its URI is
  already present in the runtime `.env`, but **only for the whatsmeow session
  store** (the outcome of `cu-z8pmx9kcv5`). Chats and messages move in a
  **separate ticket**. → Reading (a) is confirmed: this ticket keeps the chat
  store on its current driver and writes **portable SQL** so migrations 44–46
  survive the later driver switch. No driver/config change is in scope here.
  (Note: the committed `src/.env.example:27` still shows the SQLite default —
  the PostgreSQL URI lives in the untracked runtime `.env`.)
- **Q2 — ANSWERED (owner).** `GetMessageDebugBatch` must return **all stored
  values** for each message — the raw `metadata_json` **and** the promoted
  columns — not raw JSON alone. → A typed struct (e.g. `MessageDebug` in
  `domains/chatstorage`) keyed by message id, which is a superset of AC "General
  Behavior" 3 ("carrying the raw JSON"); `/spec` must state the superset
  explicitly so the AC and the contract do not disagree.
- **Q3 — ANSWERED (owner: explicit cleanup).** Nothing cascades: the link is
  soft (no `FOREIGN KEY`), so every existing delete path must remove debug rows
  itself — `DeleteMessageByDevice`, `DeleteDeviceData`, `TruncateAllChats`.
  `/spec` states this as its own acceptance criterion; it is precisely the
  leftover-row bug the chat-storage `AGENTS.md` ANTI-PATTERNS warns about.
- **Q4 — ANSWERED (owner).** Yes — the table carries `created_at` **and**
  `updated_at`, matching every other table in the migration list.
- **Q5 — ANSWERED (owner).** Yes — the row is linked to the `messages` table,
  but as a **soft link with explicit cleanup**: the debug row carries the
  message's key columns (which adds `chat_jid`, a column the ClickUp AC table
  does not list) and declares **no** `FOREIGN KEY`, so the async write ordering
  in `send.go:74-78` can never make a debug write fail. See Risks below.

## Notes

- This stage is **read-only**: no source file, config, or deployment runtime file
  was modified (GU-1).
- No validation or test command was executed.
