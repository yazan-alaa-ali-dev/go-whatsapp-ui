---
ticket: z8pmx9kzc7
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-08-25
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzc7"
  github: ""
---

# Plan — 16 · Add the account layer above devices

> **Revision 2.** The advisory panel (senior / security / performance — the three
> lenses `/review` dispatches) reviewed revision 1 against the code before any
> line was written. 25 findings were adopted, 4 declined and 1 corrected; every
> one is answered in **Panel response** at the end of this file.
>
> Revision 1's `config.MetaTokenRefPrefix` global, its `--meta-token-ref-prefix`
> CLI flag, its per-handler auth guard, its `ResolveMetaTokenRef(ref string)`
> signature and its `MetaTokenRef` field on the read path were **removed** as a
> direct result. `docs/openapi.yaml`, a startup-validated prefix, an
> account-scoped resolver, an audit log line, an ordered `ListAccounts`, a bounded
> order list, ozzo-based request validators and a re-land note were **added**.

## Approach

The ticket is three layers stacked, and the risk is concentrated in the bottom one.

1. **Schema.** Eleven append-only migration statements. The whole batch runs in
   **one transaction** on PostgreSQL (`runMigrationsAtomically`,
   `sqlite_repository.go:3039`), so one unportable statement means the server does
   not boot — not "a migration failed". Every statement is therefore chosen from
   forms this list already uses successfully on both engines.

2. **Visibility.** New columns are invisible until `DeviceRecord` and the explicit
   `SELECT` lists carry them. This is a verification item, not a detail: a
   migration that lands without it looks like it worked and reads back zero values.

3. **API.** A thin `domains/account` + account usecase + `ui/rest/account.go`
   stack over new repository methods. Nothing on a send, receive, or webhook path
   is touched, so "no behaviour change" is structural rather than argued: **no
   runtime path reads any new column in this ticket.**

Four decisions the ticket leaves open are closed here.

**The protection decision (AC-23).** The repo answers this question once already,
and the answer is *reject the request*, not *refuse to mount*: `ui/rest/agent.go:53`
refuses `POST /agent/debug/toggle` when `config.AppBasicAuthCredential` is empty —
"the endpoint declines to exist until there is a credential to authenticate an
admin with". Refusing to mount would make the surface change shape with
configuration (404 vs 503), which is harder to diagnose and harder to test.

Where revision 1 was wrong is *how many times* that check is written. Five copies
fail open on the sixth route, and ticket 20 adds a sixth on this exact prefix. So
the guard is **one middleware mounted once** on a path-scoped group:

```go
accountGroup := apiGroup.Group("/accounts", middleware.RequireBasicAuthConfigured())
```

A **non-empty** prefix is path-scoped, so this does not repeat the `Group("", …)`
hazard that `cmd/rest.go:146-152` documents at length — and a test pins exactly
that: a route registered *after* the account group must not inherit the guard.

**Accounts are a grouping, not a tenancy boundary.** Basic auth here is a flat
`user:secret` list (`cmd/rest.go:103-113`) with no per-credential scope, so any
authenticated caller can list every account, attach any device and block any
device. The `WHERE account_id = ?` clauses prevent *accidents*, not *authorization*.
This is stated as **NFR-5** in `spec.md` rather than left for tickets 17–20 to
misread as isolation, and every mutating call writes an audit line naming the
actor (`basicauth.UsernameFromContext`, the `agent.go:83` precedent) — that
username is the only actor identity the system has.

**The token reference has exactly one door.** `meta_token_ref` is never selected
on any read path in this ticket. The only statement that reads the column lives
inside `ResolveAccountMetaToken(accountID)`, which selects, re-validates against
the allowlist, and calls `os.LookupEnv` — all inside one function. A caller cannot
hand it a reference it obtained elsewhere, so AC-18's "enforced on read and
resolve" holds by construction rather than by discipline. The allowlist prefix is
itself validated (a prefix of `"D"` would reach `DB_URI`; a prefix of `"A"` would
reach `APP_BASIC_AUTH`).

**Where the usecase lives.** The ticket writes `usecase/account`. Every existing
usecase in this repo is a file in the flat `package usecase` (`usecase/device.go`,
`usecase/agent.go`, …), and a subdirectory package would be the only one of its
kind. The plan follows the repo idiom — `src/usecase/account.go` — because AC-21's
actual requirement is *the handler does not touch `IChatStorageRepository`*, and
that holds either way. Recorded as a deliberate deviation.

## Steps

### 1 — Migrations 51–61 (`sqlite_repository.go > getMigrations`)

One statement per migration (pinned by the existing tests), appended in this order:

