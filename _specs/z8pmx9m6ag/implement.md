---
ticket: z8pmx9m6ag
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-09-01
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6ag"
  github: ""
---

# Implementation — 24 · Enforcement

Applied on branch `ticket/z8pmx9m6ag`, cut from `ticket/z8pmx9m6af` (the tip
carrying ticket 23). No commit is created here; `/publish-pr` is the single git
delivery boundary.

## Baseline, captured on the unmodified tree first

```
go build ./...   OK
go vet ./...     OK
go test ./...    3 packages FAIL, 160 leaf failures
```

Every one of the 160 is the same cause: this machine has **no C compiler**, so
`CGO_ENABLED=0` and `go-sqlite3` compiles to a stub —
`Binary was compiled with 'CGO_ENABLED=0', go-sqlite3 requires cgo to work.`
153 of the 160 lines say so verbatim; the remaining 7 are parent tests of
subtests that do. The failing packages are `infrastructure/chatstorage`,
`infrastructure/whatsapp` and `usecase`.

**Every package this ticket touches was green at baseline** — `cmd`, `ui/rest`,
`ui/rest/middleware`, `pkg/auth`, `config` — so the baseline is not hiding
anything relevant to this change.

## What changed

### New

| File | What it is |
|---|---|
| `src/ui/rest/middleware/require.go` | `Require(permission)` and `RequireAuthenticated()`, plus the two guard registries |
| `src/ui/rest/middleware/coverage.go` | `AssertPolicyCoverage` / `PolicyCoverageViolations`, the public allowlist and the middleware-mount set |
| `src/ui/rest/middleware/websocket_token.go` | `WebsocketAccessTokenQuery()`, replacing `WebsocketQueryAuth` |
| `src/ui/rest/actor.go` | `auditActor(c)` — one definition of "who is acting", shared by the three handlers that log one |
| `src/ui/rest/testprincipal_test.go` | The test principals every guarded-route test needs |
| `src/ui/rest/policy_matrix_test.go` | The §06 matrix, AC-5/AC-6, and the boot-coverage test |
| `src/ui/rest/middleware/{require,coverage,device_defers}_test.go` | The guard, the assertion, and the Finding-D regression |

### Deleted

`src/ui/rest/middleware/require_basic_auth.go`,
`src/ui/rest/middleware/websocketauth.go`.

### Modified

The 12 route files, `auth.go`, `account.go`, `device.go`, `agent.go`,
`debug_retention.go`, `middleware/{authenticate,device}.go`,
`ui/websocket/websocket.go`, `cmd/{rest,root,helpers}.go`,
`config/settings.go`, six test files, and `src/.env.example`, `readme.md`,
`docs/openapi.yaml`.

**95 `middleware.Require(...)` call sites** — 89 on route lines across the 12
files, plus one shared guard value used by the six Chatwoot routes in
`cmd/rest.go` — and four `RequireAuthenticated()` (`/auth/me`, `/app/info`,
`/ws`, and one in a test).

## Deviations from the plan, and why

| # | Deviation | Reason |
|---|---|---|
| D-1 | `AssertPolicyCoverage` lives in `ui/rest/middleware/coverage.go`, **not** `pkg/auth/coverage.go` as the ticket specified | `pkg/auth` is a documented leaf that "imports nothing from this repository", and the check must read the guard registries in `ui/rest/middleware`, which imports `pkg/auth`. The ticket's location is an import cycle. |
| D-2 | The guard is the **first** handler on every route line, not the trailing one §05 of the reference document shows | Fiber v3.4.0 runs handlers first-argument-first; a trailing guard is registered and never executed. Proved by probe, and by the mutation check below. |
| D-3 | `middleware.WebsocketQueryAuth` is replaced by a **new file**, `websocket_token.go`, rather than the old file being edited | The function, its parameter and its purpose all changed; keeping the filename would have made the diff read as a tweak. |
| D-4 | `ui/rest/actor.go` is new and was not in the plan's file list | Three handlers needed the same "who is acting" answer. The alternative was three copies of it, which is how the previous `basicauth.UsernameFromContext` call drifted in the first place. |
| D-5 | `Authenticate` still identifies and does not deny, against AC-11's literal wording | It is a global `app.Use`; `c.Route()` is the `Use` route, so it cannot tell a public route from a guarded one, and denying there would 401 `/auth/login` for any client holding a stale token. AC-11 is satisfied by `Require`'s 401 plus AC-2's guarantee that every non-public route carries one. All three review lenses accepted the argument. |
| D-6 | `POST /auth/logout` was moved to the **public allowlist** (AC-3 amended 7 → 8) and given a rate limiter | `docs/openapi.yaml` has always declared it `security: []`, and its handler authenticates purely from the refresh token in the body. Behind a guard, a session whose 15-minute access token expired could not revoke its 30-day refresh token. Flagged in `spec.md` for the owner to overrule. |
| D-7 | AC-4 covers **23** permissions, not 25 (amended) | `messages.transcript.read` guards response fields and `users.manage` has no endpoint until ticket 26. Neither has a route to map. |
| D-8 | AC-12 extended to `docs/openapi.yaml` (amended) | It is the published API contract and still declared `basicAuth` as the global security scheme. Left alone it would advertise a scheme that no longer exists. |
| D-9 | **AC-13 added**: `gowa rest` refuses to start without `AUTH_JWT_SECRET` | `cmd/helpers.go:170-174` already named this ticket as the one that makes it fatal. Without it the server boots into a state where every route 401s and `/health` still answers OK — unusable, and invisible to any orchestrator. |
| D-10 | `DeviceMiddleware` now defers to the guard when there is no principal — `middleware/device.go` was not in the plan's original file list | The panel's top finding (below). |
| D-11 | The `/ws` upgrade check moved from `app.Use("/ws", ...)` into the `Get` chain, and `RegisterRoutes` takes the guard as an argument | As a `Use` route the check answered 426 before the guard, confirming `/ws` exists to an anonymous caller. The guard is injected because `ui/websocket` ← `infrastructure/whatsapp` ← `ui/rest/middleware` is an import cycle — discovered at compile time, not guessed. |
| D-12 | `account_auth_test.go` was **rewritten**, not deleted-and-partly-ported | Same outcome, smaller diff: two of its four tests keep their subject (`TestAccountGuardDoesNotLeakOntoLaterRoutes`, `TestAccountRoutesShipExactlyFive`) and the other two were re-keyed from 503-without-credentials to 401/403. |
| D-13 | Two superseded tests were folded rather than updated: `TestAgentToggleRequiresCredentials` and `TestRetentionRunWithoutCredentialsIsRejected` | Each used to be distinct because there were two ways to be refused (no header → 401, no credential configured → 503). There is now one way and one answer, so keeping both would have been the same assertion written twice. A comment in each file records where they went. |

