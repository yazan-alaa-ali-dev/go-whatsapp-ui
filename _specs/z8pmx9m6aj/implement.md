---
ticket: z8pmx9m6aj
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-09-01
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6aj"
  github: ""
---

# Implementation — 26 · User and account administration

Applied on branch `ticket/z8pmx9m6aj`, cut from `ticket/z8pmx9m6ah` (the tip carrying
ticket 25). **11 new files, 9 modified.** No commit was created at this stage.

## Files changed

### New (11)

| File | What it holds |
|------|---------------|
| `src/domains/auth/user_admin.go` | `UserAdminView` (no hash field), the request DTOs with redacting `MarshalJSON`/`String`, and the three usecase-level sentinels. |
| `src/domains/auth/user_admin_interfaces.go` | `IUserAdminUsecase`, six methods. |
| `src/infrastructure/chatstorage/user_admin_repository.go` | Every transactional statement, plus the lockout interlock and `isUniqueViolation`. |
| `src/infrastructure/chatstorage/user_admin_repository_test.go` | 30 tests against a real engine: atomicity, rollback, interlock, family revocation, migration 73. |
| `src/usecase/user_admin.go` | The service: validation, privilege ceiling, hashing under a verify slot, cache reload, audit. |
| `src/usecase/user_admin_test.go` | 22 tests: the ceiling, the reload, the epoch, the pointer-DTO behaviour. |
| `src/ui/rest/user_admin.go` | Six routes, `userAdminError`, `userAdminContext`. |
| `src/ui/rest/user_admin_test.go` | 11 tests, incl. the table-driven 401/403 probe over all six routes. |
| `src/ui/rest/user_admin_e2e_test.go` | 8 end-to-end tests over the real stack (AC-9). |
| `src/validations/user_admin_validation.go` | Patterns, the byte-bounded password check, the account-selection rule. |
| `src/validations/user_admin_validation_test.go` | 11 tests, incl. the rune-vs-byte regression. |

### Modified (9)

| File | Change |
|------|--------|
| `src/domains/chatstorage/interfaces.go` | Seven method declarations + five repository sentinels. |
| `src/domains/chatstorage/chatstorage.go` | `UserWithRoles`, `UserUpdate` (+ `HasChange`). |
| `src/infrastructure/chatstorage/sqlite_repository.go` | **Migration 73** — `idx_refresh_tokens_user`. |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | Seven pass-through delegations. |
| `src/cmd/rest.go` | Construction + registration, plus the `usecase` import. |
| `src/infrastructure/chatstorage/sqlite_repository_account_test.go` | Migration count 72 → 73. |
| `src/infrastructure/chatstorage/sqlite_repository_debug_test.go` | Migration count 72 → 73. |
| `src/infrastructure/chatstorage/user_repository_test.go` | Migration count, **and the unbounded slice** (see D-3). |
| `docs/openapi.yaml` | The six endpoints, seven schemas, one shared path parameter. |

No deployment runtime file was touched. `pkg/auth` was not modified (CON-1 holds).

## Deviations from the plan

**D-1 — `RevokeAllRefreshTokensForUser` was never added as a repository method.**
The plan listed it as the seventh method; the security lens then required the revoke
to run inside `DeleteUser`'s own transaction (AC-5/REQ-6). A separate exported method
would have been a second, non-transactional way to do the same thing — so the revoke
is a statement inside `DeleteUser` and `UpdateUserPassword`, and the seventh method
became `RoleIDsExist`, which the privilege ceiling genuinely needs.

**D-2 — `assertKeepsAnAdministratorTx` was added, and the interlock was corrected.**
The first implementation asked only *"would this leave zero active administrators?"*
and never *"does this user administer at all?"*. My own tests caught it: disabling an
**ordinary** user in a deployment with no live administrator was refused with "you
cannot remove the last user who can administer users" — a refusal about someone who
never held the permission, whose removal takes nothing away, and which an operator
could not act on. Three regression tests pin the corrected behaviour
(`TestTheInterlockDoesNotEngageForANonAdministrator`,
`TestTheInterlockIgnoresAnAlreadyInactiveAdministrator`,
`TestReEnablingIsNeverRefused`).

**D-3 — one ticket-22 test was un-bounded, and migration 73 exposed it.**
`user_repository_test.go` sliced `migrations[identityMigrationFirst:]` open-ended,
so appending migration 73 pulled it into ticket 22's own assertions. The account and
debug versions of the same test were already bounded; this one was not. Bounded to
`identityMigrationFirst+identityMigrationCount`, with a comment recording why.

**D-4 — `usecase.ActorFromContext` was exported.** The REST layer must be able to
assert that `userAdminContext` actually stamped the actor. Without a reader the wiring
is untestable from outside `usecase`, and the failure it would hide is silent: every
audit line naming `"unknown"`, discovered only when someone needs the log.

**D-5 — the response scan needle was narrowed.** The first AC-10 test flagged its own
success message, `"Password changed"`. The needles are now secret-*bearing* shapes
(`"password":` with JSON punctuation, `password_hash`, `$2a$`/`$2b$`, `token_hash`,
`refresh_token`) — a scan that flags a success message is a scan someone deletes.

**D-6 — `Permissions` was dropped from the wire type**, per the senior lens: reading
the union back from the rebuilt cache is not reachable through `IAuthUsecase`, and
computing it in the repository would be a second implementation of `BuildPrincipals`.
The union stays where TC-4 already asserts it, `GET /auth/me`.

**D-7 — the wire type is `UserAdminView`, not `User`** (senior lens): a third `User`
in a tree that already has `domains/chatstorage.User` and the `domains/user` package.

**D-8 — repository sentinels live in `domains/chatstorage`, not `domains/auth`**
(senior lens): `infrastructure/chatstorage` imports no `domains/auth` and must not
start.

## Validation run

Two build tags, because the repository ships two SQLite drivers:

- **`-tags purego`** (modernc.org/sqlite, no cgo): the **whole suite runs**.
  `go build`, `go vet` clean; one failing test, `TestResolveDocumentMIME/Zip`, a
  Windows MIME-registry quirk **present identically in the baseline**.
- **default (mattn/go-sqlite3, needs cgo)**: this machine has no C compiler, so every
  `infrastructure/chatstorage` test fails at `InitializeSchema` with
  `Binary was compiled with 'CGO_ENABLED=0', go-sqlite3 requires cgo to work` —
  including the 30 new ones, for exactly the same reason as the 139 baseline ones. The
  e2e tests **skip cleanly** rather than failing, because they probe the driver with
  `Ping` first.

The baseline was captured on a **git worktree at `bf5a28d`** (the unmodified ticket-25
tip), under both tags, so the comparison is mechanical rather than remembered.

Seven injected defects, all seven detected — see `verify.md`.
