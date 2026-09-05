---
ticket: z8pmx9kzc7
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-08-25
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzc7"
  github: ""
---

# Implementation — 16 · Add the account layer above devices

Applied on branch `ticket/z8pmx9kzc7`, cut from `ticket/cu-z8pmx9kcvh` (the tip
carrying the PostgreSQL port: migrations 1–50, the rebinding handle,
`runMigrationsAtomically`). Per the workflow's delivery boundary, **no commit was
created at this stage** — the single publishable commit is made by `/publish-pr`.

## Files changed

### New (10)

| File | What it holds |
|---|---|
| `src/domains/account/account.go` | The API DTOs. `Account` and `AccountDevice` carry **no** token-reference field, which is what makes AC-19 a property of the type. |
| `src/domains/account/interfaces.go` | `IAccountUsecase` — six operations, including the account-scoped resolver. |
| `src/infrastructure/chatstorage/account_repository.go` | The eight account repository methods. A separate file rather than more of the 3 600-line `sqlite_repository.go` (deviation D-1). |
| `src/usecase/account.go` | The usecase, the audit-log actor context, and `ResolveMetaToken`. |
| `src/validations/account_validation.go` | Every closed list, the token-reference allowlist, and the prefix validator. |
| `src/ui/rest/account.go` | `InitRestAccount` + five thin handlers + explicit error mapping. |
| `src/ui/rest/middleware/require_basic_auth.go` | The 503 `ACCOUNTS_AUTH_REQUIRED` guard, mounted once. |
| `src/infrastructure/chatstorage/sqlite_repository_account_test.go` | Schema, visibility, reconnect-regression, upgrade-from-50, and account-operation tests. |
| `src/validations/account_validation_test.go` | Closed lists, the allowlist, and the prefix validator. |
| `src/usecase/account_test.go` | Layering, resolve-time enforcement, DTO structure. |
| `src/ui/rest/account_auth_test.go` | Route enumeration, the 503 guard, and the middleware-leak check. |

### Modified (10)

| File | Change |
|---|---|
| `src/infrastructure/chatstorage/sqlite_repository.go` | Migrations 51–61; `deviceRoutingColumns` + `scanDeviceRoutingTargets`; three device SELECT lists widened; the `SaveDeviceRecord` invariant written down. |
| `src/domains/chatstorage/chatstorage.go` | Seven `DeviceRecord` fields (`GowaAccountID` first) + the `Account` row struct. |
| `src/domains/chatstorage/interfaces.go` | Eight account methods + five sentinel errors. |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | Eight delegating methods. |
| `src/cmd/root.go` | `accountUsecase` global + construction. |
| `src/cmd/rest.go` | The guarded account group, mounted above `headerDeviceGroup`. |
| `docs/openapi.yaml` | The five endpoints, six schemas, one shared 503 response, one tag. |
| `src/infrastructure/chatstorage/AGENTS.md` | The stale migration count (29 → 61). |
| `src/infrastructure/chatstorage/sqlite_repository_debug_test.go` | Count 50 → 61. |
| `src/infrastructure/chatstorage/sqlite_repository_transcript_test.go` | `migrations[48:]` → `migrations[48:50]`. |

**No deployment runtime file was touched** (`docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`, the three workflows).

## Deviations from the plan

**D-1 — the account repository lives in its own file.** The plan listed the eight
methods under `sqlite_repository.go`. They went into a new
`infrastructure/chatstorage/account_repository.go` in the same package instead:
that file is already 3 600 lines, and the package's own precedent is one concern
per file (`dbhandle.go`, `debug_retention.go`). No behaviour difference — same
package, same receiver, same `?` placeholder form.

**D-2 — `usecase/account.go` rather than a `usecase/account` package.** Announced
in the plan and carried out. Every usecase in this repo is a file in the flat
`package usecase`; a subdirectory would be the only one of its kind. AC-21's actual
requirement — the handler never touches `IChatStorageRepository` — holds either
way, and `ui/rest/account.go` imports only `domains/account`.

**D-3 — route paths are relative to the group.** The plan showed
`app.Post("/accounts", …)`. Under the `apiGroup.Group("/accounts", …)` the guard is
mounted on, that would serve `/accounts/accounts`. `InitRestAccount` registers
`"/"`, `"/:account_id/devices"`, … instead. Verified against Fiber v3 directly:
`"/"` under the prefix serves both `/accounts` and `/accounts/`, and a route
registered *after* the group does not inherit its middleware
(`TestAccountGuardDoesNotLeakOntoLaterRoutes`).

**D-4 — `isUsableMetaTokenRefPrefix` extracted.** The prefix check was inline in
`MetaTokenRefPrefix`, which resolves through a `sync.Once` and so cannot be
exercised twice in one test binary. The predicate is now its own function, and the
test drives it directly with the widening prefixes the security lens named (`D`,
`A`, `META`, `""`).

**D-5 — the upgrade test replaced the manual boot step.** The plan called for a
manual boot against a copy of a pre-existing database. That was implemented as
`TestAccountMigrationsApplyToAPreExistingDatabase` instead: it seeds two companion
slots, rolls the schema back to version 50, runs `InitializeSchema`, and asserts
the move to 61 with the rows intact and the defaults in place. On PostgreSQL that
second `InitializeSchema` is the single transaction all eleven statements share —
the exact path a real deployment takes on its first boot after this ticket. It is
strictly better than a manual step because it runs on both engines and stays in CI.

**D-6 — `ErrAccountNotFound` added.** The plan named four sentinels; a fifth was
needed once the existence check ran on all three device endpoints (security finding
SEC1), so an unknown account answers 404 rather than reporting a routing change
that did not happen.

## Notes on what was deliberately not done

- No runtime path reads any new column. `getWebhookConfigForDevice`,
  `SaveDeviceRecord`, the device manager and the send paths are untouched.
- `POST /accounts/:account_id/meta-numbers`, `chats.bsuid` and
  `idx_devices_account_priority` are not shipped, and a test asserts the last two
  are absent from the migration list.
- `POST /devices` is unchanged; attach links only.
- No `config` global and no CLI flag were added for the allowlist prefix.
