---
ticket: z8pmx9m6aj
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-09-01
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6aj"
  github: ""
---

# Plan — 26 · User and account administration (revision 2, after the advisory panel)

Revision 1 was reviewed by the three lenses (`senior-reviewer`, `security-reviewer`,
`performance-reviewer`) **against the source**, not against its own prose. They
returned **31 findings, 11 of them major**. The `Panel response` section at the end
records every finding and its disposition.

Four findings changed the design outright, and one of them would have stopped the
build:

- **Seven new `IChatStorageRepository` methods would not compile.**
  `infrastructure/whatsapp/chatstorage_wrapper.go` delegates the *entire* interface
  and mirrors all eleven identity methods; its own comment says a new repository
  method "is invisible to any caller holding the wrapper until it is mirrored here."
  Revision 1 did not list that file at all.
- **A `users.manage` holder could escalate to full administrator.** Revision 1's
  lockout guard protected the *removal* of `users.manage` and said nothing about its
  *grant*: a caller could assign themselves `admin`, or simply reset the
  administrator's password and log in as them. Roles are rows precisely so an
  operator can compose a "supervisor" that holds `users.manage` without holding
  `messages.send` — for that role the endpoint was a privilege-escalation primitive.
- **The PATCH body could not tell "absent" from "empty".** Only `Roles` was a
  pointer while the UPDATE bound `account_id = ?` unconditionally, so a status-only
  PATCH would have **blanked the account** — manufacturing precisely the
  owns-nothing principal AC-13 exists to forbid. The same hole defeated AC-14: the
  lockout count filters `status = 'active'` while the guard triggered only on the
  literal `'disabled'`, so any third status value removed the last administrator
  silently.
- **The rollback story was false.** Revision 1 offered `AUTH_BOOTSTRAP_ADMIN` as the
  recovery path for a lost administrator. `usecase/identity.go:147-151` skips the
  bootstrap whenever `CountUsers() > 0`, so it **cannot** fire against a populated
  table. There is no API-level recovery at all, which turns the last-admin guard from
  a nicety into the only thing standing between a mistyped id and a deployment that
  can be repaired only with direct database access.

Two further claims of revision 1 were **factually wrong** and are corrected below:
`Refresh` does not revoke a family on an epoch mismatch (only on a status change or a
missing principal), and the planned "read the permission union back from the rebuilt
cache" is not reachable — `IAuthUsecase` exposes no lookup by user id.

## Approach

Mirror the account layer exactly, because it is the surface this one is a sibling of:
a domain type that **cannot** carry the secret, a usecase interface the handler talks
to instead of the repository, explicit error mapping, and an audited actor carried on
the context. Four things are genuinely new, and each is where the risk lives:

1. **One transaction spanning two tables** — the account row, the user row and the
   role grants, committed together or not at all.
2. **The epoch bump and the cache rebuild** — the two halves of "the change takes
   effect on the next request". The bump is in-transaction; the rebuild cannot be.
3. **The privilege ceiling** — no caller may grant, or reach, a permission they do
   not themselves hold.
4. **The lockout interlock** — the surface must not be able to remove the last
   principal who can use it, because nothing can put one back.

### Decision 1 — the transaction boundary, and what is deliberately outside it

Hashing runs **before** `Begin()`. bcrypt at cost 12 is ~250–400 ms of CPU and SQLite
serialises writers deployment-wide: hashing inside the transaction would stall every
other write in the process — message storage included — for the length of an
administrator's form submission. Validation runs before that, so a rejected request
never pays the hash.

**The hash goes through `auth.WithVerifySlot`** (adopted from two lenses).
`pkg/auth/throttle.go` states the rule in terms: *"EVERY bcrypt call on a request
path goes through here"*, because this process also runs the whatsmeow event
goroutines and unbounded bcrypt starves message handling rather than merely slowing
logins. `ErrVerifyBusy` maps to 503, exactly as `authError` already renders
`ErrBusy`.

The transaction is therefore short and contains only statements:

```
BEGIN
  (a) inline account given: INSERT INTO accounts    (already exists -> 409)
      else:                 does the named account exist? (no -> 404)
  (b) is the username taken? is the email taken (when non-empty)?  -> 409
  (c) do all the named roles exist?                                -> 404
  (d) INSERT INTO users ... ON CONFLICT(username) DO NOTHING       -> 0 rows = 409
  (e) INSERT INTO user_roles, one row each, ON CONFLICT DO NOTHING
COMMIT
```