| # | Statement | Note |
|---|---|---|
| 51 | `CREATE TABLE IF NOT EXISTS accounts (account_id VARCHAR(255) PRIMARY KEY, name VARCHAR(255) NOT NULL DEFAULT '', meta_token_ref VARCHAR(255) NOT NULL DEFAULT '', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)` | M-a. No `AUTOINCREMENT`, no `BLOB`, no `DEFAULT 1` — nothing `postgresDDL` rewrites and nothing PostgreSQL rejects. |
| 52 | `ALTER TABLE devices ADD COLUMN account_id VARCHAR(255) NOT NULL DEFAULT ''` | M-b |
| 53 | `ALTER TABLE devices ADD COLUMN transport VARCHAR(32) NOT NULL DEFAULT ''` | M-c |
| 54 | `ALTER TABLE devices ADD COLUMN priority INTEGER NOT NULL DEFAULT 100` | M-d, **lower = tried first** |
| 55 | `ALTER TABLE devices ADD COLUMN send_state VARCHAR(16) NOT NULL DEFAULT ''` | M-e |
| 56 | `ALTER TABLE devices ADD COLUMN meta_phone_number_id VARCHAR(64) NOT NULL DEFAULT ''` | M-f |
| 57 | `ALTER TABLE devices ADD COLUMN meta_display_phone VARCHAR(32) NOT NULL DEFAULT ''` | M-f |
| 58 | `ALTER TABLE devices ADD COLUMN meta_waba_id VARCHAR(255) NOT NULL DEFAULT ''` | M-f |
| 59 | `CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_meta_pni ON devices(meta_phone_number_id) WHERE meta_phone_number_id <> ''` | M-g. Same partial shape as migration 38, which already ships on both engines. |
| 60 | `CREATE INDEX IF NOT EXISTS idx_devices_jid ON devices(jid)` | M-h, **not** unique |
| 61 | `CREATE INDEX IF NOT EXISTS idx_devices_ad_jid ON devices(ad_jid)` | M-h, **not** unique |

M-f is three statements because the runner executes one statement per migration;
the ticket's letters are logical groupings, not list indices. Count 50 → **61**.

Load-bearing notes, each carried into the migration comments:

- **Cost.** `ADD COLUMN … NOT NULL DEFAULT <non-volatile literal>` is O(1)
  metadata on SQLite always, and on **PostgreSQL 11+** — the deployment target is
  `postgres:16`, the version ticket 14 verified against
  (`_specs/cu-z8pmx9kcvh/verify.md`, `docs/chat-storage-postgresql.md`). No table
  rewrite on either engine, so no `UPDATE` backfill is needed (AC-5) and the
  default is what existing rows read back.
- **Lock shape, not rewrite, is the real cost.** On PostgreSQL all eleven
  statements share one transaction, so `devices` is held under ACCESS EXCLUSIVE
  (the seven `ALTER`s) plus SHARE (the three `CREATE INDEX`es) until commit. On a
  table of tens of rows that is sub-second; during a rolling deploy an old
  instance blocks on `SaveDeviceRecord` for that window. `CONCURRENTLY` is
  impossible inside the batch transaction and unnecessary at this size — recorded
  so it is not re-litigated.
- **`idx_devices_meta_pni` is free**: the column is created empty at migration 56
  and nothing in this ticket ever writes it, so the index holds zero entries for
  the whole life of this ticket.
- **`idx_devices_jid` / `idx_devices_ad_jid` are not speculative.**
  `GetDeviceRecordByJID` runs `WHERE jid = ? OR ad_jid = ?` and is reached on the
  per-event path: `webhook_forward.go:101 → getWebhookConfigForDevice → :170`,
  and again from `agent_bridge.go:404`. Today that is two unindexed scans per
  forwarded event (`devices` carries only `idx_devices_created_at`, migration 12).
  The write side is `SaveDeviceRecord`'s narrow `UPDATE` on connect — orders of
  magnitude rarer than the read.
- **No unique index on `devices(jid)`** (AC-4). Rev 1 of the scope document
  proposed one; it fails on any deployment with two companion slots on one number,
  and on PostgreSQL it would roll back all eleven migrations and stop the boot.
- `ALTER TABLE … ADD COLUMN` has no `IF NOT EXISTS` spelling that works on both
  engines. That is fine and is how migrations 32–35 already work: the **version
  counter**, not `IF NOT EXISTS`, is what stops a migration re-running
  (`InitializeSchema:3013`).

`src/infrastructure/chatstorage/AGENTS.md:15` still claims "currently 29
migrations" — stale before this ticket and off by 32 after it. One line, fixed in
this step because this is the ticket that moves the number.

Both migration-count tests are updated in the same step:
`sqlite_repository_debug_test.go:581` (50 → 61) and
`sqlite_repository_transcript_test.go:271`, whose `migrations[48:]` becomes
`migrations[48:50]` so it keeps pinning ticket 07's two and stops silently widening.

### 2 — `DeviceRecord` and the SELECT lists

`domains/chatstorage/chatstorage.go` — seven fields, `GowaAccountID` first
(AC-8, CON-4):

