---
ticket: z8pmx9m6ae
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-08-31
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6ae"
  github: ""
---

# Specification — 22 · Identity foundation

## Business goal

The gateway authenticates with one flat list of basic-auth credentials. Every
credential is the same credential: there is no user, no role, no permission, and
therefore no way to say "this person may read their own chats but may not send",
or "this person may see the AI debug payload and that one may not". Tickets 23
through 26 build login, enforcement, device scoping and user administration on
top of that missing vocabulary.

This ticket ships the vocabulary and **nothing else**. Tables, repository
methods, the Go permission catalogue, an idempotent role seeder, password
hashing and the first-admin bootstrap. Basic auth stays installed and stays the
only enforcer for the length of this ticket. No route is added, removed or
protected differently.

It ships alone so that a schema problem is discovered on its own — on a shared
production PostgreSQL where eleven statements land in **one transaction** and a
single unportable one stops the server booting — rather than tangled with a
routing change.

## User story

As **an operator**, I want **the identity data layer to exist and be seeded
correctly before anything depends on it**, so that **the login and enforcement
tickets that follow are a routing change and not a schema gamble**.

## Functional requirements

- **REQ-1** The chat-storage schema gains the identity tables: `users`, `roles`,
  `permissions`, `role_permissions`, `user_roles`, `refresh_tokens`, and the
  indexes each of them needs.
- **REQ-2** Every new schema statement is **appended**, one statement per
  migration entry, and is valid on SQLite **and** PostgreSQL.
- **REQ-3** Ownership is expressed through the **account**, not through a second
  ownership axis: `users.account_id` mirrors `devices.account_id`, including its
  blank-string = *no account* sentinel. No `owner_user_id` column is added to
  `devices`.
- **REQ-4** A Go permission catalogue declares the complete permission set of the
  reference document section 06 as constants, together with each permission's
  description and the grant set of each seeded role.
- **REQ-5** Roles, permissions and role grants are **seeded from Go at boot** by
  an idempotent upsert — never inside a migration, because the catalogue evolves
  with the code and migrations are append-only.
- **REQ-6** Passwords are stored only as a bcrypt hash, and the hash is produced
  and verified by one pair of helpers used everywhere.
- **REQ-7** A refresh token is stored only as a hash, never in a form that a
  leaked backup turns into a live session.
- **REQ-8** `AUTH_BOOTSTRAP_ADMIN=user:pass` creates the first admin user, and
  only while the `users` table is empty.
- **REQ-9** Every new repository method is reachable through the same interface
  the rest of the storage layer is reached through, and through its per-device
  wrapper.

## Non-functional requirements

- **NFR-1** **Boot safety is the dominant property.** The realistic failure of
  this ticket is not a wrong answer, it is a server that does not start against
  the live PostgreSQL database. Every migration is written in a shape already
  proven on both engines by an existing migration.
- **NFR-2** **No HTTP behaviour change.** No route added or removed, no
  middleware changed, no handler changed, basic auth untouched.
- **NFR-3** **Secret containment.** The bootstrap credential never reaches
  stdout, a log line, `ps` output or shell history; the password hash never
  reaches a response body or a log; the refresh-token plaintext is never stored.
- **NFR-4** **Idempotence under restart and under concurrency.** Two boots
  against the same database — including two processes booting at once — leave
  identical rows and produce no error.
- **NFR-5** **No cost on any hot path.** The seeder runs once at startup, over a
  set of tens of rows. No per-request work is introduced by this ticket.
- **NFR-6** **Positional migration integrity.** The migration slice is
  index-positional (schema version *N* is `migrations[N-1]`); nothing may be
  inserted anywhere but the end.

## Constraints

- **C-1** One SQL statement per migration entry — `runMigration` executes a
  single statement and silently drops anything after a semicolon.
- **C-2** `postgresDDL` rewrites only `INTEGER PRIMARY KEY AUTOINCREMENT` and
  `BLOB`. Every other construct must be portable as written.
- **C-3** No deployment runtime file is touched.
- **C-4** `golang.org/x/crypto` is already in `go.sum` and in the module cache at
  the version the build resolves; no new dependency is downloaded.
- **C-5** The permission catalogue is **code**, the roles and grants are
  **data**: an admin must be able to compose a third role without a redeploy, but
  a permission no route knows about is meaningless.

## Acceptance criteria

- **AC-1** Migrations 62..72 are appended to `getMigrations()`; the slice length
  is exactly **72**; the schema applies cleanly on a fresh SQLite database and on
  PostgreSQL, and re-applying is a no-op.
- **AC-2** Table `users` exists with columns `user_id`, `username`, `email`,
  `password_hash`, `account_id`, `status`, `token_epoch`, `created_at`,
  `updated_at`; `account_id` is `VARCHAR(255) NOT NULL DEFAULT ''` mirroring
  `devices.account_id`; `token_epoch` is `INTEGER NOT NULL DEFAULT 1`.