Step (b) is a **pre-check for a clean 409**, not the guard. The guard is (d)'s
conflict clause, which is in SQL and therefore race-free. The pre-check exists
because a raw unique violation on PostgreSQL **aborts the transaction**, so without it
a duplicate would surface as an opaque 500.

`ON CONFLICT ... DO NOTHING` does not abort a PostgreSQL transaction, which is why (d)
can report a duplicate and still roll back cleanly.

**Email is the residual race** (adopted, security lens): `ON CONFLICT(username)`
cannot cover the *partial* unique index on `email` (migration 64,
`WHERE email <> ''`), so two concurrent creates with the same address produce a raw
unique violation. `isUniqueViolation(err)` — a documented string match covering
lib/pq's `duplicate key value violates unique constraint` and both SQLite drivers'
`UNIQUE constraint failed` — maps it to 409 on the way out. The match is
deliberately *conservative*: a miss degrades to a 500, which is the safe direction,
never to a wrongly-successful create.

### Decision 2 — the epoch bump is in the same statement as the change

Every update is one statement whose SET list is **built from the fields actually
present** (adopted, security lens — see Decision 6):

```sql
UPDATE users
   SET <only the mentioned columns>, token_epoch = token_epoch + 1, updated_at = ?
 WHERE user_id = ?
```

`token_epoch + 1` is read-modify-write **inside the engine**, so two concurrent
PATCHes cannot both read 3 and both write 4. A role change writes `user_roles` and
bumps the epoch in the **same transaction**: a crash between them would leave a stale
token valid.

A **password change** bumps the epoch *and* revokes the user's refresh families. That
is beyond the letter of AC-4 and AC-7, it is one extra statement in a transaction that
is already open, and the senior lens's advice was to accept it explicitly rather than
leave it an unrecorded deviation — so it is accepted here: a password change whose old
sessions keep working is not a password change.

### Decision 3 — the cache rebuild, and the exposure it really leaves

`AuthService.ReloadPrincipals()` is the only way the in-memory cache learns anything;
`domains/auth/interfaces.go` says so in as many words. It is called **after commit** —
before commit it would publish a change that may still roll back.

Revision 1's justification for failing open was **wrong on the facts**, and the
corrected version is what is being accepted:

| change | what actually happens if the reload fails |
|---|---|
| status → disabled | `Verify` still admits the access token until it expires (≤ 15 min). The next `Refresh` **does** revoke the whole family — `usecase/auth.go:360-365` reads the row authoritatively and calls `revokeFamily`. |
| roles / account | `Verify` still admits the old token until it expires. `Refresh` does **not** revoke — `:367-376` retries the reload and returns **500** if it fails again. It self-heals on the next successful reload. |
| delete | `Refresh` fails at `GetUserByUserID` (`:344`) and returns 401 without revoking; the access token survives to expiry. |

So the honest statement of AC-4's "no 15-minute window" is: **the window is closed
whenever the reload succeeds, and bounded by the access-token TTL when it does not.**

Given that, the reload is **retried once** and its failure is **surfaced**, not
swallowed (adopted, security lens): logged at ERROR, and reported in the response so
the operator learns the change is committed but not yet enforced everywhere.
Returning 500 was rejected — the write has already happened, and telling an
administrator their operation failed when it succeeded sends them to retry a completed
destructive change.

`verify.md` must state this divergence rather than claiming AC-4 unconditionally.

### Decision 4 — the privilege ceiling (new; security lens, major)

**The resolved new permission set must be a subset of the caller's own.** Enforced on
`Create` (the roles granted), on `Update` (the roles assigned), and on
`ChangePassword` and `Delete` (the *target's* permissions must be a subset of the
caller's — otherwise a supervisor resets the administrator's password and logs in as
them, which is the same escalation by another route).

Today this can never trigger: `users.manage` lives only in the `admin` role, which
holds the whole catalogue, so every subset test passes. It is written for the case the
schema deliberately allows — roles are rows so an operator can compose a third
(`pkg/auth/perm.go:80-86`) — and without it the first composed role turns this
endpoint into a privilege-escalation primitive.

Additionally, **self-delete and self-disable are refused** (`ErrSelfMutation`). Self
*role* change stays allowed: the subset rule means it can only ever narrow, and
Decision 5 catches the narrowing that would lock everyone out.

### Decision 5 — the lockout interlock

`DELETE`, **any** status transition away from `active` (corrected — not the literal
`'disabled'`), and any role write are the same question: *would this leave zero active
principals holding `users.manage`?*

