---
ticket: z8pmx9m6ag
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-09-01
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6ag"
  github: ""
---

# Specification — 24 · Enforcement

## Business goal

Tickets 22 and 23 built an identity: users, roles, a permission catalogue, a JWT
service and an `Authenticate` middleware that turns a bearer token into a
`Principal`. None of it decides anything yet — `Authenticate` identifies and
passes every request through, and HTTP basic auth is still the only thing that
guards a route. This ticket turns identity into **authorization** and deletes the
old mechanism in the same change, so there is never a deployment running two
half-enforcing schemes at once.

## User story

As the operator of a gateway that fronts several customers' WhatsApp numbers, I
want every endpoint to state the permission it requires and the server to refuse
to boot if any endpoint was left unclassified, so that a read-only user cannot
send a message and a forgotten route cannot ship silently open.

## Functional requirements

- **REQ-1** — A per-route guard exists that admits a request only when the
  authenticated principal holds a named permission.
- **REQ-2** — Every non-public route carries that guard. The route's permission
  is a compile-time constant written on the route line; nothing matches request
  paths at runtime to discover a policy.
- **REQ-3** — A boot-time assertion walks the registered routes and refuses to
  start the server if a route is neither publicly allowlisted nor guarded.
- **REQ-4** — The public allowlist is a closed, explicitly enumerated set.
- **REQ-5** — Anonymous and under-privileged are answered differently: 401 for
  "who are you", 403 for "I know you and you may not".
- **REQ-6** — HTTP basic auth is removed from the product: middleware, config
  field, CLI flag, environment binding and documentation.
- **REQ-7** — Every guard that was keyed on "is basic auth configured" becomes a
  permission check on the principal.
- **REQ-8** — The account audit log records the acting user's identity under JWT.
- **REQ-9** — The WebSocket endpoint authenticates with a bearer token supplied
  as a query parameter, because a browser cannot set a header on a WebSocket.
- **REQ-10** — Operator-facing documentation describes the `AUTH_*` keys and no
  longer describes `APP_BASIC_AUTH`.

## Non-functional requirements

- **NFR-1** — The guard performs **zero** database queries; it reads the
  in-memory principal built by ticket 23.
- **NFR-2** — Route registration order, path prefixes and group structure are
  unchanged. In particular the `Group("", DeviceMiddleware)` hazard documented at
  `cmd/rest.go` must not be disturbed.
- **NFR-3** — The failure mode of a forgotten route is a **refusal to boot**, not
  a silent grant and not a silent denial discovered in production.
- **NFR-4** — A denial reveals nothing about the caller's privileges beyond the
  status code and a stable machine code.
- **NFR-5** — `go build ./...`, `go vet ./...` and `go test ./...` pass from
  `src/`.

## Constraints

- **C-1** — Owner decision: **no transition mode.** There is no `AUTH_MODE` and
  no dual-auth period. JWT is the only path the moment this ships.
- **C-2** — Rollback is **redeploy the previous binary**. Because basic auth is
  deleted rather than flagged off, no configuration-level rollback exists. The
  database needs no rollback.
- **C-3** — `pkg/auth` is a documented leaf that imports nothing from this
  repository; it must stay one.
- **C-4** — Deployment runtime files (`docker-compose.yml`, `docker/*`,
  `.github/workflows/*`) are out of scope and must not be modified.
- **C-5** — Device ownership scoping, field redaction and per-principal WebSocket
  fan-out belong to ticket 25; user administration endpoints to ticket 26.

## Acceptance criteria

- **AC-1** — `middleware.Require(permission)` exists and is attached to **every**
  non-public route, positioned so that it actually executes before the handler.
  No route prefix or group structure changes.
- **AC-2** — A boot-time policy-coverage assertion runs after all registrations
  and before `Listen`; a route that is neither in the public allowlist nor
  guarded causes `logrus.Fatalln` naming the offending method and path.