- **AC-3** `UNIQUE INDEX idx_users_username ON users(username)` and the partial
  `UNIQUE INDEX idx_users_email ON users(email) WHERE email <> ''` both exist and
  both apply on SQLite and PostgreSQL; two users with a blank email do not
  collide, and a duplicate non-blank email is refused.
- **AC-4** Tables `roles`, `permissions`, `role_permissions` (primary key
  `role_id, permission_id`) and `user_roles` (primary key `user_id, role_id`)
  exist.
- **AC-5** Table `refresh_tokens` exists with `token_id`, `user_id`,
  `token_hash`, `family_id`, `expires_at`, `revoked_at`, `user_agent`,
  `created_at`, plus a `UNIQUE INDEX` on `token_hash` and indexes on `family_id`
  and `expires_at`.
- **AC-6** A Go permission catalogue exists under `src/pkg/auth/` declaring the
  **25** permission constants listed in section 06 of the reference document.
- **AC-7** At boot, roles `admin` and `user`, every catalogue permission, and
  their grants are upserted **idempotently**: booting twice against the same
  database produces identical table contents and no error.
- **AC-8** Role `admin` is granted all 25 permissions. Role `user` is granted
  exactly these 9: `chats.read`, `messages.read`, `messages.mark`,
  `devices.read`, `devices.create`, `devices.pair`, `contacts.read`,
  `groups.read`, `newsletters.read`.
- **AC-9** Passwords are hashed with `golang.org/x/crypto/bcrypt` at cost 12, and
  `golang.org/x/crypto` is promoted from `// indirect` to a direct requirement.
- **AC-10** `AUTH_BOOTSTRAP_ADMIN=user:pass` creates the first admin user only
  when the `users` table is empty; on a non-empty table it is a silent no-op. Its
  value never appears in a log line or in the startup settings dump.
- **AC-11** Every new repository method is declared in `IChatStorageRepository`,
  implemented on `*SQLiteRepository`, and delegated in `deviceChatStorage` —
  proven by the package compiling.
- **AC-12** No HTTP behaviour changes: `go build ./...`, `go vet ./...` and
  `go test ./...` pass; basic auth still guards every route exactly as before; no
  route is added or removed.

## Test cases

- **TC-1 (AC-1)** Fresh database, apply the schema, read `schema_info`: version
  is 72. Apply again: no error, version unchanged.
- **TC-2 (AC-1, AC-2..AC-5)** A database stopped at version 61, holding real
  rows, is upgraded: all eleven statements succeed, the version moves to 72, and
  the pre-existing rows are unchanged. Run against **PostgreSQL**, where the
  eleven land in a single transaction.
- **TC-3 (AC-1, NFR-6, C-1, C-2)** The appended slice `migrations[61:72]` holds
  exactly eleven entries, each one statement, none containing an `UPDATE`
  backfill or a construct PostgreSQL rejects; the pre-existing 61 are unchanged
  in their positions.
- **TC-4 (AC-3)** Insert two users with a blank email: both succeed. Insert a
  second user with an existing non-blank email: refused. Insert a second user
  with an existing username: refused.
- **TC-5 (AC-7, NFR-4)** Run the seeder twice against one database and compare
  the full contents of `roles`, `permissions` and `role_permissions`: identical,
  no error. Then mutate a seeded row's description and re-seed: the row is
  restored, and nothing else changes.
- **TC-6 (AC-6, AC-8)** Table-driven: the catalogue holds exactly 25 permissions,
  with no duplicate id; `admin` grants all 25; `user` grants exactly the 9 named.
  Adding a permission to the catalogue without granting it to `user` does not
  change the `user` set.
- **TC-7 (AC-9)** Hash a password, then verify it: verification succeeds, a wrong
  password fails, and the stored value carries the bcrypt cost-12 prefix.
- **TC-8 (AC-10)** Against an empty `users` table, bootstrap with `admin:secret`:
  one user row is created, with the `admin` role granted and a hash that
  verifies. Bootstrap again with a **different** password: no new row, no
  password change, no error. Bootstrap with a malformed value: refused with a
  message that does not contain the value.
- **TC-9 (AC-10, NFR-3)** The startup settings dump, with `auth_bootstrap_admin`
  set, contains neither the username nor the password.
- **TC-10 (AC-11, AC-12)** `go build ./...`, `go vet ./...`, `go test ./...`.
- **TC-11 (AC-12)** The route table before and after the change is identical, and
  no basic-auth guard is touched — established by diff, since a route change in
  this ticket would be a scope violation, not a test failure.
- **TC-12 (NFR-4)** Two seeders run concurrently against one database: both
  return without error and the resulting rows are the seeded set exactly once.

## Out of scope

- Any HTTP route, middleware or handler change — including touching basic auth.
- Token issuing and verification (ticket 23).
- Enforcement, redaction, device scoping (tickets 24, 25).
- The user-administration API (ticket 26).
- Deployment runtime files.
