---
ticket: z8pmx9m6ae
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-08-31
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6ae"
  github: ""
---

# Plan — 22 · Identity foundation

> **Revision 2.** Revision 1 was authored before any code and reviewed by the
> advisory panel (senior / security / performance) **against the source**, not
> against its own prose. Every finding is answered in
> [Panel response](#panel-response). Six findings changed the design, four were
> declined with reasons, and three claims of revision 1 were corrected. One
> finding is not about this ticket at all and is **escalated to the owner**
> ([E-1](#e-1--escalation-the-identity-tables-land-in-a-schema-anon-can-read-and-write)).

## Approach

Bottom-up, schema and storage only, no HTTP surface. The new repository file
follows `account_repository.go` exactly — same package, same "refuse the blank
id" discipline, same "the comment says why, not what" style.

Three decisions carry the design:

1. **The catalogue is code, the roles are data.** Permissions are compile-time
   facts (each is wired to a route in ticket 24), so they live in Go and are
   mirrored into the table at boot; roles and grants are rows, so an operator can
   compose a `supervisor` role without a redeploy.
2. **This ticket ships the six repository methods the seeder and the bootstrap
   actually call — and not one more.** Revision 1 listed sixteen; ten of them
   were ticket 23/24 surface that `spec.md > Out of scope` already excludes.
   Their absence is not an omission; the invariants a later ticket needs are
   written into the migration comments instead of guessed at ([D3](#d3--the-refresh-token-methods-are-dropped-and-their-invariant-is-written-down)).
3. **Seeding is one transaction that writes only what differs.** Revision 1's
   per-row upsert was 61 statements — ~122 network round-trips and 61 commits
   against a remote Supabase database — on **every** boot ([D2](#d2--the-seeder-is-one-transaction-that-writes-only-differences)).

## Anchors, not line numbers

| Anchor | Symbol |
|---|---|
| "the migration list" | `getMigrations()` in `infrastructure/chatstorage/sqlite_repository.go` |
| "the schema entry point" | the `chatStorageRepo.InitializeSchema()` call inside `initApp` |
| "the seeder call site" | the statement immediately after that call, inside `initApp` |
| "the wrapper" | `deviceChatStorage` in `infrastructure/whatsapp/chatstorage_wrapper.go` |

`InitializeSchema` has a **second** call site, `cmd/chatstorage_migrate.go` —
`initApp` early-returns for that subcommand. That path already omits `accounts`
and ticket 16's device columns from the table list it copies, so the identity
tables are likewise not copied. Pre-existing and out of scope; named here so the
anchor is not read as "the only entry point".

## The design changes the panel forced

### D1 — the seeder is a usecase, not a `pkg/`

Revision 1 put `Seed` and `BootstrapAdmin` in `pkg/auth/seed.go` behind a narrow
`SeedStore` interface. **Two lenses rejected both halves, and the stated
rationale for the narrow port was simply false:** `pkg/utils/whatsapp.go` already
imports `domains/chatstorage`, so there was never a cycle to avoid. In this tree
`pkg/` holds leaf helpers (`error`, `sqlite`, `utils`, `dbdialect`) and the home
for "orchestrate over `IChatStorageRepository`" is `usecase/` —
`usecase.NewAccountService(repo, deviceUsecase)` is the precedent from ticket 21.

Seeding moves to `usecase/identity.go` and takes `IChatStorageRepository` whole,
the way every other consumer in this tree does; every existing test fake embeds
that interface and gets the new methods for free. With the seeder gone,
`pkg/auth` is a dependency-free leaf holding the catalogue and the password
helpers, so revision 1's `pkg/auth/perm` sub-package buys nothing and collapses
into it.

### D2 — the seeder is one transaction that writes only differences

Revision 1 seeded 2 roles + 25 permissions + 34 grants as 61 separate autocommit
statements. Against the live remote PostgreSQL that is roughly **122 round-trips
and 61 commits on every start**, in front of `InitWaCLI` — and, because
`ON CONFLICT DO UPDATE` writes a new row version even when nothing changed, it
also churns ~61 dead tuples per restart, forever, on a 61-row working set.

`SeedIdentity` is therefore **one** repository method taking the whole catalogue,
in the shape `storeMessagesChunk` already uses for exactly this reason: one
`Begin`, three reads to learn what is already correct, writes for **only** the
rows that differ, one `Commit`. A steady-state boot costs four round-trips and
writes nothing. TC-5 still holds: a mutated description still differs, so it is
still restored.

The catalogue is iterated in **one fixed order** so two concurrent seeders block
on each other rather than deadlock, and the database — not process memory — is
still what serialises them.

### D3 — the refresh-token methods are dropped, and their invariant is written down

The security lens found that revision 1's `GetRefreshTokenByHash` +
`RevokeRefreshToken(tokenID)` pair **cannot express atomic rotation**: two
concurrent presentations of one token both observe `revoked_at IS NULL` and both
succeed, which makes a stolen token indistinguishable from the legitimate one —
defeating the entire purpose of `family_id`. The senior lens, independently,
found the same five methods to be ticket-23 surface this spec excludes.

Both are right, and they resolve the same way: **ship the table, ship no method.**
Migration 69/70's comments carry the two facts ticket 23 must not re-derive:

- rotation is **one conditional statement** —
  `UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
  reporting `RowsAffected() > 0` — which is what the `UNIQUE` index on
  `token_hash` exists to make atomic, exactly as `MarkAccountDeviceBlocked`
  already does for `send_state`;
- `token_hash` is `VARCHAR(64)`, which **is** the specification of the algorithm:
  64 hex characters is SHA-256. A salted hash (bcrypt/argon2) is not usable here
  and never will be, because the lookup is *by hash* and a unique index cannot
  index a per-row salt.

Writing the invariant costs two comments. Shipping a method that violates it
costs a security review in ticket 23 that may not happen.

### D4 — the bootstrap admin cannot lose a race

Revision 1's `CountUsers()`-then-`CreateUser` is a read-then-write across
processes, which contradicts NFR-4 in the plan's own words: two replicas both
read 0, both hash, both insert, and the loser hits `idx_users_username` — dying
fatally, under revision 1's own severity rule, on PostgreSQL.

`CreateUser` becomes `INSERT ... ON CONFLICT(username) DO NOTHING` returning
whether it created a row — the change-only-in-SQL shape `MarkAccountDeviceBlocked`
already uses. A lost race is then the ordinary no-op it actually is, not an
error. `CountUsers` stays as the AC-10 guard, and a **failure** to read it fails
closed: no bootstrap, never "assume zero".

### D5 — the seeder's failure is not fatal

Revision 1 reused `InitializeSchema`'s severity rule (fatal on PostgreSQL). That
rule is justified by "continuing would run the gateway against a schema that does
not exist". No route reads a seeded row in this ticket, so the justification does
not transfer, and inheriting it would add a new startup-kill path for rows
nothing consults. The seeder logs at `Error` on both engines. Ticket 24 — the
first ticket that actually depends on the rows — owns escalating it.

### D6 — the small hardening the security lens asked for, taken as a set

| Change | Why |
|---|---|
| `status VARCHAR(16) NOT NULL DEFAULT 'active'`, closed set `active`/`disabled` | revision 1 pinned the defaults for `account_id` and `token_epoch` but left `status` unpinned; ticket 24's `status <> 'disabled'` check would then pass for a blank value, so a disabled user stays live |
| username is trimmed **and lower-cased** at the one chokepoint | `idx_users_username` is byte-exact on both engines, so `Admin` and `admin` would be two users — account confusion the moment ticket 26 opens user creation |
| `HashPassword` rejects < 8 or > 72 bytes | bcrypt in x/crypto v0.54.0 **returns `ErrPasswordTooLong`** above 72 bytes rather than truncating; without a stated bound a passphrase user gets an opaque hashing error and a 1-character bootstrap password is accepted |
| `DummyVerifyPassword()` ships beside `VerifyPassword` | an unknown username returns without paying bcrypt, which is a ~250 ms timing oracle that enumerates valid usernames; ticket 23's login path calls this on the miss so every attempt costs the same |
| the bootstrap admin is created with `account_id = ''`, and the rule is written into the repository file | `''` is **not** a device filter — `account_repository.go` states a blank id "would address the entire un-accounted fleet"; ticket 25 must refuse it, not resolve it |
| `AUTH_BOOTSTRAP_ADMIN` set **and** ignored logs at `Warn` | the credential otherwise sits in the deployment environment forever, unremarked, and re-arms if `users` is ever emptied |

## Steps

### S1 — the migrations (AC-1..AC-5)

Append eleven entries to the migration list, in the shapes the reference document
specifies, each with the rationale comment migrations 51–61 carry.

| # | Statement |
|---|---|
| 62 | `CREATE TABLE IF NOT EXISTS users (...)` |
| 63 | `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)` |
| 64 | `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email <> ''` |
| 65 | `CREATE TABLE IF NOT EXISTS roles (...)` |
| 66 | `CREATE TABLE IF NOT EXISTS permissions (...)` |
| 67 | `CREATE TABLE IF NOT EXISTS role_permissions (... PRIMARY KEY (role_id, permission_id))` |
| 68 | `CREATE TABLE IF NOT EXISTS user_roles (... PRIMARY KEY (user_id, role_id))` |
| 69 | `CREATE TABLE IF NOT EXISTS refresh_tokens (...)` |
| 70 | `CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash)` |
| 71 | `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id)` |
| 72 | `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at)` |

Portability, each checked against `postgresDDL` and against a migration that
already ships on both engines:

- `VARCHAR(n)`, `INTEGER`, `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` — migrations 51
  and 44.
- The **partial** unique index of migration 64 is the exact shape of migrations
  38 and 59.
- No `AUTOINCREMENT`, no `BLOB`, no `PRAGMA`, no `WITHOUT ROWID`, no
  `BOOLEAN ... DEFAULT 1`, no `UPDATE` backfill.
- `expires_at TIMESTAMP NOT NULL` carries no default: it is always written by the
  application, and `NOT NULL` without a default is legal on both engines because
  the table is created empty.

**Pre-flight, promoted from a note to a step** (both lenses): before appending,
`to_regclass` is read against the live database for each of the six table names.
A pre-existing compatible table is the dangerous tail — `CREATE TABLE IF NOT
EXISTS` no-ops, the version still records as applied, and the identity layer
silently adopts a stranger's rows. The probe output is recorded in `verify.md` as
gating evidence for AC-1.

### S2 — the permission catalogue (AC-6, AC-8)

New package `src/pkg/auth`, a dependency-free leaf. It holds the 25 permission
constants of §06, `Catalogue()` (ordered `{ID, Description}`), `Roles()`, and the
two grant sets.

The `user` grant set is written **literally**, never derived by subtraction from
the admin set. A set defined by exclusion silently grants every permission a
later ticket adds — exactly the failure AC-8's second sentence names.

### S3 — the domain types (AC-11)

Add `User`, `Role`, `Permission` and `RoleGrant` to
`domains/chatstorage/chatstorage.go`, beside `Account`. **No `RefreshToken`
struct** — nothing in this ticket reads that table (D3), and a struct with no
reader is the same dead weight the reference document dropped
`devices.created_by_user_id` for.

`User.PasswordHash` carries `json:"-"`, for the reason
`DeviceRecord.WebhookSecret` does: the tag is what makes "a handler that marshals
it cannot leak the hash" true by construction rather than by review.

### S4 — the repository (AC-2..AC-5, AC-7, AC-11)

New file `src/infrastructure/chatstorage/user_repository.go`. **Six** methods:

| Method | Called by |
|---|---|
| `SeedIdentity(roles []Role, permissions []Permission, grants []RoleGrant) error` | the seeder (D2) |
| `CountUsers() (int, error)` | the AC-10 guard |
| `CreateUser(user *User, passwordHash string) (bool, error)` | the bootstrap; reports whether it created a row (D4) |
| `GetUserByUsername(username string) (*User, error)` | resolves the id when the bootstrap lost the race |
| `GrantRoleToUser(userID, roleID string) error` | the bootstrap |
| `ListRolePermissions(roleID string) ([]string, error)` | the read AC-8 is verified through |

Rules carried from `account_repository.go`: every id argument is trimmed and a
blank one refused **before** any statement runs, and the trimmed value is what
gets bound. Upserts are `ON CONFLICT (...) DO UPDATE SET` for `roles` and
`permissions`; `role_permissions` and `user_roles` are **all-key** tables with no
column to SET, so they use `ON CONFLICT (...) DO NOTHING` — the shape migration
`message_edits` already uses.

### S5 — password hashing (AC-9)

New file `src/pkg/auth/password.go`: `BcryptCost = 12`, `HashPassword`,
`VerifyPassword`, `DummyVerifyPassword`.

`VerifyPassword` returns a bool, not an error: every caller's only correct
response to any failure is "reject the login", and an error return invites a
caller to distinguish "wrong password" from "corrupt hash" in a response body,
which is an oracle. `golang.org/x/crypto` moves out of the `// indirect` block.

### S6 — the seeder and the bootstrap admin (AC-7, AC-8, AC-10)

New file `src/usecase/identity.go`: `SeedIdentity(repo)` and
`BootstrapAdmin(repo, credential)`.

`BootstrapAdmin` splits on the **first** colon only (so a password may contain
one), refuses a blank half with a message that names the variable and never
quotes its value, fails closed on a `CountUsers` error, and is a `Warn`-level
no-op on a non-empty table. On an empty table it hashes, inserts conflict-
tolerantly, and grants `admin`. It logs the **username** and nothing else.

The credential is read at the call site with
`viper.GetString("auth_bootstrap_admin")` and passed as an argument. It is
deliberately **not** given a `config` global and **not** given a cobra flag — the
reasoning `chat_storage_uri` already carries: a flag puts a secret into `ps`
output and shell history. `redactedSettings()` already redacts any key containing
`auth` (verified at `cmd/root.go` `sensitiveSettingFragments`), and because
`viper.AutomaticEnv()` is used, an env-only value never enters `AllSettings()` at
all; the only reachable path is the `.env` file, which **is** redacted. TC-9 pins
it.

### S7 — the interface and the wrapper (AC-11)

Add the six methods to `IChatStorageRepository` in an "Identity operations
(ticket 22)" block, and a straight delegation for each on `deviceChatStorage`.
None takes a device id, so none is device-scoped; the wrapper delegates
unchanged, with one comment saying why, exactly as the account block does.
`*SQLiteRepository` and `*deviceChatStorage` are the only implementers in the
tree — every other fake embeds the interface — so this is the complete blast
radius.

### S8 — tests

- `infrastructure/chatstorage/user_repository_test.go` — TC-1..TC-5, TC-12.
- `pkg/auth/auth_test.go` — TC-6, TC-7.
- `usecase/identity_test.go` — TC-5, TC-8, TC-12.
- `cmd/root_test.go` — TC-9 (one case added to the existing redaction test).

`migrations_dialect_test.go` needs **no** edit and is the real portability gate:
`TestSQLiteMigrationsAreRenderedVerbatim`,
`TestPostgresMigrationsCarryNoSQLiteOnlyConstructs` and
`TestPostgresMigrationsExecuteOnARealServer` iterate the whole list and pick up
62–72 automatically. Named here so no redundant test is added for it.

## Files to change

| File | Change |
|---|---|
| `src/infrastructure/chatstorage/sqlite_repository.go` | migrations 62–72 appended |
| `src/infrastructure/chatstorage/user_repository.go` | **new** |
| `src/infrastructure/chatstorage/user_repository_test.go` | **new** |
| `src/infrastructure/chatstorage/sqlite_repository_account_test.go` | count assertions rescoped |
| `src/infrastructure/chatstorage/sqlite_repository_debug_test.go` | count assertion rescoped |
| `src/infrastructure/chatstorage/AGENTS.md` | "currently 61 migrations" → 72 |
| `src/domains/chatstorage/chatstorage.go` | `User`/`Role`/`Permission`/`RoleGrant` |
| `src/domains/chatstorage/interfaces.go` | six identity methods declared |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | six identity methods delegated |
| `src/pkg/auth/perm.go` | **new** — the catalogue |
| `src/pkg/auth/password.go` | **new** |
| `src/pkg/auth/auth_test.go` | **new** |
| `src/usecase/identity.go` | **new** — seeder + bootstrap |
| `src/usecase/identity_test.go` | **new** |
| `src/cmd/root.go` | the seeder call site + bootstrap |
| `src/cmd/root_test.go` | TC-9 |
| `src/.env.example` | `AUTH_BOOTSTRAP_ADMIN` documented |
| `src/go.mod` | `golang.org/x/crypto` promoted to direct |
| `_specs/z8pmx9m6ae/*` | workflow artifacts |

### The existing assertions this ticket must rescope, and why

Four assertions hard-code the current migration count and **will fail** the
moment migration 62 is appended:

- `sqlite_repository_account_test.go:30` — `len(migrations) != 61`
- `sqlite_repository_account_test.go:34` — `accountOnes := migrations[50:]`, open-ended
- `sqlite_repository_account_test.go:48` — `len(accountOnes) != len(wants)`, derived from it
- `sqlite_repository_account_test.go:587` — `version != 61` after upgrade
- `sqlite_repository_debug_test.go:581` — `len(migrations) != 61`

plus one prose statement, `AGENTS.md:15`.

Revision 1 called the open-ended slice a *silent* widening. **That was wrong** —
line 48 length-checks it against an 11-element `wants`, so it fails loudly. The
correct reason to rescope it is the one the file's own bounded precedent gives
(`sqlite_repository_transcript_test.go`, `migrations[48:50]`): the assertion must
keep asserting **only ticket 16's set**. This is rescoping an assertion, not
weakening one.

TC-3 then runs the same one-statement / no-`UPDATE` / rejected-construct loop
over `migrations[61:72]`, so the new eleven do not lose the portability check
NFR-1 depends on. `sqlite_repository_transcript_test.go` needs no change.

## Validation strategy

From `src/` — note `-tags purego`, without which the SQLite driver is a stub and
most of the suite fails for an unrelated reason:

```
go build ./... && go vet ./... && go test -tags purego ./...
```

and, because NFR-1 is the dominant property, the same suite again against a real
PostgreSQL. Revision 1 claimed `newTestDB` "honours the chat-storage URI"; **it
does not** — it reads `CHAT_STORAGE_TEST_POSTGRES_URI`, and every PostgreSQL test
`t.Skipf`s silently when it is unset, so revision 1's stated PG run could have
passed while proving nothing:

```
CHAT_STORAGE_TEST_POSTGRES_URI=... go test -tags purego ./infrastructure/chatstorage/...
```

AC-1 evidence is a **non-skipped** `TestPostgresMigrationsExecuteOnARealServer`,
recorded as such in `verify.md`.

Two numbers are recorded rather than asserted: the measured bcrypt cost-12 hash
time, and the seeder's wall time on a second (fully seeded) boot against
PostgreSQL, with a stated ceiling of **300 ms**.

A baseline `go test -tags purego ./...` is captured on the unmodified tree
**before the first edit**, so a pre-existing failure is never reported as this
ticket's.

## Rollback

Revert the commit. The eleven tables and indexes remain in the database, unread
and harmless; `schema_info` keeps version 72 and the reverted binary simply never
queries them. No data is migrated or rewritten, so nothing is lost, and
re-applying the ticket is a no-op against the already-migrated database.

One caveat, stated rather than discovered later: because the migration list is
index-positional, a *later* ticket must not reuse positions 62–72 after a revert.
The revert leaves those version numbers recorded in every database that booted
the ticket.

## Out of scope

- Any HTTP route, middleware or handler change — including touching basic auth.
- Token issuing and verification (ticket 23), including every `refresh_tokens`
  repository method (D3).
- Enforcement, redaction, device scoping (tickets 24, 25).
- The user-administration API (ticket 26).
- Deployment runtime files.
- The `public`-schema grant posture of the live Supabase project — see
  [E-1](#e-1--escalation-the-identity-tables-land-in-a-schema-anon-can-read-and-write).

## Risks and unknowns

1. **Migration portability is the sharp edge.** PostgreSQL applies all eleven in
   one transaction against the live database; one unportable statement and the
   server does not boot. Mitigated: every shape mirrors a migration already
   shipping on both engines, and TC-2 runs against real PostgreSQL.
2. ~~**A pre-existing `users` table.**~~ **Resolved, with evidence.** Probed
   against the live database on 2026-08-31: `search_path` is
   `"$user", public, extensions`, and `to_regclass` returns NULL for `users`,
   `roles`, `permissions` and `refresh_tokens`. Supabase's own `auth.users` and
   `auth.refresh_tokens` exist but `auth` is **not** on the search path, so they
   are unreachable unqualified. The check is repeated as a step (S1) and recorded
   in `verify.md`.
3. **bcrypt cost 12** is ~250–400 ms per hash on a normal core and can exceed 1 s
   on a throttled container. Irrelevant at boot (one hash, only on an empty
   table) but it is an unauthenticated CPU-exhaustion surface sharing the process
   with the whatsmeow event goroutines. Cost 12 is kept — it is the correct
   default — the measured number is recorded, and **ticket 23 owns rate-limiting
   the login route**.
4. **`refresh_tokens` has no sweeper.** `DeleteExpiredRefreshTokens` is
   deliberately not shipped (D3), so from ticket 23 onward the table grows with
   nothing pruning it. **Ticket 23 owns the sweep**, and the pattern is already
   in this tree: `debug_retention.go` — hourly ticker, delayed first sweep to
   keep it off the boot path, bounded batches with a pause between them.

## Panel response

31 findings across three lenses. Six changed the design (D1–D6 above), four are
declined below, and three revision-1 claims were corrected.

### Declined, with reasons

#### R-1 — prefixing the tables `gowa_*` (security major, senior major)

Both lenses proposed renaming the six tables to remove the risk that a
pre-existing `users` is silently adopted. Declined on three grounds:

- **The risk is measured, not deferred.** See Risk 2: `to_regclass` returns NULL
  for every one of the six names against the live database, and `auth` is not on
  the search path. There is nothing to adopt.
- **AC-2, AC-4 and AC-5 name the tables literally**, as does §03 of the reference
  document and every ticket from 23 to 26. Renaming them is a specification
  change that belongs to the owner, not a plan decision.
- **It does not fix the exposure the security lens actually found.** Supabase's
  `ALTER DEFAULT PRIVILEGES` grants `anon` full DML on **any** new table in
  `public`, whatever it is named. The prefix would buy a false sense of having
  addressed E-1.

What *is* adopted from the finding: the existence probe is promoted from a note
in "Risks" to a step in S1, with its output recorded in `verify.md` — which is
the alternative the senior lens offered.

#### R-2 — foreign keys on `user_roles` / `role_permissions` / `refresh_tokens`

Declined and stated, as `account_repository.go` already states for
`devices.account_id`: **this schema has no foreign keys anywhere**, and migration
52 records that as a deliberate property the account layer had to work around.
Introducing the first FK in the identity tables would give these tables delete
semantics no other table in the database has. The consequence is real and is
therefore written down instead: a grant can dangle at a deleted role, so
`BootstrapAdmin` runs **after** `SeedIdentity` and grants a role the seeder has
just written in the same boot.

#### R-3 — adding `idx_refresh_tokens_user`, or deferring `idx_refresh_tokens_family`

Both are declined for the same reason: **AC-1 pins the slice length at exactly
72** and AC-5 names the family index explicitly. Adding a twelfth migration or
dropping the eleventh fails an acceptance criterion. The performance lens is
right that migration 71 has no reader in this ticket; ticket 23, which adds the
reader, is the place to revisit it, and revisiting costs one appended migration.

#### R-4 — a boot-latency assertion for the seeder

Adopted as a **recorded number with a stated 300 ms ceiling**, not as a test
assertion. A wall-clock assertion against a remote database over the public
internet is not deterministic, and VP-3 requires validation commands to be.

### Corrections to revision 1

1. `accountOnes := migrations[50:]` would have failed **loudly**, not silently —
   line 48 length-checks it. The rescope is still required; the stated reason was
   wrong.
2. "Seven methods out of that interface's ~120" — `IChatStorageRepository`
   declares ~78. The number is dropped; the argument it supported was itself
   rejected (D1).
3. "`newTestDB` honours the chat-storage URI" is **false**. It reads
   `CHAT_STORAGE_TEST_POSTGRES_URI` and skips silently when unset, so revision
   1's PostgreSQL run could have proved nothing. The variable is now written into
   the validation command.

### E-1 — escalation: the identity tables land in a schema `anon` can read and write

**This is not a finding about this ticket's code, and this ticket does not fix
it. It is the most important thing the panel produced.**

The security lens observed that the new tables land in `public` on a shared
Supabase project. Probed against the live database on 2026-08-31, this is
confirmed and is **worse than theoretical**:

```
pg_default_acl, schema public:
  postgres → {anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}

role_table_grants, schema public:
  anon, authenticated → accounts, chats, devices, message_debug, messages
                        DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

pg_class.relrowsecurity: accounts=false chats=false devices=false messages=false
```

So every table this gateway creates is granted full DML to `anon` — the role
behind the project's public PostgREST endpoint — with row-level security
disabled. **This is already true today** for message content, chat history and
`devices.webhook_secret`; it is a pre-existing property of the deployment, not
something this ticket introduces. What this ticket changes is the *stakes*: it
adds `users.password_hash` and `refresh_tokens.token_hash` to the same set.

It is not fixed here because the remedy is a privilege change against a
production database, which is outside this ticket's scope, is not portable to
SQLite (so it cannot be a migration), and is the owner's call. The remedy, for
the owner:

```sql
-- run once, against the project, for the gowa tables:
REVOKE ALL ON TABLE users, roles, permissions, role_permissions,
                    user_roles, refresh_tokens,
                    accounts, devices, chats, messages, message_debug
  FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
```

`service_role` and the `postgres` role the gateway connects as are unaffected, so
the application keeps working unchanged.

**Update, 2026-08-31 — approved, not applied.** The owner approved this
remediation. Applying it from this session was blocked by the environment's
safety classifier, which refuses writes to a production database, so it is handed
over as SQL rather than executed. The full enumeration done at that point also
showed the finding is **broader than the sample above**: all 29 tables in
`public` are exposed, including the whatsmeow Signal-protocol session and
identity keys — not only message content and `devices.webhook_secret`. See
`verify.md > Escalation` for the measurement, the complete statement set, and the
ordering that matters (step 1 before this build first boots).
