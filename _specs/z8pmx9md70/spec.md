---
ticket: z8pmx9md70
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-09-06
links:
  clickup: "https://app.clickup.com/t/z8pmx9md70"
  github: ""
---

# Specification — 4 · Add silent refresh, 401 recovery and token rotation

## Business goal

`z8pmx9md6z` made a session creatable. It did not make one *survivable*.

The access token lives **fifteen minutes** (reference §03). Today nothing in the
bundle renews it, so every session in this dashboard has a hard fifteen-minute
ceiling, and the way a user discovers that ceiling is a 401 in the middle of
whatever they were doing — followed by a login screen, because `z8pmx9md6z`'s
401 handler correctly reads a refused token as a session ending. Reloading does
not help: `boot()` sees an expired access cookie, drops it, keeps the refresh
token and gives up, with a comment saying recovery belongs to this ticket.

That refresh token is good for **thirty days**, and the server hands out
`expires_in` for the express purpose of letting the UI renew before the
deadline. This ticket spends both. It adds the layer the reference's own
migration list (§11) puts second in priority:

1. a **proactive schedule** that renews before `expires_in` elapses;
2. a **reactive path** that turns a 401 into exactly one refresh and a replay of
   the request that failed;
3. **rotation** — the server revokes the old refresh token on every successful
   call, so both halves of the pair must be replaced together or the next
   refresh triggers reuse detection and revokes the whole family;
4. a **clean end** when the refresh genuinely fails: full teardown, socket
   closed, login screen, with the right sentence on it;
5. a **WebSocket** that carries the access token and is reopened after every
   rotation, because §10 freezes the principal at the handshake.

Scope is the session's lifetime. Permission-driven UI is `z8pmx9md71`.

## User story

As **a Normal User**, I want my session to **refresh silently before the access
token expires**, and to be logged out cleanly when the refresh genuinely fails,
so that **my work is never interrupted mid-operation by a surprise 401, and a
dead session never lingers in a half-working state**.

## Functional requirements

- **REQ-1** Every guarded request carries `Authorization: Bearer <access_token>`
  from the session store, and the public auth routes carry none.
- **REQ-2** A renewal of the access token is scheduled from `expires_in`, ahead
  of expiry by a margin this specification fixes at 60 seconds, and is re-armed
  from the new `expires_in` after each success.
- **REQ-3** The schedule exists only while a session exists: it is armed when a
  session is created or rehydrated, and cancelled whenever one ends.
- **REQ-4** A 401 on a guarded request causes **at most one** refresh attempt
  for that request, and a successful refresh replays the request.
- **REQ-5** Concurrent 401s, and a proactive renewal racing a reactive one,
  share a **single** in-flight `POST /auth/refresh`.
- **REQ-6** No refresh is attempted for a request that failed on a public auth
  route — `POST /auth/refresh` above all, where it would loop.
- **REQ-7** A successful refresh replaces `access_token`, `refresh_token` and
  the derived expiry in one operation, in the store and in the cookies, with no
  window in which the two halves disagree.
- **REQ-8** A refresh refused for the refresh token itself (401, or the code
  `AUTH_INVALID_REFRESH_TOKEN`) clears the session outright, with **no retry**.
- **REQ-9** A refresh that fails for a reason that says nothing about the token
  — 429, 5xx, a transport failure — fires **no immediate automatic retry**.
- **REQ-10** When a session ends because recovery failed, the cookies are
  cleared or narrowed, the store is reset, the query cache is emptied, the
  WebSocket is closed and the visitor is on `/login`.
- **REQ-11** The login screen states *why* the session ended, distinguishing an
  ordinary expiry from an administrative change (`token_epoch`).
- **REQ-12** The WebSocket handshake carries the access token as
  `?access_token=<token>` — the server's own instruction (§10) — alongside the
  `device_id` the socket already carries, and no other credential. The server
  lifts and strips only `access_token`, so `device_id` survives in access logs;
  that is accepted, and it is not new to this ticket.