## The panel's top finding, and what it cost to fix

All three lenses independently found that `DeviceMiddleware`, installed by
`apiGroup.Group("", ...)` at `cmd/rest.go`, is a Fiber `use` route matched
**before** every device-scoped route — roughly 75 of them. It terminates with
400/404/503 without calling `c.Next()`, so an **anonymous** caller never reached
those routes' guards.

Reproduced before fixing:

```
POST  /send/message   status=400  trace=[DEVICE-MW]      <- the guard never ran
GET   /devices        status=200  trace=[GUARD-devices]  <- registered before the group, fine
```

Two consequences: those routes answered 400, never the 401 AC-6 and AC-11
require; and the 404-vs-other split let an unauthenticated caller enumerate which
device ids exist. A route matrix built on a bare `fiber.New()` would have passed
while production behaved this way — which is why
`middleware/device_defers_test.go` builds the **real** composition.

The fix is three lines in `DeviceMiddleware`: with no principal on the context it
returns `c.Next()` and lets the route's own `Require` answer 401. Nothing is
reordered, so NFR-2 holds and the `Group("", ...)` hazard is untouched.

**Accepted residual, tested and documented:** an authenticated-but-unprivileged
caller who also omits `X-Device-Id` still meets the device layer first and sees
its answer rather than 403. Their request was malformed either way, and one
naming a valid device does get 403. Closing it would mean moving
`DeviceMiddleware` onto each route line — the restructuring this ticket is
forbidden to do.

## Mutation checks — TC-11, run by hand

A green suite proves nothing unless it can go red. Four defects were introduced
one at a time, the suite run, and the tree restored:

| Mutation | Result |
|---|---|
| Guard moved to the **trailing** position on `/send/message` (exactly as §05 of the reference document prescribes) | `TestEveryRouteRequiresExactlyItsSection06Permission` **FAILED** ✓ |
| `DeviceMiddleware`'s deferral removed | `TestDeviceMiddlewareDefersToTheGuardForAnonymousCallers` **FAILED** ✓ |
| Guard removed entirely from `GET /chats` | `TestEveryRouteRequiresExactlyItsSection06Permission` **FAILED** ✓ |
| `Require` made to check a **fixed** permission instead of its argument | `TestEveryRouteRequiresExactlyItsSection06Permission` **FAILED** ✓ |

The first is the one that matters most: it is the exact code the reference
document tells you to write, and without this check it would have shipped with a
fully green suite and zero enforcement.

## Validation run

```
go build ./...   OK
go vet ./...     OK
go test ./...    3 packages FAIL, 160 leaf failures — IDENTICAL to baseline
```

Verified mechanically rather than by eye: the set of failing packages is
byte-identical to the baseline (`diff` of the sorted `FAIL` lines is empty), the
leaf-failure count is the same 160, and the cgo-stub message count is the same
153. No failure in the after-run lacks a cgo cause.

`go test -race` could **not** be run: `-race` requires cgo, and this machine has
no C compiler. The concurrency the ticket introduces is one mutex-guarded map
written at route construction; `TestGuardIsSafeToConstructConcurrently` exercises
it with 64 goroutines but cannot detect a race without the detector. **Carried
forward to `verify.md` as an explicit gap**, with the command to run on a
cgo-capable machine.

## Scope

No deployment runtime file was modified — verified with
`git status --porcelain docker-compose.yml docker/ .github/workflows/`, which
returns nothing. `src/usecase/account.go` is unchanged, as planned: the nine
audit call sites already read a `string` from the context, so only what is
stamped changed.

`gofmt -w` rewrote line endings in eleven files whose content did not change
(this checkout is `core.autocrlf=true`). All eleven were restored with
`git checkout --`, so the change set contains only files with real content
changes.
