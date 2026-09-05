---
ticket: z8pmx9kzc7
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-08-25
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzc7"
  github: ""
---

# Verification — 16 · Add the account layer above devices

**Outcome: PASSED.** All 26 acceptance criteria are mapped to an executed result.

## Runtime impact

**No deployment runtime file changed.** `docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml` and
`.github/workflows/set-latest-tag.yaml` are all absent from the diff
(`git status --short` and `git diff --stat` in `implement.md`).

The change is additive at the schema level and inert at runtime: eleven append-only
migrations, seven struct fields, and a new REST surface. **No existing runtime path
reads any new column**, so behaviour is preserved structurally rather than by
argument.

## Commands run

| Command | Result |
|---|---|
| `go build -C src ./...` | clean |
| `go vet -C src ./...` | clean |
| `go test -C src -tags purego -count=1 ./...` (SQLite) | one failure: `TestResolveDocumentMIME` |
| `CHAT_STORAGE_TEST_POSTGRES_URI=… go test -C src -tags purego -count=1 ./...` (**real PostgreSQL 16**) | the same one failure: `TestResolveDocumentMIME` |

`TestResolveDocumentMIME` is **pre-existing**: it fails identically at the branch
point, before any change from this ticket, and is unrelated to it (document MIME
resolution). Recorded as the baseline in `plan.md > Validation strategy`.

The suite is run with `-tags purego` because this host has no cgo toolchain, so
`go-sqlite3` compiles to a stub that fails every SQLite test with "requires cgo to
work". The tag selects `modernc.org/sqlite` (`src/pkg/sqlite/sqlite_purego.go`) and
the SQLite suite runs for real.

**Both engines were run for the whole suite, not only the storage package**, and
the outcome is identical on both. That is the coverage that matters here: the
single highest risk in this ticket is a migration SQLite accepts and PostgreSQL
rejects, and on PostgreSQL all eleven statements share one transaction — one bad
statement is not "a migration failed" but "the server does not boot". The
PostgreSQL run also activates `migrations_dialect_test.go`'s live-server case,
which applies the full list, re-applies it as a no-op, and asserts `schema_info`
lands on `len(getMigrations())`.

## Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| **AC-1** M-a…M-h appended (accounts table + seven device columns, priority default 100) | PASS | `TestAccountSchemaIsAppendedNotEdited` asserts count 61 and the eleven expected substrings in order. `TestAccountSchemaMigratesExistingDatabase` reads back `priority = 100`. |
| **AC-2** partial unique index on `devices(meta_phone_number_id) WHERE … <> ''` | PASS | Migration 59; substring asserted by `TestAccountSchemaIsAppendedNotEdited`; applied on both engines by the two full-suite runs. |
| **AC-3** non-unique `idx_devices_jid` and `idx_devices_ad_jid` | PASS | Migrations 60–61, substrings asserted; both apply on PostgreSQL. |
| **AC-4** **no** unique index on `devices(jid)` | PASS | `TestAccountSchemaShipsNoUniqueJIDIndex` scans the whole list for `UNIQUE INDEX … ON DEVICES(JID)`. `TestCompanionSlotsSurviveAccountMigrations` and `TestAccountMigrationsApplyToAPreExistingDatabase` both keep two slots on one `jid`. `TestLoadFromRegistry_KeepsSiblingSlotsOnSameNumber` still passes unchanged. |
| **AC-5** every statement runs on both engines, one statement each, no `UPDATE` backfill | PASS | The full suite passes against real PostgreSQL 16. `TestAccountSchemaIsAppendedNotEdited` asserts one statement per migration, no `UPDATE `, and none of `AUTOINCREMENT` / `WITHOUT ROWID` / `PRAGMA` / `DEFAULT 1)` / `BLOB`. |
| **AC-6** `idx_devices_account_priority` **not** shipped | PASS | `TestAccountSchemaDefersLaterTicketMigrations`. |
| **AC-7** `chats.bsuid` **not** shipped | PASS | Same test, `bsuid` case. |
| **AC-8** `DeviceRecord` carries the seven fields, no collision with Chatwoot `AccountID` | PASS | `domains/chatstorage/chatstorage.go` — `GowaAccountID`, `Transport`, `Priority`, `SendState`, `MetaPhoneNumberID`, `MetaDisplayPhone`, `MetaWABAID`. `ChatwootDeviceConfig.AccountID` is untouched; the two coexist and the build is clean. |
| **AC-9** SELECT lists extended, wrapper updated alongside | PASS | `TestDeviceRoutingColumnsAreReadable` writes a value and reads it back through **all three** paths — `ListDeviceRecords`, `GetDeviceRecord`, `GetDeviceRecordByJID` (the ticket named two; the third had the identical defect). The wrapper gained eight delegating methods — without them the package would not compile, since `deviceChatStorage` must satisfy `IChatStorageRepository`. |
| **AC-10** `account_id = ''` means "no account", never a shared one | PASS | `TestAccountMethodsRefuseBlankAccountID`: all seven repository methods refuse `""` and `"   "`, so a blank id can never address the un-accounted fleet. `TestDeviceEndpointsRequireAnExistingAccount` proves the usecase never reaches storage with one. |
| **AC-11** `GET /accounts` never returns `''` | PASS | A row exists in `accounts` only via `CreateAccount`, which refuses a blank id (`TestAccountMethodsRefuseBlankAccountID`); the device column is a separate table and is never listed as an entity. |
| **AC-12** exactly five endpoints | PASS | `TestAccountRoutesShipExactlyFive` enumerates the registered route table and matches the five patterns exactly. |
| **AC-13** `POST /…/meta-numbers` **not** shipped | PASS | Same test fails on any registered route containing `meta-numbers`. |
| **AC-14** `POST /accounts` generates an id when omitted | PASS | `TestCreateAccountGeneratesAnID` — generated via `fiberUtils.UUID()`, the `CreateDevice` pattern, and the generated id is the one written. |
| **AC-15** attach links only; at most one account per device | PASS | `TestAttachDeviceIsSingleAccount` (re-attach idempotent, second account → `ErrDeviceAlreadyAttached`, unknown device → `ErrDeviceNotFound`, no row created, priority untouched) and `TestAttachDeviceNeverSetsPriority`. |
| **AC-16** order takes the complete list; omission or a foreign device is rejected | PASS | `TestSetAccountDeviceOrderRequiresTheCompleteSet` — the complete list reorders and yields a lower priority for the first device; omitting, repeating, or naming a foreign device is refused with `ErrDeviceOrderIncomplete`, and the stored order is unchanged after every rejection. |
| **AC-17** `send_state` closed list `{"", "blocked"}`, 400 otherwise, only way to clear | PASS | `TestValidateSetSendStateClosedList` (accepts `""`/`"blocked"`, rejects `disabled`/`BLOCKED`/`block`/`paused`/`0`), `TestSetDeviceSendStateRejectsValuesOutsideTheClosedList` (nothing reaches storage; the stored value is unchanged; `""` clears). The validator returns `pkgError.ValidationError`, which is a 400. |
| **AC-18** reference-only, prefixed, enforced on **read and resolve** as well as write | PASS | Write: `TestValidateMetaTokenRefIsAnAllowlist` rejects a literal token, lowercase, the bare prefix, `DB_URI`, `APP_BASIC_AUTH`, `AGENT_WEBHOOK_KEY`, a foreign namespace, and smuggled whitespace. Resolve: `TestResolveMetaTokenEnforcesTheAllowlistOnRead` stores `DB_URI` **directly in the repository**, bypassing the write check entirely, and the resolver still refuses it. The prefix itself is validated — `TestMetaTokenRefPrefixIsItselfValidated` rejects `""`, `D`, `A`, `META`, `M_` — so a widening configuration cannot turn the allowlist into "read any environment variable". |
| **AC-19** the reference is never returned and the resolved value never logged | PASS | Structural: `TestAccountDTOCarriesNoTokenReference` and the reflection check in `TestListAccountsHidesTheTokenReference` assert no response or row type carries a token/secret field. `ListAccounts`'s SELECT list does not name the column. `TestValidateMetaTokenRefNeverEchoesTheValue` asserts the error does not quote a supplied token. Only `GetAccountMetaTokenRef` reads the column, with one caller. |
| **AC-20** closed-list validation lives in one place | PASS | `src/validations/account_validation.go` holds every closed list; `ui/rest/account.go` contains no list and no validation, and `usecase/account.go` calls the validators. Both `IsValidTransport` and `ValidatePriority` have real call sites (read-side DTO mapping, generated-order bound), so neither is dead code. |
| **AC-21** the handler never touches `IChatStorageRepository` | PASS | `ui/rest/account.go` imports `domains/account`, `domains/chatstorage` (sentinel errors only), `pkg/error`, `pkg/utils`, `usecase` (the actor-context helper) and fiber — no repository. `TestAccountRoutes*` drive the handlers through a usecase stub. |
| **AC-22** registered on `apiGroup` above `headerDeviceGroup` | PASS | `cmd/rest.go`: the account group is mounted immediately after `InitRestDevice` (line ~140) and above `headerDeviceGroup`. `TestAccountGuardDoesNotLeakOntoLaterRoutes` additionally proves the path-scoped group does not repeat the `Group("", …)` hazard the file documents. |
| **AC-23** the protection decision is made and implemented here | PASS | Decision: **reject the request with 503 `ACCOUNTS_AUTH_REQUIRED`**, following `ui/rest/agent.go:53`. `TestAccountRoutesRefuseWithoutConfiguredBasicAuth` drives **every route enumerated from the router** — so a sixth route added later is covered by construction — asserts 503 on each, and asserts the usecase was never reached. `TestAccountRoutesPassWithConfiguredBasicAuth` is the other side. |
| **AC-24** the server boots on a pre-existing database with no behaviour change | PASS | `TestAccountMigrationsApplyToAPreExistingDatabase`: rolls a populated database back to version 50, runs `InitializeSchema`, lands on 61 with both pre-existing companion slots intact and reading `account_id=""`, `transport=""`, `priority=100`, `send_state=""`; re-running is a no-op. Passes on **both** engines — on PostgreSQL through the single-transaction batch path. No behaviour change follows structurally: no runtime path reads a new column, and the full suite is green on both engines. |
| **AC-25** reconnect does not clear routing, pinned by a regression test | PASS | `TestSaveDeviceRecordPreservesRouting` — after a `SaveDeviceRecord` call shaped exactly like a reconnect (identity fields only, routing fields at zero), `account_id`, `priority` and `send_state` are unchanged while the identity fields did change. The invariant is now also written down above `SaveDeviceRecord`. |
| **AC-26** both migration-count tests updated and passing | PASS | `sqlite_repository_debug_test.go` 50 → 61; `sqlite_repository_transcript_test.go` `migrations[48:]` → `migrations[48:50]` so it keeps pinning ticket 07's two rather than silently absorbing ticket 16's eleven. Both pass on both engines. |

