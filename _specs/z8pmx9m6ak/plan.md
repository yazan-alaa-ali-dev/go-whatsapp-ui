---
ticket: z8pmx9m6ak
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-09-02
links:
  clickup: ""
  github: ""
---

# Plan — 27 · Tenant isolation: a super-admin tier, account-scoped administration, and non-disclosing cross-account refusal

> **Revision 2.** Revision 1 was reviewed against the source by the advisory panel
> (senior / security / performance) before any code was written. **30 findings, 11
> major.** Two of revision 1's own claims were factually wrong and are corrected
> below. Full response in **Panel response** at the foot of this file.
>
> The finding that would have shipped a broken product: revision 1 redefined
> `AdminPermissions()` without noticing that `ui/mcp/helpers/principal.go` builds the
> MCP system principal from it with a blank `AccountID` — all three lenses found it
> independently. Every MCP tool call would have resolved nothing.
>
> The finding that would have shipped a **new hole while closing one**: revision 1's
> `List` passed a pointer to the caller's own account, so a blank-account caller
> would issue `WHERE account_id = ''` and receive **every accountless user** — the
> exact wildcard the `own != ""` conjunct exists to forbid.

## Anchors, not line numbers

Every reference below is to a **named symbol**, not a line. The files move under
edits, and a plan that cites line 347 is wrong the moment step 1 lands.

| Anchor | Where |
|--------|-------|
| `catalogue`, `userPermissions`, `roles`, `AdminPermissions`, `RolePermissions` | `src/pkg/auth/perm.go` |
| `MayAddressDevice` | `src/pkg/auth/scope.go` |
| `systemPrincipal` | `src/ui/mcp/helpers/principal.go` |
| `requireAccount`, `CreateAccount`, `ListAccounts`, `AttachDevice`, `ResolveMetaToken` | `src/usecase/account.go` |
| `accountContext`, `InitRestAccount` | `src/ui/rest/account.go` |
| `assertMayAdministerUser`, `assertMayGrantRoles`, `Create`, `Update`, `Get`, `List` | `src/usecase/user_admin.go` |
| `ListUsers` | `src/domains/chatstorage/interfaces.go`, `src/infrastructure/chatstorage/user_admin_repository.go`, `src/infrastructure/whatsapp/chatstorage_wrapper.go` |
| `SeedIdentity`, `BootstrapAdmin` | `src/usecase/identity.go` |
| the identity boot block | `src/cmd/root.go` |
| `deviceScopeExempt`, `namesDeviceInPath`, `AssertPolicyCoverage` | `src/ui/rest/middleware/coverage.go` |
| `RequireDeviceOwnership` | `src/ui/rest/middleware/device_ownership.go` |
| `getMigrations` (73 entries, index-positional) | `src/infrastructure/chatstorage/sqlite_repository.go` |

## Approach

The audit found one defect with three faces: the identity layer has a **vertical**
ceiling and no **horizontal** one. The fix is one rule, written once in the leaf that
already owns the only rule of this kind, plus the smallest set of edits that routes
every surface through it.

Four properties decide the shape:

1. **The tier is additive, not a re-cut.** `accounts.manage` and `users.manage` stay
   exactly where they are. Two new permissions mean only "cross an account boundary".
   *(Amended by the panel: `POST /accounts` **is** re-wired to the new permission on
   its route line — see D6. That is the one deliberate exception, and it makes the
   change smaller, not larger.)*

2. **`admin` keeps its id and loses its reach.** Renaming to `account_admin` would
   drop every `user_roles` row that references it (C-2), so only `name`/`description`
   change — which the seeder already rewrites via `ON CONFLICT DO UPDATE`.

3. **Enforcement is structural where the path allows it.** The panel showed that
   revision 1's NFR-5 claim was false for the account layer: `requireAccount` is a
   hand-placed usecase call with no boot assertion, unlike `RequireDeviceOwnership`
   which `AssertPolicyCoverage` pins on every `:device_id` route. Revision 2 mirrors
   that pattern for `:account_id` (D7).