```go
GowaAccountID     string `db:"account_id"`
Transport         string `db:"transport"`
Priority          int    `db:"priority"`
SendState         string `db:"send_state"`
MetaPhoneNumberID string `db:"meta_phone_number_id"`
MetaDisplayPhone  string `db:"meta_display_phone"`
MetaWABAID        string `db:"meta_waba_id"`
```

`sqlite_repository.go` — extend the explicit column list and the `Scan` of
**three** functions, not two: `ListDeviceRecords` (`:1468`), `GetDeviceRecordByJID`
(`:1518`) and `GetDeviceRecord` (`:1492`). The ticket names the first two; the
third has the identical defect and the identical fix, and leaving it half-blind
would be a trap for ticket 17. Columns are appended at the end of each list so the
existing `Scan` argument order is untouched. The columns are `NOT NULL`, so no
`COALESCE` wrapper is needed (unlike `ad_jid`, which is nullable `DEFAULT ''`).

This costs nothing measurable: no device query runs per message.
`ListDeviceRecords` has one production caller (`device_manager.go:499`, boot only),
and the two webhook readers (`:1610`, `:1667`) are `device_id` primary-key lookups
that are not widened.

`infrastructure/whatsapp/chatstorage_wrapper.go` — the wrapper implements
`IChatStorageRepository` by delegation, so it needs one delegating method per **new
repository method** (step 4). The device methods themselves need no change: they
pass `*DeviceRecord` through by pointer. Every test double in the tree **embeds**
the interface rather than implementing it method-by-method
(`webhook_route_test.go:15`, `chatwoot_test.go:41`, …), so adding methods breaks
no test.

### 3 — Regression test: reconnect must not wipe routing (AC-25)

`SaveDeviceRecord` updates only `display_name`, `jid`, `ad_jid`. That is why a
reconnect does not clear `account_id` — but it is implicit, and any later widening
of that `UPDATE` would silently zero the routing of every device on the next
`Connected` event. New test: write a device, set `account_id='acc_alpha'`,
`priority=20`, `send_state='blocked'` directly, call `SaveDeviceRecord` with a
changed display name, then assert the three values are unchanged and the display
name did change. A second assertion reads the row back through `ListDeviceRecords`
and `GetDeviceRecordByJID`, pinning AC-9 at the same time.

### 4 — Repository: the account operations

`domains/chatstorage/chatstorage.go` gains an `Account` row struct — **without**
`MetaTokenRef`:

```go
type Account struct {
    AccountID string    `db:"account_id"`
    Name      string    `db:"name"`
    CreatedAt time.Time `db:"created_at"`
    UpdatedAt time.Time `db:"updated_at"`
}
```

The reference has no field on the read path at all, so no read path can leak it.
`domains/chatstorage/interfaces.go` gains, under an `// Account operations` heading:

```go
CreateAccount(account *Account, metaTokenRef string) error
AccountExists(accountID string) (bool, error)
ListAccounts() ([]*Account, error)
GetAccountMetaTokenRef(accountID string) (string, error)
AttachDeviceToAccount(accountID, deviceID string) error
ListDeviceRecordsByAccount(accountID string) ([]*DeviceRecord, error)
SetAccountDeviceOrder(accountID string, deviceIDs []string) error
SetAccountDeviceSendState(accountID, deviceID, sendState string) error
```

Implementation notes:

- **Every method that takes an `accountID` rejects a blank one first**
  (`strings.TrimSpace(accountID) == ""` → error). This is the control, not the
  handler validator: `account_id = ''` is the value every legacy device carries,
  so a blank id reaching SQL would operate on the entire un-accounted fleet. The
  trimmed value is what is bound, so validation and execution see the same string.
- `CreateAccount` is an **insert**, not an upsert: creating an account that
  already exists is a client error, not a silent overwrite of another operator's
  `meta_token_ref`. It takes the reference as a separate argument precisely so the
  row struct never carries it.
- `ListAccounts` selects `account_id, name, created_at, updated_at` — the SELECT
  list does not mention `meta_token_ref` — `ORDER BY created_at ASC`, matching
  `ListDeviceRecords`. Without the ordering, PostgreSQL heap order shifts after any
  `UPDATE accounts` and `GET /accounts` answers differently between calls.
- `GetAccountMetaTokenRef` is the **only** statement in the tree that selects the
  column. It has exactly one caller (`ResolveAccountMetaToken`, step 5) and is
  documented as such.
- `AttachDeviceToAccount` issues the `UPDATE` **first** —
  `SET account_id = ?, updated_at = ? WHERE device_id = ? AND account_id IN ('', ?)`
  — and only when `RowsAffected() == 0` does the disambiguating `GetDeviceRecord`
  run, to tell "no such device" (404) from "already belongs to another account"
  (409). One query on the success path.