It is **one repository helper** called by all three paths (adopted, senior lens),
written as a **conditional statement** in the shape `ClaimRefreshToken` established —
a predicate in SQL, `RowsAffected() == 0` meaning refused — rather than a read
followed by a write:

```sql
DELETE FROM users
 WHERE user_id = ?
   AND EXISTS (SELECT 1 FROM users u2
                 JOIN user_roles ur       ON ur.user_id = u2.user_id
                 JOIN role_permissions rp ON rp.role_id  = ur.role_id
                WHERE rp.permission_id = ? AND u2.status = 'active'
                  AND u2.user_id <> ?)
```

**Accepted residual risk** (security lens, minor): on PostgreSQL at READ COMMITTED two
*concurrent* removals of two *different* administrators can each see the other as
still active and both commit. Closing it needs `FOR UPDATE` (no SQLite equivalent —
it would break NFR-5) or SERIALIZABLE with retry, and `dbHandle.Begin()` exposes no
isolation option. It is documented rather than fixed: SQLite, the default deployment,
serialises writers and is unaffected; the window requires two administrators being
removed in the same instant by two different callers. **Flagged for the owner.**

Because `AUTH_BOOTSTRAP_ADMIN` cannot fire against a populated table
(`usecase/identity.go:147-151`), this guard is not optional — it is the only
protection against an unrecoverable state. **Open question 3 is answered: the guard
stays.**

### Decision 6 — the PATCH body is all pointers

Every field of `UpdateUserRequest` is a pointer, and the UPDATE's SET list is built
from the fields actually present. With value fields the handler cannot tell "the
operator did not mention `account_id`" from "the operator sent `account_id: ''`", so a
status-only PATCH would blank the account. Revision 1 also dropped `email` from the
UPDATE entirely; the dynamic SET list fixes both. An **empty** PATCH is refused rather
than treated as a no-op, because every non-empty one logs the user out.

### Decision 7 — where the errors live, and what the response carries

**Repository-returned sentinels move to `domains/chatstorage/interfaces.go**`
(adopted, senior lens), beside `ErrAccountNotFound`: `infrastructure/chatstorage`
imports no `domains/auth` today and must not start. Only the usecase-level refusals —
`ErrAccountRequired`, `ErrPrivilegeEscalation`, `ErrSelfMutation` — stay in
`domains/auth`.

**The admin response drops `Permissions` entirely** (adopted, senior lens). Revision 1
planned to read the union back from the rebuilt cache; `IAuthUsecase` exposes no
lookup by user id, so that required either an unlisted interface method or a type
assertion to `*usecase.AuthService`. Computing the union in the repository instead
would be a **second implementation** of `BuildPrincipals`. Neither is worth it: AC-3's
union is observable exactly where TC-4 already asserts it — `GET /auth/me` — so the
administration surface returns `roles` and leaves permissions to the endpoint whose
job they are.

### Decision 8 — file naming, and one collision with the ClickUp plan

The ClickUp plan lists `src/validations/user_validation.go` *(new)*. **That file
already exists** — it validates the WhatsApp *profile* surface, an unrelated noun that
happens to share the word. Same for `src/usecase/user.go` and `src/ui/rest/user.go`.
Everything this ticket adds is therefore named `user_admin*`.

The wire type is `UserAdminView`, not `User` (adopted, senior lens): a third `User` in
a tree that already has `domains/chatstorage.User` and the `domains/user` package
would be the ambiguity this naming discipline exists to avoid. It sits beside the
existing `UserView` and reads as its sibling, which is what it is — one projects a
*principal*, the other a *row*.

## Steps

1. **`src/domains/auth/user_admin.go`** *(new)* — `UserAdminView` (**no**
   `password_hash` field, so AC-7 holds by construction), `CreateUserRequest`,
   `AccountSpec`, `UpdateUserRequest` (all pointers), `ChangePasswordRequest`, and the
   usecase-level sentinels. The two password-bearing request types get a redacting
   `MarshalJSON` **and** `String()` (adopted, security lens): NFR-4's real threat is
   not a deliberate log statement, it is a `%v` on the request in an error path added
   later — `fmt` does not consult `MarshalJSON`, so both are needed.
2. **`src/domains/auth/user_admin_interfaces.go`** *(new)* — `IUserAdminUsecase`, six
   methods. `List` is **bounded** (`limit`, `offset`, default cap) — adopted from the
   performance lens: this is the ticket that turns `users` from the "tens of rows" the
   principal cache assumes into a table an operator grows.