- **AC-3** — The public allowlist is exactly: `GET /health`, `GET /` (exact
  match, not prefix), `{BASE}/statics/*`, `POST /chatwoot/webhook`,
  `POST /chatwoot/webhook/:device_id`, `POST /auth/login`, `POST /auth/refresh`,
  `POST /auth/logout`.
  > **AMENDED after panel review** (8 entries, not the ticket's 7).
  > `docs/openapi.yaml:161` declares `POST /auth/logout` `security: []`, and its
  > handler authenticates purely from the refresh token in the body. Guarding it
  > would mean a session whose 15-minute access token has expired cannot revoke
  > its 30-day refresh token — revocation unavailable exactly when it is most
  > needed. It gains a rate limiter, which it lacks today. Flagged for the owner
  > to overrule.
- **AC-4** — The route-to-permission mapping matches the table in §06 of the
  reference document, for the **23** permissions that have a route.
  > **AMENDED after panel review** (23, not the ticket's 25).
  > `messages.transcript.read` guards response fields, not a route, and
  > `users.manage` has no endpoint until ticket 26. The remaining 23 are
  > covered exhaustively. Flagged for the owner to overrule.
- **AC-5** — A `user`-role token receives **403** on every `/send/*` route and on
  `POST /chat/:chat_jid/{pin,archive,disappearing}`, and is **not refused** on
  `GET /chats`.
- **AC-6** — An unauthenticated request to a non-public route receives **401**;
  an authenticated request lacking the permission receives **403**. The two are
  never conflated.
- **AC-7** — Basic auth is **completely removed**: `newBasicAuthMiddleware`,
  `middleware.WebsocketQueryAuth`, `middleware.RequireBasicAuthConfigured`,
  `config.AppBasicAuthCredential`, the `--basic-auth` / `-b` flag and the
  `APP_BASIC_AUTH` env binding no longer exist. A repository-wide grep for
  `AppBasicAuthCredential` and `basicauth` returns nothing.
- **AC-8** — All five basic-auth-keyed guards are converted to permission checks:
  `/accounts/*` → `accounts.manage`, `accountLayerVisible` → `accounts.manage`,
  the agent toggle → `admin.debug.toggle`, the retention sweep →
  `admin.retention.run`, and the `cmd/root.go` startup warning is rewritten.
- **AC-9** — The audit actor in `usecase/account.go` is sourced from the
  `Principal`; all nine audit lines record a real `user_id` under JWT.
- **AC-10** — `/ws` authenticates with `?access_token=<jwt>`; the old
  `?authorization=<base64>` form is no longer accepted.
- **AC-11** — A request carrying no valid token cannot reach a non-public route:
  it is refused with 401 before any handler runs. The identify-and-pass-through
  behaviour of ticket 23 no longer admits anyone to a guarded route.
- **AC-12** — `.env.example`, `README.md` **and `docs/openapi.yaml`** no longer
  document `APP_BASIC_AUTH`, and document the `AUTH_*` keys instead.
  > **AMENDED after panel review.** `docs/openapi.yaml` is the published API
  > contract and still declares `basicAuth` as the global security scheme. Left
  > stale it would advertise a scheme that no longer exists, and its per-route
  > `security: []` markers would become a second, divergent source of truth for
  > the AC-3 allowlist. Flagged for the owner to overrule.
- **AC-13** — `gowa rest` **refuses to start** when `AUTH_JWT_SECRET` is unset or
  unusable, naming the variable and how to generate one.
  > **ADDED after panel review.** Without it the server boots into a
  > dead-but-healthy state: no principal can exist, so every guarded route
  > answers 401 and `/auth/login` answers 503 — while `/health` still returns
  > 200, so no orchestrator ever rolls back. `src/cmd/helpers.go:170-174` already
  > names this ticket as the one that makes it fatal: *"the ticket that first
  > DEPENDS on a thing is the ticket that gets to make it fatal. That is ticket
  > 24."*

## Test cases

| ID | AC | Action | Expected |
|----|----|--------|----------|
| TC-1 | AC-2 | Register a route in a test without the guard and call the coverage assertion. | It reports that exact method and path and fails. |
| TC-2 | AC-2 | Run the coverage assertion over an app built by the real registrars. | Coverage passes; every route is classified. |
| TC-3 | AC-3 | `GET /` with no token, then `GET /chats` with no token. | 200 (UI bundle) and 401 — proving `/` is matched exactly, not as a prefix. |
| TC-4 | AC-5 | With a `user` principal: `POST /send/message`, `POST /chat/x@s.whatsapp.net/archive`, `GET /chats`. | 403, 403, not-403. |
| TC-5 | AC-6 | `/chats` with no principal, then with a `user` principal; `/accounts` with a `user` principal. | 401, not-403, 403. |
| TC-6 | AC-7 | Repository-wide grep for `AppBasicAuthCredential` and `basicauth`. | No matches. Booting with `APP_BASIC_AUTH` set changes nothing. |
| TC-7 | AC-8 | With an admin principal and no basic-auth configuration: `GET /accounts`, `GET /devices`, `POST /agent/debug/toggle`, `POST /agent/debug/retention/run`. | None returns 503 for a missing credential; `GET /devices` shows populated `account_id`, `priority`, `send_state`. |
| TC-8 | AC-9 | Call an account mutation with an admin principal on the context and read the audit line. | The line names that admin's `user_id`, not an empty string. |
| TC-9 | AC-10 | Present a token as `?access_token=`, then as `?authorization=`. | Accepted and rejected respectively. |
| TC-10 | AC-4 | Table-driven test over the §06 mapping: for each route, a principal holding only that permission is not refused by the guard, and a principal holding every other permission is refused. | Pass for all mapped routes. |
| TC-11 | AC-1, AC-11 | Mutation check: move the guard to the trailing position and re-run TC-4/TC-5. | The tests fail — proving they detect an unexecuted guard. |
| TC-13 | AC-13 | Boot `gowa rest` with `AUTH_JWT_SECRET` unset. | The process exits fatally naming `AUTH_JWT_SECRET`; it does not serve. |
| TC-12 | NFR-5 | `go build ./...`, `go vet ./...`, `go test ./...` from `src/`. | All pass against the recorded baseline. |

## Out of scope

- Device ownership scoping and field redaction (ticket 25).
- WebSocket per-principal fan-out (ticket 25) — this ticket changes only how
  `/ws` authenticates, not what it broadcasts.
- User administration endpoints (ticket 26).
- `/statics` hardening and the Chatwoot webhook fail-open — separate tickets.
  This ticket adds a loud boot warning for an empty `CHATWOOT_WEBHOOK_SECRET`
  but does not make it fatal.
- **`gowa mcp` authentication.** `cmd/mcp.go` runs a mark3labs SSE server, not
  Fiber, with no authentication at all. After this ticket the REST surface is
  fully locked while MCP mode remains an unauthenticated send path. Declared out
  of scope explicitly rather than left unsaid — it needs its own ticket.
- Ownership scoping of the pairing routes. Because of this, **no non-admin user
  may be created until ticket 25 ships**: the `user` role holds `devices.pair`,
  and `/devices/:device_id/login` has no ownership check.
- Deployment runtime files.
