---
ticket: z8pmx9md6z
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-09-06
links:
  clickup: "https://app.clickup.com/t/z8pmx9md6z"
  github: ""
---

# Plan — 3 · Replace the connect screen with JWT login, logout and a route guard

> **Revision 2.** Revision 1 was reviewed by the advisory panel (senior /
> security / performance) **before any code was written**. They returned **36
> findings — 9 major**. Seven findings changed the design; the decisive one is
> that revision 1 tore a session down the same way whether the user asked for it
> or the server refused a token, and the two are not the same event. Full
> disposition in *Panel response* at the end of this file.

## Approach

The session already has an owner. `z8pmx9md6y` built `src/stores/auth.ts` as the
single place tokens live, `src/lib/cookies.ts` as the only door to
`document.cookie`, and the bearer interceptor in `src/lib/http.ts`. What is
missing is a way to *create* a session, a way to *end* one, and a rule that
refuses the application without one.

The organising decision is that **ending a session is a state change, not a
procedure**. A logout button, an expired token, and a server that refuses a token
it used to accept are triggers; the teardown is one outcome that everything else
*reacts* to:

| Consequence | How it happens |
|---|---|
| cookies + store cleared | inside the store action |
| query cache cancelled, then emptied | an edge-triggered effect in `App.tsx` |
| WebSocket closed | `wsClient.sync()` already reconciles from store subscriptions; the auth store becomes one of its inputs |
| routed to `/login` | the route guard re-renders because `status` changed |

Nothing calls `navigate()` on sign-out, nothing calls `wsClient.stop()`, and
nothing clears the cache imperatively. That is what makes NFR-5 true by
construction rather than by discipline, and it is the reconciliation idiom
`wsClient.sync()` already uses — not a new pattern invented here.

### Two teardowns, not one — the panel's decisive finding

Revision 1 had a single `signOut(reason)` used by the logout button *and* by the
401 interceptor *and* by `boot()`. Three lenses arrived at the same objection
from three directions, and they were right: those are different events.

- `POST /auth/logout` **revokes the whole refresh-token family** (reference §03).
  Firing it on an involuntary 401 destroys a valid 30-day refresh token — the
  exact credential `z8pmx9md70` is being built to use.
- `clearSession()` deletes all three cookies. `z8pmx9md6y`'s `boot()` deliberately
  does *not* do that on a 401: it drops the access token and **keeps the refresh
  token**, with a comment saying recovery is `z8pmx9md70`'s. Revision 1 would have
  quietly reversed that decision one ticket later.

So there are two actions, and the difference between them is *who ended the
session*:

| | trigger | `POST /auth/logout` | refresh cookie |
|---|---|---|---|
| `signOut()` | the user pressed Log out | **yes** — revoke the family | deleted |
| `endSession(reason)` | a token was refused, or expired | **no** | **kept** |

`endSession` is not a new abstraction: it is `boot()`'s existing 401 branch
lifted into a named action so the interceptor can reuse it instead of
reimplementing it. That is a deduplication, and it leaves `z8pmx9md70` a clean
seam — it will attempt a refresh *before* `endSession`, using the token this plan
is careful not to burn.

### Where the logic lives, given that nothing can render

C-1 is the sharpest constraint in the spec: there is no component renderer, and
getting one would edit `package.json` — a hard stop. That is a design
instruction, not a testing inconvenience. Anything that must be *proved* lives
outside a React render:

- the error catalogue → a pure mapper in `src/lib/auth-messages.ts`;
- the safe post-login destination → `afterLoginPath()` in `src/lib/session-route.ts`;
- sign-in, sign-out, and the refusal inference → store actions and one exported
  pure function, testable through `useAuth.getState()`;
- what carries a bearer and what does not → the interceptor, already tested;
- the socket's session gate → `wsClient.sync()`, already tested.

What is left in `.tsx` is markup and wiring: two inputs, a button, a dropdown and
a `<Navigate>`. That residue is verified by read-through and by running the app,
and `verify.md` will say so rather than dressing it up as a test.

Revision 1 also proposed a `guardOutcome(status)` helper. The senior lens called
it what it was — an abstraction with one caller renaming a three-member union
into another three-member union — and it is gone. The guard's three branches are
inline. As a bonus this keeps `require-session.tsx` exporting *only* a component,
so it does not join the four files that already trip oxlint's
`only-export-components` warning.

### The four sign-in errors, and why they are a table

The reference's catalogue (§02) is a fixed table and the AC list is that table
restated. Mapping it in a `switch` inside the page would put six untestable
branches in the one file no test can reach. `toLoginError(error)` takes the
`ApiError` the interceptor already normalises and returns
`{ kind, title, description, retryAfterSeconds? }`.

Order is stated once, in the function: **code first, status second.** `toApiError`
fills `code` from the envelope when there is one and falls back to `HTTP_ERROR` /
`NETWORK_ERROR` when there is not — so a `503` from a gateway that never reached
gowa has no `AUTH_*` code and must not claim the server is misconfigured.

