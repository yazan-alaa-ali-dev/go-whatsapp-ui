---
ticket: z8pmx9m6ak
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-09-02
links:
  clickup: ""
  github: ""
---

# Implementation — 27 · Tenant isolation

Applied on branch `ticket/z8pmx9m6ak`, cut from `feat/api-docs` (the tip carrying
ticket 26 and the embedded API documentation).

**33 files modified, 8 new — 1,343 insertions, 138 deletions.** No commit was created
at this stage; the single publishable commit is `/publish-pr`'s job.

## Files changed

### New (8)

| File | What it is |
|------|------------|
| `src/ui/rest/middleware/account_scope.go` | `RequireAccountScope` — the route-line tenant guard for `:account_id`, and `AccountNotFound`, the single non-disclosing refusal body |
| `src/pkg/auth/scope_account_test.go` | TC-5: the exhaustive table over `MayAddressAccountScope`, plus the seeded-role tier assertions |
| `src/usecase/user_admin_scope_test.go` | TC-10/11/12/13/20/21: the headline cross-account refusals |
| `src/usecase/account_scope_test.go` | TC-7/8: the six `requireAccount` routes and the bounded account list |
| `src/usecase/identity_superadmin_test.go` | TC-14..18: promotion, `AUTH_SUPER_ADMIN`, the fail-safe direction |
| `src/usecase/scope_testhelpers_test.go` | `operatorContext` / `accountContextFor` — one place the suite gets a principal |
| `src/ui/rest/account_scope_rest_test.go` | The route-line guard, handler-ordering, and the `accountContext` wiring test |
| `src/ui/mcp/helpers/mcp_principal_scope_test.go` | AC-22: the MCP principal's reach is unchanged |

### Modified — production (13)

| File | Change |
|------|--------|
| `src/pkg/auth/perm.go` | `accounts.manage.all` / `users.manage.all` appended; `RoleSuperAdmin`; `SuperAdminPermissions()`; `AdminPermissions()` = catalogue minus `globalPermissions`; `IsGlobalPermission` |
| `src/pkg/auth/scope.go` | `MayAddressDevice`'s escape hatch → the global tier; `MayAddressAccountScope`, `HasGlobalScope`, `OwnAccountID` |
| `src/ui/mcp/helpers/principal.go` | `SuperAdminPermissions()` + `RoleSuperAdmin` (D9) |
| `src/usecase/account.go` | `requireAccount` backstop; `ListAccounts` bound; `AttachDevice` oracle collapse + orphan-claim guard; `principalOf`; `ResolveMetaToken` note |
| `src/ui/rest/account.go` | principal stamped on `accountContext`; `POST /` → `accounts.manage.all`; `RequireAccountScope` on six route lines |
| `src/ui/rest/middleware/require.go` | fourth guard registry `accountScopePCs` + `isAccountScopeGuard` |
| `src/ui/rest/middleware/coverage.go` | `namesAccountInPath`, `accountScopeExempt`, the new violation, and the corrected `deviceScopeExempt` rationale |
| `src/usecase/user_admin.go` | `assertMayAdministerAccount`; order pin in `assertMayAdministerUser`; `Get`/`Create`/`Update`/`List` bounds |
| `src/domains/chatstorage/interfaces.go` | `ListUsers(accountID *string, …)` |
| `src/infrastructure/chatstorage/user_admin_repository.go` | scoped page **and** scoped grant scan; blank-scope backstop |
| `src/infrastructure/chatstorage/sqlite_repository.go` | migration 74, appended |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | signature mirror (C-4) |
| `src/usecase/identity.go` | `super_admin` bootstrap; `hasSuperAdmin`; `PromoteLegacySuperAdmins`; `EnsureSuperAdmin`; `WarnIfNoSuperAdmin` |
| `src/cmd/root.go` | the three boot calls wired after `BootstrapAdmin` |
| `src/.env.example` | `AUTH_SUPER_ADMIN` documented |

### Modified — existing tests (11)

`pkg/auth/auth_test.go`, `pkg/auth/scope_test.go`, `usecase/account_test.go`,
`usecase/account_lifecycle_test.go`, `usecase/device_broadcast_scope_test.go`,
`usecase/identity_test.go`, `usecase/user_admin_test.go`,
`ui/rest/testprincipal_test.go`, `ui/rest/account_auth_test.go`,
`ui/rest/account_lifecycle_test.go`, `ui/rest/device_account_test.go`,
`ui/rest/policy_matrix_test.go`, `ui/rest/middleware/device_ownership_test.go`,
`ui/websocket/websocket_scope_test.go`,
`infrastructure/chatstorage/{user_repository,user_admin_repository,sqlite_repository_account,sqlite_repository_debug}_test.go`.