3. **`src/domains/chatstorage/interfaces.go`** *(modify)* — seven method declarations
   plus the repository sentinels (Decision 7).
4. **`src/infrastructure/chatstorage/user_admin_repository.go`** *(new)* — every
   transactional statement, in one file. Reuses `normalizeUsername`, `errBlankUserID`
   and the rebinding handles; each statement written once in `?` form (NFR-5).
   `ListUsers` reads roles as **one flat `user_roles` scan joined in Go**, not one
   query per user (adopted, performance lens — the shape `scanSnapshotPairs` already
   uses). No read selects `password_hash`.
5. **`src/infrastructure/whatsapp/chatstorage_wrapper.go`** *(modify)* — **seven
   pass-through delegations.** Without this the build fails (senior lens, major).
6. **`src/usecase/user_admin.go`** *(new)* — validate → subset check → hash under a
   verify slot → one repository call → reload (retry once) → audit log → project.
   Carries `userAdminContext` built on the existing `ContextWithAccountActor`, so
   AC-12's actor reaches the log the way the account layer's does (adopted, security
   lens — revision 1 named no implementing step for AC-12).
7. **`src/ui/rest/user_admin.go`** *(new)* — six routes, each with
   `middleware.Require(pkgAuth.PermUsersManage)` as the **first** handler, plus
   `userAdminError` in the shape of `accountError`.
8. **`src/validations/user_admin_validation.go`** *(new)* — the patterns; the password
   bounded in **bytes** against `pkgAuth.MinPasswordLength`/`MaxPasswordLength` and
   validated **outside** the ozzo struct call (adopted, security lens: ozzo counts
   *runes*, so a 72-rune multibyte password would pass and then fail inside
   `HashPassword` as an unmapped 500).
9. **`src/infrastructure/chatstorage/sqlite_repository.go`** *(modify)* — **migration
   73**, `idx_refresh_tokens_user` (adopted, performance lens, major). AC-5's revoke is
   `WHERE user_id = ?` and no index led with that column, making it a full scan of the
   largest identity table inside a write transaction. NFR-1 is amended: one additive
   `CREATE INDEX IF NOT EXISTS`, no data migration.
10. **`src/cmd/rest.go`** *(modify)* — construct the service in `restServer` (it needs
    the `AuthService`, a local at `cmd/rest.go:55`) and register the group
    **immediately after `InitRestAuth`** (adopted, senior lens), which is already above
    `headerDeviceGroup` and below `app.Use(Authenticate)`, and keeps `/auth` in one
    place.
11. **Tests** — the fourteen cases in `spec.md`, plus the three the panel added:
    TC-7 becomes **table-driven over all six routes asserting 401 for an anonymous
    caller as well as 403 for a `user` token** (adopted, security lens: coverage.go's
    `hasGuard` scans the whole handler slice and is **order-blind**, so it cannot prove
    "Require is first" — a trailing guard would boot green and leave all six routes
    reachable with no token at all).

## Files to change

**New**

- `src/domains/auth/user_admin.go`
- `src/domains/auth/user_admin_interfaces.go`
- `src/infrastructure/chatstorage/user_admin_repository.go`
- `src/infrastructure/chatstorage/user_admin_repository_test.go`
- `src/usecase/user_admin.go`
- `src/usecase/user_admin_test.go`
- `src/ui/rest/user_admin.go`
- `src/ui/rest/user_admin_test.go`
- `src/ui/rest/user_admin_e2e_test.go`
- `src/validations/user_admin_validation.go`
- `src/validations/user_admin_validation_test.go`

**Modified**

- `src/domains/chatstorage/interfaces.go` — seven declarations + sentinels.
- `src/infrastructure/chatstorage/sqlite_repository.go` — migration 73.
- `src/infrastructure/chatstorage/sqlite_repository_account_test.go`,
  `sqlite_repository_debug_test.go`, `user_repository_test.go` — the three
  migration-count assertions, which are written to be updated when one is appended.
- `src/infrastructure/whatsapp/chatstorage_wrapper.go` — seven delegations.
- `src/cmd/rest.go` — construction + registration.
- `docs/openapi.yaml` — the six endpoints. **Confirmed yes**: the file already
  documents `/auth/login`, `/auth/refresh`, `/auth/logout` and `/auth/me` (lines
  91–203) and `/accounts` (line 531).

