---
ticket: z8pmx9m6aj
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-09-01
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6aj"
  github: ""
---

# Specification — 26 · User and account administration

## Business goal

Tickets 22–25 built an identity layer that nobody can populate. There is a `users`
table, a role/permission catalogue, a login endpoint, an enforcement guard and a
scoping rule — and exactly **one** way to create an identity: the
`AUTH_BOOTSTRAP_ADMIN` environment variable, which fires once, only on an empty
table, and produces a single administrator with a **blank** `account_id`.

That administrator can create accounts and attach devices, but cannot create a second
person. So today a deployment either has one god-user or it has nobody, and the
tenant isolation ticket 25 shipped has no tenants to isolate: the only principal in
the system holds `accounts.manage`, which `MayAddressDevice` grants every device by
definition.

This ticket closes the loop. It adds the administration surface that turns the
identity layer into something an operator can actually run a business on: create an
account and its first user in **one** call, assign roles, change a password, disable
or delete a user, and have every one of those changes take effect on the **next**
request rather than at the next token expiry.

It is the ticket whose acceptance criteria describe the end-to-end outcome the whole
programme exists to deliver.

## User story

As the operator of a gateway that fronts several customers' WhatsApp numbers, I want
to log in as the bootstrap administrator and create a customer's account together
with its first user in a single atomic call, give that user a role, and attach a
device to the account — so that the customer's user can log in and see exactly their
own account's devices and chats, cannot send, and cannot read the diagnostic fields
their role does not carry.

## Functional requirements

- **REQ-1** — `POST /auth/users` creates one user. It accepts **either** an existing
  `account_id` **or** an inline account definition to create in the same request.
  Both rows are committed together or neither is written.
- **REQ-2** — A full CRUD surface exists: list, get, update, delete, plus a dedicated
  password-change endpoint.
- **REQ-3** — Roles are assigned through the `user_roles` table. A user may hold more
  than one, and the effective permission set is the **union** of their roles' grants.
- **REQ-4** — Any change to a user's roles, account, status or password **bumps**
  `token_epoch`, and the bump is committed in the **same transaction** as the change
  that motivates it.
- **REQ-5** — After any committed identity write the in-memory principal cache is
  rebuilt, so the change is visible to the very next request rather than at the next
  process restart.
- **REQ-6** — `DELETE /auth/users/:user_id` revokes **every** refresh-token family
  belonging to that user, in the same transaction as the delete.
- **REQ-7** — Every `/auth/users/*` route requires `users.manage` and carries
  `middleware.Require(...)` as its **first** handler, so `AssertPolicyCoverage`
  passes at boot.
- **REQ-8** — A password may be set at creation and replaced through a dedicated
  endpoint. It is always bcrypt-hashed at the catalogue's cost, and no type this
  surface returns has a field capable of carrying the hash.
- **REQ-9** — `users.account_id` is **not** unique. Two users created in the same
  account both see that account's devices, differing only by role.
- **REQ-10** — A user cannot be created in an account that does not exist (404), and
  a username or email already in use is a conflict (409).
- **REQ-11** — Every mutating call is audit-logged with the acting principal's
  `user_id`, matching the account layer's existing convention.
- **REQ-12** — The administration surface cannot lock the deployment out of itself:
  the last **active** principal holding `users.manage` cannot be deleted, disabled,
  or stripped of that permission.

## Non-functional requirements

- **NFR-1** *(amended by the advisory panel)* — **One additive index and no data
  migration.** `AC-5`'s revoke is `WHERE user_id = ?` and no index led with that
  column, so migration 73 appends `idx_refresh_tokens_user`. `CREATE INDEX IF NOT
  EXISTS` backfills nothing and rewrites no row; rollback is `git revert` of one
  commit, leaving an unused index behind, and the previous binary keeps working
  against the same rows.
- **NFR-2** — bcrypt hashing (~250–400 ms at cost 12) never runs while a database
  write transaction is open. SQLite serialises writers deployment-wide; a hash inside
  the transaction would stall every other write for the duration.
- **NFR-3** — No additional query on any request path. The administration endpoints
  are operator-rate, but the principal cache they rebuild is read by every
  authenticated request, and that read must stay a single atomic pointer load.