The senior lens enumerated these in advance and every one of them broke as predicted.
Two categories, and the distinction matters when reading the baseline diff:

- **Compile-only** — the `ListUsers` signature and the migration/catalogue counts.
- **Deliberate behaviour changes** — every fixture whose "operator" held
  `accounts.manage` and now needs `accounts.manage.all`. Those tests asserted the
  behaviour this ticket exists to invert; `scope_test.go`'s first three cases were
  literally pinning the vulnerability.

## Deviations from the plan

**D-1 — `ListAccounts` is filtered in the usecase, not read by a new `GetAccount`.**
The plan (D4, adopting perf finding #11) said a non-global caller would take "a single
indexed `GetAccount(own)`". `IChatStorageRepository` has **no `GetAccount`** — it
carries `AccountExists` precisely because "the paths that need it do not need the row"
— so taking that branch meant adding an interface method plus its `chatstorage_wrapper.go`
mirror to avoid scanning a table with one row per TENANT. Declined as the trade the
small-change rule exists to refuse. The filter is three lines and the finding's real
half (never return another tenant's accounts) is fully implemented. `ListUsers` is
still scoped in SQL, because that table grows per user and is paginated.

**D-2 — the `Create` default lands BEFORE validation, not after.** The plan put the
"omitted `account_id` defaults to the caller's own" step in the tenant-bound block.
`ValidateCreateUser` refuses a blank account outright, so placed there the defaulting
was dead code and the obvious call — `POST /auth/users {username, password}` — was
refused. Caught by TC-12. The assignment moved above the validator.

**D-3 — `Update`'s blank-destination refusal comes from the validator, not the bound.**
The plan expected `ErrUserNotFound` for a move into `""`. The request validator refuses
it one layer earlier with a message naming the field. That is a better answer for a
value the caller supplied, so the code was left alone and TC-12 asserts the invariant
that matters — refused, and not moved — rather than a specific sentinel.

**D-4 — `accountScopeExempt` is empty.** The plan described "a closed exempt set". No
`:account_id` route needs an exemption, so the map ships empty. It is kept rather than
dropped so a future exemption is a reviewable edit in `deviceScopeExempt`'s shape,
with a written reason beside it, instead of a quiet deletion of the assertion.

**D-5 — one extra test written, outside the plan's list.**
`TestAccountContextCarriesThePrincipalIntoTheUsecase` was added after a mutation check
found a real coverage hole — see below. The plan's step 12 did not anticipate it.

## What the mutation checks found

Three were planned. They did not all behave as expected, and the two surprises were
worth more than the one that passed.

| Mutation | Detected? | What it showed |
|----------|-----------|----------------|
| `MayAddressDevice` predicate reverted to `accounts.manage` | **yes** — `TestMayAddressDevice` | The device bound is genuinely pinned |
| `RequireAccountScope` removed from one route line | **yes** — the boot assertion refused to start, naming `DELETE /accounts/:account_id` | D7's structural enforcement works end to end |
| Principal stamp removed from `accountContext` | **NO — a real gap** | Every REST test runs against a FAKE usecase, so none of them reach `requireAccount`. Deleting that one `if` would have made every `/accounts` route answer 404 for every caller in production — super_admin included — with a fully green suite. Closed by `TestAccountContextCarriesThePrincipalIntoTheUsecase`, which asserts the wiring directly; re-running the mutation now fails it with a message naming the consequence. |
| `List` passes a blank scope pointer | **NO — and correctly so** | The blank-scope wildcard is refused at *two* independent layers (usecase early return, repository backstop), so mutating either alone is invisible through the other. Resolved by pinning each layer on its own: `TestListUsersRefusesABlankScope` was added at the repository level, and mutating the repository backstop now fails it (2 accountless users leak). |

## Validation run

```
go build ./...            OK
go vet ./...              OK
go test -tags purego ./... 17 packages ok
                           1 failure: TestResolveDocumentMIME (usecase)
```

**Identical to the baseline** captured on the unmodified tree before the first edit:
the same single pre-existing failure, a Windows MIME quirk
(`application/x-zip-compressed` vs `application/zip`) that has nothing to do with this
ticket and is recorded in ticket 26's `verify.md` as well.

The `-tags purego` flag is required and was itself a correction to the plan — see
`plan.md > Panel response > C-1`. Without it ~200 tests fail on
`go-sqlite3 requires cgo`, which is a build-environment artefact that makes the
baseline diff unreadable.

## Deployment runtime files

**None touched.** `git diff --name-only | grep -E "docker|\.github"` returns nothing.