| Match | kind | What the user is told |
|---|---|---|
| `AUTH_INVALID_CREDENTIALS`, or any other 401 | `credentials` | one unified message; nothing about which field |
| `AUTH_RATE_LIMITED`, or any 429 | `rate-limited` | too many attempts *from this address*, wait `n`s |
| `AUTH_NOT_CONFIGURED` | `not-configured` | this server is not set up for sign-in — a deployment fault, contact the administrator |
| `AUTH_BUSY`, or any other 503 | `busy` | the server is busy; try again in a few seconds |
| status `0` | `network` | the dashboard could not reach the server |
| anything else | `unknown` | the server's own message, trimmed to 200 characters |

Two of those rows are the security lens's, not revision 1's:

- The `not-configured` copy no longer names `AUTH_JWT_SECRET`. It is rendered on
  a **pre-authentication** screen, and telling an anonymous visitor that the
  deployment has no signing secret tells them authentication is not enforced. The
  message still describes a deployment fault, which is what AC-12 asks for.
- The `unknown` row renders text that an intermediary — any gateway in front of
  gowa — can choose. It is capped at 200 characters and rendered as a text child,
  never as HTML and never into an `href`. There is no `dangerouslySetInnerHTML`
  anywhere in `src/` today and a source-policy rule will keep it that way.

The 429 copy is worded around C-5 — "too many sign-in attempts from this
address" — because the limiter keys on the TCP peer and behind a reverse proxy
the address is shared. Blaming the user would be wrong more often than right.

### Distinguishing "expired" from "your permissions changed"

AC-22/AC-23 need the forced-logout message to be distinct from both the
credentials message and the expiry message, and the server sends no cause code
(C-2). The only available signal is local: **had the access token already expired
when the refusal arrived?** Revision 1 compared the timestamp directly. The
security lens pointed out that the timestamp is a client-clock value living in a
script-writable cookie, so revision 2 makes the inference defensive:

```ts
const CLOCK_SKEW_MS = 60_000

export function refusalReason(expiresAt: number | null): SessionEndReason {
  if (expiresAt === null) return 'expired'                     // unknown → neutral copy
  return expiresAt <= Date.now() + CLOCK_SKEW_MS ? 'expired' : 'permissions-changed'
}
```

Both changes tilt the same way on purpose: **"expired" is the benign verdict, so
it gets the benefit of the doubt.** Telling a user their permissions were changed
when nothing of the sort happened invites a support ticket about an
administrative action that never occurred; telling them their session expired
when an admin did change something costs them one extra sign-in. A missing or
tampered `gowa-ui.access_expires.v1` therefore reads as *unknown*, not as *not
expired* — revision 1 had it the other way round, which would have reported the
epoch case for every refusal on a browser with a cleared expiry cookie.

`spec.md > Known limits` already says this is an inference; it now names the
clock-skew and missing-cookie cases too.

### Why the 401 handler stops being `markUnauthorized()`

`useConnection.markUnauthorized()` exists because `z8pmx9md6x` had no session: a
401 could only mean "this origin is refused", and `ConnectPage` was the screen
that said so. Once a session exists a 401 from a guarded route means the opposite
— the origin is fine, the *token* is not — so the interceptor ends the session
instead.

One property is load-bearing and is stated here so a later edit cannot lose it: a
`token_epoch` bump 401s **every in-flight guarded request at once**. The teardown
must therefore be idempotent under a burst. It is, structurally: the store action
reads `status`, returns immediately unless it is `authenticated`, and the `set`
that changes it happens synchronously in the same function with no `await`
between the check and the write.

```ts
endRefusedSession: () => {
  const { status, access_token_expires_at } = get()
  if (status !== 'authenticated') return          // N concurrent 401s → one teardown
  get().endSession(refusalReason(access_token_expires_at))
}
```

`markUnauthorized` is removed. `ConnectionStatus` keeps its `unauthorized`
member, because `probeHealth()` still returns it: `/health` is public, so a 401
*there* really does mean something in front of gowa refuses this origin.

### The connection banner, and the trap in showing it

Revision 1 moved `ConnectPage`'s two messages onto the login screen driven by the
probe. The senior lens found the trap: the plan itself argues `/health` may
legitimately be unproxied, so a deployment where **login works perfectly** would
permanently display "Can't reach the server" above a working form.

The banner is therefore self-correcting. It shows while the probe says
`unreachable` or `unauthorized` **and** no login attempt has yet produced an HTTP
answer. The moment the server answers anything at all — a 200, a 401, a 429 — it
has demonstrably been reached, and the banner is retired for the life of the
page. Its Retry button calls `useConnection.boot()`, exactly as `ConnectPage`'s
did, which is also the only thing that can move a connection status that no
longer has `markUnauthorized` to change it.

### What the guard is, and what it must not be

```
status === 'unknown'        → a centered spinner (still booting; AC-9)
status !== 'authenticated'  → <Navigate to={LOGIN_PATH} state={{ from: location }} replace />
otherwise                   → <Outlet />
```