- `SetAccountDeviceOrder` runs in **one transaction**: re-read the account's device
  ids inside the transaction, reject unless the submitted list is exactly that set
  (no omission, no foreign device, no duplicate), then one `UPDATE … SET priority = ?`
  per device with `priority = (i+1) * 10`. **Lower = tried first.** The per-device
  loop is kept deliberately: `devices` holds one row per WhatsApp slot (tens at
  most), each update is a primary-key lookup, and a single `CASE`/`VALUES`
  statement saves little while risking the `?`-rebind portability ticket 14 just
  standardised. The list is bounded **before** the transaction opens (step 5) so an
  oversized body is never materialised while holding write locks.
- `SetAccountDeviceSendState` is
  `UPDATE devices SET send_state = ?, updated_at = ? WHERE device_id = ? AND account_id = ?`
  — the account scope is in the `WHERE` clause, so one operator cannot block
  another's device by guessing an id. Zero rows affected is a 404.
- `ListDeviceRecordsByAccount` and the order re-read both filter on `account_id`,
  which has **no index** (AC-6 defers `idx_devices_account_priority` to ticket 19).
  That is a sequential scan over a table of tens of rows on an operator-triggered
  path — accepted, and stated here rather than discovered later.
- Every statement keeps the repository's `?` placeholder form; the rebinding handle
  from ticket 14 converts it for PostgreSQL.

### 5 — `domains/account`, `validations/account_validation.go`, `usecase/account.go`

`domains/account/account.go` — the API-facing DTOs. The account DTO has **no
`meta_token_ref` field**, which is what makes AC-19 unbreakable by a careless
handler:

```go
type Account struct {
    AccountID string    `json:"account_id"`
    Name      string    `json:"name"`
    CreatedAt time.Time `json:"created_at"`
    UpdatedAt time.Time `json:"updated_at"`
}
type AccountDevice struct {
    DeviceID  string `json:"device_id"`
    JID       string `json:"jid,omitempty"`
    Transport string `json:"transport"`
    Priority  int    `json:"priority"`
    SendState string `json:"send_state"`
}
type CreateAccountRequest  struct { AccountID, Name, MetaTokenRef string }
type AttachDeviceRequest   struct { DeviceID string }
type SetDeviceOrderRequest struct { Order []string }
type SetSendStateRequest   struct { SendState string }
```

`domains/account/interfaces.go` — `IAccountUsecase` with the five operations plus
`ResolveMetaToken(ctx, accountID) (string, error)`.

`validations/account_validation.go` — one validator per request DTO, ozzo-based,
per the convention in `src/validations/AGENTS.md:22` (`ValidateStructWithContext`,
errors wrapped as `pkgError.ValidationError`), exactly as `agent_validation.go:21`
does it:

- `ValidateCreateAccount(ctx, *CreateAccountRequest)` — trims; `account_id`
  optional but, when present, `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; `name` bounded;
  `meta_token_ref` through `validateMetaTokenRef` below.
- `ValidateAttachDevice(ctx, *AttachDeviceRequest)` — `device_id` required, bounded.
- `ValidateSetDeviceOrder(ctx, *SetDeviceOrderRequest)` — non-empty, **at most 256
  entries**, no duplicates, no blank ids. The cap is enforced here, before
  `SetAccountDeviceOrder` opens its transaction.
- `ValidateSetSendState(ctx, *SetSendStateRequest)` — `send_state` through the
  closed list `{"", "blocked"}`; anything else is a 400 (AC-17).

Three shared closed-list helpers live in the same file and are the single home
AC-20 asks for:

- `IsValidSendState(string) bool` — `{"", "blocked"}`. Called by the request
  validator (write) **and** by the device-DTO mapper (read).
- `IsValidTransport(string) bool` — `{"", "whatsmeow", "meta_cloud"}`. Called by
  the device-DTO mapper: a row carrying a transport outside the closed list is a
  data-integrity signal, reported as `""` with one warning rather than echoed. That
  is the same read-side enforcement AC-18 demands for the token reference, applied
  to the other closed list, and it gives the helper a real caller now instead of
  ticket 20.
- `ValidatePriority(int) error` — `0 ≤ p ≤ 1_000_000`, called on each generated
  value in `SetDeviceOrder` before it is written, so the bound lives in one place
  for the ticket that later adds a direct setter.

`validateMetaTokenRef(ref string) error` is the security-critical one (AC-18):

- empty is allowed (an account with no Meta channel);
- otherwise the reference must match `^[A-Z][A-Z0-9_]{0,63}$` **and** carry the
  configured prefix, and be strictly longer than it.
- The rule is an **allowlist** ("this must look like an env-var name with our
  prefix"), not a denylist. A literal Meta token cannot match: real tokens contain
  lowercase and run far past 64 characters. RE2 with `[A-Z]` is ASCII-only, so
  there is no unicode bypass; a note records that `os.Getenv` is case-insensitive
  on Windows, so admitting lowercase in a future revision would silently collide
  `meta_token_x` with `META_TOKEN_X`.
- The prefix itself is `META_TOKEN_` by default and overridable by the
  `META_TOKEN_REF_PREFIX` environment variable, **resolved once and validated**:
  it must match `^[A-Z][A-Z0-9_]*_$` and be at least six characters, otherwise the
  default is used and the misconfiguration is logged at error level. Without that
  check a prefix of `D` reaches `DB_URI`, and `A` reaches `APP_BASIC_AUTH` — the
  allowlist would be widened by configuration into "read any environment variable".
  There is **no** `config` global and **no** CLI flag: a flag is a permanent public
  surface for a value nothing varies yet, and a flag value is visible in the
  process list.

`usecase/account.go` (`package usecase`) —
`NewAccountService(repo domainChatStorage.IChatStorageRepository) domainAccount.IAccountUsecase`:

- `CreateAccount` — validates, generates `account_id` with `fiberUtils.UUID()` when
  omitted (the `CreateDevice` pattern, AC-14), writes, returns the DTO without the
  token reference.
- `ListAccounts` — maps rows to DTOs. `account_id = ''` cannot appear: a row exists
  in `accounts` only if it was created through this path, and the empty id is
  rejected there (AC-10, AC-11).
- `AttachDevice` — `AccountExists` (not `GetAccount`: nothing on this path has any
  use for the account's columns), then attach. Never creates a device, never
  touches priority (AC-15).
- `SetDeviceOrder` / `SetDeviceSendState` — validate, confirm the account exists,
  then delegate.
- `ResolveMetaToken(ctx, accountID)` — `GetAccountMetaTokenRef` →
  `validateMetaTokenRef` → `os.LookupEnv`. `LookupEnv`, not `Getenv`: an unset name
  yields `""`, which ticket 20 would send as `Authorization: Bearer ` and see as an
  upstream 401 rather than a configuration error. A row written directly into the
  database with `meta_token_ref = 'DB_URI'` is refused **here**, which is AC-18's
  read/resolve half. The error names the reference, never the value, and the value
  is never logged (AC-19).
- Every mutating operation writes one audit line naming the actor and the target
  (`logrus.Infof("[ACCOUNTS] actor=%q …")`), the `agent.go:83` precedent. With a
  flat credential list that username is the only actor identity that exists, and
  attach is a claim on a shared fleet.

### 6 — `ui/rest/account.go` and route registration

`ui/rest/account.go` follows the repo's handler idiom — a struct holding the
usecase and an `InitRestX` constructor (`ui/rest/device.go:17`, `agent.go:31`) —
not the inline registrations the Chatwoot routes use (those exist because the
handler struct is shared with the pre-auth webhook; no equivalent reason here):

```go
func InitRestAccount(app fiber.Router, service domainAccount.IAccountUsecase) Account {
    rest := Account{Service: service}
    app.Post("/accounts", rest.AddAccount)
    app.Get("/accounts", rest.ListAccounts)
    app.Post("/accounts/:account_id/devices", rest.AttachDevice)
    app.Put("/accounts/:account_id/devices/order", rest.SetDeviceOrder)
    app.Patch("/accounts/:account_id/devices/:device_id", rest.SetDeviceSendState)
    return rest
}
```

In `cmd/rest.go`, immediately after `rest.InitRestDevice(apiGroup, deviceUsecase)`
(`:139`) — above `headerDeviceGroup` (`:163`) and below the basic-auth middleware
(`:102`), the same slot the debug-retention route already documents (AC-22):

```go
rest.InitRestAccount(apiGroup.Group("/accounts", middleware.RequireBasicAuthConfigured()), accountUsecase)
```

`middleware.RequireBasicAuthConfigured` returns **503 `ACCOUNTS_AUTH_REQUIRED`**
and logs one `logrus.Warn` (mirroring `agent.go:54`) when
`config.AppBasicAuthCredential` is empty. 503 matches `AgentDisabledError`; the log
line matters because `/health` also answers 503, so without it a misconfigured
deployment looks like an outage with no explanation.

Handlers bind the body, call the usecase, and render `utils.ResponseData`. They
map typed errors explicitly and **never panic with a wrapped driver error**:
`middleware.Recovery()` renders any non-`GenericError` as
`res.Message = fmt.Sprintf("%v", err)` (`recovery.go:21`), so a `pq` unique-violation
would become a 500 body carrying schema and value fragments. Mapping is
`pkgError.ValidationError` → 400, `ErrAccountNotFound`/`ErrDeviceNotFound` → 404,
`ErrDeviceAlreadyAttached` → 409, anything else → a generic 500 with the detail
logged, not returned — the shape `ui/rest/chatwoot_config.go:86-103` already uses.

`cmd/root.go` gains `accountUsecase domainAccount.IAccountUsecase` beside the
other usecase globals and `accountUsecase = usecase.NewAccountService(chatStorageRepo)`
in the same initialisation block.

`docs/openapi.yaml` documents all five routes and the 503 `ACCOUNTS_AUTH_REQUIRED`
response. Every REST endpoint in this repo is documented there, including the two
most recently added (`/agent/debug/toggle:2428`, `/agent/debug/retention/run:2571`);
shipping five undocumented ones would break that, and adding them in a later ticket
would be a scope violation there.

### 7 — Tests

| Test | Pins |
|---|---|
| `sqlite_repository_account_test.go` — migration shape | AC-1..AC-7, AC-26: count is 61; the eleven new statements match the expected substrings; **no** statement contains `UNIQUE INDEX … ON devices(jid)`, `idx_devices_account_priority`, or `bsuid`; none contains `UPDATE`; each holds one statement; none uses `AUTOINCREMENT`/`WITHOUT ROWID`/`PRAGMA`/`DEFAULT 1)`. |
| companion-slot survival | AC-4: two rows sharing a `jid` with different `ad_jid` survive `InitializeSchema`. `TestLoadFromRegistry_KeepsSiblingSlotsOnSameNumber` is re-run unchanged. |
| new-columns readback | AC-9: written values return through `ListDeviceRecords`, `GetDeviceRecord` and `GetDeviceRecordByJID`. |
| `SaveDeviceRecord` regression | AC-25. |
| account repository | AC-10/15/16/17: a blank `accountID` is refused by every method; attaching a device already in another account is refused; ordering with a missing, foreign or duplicate device is refused; `send_state` writes are account-scoped. |
| `validations/account_validation_test.go` | AC-18/AC-20: the closed lists; a literal-looking token is refused; a prefixless reference is refused; a widening prefix (`D`, `A`, empty) is rejected and falls back to the default. |
| `usecase/account_test.go` | AC-18/AC-19: `ResolveMetaToken` refuses a row whose stored reference lacks the prefix; an unset variable is an error, not `""`; no response DTO carries the reference. |
| `ui/rest/account_auth_test.go` | AC-23: with `config.AppBasicAuthCredential` empty, every route **enumerated from the registered route table** under `/accounts` answers 503 and performs no write — so ticket 20's sixth route is covered by construction. A second case asserts a route registered *after* the account group does **not** inherit the guard. |

Existing migration-count tests are updated, not replaced.

## Files to change

| File | Change |
|---|---|
| `src/infrastructure/chatstorage/sqlite_repository.go` | migrations 51–61; extend three device SELECT lists; add the account repository methods |
| `src/infrastructure/chatstorage/AGENTS.md` | the stale migration count (one line) |
| `src/domains/chatstorage/chatstorage.go` | seven `DeviceRecord` fields; `Account` struct |
| `src/domains/chatstorage/interfaces.go` | eight account repository methods |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | delegating methods for the above |
| `src/domains/account/account.go` | DTOs (new) |
| `src/domains/account/interfaces.go` | `IAccountUsecase` (new) |
| `src/usecase/account.go` | account usecase (new) |
| `src/validations/account_validation.go` | request validators, closed lists, token-reference allowlist (new) |
| `src/ui/rest/account.go` | `InitRestAccount` + five handlers (new) |
| `src/ui/rest/middleware/require_basic_auth.go` | the 503 guard, mounted once (new) |
| `src/cmd/rest.go` | mount the account group above `headerDeviceGroup` |
| `src/cmd/root.go` | `accountUsecase` global + construction |
| `docs/openapi.yaml` | the five endpoints + the 503 response |
| `src/infrastructure/chatstorage/sqlite_repository_debug_test.go` | migration count 50 → 61 |
| `src/infrastructure/chatstorage/sqlite_repository_transcript_test.go` | slice `migrations[48:50]` |
| `src/infrastructure/chatstorage/sqlite_repository_account_test.go` | new tests |
| `src/validations/account_validation_test.go` | new tests |
| `src/usecase/account_test.go` | new tests |
| `src/ui/rest/account_auth_test.go` | new test |

No file outside this list is touched. **No deployment runtime file is in it.**

## Validation strategy

- `go build -C src ./...`
- `go vet -C src ./...`
- `go test -C src -tags purego ./...` — the full suite. This host has no cgo
  toolchain, so `go-sqlite3` compiles to a stub; the `purego` tag selects
  `modernc.org/sqlite` (`src/pkg/sqlite/sqlite_purego.go`) and the SQLite suite
  runs for real. Baseline at the branch point: **one** pre-existing failure,
  `TestResolveDocumentMIME` — the same one ticket 14 recorded.
- The chat-storage suite **against real PostgreSQL 16**, the way ticket 14 was
  verified, because the single highest risk here is a migration SQLite accepts and
  PostgreSQL rejects:
  `CHAT_STORAGE_TEST_POSTGRES_URI=… go test -C src -tags purego ./infrastructure/chatstorage/...`
  This is also what activates `migrations_dialect_test.go`'s live-server case,
  which asserts the whole list applies, re-applies as a no-op, and leaves
  `schema_info` at `len(getMigrations())` — a self-tracking count assertion that
  needs no edit but must be in the run.
- A boot against a **copy of a pre-existing database** on both engines, asserting
  that existing devices read back `account_id = ''`, `transport = ''`,
  `priority = 100`, `send_state = ''`.

## Rollback

Revert the commit. The migration list is append-only with no down-migration, so
the eleven columns and indexes remain on a database that already migrated —
unread by the reverted code and default-valued, therefore inert.

One consequence must be stated rather than discovered: after the revert
`schema_info` still reads **61**. Because the version counter (not `IF NOT EXISTS`)
is what gates re-runs, **re-landing this ticket with any edit to statements 51–61
would be a silent no-op on any database that already migrated.** A re-land must
append at 62+ and never edit 51–61.

## Out of scope

Everything in `spec.md > Out of scope`. In particular: no runtime path reads any
new column in this ticket, `POST /…/meta-numbers` is not shipped, `POST /devices`
is not modified, and `idx_devices_account_priority` is not created.

## Panel response

30 findings across three lenses. **25 adopted, 4 declined, 1 corrected.**

### Senior lens

| # | Finding | Response |
|---|---|---|
| S1 | `docs/openapi.yaml` missing from Files to change; five endpoints would ship undocumented | **Adopted.** Added to Files to change; the five routes and the 503 response are documented there. Verified: `/agent/debug/toggle` at `:2428` and `/devices` at `:397` are both documented, so the convention is real. |
| S2 | Three zero-caller artefacts pulled forward from ticket 20: `ResolveMetaTokenRef`, `ValidateTransport`, `ValidatePriority` | **Adopted in part.** `ValidatePriority` and `IsValidTransport` now have real call sites in this ticket (generated-order bound, read-side DTO mapping), so neither is dead code. The resolver **stays**: AC-18 requires the allowlist "enforced on read and resolve", and the security lens (SEC4) independently showed why it must exist *now* and own the SELECT — shipping the guard with the resolver is what stops ticket 20 writing an unguarded one. Its signature changed to the account-scoped form. |
| S3 | New config global + env var + CLI flag for a value nothing varies | **Adopted.** `config.MetaTokenRefPrefix` and `--meta-token-ref-prefix` removed; the prefix is a package default in `validations/account_validation.go`, overridable by `META_TOKEN_REF_PREFIX` only. `config/settings.go` left this ticket entirely. The env override is kept because AC-18 says "the **configured** prefix", and SEC3 is satisfied by validating it. |
| S4 | Rollback incomplete: `schema_info` still 61 after revert; re-landing with edits is a silent no-op | **Adopted.** Stated explicitly in **Rollback**. |
| S5 | Route snippet used package-level handlers, not the repo's `InitRestX` + struct idiom | **Adopted.** `InitRestAccount(app, service) Account` in step 6. |
| S6 | Six standalone field validators diverge from `validations/AGENTS.md:22` (ozzo + `ValidateStructWithContext`) | **Adopted.** One ozzo validator per request DTO; the closed-list helpers remain as shared predicates the validators call. |
| S7 | `GetAccount` loads `MetaTokenRef` on the attach path, which has no use for it | **Adopted.** `AccountExists(accountID) (bool, error)` replaces it, and `MetaTokenRef` is off the row struct entirely. |
| S8 | `priority` direction undefined; default 100 collides with generated `(i+1)*10` | **Adopted in part.** Direction is now stated — **lower = tried first** — on migration 54 and on `SetAccountDeviceOrder`; that was the load-bearing half. The suggested "attach assigns `max(priority)+10`" is **declined**: AC-15 says attach "never sets priority". The residual collision is documented instead: a device attached after an ordering keeps 100 and the operator re-runs `PUT …/order` (which requires the complete list anyway, AC-16). |
| S9 | "One guard, one test" contradicted "a guard at the top of every handler"; beware the `Group("", …)` hazard | **Adopted.** One middleware on `apiGroup.Group("/accounts", …)` — non-empty prefix, so path-scoped — plus a test asserting a later-registered route does not inherit it. |
| S10 | `migrations_dialect_test.go` unnamed in the validation strategy | **Adopted.** Named, with what its live-server case actually asserts. |
| S11 | `infrastructure/chatstorage/AGENTS.md:15` says "currently 29 migrations", already stale | **Adopted.** Added to Files to change and fixed — this is the ticket that moves the number. |
| S12 | AC-23 covers only the unconfigured case; no per-account authorization exists | **Adopted**, and merged with SEC2 into **NFR-5** in `spec.md`. |

### Security lens

| # | Finding | Response |
|---|---|---|
| SEC1 | `account_id` guarded only in the handler; a blank id reaches SQL and operates on the whole `''` fleet | **Adopted.** Every repository method that takes an `accountID` rejects a blank one first, and binds the trimmed value. The account-exists check runs on all three device endpoints. |
| SEC2 | The account layer looks like a tenancy boundary and is not one; tickets 17–20 will read the user story as isolation | **Adopted.** **NFR-5** in `spec.md` states it is an organizational grouping within one trust domain, and every mutating call writes an audit line naming `basicauth.UsernameFromContext`. |
| SEC3 | The allowlist prefix is itself unvalidated and operator-configurable — `D` reaches `DB_URI`, `A` reaches `APP_BASIC_AUTH` | **Adopted.** The prefix is validated once (`^[A-Z][A-Z0-9_]*_$`, ≥ 6 chars) or the default is used and the misconfiguration logged; the reference must be strictly longer than the prefix; the CLI flag is gone. The "enumerate `os.Environ()` at boot into a set" variant is **declined**: it freezes the environment at boot, which breaks a deployment that sets a variable later, and a validated prefix plus a validated reference already closes the same hole. |
| SEC4 | `ResolveMetaTokenRef(ref string)` can be handed any string, and `GetAccount` selects the column with no validation | **Adopted.** `ResolveAccountMetaToken(accountID)` does SELECT → validate → `LookupEnv` inside one function, `GetAccountMetaTokenRef` is its only source and its only caller, and no other read path mentions the column. |
| SEC5 | `os.Getenv` on an unset name yields `""`, not an error | **Adopted.** `os.LookupEnv`, typed error naming the reference only. |
| SEC6 | The 503 guard copy-pasted into five handlers fails open on ticket 20's sixth route | **Adopted.** Mounted once on the path-scoped group; the auth test enumerates the registered routes instead of listing five. |
| SEC7 | Panicking with a driver error leaks schema and values through `Recovery()` | **Adopted.** Typed errors, explicit mapping, no `PanicIfNeeded` on repository errors. |
| SEC8 | The 503 refusal should log — `/health` also answers 503, so it looks like an outage | **Adopted.** One `logrus.Warn` in the guard. |
| SEC9 | Don't relax the ref regex later: `os.Getenv` is case-insensitive on Windows | **Adopted** as a comment on the regex. |
| SEC10 | `account_id IN ('', ?)` is a land-grab primitive; no detach endpoint ships | **Adopted in part.** Attach is audit-logged. The "pass the expected current account" parameter is **declined**: AC-15 defines attach as `{ device_id }` only, and a detach endpoint is explicitly out of scope (§07 of the design document cut it). |
| SEC11 | Deployment runtime, blast radius and reversibility check out | Noted. |

### Performance lens

| # | Finding | Response |
|---|---|---|
| P1 | `idx_devices_jid`/`idx_devices_ad_jid` serve a query with **zero production callers**; delete the rollback claim | **Corrected.** The premise is wrong. `GetDeviceRecordByJID` is reached on the per-event path — `webhook_forward.go:101 → getWebhookConfigForDevice → :170` and `agent_bridge.go:404` — so today every forwarded event costs two unindexed scans of `devices`. The grep missed it because the call site is the indirection `getDeviceRecordForTest`. The indexes and the rollback note stand, with the call chain now written into the migration comment. |
| P2 | The index set is inverted: `WHERE account_id = ?` has no index | **Declined**, with the cost stated instead — the reviewer's own alternative. AC-1 fixes the migration set at M-a…M-h and AC-26 pins the resulting count; a twelfth migration would contradict the criterion it is meant to serve. The scan is over tens of rows on an operator-triggered path. Ticket 19 owns the index. |
| P3 | `ValidateDeviceOrder`'s length bound left unnumbered; an oversized body is rejected *inside* the transaction | **Adopted.** Cap of 256, enforced in the request validator before the transaction opens. |
| P4 | `AttachDeviceToAccount` pre-reads on every call just to split 404 from 409 | **Adopted.** `UPDATE` first; the disambiguating read runs only when `RowsAffected() == 0`. |
| P5 | `ListAccounts` has no `ORDER BY`; PostgreSQL heap order shifts after an `UPDATE` | **Adopted.** `ORDER BY created_at ASC`, matching `ListDeviceRecords`. |
| P6 | Migration-cost claim correct, but "PostgreSQL 11+" left as prose | **Adopted.** The verified target — `postgres:16` — is named in step 1 and in the validation strategy. |
| P7 | The real cost is lock shape: ACCESS EXCLUSIVE + SHARE on `devices` for the whole batch transaction | **Adopted** as a migration note, with the reason `CONCURRENTLY` is neither possible nor needed. |
| P8 | The partial unique index is free on an empty column | Noted; written into the migration comment. |
| P9 | Keep the per-device `UPDATE` loop | **Adopted**, with the reasoning recorded so it is not re-litigated. |
| P10 | Widening the three SELECT lists costs nothing measurable | Noted; written into step 2. |