- **NFR-4** — No response body, log line, or error message anywhere in this surface
  contains a password, a password hash, a refresh token, or a token digest.
- **NFR-5** — Both storage engines. Every statement is written once in SQLite `?`
  form and passes through the rebinding handle; no dialect-specific SQL.
- **NFR-6** — The new routes carry no `:device_id` and add no device-scoped surface,
  so ticket 25's ownership assertion is unaffected.

## Constraints

- **CON-1** — `pkg/auth` is a documented **leaf** (it imports nothing from this
  repository). Nothing this ticket adds may give it a repository dependency.
- **CON-2** — A handler never holds an `IChatStorageRepository`. The REST layer talks
  to a usecase interface, the shape `domainAccount.IAccountUsecase` established.
- **CON-3** — Error mapping is **explicit**, never `utils.PanicIfNeeded`:
  `middleware.Recovery` renders an unrecognised error as `%v`, which on this surface
  would quote schema and bound values — including a username — back to the caller.
- **CON-4** — The routes must be registered **above** the header device group
  (`apiGroup.Group("", DeviceMiddleware)`), which in Fiber v3 installs its middleware
  for every route registered after it. Registered below, user administration would
  fail with `DEVICE_ID_REQUIRED`.
- **CON-5** — `''` is a load-bearing sentinel meaning **no account** and never "every
  account". A user created through this API must carry a real account id.
- **CON-6** — No deployment runtime file is touched.

## Acceptance criteria

- **AC-1** — `POST /auth/users` creates a user, accepting either an existing
  `account_id` or an inline account definition; both the account and the user are
  committed together or neither is.
- **AC-2** — `GET /auth/users`, `GET /auth/users/:user_id`,
  `PATCH /auth/users/:user_id` and `DELETE /auth/users/:user_id` exist and behave
  conventionally (200 / 200 / 200 / 200, and 404 after a delete).
- **AC-3** — Roles are assigned through `user_roles`; a user may hold more than one,
  and effective permissions are the **union** of their roles' grants.
- **AC-4** — Changing a user's roles, account or status **bumps** `token_epoch`, and
  every outstanding access token for that user is rejected on its next request — no
  15-minute window.
- **AC-5** — `DELETE /auth/users/:user_id` revokes every refresh-token family
  belonging to that user; neither an outstanding refresh token nor an outstanding
  access token survives.
- **AC-6** — All `/auth/users/*` routes require `users.manage`, carry `Require(...)`
  as the first handler, and `AssertPolicyCoverage` reports no violation.
- **AC-7** — A password can be set at creation and changed through a dedicated
  endpoint; it is always bcrypt-hashed, and `password_hash` is **absent from the
  administration `User` type itself**, not merely omitted at serialisation.
- **AC-8** — `users.account_id` is not unique: two users can be created in the same
  account and both resolve to that account's device set.
- **AC-9 (end-to-end)** — Starting from an empty `users` table: boot with
  `AUTH_BOOTSTRAP_ADMIN`; log in as that admin; create account `acme` with user
  `sara` (role `user`); attach a device to `acme`; log in as `sara`; `GET /devices`
  returns only `acme`'s device; `GET /chats` succeeds; `POST /send/message` returns
  **403**; `GET /chat/:jid/messages` contains **no** `transcript` and **no**
  `metadata_debug`.
- **AC-10** — No endpoint on this surface returns `password_hash`, a refresh token,
  or a token hash, under any input.
- **AC-11** — A user cannot be created in a non-existent account (404); a duplicate
  username is a 409.
- **AC-12** — Every mutating call is audit-logged with the acting admin's `user_id`,
  matching the account-layer convention, and the log line carries no credential.