Four properties are load-bearing:

1. **`unknown` is not `anonymous`.** `z8pmx9md6y` drew that distinction exactly so
   a reload with a valid cookie does not flash the login form on its way to the
   dashboard. The guard is its first consumer.
2. **It reads the store with a selector — `useAuth((state) => state.status)` —
   never the whole store.** The guard sits above `AppShell`, so it re-renders the
   entire protected subtree; subscribing to the whole store would mean
   `storeTokenPair`'s four-field write re-renders the whole app, and that is
   precisely the write `z8pmx9md70`'s silent refresh will issue every ~15
   minutes. NFR-6 is this line.
3. **The destination travels in router state, not a query string**, and
   `afterLoginPath()` validates it anyway. Worth being precise about why: the app
   runs under `HashRouter`, so a destination is written after the `#` and cannot
   leave the origin *today*. NFR-2 rests on the validator, not on the router, so
   that a later `BrowserRouter` swap does not silently re-arm an open redirect.
4. **The guard sits above `AppShell`, not inside it.** Inside, `AppShell` would
   already have mounted `DeviceSwitcher`, which calls `useDevices()`, which would
   fire a guarded request before the redirect (AC-9, TC-4).

`AppShell`'s own `status !== 'connected'` redirect to `/connect` is deleted with
the page it pointed at. **Both** probe-gated queries move to the session gate —
`use-devices.ts` and `use-app-info.ts`, the second of which the senior lens caught
missing from revision 1's file list. Leaving either on the probe reproduces the
failure this ticket is fixing: a fully signed-in user with `/health` unproxied
gets no devices and no `/app/info`, so media URLs and Settings stay empty.

### The WebSocket gate, and the bug it uncovered

`sync()` gains a session requirement. Chasing it, the senior lens found a real
latent bug: after a refused handshake `scheduleReconnect()` calls `stop()` and
records `abandonedUrl`, and `stop()` never clears it — so a sign-out followed by
a sign-in would hit `if (url === this.abandonedUrl) return` and open no socket
ever again, with no state change able to unblock it.

The fix places the reset precisely: **a session ending forgets the abandoned
URL.**

```ts
sync(): void {
  if (useAuth.getState().status !== 'authenticated') {
    // A session change is the one event that can change a refused handshake's
    // outcome, so the abandonment is forgotten here — one attempt budget per
    // session, not one per tab, and not one per unrelated store write.
    this.abandonedUrl = null
    this.stop()
    return
  }
  ...
}
```

That satisfies both lenses at once: the senior lens's re-login must reopen, and
the performance lens's objection to refilling the retry budget on every unrelated
auth write (the reset happens on the *transition out*, and while anonymous the
branch only calls an idempotent `stop()`).

`sync()`'s connection check is replaced by the session check rather than added to
it. The socket's own handshake is a better liveness signal than a separate probe
— `ws.ts` already has abandon logic for a refused one — and keeping the probe
gate would reproduce the `/health`-unproxied footgun for the socket after it has
just been removed for the queries. This is a stated behaviour change: `ws.test.ts`
loses "stops the socket when the connection is not connected" and gains "stops
the socket when the session ends". Consequently `App.tsx` drops the
`useConnection` subscription that drove `sync()` — `sync()` no longer reads it —
and gains the `useAuth` one, so the subscription count is unchanged.

`stop()` also gains an early return when there is nothing to stop, so repeated
auth writes while anonymous do not each notify `useWsStore`'s subscribers.

### Sign-in, and the query cache

`signIn(credentials)` calls `POST /auth/login`, validates the envelope, and hands
the pair to `storeTokenPair`. It throws the `ApiError` up to the page, which maps
it with `toLoginError`. **It writes nothing on failure** — a failed login must
not disturb a session that is already held and must not create a partial one.

The cache teardown was revision 1's weakest step and drew a major from two
lenses. Revision 1 said "clear when `status` leaves `authenticated`", which is
level-triggered: it would fire on *every* auth-store write while not
authenticated, including `boot()`'s intermediate hydration write and
`consumeEndReason()`'s. And `clear()` alone does not stop a request already in
flight with the previous user's bearer from resolving into the fresh cache — on a
shared machine, user B seeing user A's chats.

```tsx
const status = useAuth((state) => state.status)
const hadSession = useRef(false)
useEffect(() => {
  if (status === 'authenticated') { hadSession.current = true; return }
  if (!hadSession.current) return
  hadSession.current = false
  void queryClient.cancelQueries()   // a cancelled query discards its result
  queryClient.clear()                // and then has no cache entry to write to
}, [status, queryClient])
```

Edge-triggered by the ref, so it runs once per session end. `cancelQueries()`
before `clear()` because the two together close the late-resolution window: the
query functions take no `AbortSignal`, so the HTTP request is not aborted, but a
cancelled query discards its result and a cleared cache has no entry left to
repopulate. Being precise about *why* it is safe matters more than the two lines.