4. **The upgrade must not lock the deployment out.** Two lenses independently found
   that on **every existing deployment** the sole administrator carries
   `AccountID: ""` (set deliberately by `BootstrapAdmin`), so steps 2–3 would take
   away all ~90 device routes and all 6 account routes until an operator set an env
   var *and* restarted. D5 is rewritten around that.

| Layer | Choke point | Routes covered | Boot-asserted? |
|-------|-------------|----------------|----------------|
| Devices | `MayAddressDevice` — one predicate | ~90 | yes (already) |
| Accounts | `RequireAccountScope` middleware + `requireAccount` backstop | 6 of 8 (+2 by route-line permission) | **yes (new)** |
| Users | `assertMayAdministerAccount` in 5 methods | 6 of 6 | no — see D8 |

## Design decisions

### D1 — `admin` stays derived; only the global tier is enumerated

`perm.go` argues that a set defined by *exclusion* silently grants every permission a
later ticket adds, and that this is why `userPermissions` is literal. That argument is
about the **read-only user**, whose purpose is to not gain send. It does not transfer
to `admin`, whose purpose is "everything an account needs" — there, auto-expansion is
the desired property (NFR-6).

So `AdminPermissions()` stays derived, as *catalogue minus a two-element global set*.
The enumerated list is the small, security-relevant one. `SuperAdminPermissions()` is
the whole catalogue and is what `AdminPermissions()` used to be.

### D2 — the refusal is 404, and the order of checks is what makes it true

The device layer already answers a foreign device with the *same body, byte for byte*,
that a non-existent device produces. The account and user layers return the sentinels
they already return — `ErrAccountNotFound`, `ErrUserNotFound` — and **no new error
code is introduced**.

**The panel found this claim false as revision 1 planned it.** `assertMayAdministerUser`
runs its vertical loop over `permissionsOfRoles(target.Roles)` first, so a foreign
target holding a permission the caller lacks would answer **403 `PRIVILEGE_ESCALATION`**
where an absent user answers 404 — and the extra `RoleIDsExist` / role-permission
round-trips are a query-count timing oracle on top. The order is therefore **pinned**:

```
GetUserWithRoles(target)
  → horizontal check on target.AccountID  → ErrUserNotFound   (cheap, no further I/O)
  → only then the vertical permission loop → ErrPrivilegeEscalation
```

TC-10 is extended with a foreign **privileged** target, not merely a foreign peer.

### D3 — the account layer must first *have* a principal

`userAdminContext` stamps the principal onto the context; `accountContext` does
**not** — it stamps only the audit actor. With a scope check added but the principal
never stamped, `PrincipalFromGoContext` returns `false`, the check fails **closed**,
and every `/accounts` route answers 404 for every caller including `super_admin`.
Step 4 fixes `accountContext`, and TC-7's `super_admin` half is what catches it if the
order is ever inverted. *(Verified TRUE by the senior lens.)*

### D4 — the list bounds are query bounds, and blank is the empty set

Filtering a page after reading it turns `limit=50` into "as many of the first 50
global rows as happen to be yours". So `ListUsers` grows an account parameter and the
`WHERE` clause does the work (AC-13).

**The panel found the dangerous half of this.** A blank-account caller would produce
`WHERE account_id = ''` and receive **every accountless user** — precisely the
wildcard `own != ""` exists to forbid, arriving through a query path that never
consults the scope function at all. So:

> A caller whose own account is blank and who lacks the global tier returns the
> **empty set**, before any query is issued.

`ListAccounts` takes the cheaper branch the panel named: non-global caller → a single
indexed `GetAccount(own)`; global caller → the existing list. Same code size, one row
instead of the table.

### D5 — the upgrade must not lock anybody out

Revision 1 rejected automatic promotion as "silent". The panel showed the alternative
is worse: on every existing deployment the only administrator has `AccountID: ""`, so
revision 1 shipped a **lockout with total blast radius**, recoverable only by setting
an env var and restarting.