- **AC-13** *(added — closes ticket 25's carried-forward risk)* — A user created
  through this API must carry a **non-blank** `account_id`. A create that would
  produce a blank-account user is refused, so no user is ever created into the state
  where they own nothing and can never be given anything.
- **AC-14** *(added — REQ-12; widened by the advisory panel)* — The last active
  principal holding `users.manage` cannot be deleted, moved out of `active` by **any**
  status transition, or have that permission removed. The refusal is a conflict, and
  nothing is written. It is not optional: `AUTH_BOOTSTRAP_ADMIN` cannot fire against a
  populated `users` table, so a deployment that loses its last administrator is
  repairable only by direct database access.
- **AC-15** *(added — REQ-5)* — A committed identity write is visible to the **next**
  request without a restart: the principal cache is rebuilt after commit, and a role
  granted through `PATCH` is present in that user's next `GET /auth/me`. When the
  rebuild fails the write still stands, the failure is surfaced to the caller and
  logged at ERROR, and the stale window is bounded by the access-token TTL.
- **AC-16** *(added by the advisory panel — privilege ceiling)* — No caller may grant,
  or reach through a password reset or a delete, a permission they do not themselves
  hold; and no caller may delete or disable their own user. Refused with 403, nothing
  written.

## Test cases

- **TC-1 (AC-1, AC-13)** — `POST /auth/users` with an inline account definition →
  201-equivalent success; both rows exist. Then a create whose **user insert fails**
  (duplicate username) alongside a new account definition → the account row does
  **not** exist afterwards.
- **TC-2 (AC-1)** — `POST /auth/users` with an existing `account_id` → success, and
  no second account row is created.
- **TC-3 (AC-2)** — Exercise list, get, patch, delete in sequence → conventional
  status codes; `GET` of the deleted user returns 404.
- **TC-4 (AC-3)** — Grant a user both `user` and a custom role adding
  `messages.debug.read`; read the principal → the **union**, ten permissions, sorted
  and deduplicated.
- **TC-5 (AC-4, AC-15)** — `sara` holds a valid access token; PATCH her roles to
  `admin`; the **old** token is rejected on its next use, and a freshly-built
  principal carries admin permissions.
- **TC-6 (AC-5)** — `sara` has two active refresh families; delete her → both are
  revoked; neither refresh token can be rotated.
- **TC-7 (AC-6)** — A `user`-role token calling any `/auth/users` route → 403; the
  route set passes `PolicyCoverageViolations` with an empty result.
- **TC-8 (AC-7, AC-10)** — Create a user, list users, get one, change the password →
  `password_hash` appears in no response body; login works with the new password and
  fails with the old.
- **TC-9 (AC-8)** — Create `sara` and `omar` both in `acme` → both principals resolve
  to `acme` and both may address `acme`'s device.
- **TC-10 (AC-9)** — The full end-to-end sequence, exactly as written, including the
  403 on send and the absent diagnostic fields.
- **TC-11 (AC-11)** — Create in `does-not-exist` → 404; then a duplicate username →
  409; in both cases nothing is written.
- **TC-12 (AC-14)** — Delete the only administrator → conflict, nothing written;
  disable them → conflict; strip `admin` from their roles → conflict. Create a second
  administrator, then all three succeed.
- **TC-13 (AC-12)** — Every mutating call emits one audit line carrying the acting
  principal's `user_id` and no credential.
- **TC-15 (AC-16)** — A caller holding `users.manage` but not `messages.send` tries
  to grant a role that carries `messages.send` → 403, nothing written; tries to change
  the password of a principal holding it → 403; tries to delete their own user → 403.
- **TC-16 (AC-6)** — Table-driven over all six routes: an **anonymous** request →
  401, a `user`-role token → 403. This, not the order-blind coverage assertion, is what
  pins `Require` as the first handler.
- **TC-14** — `go build ./...`, `go vet ./...`, `go test ./...` from `src/`.

## Out of scope

- Self-registration, public signup, email verification, password reset by email.
- A user changing their **own** password without `users.manage` — the whole surface
  is administrative by AC-6; a self-service endpoint is a separate ticket.
- API keys for machine integrations (a second token type in `Authenticate`).
- Isolation **within** an account: users of one account are deliberately equal in
  data and differ only by role.
- Any change to the existing `/accounts` routes beyond what they already carry.
- Creating or editing **roles** themselves (`roles` / `role_permissions` rows). The
  two seeded roles plus any operator-composed row are assignable; composing a new one
  through the API is a later ticket. TC-4's custom role is inserted directly.
- The `gowa-ui` login screen — a separate repository.