A mounted observer may still refetch in the tick before the guard's redirect
unmounts it, producing a short burst of guarded 401s. That is bounded and
harmless *because* the interceptor's teardown is a no-op without a session — the
same property that absorbs the epoch burst — and there is a test for it.

### Not attaching credentials to the public auth routes

The interceptor currently attaches the token, and a device id, to every
same-origin request. `/auth/login`, `/auth/refresh` and `/auth/logout` are public,
read their body only, and have no use for either. The reference notes the server
tolerates a stale token on `/auth/login` — "the case that must always work" — but
tolerating is not a thing to depend on, and sending a dead credential to an
endpoint that ignores it is pure downside. The public-path check runs **first**,
before the store read, so those requests skip both.

What this does *not* buy, stated because the security lens is right that it is
easy to overclaim: the browser still attaches the session cookies to every
same-origin `/api/*` request, ADR-012's "the token travels twice". So the request
carries no `Authorization` header — which is what TC-9 asserts and all this
change enforces — while the dead access token still rides along in `Cookie`. The
server ignores it. Recorded in *Known limits*, not papered over.

### What is deliberately *not* rebuilt

`ConnectPage`'s content is relocated, not ported: its two messages become the
banner above the login form, with the same retry. The page is deleted (AC-5) and
`/connect` with it; the existing `path="*"` catch-all sends any stale link to `/`,
where the guard sends it on to `/login`.

## Steps

1. **`src/api/auth.ts`** — edit. Add `LoginCredentials`; `isAuthTokenPair()`
   (a runtime guard in the spirit of the existing `isAuthUser` — `ResponseData.results`
   is optional, so a 200 with an empty envelope would otherwise store a session
   made of `undefined`); `login(credentials)` →
   `results(http.post('/auth/login', credentials))` validated through the guard,
   rejecting with an `ApiError`-shaped `MALFORMED_TOKEN_PAIR`; and
   `logout(refresh_token)` → `http.post('/auth/logout', { refresh_token })` with
   the result discarded (the reference notes `results` is omitted there).
2. **`src/lib/auth-messages.ts`** — new. `LoginErrorKind`, `LoginError`,
   `RATE_LIMIT_WINDOW_SECONDS = 60` (C-4, cited to the reference),
   `MAX_SERVER_MESSAGE = 200`, `toLoginError()` implementing the table above,
   `SIGN_OUT_NOTICES` (the copy for `expired` and `permissions-changed`), and
   `CONNECTION_NOTICES` (the two messages inherited from `ConnectPage`). Named
   for messages, not errors, because it carries all three sets — the senior lens's
   point about revision 1's `auth-errors.ts` holding sign-out copy. It imports
   `SessionEndReason` with `import type`, so the store→messages edge is erased at
   build and adds no runtime cycle.
3. **`src/lib/auth-messages.test.ts`** — new. Every row of the table; both `503`
   codes; a `503` and a `401` with no code; a network error; the 200-character
   cap; and that the three sign-out notices and the credentials message are
   pairwise distinct (TC-2, TC-3, TC-8, AC-23).
4. **`src/lib/session-route.ts`** — new and small: `LOGIN_PATH`, `HOME_PATH`, and
   `afterLoginPath(from: unknown): string`. It takes `unknown` deliberately —
   revision 1 typed it `string` while the caller passes `location.state?.from`,
   a **Location object**, which would have stringified to `[object Object]` and
   silently dropped AC-7. It reads `pathname + search` from a Location-like
   object, accepts a plain string, and otherwise returns `HOME_PATH`. It rejects
   anything not starting with `/`, anything whose second character is `/` or `\`
   (browsers normalise `/\` to `//`), and anything containing a control
   character — then strips tab/CR/LF and re-applies the first two checks, because
   a stripped `\t//evil` becomes `//evil`.
5. **`src/lib/session-route.test.ts`** — new. A Location object round-trip with a
   query string; a plain string; `undefined`; and the rejections
   `//evil.example`, `/\evil.example`, `https://evil.example`, `javascript:alert(1)`,
   `/\t//evil.example` and `''` — each falling back to `/` (TC-4, NFR-2).
6. **`src/stores/auth.ts`** — edit.
   - `SessionEndReason = 'signed-out' | 'expired' | 'permissions-changed'`;
     `endReason` on state; `consumeEndReason()` returns and clears it.
   - `CLOCK_SKEW_MS` and the exported pure `refusalReason(expiresAt)`.
   - `endSession(reason)` — the involuntary teardown: drop the access cookie and
     access state, **keep the refresh token**, `status: 'anonymous'`, set the
     reason. `boot()`'s 401 branch is rewritten to call it with
     `refusalReason(...)`, which is the same behaviour it already had plus a
     reason — `boot()` never calls `signOut` and never touches the refresh cookie.
   - `endRefusedSession()` — the burst-safe wrapper the interceptor calls.
   - `clearSession(reason = 'signed-out')` — unchanged except for the reason.
   - `signIn(credentials)`; `signOut()` — issue `POST /auth/logout` with the
     refresh token, **do not await it**, then `clearSession('signed-out')`.
     Issuing before clearing satisfies AC-17; not awaiting satisfies AC-21
     literally. The `.catch(() => {})` is not decoration — an unhandled rejection
     from a fire-and-forget promise is an unhandled rejection.
   - `storeTokenPair` additionally resets `endReason` to `null`.
