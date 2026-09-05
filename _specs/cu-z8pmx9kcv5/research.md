---
ticket: cu-z8pmx9kcv5
stage: research
mode: standard
status: complete
owner: ai_agent
updated: 2026-08-13
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv5"
  github: ""
---

# Research — 02 · Migrate the WhatsApp session store to PostgreSQL

> Read-only investigation. Start from `AGENTS.md` (repo map) and the nested
> `AGENTS.md` files under `src/`, then verify every claim against the actual
> code — never quote the map without confirming it.

**Scope reminder (from `intake.md`, owner decision 2026-08-13):** the deliverable
is an **operator-side environment change only** — `DB_URI=postgres://…` is set in
the runtime environment. No tracked repository file is in scope, and **no
deployment runtime file** is in scope. Research below therefore reports what the
existing code already does, not what should be built.

## Relevant directories  <!-- RS-1 -->

| Path | Why it matters |
|------|----------------|
| `src/infrastructure/whatsapp/` | Owns the whatsmeow session store. `database.go` is the only place `DB_URI` is turned into a store container. |
| `src/cmd/` | `root.go` binds `DB_URI` from flag/env into `config.DBURI`, registers the PostgreSQL driver, and wires startup order in `initApp()`. |
| `src/config/` | `settings.go` holds the mutable package globals `DBURI`, `DBKeysURI`, `ChatStorageURI` and their defaults. |
| `src/pkg/sqlite/` | `DriverName` + `FormatChatStorageURI` — SQLite-only URI shaping, applied **only** on the `file:` branch. |
| `src/infrastructure/chatstorage/` | The **separate** chat/message store (ticket 14). Read here only to confirm it is untouched by `DB_URI`. |
| `src/usecase/`, `src/ui/rest/` | QR/pair-code login flows and `GET /devices/{id}/status` — the observable surface used by the ticket's test cases. |
| `docker/`, repo-root `docker-compose.yml` | **Read only, to understand deployment.** Deployment runtime files — out of scope, never modified (GU-2). |

## Relevant config files  <!-- RS-2 -->

| File | Relevance |
|------|-----------|
| `src/config/settings.go:41-42` | `DBURI = "file:storages/whatsapp.db"`, `DBKeysURI = ""` — the defaults the ticket overrides. |
| `src/config/settings.go:76` | `ChatStorageURI = "file:storages/chatstorage.db"` — the chat store; must stay untouched (AC Scope 1). |
| `src/cmd/root.go:138-143` | Env binding: `viper.GetString("db_uri")` → `config.DBURI`; `db_keys_uri` → `config.DBKeysURI`. This is the hook the ticket uses. |
| `src/cmd/root.go:389-398` | The `--db-uri` / `--db-keys-uri` Cobra flags. Flags outrank env (`AGENTS.md > CONVENTIONS`), so a stray flag would override the operator's env. |
| `src/cmd/root.go:29` | `_ "github.com/lib/pq"` — the blank import that registers the `"postgres"` driver. Without it the `postgres:` branch would fail at runtime. |
| `src/go.mod:15` | `github.com/lib/pq v1.12.3` — the PostgreSQL driver is already a direct dependency. |
| `src/.env.example:26-28` | Documented default `DB_URI=file:storages/whatsapp.db?_foreign_keys=on`, `DB_KEYS_URI=`. See risk R-2 about the query suffix. |
| `readme.md:235-236` | Operator-facing docs; already documents `DB_URI=postgres://user:pass@host/db` and warns about `DB_KEYS_URI`. |
| `docker-compose.yml`, `docker/golang.Dockerfile`, `docker/entrypoint.sh` | Deployment runtime files — **read only to understand them; never modified** (GU-2, CLAUDE.md hard-stop). |

<Deployment runtime files are read here only to understand them — never modified.>

## Possibly affected services / layers  <!-- RS-3 -->

Only the WhatsApp session-store layer is touched; no `domains/` → `usecase/` →
`ui/` contract changes:

