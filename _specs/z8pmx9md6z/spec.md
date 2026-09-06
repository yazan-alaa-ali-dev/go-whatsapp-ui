---
ticket: z8pmx9md6z
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-09-06
links:
  clickup: "https://app.clickup.com/t/z8pmx9md6z"
  github: ""
---

# Specification — 3 · Replace the connect screen with JWT login, logout and a route guard

## Business goal

`z8pmx9md6x` deleted the credential the dashboard used to hold and made every
request same-origin. `z8pmx9md6y` built the one place a session lives — the auth
store, its cookies, and the bearer interceptor — but deliberately stopped short
of creating one: it can only rehydrate a session that already exists. Nothing in
the shipped bundle can produce that session, so today every guarded endpoint
answers `401` and the dashboard is unusable end to end.

This ticket closes that gap and is the first ticket in the chain a human can
actually see working. It replaces the obsolete `ConnectPage` — which still asks
for a *Server URL*, a *username* and a *password* and validates them by probing
`/devices`, none of which exists any more — with three things:

1. a **`/login` screen** that exchanges username and password for a token pair
   through `POST /auth/login`;
2. a **route guard** that refuses every application route without a session and
   returns the visitor to where they were going after they sign in;
3. a **logout** that revokes the refresh-token family server-side and tears down
   the local session, the query cache and the WebSocket.

Scope is **sign-in, sign-out and routing**. Silent refresh and 401 recovery are
`z8pmx9md70`; permission-driven UI is `z8pmx9md71`.

## User story

As **a Normal User**, I want to sign in with **username and password against
`POST /auth/login`** and sign out cleanly, so that **I can reach the dashboard
with a real session instead of the removed basic auth, and I can end that session
on demand**.

## Functional requirements

- **REQ-1** A public `/login` route renders a form with exactly two inputs,
  `username` and `password`, and a submit control. There is **no Server URL
  field**, and no field that names a backend address.
- **REQ-2** Submitting issues exactly one `POST /auth/login` with the JSON body
  `{ "username", "password" }` and nothing else.
- **REQ-3** A `200` response is validated for shape and then handed to the auth
  store, which becomes the sole holder of `access_token`, `refresh_token`,
  `expires_in` (converted once to an absolute expiry) and the `user` object.
- **REQ-4** After a successful sign-in the user is routed to the destination
  they were originally refused, or to `/` when there was none.
- **REQ-5** `/login` is reachable without a session and its request carries **no
  `Authorization` header**, so a stale or corrupt token in a cookie cannot
  change its outcome. The same holds for `POST /auth/refresh` and
  `POST /auth/logout`, which the reference lists as public, body-only routes.
- **REQ-6** The legacy `ConnectPage` and its `/connect` route are removed; the
  path resolves to `/login` rather than to a dead route.
- **REQ-7** Every route rendered inside `AppShell` requires an authenticated
  session; without one the visitor is redirected to `/login` and no protected
  content and no guarded request is produced.
- **REQ-8** While the session is still being determined (the pre-boot `unknown`
  state) the guard renders a neutral pending state — never protected content and
  never the login form.
- **REQ-9** A visitor who already holds a session and opens `/login` is
  redirected to `/`.
- **REQ-10** Login failures are mapped from the reference's error catalogue to
  distinct, human messages: `401`/`AUTH_INVALID_CREDENTIALS` (one unified
  message), `429`/`AUTH_RATE_LIMITED` (a wait counter, submit disabled, no
  automatic retry), `503`/`AUTH_NOT_CONFIGURED` (a deployment fault),
  `503`/`AUTH_BUSY` (transient, manual retry), and a transport failure (a
  connection fault).
- **REQ-11** A **Logout** control is present in `AppShell` and identifies the
  signed-in principal.
- **REQ-12** Logout issues `POST /auth/logout` with the body
  `{ "refresh_token": "..." }` and never lets that request's outcome — success,
  failure, or no answer at all — decide whether the local session is destroyed.
- **REQ-13** Ending a session, from any trigger, clears the session cookies and
  store state, empties the TanStack Query cache, closes the WebSocket, and lands
  the user on `/login`.
- **REQ-14** A session may end for a stated reason, and the reason survives to
  the login screen: a deliberate sign-out, an expired session, or a **forced**
  end caused by a `token_epoch` bump (an administrative change to roles, status,
  account, or a password reset).
- **REQ-15** The forced-end message means "your permissions were updated, please
  sign in again" and is textually distinct from both the invalid-credentials and
  the session-expired messages.