7. **`src/stores/auth.test.ts`** — edit. `signIn` stores the pair and the user;
   `signIn` failure leaves the store untouched and writes no cookie; `signOut`
   posts the refresh token, clears all three cookies, and completes even when the
   request rejects **and** when it never settles; `endSession` keeps the refresh
   cookie while dropping the access one; `refusalReason` at, inside, and outside
   the skew window and with a null expiry; `endRefusedSession` is a no-op without
   a session and produces exactly one teardown under a simulated 401 burst;
   `boot`'s 401 sets a reason without destroying the refresh token; the reason is
   consumed once. (TC-1, TC-2, TC-5, TC-6, TC-7.)
8. **`src/lib/http.ts`** — edit. `PUBLIC_AUTH_PATHS` checked **first** in the
   request interceptor — those three paths get neither `Authorization` nor
   `X-Device-Id` (AC-4; the device header is a previous session's device id and
   has no business on a public endpoint). In the response interceptor the 401
   branch calls `useAuth.getState().endRefusedSession()` instead of
   `markUnauthorized()`, still skipping `/auth/*`.
9. **`src/lib/http.test.ts`** — edit. No `Authorization` and no `X-Device-Id` on
   the three public paths; both still present on `/auth/me`; a 401 on `/chats`
   with an unexpired token ends the session as `permissions-changed`; with an
   expired one as `expired`; a 401 with no session held changes nothing; a 401 on
   `/auth/login` ends nothing (TC-7, TC-9).
10. **`src/stores/connection.ts` + `.test.ts`** — edit. Remove `markUnauthorized`
    and its test. `probeHealth`, `boot` and the `unauthorized` status stay: they
    are the login screen's banner and its retry.
11. **`src/lib/ws.ts` + `src/lib/ws.test.ts`** — edit. `sync()` requires a
    session and forgets `abandonedUrl` on the way out; the connection check is
    replaced, not augmented; `stop()` early-returns when there is nothing to
    stop. Tests: no socket without a session; an open socket closes when the
    session ends; **sign-out then sign-in reopens** (the latent bug); and the
    handshake ceiling is not exceeded twice within one session.
12. **`src/App.tsx`** — edit. Routes: `/login` public, a `RequireSession` layout
    route wrapping the `AppShell` layout route, `ConnectPage` and `/connect`
    deleted. `wsClient.sync()` subscribes to `useAuth` in place of
    `useConnection`. The edge-triggered `cancelQueries()` + `clear()` effect
    above.
13. **`src/components/layout/require-session.tsx`** — new. The guard, three
    inline branches, `useAuth((state) => state.status)`, `useLocation()`, and no
    other hook or computed prop. Exports only the component.
14. **`src/pages/login.tsx`** — new. `<form onSubmit>` with `preventDefault` (a
    native GET would put the password in the URL and in history);
    `type="password"`, `autoComplete="current-password"`, `autoComplete="username"`;
    both fields `required` and submit disabled while either is empty or a
    submission is in flight; the error banner from `toLoginError`; the sign-out
    notice from `consumeEndReason`; the self-retiring connection banner with its
    `boot()` retry; the 429 countdown; the `status === 'authenticated'` redirect
    (AC-8); and on success `navigate(target)` where `target` is `HOME_PATH` when
    the notice was a deliberate `signed-out` and `afterLoginPath(location.state?.from)`
    otherwise — so logging out and back in does not bounce the next user to the
    previous one's page. `password` lives in `useState` and is cleared in
    `finally`. Every rejection is already an `ApiError`: the response interceptor
    rejects with `toApiError(error)`, never the `AxiosError`, so the request body
    that carried the plaintext password is not reachable from anything the page
    handles or could log.
15. **`src/features/auth/retry-countdown.tsx`** — new, ~15 lines. Holds an
    absolute `retryAt` and renders the remaining seconds from one
    `setInterval` inside a `useEffect` with a `clearInterval` cleanup — one timer
    per deadline, torn down on unmount, including the unmount caused by the AC-8
    redirect when `boot()` resolves under a mounted login page. It is a child
    component so the 1 Hz tick does not re-render the two controlled inputs for
    the length of the rate-limit window.
16. **`src/components/layout/user-menu.tsx`** — new. A `DropdownMenu` showing
    `user.username` and `user.role` with a **Log out** item calling `signOut()`
    (AC-16), placed in the `AppShell` header beside `ThemeToggle`.
