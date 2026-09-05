---
ticket: z8pmx9m6ak
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-09-02
links:
  clickup: ""
  github: ""
---

# Verification — 27 · Tenant isolation

**Outcome: PASSED.** All 23 acceptance criteria are mapped to an executed result below.

## How this was validated

```
cd src
go build ./...                 → OK
go vet ./...                   → OK
go test -tags purego ./...     → 17 packages ok, 1 failure
```

**The baseline was captured on the unmodified tree before the first edit** and is
identical: 17 packages ok, one pre-existing failure — `TestResolveDocumentMIME/Zip`,
a Windows MIME registry quirk (`application/x-zip-compressed` vs `application/zip`)
in `usecase`, unrelated to this ticket and already recorded in ticket 26's
verification.

**`-tags purego` is mandatory.** Without it ~200 tests in
`infrastructure/chatstorage` and `infrastructure/whatsapp` fail with
`Binary was compiled with 'CGO_ENABLED=0', go-sqlite3 requires cgo` — a
build-environment artefact, not a regression. Discovering this corrected the plan
(`plan.md > Panel response > C-1`); the first baseline attempt piped through
`tail -60` and hid it entirely.

A green suite proves less than usual for a *refusal* ticket, so four **mutation
checks** were run against the claims the suite cannot otherwise establish. Two of them
failed to be detected and exposed real coverage holes, both now closed — see
`implement.md > What the mutation checks found`.

## Acceptance criteria

### The permission tier and the roles

| AC | Result | Evidence |
|----|--------|----------|
| **AC-1** two catalogue entries, mirrored at boot | **PASS** | `TestCatalogueHoldsTwentyFivePermissions` (count 27, exact-set list); `TestSeedIdentityHandsTheWholeCatalogueToStorageOnce` |
| **AC-2** `super_admin` holds the whole catalogue | **PASS** | `TestSuperAdminHoldsTheWholeCatalogue`; `TestSeedIdentityGrantsMatchTheCatalogue` asserts it from the seeded ROWS, not the Go slice |
| **AC-3** `admin` = catalogue minus the tier, still derived | **PASS** | `TestAdminIsEveryPermissionExceptTheGlobalTier` — asserts both the exclusion and that every non-global entry still reaches admin, so replacing the derivation with a literal list fails here |
| **AC-4** `user` unchanged | **PASS** | `TestUserHoldsExactlyNinePermissions` (untouched, still green) |
| **AC-5** no grant migration for an existing admin | **PASS** | Seeding is `ON CONFLICT DO NOTHING` and the two new permissions were never granted to `admin`, so an upgraded row keeps exactly its 25. `TestSeedIdentityIsIdempotent` covers the re-seed. **Amended in spec.md**: true of the ROWS, false of the effective REACH — which is the point of the ticket, and AC-21 is what keeps such a deployment administrable. |

### The scope rule

| AC | Result | Evidence |
|----|--------|----------|
| **AC-6** one pure function, correct on all six shapes | **PASS** | `TestMayAddressAccountScope` — 13 cases including blank/blank, blank/named, padding, nil, and both tiers independently |
| **AC-7** `MayAddressDevice` narrowed to the global tier | **PASS** | `TestMayAddressDevice` (rewritten: the three cases that asserted the vulnerability now assert the refusal); `TestRequireDeviceOwnershipAdmitsAnOperator`; `TestFanOutFiltersByTheRecipientsAccount`; `TestDeviceListPayloadNarrowsPerRecipient`. **Mutation-verified**: reverting the predicate fails `TestMayAddressDevice`. |

### The account surface

| AC | Result | Evidence |
|----|--------|----------|
| **AC-8** every `:account_id` route 404s a foreign account, no write | **PASS** | `TestAccountRoutesRefuseAForeignAccount` (all 7 calls, asserts nothing purged and the account survives) and `TestAccountScopeGuardRefusesAForeignAccountBeforeTheHandler` (route level, asserts the usecase was never reached — which is what pins the handler ORDER the boot assertion cannot see) |
| **AC-9** `GET /accounts` bounded | **PASS** | `TestListAccountsIsBoundedToTheCaller` — own/global/anonymous |
| **AC-10** `POST /accounts` needs the global tier | **PASS** | `TestCreateAccountRequiresTheGlobalTier`; `policy_matrix_test.go` entry updated to `accounts.manage.all` |
| **AC-11** foreign delete destroys nothing | **PASS** | `TestAccountRoutesRefuseAForeignAccount/delete with the irreversible cascade` |