`src/cmd/root.go` and `src/cmd/helpers.go` are **not** modified — the conditional
entries of revision 1 are resolved (senior lens, minor): construction is
`restServer`-only.

**Not touched**: every deployment runtime file, `pkg/auth` (CON-1), and the unrelated
WhatsApp profile surface (`ui/rest/user.go`, `usecase/user.go`,
`validations/user_validation.go`).

## Validation strategy

- `go build ./...`, `go vet ./...`, `go test ./...` from `src/`, compared
  **mechanically** against the baseline captured on the unmodified tree first: 3
  failing packages, 139 distinct leaf failures, all traced to `CGO_ENABLED=0` with no
  C compiler plus one Windows MIME-registry quirk.
- `middleware.PolicyCoverageViolations` asserted empty (AC-6), **plus** the
  table-driven 401/403 probe over all six routes, which is what actually pins guard
  ordering.
- A response-body scan across every endpoint for `password_hash`, `token_hash`,
  `refresh_token` (AC-10), **and** a log-line assertion that no audit line carries a
  password (NFR-4).
- Mutation testing on the guards that matter: invert the subset check, invert the
  last-admin predicate, drop the epoch bump, drop the `ReloadPrincipals` call, remove
  the rollback, make the PATCH bind `account_id` unconditionally — each must make a
  named test fail.

## Rollback

`git revert` of the single commit. Migration 73 is `CREATE INDEX IF NOT EXISTS`: it
backfills nothing and rewrites no row, so a revert leaves an unused index behind and
nothing else. Any user created through the API survives and stays usable by the
previous binary's login path (ticket 23); only the administration endpoints disappear.

**Corrected** (senior lens, major): `AUTH_BOOTSTRAP_ADMIN` is **not** a recovery path
for a lost administrator — `usecase/identity.go:147-151` skips it whenever the users
table is non-empty. A deployment that loses its last `users.manage` holder can be
repaired only by direct database access. That is precisely why Decision 5's interlock
ships.

## Out of scope

As `spec.md § Out of scope`. In particular no role **authoring** API, no self-service
password change, no API keys, and no change to `/accounts`.

---

# Panel response

31 findings. **24 adopted**, **4 declined with reasons**, **3 answered as correct as
planned**. Two of this plan's own factual claims were wrong and are corrected above.

## Adopted

**Senior lens**

1. *(major)* `chatstorage_wrapper.go` delegates the whole interface — seven new
   methods break the build. Added to Files to change (Step 5).
2. *(major)* Repository sentinels belong in `domains/chatstorage`, not `domains/auth`.
   Decision 7.
3. *(major)* The "permission union from the rebuilt cache" is unreachable through
   `IAuthUsecase`. `Permissions` dropped from the admin response. Decision 7.
4. *(major)* The `AUTH_BOOTSTRAP_ADMIN` rollback path does not exist. Rollback
   corrected; Open question 3 answered — the guard stays.
5. *(minor)* Conditional entries in Files to change. Resolved: `restServer`-only
   construction; `openapi.yaml` confirmed yes.
6. *(minor)* Register the new group immediately after `InitRestAuth`, keeping `/auth`
   in one place. Step 10.
7. *(minor)* Password change also revoking families is beyond AC — accept it
   explicitly rather than leave it unrecorded. Decision 2.
8. *(info)* Express the last-admin guard as **one** repository helper, not inlined at
   three call sites. Decision 5.
9. *(info)* Name the wire type `UserAdminView`, matching the plan's own `user_admin*`
   discipline. Decision 8.

**Security lens**

10. *(major)* Privilege escalation — nothing forbade granting a role wider than the
    caller's own, or resetting the administrator's password. Decision 4.
11. *(major)* The PATCH DTO cannot distinguish absent from empty; a status-only PATCH
    blanks `account_id`, and the UPDATE dropped `email`. Decision 6.
12. *(major)* The same hole defeats AC-14 — the guard triggered on the literal
    `'disabled'` while the count filters `status = 'active'`. Decision 5 now triggers
    on **any** transition away from `active`, and status is validated against the
    closed list before the transaction.
13. *(major)* Fail-open reload contradicts AC-4/AC-15. Retry once, surface the failure,
    state the divergence honestly in `verify.md`. Decision 3.
14. *(minor)* **This plan's claim about `Refresh` was wrong.** Corrected in the
    Decision 3 table against `usecase/auth.go:360-376`.
15. *(minor)* Email uniqueness is a genuine TOCTOU. `isUniqueViolation` maps it to 409.
    Decision 1.