17. **`src/components/layout/app-shell.tsx`** — edit. Drop the connection gate and
    the `/connect` redirect; add `<UserMenu />`.
18. **`src/hooks/use-devices.ts` + `src/hooks/use-app-info.ts`** — edit. Both
    `enabled` gates read `useAuth((state) => state.status === 'authenticated')`
    instead of the probe.
19. **`src/pages/connect.tsx`** — **deleted** (AC-5).
20. **`src/lib/source-policy.test.ts`** — edit. Four changes:
    - widen `CREDENTIAL` from `password\s*[:=]` to a bare `password`, which
      *strengthens* the existing credential-versus-web-storage rule and now
      covers the login page for free. Verified safe: after comment stripping, no
      shipped source file mentions `password` today, and `passkey` does not match.
    - a containment rule — bare `password` may appear only in `src/api/auth.ts`
      (the request type) and `src/pages/login.tsx` (the field). Pinned to the
      identifier rather than to `password:` so `setPassword(x)` and
      `formData.password` cannot slip past, which was the security lens's
      objection to revision 1's rule.
    - a single-teardown rule — `clearSession(` and `endSession(` are called only
      from `src/stores/auth.ts`. Tighter than revision 1's three-file allowlist
      *and* not coupled to `z8pmx9md70`, whose refresh path will live inside the
      store anyway.
    - `dangerouslySetInnerHTML` appears nowhere in `src/`, making the login
      screen's "server text is rendered as text" property executable.
21. **Artifacts** — `ticket.md`, `spec.md`, this file, then `implement.md` and
    `verify.md` under `_specs/z8pmx9md6z/`.

## Files to change

| File | Change |
|---|---|
| `src/api/auth.ts` | edit — `login()`, `logout()`, `isAuthTokenPair` (REQ-2, REQ-12) |
| `src/lib/auth-messages.ts` | **new** — error catalogue, sign-out and connection copy (REQ-10, REQ-15, REQ-18) |
| `src/lib/auth-messages.test.ts` | **new** — TC-2, TC-3, TC-8, AC-23 |
| `src/lib/session-route.ts` | **new** — `LOGIN_PATH`, `afterLoginPath` (NFR-2) |
| `src/lib/session-route.test.ts` | **new** — TC-4 |
| `src/stores/auth.ts` | edit — `signIn`, `signOut`, `endSession`, `refusalReason`, `endReason` |
| `src/stores/auth.test.ts` | edit — TC-1, TC-2, TC-5, TC-6, TC-7 |
| `src/lib/http.ts` | edit — public auth routes carry no credential; 401 ends the session |
| `src/lib/http.test.ts` | edit — TC-7, TC-9 |
| `src/stores/connection.ts` | edit — `markUnauthorized` removed |
| `src/stores/connection.test.ts` | edit — that test removed |
| `src/lib/ws.ts` | edit — session gate, `abandonedUrl` reset, `stop()` early return |
| `src/lib/ws.test.ts` | edit — AC-19 and the re-login regression |
| `src/App.tsx` | edit — routes, guard, cache teardown, ws subscription |
| `src/components/layout/require-session.tsx` | **new** — the route guard (REQ-7, REQ-8) |
| `src/pages/login.tsx` | **new** — the login screen (REQ-1, REQ-10, REQ-16..REQ-18) |
| `src/features/auth/retry-countdown.tsx` | **new** — the 429 countdown (AC-11) |
| `src/components/layout/user-menu.tsx` | **new** — the logout control (REQ-11) |
| `src/components/layout/app-shell.tsx` | edit — connection gate out, user menu in |
| `src/hooks/use-devices.ts` | edit — session-gated query |
| `src/hooks/use-app-info.ts` | edit — session-gated query |
| `src/pages/connect.tsx` | **deleted** (AC-5) |
| `src/lib/source-policy.test.ts` | edit — four rule changes (step 20) |
| `_specs/z8pmx9md6z/ticket.md` | ticket record |
| `_specs/z8pmx9md6z/spec.md` | specification |
| `_specs/z8pmx9md6z/plan.md` | this file |
| `_specs/z8pmx9md6z/implement.md` | written at implement |
| `_specs/z8pmx9md6z/verify.md` | written at verify |

**No file in `project-config.yaml > deployment_runtime.files` is touched**
(`.github/workflows/ci.yml`, `.github/workflows/release.yml`, `vite.config.ts`,
`package.json`, `index.html`) — NFR-4. **No dependency is added.** The
performance lens verified the bundle claim independently: `dropdown-menu`,
`input`, `label`, `card` and `button` all exist under `src/components/ui/` *and
are already imported by shipped code*, so `radix-ui` is already in the entry
chunk and the two new pages add markup only. Deleting the 70-line `connect.tsx`
makes the ticket close to net-neutral on weight.

## Validation strategy

Profile **`ui-build`** (`project-config.yaml > validation_profiles`):
`ui-typecheck` → `ui-lint` → `ui-test` → the production build. The build is in the
profile because this ticket deletes a route module, adds four, and extends the
import cycle `z8pmx9md6y` introduced — rollup, not `tsc`, is what would object.

