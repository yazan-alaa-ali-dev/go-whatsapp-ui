---
ticket: z8pmx9m6ak
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-09-02
links:
  clickup: ""
  github: ""
---

# Specification — 27 · Tenant isolation: a super-admin tier, account-scoped administration, and non-disclosing cross-account refusal

## Business goal

Tickets 22–26 built an identity layer that answers **what** a caller may do. Ticket
25 answered **whose data** — but for one layer only, devices, through the single
leaf `pkg/auth.MayAddressDevice`. The two administration surfaces ticket 26 shipped,
`/auth/users` and `/accounts`, got no equivalent, and their permissions are
therefore **global**.

The consequence is not theoretical. `assertMayAdministerUser` bounds a caller by the
target's *permission set* and never by the target's *account*. Two administrators in
two different customer accounts hold the same seeded role, so their permission sets
are identical, so `target ⊆ actor` holds, so the ceiling passes. An administrator of
one customer can therefore list every user in the deployment, reset another
customer's administrator password and log in as them, or delete another customer's
account together with every device it owns — a purge that destroys whatsmeow session
keys and needs physical access to the customer's handset to undo.

Every existing guard in the identity layer is **vertical**: it stops a caller
climbing the privilege ladder. This ticket adds the missing **horizontal** guard —
tenant isolation between two callers standing on the same rung.

## User story

As **the operator of a multi-tenant deployment**, I want **an account's
administrator to administer that account and nothing else**, so that **delegating
day-to-day administration to a customer does not hand them every other customer's
users, devices and data**.

## Functional requirements

- **REQ-1** A **global tier** exists above the seeded administrator: two new
  permissions that mean "cross every account boundary", held by a new role and by no
  seeded role beneath it.
- **REQ-2** The existing `accounts.manage` and `users.manage` remain the **route
  guards**. They keep answering "may you use this surface at all"; the new tier
  answers "may you leave your own account", and the two questions stay separate.
- **REQ-3** The seeded `admin` role becomes **account-scoped**: it keeps every
  permission it holds today and gains neither of the new ones.
- **REQ-4** The rule "may this principal address this account" is written **once**,
  as a pure leaf function beside the existing device rule, and every enforcement
  point calls it rather than re-deciding.
- **REQ-5** Every `/accounts/:account_id/*` route is bounded by that rule.
- **REQ-6** Every `/auth/users` route is bounded by the equivalent rule applied to
  the *target user's* account.
- **REQ-7** Both list endpoints (`GET /accounts`, `GET /auth/users`) return only what
  the caller may address, and the bound is applied **in the query**, not by filtering
  a global page after the fact.
- **REQ-8** Creating a **new account** is a global-tier act: an account-scoped
  administrator may administer its account but may not mint another.
- **REQ-9** A refusal for a target outside the caller's account is **non-disclosing**:
  byte-identical to the answer for a target that does not exist.
- **REQ-10** The device rule's existing cross-account escape hatch moves from
  `accounts.manage` to the new global tier, so an account-scoped administrator sees
  only its own account's devices through every path that already consults it.
- **REQ-11** A deployment can be given its first global administrator without
  hand-written SQL, and without a silent automatic promotion.
- **REQ-12** A deployment holding **no** global administrator says so loudly at boot
  and still starts.

## Non-functional requirements

- **NFR-1** **No data migration.** An existing `admin` row keeps exactly the grants it
  has today; the upgrade adds rows and removes none.
- **NFR-2** **Fail closed.** An unidentified caller, an unresolvable principal or a
  blank account addresses the empty set — never "everything".
- **NFR-3** **The `""` sentinel is preserved.** A blank `account_id` continues to mean
  *no account*, never *every account* — the asymmetry `pkg/auth/scope.go` already
  documents.
- **NFR-4** **No new read on any request path.** The scope decision is made from the
  principal already resolved by the middleware and the account id already in hand.