### The user surface

| AC | Result | Evidence |
|----|--------|----------|
| **AC-12** four verbs 404 a foreign user, no write | **PASS** | `TestCrossAccountUserAdministrationIsRefused` — 7 cases including the email-only PATCH that skipped the ceiling entirely before, plus `TestForeignTargetIsIndistinguishableFromAnAbsentOne` |
| **AC-13** `GET /auth/users` bounded IN THE QUERY | **PASS** | `TestListUsersIsBoundedToTheCallersAccount` (usecase) and `TestListUsersScopesToOneAccount` (repository, with an interleaved fixture and a limit smaller than the foreign population so a post-filter short-pages visibly) |
| **AC-14** create bounded; inline account needs the tier | **PASS** | `TestCreateIsBoundedToTheCallersAccount` — foreign refused, omitted defaults to own, inline spec refused |
| **AC-15** patch cannot move a user out of reach | **PASS** | `TestUpdateCannotMoveAUserOutOfReach` — foreign and blank destinations |
| **AC-16** the vertical ceiling still holds | **PASS** | `TestAnAccountAdminCannotGrantTheGlobalTier`; the pre-existing ceiling suite still green |

### Bootstrap and observability

| AC | Result | Evidence |
|----|--------|----------|
| **AC-17** bootstrap grants `super_admin` | **PASS** | `TestBootstrapAdminCreatesTheFirstAdministrator` |
| **AC-18** `AUTH_SUPER_ADMIN` idempotent, guarded, non-fatal | **PASS** | `TestEnsureSuperAdminIsARecoveryLeverNotABackDoor` — grants when none exists, inert once one does, unset is fine, a typo does not stop the boot |
| **AC-19** ERROR line when none exists, server still starts | **PASS** | `WarnIfNoSuperAdmin` logs at ERROR with the remediation and returns; wired non-fatal in `cmd/root.go`; `cmd` package tests green |

### Upgrade safety and MCP

| AC | Result | Evidence |
|----|--------|----------|
| **AC-21** no upgrade lockout | **PASS** | `TestPromoteLegacySuperAdminsRescuesTheBlankAccountAdministrator` (promotes the blank-account admin, leaves the tenant-scoped one alone), `…IsSelfDisarming`, `…DoesNothingWhenOneExists` |
| **AC-22** MCP reach unchanged | **PASS** | `TestSystemPrincipalReachIsUnchangedByTenantIsolation` (addresses acc_alpha, acc_beta and the blank account) and `TestSystemPrincipalHoldsTheGlobalTierDeliberately` |
| **AC-23** blank-account caller gets the empty set | **PASS** | `TestListUsersIsBoundedToTheCallersAccount/a blank-account caller sees nothing` and `TestListUsersRefusesABlankScope` (repository). Both fixtures deliberately CONTAIN accountless rows, so a `WHERE account_id = ''` implementation fails rather than passing on an empty table. **Mutation-verified** at the repository layer. |

### Scope boundary

| AC | Result | Evidence |
|----|--------|----------|
| **AC-20** no deployment runtime file; coverage assertion passes | **PASS** | `git diff --name-only \| grep -E "docker\|\.github"` → empty. `TestBootPolicyCoverageOnTheRealRouteSet` green under both base paths. **Mutation-verified**: removing `RequireAccountScope` from one route line makes it fail with `DELETE /accounts/:account_id — names :account_id but carries no middleware.RequireAccountScope()`. |

## Runtime impact

**Did any deployment runtime file change? NO.** No `docker-compose.yml`, no
`docker/golang.Dockerfile`, no `docker/entrypoint.sh`, no `.github/workflows/*`.

**Does this change runtime behaviour? YES, deliberately and observably.** This is a
security fix that removes reach, and operators must be told:

1. **An existing `admin` becomes account-scoped.** It keeps every permission row it
   had and loses only the ability to leave its own account.