Revision 2 resolves it with three mechanisms, all guarded on *no `super_admin` exists*
so each is self-disarming, and all **loud**:

1. **One-time promotion.** When no user holds `super_admin`, every user that holds
   `users.manage` **and** carries a blank `account_id` is granted it. By construction
   that population is exactly the bootstrap admin — the API refuses to create a
   blank-account user (`ErrAccountRequired`). It grants **nothing that user does not
   already have today**: a blank-account holder of `accounts.manage` reaches every
   device right now. Each promotion is logged at WARN naming the user.
2. **`AUTH_SUPER_ADMIN=<username>`** for a deployment whose bootstrap admin was
   deleted. **Guarded the same way** — see D5a.
3. **An ERROR-level boot line** when neither produced one, naming the remediation.

`BootstrapAdmin` grants `super_admin` on a genuinely fresh install (empty users table
— the existing guard, unchanged).

The zero-check costs **no new repository method**: `LoadIdentitySnapshot()` already
returns `Users` + `UserRoles`, so "does anybody hold `super_admin`" is a loop in Go.
*(Verified TRUE by the senior lens.)*

### D5a — `AUTH_SUPER_ADMIN` must not be a permanent back door

The security lens caught that revision 1's `EnsureSuperAdmin` re-granted at **every**
boot keyed on **username**, which is strictly weaker than `AUTH_BOOTSTRAP_ADMIN`'s
empty-table guard. Two concrete failures: revoking `super_admin` through the API is
silently undone on the next restart; and if the named user is deleted, an
account-scoped `users.manage` holder who creates a user with that username is promoted
to full cross-tenant access at the next restart.

It is therefore guarded exactly as `BootstrapAdmin` is — **it fires only while no
`super_admin` exists** — and, like `BootstrapAdmin`, logs a WARN telling the operator
to remove it when it is set but ignored. That turns it from a standing override into a
recovery lever.

### D6 — `POST /accounts` moves to the route line, not to a new sentinel

Revision 1 planned a `pkgError.GenericError`-shaped sentinel in the usecase. The
senior lens pointed out that `domains/account` has no error file to put it in, and
that the smaller and better-integrated answer is one word on the route line:

```go
app.Post("/", middleware.Require(pkgAuth.PermAccountsManageAll), rest.AddAccount)
```

It reuses `refusePermission`'s exact body (so there is one answer to "you may not",
not two — which was also the security lens's minor), adds no type, and stays visible
to `AssertPolicyCoverage`. It is a deliberate exception to Approach property 1, and it
is *smaller* than the alternative.

### D7 — the account bound is boot-asserted, mirroring the device pattern

`coverage.go` records the repository's own conclusion: "a hand-placed guard is one
somebody eventually leaves off", and `AssertPolicyCoverage` refuses to boot when a
`:device_id` route lacks `RequireDeviceOwnership`. Revision 1 claimed NFR-5 while
leaving the account layer hand-placed — `Get`'s current omission in `user_admin.go` is
the standing proof that the concern is real.

Revision 2 adds `RequireAccountScope` on every `:account_id` route line plus a
`namesAccountInPath` boot assertion with a closed exempt set. `requireAccount` keeps a
one-string-compare backstop, the same belt-and-braces the device layer already runs
(`DeviceMiddleware` *and* `RequireDeviceOwnership` both call `MayAddressDevice`).

### D8 — the user layer cannot be boot-asserted, and the spec now says so

`/auth/users` routes name a **user**, not an account; the target's account is a column
that only a read can supply. No route-line middleware can decide it. NFR-5 is amended
to claim structural enforcement for the account and device layers and **usecase
enforcement for the user layer**, with the five call sites enumerated in step 6 so the
omission that produced `Get` cannot recur silently.

### D9 — the MCP system principal keeps exactly the reach it has today

All three lenses found that `systemPrincipal` is built from `AdminPermissions()` with
`AccountID: ""`, and its own comment states it works "ONLY through `accounts.manage`,
which this principal holds". Redefining `AdminPermissions()` makes that false and
leaves MCP addressing the empty set.