- **REQ-13** The WebSocket is reopened after every successful rotation, and
  closed on logout or on a failed refresh.
- **REQ-14** A reload holding an expired access token and a live refresh token
  recovers into a signed-in dashboard without the user typing anything.
- **REQ-15** Every refresh attempt is recorded as an outcome — success or
  failure — and no token value is written to that record.

## Non-functional requirements

- **NFR-1 Single owner.** The token pair is still owned by `src/stores/auth.ts`
  alone. Rotation is an action on that store; no other module writes a token.
- **NFR-2 Reconciled, not commanded.** The renewal schedule and the socket are
  derived from session state, the way `wsClient.sync()` already is — so a
  session ending cancels both without anyone calling a teardown.
- **NFR-3 No credential in a log, a URL bar or an error.** The one place a token
  legitimately appears in a URL is the WebSocket handshake, which the server
  strips from its own logs (§10). Nothing else may print or render one.
- **NFR-4 Bounded work.** No refresh loop, no unbounded retry, and no timer that
  survives the session that armed it.
- **NFR-5 Provable where it can be.** The repository has no component renderer
  (see C-1), so every rule that can be stated outside a React render is stated
  outside one and covered by an assertion.

## Constraints

- **C-1** No component renderer. There is no `@testing-library/react`, and
  adding one would edit `package.json`, a documented hard stop. Anything that
  must be provable has to live outside a React render — as it did in
  `z8pmx9md6z`.
- **C-2** No new runtime dependency. The scheduler is `setTimeout`, the
  single-flight is a promise, and there is no token library.
- **C-3** The browser WebSocket API cannot send headers, so the access token
  must travel in the handshake query string. This is the server's own
  instruction (§10), not a shortcut.
- **C-4** `POST /auth/refresh` is rate limited to 60 attempts per minute keyed on
  the TCP peer, so everyone behind one proxy shares the bucket. A 429 is a real
  case, not a theoretical one.
- **C-5** The refresh token lives in a cookie shared by every tab of the origin,
  but each tab spends its own in-memory copy. Two tabs refreshing at once
  therefore trip reuse detection, and the correct outcome is the full logout
  this ticket implements. Reading the cookie at the moment of use would narrow
  that window; it is **rejected**, because the same shared cookie is how a
  *different* principal signing in in another tab would substitute themselves
  into this one — the store would adopt their pair while continuing to render
  the previous user. Failing loudly beats failing quietly, and closing the
  window properly needs cross-tab coordination this ticket does not buy.
- **C-6** No deployment runtime file may be modified.

## Acceptance criteria

### Bearer header on every request

- **AC-1** The request interceptor in `src/lib/http.ts` sets
  `Authorization: Bearer <access_token>` on every guarded request, read from the
  session store.
- **AC-2** No Basic credential is constructed anywhere in the transport;
  `basicAuthHeader` exists nowhere in `src/`.
- **AC-3** `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` and
  `GET /health` carry no `Authorization` header.
- **AC-4** `X-Device-Id` is attached exactly as it was before this ticket.

### Scheduled silent refresh

- **AC-5** A renewal is scheduled to run **before** `expires_in` elapses, with a
  fixed safety margin of **60 seconds**.
- **AC-6** After a successful refresh the schedule is re-armed from the **new**
  `expires_in`.
- **AC-7** The schedule is cancelled on logout and whenever the session is
  cleared by any other trigger.
- **AC-8** No renewal is scheduled while no session exists.

### Reactive refresh on 401

- **AC-9** A 401 on a guarded request causes **exactly one** refresh attempt for
  that request; a second 401 on the replay does not cause a second attempt.
- **AC-10** After a successful refresh the original request is replayed, and it
  carries the **new** access token rather than the one that was refused.
- **AC-11** Five concurrent requests that all receive a 401 produce **exactly
  one** `POST /auth/refresh`, and all five are replayed.
- **AC-12** A 401 on `POST /auth/refresh`, `POST /auth/login` or
  `POST /auth/logout` triggers no refresh attempt and no request loop.