16. *(minor)* bcrypt outside `WithVerifySlot`. Adopted — Decision 1.
17. *(minor)* Password bound as runes vs bytes. Bounded in bytes. Step 8.
18. *(minor)* NFR-4 has no enforcing mechanism. Redacting `MarshalJSON` + `String()`,
    password validated outside the ozzo call, log-line assertion in TC-13. Step 1.
19. *(minor)* AC-6's "first handler" is not provable by `PolicyCoverageViolations`,
    which is order-blind. Table-driven 401/403 probe. Step 11.
20. *(minor)* AC-5's revocation must be in the delete's own transaction, not a second
    one. Moved inside `DeleteUser`.
21. *(minor)* AC-12 had no implementing step. `userAdminContext` added. Step 6.
22. *(info)* The inline `AccountSpec` had no stated validation. It now goes through the
    same `ValidateAccountID` the account layer uses.

**Performance lens**

23. *(major)* No index on `refresh_tokens(user_id)`. Migration 73. Step 9.
24. *(minor)* `ListUsers` N+1. One flat `user_roles` scan joined in Go. Step 4.
25. *(minor)* `GET /auth/users` unbounded. `limit`/`offset` with a default cap. Step 2.

## Declined, with reasons

26. *(performance, major)* **Debounce/coalesce `ReloadPrincipals`.** Declined: a
    drop-if-pending trigger goroutine makes the rebuild *asynchronous*, and AC-15
    requires a committed write to be visible to the **next** request. Coalescing would
    trade the acceptance criterion for a cost that only appears under scripted bulk
    creation — an operator-rate surface behind `users.manage`. The O(N²) shape is
    recorded here as a known property, to be revisited if a bulk-import endpoint is
    ever added.
27. *(performance + security, minor)* **A rate limiter on the two hashing routes.**
    Declined. `throttle.go:14-24` argues the case itself: the limiter is "necessary and
    NOT sufficient", it is keyed on a network address that costs an attacker nothing,
    and the semaphore "is the bound that does not depend on any of that". These routes
    additionally sit behind `Require(users.manage)` — the caller is an authenticated
    administrator, not an anonymous flood — and a 10/minute bucket would break
    legitimate bulk provisioning from one console. The verify slot is adopted; the
    limiter is not.
28. *(performance, minor)* **A single-flight/backoff around the fail-open reload
    amplification.** Declined as scope: it is a property of ticket 23's `Login` and
    `Refresh` paths, not of anything this ticket adds, and fixing it here would mean
    editing the authentication service's hot path in a user-administration ticket.
    Recorded for a follow-up.
29. *(senior, minor)* **Keep `CreateUser`'s `(bool, error)` contract for
    `CreateUserWithAccount`.** Declined. The bool exists because the *bootstrap* path's
    correct response to a duplicate is "another replica won the race, carry on"; the
    administration path's correct response is a 409 that tells the operator **which**
    field collided — which a single bool cannot express. The two contracts differ
    because the two callers genuinely differ, and the interface doc will say so.

## Answered as correct as planned

30. *(security, minor)* Last-admin write-skew on PostgreSQL at READ COMMITTED. Real,
    and unfixable without dialect-specific SQL (`FOR UPDATE` has no SQLite equivalent)
    or an isolation option `dbHandle.Begin()` does not expose. Documented as an
    accepted residual risk in Decision 5 and **flagged for the owner**.
31. *(security + performance, info)* No deployment runtime file is touched; no
    `:device_id` route is added, so ticket 25's ownership assertion is unaffected; no
    query is added to any request path, so ticket 23's zero-query `Verify` holds.
    Confirmed — no action.

## Acceptance criteria amended by the panel

- **AC-14** is widened: the interlock triggers on **any** status transition away from
  `active`, not on the literal `disabled`. (Security lens, major.)
- **AC-4/AC-15** are stated honestly: the window is closed whenever the cache reload
  succeeds and bounded by the access-token TTL when it does not, with the failure
  surfaced rather than swallowed. (Security lens, major.)
- **NFR-1** is amended from "no schema change" to "one additive
  `CREATE INDEX IF NOT EXISTS`; no data migration". (Performance lens, major.)
- **AC-16** is added: no caller may grant, or reach through a password reset or a
  delete, a permission they do not themselves hold; and no caller may delete or
  disable their own user. (Security lens, major — Decision 4.)

All four are flagged for the owner to overrule.
