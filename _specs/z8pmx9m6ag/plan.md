---
ticket: z8pmx9m6ag
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-09-01
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6ag"
  github: ""
---

# Plan — 24 · Enforcement (revision 2, after the advisory panel)

Revision 1 was reviewed by the three lenses (`senior-reviewer`,
`security-reviewer`, `performance-reviewer`) **against the source**, not against
its own prose. They returned 38 findings. **Three majors were reached
independently by all three lenses**; the worst of them would have shipped an
unauthenticated device-enumeration oracle while every planned test passed. The
`Panel response` section at the end records every finding and its disposition.

## Approach

Mechanical and explicit. The permission is a compile-time constant written
literally beside the handler, so there is no second source of truth and no path
matching at runtime. A boot-time assertion is the safety net that makes
forgetting impossible.

### Finding A — the reference document's route shape enforces nothing

`gowa-auth-rbac-ar.html` §05 prescribes:

```go
app.Post("/send/message", rest.SendText, middleware.Require(perm.MessagesSend))
```

Fiber v3.4.0 `app.Add` documents: *"The provided handlers are executed in order,
starting with `handler` and then the variadic `handlers`."* A probe against the
vendored module confirms it — with the guard trailing, the request order was
`[HANDLER]`: **the guard never ran.**

Written as the document specifies, this ticket would have attached a guard to
~104 routes, passed a boot-coverage assertion (the handler *is* in the chain) and
enforced **nothing**.

**This is not a new discovery — it is repo precedent the reference document
contradicts.** `src/ui/rest/auth.go:59-66` already states the rule verbatim, from
ticket 23: *"THE LIMITER MUST BE THE FIRST HANDLER on the route… a trailing
limiter is registered and never executed: a rate limit that exists in the source,
passes review, and does nothing."* This plan follows the repository, not the
document.

**Decision: the guard is the FIRST handler on every route line.**

### Finding B — closure code pointers are not stable, so coverage cannot compare them

Detecting "does this route carry `Require`?" by comparing
`reflect.ValueOf(handler).Pointer()` to a reference closure **fails**: Go 1.25
inlines the factory per call site, so two closures returned by the same literal
reported different code pointers (`TestPtr.req.func1` vs `TestPtr.req.func2`).

**Decision: each guard constructor registers its own closure's code pointer at
construction time**, under a mutex (the panel flagged the unsynchronised map).
Whatever pointer a call site produces is the pointer that was registered, so
inlining is irrelevant. Detection is exact in both directions.

### Finding C — `pkg/auth/coverage.go` would be an import cycle