- **AC-13** A 401 raised at the **route line** by `Require(...)` — an
  unauthenticated request to a guarded route — is indistinguishable to this
  client from one raised by the auth layer and takes the identical path: one
  refresh attempt, replay on success, full teardown on failure. (`403`, the code
  the reference's §02 table gives for *authenticated but not permitted*, is not
  touched by this ticket; it is `z8pmx9md71`'s.)

### Token rotation

- **AC-14** Every successful refresh replaces `access_token`, `refresh_token`
  and the derived absolute expiry together, in the store and in the cookies.
- **AC-15** After a successful replacement the previous refresh token is never
  sent again.
- **AC-16** A refresh refused with 401 or `AUTH_INVALID_REFRESH_TOKEN` clears
  the session with **no retry of any kind**.
- **AC-17** A 429 from `POST /auth/refresh` fires no immediate automatic retry.

### Failure → full logout

- **AC-18** A failed refresh clears the session cookies, resets the auth store,
  and causes the query cache to be cancelled and emptied.
- **AC-19** A failed refresh closes the WebSocket and leaves the visitor on
  `/login`.
- **AC-20** When the evidence points at a `token_epoch` bump the login screen
  shows the "your permissions were updated" notice rather than a generic one.
- **AC-21** No state exists in which the dashboard renders a previous session's
  data after that session has ended.

### WebSocket lifecycle

- **AC-22** The socket opens against `/ws` carrying `?access_token=<token>`, and
  carries no legacy base64 `authorization` parameter.
- **AC-23** A successful refresh closes the old socket and opens a new one with
  the new token.
- **AC-24** The socket is closed immediately on logout and on a failed refresh.
- **AC-25** No `username`, `password` or basic credential appears in the
  handshake URL; `device_id` is the only other parameter it carries.
- **AC-26** The existing reconnect backoff and its refused-handshake ceiling are
  preserved and do not fight the refresh cycle.

### Recovery on reload

- **AC-27** A reload holding an expired access token and a live refresh token
  recovers the session without user interaction, and lands on the dashboard.
- **AC-28** A reload holding a refresh token the server rejects lands on
  `/login` with the session fully cleared.

### Audit and logging

- **AC-29** Nothing in `src/` writes to `console` at all. The stricter rule is
  also the simpler one here: the shipped source contains **zero** `console.*`
  calls today, so a flat ban has an empty exemption list and cannot be evaded by
  a shape a "token near a console call" pattern would miss.
- **AC-30** Every refresh attempt is recorded as an outcome — `success` or
  `failed`, with the HTTP status, and with the server's code only when it is one
  of the reference's own catalogue codes — and that record is reachable through
  `diagnostics()`. No token value and no server-authored free text may appear in
  it.

## Test cases

- **TC-1 (AC-5, AC-6, AC-8)** Arm from `expires_in = 900`: the renewal is
  scheduled at 840 seconds, not at 900; a successful refresh returning a new
  `expires_in` re-arms from the new number; with no session nothing is armed.
- **TC-2 (AC-7)** Sign out with a renewal armed: the timer is cleared and no
  request is issued when the original deadline passes.
- **TC-3 (AC-9, AC-10)** A guarded request gets a 401, the refresh succeeds, the
  request is replayed once and carries the new bearer.
- **TC-4 (AC-9)** A guarded endpoint that answers 401 both times produces two
  attempts and one refresh — never a loop.
- **TC-5 (AC-11)** Five parallel guarded requests all get a 401: one
  `POST /auth/refresh` is issued and five replays follow.
- **TC-6 (AC-12)** A 401 from `POST /auth/refresh` and from `POST /auth/login`
  produce no refresh call at all.
- **TC-7 (AC-14, AC-15)** A successful refresh writes both cookies and both
  store fields; the next refresh sends the **new** refresh token.
- **TC-8 (AC-16, AC-18, AC-20)** A refresh answered 401 /
  `AUTH_INVALID_REFRESH_TOKEN` while the access token is still inside its
  lifetime clears both cookies, sets the session anonymous, records the
  `permissions-changed` reason, and issues no second attempt.
- **TC-9 (AC-17)** A refresh answered 429 issues no second `POST /auth/refresh`.
- **TC-10 (AC-22, AC-25)** The handshake URL is
  `ws://<origin>/api/ws?access_token=…`, and carries no `authorization`, no
  `username` and no `password`.
- **TC-11 (AC-23)** A rotation while a socket is open closes it and opens a new
  one whose URL carries the new token.
- **TC-12 (AC-24, AC-8)** Ending the session closes the socket and leaves
  nothing armed.
- **TC-13 (AC-26)** A refused handshake still gives up after the existing
  ceiling, and a rotation is what makes it try again.
- **TC-14 (AC-27)** `boot()` with an expired access cookie and a live refresh
  cookie issues `POST /auth/refresh`, then `GET /auth/me`, and ends
  authenticated.
- **TC-15 (AC-28)** The same boot with a rejected refresh token ends anonymous
  with both cookies gone.
- **TC-16 (AC-29, AC-30)** The executable source policy fails if any file in
  `src/` names `console` at all, and the serialised refresh record contains
  neither token nor server-authored text.
- **TC-17 (AC-16, C-5)** An in-flight refresh whose session is torn down while
  it is awaiting does **not** write the returned pair: the cookies stay cleared,
  the store stays anonymous, and the sign-out reason is not overwritten.
- **TC-18 (AC-9, AC-13)** A guarded route that answers 401 again **after** a
  successful refresh ends the session rather than leaving it authenticated with
  a credential the server refuses.

## Out of scope

- Permission-driven UI, `403` handling and hiding controls from `permissions[]`
  — that is `z8pmx9md71`.
- Cross-tab coordination of the refresh (a `BroadcastChannel`, a lock, a leader
  election). C-5 requires the hazard be narrowed, not solved.
- Any change to how devices are selected or how `X-Device-Id` is attached.
- Refreshing on the strength of a decoded JWT `exp` claim. Nothing in this UI
  decodes a token; `expires_in` is the only clock.
- Retrying a request that failed for any reason other than a 401.

## Known limits

- **A refresh cannot be made atomic across tabs, and this ticket does not
  pretend to narrow it.** Each tab spends its own in-memory refresh token, so
  two tabs that renew close together trip reuse detection and both are logged
  out. That is a real cost, accepted deliberately over the alternative in C-5.
- **A 429 on `/auth/refresh` reached through a 401 ends the session.** The
  reference is unambiguous that a 401 gets *one* refresh attempt and then a
  logout, and a client that keeps a session alive while it cannot renew it is
  the "half-working state" this ticket exists to remove. The cost is real: the
  rate-limit bucket is keyed on the TCP peer (C-4), so a busy proxy can sign a
  user out for somebody else's traffic. A **proactive** renewal that hits a 429
  does *not* end the session — the access token is still alive there, and the
  reactive path is the safety net.
- **A session torn down and recreated inside one refresh round-trip can be torn
  down again.** The store refuses to write a pair whose refresh token is no
  longer the one it holds, which is what stops an in-flight refresh resurrecting
  a session the user just ended. Signing out *and back in* inside those few
  hundred milliseconds still lets the recovery path end the new session; the
  user signs in again. Closing it properly needs a session identity the whole
  transport carries, which is more machinery than the window is worth.
- **The cause of a 401 is inferred, never read.** The server's `Authenticate`
  middleware identifies and does not refuse (§03), so a 401 carries no cause.
  `permissions-changed` remains an inference from "the access token was still
  inside its own lifetime when it was refused", exactly as `z8pmx9md6y`
  established, and it can be wrong when the true cause was reuse detection.
- **Nothing here shortens the fifteen-minute token.** If the browser is asleep
  or the tab is discarded the timer does not fire, the access token dies, and
  the user's next request takes the reactive path instead. That is by design:
  the proactive schedule is an optimisation over the reactive one, not a
  replacement for it.