- **REQ-16** Submission is blocked before any request when either field is
  empty, and while a submission is already in flight.
- **REQ-17** The password is sent once and is held only in the form's own
  transient state; it is never written to a store, a cookie, or any storage, and
  it is discarded once the request is made.
- **REQ-18** The login screen reports a backend that is unreachable, or an origin
  the server refuses, as a connection fault — the diagnostic `ConnectPage` used
  to carry — so the boot health probe from `z8pmx9md6x` keeps a live consumer.

## Non-functional requirements

- **NFR-1** No credential is written to `localStorage` or `sessionStorage`, and
  the password never reaches any persistence at all — enforced by the executable
  source policy `z8pmx9md6y` introduced, extended here to cover the new files.
- **NFR-2** The post-login destination is derived only from an internal router
  location; no externally supplied string can steer the redirect (no open
  redirect).
- **NFR-3** No token or password value reaches a log line, a URL, a query
  string, or the rendered cURL command.
- **NFR-4** No deployment runtime file (`project-config.yaml >
  deployment_runtime.files`) is modified: no new dependency, no build change, no
  entry-document change. The vitest environment is therefore still the Node
  default and the login UI must be verifiable without a DOM renderer.
- **NFR-5** Sign-out is **one** code path regardless of trigger — a button, an
  expiry, or a refusal — so no trigger can leave a half-torn-down session.
- **NFR-6** The guard adds no work to a render hot path: it reads one field of
  the auth store through a selector and renders nothing else.

## Constraints

- **C-1** **No component renderer is available.** The repository has no
  `@testing-library/react` and adding one would edit `package.json`, a
  deployment runtime file and a documented hard stop (NFR-4). Every behaviour
  this ticket must prove has to be expressible as logic outside a React render —
  which is a design constraint on where the logic lives, not only on the tests.
- **C-2** **The 401 is ambiguous by construction.** The reference's
  `Authenticate` middleware *identifies and does not refuse*; the refusal happens
  in `Require(permission)` on the route line. A `401` therefore says "no valid
  bearer token" and never says why. Expiry and a `token_epoch` bump are
  distinguishable only by whether the access token had already expired when the
  refusal arrived.
- **C-3** **Recovery is not this ticket's.** The reference's prescribed handling
  of a `401` is "attempt refresh once, and on failure sign out with the
  permissions message". `z8pmx9md70` owns the attempt; what ships here is the
  second half — the sign-out and its message — which is also the correct
  behaviour in the interim, because there is no refresh to attempt.
- **C-4** **The rate-limit window is a documented constant, not a response
  field.** The reference fixes `POST /auth/login` at 10 attempts per minute; the
  envelope carries no retry hint, and the shared `ApiError` shape carries no
  headers. The counter is therefore driven by that constant.
- **C-5** **The limiter keys on the TCP peer, not `X-Forwarded-For`.** Behind a
  reverse proxy every client can share one bucket, so a `429` is not evidence
  that *this* user did anything, and the message must not say that it is.
- **C-6** **The WebSocket cannot carry a bearer header.** `/ws` is a guarded
  route and browsers cannot set headers on a WebSocket handshake, so an
  authenticated socket needs `?access_token=` in the URL — a token in a URL, with
  its own logging and rotation consequences. That is a separate decision and is
  out of scope; this ticket only guarantees the socket is not opened without a
  session and is closed when one ends.

## Known limits

Stated plainly, as the previous two tickets in this chain state theirs:

- **A signed-in dashboard still has no live WebSocket.** Gating the socket on the
  session is a correctness fix, not a connectivity one: `/ws` is guarded and the
  handshake carries no credential (C-6). The socket will attempt, be refused, and
  abandon its URL exactly as it does today. Nothing regresses, and nothing is
  claimed.
- **"Permissions were updated" is an inference, not a server statement.** The
  server sends `401` with no cause (C-2). This ticket reports the forced message
  when a token that had **not** yet expired was refused, because the reference
  documents the epoch bump as the cause of precisely that case. A revoked token
  family or a restarted server with a new `AUTH_JWT_SECRET` produces the same
  message. The inference reads a **client** clock against a value in a
  script-writable cookie, so it is deliberately biased toward the benign verdict:
  a 60-second skew tolerance, and a missing or unreadable expiry cookie reads as
  *unknown* — the neutral "session expired" copy — rather than as *not expired*.
  Wrongly telling a user an administrator changed their permissions is the worse
  error of the two.