Beyond the profile:

- **Mutation-test each new source-policy rule**, as `z8pmx9md6y` did: a
  `setPassword(` call and a `password:` literal in a third file must each turn
  the containment rule red; a `clearSession(` call outside the store must turn
  the teardown rule red; a `dangerouslySetInnerHTML` must turn the fourth red. A
  guard nobody has watched fail is an assertion, not a guard.
- **Mutation-test the two panel-driven fixes that are easy to lose**: remove the
  `abandonedUrl` reset and show the re-login test goes red; make the cache
  teardown level-triggered again and show the edge test goes red.
- **Live check against a running gowa** where one is reachable: a real
  `POST /auth/login`, the guard redirect from `/chats` and the return to it after
  signing in, a real `POST /auth/logout` observed in the network panel, and a
  confirmation that `/auth/login` leaves with no `Authorization` header.
- **Read-through of the four `.tsx` files** against AC-1, AC-16, AC-24 and AC-26,
  recorded in `verify.md` **as a read-through, not as an executed test**. An
  honest statement of what C-1 leaves unproven is worth more than a test that
  asserts markup it also wrote.

## Rollback

`git revert` of the single publishable commit. The change is additive at the
route level: reverting restores `ConnectPage`, the `/connect` route and
`markUnauthorized`, and drops the guard. No cookie name, persisted zustand
`name`, query key or `ResponseData` shape changes, so a browser that ran the new
bundle holds nothing the old one would misread — the panel confirmed this
independently. The only residue is cookies already in browsers, which the
restored `z8pmx9md6y` code reads exactly as before.

## Out of scope

Exactly as `spec.md > Out of scope`: no silent refresh, rotation or 401 recovery
(`z8pmx9md70`); no permission-driven UI (`z8pmx9md71`); no `?access_token=` on the
WebSocket; no password change or user administration; no backend change and no
BFF; no retirement of the health probe or the connection store; and no edit to
`PROJECT-GUIDE-ar.html`, `worker/index.js`, `wrangler.jsonc`, or any deployment
runtime file.

## Panel response

Three read-only lenses reviewed revision 1 before any code was written:
`senior-reviewer`, `security-reviewer`, `performance-reviewer` (ADR-010). They
returned **36 findings — 9 major (4 senior, 3 security, 2 performance), 16 minor,
11 info**. Disposition: **33 adopted, 1 declined with reasons, 2 noted without a
design change**. Every claim below was checked against the source before it was
accepted; one was accepted with its reasoning corrected.

### The findings that changed the design (7)

1. **An involuntary teardown must not revoke the refresh-token family**
   *(security, major ×2 — plus senior's import-cycle note arriving at the same
   escape hatch).* Revision 1 routed the 401 interceptor and `boot()` through the
   same `signOut` as the logout button, which fires `POST /auth/logout` and
   deletes the refresh cookie. That destroys the 30-day credential `z8pmx9md70`
   is being built on, and it silently reverses `z8pmx9md6y`'s explicit decision —
   its `boot()` catch keeps the refresh token with a comment saying why. Adopted
   in full: `signOut()` and `endSession(reason)` are now two actions, split on
   *who ended the session*, and `boot()` keeps its narrow teardown.
   **One correction to the finding's reasoning:** it argued a Normal User could
   self-DoS by clicking a nav item they lack permission for. Per reference §02
   an authenticated-but-insufficient request is **403**, not 401, so that
   particular path does not arise. The conclusion stands on the refresh-token
   argument alone, which is why it was adopted anyway.
2. **`wsClient` would never reopen after a re-login** *(senior, major).*
   Verified in the source: `scheduleReconnect()` calls `stop()` then sets
   `abandonedUrl`, and `stop()` never clears it, so `sync()`'s
   `url === this.abandonedUrl` early return is permanent for the tab. A latent
   bug revision 1 would have made reachable. Adopted, with the reset placed on
   the session-ending branch — which also answers the performance lens's opposite
   concern about refilling the retry budget on unrelated writes. The performance
   lens read the same field and concluded the current behaviour was correct; on a
   session change it is not, and the regression test now pins it.
3. **The cache teardown was level-triggered and did not close the
   late-resolution window** *(performance major + security major).* Revision 1
   said "clear when `status` leaves `authenticated`", which fires on every write
   while not authenticated — `boot()`'s intermediate hydration write included.
   And `clear()` alone lets a request in flight with the previous user's bearer
   resolve into the fresh cache: on a shared machine, user B seeing user A's
   data. Adopted: edge-triggered by a ref, `cancelQueries()` before `clear()`,
   with the reason it is safe written down rather than assumed.
4. **`use-app-info.ts` was missing from the file list** *(senior, major).*
   Verified: a second `enabled: status === 'connected'` consumer. Leaving it
   probe-gated reproduces exactly the failure the plan fixes in `use-devices`.
   Adopted.