It becomes `SuperAdminPermissions()` with `RoleSuperAdmin`. **This grants nothing
new:** the principal already holds the full catalogue including `accounts.manage`, and
a blank-account holder of `accounts.manage` reaches every device *today*. The security
lens's alternative — an env-scoped `AccountID` — is **declined** as a behaviour change
that would break any multi-account MCP deployment, and because `cmd/mcp.go` serving SSE
with no authentication is a pre-existing decision this ticket must not silently
re-litigate. It is recorded as a named residual risk, and pinned by a test asserting
MCP's reach is **unchanged** by this ticket.

## Steps

### Step 1 — the permission tier and the roles (`pkg/auth/perm.go`)

- `PermAccountsManageAll = "accounts.manage.all"`, `PermUsersManageAll = "users.manage.all"`.
- **Append** both to `catalogue` — never insert. The ordering comment says the seeder
  writes in this order inside one transaction so two booting processes block rather
  than deadlock; inserting mid-list changes the lock order between an old and a new
  binary running concurrently.
- `RoleSuperAdmin = "super_admin"`; `globalPermissions` (the two-element set).
- `SuperAdminPermissions()` = the whole catalogue (the old `AdminPermissions`).
- `AdminPermissions()` = catalogue minus `globalPermissions`, still derived (D1).
- `roles`: **append** `super_admin` and change `admin`'s name/description only. Append
  rather than prepend, for the same lock-order reason as the catalogue — and because
  revision 1 prepended without explaining why the two lists were treated differently
  (senior, info).
- `RolePermissions` gains the `super_admin` case.

### Step 2 — the scope rule (`pkg/auth/scope.go`)

- **One** exported function, not three symbols (senior, minor):
  `MayAddressAccountScope(principal *Principal, targetAccountID, globalPermission string) bool`.
  Call sites pass `PermAccountsManageAll` or `PermUsersManageAll`, so each reads as the
  question it is asking.
- **Ordering is explicit and mirrors `MayAddressDevice`**: the account string compare
  runs *before* the permission scan, and the `own != ""` conjunct is load-bearing, not
  a nil-guard (perf, info).
- `MayAddressDevice`'s final predicate becomes `PermAccountsManageAll`; the escape-hatch
  comment paragraph is rewritten. **Named consequence** (security, minor):
  `RequireDeviceOwnership`'s unresolvable-id repair path — `MayAddressDevice(principal, "")`,
  which keeps an orphaned Chatwoot config deletable — narrows to the global tier. That
  is intended (it is an operator repair path) and is added to TC-6.

### Step 3 — the MCP system principal (`ui/mcp/helpers/principal.go`)

`SuperAdminPermissions()`, `RoleSuperAdmin`, and the `AccountID: ""` comment rewritten
to name the new permission. Plus the test in step 12 pinning reach (D9).

### Step 4 — the account usecase (`usecase/account.go`)

- `requireAccount`: existence check first, then the scope backstop returning
  `ErrAccountNotFound` (D2, D7).
- `ListAccounts`: non-global → single `GetAccount(own)`; blank own account → empty;
  global → the existing list (D4).
- `AttachDevice`: **collapse the device oracle** (security, minor). For a caller
  without the global tier, `ErrDeviceAlreadyAttached` (409) is reported with the
  `ErrDeviceNotFound` (404) shape, and claiming a device carrying `account_id = ''`
  requires the global tier — otherwise the first account admin to call it takes every
  legacy device.
- `ResolveMetaToken`: one comment line recording that it takes a caller-supplied
  account id and bypasses `requireAccount`, so the Meta-channel ticket does not inherit
  an unbounded door (senior, info). **No behaviour change** — it has no production
  caller.

### Step 5 — REST wiring (`ui/rest/account.go`)

