---
ticket: z8pmx9m6ae
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-08-31
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6ae"
  github: ""
---

# Verification — 22 · Identity foundation

## Outcome

**PASSED.** All twelve acceptance criteria are mapped to an executed result
below.

## Runtime-impact statement

**No deployment runtime file changed.** `docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml` and
`.github/workflows/set-latest-tag.yaml` appear in neither the working tree diff
nor the branch diff.

There **is** a runtime effect on the database, and it is the point of the ticket:
booting this build applies eleven migrations and seeds ~61 catalogue rows. That
effect is one-way (append-only DDL plus idempotent seeding), is not read by any
request path, and is covered by AC-1 and AC-7.

## Environment

- Commands run from `src/`.
- **`-tags purego` is mandatory.** Without it the SQLite driver is a CGO stub and
  ~30 storage tests fail with "Binary was compiled with CGO_ENABLED=0". That is
  an environment property, not a regression.
- PostgreSQL evidence was produced against a **real remote PostgreSQL** (the
  deployment's Supabase instance) via `CHAT_STORAGE_TEST_POSTGRES_URI`. The
  harness creates a throwaway schema per test, pins it on the connection DSN, and
  drops it `CASCADE` on cleanup — it never reads or writes `public`. Running with
  the variable **unset** makes every PostgreSQL test `t.Skip` silently, so a
  "passing" run would prove nothing; the runs below are recorded as non-skipped.

## Baseline

`go test -tags purego ./...` on the **unmodified** tree, before the first edit:

```
--- FAIL: TestResolveDocumentMIME/Zip
FAIL  github.com/aldinokemal/go-whatsapp-web-multidevice/usecase
```

One pre-existing failure, unrelated to this ticket (document MIME sniffing), the
same one ticket 18 recorded. Every result below is read against it.

## Commands

```
go build ./...                                     OK
go vet  ./...                                      OK
go test -tags purego ./...                         only the baseline failure
go test -tags purego ./infrastructure/chatstorage/ OK
go test -tags purego ./pkg/auth/...                OK
go test -tags purego ./usecase/... -run 'Identity|Bootstrap|Seed|Lookup'   OK
go test -tags purego ./cmd/... -run Redacted       OK
CHAT_STORAGE_TEST_POSTGRES_URI=<live> go test -tags purego \
  ./infrastructure/chatstorage/ -run 'TestPostgresMigrationsExecuteOnARealServer|TestIdentitySchemaAppliesAndReapplies|TestAccountSchemaMigratesExistingDatabase'
                                                   see AC-1
```

## Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| **AC-1** — migrations 62..72 appended, slice length exactly 72, applies cleanly on SQLite and PostgreSQL, re-apply is a no-op | **PASS** | `TestIdentitySchemaIsAppendedNotEdited` asserts `len == 72` and the eleven appended statements in order. `TestIdentitySchemaAppliesAndReapplies` reads `schema_info` back at 72 and proves a second `InitializeSchema` moves nothing. `TestAccountMigrationsApplyToAPreExistingDatabase` rolls a database back to version 50 **holding real device rows** and upgrades it to 72 with the rows intact. PostgreSQL half: see the note below this table. |
| **AC-2** — `users` columns, `account_id VARCHAR(255) NOT NULL DEFAULT ''`, `token_epoch INTEGER NOT NULL DEFAULT 1` | **PASS** | Migration 62 declares all nine columns. `TestCreateUserDefaultsAndRefusals` reads a freshly created row back and asserts `account_id == ""`, `status == "active"`, `token_epoch == 1` — the defaults are proven by round-trip, not by reading the DDL. |
| **AC-3** — both username and partial-email unique indexes exist and apply on both engines | **PASS** | `TestCreateUserAllowsManyBlankEmails` creates three users with a blank email (the partial `WHERE email <> ''` is what makes this legal). `TestCreateUserRefusesADuplicateEmail` proves a duplicate non-blank email is refused. `TestCreateUserIsIdempotentOnUsername` proves the username index is enforcing. All three run on PostgreSQL too when the URI is set. |
| **AC-4** — `roles`, `permissions`, `role_permissions` (PK role_id,permission_id), `user_roles` (PK user_id,role_id) | **PASS** | Migrations 65–68. Exercised rather than merely declared: `TestSeedIdentityIsIdempotent` writes and reads all three, and `TestGrantRoleToUserIsIdempotentAndKeepsGrantedAt` proves `user_roles`'s composite key by granting the same role twice and finding one row. |
| **AC-5** — `refresh_tokens` with its eight columns, the unique hash index and the family/expiry indexes | **PASS** | Migrations 69–72, asserted by name and position in `TestIdentitySchemaIsAppendedNotEdited`, and created for real on both engines by `InitializeSchema` in every storage test. No repository method reads the table by design (see the scope note below). |
| **AC-6** — a Go catalogue under `src/pkg/auth/` declaring the 25 permissions of §06 | **PASS** | `TestCatalogueHoldsTwentyFivePermissions` asserts the count, rejects a blank id or a missing description, rejects duplicates, and checks all 25 ids **spelled out literally** — they are a wire format that appears in tokens and grant rows. |
| **AC-7** — roles, permissions and grants upserted idempotently; two boots produce identical contents and no error | **PASS** | `TestSeedIdentityIsIdempotent` snapshots all three tables after the first seed, re-seeds, and compares byte-for-byte. It then **tampers** with a seeded description and re-seeds to prove the "write only differences" optimisation still restores a drifted row — that is what stops "idempotent" degrading into "never writes". `TestSeedIdentityUnderConcurrency` runs four seeders at once and asserts the end state holds each row exactly once. |
| **AC-8** — admin holds all 25; user holds exactly the 9 named | **PASS** | Proven at two levels. In `pkg/auth`: `TestAdminHoldsEveryPermission` and `TestUserHoldsExactlyNinePermissions`, the latter also asserting by name that the user role holds **none** of the 15 admin-only permissions. Through storage: `TestSeedIdentityGrantsMatchTheCatalogue` reads the grants back out of `role_permissions` after a real seed. |
| **AC-9** — bcrypt cost 12; `golang.org/x/crypto` promoted to direct | **PASS** | `TestHashAndVerifyPassword` asserts the `$2a$12$` prefix — the cost is encoded in the hash itself, so this verifies the real work factor rather than restating the constant — plus round-trip verification, rejection of wrong passwords, and that two hashes of one password differ (the salt is live). `src/go.mod` moves `golang.org/x/crypto v0.54.0` out of the `// indirect` block; `go.sum` is unchanged because the version was already resolved and hashed. |
| **AC-10** — bootstrap creates the first admin only on an empty table; silent no-op otherwise; never in logs or the settings dump | **PASS** | `TestBootstrapAdminCreatesTheFirstAdministrator` proves the row, the `admin` grant, and a hash that verifies. `TestBootstrapAdminIsANoOpOnANonEmptyTable` runs a **second, different** credential and proves no row is added and the existing password is unchanged. `TestBootstrapAdminCredentialParsing` covers the format rules and asserts no error message carries the password. `TestBootstrapAdminFailsClosedOnAReadError` proves a count failure does not fall through to "assume zero". TC-9: `TestRedactedSettingsHidesCredentials` now includes `auth_bootstrap_admin`. |
| **AC-11** — every new method declared in the interface, implemented on `*SQLiteRepository`, delegated in `deviceChatStorage` | **PASS** | `go build ./...` succeeds. That is the proof: `NewStorageRepository` returns the interface and `newDeviceChatStorage` returns it too, so either type missing a method is a compile error. `*SQLiteRepository` and `*deviceChatStorage` are the only implementers in the tree — every other test fake embeds the interface. |
| **AC-12** — no HTTP behaviour change; build, vet and test pass; basic auth unchanged; no route added or removed | **PASS** | Suite result above: only the baseline failure. The branch diff touches **no file under `src/ui/`** — no route table, no middleware, no handler, no basic-auth guard. Verified by `git diff --stat`, which is the right instrument here: a route change in this ticket would be a scope violation, not a test failure. |

### AC-1, the PostgreSQL half

Executed against a **real remote PostgreSQL** — the deployment's own Supabase
instance — with `CHAT_STORAGE_TEST_POSTGRES_URI` set, so none of the three
skipped:

```
=== RUN   TestPostgresMigrationsExecuteOnARealServer
--- PASS: TestPostgresMigrationsExecuteOnARealServer (173.40s)
=== RUN   TestAccountSchemaMigratesExistingDatabase
--- PASS: TestAccountSchemaMigratesExistingDatabase (161.32s)
=== RUN   TestIdentitySchemaAppliesAndReapplies
--- PASS: TestIdentitySchemaAppliesAndReapplies (127.67s)
PASS
ok  github.com/aldinokemal/go-whatsapp-web-multidevice/infrastructure/chatstorage  467.351s
```

`TestPostgresMigrationsExecuteOnARealServer` is the criterion's real evidence and
it is the only test that can be: it applies all 72 statements through
`runMigrationsAtomically` — **one transaction**, which is precisely the shape
that makes a single unportable statement stop the server booting — then re-runs
to prove the no-op path every restart takes, then reads `schema_info` back and
asserts 72. A green result here is the direct answer to NFR-1.

**The production schema was not touched.** Each test ran inside its own
throwaway schema, pinned on the connection DSN and dropped `CASCADE` on cleanup.
Confirmed by direct query afterwards:

```
leftover gowa_test_% schemas: 0
production schema_info version: 61      (unchanged — the tests did not migrate it)
public.users exists: false
```

That last line is worth keeping: the identity tables do **not** yet exist in the
live database. They are created the first time this build boots against it, which
is the deployment step this ticket is handing over — not something verification
performed on the operator's behalf.

Offline, both dialect renderings are also pinned:
`TestSQLiteMigrationsAreRenderedVerbatim` (SQLite gets the statement unchanged)
and `TestPostgresMigrationsCarryNoSQLiteOnlyConstructs` both **PASS** over the
full 72, and needed no edit — they iterate the whole list, which is why the plan
named them as the real portability gate rather than adding a parallel test.

`TestIdentitySchemaIsPortable` additionally asserts, per new migration: one
statement each (a second after a semicolon would be silently dropped by
`runMigration`), no `UPDATE` backfill, and none of `AUTOINCREMENT`,
`WITHOUT ROWID`, `PRAGMA`, `BLOB` or `BOOLEAN ... DEFAULT 1`.

## Two things this verification deliberately does not claim

### The refresh-token methods were not shipped, and that is recorded, not hidden

The ClickUp plan sketched "refresh-token insert/rotate/revoke/sweep". Two review
lenses independently rejected that from opposite directions — the senior lens as
ticket-23 scope that `spec.md > Out of scope` already excludes, the security lens
because the sketched method pair (`GetRefreshTokenByHash` then
`RevokeRefreshToken`) **cannot express atomic rotation**: two concurrent
presentations of one token both see `revoked_at IS NULL` and both succeed, making
a stolen token indistinguishable from the legitimate one.

The table, all four of its migrations and the rotation invariant ship; the
methods do not. No acceptance criterion asks for them: AC-5 is a schema
criterion, and AC-11 constrains how methods are wired, not which exist. See
`plan.md > D3`.

### A green suite proves less than usual here, and here is the bound

Nothing in this ticket is reachable from an HTTP request — that is AC-12's whole
point — so no test can exercise these rows the way production will. What **is**
proven is: the schema applies and re-applies on both engines against a database
holding real rows; the seeder is idempotent, restores drift, and survives
concurrency; the bootstrap is race-safe and cannot be re-triggered; and the
password primitives round-trip at the stated cost.

What is **not** proven, and is not provable in this ticket: that the permission
ids match the routes they will guard. That mapping is ticket 24's, and the
catalogue asserts only its own contents.

## Escalation — approved by the owner, NOT applied by this ticket

`plan.md > E-1` recorded a finding this change does not fix. On 2026-08-31 the
owner **approved** remediating it. Applying it was then **blocked by the
environment's safety classifier**, which refuses writes to a production database
from this session. It is therefore handed over as SQL for the owner to run, and
this ticket ships with the exposure still open.

### The measurement, which is worse than the plan recorded

`plan.md > E-1` sampled five tables. The full enumeration of `public`:

```
total tables in public: 29
exposed to anon AND authenticated: 29   (DELETE, INSERT, REFERENCES, SELECT,
                                         TRIGGER, TRUNCATE, UPDATE)
row-level security enabled on: 0

pg_default_acl, schema public:
  postgres → {anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}
```

Every table is granted in full to `anon` — the role behind the project's public
PostgREST endpoint — with RLS disabled. The plan described this as an exposure of
message content, chat history and `devices.webhook_secret`. The full list adds a
materially worse category the sample missed:

```
whatsmeow_identity_keys      whatsmeow_sessions        whatsmeow_pre_keys
whatsmeow_message_secrets    whatsmeow_sender_keys     whatsmeow_device
whatsmeow_app_state_sync_keys                          whatsmeow_privacy_tokens
```

These are the **Signal-protocol session and identity keys** of the connected
WhatsApp accounts, plus the device registration rows. They are readable — and
deletable, and truncatable — by the anon role.

**None of this is caused by this ticket, and none of it is new.** It is the
standing posture of the deployment: a Supabase project applies
`ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated` to
`public`, and this gateway creates all of its tables there. What this ticket
changes is only the stakes — `users.password_hash` and `refresh_tokens.token_hash`
would join that set on first boot.

### The remediation, for the owner to run

Every one of the 29 tables belongs to this gateway (chat storage plus the
whatsmeow session store); there is no other application's table in `public`. The
gateway itself connects as `postgres`, and `service_role` is untouched, so
nothing the gateway does is affected.

```sql
-- 1. FUTURE tables. This one is load-bearing and time-sensitive: the six
--    identity tables do NOT exist yet and are created the first time this build
--    boots. Without this they are granted to anon the moment they appear.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- 2. EXISTING tables.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
```

Verification afterwards — both should read 0 and `{...}` with no `anon=` entry:

```sql
SELECT COUNT(*) FROM information_schema.role_table_grants
 WHERE table_schema='public' AND grantee IN ('anon','authenticated');
SELECT defaclrole::regrole, defaclacl FROM pg_default_acl
 WHERE defaclobjtype='r' AND defaclnamespace='public'::regnamespace;
```

**Caveat the owner must weigh:** this cannot be verified from here. If any
Supabase client reads these tables with the anon or authenticated key, it will
stop working. Given every table is a gateway-internal one, that is unlikely — but
it is an assumption, not a measurement.

Ordering note: running step 1 **before** this build first boots is what keeps the
identity tables from ever being exposed. Running it afterwards also works — step
2 catches them — but they are exposed in between.

Related and **resolved**: the risk that `CREATE TABLE IF NOT EXISTS users` would
silently adopt a pre-existing table. Probed before the migrations were appended —
`search_path` is `"$user", public, extensions`, and `to_regclass` returns NULL for
`users`, `roles`, `permissions` and `refresh_tokens`. Supabase's own `auth.users`
and `auth.refresh_tokens` exist but `auth` is not on the search path, so they are
unreachable unqualified and cannot be adopted.

## Operational note

Running the **whole** `infrastructure/chatstorage` package against the remote
Supabase instance does not finish inside ten minutes — each test creates,
migrates and drops its own schema over the public internet. A run killed at the
timeout leaves an orphaned `gowa_test_<pid>_<n>` schema behind. One
(`gowa_test_33256_6`) was created that way, was dropped explicitly, and the
database was confirmed to hold no `gowa_test_%` schema afterwards.