- **A stale access token still leaves the browser on a sign-in.** The request
  carries no `Authorization` header, which is what this ticket enforces, but the
  session cookies are attached to every same-origin `/api/*` request by the
  browser itself — ADR-012's "the token travels twice". The server ignores it on
  a public route. Removing that would need `HttpOnly` cookies, which needs a
  server-set cookie, which is the BFF that ADR-012 ruled out.
- **A refresh-token family can outlive the local session.** `POST /auth/logout`
  is issued but never awaited (AC-21 requires exactly that), so a tab closed in
  the same tick leaves the family live server-side until it expires. Signing in
  and out again revokes it. The alternative — a `sendBeacon` path outside the
  `src/api/` layer — was considered and rejected as a second HTTP door bought for
  a race measured in milliseconds.
- **An involuntary sign-out keeps the refresh token on purpose.** A token the
  server refused is dropped; the refresh token is not, because it is the
  credential `z8pmx9md70` will use to recover. Only a deliberate Logout revokes
  the family and deletes all three cookies.
- **The wait counter is advisory.** It counts the documented window (C-4), not a
  number the server sent. It can expire while the bucket is still full, in which
  case the next attempt simply shows the message again — it never retries by
  itself.
- **A reload loses the sign-out reason.** The reason lives in memory on purpose:
  it is a notice, not session state, and persisting it would mean writing the
  circumstances of a failed session into storage. A forced sign-out redirects
  without a reload, so the message survives the path that produces it.
- **The route guard is a UX control, not an authorization control.** It hides
  routes; the server is what refuses data. Nothing about this ticket makes a
  hidden page safe.

## Acceptance criteria

Numbered in the order the ClickUp ticket states them.

### General behavior

- **AC-1** A `/login` page exists with `username` and `password` fields and a
  submit button, and **no Server URL field at all**. *(REQ-1)*
- **AC-2** Submitting calls `POST /auth/login` with the body
  `{ "username", "password" }`. *(REQ-2)*
- **AC-3** On `200` the `access_token`, `refresh_token`, `expires_in` and the
  `user` object are stored in the auth store (the single source), then the user
  is routed to the requested destination or `/`. *(REQ-3, REQ-4)*
- **AC-4** `/login` is public, requires no token, and works even when the browser
  is carrying a stale or corrupt token. *(REQ-5)*
- **AC-5** The legacy `ConnectPage` is deleted along with the `/connect` route,
  or that route redirects to `/login`. *(REQ-6)*

### Authorization and routing guard

- **AC-6** Every route inside `AppShell` requires an authenticated session; a
  visitor without one is redirected to `/login`. *(REQ-7)*
- **AC-7** The original destination is preserved and the user is returned to it
  after a successful login. *(REQ-4, NFR-2)*
- **AC-8** A user with an existing session who opens `/login` is redirected
  straight to `/`. *(REQ-9)*
- **AC-9** No chat or device data is rendered before authentication completes —
  no flash of protected content. *(REQ-7, REQ-8)*

### Error handling (matching the error-code catalogue)

- **AC-10** `401` / `AUTH_INVALID_CREDENTIALS` produces one unified message; the
  UI does not distinguish a wrong username from a wrong password. *(REQ-10)*
- **AC-11** `429` / `AUTH_RATE_LIMITED` shows a wait counter, disables the submit
  button, and performs **no automatic retry**. *(REQ-10, C-4)*
- **AC-12** `503` / `AUTH_NOT_CONFIGURED` produces a message describing a
  **deployment** problem — a server without `AUTH_JWT_SECRET` — not a user
  error. *(REQ-10)*
- **AC-13** `503` / `AUTH_BUSY` produces a "server busy, retry in a few seconds"
  message with manual retry available. *(REQ-10)*
- **AC-14** A network error is shown as a connection error, distinct from any
  authentication error. *(REQ-10, REQ-18)*
- **AC-15** The `429` message does not assert that this user exhausted the
  limit, because the limiter keys on the TCP peer and other clients behind the
  same proxy share the bucket. *(C-5)*

### Logout behavior

- **AC-16** A **Logout** control is visible in the `AppShell`. *(REQ-11)*
- **AC-17** Pressing it calls `POST /auth/logout` with the body
  `{ "refresh_token": "..." }`. *(REQ-12)*
- **AC-18** After the call — success or failure — all session cookies are
  cleared, the auth store is reset, and the TanStack Query cache is
  invalidated. *(REQ-12, REQ-13)*
- **AC-19** The WebSocket is closed on logout. *(REQ-13)*
- **AC-20** The user is routed to `/login`. *(REQ-13)*
- **AC-21** A non-responding `POST /auth/logout` does not block local cleanup —
  the local sign-out always happens. *(REQ-12)*