- `accountContext` stamps the principal (D3). **Lands with step 4, not after it.**
- `POST /` moves to `Require(pkgAuth.PermAccountsManageAll)` (D6).
- Every `:account_id` route line gains `RequireAccountScope` as its second handler,
  after `Require` and before the handler — the position `require.go` and
  `device_ownership.go` both document, because Fiber runs handlers
  first-argument-first and a trailing guard is registered and never executed.

### Step 6 — the user usecase (`usecase/user_admin.go`)

- New `assertMayAdministerAccount(ctx, targetAccountID) error` — the **cheap**
  horizontal check: one compare over an already-read field, no role or permission
  resolution (all three lenses).
- `assertMayAdministerUser`: horizontal check first, `ErrUserNotFound`, **then** the
  vertical loop (D2).
- `Update`: the horizontal check runs **unconditionally**; the vertical ceiling stays
  gated on `request.Roles != nil` exactly as today, so an email-only PATCH pays no new
  queries and cannot start returning `PRIVILEGE_ESCALATION` where it succeeds today
  (senior/security/perf all flagged revision 1 here). Also refuses a `request.AccountID`
  that moves the user out of the caller's reach.
- `Get`: adopt the context parameter and add the check — it has none today.
- `Create`: refuse a foreign `account_id`; **default an omitted/blank `account_id` to
  the caller's own account** for a non-global caller rather than minting an orphan its
  own creator cannot then reach (security, minor); the inline `account` spec requires
  the global tier.
- `List`: adopt the context parameter; global → `nil`; blank own account → **empty
  set, no query**; else the caller's own account (D4).
- `Delete`, `ChangePassword`: inherit through `assertMayAdministerUser`.

### Step 7 — the query bound (three files, C-4)

- `interfaces.go`: `ListUsers(accountID *string, limit, offset int)`.
- `user_admin_repository.go`: `WHERE account_id = ?` when non-nil, **and** bound the
  companion grant scan the same way — revision 1 left a scoped page beside an
  unscoped `SELECT user_id, role_id FROM user_roles` that reads every grant row in the
  deployment (perf, minor).
- `chatstorage_wrapper.go`: mirror the signature. *(Verified: exactly three production
  sites.)*

### Step 8 — the index (`sqlite_repository.go`)

`users` carries only its PK and the username/email unique indexes, so the new `WHERE
account_id = ?` scans the table (perf, minor). Add **migration 74**, appended:

```sql
CREATE INDEX IF NOT EXISTS idx_users_account_id ON users(account_id)
```

The list is **index-positional** (schema version N is `migrations[N-1]`), so it is
appended and never inserted. `TestMigration73IsAppendedLast` pins the count at 73 and
must be updated to 74 — a planned test edit, not a surprise.

### Step 9 — bootstrap, promotion and the boot lines (`usecase/identity.go`, `cmd/root.go`)

- `BootstrapAdmin` grants `RoleSuperAdmin`.
- `PromoteLegacySuperAdmins(repo)` — D5 mechanism 1, guarded on zero `super_admin`,
  WARN per promotion.
- `EnsureSuperAdmin(repo, username)` — D5a, guarded on zero `super_admin`, WARN when
  set-but-ignored, unknown username logged and non-fatal.
- `WarnIfNoSuperAdmin(repo)` — **ERROR** level with the exact remediation (security,
  major 5).
- `cmd/root.go`: wire the three after `BootstrapAdmin`, non-fatal, matching the block's
  existing "deliberately not fatal" reasoning.

### Step 10 — the boot assertion (`ui/rest/middleware/coverage.go`)

- `namesAccountInPath` + a closed `accountScopeExempt`, mirroring `namesDeviceInPath`
  exactly (D7).
- `deviceScopeExempt`'s comment for `PATCH {BASE}/accounts/:account_id/devices/:device_id`:
  its **first** argument stops being true after step 2, its **second** survives, so the
  exemption stays and only the comment changes. *(Verified correct by the senior lens.)*

### Step 11 — operator documentation (`src/.env.example`)

`AUTH_SUPER_ADMIN` documented beside `AUTH_BOOTSTRAP_ADMIN`, carrying the same
"remove it after use / it re-arms" warning (security, minor). Without this the
documented recovery path for D5 is undiscoverable.