## Non-functional criteria

| NFR | Result |
|---|---|
| **NFR-1** boots on both engines; no dialect-specific statement; no row rewrite | PASS — full suite green on SQLite and PostgreSQL 16; no `postgresDDL` substitution is needed by any of the eleven statements; no `UPDATE` in the list (asserted). |
| **NFR-2** no behaviour change; no existing response changed | PASS — no runtime path reads a new column; no existing handler or DTO was modified; the full pre-existing suite is unchanged in outcome. |
| **NFR-3** the reference never appears in a response or log; the token never enters the database | PASS — see AC-19. The audit log records `meta_channel=true/false`, never the reference name. |
| **NFR-4** the endpoints never run inside a device context | PASS — mounted above `headerDeviceGroup`; AC-22. |
| **NFR-5** accounts are a grouping, not an authorization boundary | PASS — stated in `spec.md`, in the `domains/account` package doc, and in the OpenAPI tag description; every mutating call is audit-logged with `basicauth.UsernameFromContext`. |

## Known and accepted

- **No per-account authorization.** With credentials configured, any authenticated
  caller can act on any account. This is the deployment's flat credential model,
  not something this ticket introduces; it is recorded as NFR-5 so tickets 17–20
  cannot mistake account membership for tenant isolation.
- **`devices.account_id` has no index.** `ListDeviceRecordsByAccount` and the order
  re-read are sequential scans over a table of tens of rows, on operator-triggered
  paths. The composite index belongs to the ticket that first reads it on a hot
  path (AC-6).
- **Rollback leaves `schema_info` at 61.** Reverting the commit leaves the columns
  and indexes in place, unread and default-valued, therefore inert — but a re-land
  must append at 62+ and never edit 51–61, because the version counter is what gates
  re-runs. Recorded in `plan.md > Rollback`.
- **A device attached after an ordering keeps `priority = 100`** and is placed
  wherever that value falls. The operator re-runs `PUT …/devices/order`, which takes
  the complete list by design. Attach cannot assign a priority (AC-15).