5. **The connection banner would lie on a working deployment** *(senior,
   major).* If `/health` is unproxied but `/api` works, revision 1 shows "Can't
   reach the server" permanently above a form that signs in perfectly. Adopted:
   the banner retires itself the moment the server answers anything, and its
   retry calls `boot()` — which is also the only thing that can still move a
   connection status now that `markUnauthorized` is gone (senior, minor).
6. **`afterLoginPath` had the wrong signature and too weak a validator**
   *(security, minor — but it would have silently dropped AC-7).* Revision 1
   typed it `(from: string)` while the caller passes a Location **object**, which
   stringifies to `[object Object]`. Adopted with the widened rejection set:
   `/\`, control characters, and a strip-then-recheck pass.
7. **The refusal inference trusted a client clock and a script-writable cookie**
   *(security, minor).* Adopted: a 60-second skew tolerance, and a null expiry now
   reads as *unknown* → the neutral "expired" copy, where revision 1 read it as
   *not expired* → the epoch message. Both changes tilt toward the benign verdict
   on purpose.

### Adopted without a design change (26)

**Senior.** `guardOutcome` was an abstraction with one caller — removed, the
guard's branches are inline (which also keeps `require-session.tsx` out of the
`only-export-components` warning set). A deliberate logout stamping `state.from`
would bounce the next sign-in back to the previous user's page — the login page
now sends a `signed-out` notice to `HOME_PATH`. `SIGN_OUT_NOTICES` sat in a module
named for login errors — renamed to `auth-messages.ts`. The distinctness
assertion is kept but described in `verify.md` for what it is, a copy-paste
regression guard, not proof of AC-23; AC-23's real evidence is the read-through.
`X-Device-Id` still rode along on the login request — the public-path check now
skips it too, and the plan records that AC-2 constrains the body. The stated
Rollback was confirmed real, no action.

**Security.** The stale access cookie still reaches `/auth/login` in the `Cookie`
header even with no `Authorization` — TC-9's claim is narrowed to what is
actually enforced and the cookie hop is named in *Known limits*. `AUTH_JWT_SECRET`
is no longer named to an anonymous visitor. The `unknown` server message is
capped at 200 characters, rendered as a text child, and a source-policy rule now
forbids `dangerouslySetInnerHTML` anywhere. The password lifecycle is pinned:
`type="password"`, `autoComplete`, `onSubmit` with `preventDefault`, and the note
that the interceptor rejects with `ApiError` — never the `AxiosError` whose
`config.data` holds the plaintext body. The `password` source rule is repinned to
the bare identifier so `setPassword(` cannot slip past, with both mutation tests
committed to. `HashRouter` is recorded as the reason the redirect surface is
structurally safe *today*, so a later router swap is understood to re-arm it. The
WebSocket deferral was endorsed; its `abandonedUrl` hygiene note is folded into
finding 2.

**Performance.** The guard must use `useAuth((s) => s.status)` and never the whole
store — now stated as a requirement with the reason (`storeTokenPair`'s write is
the one `z8pmx9md70` will issue every 15 minutes). `stop()` gains an early return
so repeated auth writes do not notify `useWsStore`. The countdown holds an
absolute `retryAt` in a `useEffect` with `clearInterval` cleanup, and lives in its
own child component so the 1 Hz tick does not re-render the two controlled
inputs. The public-path check is ordered before the store read. The
`endRefusedSession` guard's synchronous no-`await` window is stated explicitly so
a later edit cannot reopen the 401 burst. The bundle and `use-devices` findings
confirmed the plan; no action.

### Declined, with reasons (1)

- **Send the logout via `sendBeacon`/`keepalive` so a tab closed in the same tick
  still revokes the family** *(security, info).* The observation is correct — the
  fire-and-forget POST is only *scheduled* when `clearSession` runs, so a tab
  closed immediately after leaves the refresh family live server-side until it
  expires. Declined because the remedy costs more than it buys: `sendBeacon`
  bypasses the axios instance, and with it the envelope handling, the error
  normalisation and the single-door property the whole `src/api/` layer exists
  for — a second HTTP door added for a race measured in milliseconds, on a token
  that expires on its own and that the user can revoke by signing out again. The
  residual is recorded in *Known limits* instead.

### Noted, without a design change (2)

- The single-teardown source rule will need extending when `z8pmx9md70` adds its
  refresh path *(senior, info)*. Answered by tightening rather than widening the
  rule: it now confines `clearSession(`/`endSession(` to `src/stores/auth.ts`,
  and the refresh path will live inside that store, so the successor ticket
  should not need to touch the allowlist at all.
- The guard's `useLocation()` adds a second full-subtree render per navigation on
  top of `AppShell`'s own *(performance, minor)*. Kept: the destination cannot be
  preserved without it, and the cost is bounded because the guard does nothing
  else. `verify.md` records the check that `RequireSession` holds no other hook
  and computes no props, so the extra render is a pass-through rather than a new
  source of work.