### Step 12 — tests

New: `scope_account_test.go` (TC-5, incl. blank/blank), `perm_tier_test.go` (TC-1..TC-4),
`account_scope_test.go` (TC-7..TC-9), `user_admin_scope_test.go` (TC-10..TC-13, incl. a
foreign **privileged** target and a blank-account caller), `identity_superadmin_test.go`
(TC-14..TC-16, incl. the pre-ticket blank-account admin), `mcp_principal_scope_test.go` (D9).

**Existing tests that must change** — enumerated because revision 1 named only two and
an implementer bound by that list would have gone off-plan (senior, major):

| File | Why |
|------|-----|
| `src/pkg/auth/scope_test.go` | `MayAddressDevice` predicate |
| `src/usecase/account_test.go` | principal-free contexts now fail closed |
| `src/usecase/device_broadcast_scope_test.go` | ditto |
| `src/ui/websocket/websocket_scope_test.go` | ditto |
| `src/ui/rest/device_account_test.go` | ditto |
| `src/ui/rest/middleware/device_ownership_test.go` | orphan repair path narrows |
| `src/usecase/user_admin_test.go` | `ListUsers` signature |
| `src/infrastructure/chatstorage/user_admin_repository_test.go` | signature + migration count |
| `src/ui/rest/policy_matrix_test.go` | `POST /accounts` permission + new guard |

### Step 13 — validation

Per **Validation strategy** below.

## Files to change

| File | Change |
|------|--------|
| `src/pkg/auth/perm.go` | two permissions, `super_admin`, derived `AdminPermissions` minus the global set |
| `src/pkg/auth/scope.go` | `MayAddressAccountScope`; `MayAddressDevice`'s escape hatch |
| `src/ui/mcp/helpers/principal.go` | `SuperAdminPermissions()` (D9) |
| `src/usecase/account.go` | `requireAccount` backstop, `ListAccounts`, `AttachDevice` oracle, `ResolveMetaToken` comment |
| `src/ui/rest/account.go` | principal stamp, `POST /` permission, `RequireAccountScope` on 6 route lines |
| `src/ui/rest/middleware/account_scope.go` | **new** — `RequireAccountScope` |
| `src/ui/rest/middleware/coverage.go` | `namesAccountInPath`, `accountScopeExempt`, comment |
| `src/usecase/user_admin.go` | `assertMayAdministerAccount`, order pin, `Get`/`Create`/`Update`/`List` |
| `src/domains/chatstorage/interfaces.go` | `ListUsers` signature |
| `src/infrastructure/chatstorage/user_admin_repository.go` | scoped page **and** scoped grant scan |
| `src/infrastructure/chatstorage/sqlite_repository.go` | migration 74, appended |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | mirror the signature (C-4) |
| `src/usecase/identity.go` | `super_admin` bootstrap, promotion, `EnsureSuperAdmin`, boot ERROR |
| `src/cmd/root.go` | wire the three boot calls |
| `src/.env.example` | document `AUTH_SUPER_ADMIN` |
| tests | 6 new files + the 9 existing files enumerated in step 12 |

**Not touched:** every `docker/*`, `docker-compose.yml`, `.github/workflows/*`.

## Validation strategy

1. `go build ./...` and `go vet ./...` — C-4's wrapper trap is a compile error, so the
   build is the check for it.
2. **`go test -tags purego ./...`**, compared against the baseline captured on the
   unmodified tree **before the first edit**: 17 packages ok, **one** pre-existing
   failure (`TestResolveDocumentMIME`, a Windows MIME quirk in `usecase`).
   *Correction to revision 1, found while capturing it:* revision 1's step 10 said
   `go test ./...` with no tag, which produces ~200 failures reading
   `Binary was compiled with 'CGO_ENABLED=0', go-sqlite3 requires cgo` — a build-environment
   artefact, not a regression. Without the tag the baseline diff is unreadable.