2. **On the first boot after upgrade**, any administrator carrying a blank
   `account_id` — by construction, the bootstrap admin — is granted `super_admin`,
   logged at WARN naming the user. Without it that deployment would lose its entire
   administration surface (AC-21).
3. **`POST /accounts` now answers 403** to a caller holding only `accounts.manage`.
4. **`GET /accounts` and `GET /auth/users` return fewer rows** for a non-global caller.
   Any integration that assumed a global listing sees a shorter list, not an error.
5. **A new ERROR line at boot** when no `super_admin` exists.

## Residual risks

**R-1 — the MCP surface holds the global tier on an unauthenticated port.**
`SystemPrincipal()` carries `SuperAdminPermissions()`, so anything that can reach the
MCP port drives every tool across every account. **This is unchanged by this ticket**
— the principal already held `accounts.manage` with a blank account, which reached
every device — and the security lens's alternative (an env-scoped `AccountID`) was
declined as a behaviour change that breaks multi-account MCP deployments while still
not closing the port. `cmd/mcp.go` serving SSE with no authentication is the actual
exposure and is its own ticket. Pinned by AC-22 so neither drifts silently.

**R-2 — `AUTH_SUPER_ADMIN` re-arms if the last `super_admin` is removed.** By design,
mirroring `AUTH_BOOTSTRAP_ADMIN`'s re-arming behaviour, and documented in
`.env.example` with the same "remove it after use" warning. An operator who leaves it
set has a standing recovery path they may not want.

**R-3 — the last-administrator interlock stays GLOBAL.** `countOtherActiveAdminsTx`
counts `users.manage` holders across every account, so an account administrator can be
refused a deletion because *another tenant* has the only remaining administrator. The
refusal is conservative (it never permits too much) and narrowing it per account would
let the last platform administrator be removed. Recorded as C-6, not fixed.

**R-4 — `ResolveMetaToken` is unbounded.** It takes a caller-supplied account id and
bypasses `requireAccount`. Not a hole today: it has no production caller, because
`POST /accounts/:account_id/meta-numbers` is deliberately unregistered. A comment at
the function records that the Meta-channel ticket owns adding the check.

**R-5 — `POST /devices` still accepts webhook fields under `devices.create` alone.**
A real finding from the same audit, listed in `spec.md > Out of scope`: it is a
*vertical* permission question, not tenant isolation.

**R-6 — an orphaned Chatwoot config now needs `super_admin` to delete.**
`RequireDeviceOwnership`'s unresolvable-id repair path narrowed with the escape hatch.
Intended — it is an operator repair — but it is a capability an account administrator
had yesterday and does not have today.

**R-7 — PostgreSQL write skew on the last-admin interlock.** Pre-existing, documented
at `countOtherActiveAdminsTx`, untouched by this ticket. SQLite (the default) is
unaffected.

**R-8b — dangling `user_roles` rows exist in the wild, and one of them defeated the
rescue.** Found by running the boot helpers against a real PostgreSQL deployment after
the PR was opened, not by reasoning: that database held three `user_roles` rows for
user ids with no matching `users` row, one of them `super_admin`. This schema carries
no foreign keys, so a grant outlives any deletion that did not go through `DeleteUser`.
`hasSuperAdmin` counted it, so **all three rescue mechanisms went quiet at once** and
the deployment sat with no usable cross-account administrator and no diagnostic saying
so — the exact lockout AC-21 exists to prevent, reached by a path the plan did not
consider. Fixed: a grant now counts only when it names an **active** `users` row, and
dangling ones are reported at WARN. Regression test:
`TestADanglingSuperAdminGrantDoesNotCountAsOne`. The orphan rows themselves are left in
place — they grant nobody anything, since the principal cache is built from `users` —
and removing them is an operator decision, not this ticket's.

**R-8 — `idx_users_account_id` is not unique and not backfilled.** Migration 74 is a
bare `CREATE INDEX IF NOT EXISTS`; on a large existing `users` table the first boot
after upgrade pays a one-time index build.

## Verification decision

**PASSED.** Every acceptance criterion maps to an executed result, the suite matches
the pre-change baseline exactly, and the four claims a green suite cannot establish on
its own were mutation-tested — two of which exposed genuine coverage holes that are now
closed and re-verified.