- **`infrastructure/whatsapp` (primary).** `InitWaDB` → `initDatabase`
  (`database.go:16-42`) is the entire decision point. Verified against the code:

  ```go
  if strings.HasPrefix(DBURI, "file:") {          // database.go:34
      DBURI = sqlite.FormatChatStorageURI(DBURI, true, true)
      return sqlstore.New(ctx, sqlite.DriverName, DBURI, dbLog)
  } else if strings.HasPrefix(DBURI, "postgres:") { // database.go:37
      return sqlstore.New(ctx, "postgres", DBURI, dbLog)
  }
  return nil, fmt.Errorf("unknown database type: %s. Currently only sqlite3(file:) and postgres are supported", DBURI) // database.go:41
  ```

  The `postgres:` branch and the supported-schemes error message the ticket
  relies on both exist as described. whatsmeow's `sqlstore.New` creates the
  `whatsmeow_*` tables itself, so no migration code is involved.
- **`cmd` (wiring only).** `initApp()` (`root.go:647-694`) calls
  `whatsapp.InitWaDB(ctx, config.DBURI)` at `root.go:670`, then optionally a
  second container for `DBKeysURI` at `root.go:672-674`.
- **`infrastructure/chatstorage` (must stay unaffected).** `initChatStorage()`
  (`root.go:622-645`) opens `config.ChatStorageURI` with `sqlite.DriverName`
  **hard-coded** — it has no PostgreSQL branch at all. AC Scope 1 is therefore
  structurally safe: `DB_URI` cannot reach the chat store, and `CHAT_STORAGE_URI`
  cannot be pointed at PostgreSQL today (that is ticket 14).
- **`device_manager`.** `LoadExistingDevices` (`root.go:679-682`) enumerates
  devices from the whatsmeow container. An empty PostgreSQL store yields zero
  devices, which is exactly the ticket's "every device is re-paired by QR".
- **`ui/rest`.** `GET /devices/{id}/status` (`ui/rest/device.go:189-199`) returns
  `is_connected` / `is_logged_in` — the observable used by the happy-path test.
- **Not affected:** `infrastructure/chatwoot` (its `CHATWOOT_IMPORT_DB_URI` is an
  unrelated, separate DSN), `views/`, `ui/mcp`.

## Available validation commands  <!-- RS-3 -->

Listed, **not run** at this stage. Canonical set:
`project-config.yaml > validation_checks`.

| Check | Command |
|-------|---------|
| go-build | `go build -C src ./...` |
| go-vet | `go vet -C src ./...` |
| go-test | `go test -C src ./...` |

The `go-source` profile (`validation_profiles > go-source` = go-build + go-vet +
go-test) exists for Go source changes. Under the agreed operator-env-only scope
this ticket produces **no Go diff**, so `/plan` must decide whether to name that
profile at all (VP-5: naming no profile is legal and keeps `/verify` on its
pre-profile path). Verification will instead rest on runtime observation —
startup logs plus `GET /devices/{id}/status` — which is not a repo command.

## Risks & unknowns  <!-- RS-4 -->

- **R-1 (high) — `postgresql://` is rejected *and* leaks the password.** The
  guard is `strings.HasPrefix(DBURI, "postgres:")` (`database.go:37`), so the
  equally common `postgresql://…` form does **not** match and falls through to
  `database.go:41`, which formats **the full URI into the error string** — including
  the password — and that string is then logged by `log.Errorf` and put in the
  panic (`database.go:22-23`). This collides with the ticket's own criteria:
  "Authorization failure … the error message does not print the password" and
  "unsupported scheme aborts with a clear error". The repo's own Chatwoot docs
  use the `postgresql://` spelling (`docs/chatwoot.md:91`), so an operator may
  reasonably reach for it. **Mitigation within scope:** mandate the exact
  `postgres://` spelling. Fixing the leak itself is a Go change → out of scope.
- **R-2 (medium) — the `?_foreign_keys=on` suffix must not be carried over.** The
  documented default is `DB_URI=file:storages/whatsapp.db?_foreign_keys=on`
  (`.env.example:27`). That parameter is SQLite-only and is applied only inside
  the `file:` branch via `sqlite.FormatChatStorageURI` (`database.go:35`); the
  `postgres:` branch passes the DSN to lib/pq verbatim, which rejects unknown
  parameters. A copy-paste edit of the existing line will fail at startup.