3. Boot the binary once: `AssertPolicyCoverage` is a boot-time fatal, so a green boot
   is the AC-20 evidence — and it now also proves the new `namesAccountInPath`
   assertion classifies every `:account_id` route.
4. **Mutation checks** for the claims a green suite cannot prove on its own:
   revert `MayAddressDevice`'s predicate and assert TC-6 fails; drop the principal
   stamp from `accountContext` and assert TC-7's `super_admin` half fails; make `List`
   pass `&""` instead of the empty set and assert TC-11's blank-account case fails.

## Rollback

Every change is additive or a single-predicate swap. Reverting the commit restores the
previous behaviour. **Correction to revision 1**, which claimed "no migration is
written": step 8 adds migration 74. It is a bare `CREATE INDEX IF NOT EXISTS` with no
rewrite and no backfill; on rollback the index simply remains, unused and harmless,
because a reverted binary records schema version 73 and never consults it. The two new
permission rows and the `super_admin` role row likewise remain, inert, because nothing
reads a permission the Go catalogue does not name.

## Out of scope

As `spec.md > Out of scope`. In particular: no roles-administration API; the
last-administrator interlock stays global (C-6); `POST /devices`' acceptance of webhook
fields under `devices.create` is untouched; and **authenticating the MCP surface is not
attempted** (D9).

---

## Panel response

Revision 1 was reviewed by `senior-reviewer`, `security-reviewer` and
`performance-reviewer` against the source. **30 findings — 11 major, 11 minor, 8
info.** 24 adopted, 2 declined with reasons, 2 corrections to revision 1, 2 recorded
without change.

**The three lenses converged on two things independently**, which is the strongest
signal in the review:

- **All three** found the MCP system principal (D9). Revision 1 would have shipped a
  silently broken MCP integration.
- **All three** found that making `assertMayAdministerUser` unconditional in `Update`
  drags the *vertical* ceiling onto every PATCH — security saw a 403/404 disclosure
  divergence, senior saw a behaviour break, performance saw ~2R+3 queries on an
  email-only patch. One split fixes all three.

### Adopted

| # | Lens | Finding | Where it landed |
|---|------|---------|-----------------|
| 1 | all 3 | MCP principal built from `AdminPermissions()` with blank account → addresses the empty set | D9, step 3, step 12 |
| 2 | sec, sen | `AUTH_SUPER_ADMIN` is a permanent username-keyed back door; re-grants every boot, undoes API revocation, promotes a re-created username | D5a, step 9 |
| 3 | sec | 404 claim dies in `assertMayAdministerUser` — vertical loop runs first, foreign privileged target answers 403 + a query-count timing oracle | D2, step 6, TC-10 |
| 4 | sec | NFR-5 false for the account layer — hand-placed, no boot assertion, `Get`'s omission is the proof | D7, D8, steps 5/10 |
| 5 | sec, sen | Upgrade lockout: existing admins carry `AccountID: ""`, lose ~90 device routes and all account routes | D5, step 9 |
| 6 | sen | `List` with blank own account issues `WHERE account_id = ''` → returns every accountless user | D4, step 6 |
| 7 | sen, sec, perf | Unconditional ceiling in `Update` breaks email-only PATCH and costs ~2R+3 queries | step 6 |
| 8 | sen | Existing-test blast radius far larger than revision 1 admitted; 9 files enumerated | step 12 |
| 9 | perf | No index on `users.account_id` | step 8, migration 74 |
| 10 | perf | Scoped page beside an unscoped whole-table grant scan | step 7 |
| 11 | perf | `ListAccounts` reads every row to return one | D4, step 4 |
| 12 | sen, sec | `CreateAccount` 403 has no sentinel home; two refusal shapes for one question | D6 — route line instead |
| 13 | sen | Three symbols for one rule is abstraction the AC does not need | step 2 — one exported function |
| 14 | sec | `AttachDevice` 409/404 divergence is a cross-tenant device-id oracle; orphan devices claimable by whoever attaches first | step 4 |
| 15 | sec | `RequireDeviceOwnership`'s orphan-repair escape silently narrows to the global tier | step 2, TC-6 |
| 16 | sec | `POST /auth/users` with blank `account_id` mints an orphan its own creator cannot reach | step 6 |
| 17 | sec | `AUTH_SUPER_ADMIN` undocumented in `.env.example` | step 11 |
| 18 | perf, sen | Shared helper must keep account-compare-before-permission-scan ordering | step 2 |
| 19 | sen | `ResolveMetaToken` bypasses `requireAccount` (no production caller today) | step 4 — comment only |
| 20 | sen | Revision 1 appended to `catalogue` but prepended to `roles`, unexplained | step 1 — append both |
| 21 | sen | `Get`/`List` take `_ context.Context` and must adopt the parameter | step 6 |
| 22 | sec | AC-19's boot message should be ERROR with exact remediation | step 9 |
| 23 | sec | Need a TC for "pre-ticket admin with blank account, post-upgrade" | step 12 |
| 24 | sec | Need a test pinning that MCP never silently gains the global tier | step 12 |