`pkg/auth` is a documented **leaf** (`perm.go`: *"it imports nothing from this
repository"*), and coverage must consult the guard registry in
`ui/rest/middleware`, which imports `pkg/auth`.
**Decision: `src/ui/rest/middleware/coverage.go`.** Deviation from the ticket's
file list, recorded.

### Finding D — `DeviceMiddleware` runs before every device-scoped guard

**Reached independently by all three lenses, and confirmed by probe.**
`apiGroup.Group("", middleware.DeviceMiddleware(dm))` (`cmd/rest.go:237`) is a
Fiber `use` route, matched ahead of everything registered after it.
`middleware/device.go:39-61` terminates with 400 `DEVICE_ID_REQUIRED` / 404
`DEVICE_NOT_FOUND` / 503 without calling `c.Next()`.

Probe result on a faithful reproduction:

```
POST  /send/message   status=400  trace=[DEVICE-MW]     <- guard never reached
GET   /devices        status=200  trace=[GUARD-devices] <- registered before the group, fine
```

So for the ~75 device-scoped routes an **anonymous** caller would get 400/404,
never 401 — an unauthenticated device-existence enumeration oracle, and AC-6,
AC-11, TC-4 and TC-5 false in production while a matrix test on a bare
`fiber.New()` passed.

**Decision: `DeviceMiddleware` defers.** With no principal on the context it
returns `c.Next()` immediately and lets the route's own `Require` answer 401.
This is the minimal fix: no registration is reordered, so NFR-2 holds and the
`Group("", …)` hazard the ticket forbids disturbing is untouched.

Residual, accepted and recorded: an **authenticated but under-privileged** caller
who omits `X-Device-Id` still receives 400 before the 403. Their request was
malformed either way, and a caller who supplies a valid device id gets the
correct 403. Closing this would require moving `DeviceMiddleware` onto each route
line — which is exactly the restructuring the ticket forbids.

### Finding E — `GetRoutes(true)` hides terminal `use` mounts

Revision 1 filtered `use` routes. `app.Use(basePath+"/statics", static.New(…))`
(`cmd/rest.go:76`) is a `use` route that **is terminal and does serve files**, so
it was invisible to coverage, AC-3's `{BASE}/statics/*` entry was dead code, and
a future terminal `Use` mount would ship publicly readable with a green boot —
the exact failure NFR-3 exists to prevent.

**Decision: walk `GetRoutes(false)` and classify `use` routes too**, against a
closed, enumerated set of the middleware mounts this server installs: `/`
(the global chain: CORS, Recovery, RequestTimeout, logger, the WS token hoist,
Authenticate, DeviceMiddleware) and `{BASE}/statics` (public, AC-3, with the
follow-up ticket noted inline). Anything else → `Fatalln`.

### Finding F — how AC-4 / TC-10 is actually proven, and why the allow-half is dropped

Per Finding B the permission cannot be read back off a handler, so the mapping is
proven **behaviourally**. Revision 1 drove each route twice. The performance lens
showed the allow-half is both expensive and **redundant**:

> A principal holding **every permission except P** is denied 403 **iff** the
> route carries exactly `Require(P)`. No guard → not denied → fail. `Require(P')`
> with P'≠P → the principal holds P' → not denied → fail.

The negative case alone is a complete proof of the mapping, it still catches
Finding A's trailing-guard defect (the handler would run and answer non-403), and
every call short-circuits at the guard instead of executing real handlers that
block on whatsmeow under Fiber's 1-second `app.Test` timeout.

**Decision: negative-only matrix, app built once per package.** Positive
assertions stay where AC-5 already requires them (TC-4/TC-5, a handful of
routes). Assertions key on the guard's machine code `PERMISSION_DENIED`, never on
the status alone.

### Finding G — `AUTH_JWT_SECRET` absent must now be fatal

`cmd/helpers.go:158-180` returns `nil` when the secret is unset and states
verbatim: *"the ticket that first DEPENDS on a thing is the ticket that gets to
make it fatal. **That is ticket 24**, where JWT becomes the enforcer and booting
without a secret genuinely means unguarded."*

Without this the server boots into a dead-but-healthy state: no principal ever
exists → every guarded route 401 → `/auth/login` answers 503 → and `/health`
still returns 200, so no orchestrator ever rolls back.

**Decision: `logrus.Fatalln` in `restServer` when the auth usecase is nil.**
New AC-13 / TC-13. `gowa mcp` is unaffected — it never calls `initAuthUsecase`.

## The route table (§06, as it will be wired)

| Permission | Routes |
|---|---|
| `chats.read` | `GET /chats`, `GET /chat/:chat_jid/messages` |
| `chats.write` | `POST /chat/:chat_jid/{pin,disappearing,archive}` |
| `messages.read` | `GET /message/:message_id/download` |
| `messages.mark` | `POST /message/:message_id/{read,star,unstar}` |
| `messages.send` | 12× `POST /send/*`, `POST /message/:message_id/{reaction,revoke,delete,update,forward}` |
| `messages.debug.read` | `GET /message/:message_id/debug` |
| `messages.transcript.read` | **no route** — response fields only (ticket 25) |
| `devices.read` | `GET /devices`, `GET /devices/:device_id`, `GET /devices/:device_id/status`, `GET /app/devices`, `GET /app/status` |
| `devices.create` | `POST /devices` |
| `devices.pair` | `GET /devices/:device_id/login`, `POST /devices/:device_id/login/code`, `POST /devices/:device_id/logout`, `POST /devices/:device_id/reconnect`, `GET /app/login`, `GET /app/login-with-code`, `GET /app/logout`, `GET /app/reconnect`, `GET /app/passkey`, `POST /app/passkey/response`, `POST /app/passkey/confirm` |
| `devices.delete` | `DELETE /devices/:device_id` |
| `devices.webhook.read` | `GET /devices/:device_id/webhook` |
| `devices.webhook.write` | `PATCH /devices/:device_id/webhook` |
| `contacts.read` | 8× `GET /user/*` (info, avatar, check, business-profile, my/groups, my/contacts, my/newsletters, my/privacy) |
| `contacts.write` | `POST /user/avatar`, `POST /user/pushname` |
| `groups.read` | `GET /group/info`, `GET /group/info-from-link`, `GET /group/participants`, `GET /group/participants/export`, `GET /group/participant-requests`, `GET /group/invite-link` |
| `groups.write` | `POST /group` **(no trailing slash — it is not under `/group/`)** and 13× `POST /group/*` |
| `newsletters.read` | `GET /newsletter/messages` |
| `newsletters.write` | `POST /newsletter/unfollow` |
| `calls.reject` | `POST /call/reject` |
| `accounts.manage` | 8× `/accounts/*` — **per route, never on the group** (see below) |
| `users.manage` | **no route** — ticket 26 |
| `chatwoot.manage` | `POST /chatwoot/sync`, `GET /chatwoot/sync/status`, `GET /chatwoot/configs`, `GET|PUT|DELETE /devices/:device_id/chatwoot/config` |
| `admin.debug.toggle` | `POST /agent/debug/toggle` |
| `admin.retention.run` | `POST /agent/debug/retention/run` |

**23 of the 25 permissions have a route.** `messages.transcript.read` guards
response fields and `users.manage` has no endpoint until ticket 26, so AC-4's
"all 25 permissions" is satisfiable only for 23. AC-4 is amended accordingly.

**`/accounts` is guarded per route, never on the group.** Probe: a route
registered under `Group("/accounts", mw)` reports `handlers=1` — Fiber registers
group handlers as a *separate* `use` route and never appends them to the child
routes' `Handlers`. Guarding at the group would therefore make the boot assertion
`Fatalln` on eight unguarded routes. (Revision 1 contradicted itself here.)

### Routes outside the §06 table

| Route | Decision | Reason |
|---|---|---|
| `POST /auth/logout` | **Public allowlist + rate limiter** | `docs/openapi.yaml:161` declares `security: []`; the handler (`ui/rest/auth.go:213-231`) authenticates purely from the refresh token in the body and never reads the principal. Guarding it would mean a session whose 15-minute access token expired **cannot revoke its 30-day refresh token** — revocation unavailable exactly when it is most needed. It is also currently the only `/auth` route with no rate limit. **This amends AC-3 from 7 entries to 8.** |
| `GET /auth/me` | `RequireAuthenticated()` | Every authenticated user must read their own principal. No catalogue permission fits and adding a 26th would contradict AC-4. |
| `GET /app/info` | `RequireAuthenticated()` | Version and limits; AC-3's allowlist is closed. |
| `GET /ws` | `RequireAuthenticated()` | This ticket changes only *how* `/ws` authenticates. What it broadcasts — and therefore the right permission — is ticket 25's per-principal fan-out. |

`RequireAuthenticated` registers in a **separate** registry from `Require`, and
coverage accepts it **only** for those three explicitly enumerated routes. The
panel's point stands: otherwise "guarded by a real permission" and "open to any
logged-in user" become indistinguishable to the assertion, and a route copied
from the `/ws` line would boot clean while the `user` role could call it.

## Steps

1. **`src/ui/rest/middleware/require.go` (new).** `Require(permission)` and
   `RequireAuthenticated()`. Both read the principal via `PrincipalFromContext`:
   - no principal, or not active → **401** `UNAUTHENTICATED`;
   - principal lacks the permission → **403** `PERMISSION_DENIED`.
   Each registers its closure pointer in its own mutex-guarded registry
   (Finding B). Logging is **`Debug` only** — a guard on ~104 routes emitting a
   warn per refusal hands any scanner a log-amplification lever; `authenticate.go:66-70`
   already records this lesson. No token, permission list or principal id is
   logged above `Debug`.

2. **`src/ui/rest/middleware/coverage.go` (new).**
   `AssertPolicyCoverage(app, basePath)` walks `GetRoutes(false)` (Finding E).
   - `use` routes: path must be in the closed middleware-mount set.
   - endpoint routes: allowlisted **or** carrying a registered guard pointer.
   - Path comparison applies Fiber's own prettify to **both** sides — `ToLower`,
     then `TrimRight('/')` guarded by `len > 1` — because `Route.Path` is the raw
     registered path while Fiber routes on the unexported prettified one.
   - Method `HEAD` is normalised to `GET` for allowlist lookup: Fiber generates
     auto-HEAD clones in `startupProcess`, which `app.Test` triggers, so a test
     that asserts coverage after a request sees them (probe-confirmed).
   - The allowlist is built as `basePath + "/"` for the UI root — correct for
     both `""` → `/` and `/gowa` → `/gowa/` (probe-confirmed) — `/health` stays
     un-prefixed, the webhooks are prefixed. **Never `HasPrefix` for the root
     entry**: a `/` entry matched as a prefix would allowlist the entire API and
     the assertion would pass on a wide-open server.
   - Collects and reports **every** offending route, then `logrus.Fatalln`.
   - `PolicyCoverageViolations(app, basePath) []string` returns the list so tests
     can assert without killing the process.

3. **Attach guards to all 13 route files**, guard **first** (Finding A).

4. **`src/ui/rest/middleware/device.go`:** `DeviceMiddleware` defers when no
   principal is on the context (Finding D).

5. **`cmd/rest.go`:** delete the basic-auth block and `newBasicAuthMiddleware`;
   `logrus.Fatalln` when the auth usecase is nil (Finding G); register
   `middleware.WebsocketAccessTokenQuery()` immediately before
   `app.Use(middleware.Authenticate(...))`; call
   `middleware.AssertPolicyCoverage(app, config.AppBasePath)` as the last
   statement before `Listen`; warn loudly at boot when Chatwoot is enabled with
   an empty webhook secret.

6. **Convert the five basic-auth-keyed guards** (AC-8): delete
   `require_basic_auth.go`; `accountLayerVisible(c)` → `accounts.manage` on the
   principal (all three call sites at `device.go:95,106,123` have `c` in scope —
   verified); `agent.go` and `debug_retention.go` drop the config check (their
   routes now carry `Require`) and take the actor from the principal;
   `root.go:577` warns about `AUTH_JWT_SECRET`, not `APP_BASIC_AUTH`.

7. **Audit actor from the principal** (AC-9): `ui/rest/account.go
   accountContext()` stamps `principal.UserID`. `usecase/account.go` is
   unchanged — `ContextWithAccountActor` takes a `string` and the nine call sites
   already read it (verified at `usecase/account.go:104,156,193,273,298,327,332,362,390`).
   Note the actor also reaches `Sweeper.Sweep(ctx, actor)`, so persisted
   retention records change from a username to a user id — intended.

8. **Delete basic auth** (AC-7), including the comment references at
   `authenticate.go:35` and `rest.go:134`.
   `middleware.WebsocketAccessTokenQuery()` replaces `WebsocketQueryAuth`: it
   checks `websocket.IsWebSocketUpgrade(c)` **first** (so a non-upgrade request
   never parses the query string), copies `?access_token=` into
   `Authorization: Bearer …`, and then **strips the parameter from the request
   URI** so it does not reach anything downstream. `?authorization=` is not read.
   The `/ws` upgrade check moves from `app.Use("/ws", …)` into the `Get` chain
   **after** the guard, so an anonymous non-upgrade request gets 401 rather than
   confirming `/ws` exists with a 426.

9. **AC-11.** `Authenticate` stays identify-only and is **not** made to deny. It
   is a global `app.Use`; `c.Route()` is the `Use` route, so it cannot consult
   route policy, and denying there would 401 `POST /auth/login` and
   `/auth/refresh` for any client attaching a stale bearer token. All three
   lenses accepted this argument, with the security lens' caveat recorded: **the
   deviation is sound only because coverage is exhaustive** — AC-11 holds because
   AC-2 does, which is why Finding E had to be fixed first.

10. **Docs** (AC-12, amended to include the API contract): `.env.example`,
    `README.md` and `docs/openapi.yaml` — remove `APP_BASIC_AUTH`,
    `--basic-auth`, the `?authorization=` WebSocket form and the "requires
    APP_BASIC_AUTH" notes; replace the `basicAuth` security scheme with
    `bearerAuth`; document `AUTH_*` and `?access_token=`. README's
    docker-compose *examples* are README content and in scope; the real
    `docker-compose.yml` is untouched (C-4 — verified to contain no basic auth).

11. **Tests**: `require_test.go` (the 401/403 split, and that a non-guard closure
    is never accepted by the registry), `coverage_test.go` (TC-1, TC-2, plus the
    classifier under `AppBasePath` ∈ {`""`, `/gowa`, `/GOWA`}),
    `policy_matrix_test.go` (negative-only matrix, app built once),
    `device_defers_test.go` (the Finding-D regression: real composition, `dm=nil`,
    anonymous → **401**, which without the deferral would be 503). Port the two
    surviving tests out of `account_auth_test.go`. Update
    `cmd/rest_test.go`, `cmd/root_test.go`, `ui/rest/{agent,debug_retention,device_account,account_lifecycle,auth}_test.go`.
    Run the new tests under `-race`.

## Files to change

**New**
- `src/ui/rest/middleware/require.go`, `coverage.go`, `websocket_token.go`
- `src/ui/rest/middleware/{require,coverage,device_defers}_test.go`
- `src/ui/rest/policy_matrix_test.go`

**Deleted**
- `src/ui/rest/middleware/require_basic_auth.go`
- `src/ui/rest/middleware/websocketauth.go`
- `src/ui/rest/account_auth_test.go` (**two of its four tests are ported first**,
  see Panel response S6)

**Modified**
- `src/ui/rest/{app,call,chat,send,user,message,group,newsletter,device,account,agent,debug_retention,auth}.go`
- `src/ui/rest/middleware/{authenticate,device}.go`
- `src/ui/rest/{agent,debug_retention,device_account,account_lifecycle,auth}_test.go`
- `src/ui/websocket/websocket.go`
- `src/cmd/{rest,root,helpers}.go`, `src/cmd/{rest,root}_test.go`
- `src/config/settings.go`
- `src/.env.example`, `README.md`, `docs/openapi.yaml`

**Not touched:** `src/usecase/account.go` (step 7), `src/pkg/auth/*` (C-3), all
deployment runtime files (C-4).

## Validation strategy

Baseline captured on the unmodified tree **before** any edit (recorded in
`implement.md`), then `go build ./...`, `go vet ./...`, `go test ./...` and
`go test -race ./ui/rest/... ./cmd/...` from `src/`, compared against it.

Plus the TC-11 **manual** mutation check — not a runnable test (it requires
hand-editing source, so it violates VP-3's determinism/non-interactivity rule).
It is performed once by hand and its result recorded in `implement.md`: revert
one route to the trailing-guard form, confirm the suite goes red, restore.

## Rollback

**Redeploy the previous binary.** Basic auth is deleted rather than flagged off,
so no configuration-level rollback exists (C-2). The database needs no rollback:
no migration is added and no row is written per request.

## Out of scope

As `spec.md`. Additionally: no change to the permission catalogue or the seeded
role grants (ticket 22 owns those), and no change to `usecase/account.go`.

## Known operational consequences (restated for the record)

1. **The dashboard stops working the moment this ships.** `gowa-ui v1.6.0` sends
   `Authorization: Basic` and opens the WebSocket with `?authorization=`. A
   matching UI release with a login screen must be ready first, or an interface
   outage between the two deployments must be accepted. The REST API stays fully
   usable via `curl` and tokens.
2. **`--basic-auth` / `-b` becomes a crash-loop, not a 401.** Cobra exits
   non-zero on an unknown shorthand, so any launcher still passing the flag fails
   to start. Every such launcher must be updated in the same deployment.
3. **`AUTH_JWT_SECRET` becomes mandatory for `gowa rest`** (Finding G). A
   deployment upgrading without one will not start. This is deliberate and is
   what `cmd/helpers.go:170-174` promised this ticket would do.
4. **No non-admin user may be created until ticket 25 ships.** The `user` role
   holds `devices.pair`, `devices.read` and `devices.create`, and
   `/devices/:device_id/{login,logout,reconnect}` carry no ownership scoping — so
   the lowest-privilege token could pull another tenant's pairing QR or
   force-logout their number. Basic auth hides this today because every
   authenticated caller is effectively admin; this ticket creates the first real
   privilege boundary and does not scope it. **Ship admin-only until ticket 25.**
5. **The Chatwoot webhook still fails open with an empty secret**
   (`ui/rest/chatwoot.go:99-101`), and AC-3 permanently allowlists it — after
   this ticket it is the only unauthenticated path that can cause outbound
   WhatsApp sends. A loud boot warning is added here; making it fatal is left to
   the follow-up ticket because the ticket declares it out of scope and a fatal
   would break existing Chatwoot deployments on upgrade.
6. **`/statics` stays public** and holds per-tenant media at
   `statics/media/<phone>/<date>/<name>`. The allowlist entry carries the
   deferral inline so it is visible at the one place that grants it.
7. **`?access_token=` in a URL** reaches reverse-proxy access logs, browser
   history and `Referer`. Verified it is *not* leaked by this repo's own logger
   (`logger.New()` uses `${path}`, which excludes the query string). Mitigated
   in-process by stripping the parameter after hoisting it; the upstream-proxy
   exposure is an accepted residual, with a short-lived single-use `ws` ticket
   recommended as the follow-up.
8. **`gowa mcp` remains entirely unauthenticated** (`cmd/mcp.go:73-85` runs a
   mark3labs SSE server, not Fiber). After this ticket the REST surface is fully
   locked while MCP mode is an open send path. Added to `spec.md` Out of scope
   explicitly rather than left unsaid.

## Panel response

38 findings. **Adopted: 27. Declined with reason: 4. Answered/accepted as
correct-as-planned: 7.** Three majors were reached independently by all three
lenses (D, E-class ordering, and the `AUTH_JWT_SECRET` boot decision).

### Adopted — design changed

| # | Lens(es) | Finding | Change |
|---|---|---|---|
| P1 | senior + security + perf | `DeviceMiddleware` pre-empts the guard on ~75 routes → anonymous device enumeration; AC-6/AC-11/TC-4/TC-5 false in production | Finding D; `device.go` defers on no principal; added to Files to change; dedicated regression test |
| P2 | security + perf | `GetRoutes(true)` hides terminal `use` mounts; `{BASE}/statics/*` was dead allowlist code | Finding E; walk `GetRoutes(false)` and classify `use` routes against a closed mount set |
| P3 | senior + security | `AUTH_JWT_SECRET` unset → dead-but-healthy boot; `helpers.go` names ticket 24 as the one that makes it fatal | Finding G; new AC-13/TC-13; step 5 |
| P4 | senior + security | `POST /auth/logout` is documented `security: []` and authenticates from the body; guarding it strands expired sessions | Moved to the allowlist + rate limiter; **AC-3 amended 7 → 8** |
| P5 | security | `RequireAuthenticated` in the same registry as `Require` makes "any logged-in user" indistinguishable from a real permission | Separate registry; accepted only for 3 enumerated routes |
| P6 | perf | TC-10's allow-half is redundant *and* executes ~104 real handlers under a 1 s `app.Test` timeout | Finding F; negative-only matrix, app built once |
| P7 | senior | Steps 4 and 5 contradicted each other on `/accounts`; the group form defeats the assertion | Per-route only; probe-confirmed and documented |
| P8 | senior | Files to change omitted `cmd/rest_test.go`, `account_lifecycle_test.go`, `auth_test.go` | All added |
| P9 | senior | Deleting `account_auth_test.go` wholesale drops 2 tests whose subject survives | Both ported (S6) |
| P10 | senior | `docs/openapi.yaml` still declares `basicAuth` globally — the published contract would advertise a deleted scheme | Added to scope; **AC-12 amended** |
| P11 | senior + security | Guard registry is an unsynchronised package-level map | Mutex; `-race` in validation |
| P12 | security | `Route.Path` is raw; Fiber routes on the prettified path | Prettify both sides; classifier tests for 3 base-path shapes |
| P13 | security | `AppBasePath="/gowa"` makes the UI root `"/gowa/"`; a literal allowlist fails boot on every sub-path deployment; `HasPrefix` on `/` would allowlist everything | `basePath + "/"`; explicit "never HasPrefix" note; probe-confirmed |
| P14 | security | auto-HEAD clones appear once `app.Test` triggers `startupProcess` | Normalise HEAD→GET; probe-confirmed |
| P15 | perf | An unlogged decision: a warn-per-refusal on ~104 routes is a log-amplification lever | `Debug` only, nothing sensitive above it |
| P16 | senior + security | `app.Use("/ws")` answers 426 before the guard, confirming `/ws` exists anonymously | Upgrade check moved into the `Get` chain after the guard |
| P17 | perf | `WebsocketAccessTokenQuery` must short-circuit on `IsWebSocketUpgrade` before touching the query string | Preserved explicitly in step 8 |
| P18 | security | `?access_token=` reaches proxy logs / history / `Referer` | Parameter stripped after hoisting; residual recorded (consequence 7) |
| P19 | security | The `user` role can pull another tenant's pairing QR — this ticket creates the first privilege boundary and does not scope it | Consequence 4: **admin-only until ticket 25** |
| P20 | security | Chatwoot webhook fails open and is permanently allowlisted; "separate ticket" is not a mitigation once the other guard is gone | Loud boot warning added; residual recorded (consequence 5) |
| P21 | senior | Removing `-b`/`--basic-auth` is a crash-loop, not a 401 | Consequence 2 |
| P22 | senior + perf | TC-11 is not a runnable test and violates VP-3 | Downgraded to a manual one-off recorded in `implement.md` |
| P23 | senior | Revision 1 presented Finding A as novel; `ui/rest/auth.go:59-66` already states the rule | Corrected — it is repo precedent the reference document contradicts |
| P24 | senior | `gowa mcp` is unauthenticated and neither covered nor declared out of scope | Added to `spec.md` Out of scope + consequence 8 |
| P25 | senior | AC-4's "all 25 permissions" is not literally satisfiable | Stated in the table; **AC-4 amended to 23** |
| P26 | senior | `POST /group` is not under `/group/`; "12 route files" vs 13 listed | Table and step 3 corrected |
| P27 | security | AC-7's repo-wide grep still hits comment references not in Files to change | `authenticate.go` and `rest.go` comments added |

### Declined — with reasons

| # | Lens | Finding | Why declined |
|---|---|---|---|
| P28 | security | Add `POST /auth/ws-ticket` — a single-use ≤60 s `aud:"ws"` ticket instead of reusing the access token | A new endpoint with new token semantics is a ticket, not a step. The recommended minimum (strip the parameter after hoisting) **is** adopted; the ticket is recorded as the follow-up. |
| P29 | security | Temporarily map `/devices/:device_id/*` pair routes to `accounts.manage` | Directly contradicts AC-4 and the §06 table, and would silently diverge the code from the reference document this ticket is measured against. The operational constraint (admin-only until ticket 25) achieves the same protection without lying about the mapping. |
| P30 | security | Make an empty `CHATWOOT_WEBHOOK_SECRET` fatal at boot | The ticket declares the Chatwoot fail-open out of scope, and a fatal would break every existing Chatwoot deployment on upgrade — a second forced-restart on top of consequence 3. A loud warning is adopted instead and the residual is recorded. |
| P31 | security | Have `Authenticate` flag a rejected token so `Require` can emit `TOKEN_EXPIRED` vs `UNAUTHENTICATED` | A genuine UX improvement, but it widens the guard's response vocabulary and belongs with the UI ticket that consumes it. Recorded as a follow-up; nothing in this ticket depends on it. |

### Answered — no change needed

| # | Lens | Point |
|---|---|---|
| P32 | senior | The §06 route table **is** complete — every registered production route appears in it or in the three-route decision table. Confirmed by an independent count. |
| P33 | senior | `usecase/account.go` genuinely needs no change: `ContextWithAccountActor` takes a `string`, nine call sites, matching AC-9. |
| P34 | senior | All three `accountLayerVisible()` call sites have `c fiber.Ctx` in scope — the signature change is safe. |
| P35 | perf | The linear scan in `HasPermission` is correct: ~21 comparisons, 20-40 ns, zero allocations, ~0.5 % of the JWT parse two handlers earlier. A map or bitmask would be worse. **No change.** |
| P36 | perf | Binary search at n=25 is noise or a small loss. **No change.** |
| P37 | perf | "Zero queries" verified true — `Verify` is a pure parse plus one atomic load and map read; no ticker, no per-request rebuild. NFR-1 holds as written. |
| P38 | perf | The allow path is allocation-free; the 403 body is built only on the deny path; ~104 closure allocations at boot total a few KB. The real new per-request cost is the JWT HMAC parse (~3-8 µs) replacing a map lookup — accepted and recorded. |