- **R-3 (medium) — `DB_KEYS_URI` split-brain.** If `DB_URI` moves to PostgreSQL
  while `DB_KEYS_URI` keeps a `file:` value, sessions live in PostgreSQL and the
  key cache stays on local disk (`root.go:670-674`), defeating the ticket's goal;
  `AGENTS.md:135` already warns that privacy tokens must survive long-lived
  sessions. `DB_KEYS_URI` must be left empty (it then defaults to the main store)
  or pointed at the same PostgreSQL instance.
- **R-4 (medium) — "no partially initialised store is left behind" needs a precise
  reading.** `initApp()` initialises **chat storage first** (`root.go:661-668`,
  including `InitializeSchema()`), and only then the whatsmeow store
  (`root.go:670`). A bad `DB_URI` therefore aborts *after* the SQLite chat-storage
  file has been created and migrated. No partial *whatsmeow* store exists (the
  panic happens before any container is returned), but the statement is not true
  of the process as a whole. `/spec` must word this AC against the whatsmeow store
  specifically.
- **R-5 (medium) — the two Audit & Logging criteria are not met by current code.**
  This is the answer to intake open question 4, and it is the one place the
  ticket's ACs exceed the agreed no-code scope:
  - *"Startup logs record which database backend is active"* — nothing logs it.
    `initDatabase` emits no backend line; `DeviceManager.StoreInfo()`
    (`device_manager.go:947-953`), commented "returns configured store URIs for
    observability", is **defined but never called** anywhere in `src/` (verified
    by grep — only its definition matches).
  - *"Each successful pairing is logged with its device id"* — `handlePairSuccess`
    (`event_handler.go:168-175`) pushes a `LOGIN_SUCCESS` **websocket** broadcast
    carrying `evt.ID`, but writes no logrus entry. The QR flow logs only errors
    and warnings as `[LOGIN][<deviceID>]` (`usecase/app.go:63-103`), and the
    pair-code path logs `"Successfully paired phone with code: %s"`
    (`usecase/app.go:163`) — the code, not the device id.
  - whatsmeow's own `waLog` loggers ("Main", "Database", `database.go:17-18`) may
    emit backend/pairing lines of their own at INFO; that is **unverified** here
    because research does not run the binary.
- **R-6 (low) — destructive cutover, accepted.** The PostgreSQL store starts
  empty, so every existing pairing is lost and must be re-scanned. The owner
  accepted this at intake (no migration window, no data migration).
- **R-7 (low) — flag precedence.** Cobra flags outrank env
  (`AGENTS.md > CONVENTIONS`); a lingering `--db-uri` in a service unit or compose
  command would silently override the operator's `DB_URI`.
- **R-8 (low) — verification is runtime-only.** With no repository diff, none of
  the three validation checks meaningfully exercises this change; evidence must
  come from a live start against PostgreSQL. This makes the environment
  prerequisite (below) a real dependency for `/verify`, not a formality.

## Open questions  <!-- RS-5 -->

- **Q-1 (blocking for `/verify`, not for `/spec`).** Which PostgreSQL instance
  will be used for verification, and who provisions the role/schema that owns the
  `whatsmeow_*` tables (AC "Scope & Tenant Safety" 2)? Under the operator-env
  scope this sits outside the repository, but `/verify` cannot produce evidence
  without it.
- **Q-2 (for `/spec`).** How should the two Audit & Logging criteria (R-5) be
  handled? Three options: (a) reword them against what whatsmeow's `waLog`
  already emits, once observed at runtime; (b) declare them **out of scope** here
  and raise a separate ticket for the Go logging change; (c) widen this ticket to
  include a Go change — which would contradict both the source task ("no Go code
  is written") and the owner's operator-env-only decision.
- **Q-3 (for `/spec`).** Should AC "Scope & Tenant Safety" 2 (the role owning only
  the `whatsmeow_*` schema) be an acceptance criterion of this ticket at all,
  given it describes database provisioning the service neither performs nor can
  observe? If kept, it needs an observable test (e.g. an inspection of granted
  privileges), not a code-level check.
- **Q-4 (for `/spec`).** Does R-1 (`postgresql://` rejected, password echoed into
  the error) get recorded as a documented operator constraint here, or raised as
  its own defect ticket? It is a real information-leak path, but fixing it is a Go
  change and therefore outside this ticket's agreed scope.

## Notes

- This stage is **read-only**: no source file, config, or deployment runtime file
  was modified (GU-1).
- No validation or test command was executed.