### Declined, with reasons

**D-1 — give the MCP principal an env-scoped `AccountID` instead of the global tier**
(security, major 1). Declined. The principal holds the full catalogue including
`accounts.manage` **today**, and a blank-account holder of `accounts.manage` reaches
every device today — so `SuperAdminPermissions()` is exactly status-quo-preserving,
while an env-scoped account is a **behaviour change** that breaks any multi-account MCP
deployment. The underlying risk is that `cmd/mcp.go` serves SSE with no authentication,
which is a pre-existing decision recorded in that file; re-litigating it inside a
tenant-isolation ticket would widen the scope and change a working flow. Recorded as a
named residual risk in `verify.md` and pinned by the D9 test.

**D-2 — collapse `AttachDevice`'s 409 into 404 for *every* caller** (implied by
security, minor). Declined in that form. `ErrDeviceAlreadyAttached` is a genuine and
useful answer for a **global** caller reshaping the fleet, and flattening it for
everyone would remove information the `/accounts` surface exists to give. The
divergence is collapsed **only for callers without the global tier**, which is where
the oracle exists.

### Corrections to revision 1

**C-1 — the validation command was wrong.** Revision 1's step 10 specified
`go test ./...`. Capturing the baseline showed that produces ~200 failures reading
`Binary was compiled with 'CGO_ENABLED=0', go-sqlite3 requires cgo to work` — a
build-environment artefact in `infrastructure/chatstorage` and
`infrastructure/whatsapp`, not a regression. The correct command is
**`go test -tags purego ./...`**, whose baseline is 17 packages ok and one
pre-existing failure. Revision 1's step 2 of the validation strategy would have been
uninterpretable.

**C-2 — "no migration is written" was false.** Revision 1's Rollback asserted it; the
performance lens's index finding makes migration 74 necessary. The Rollback section is
rewritten to state what the migration is and why leaving it behind on a revert is
harmless.

### Recorded, no change

**R-1 — `MayAddressDevice`'s fallback becomes a scan *miss* for the dominant `admin`
role** (perf, info): today it hits `accounts.manage` at index 0; after the change an
account admin scans all 25 sorted strings before returning false. Tens of nanoseconds,
and the account compare still short-circuits the common case, so no action. If it ever
shows in a profile the fix is a precomputed `Global bool` on `Principal` in
`BuildPrincipals`, not a change here.

**R-2 — `WarnIfNoSuperAdmin`'s `LoadIdentitySnapshot()` duplicates the read
`NewAuthService` performs moments later** (perf, info): one extra three-table read over
tens of rows, once per boot. Left as is; threading the snapshot through the boot path
to save it would couple two independent boot steps for no measurable gain.

**R-3 — `redactedSettings()` already masks any key containing "auth"** (security,
info): `AUTH_SUPER_ADMIN` is redacted in the startup dump and `viper.AutomaticEnv`
keeps it out of `AllSettings()`. No new secret-exposure surface. Confirmed, no change.