- **NFR-5** **The new rule is enforced at a choke point, not at each call site**, and
  the enforcement is **structural where the route shape allows it**. For the device
  and account layers that means a route-line guard pinned by the boot-time coverage
  assertion, so a route added later inherits the bound by construction. *(Amended
  after panel review: the `/auth/users` routes name a **user**, not an account — the
  target's account is a column only a read can supply, so no route-line middleware can
  decide it. That layer is enforced in the usecase, and its call sites are enumerated
  in `plan.md > Step 6` precisely because a hand-placed check is the failure mode this
  NFR exists to bound. `Get`'s missing ceiling today is the standing proof.)*
- **NFR-6** **`admin` keeps auto-expanding.** A permission added to the catalogue in a
  later ticket must reach the account-scoped administrator automatically; only the
  global tier is enumerated.
- **NFR-7** No deployment runtime file is modified.

## Constraints

- **C-1** `pkg/auth` is a **leaf** and must import nothing from this repository. The
  new rule lives there and stays pure.
- **C-2** Permission ids and role ids are **append-only in practice** — renaming one
  silently drops every grant that references it. The seeded role keeps the id
  `admin`; only its human-readable name and description change.
- **C-3** `role_permissions` seeding is additive (`ON CONFLICT DO NOTHING`) and must
  stay so: the seeder may not delete a grant an operator added.
- **C-4** Any change to an `IChatStorageRepository` signature must land in the
  concrete repository **and** in `infrastructure/whatsapp/chatstorage_wrapper.go`,
  which delegates the whole interface.
- **C-5** Boot-time `AssertPolicyCoverage` must still pass; a route left unclassified
  refuses to start the server.
- **C-6** The last-administrator interlock stays **global**. It protects the
  deployment from losing every user who can administer users, and narrowing it per
  account would let the last platform administrator be removed.

## Acceptance criteria

### The permission tier and the roles

- **AC-1** The catalogue gains exactly two entries — `accounts.manage.all` and
  `users.manage.all` — and both are mirrored into the `permissions` table at boot.
- **AC-2** A `super_admin` role exists and holds **every** permission in the
  catalogue, including both new ones.
- **AC-3** The `admin` role holds every permission in the catalogue **except** the two
  new ones, and is derived rather than enumerated: a permission appended to the
  catalogue reaches `admin` with no further edit.
- **AC-4** The `user` role's grant set is **unchanged** — the same nine permissions,
  still written literally.
- **AC-5** An existing `admin` user requires **no data migration of its grants**: after
  upgrade it holds exactly the permission rows it held before. *(Amended after panel
  review: this is true of the **rows** and false of the **effective reach** — an
  existing administrator carries `AccountID: ""` and therefore loses cross-account
  access, which is the entire point of the ticket. AC-21 covers the upgrade path that
  keeps such a deployment administrable.)*

### The scope rule

- **AC-6** A single pure function answers "may this principal address this account",
  returns `true` for the principal's own non-blank account, `true` for a holder of
  `accounts.manage.all`, and `false` otherwise — including for a principal whose own
  account is blank facing a blank target.
- **AC-7** `MayAddressDevice` grants cross-account access only to
  `accounts.manage.all`. An `admin` whose account is `acc_alpha` may address devices
  of `acc_alpha` and no others, through every path that consults it: the device
  middleware, the path-param ownership guard, the device list, the Chatwoot config
  reads, and the WebSocket fan-out.

### The account surface

- **AC-8** Every `/accounts/:account_id/*` route naming an account that is neither the
  caller's own nor reachable by `accounts.manage.all` answers **404
  `ACCOUNT_NOT_FOUND`**, byte-identical to the answer for an account that does not
  exist, and performs no write.
- **AC-9** `GET /accounts` returns only the caller's own account, unless the caller
  holds `accounts.manage.all`, in which case it returns all.
- **AC-10** `POST /accounts` requires `accounts.manage.all`; a caller holding only
  `accounts.manage` is refused and no account row is created.
- **AC-11** `DELETE /accounts/:account_id` aimed at a foreign account deletes neither
  the account nor any device, and answers 404.

### The user surface

- **AC-12** `GET`, `PATCH`, `DELETE` and `POST .../password` on a user whose account is
  not the caller's own answer **404 `USER_NOT_FOUND`**, byte-identical to the answer
  for a user id that does not exist, and perform no write.
- **AC-13** `GET /auth/users` returns only users of the caller's own account, unless
  the caller holds `users.manage.all`. The bound is applied in the query, so a page of
  N is N of the caller's own users, not N global rows filtered down.
- **AC-14** `POST /auth/users` refuses an `account_id` other than the caller's own
  unless the caller holds `users.manage.all`; the inline `account` spec — which
  creates an account in the same call — additionally requires `accounts.manage.all`.
- **AC-15** `PATCH /auth/users/:user_id` refuses to move a user into another account
  unless the caller holds `users.manage.all`.
- **AC-16** The existing vertical ceiling still holds: an `admin` cannot grant
  `super_admin`, and the refusal is the existing `PRIVILEGE_ESCALATION`.

### Bootstrap and observability

- **AC-17** On a deployment with an empty users table, `AUTH_BOOTSTRAP_ADMIN` creates
  its user with the `super_admin` role.
- **AC-18** `AUTH_SUPER_ADMIN=<username>` grants `super_admin` to that user at boot,
  idempotently — running it twice changes nothing and is not an error. Unset is the
  ordinary case and is not an error. An unknown username is reported and does not stop
  the boot.
- **AC-19** When no user holds `super_admin`, boot emits an **ERROR-level** line naming
  `AUTH_SUPER_ADMIN` and the exact remediation, and the server still starts normally.
  *(Raised from WARN after panel review: in that state the deployment has no
  cross-account administration at all, which is an operational outage of the
  administration surface, not an advisory note.)*

### Upgrade safety and the MCP surface

- **AC-21** **No upgrade lockout.** On a deployment upgraded from ticket 26, every user
  that holds `users.manage` **and** carries a blank `account_id` is granted
  `super_admin` on the first boot on which no `super_admin` exists, and each promotion
  is logged naming the user. By construction that population is exactly the bootstrap
  admin, and the grant confers **nothing it does not already hold** — a blank-account
  holder of `accounts.manage` reaches every device before this ticket. The mechanism is
  self-disarming: once any `super_admin` exists it never fires again.
- **AC-22** **The MCP system principal's reach is unchanged by this ticket.** A tool
  call running as `SystemPrincipal()` addresses exactly the devices it addresses today,
  and the identity is pinned by a test so a later edit to `AdminPermissions()` cannot
  silently strand it.
- **AC-23** **A blank-account caller addresses the empty set on every list.** A
  principal whose own `account_id` is blank and that lacks the global tier receives an
  empty result from `GET /auth/users` and `GET /accounts` — never every accountless
  row, and never through a query path that skips the scope rule.

### Scope boundary

- **AC-20** No deployment runtime file (`docker-compose.yml`,
  `docker/golang.Dockerfile`, `docker/entrypoint.sh`, or any
  `.github/workflows/*.yml`) is modified, and `AssertPolicyCoverage` still passes at
  boot.

## Test cases

| ID | Criterion | Case |
|----|-----------|------|
| TC-1 | AC-1, AC-2, AC-3 | Seed into an empty database; assert the catalogue count, `super_admin`'s grant count equals the catalogue, and `admin`'s equals the catalogue minus two. |
| TC-2 | AC-3, NFR-6 | Append a synthetic permission to the catalogue in a test and assert it reaches `admin` without an edit to any list. |
| TC-3 | AC-4 | Assert `UserPermissions()` is exactly the nine, unchanged. |
| TC-4 | AC-5 | Seed a database at the pre-ticket catalogue, upgrade, and assert `admin`'s grant set is a superset of the original with no row removed. |
| TC-5 | AC-6 | Table test over `MayAddressAccount`: own/own, own/foreign, blank/blank, blank/foreign, global/foreign, nil principal. |
| TC-6 | AC-7 | An `admin` of `acc_alpha` receives 404 for a device of `acc_beta` through the path-param guard, and the device is absent from `GET /devices`. |
| TC-7 | AC-8, AC-11 | An `admin` of `acc_alpha` calls each of the six `:account_id` routes against `acc_beta`; every answer is 404 `ACCOUNT_NOT_FOUND` and the response body equals the body for a fabricated account id. |
| TC-8 | AC-9 | `GET /accounts` as `admin` of `acc_alpha` returns exactly one row; as `super_admin` returns all. |
| TC-9 | AC-10 | `POST /accounts` as `admin` is refused; as `super_admin` succeeds. |
| TC-10 | AC-12 | Each of the four user routes aimed at a foreign user answers 404 `USER_NOT_FOUND`, byte-identical to a fabricated user id, and the target row is unchanged afterwards. |
| TC-11 | AC-13 | With users spread across two accounts, `GET /auth/users?limit=100` as an account admin returns only its own; pagination is verified with a limit smaller than the foreign population so a post-filter implementation would visibly short-page. |
| TC-12 | AC-14, AC-15 | Create with a foreign `account_id` is refused; create with an inline `account` as a non-global caller is refused; patch moving a user across accounts is refused. |
| TC-13 | AC-16 | An `admin` granting `super_admin` receives `PRIVILEGE_ESCALATION`. |
| TC-14 | AC-17 | Bootstrap into an empty table; assert the created user holds `super_admin`. |
| TC-15 | AC-18 | `AUTH_SUPER_ADMIN` run twice grants once and errors neither time; an unknown username logs and returns nil. |
| TC-16 | AC-19 | With no `super_admin` present, boot logs the WARN and proceeds. |
| TC-17 | AC-20 | `git diff --name-only` contains no deployment runtime file; the server boots with coverage assertion enabled. |
| TC-18 | AC-21 | Seed a pre-ticket deployment (one `admin` with blank `account_id`, no `super_admin`), boot, and assert it now holds `super_admin`; boot again and assert nothing is granted twice. |
| TC-19 | AC-22 | Assert `SystemPrincipal()` addresses a device of `acc_alpha` and one of `acc_beta` — the reach it has today — and that it holds `accounts.manage.all` explicitly rather than by accident. |
| TC-20 | AC-23 | A principal with blank `account_id` and no global tier receives an empty list from both list endpoints; asserted against a fixture that **contains** accountless users, so a `WHERE account_id = ''` implementation visibly fails. |
| TC-21 | AC-12, D2 | A foreign target that holds a permission the caller lacks answers **404**, not 403 — the ordering pin, distinct from TC-10's foreign peer. |
| TC-22 | AC-16 | An email-only `PATCH` on a user in the caller's own account still succeeds and issues no role-resolution queries — the regression the unconditional ceiling would have caused. |

## Out of scope

- **A roles-administration API.** There is still no endpoint to compose a role or
  edit its grants; that remains an operator SQL task and is a separate ticket.
- **Per-account last-administrator interlock.** C-6 keeps it global on purpose.
- **Re-scoping the Chatwoot administration surface** (`chatwoot.manage`) beyond what it
  already inherits from `MayAddressDevice`.
- **Hardening `POST /devices`' acceptance of webhook fields under `devices.create`.**
  It is a real finding from the same audit, but it is a *vertical* permission
  question, not tenant isolation, and folding it in would widen this ticket.
- **`{BASE}/statics`,** which remains public by the decision recorded in
  `coverage.go`.
- Any change to token issuing, refresh rotation, or the principal cache mechanism.