### Forced logout messaging (token epoch)

- **AC-22** When the session ends by force because of `token_epoch`, the login
  screen shows a message meaning "your permissions were updated, please sign in
  again". *(REQ-14, REQ-15)*
- **AC-23** That message is textually distinct from the invalid-credentials
  message and from the session-expired message. *(REQ-15)*

### UI and API consistency

- **AC-24** Both fields are required and submission is blocked while either is
  empty, before the API is called. *(REQ-16)*
- **AC-25** The password is sent once and is not held in any persistent state
  after submission. *(REQ-17, NFR-1)*
- **AC-26** A `submitting` state prevents double submission. *(REQ-16)*

## Test cases

- **TC-1 — Successful sign-in.** *Given* valid credentials, *when* the form is
  submitted, *then* `POST /auth/login` is called once, the tokens and the `user`
  object land in the auth store, and the user is routed to the requested
  destination or `/`. *(AC-2, AC-3, AC-7)*
- **TC-2 — Invalid credentials.** *Given* a wrong password, *when* the form is
  submitted, *then* the `401`/`AUTH_INVALID_CREDENTIALS` response yields one
  unified message that reveals nothing about which field was wrong, and no
  session is created and no session cookie is written. *(AC-10)*
- **TC-3 — Rate limit exceeded.** *Given* ten failed attempts inside one minute,
  *when* another is submitted, *then* the `429`/`AUTH_RATE_LIMITED` response
  shows a wait counter, disables submit, and the UI sends no automatic
  retry. *(AC-11, AC-15)*
- **TC-4 — Route guard.** *Given* no session, *when* `/chats` is opened directly,
  *then* the visitor is redirected to `/login`, no request is issued for chat
  data, and after a successful login they are returned to `/chats`. *(AC-6,
  AC-7, AC-9)*
- **TC-5 — Clean sign-out.** *Given* an active session and an open WebSocket,
  *when* Logout is pressed, *then* `POST /auth/logout` is called with the
  `refresh_token`, every session cookie is cleared, the query cache is reset, the
  socket is closed, and the user is routed to `/login`. *(AC-17..AC-20)*
- **TC-6 — Logout that never answers.** *Given* a `POST /auth/logout` that hangs,
  *when* Logout is pressed, *then* the local sign-out completes anyway. *(AC-21)*
- **TC-7 — Forced sign-out after an administrative change.** *Given* an admin
  raised the user's `token_epoch`, *when* a request is refused and no refresh
  succeeds, *then* the user lands on `/login` with the "your permissions were
  updated" message rather than a generic error. *(AC-22, AC-23)*
- **TC-8 — Server not configured.** *Given* a backend with no `AUTH_JWT_SECRET`,
  *when* sign-in is attempted, *then* the `503`/`AUTH_NOT_CONFIGURED` response
  produces a deployment message, not a credentials error. *(AC-12)*
- **TC-9 — A stale token cannot break sign-in.** *Given* a corrupt access-token
  cookie, *when* the login form is submitted, *then* the request carries no
  `Authorization` header and the outcome is decided by the credentials
  alone. *(AC-4)*
- **TC-10 — Empty fields and double submission.** *Given* an empty username or
  password, *when* submit is pressed, *then* no request is issued; and while one
  submission is in flight a second cannot start. *(AC-24, AC-26)*
- **TC-11 — The password does not outlive the request.** *Given* a completed
  submission, *when* the source policy and the store are inspected, *then* the
  password appears in no store, no cookie and no web storage. *(AC-25)*

## Out of scope

- **Silent refresh, token rotation, and 401 recovery** — `z8pmx9md70`. This
  ticket signs the user out where that ticket will first attempt a refresh.
- **Permission-driven UI** — `z8pmx9md71`. Nothing here renders from
  `permissions[]`; the array is stored and displayed only as the principal's
  identity.
- **An authenticated WebSocket** (`?access_token=` on the handshake) — its own
  decision, with its own token-in-a-URL consequences (C-6).
- **Password change, self-registration, or any user-administration surface.**
- **Any backend change, and any BFF** that would let the session cookies be
  `HttpOnly` — ruled out in ADR-012.
- **Removing the health probe or the connection store.** The probe keeps a live
  consumer on the login screen (REQ-18); retiring it is not this ticket's call.
- **`PROJECT-GUIDE-ar.html`, `worker/index.js`, `wrangler.jsonc`**, and every
  file in `project-config.yaml > deployment_runtime.files` (NFR-4).
