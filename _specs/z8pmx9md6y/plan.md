---
ticket: z8pmx9md6y
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-09-05
links:
  clickup: "https://app.clickup.com/t/z8pmx9md6y"
  github: ""
---

# Plan — 2 · Build the single-source-of-truth auth session store on cookies

> **Revision 2.** Revision 1 was reviewed by the advisory panel (senior /
> security / performance) **against the source**, before any code was written.
> 24 findings came back — **19 adopted, 3 declined with reasons, 2 noted** — and
> two of them changed the design outright. Every finding and its disposition is
> recorded in *Panel response* at the end of this file; the body below is
> revision 2, i.e. the plan **after** the panel.

## Approach

Two new modules own everything this ticket adds, and four existing files gain a
few lines each.

1. **`src/lib/cookies.ts`** — the only code in `src/` that touches
   `document.cookie` (REQ-4). It is split in two on purpose: a **pure**
   attribute-string builder that takes `secure` as an argument, and a thin I/O
   layer that reads the page's own scheme. The split is what makes TC-7
   executable under the Node test environment (C-2), where there is no
   `document` and no `location`.
2. **`src/stores/auth.ts`** — the single owner of the session (REQ-1). It holds
   the fields REQ-2 names, converts `expires_in` to an absolute timestamp
   exactly once (REQ-3), and is the only module that calls the cookie adapter
   for a session value.
3. **`src/api/auth.ts`** — a typed `GET /auth/me` client and the two shapes the
   backend documents (`AuthUserView`, `AuthTokenPair`), with a runtime shape
   check on the response. One module per API area is the repository's layering
   (AGENTS.md).
4. **`src/lib/http.ts`** — the shared request interceptor attaches
   `Authorization: Bearer <token>` read from the store, **on same-origin
   requests only** (REQ-8); the response interceptor stops treating a 401 from
   an `/auth/*` endpoint as "the server refuses this origin".
5. **`src/App.tsx`** — the boot effect calls the store's `boot()` alongside the
   existing connection probe.
6. **`src/lib/curl.ts`** — the rendered command gains a **valueless**
   `Authorization: Bearer <token>` placeholder, so the file's own claim that the
   command mirrors what the interceptor sends stays true.
7. **`src/lib/source-policy.test.ts`** — the executable regression guard NFR-1
   demands, plus five sibling source rules that would otherwise be review
   discipline.

Nothing creates a session (C-4). What ships is rehydration of a session that is
already in cookies, and the store the login screen will write into.

### What is persisted, and what is not

Three cookies, no more:

| Cookie | Holds | `Max-Age` |
|---|---|---|
| `gowa-ui.access.v1` | the access token | the `expires_in` the server returned |
| `gowa-ui.refresh.v1` | the refresh token | `2592000` (30 days, reference §03) |
| `gowa-ui.access_expires.v1` | the absolute expiry, epoch ms | same as the access cookie |

The names follow the repository's versioned-persisted-state convention
(`gowa-ui.connection.v1`; AGENTS.md anti-pattern #7), so a later shape change is
a name change and cannot silently misread what a browser already holds.

**`user` and `permissions[]` are deliberately not persisted.** REQ-7 makes
`/auth/me` the authority for both, and a cached copy is a second source of truth
one epoch bump away from being wrong — exactly the disagreement this ticket
exists to prevent. It also keeps every cookie far below the 4 KB limit.

**The third cookie is not decoration.** Without it, a reload restores a token
whose `access_token_expires_at` is `null`, and REQ-2 names that field as owned
state. Persisting the value REQ-3 computes once is what makes the field true
after a reload rather than only within one page life — and it is what lets
`boot()` check *unexpired* rather than merely *present* (REQ-7). It holds a
timestamp, not a secret.

**All three carry `Path=/`, and that is not negotiable here** — not because AC-7
says so, but because these cookies are read by JavaScript. `document.cookie`
only exposes cookies whose `Path` is a prefix of the *document's* path, and this
SPA is served at the origin root. A refresh cookie scoped to `/api/auth` would be
invisible to the store that owns it, and the refresh token travels in a **request
body**, not a `Cookie` header, so nothing would ever read it there either. The
cost — every same-origin request carries both cookies the server ignores — is
real, measured, and recorded in ADR-012.

The refresh token's own 30 days is a **constant read from the reference**, not
from the response: the server returns `expires_in` for the access token alone
(§03). If that lifetime ever changes server-side, the cookie outlives or
underlives the token — a bounded, documented inaccuracy, and the only one
available without a field the API does not send.

### Why the store, and not `zustand/persist`

`persist` with a cookie storage would need a custom `StateStorage`, would
serialise the whole slice into one cookie (`user` included, against the previous
section), and would rehydrate asynchronously — which is precisely the window in
which `http.ts` would attach no header. Three explicit cookie reads in `boot()`
are smaller, synchronous, and auditable. AC-10 forbids the `localStorage`
variant; the auth store uses no `persist` at all.

`src/stores/device.ts` and `src/stores/recipient.ts` **do** use `persist` over
`localStorage`, for a selected device id and recent recipients. Neither is a
credential, both predate this ticket, and `z8pmx9md6x` already examined and
accepted them. The source-policy guard is therefore written against
**credentials**, not against web storage as such — see step 8.

### The exactly-once boot (AC-14), and its synchronous half

`boot()` is called from `App.tsx`'s mount effect, and React StrictMode invokes
that effect **twice** in development, so a latch is not optional. The latch is
the session state itself: `boot()` returns immediately unless
`status === 'unknown' && access_token === null`, and it makes that no longer true
**synchronously, before its first `await`**.

That ordering carries a second load. Cookie hydration and the `access_token`
write happen in the same synchronous run, so there is no window in which a query
fires with no bearer header, 401s, and bounces the app to `/connect`. The plan
commits to it and `auth.test.ts` asserts it by reading the store between calling
`boot()` and awaiting it.

Using state as the latch rather than a `bootStarted` field keeps AC-4's field
list literally true, publishes no extra store update, and needs no test-only
reset hatch.

Boot does nothing at all when no access cookie is present: a first-time visitor
issues zero auth requests.

### When `/auth/me` is called, and what a failure does

`fetchMe()` runs only when a token was hydrated **and**
`access_token_expires_at` is either absent or still in the future (REQ-7). An
expired cookie that a clock skew left behind therefore costs nothing instead of
buying a guaranteed 401.

The response is shape-checked before it is trusted: `ResponseData.results` is
optional in `src/api/types.ts`, so a 200 whose envelope carries no user object
would otherwise land as `authenticated` with `user: undefined` — the exact
opposite of "the authoritative source for `user` and `permissions[]`". A
missing or shapeless `results` is a **failed** rehydration.

- **401** — the token is genuinely refused (a token-epoch bump is the documented
  cause, §03). The access token and its expiry are dropped from state and from
  cookies, **the refresh cookie is left untouched**, and the session becomes
  `anonymous`. Recovery is `z8pmx9md70`'s.
- **Anything else** (network failure, 5xx, a malformed envelope) — the token is
  *not* discarded, because nothing said it was invalid; the session becomes
  `anonymous` for this page life and the next reload tries again.

Neither path calls `/auth/refresh`, and neither retries.

### A 401 from `/auth/*` is not the server refusing this origin

Revision 1 accepted a race: `http.ts`'s response interceptor calls
`useConnection.markUnauthorized()` on **any** 401, and that only downgrades a
status already `connected` — so the same reload landed on the dashboard or on
`/connect` depending on whether the health probe won. Two lenses independently
called that out, and they are right: a nondeterministic landing screen is a
defect, not an accepted consequence.

The fix is semantic, not a workaround. `markUnauthorized` exists to say *this
origin's backend refuses us* — the `/connect` screen it drives reads "The server
rejected this session". A 401 from `/auth/me`, `/auth/login`, `/auth/refresh` or
`/auth/logout` says something completely different: **no valid session**, from
endpoints the reference documents as public (§03). So the response interceptor
excludes the `/auth/` prefix from `markUnauthorized`, and REQ-9's "recovery is
deferred" becomes a deterministic outcome rather than a coin flip. This is the
same reasoning that already exempts `probeHealth` (AGENTS.md anti-pattern #6),
applied to the one other endpoint group whose 401 is about credentials.

Every guarded endpoint keeps the existing behaviour untouched.

### The bearer header is attached to same-origin requests only

The interceptor attaches `Authorization` only when the request URL is relative.
axios ignores `baseURL` for an absolute URL, and this codebase has a standing
source of absolute URLs: the server builds `qr_link` and `file_path` from its
own `Host` header (`rerootServerUrl` in `src/lib/url.ts` exists for that reason).
A future caller that forwards one of those straight into `http` would otherwise
ship the access token to whatever host the backend named. One regex, one
`source-policy` rule, and the class of bug is closed before it exists.

### The import cycle, stated rather than discovered

`stores/auth.ts` → `api/auth.ts` → `lib/http.ts` → `stores/auth.ts` is a cycle.
It is safe **because every reference across it is call-time**: `http.ts` reads
`useAuth.getState()` inside an interceptor callback, and `api/auth.ts` reads
`http` inside a function body. Neither dereferences the other during module
evaluation, so no partial-module TDZ error is reachable in either evaluation
order. The alternative — a `setTokenGetter()` registration hook in `http.ts` —
trades a documented cycle for permanent indirection in the file every request
passes through.

The production build is the thing that would object to it, so this ticket's
validation profile is `ui-build`, not `ui-source`.

### What is already done and is not re-done

AC-11 / AC-12 / AC-13 (legacy `localStorage` cleanup, no credential migration,
`username`/`password` gone from `src/stores/connection.ts`) were **delivered by
`z8pmx9md6x`**: `clearLegacyStorage()` already runs in `useConnection.boot()`,
already only calls `removeItem`, and the store already has no credential fields.
Re-implementing that in the auth store would create a second owner of the same
cleanup for no gain. This plan verifies those three criteria against the code and
its existing tests, and adds the source-policy guard that keeps them true.

## Steps

1. **`src/lib/cookies.ts`** — new.
   - `cookieAttributes(name, value, maxAgeSeconds, secure)` → the exact string
     `"<name>=<encoded>; Path=/; SameSite=Strict; Max-Age=<n>"`, with
     `"; Secure"` appended when `secure`. Pure, exported, and the thing TC-7
     asserts against.
   - `isSecurePage()` → `typeof location !== 'undefined' && location.protocol === 'https:'`.
   - `getCookie(name)` → parses `document.cookie`, `decodeURIComponent`s the
     value, returns `null` when absent or when `document` is undefined.
   - `setCookie(name, value, maxAgeSeconds)` → writes
     `cookieAttributes(..., isSecurePage())`; `maxAgeSeconds` is floored and
     clamped to `>= 0`.
   - `removeCookie(name)` → the same string with an empty value and
     `Max-Age=0`, and the **same** `Path`/`SameSite`/`Secure`, because a cookie
     is only deleted by a matching path.
   - Every write goes through `encodeURIComponent`: the refresh token is opaque
     bytes and nothing guarantees it is free of `;` or `=`.
   - Every entry point is wrapped so a browser with cookies disabled degrades to
     "no session" instead of throwing during boot.
2. **`src/lib/cookies.test.ts`** — new. The exact attribute string under
   `https:` and under `http:`, `Max-Age` from the lifetime, `Max-Age=0` on
   removal, round-trip of a value containing `;` and `=`, `null` for an absent
   cookie, and no throw when `document` is undefined.
3. **`src/api/auth.ts`** — new. `AuthUser` (the reference's `AuthUserView`:
   `user_id`, `username`, `account_id`, `role`, `roles[]`, `permissions[]`,
   `status`), `AuthTokenPair` (`access_token`, `refresh_token`, `expires_in`,
   `user`), an `isAuthUser()` runtime guard, and
   `fetchMe(): Promise<AuthUser>` → `results(http.get('/auth/me'))` **validated
   through the guard**, throwing an `ApiError`-shaped rejection when the
   envelope carries no usable principal.
4. **`src/stores/auth.ts`** — new.
   - `SessionStatus = 'unknown' | 'anonymous' | 'authenticated'` (REQ-10).
   - State: `access_token`, `refresh_token`, `access_token_expires_at` (epoch
     ms), `user`, `status`. No sixth field: the boot latch is derived from
     `status` + `access_token`.
   - `storeTokenPair(pair)` — the **one** place `expires_in` becomes a
     timestamp: `Date.now() + expires_in * 1000` (REQ-3). Writes all three
     cookies, sets `user` when the pair carries one, sets status.
     `expires_in` itself is never kept on state (TC-6).
   - `clearSession()` — removes all three cookies, resets to `anonymous`.
   - `boot()` — latch, synchronous hydration, then at most one `fetchMe()`,
     gated on the token being unexpired, with the failure handling above.
   - `diagnostics()` — `{ status, hasAccessToken, hasRefreshToken,
     accessTokenExpiresAt (ISO string or null), user: { user_id, username,
     role, permissionCount } | null }`. No token value, ever (REQ-10, AC-19).
   - Module-private `writeAccess` / `writeRefresh` / `clearAccess` /
     `clearRefresh` keep the cookie names in one place; nothing outside this
     module names a session cookie.
5. **`src/stores/auth.test.ts`** — new, over a stubbed `document.cookie` jar and
   a mocked `@/api/auth`: the seconds→timestamp conversion, the cookie names and
   lifetimes actually written, boot-with-no-cookie (no request at all),
   boot-with-token (one `fetchMe`, user and permissions from the response),
   double boot (still one `fetchMe`), **the token is readable synchronously
   before `boot()`'s promise settles**, an expired cookie (no request at all),
   a 200 with no `results` (anonymous, token kept), 401 (anonymous, refresh
   token retained), network failure (access token retained), `clearSession`,
   and the diagnostic naming no token.
6. **`src/lib/http.ts`** — two edits.
   - Request interceptor, after the device header: read
     `useAuth.getState().access_token` and set `Authorization: Bearer <token>`
     when a token is held, the caller has not set the header itself, and the
     request URL is **not absolute**. One store read per request, no allocation
     when there is no token.
   - Response interceptor: call `markUnauthorized()` only when the 401 did not
     come from an `/auth/` path.
7. **`src/App.tsx`** — in the existing boot effect, `void useAuth.getState().boot()`
   next to the connection probe. Now that an `/auth/me` 401 no longer touches
   `useConnection`, the two are genuinely independent and running them in
   parallel costs nothing; chaining would add the probe's latency to every
   authenticated reload.
8. **`src/lib/curl.ts` + `src/lib/curl.test.ts`** — the rendered command gains
   `-H 'Authorization: Bearer <token>'`, a literal placeholder with **no value
   read from anywhere**, exactly as the file already renders `@filename` for a
   picked file it cannot read. Without it the file's own comment — "the command
   is the request the UI would send" — becomes false for every guarded endpoint
   the moment step 6 lands. The test asserts the placeholder is present and that
   no token value can reach the output.
9. **`src/lib/source-policy.test.ts`** — new. Reads every non-test source file
   **once**, through `import.meta.glob('../**/*.{ts,tsx}', { query: '?raw',
   eager: true })`, and asserts six rules, each with a message that states the
   rule it enforces. The glob is deliberate: it puts the guarded files in
   vitest's module graph, so watch mode re-runs the guard on the very edit it
   exists to catch — a disk walk would not.
   - **Credential-scoped storage ban (AC-9):** no file that mentions a
     credential identifier (`access_token`, `refresh_token`, `password`,
     `credential`, `Bearer`) may mention `localStorage` or `sessionStorage`.
   - **Closed allowlist (AC-9):** the only files that may mention web storage at
     all are `stores/connection.ts` (the legacy `removeItem`), `stores/device.ts`
     and `stores/recipient.ts` (a device id and recent recipients, neither a
     credential, both predating this ticket). A new file that reaches for web
     storage fails until it is justified here.
   - **No `persist` in the auth store (AC-10):** `stores/auth.ts` contains
     neither `persist(` nor `createJSONStorage`.
   - **One cookie door (AC-6, TC-3):** `document.cookie` appears only in
     `lib/cookies.ts`.
   - **No JWT decoding (AC-15, AC-16):** no `atob(`, no `jwt-decode`, no
     `jwtDecode` anywhere in `src/`.
   - **One token reader (AC-18, AC-2):** the identifier `access_token` appears
     only in `stores/auth.ts`, `api/auth.ts` and `lib/http.ts`; `Bearer` only in
     `lib/http.ts` and in `lib/curl.ts`'s valueless placeholder. That is what
     keeps the token out of the cURL dialog and the WebSocket URL.
10. **`src/lib/api-error.test.ts`** — one added case: the `ApiError` produced
    from a rejected request that carried an `Authorization` header serialises
    without the token, so AC-18 rests on an executed assertion and not only on a
    source grep.
11. **`.claude/docs/adr/ADR-012-cookie-session-storage.md`** — new. The ticket
    requires the cookie-over-`localStorage` decision, and its explicit non-claim
    about XSS, to be recorded as an ADR. It also carries the four costs the panel
    measured: the token on the wire twice, the bundle request carrying cookies,
    the 30-day refresh window, and the TLS requirement on the backend hop.
12. **Artifacts** — `ticket.md`, `plan.md` (this file), then `implement.md` and
    `verify.md` under `_specs/z8pmx9md6y/`.

## Files to change

| File | Change |
|---|---|
| `src/lib/cookies.ts` | **new** — the cookie adapter (REQ-4, REQ-5) |
| `src/lib/cookies.test.ts` | **new** — TC-7 |
| `src/api/auth.ts` | **new** — `AuthUser`, `AuthTokenPair`, `isAuthUser`, `fetchMe()` |
| `src/stores/auth.ts` | **new** — the session store (REQ-1..REQ-3, REQ-6, REQ-9, REQ-10) |
| `src/stores/auth.test.ts` | **new** — TC-4, TC-6, TC-8, TC-9 |
| `src/lib/source-policy.test.ts` | **new** — TC-1, TC-3, TC-5 |
| `src/lib/http.ts` | edit — same-origin `Authorization: Bearer` (REQ-8); `/auth/*` 401 excluded from `markUnauthorized` |
| `src/lib/curl.ts` | edit — valueless `Authorization` placeholder |
| `src/lib/curl.test.ts` | edit — the placeholder, and no token value in the output |
| `src/lib/api-error.test.ts` | edit — a serialised error carries no token (AC-18) |
| `src/App.tsx` | edit — call `useAuth.boot()` in the existing boot effect |
| `.claude/docs/adr/ADR-012-cookie-session-storage.md` | **new** — the accepted-risk record |
| `_specs/z8pmx9md6y/ticket.md` | ticket record |
| `_specs/z8pmx9md6y/plan.md` | this file |
| `_specs/z8pmx9md6y/implement.md` | written at implement |
| `_specs/z8pmx9md6y/verify.md` | written at verify |

**No file in `project-config.yaml > deployment_runtime.files` is touched**
(`.github/workflows/ci.yml`, `.github/workflows/release.yml`, `vite.config.ts`,
`package.json`, `index.html`) — NFR-5. No dependency is added: `zustand` and
`axios` are already present, and the cookie adapter is ~50 lines rather than a
new package (AGENTS.md anti-pattern #8). `worker/index.js` and `wrangler.jsonc`
are **not** touched: the panel's edge-cache and TLS findings are recorded as
deployment consequences in ADR-012, not implemented here.

## Validation strategy

Profile **`ui-build`** (`project-config.yaml > validation_profiles`):
`ui-typecheck` → `ui-lint` → `ui-test` → the production build. The build is in
the profile for one specific reason: this ticket introduces the repository's
first import cycle, and rollup — not `tsc` — is what would object to it.

Beyond the profile:

- **Mutation-test the guard** (TC-5's real content): temporarily write a token
  to `localStorage` from a non-store module, show `source-policy.test.ts` fails
  with its rule stated, and restore. Repeat for a `document.cookie` write
  outside the adapter, and for an `atob(` call. A guard nobody has seen fail is
  an assertion, not a guard.
- **Mutation-test the two panel-driven fixes**: restore revision 1's blanket
  `persist` rule and show it goes red against `stores/device.ts` — the defect
  the senior lens caught; and remove the same-origin check on the bearer header
  and show the interceptor test goes red.
- **Live check against the running gowa server** where one is reachable:
  `GET /auth/me` with and without the bearer header, to confirm the envelope
  shape this plan codes against.

## Rollback

`git revert` of the single publishable commit. Three of the source files are new
and imported from exactly one place each; the edits are a five-line interceptor
change, a one-line effect addition, and a one-line cURL placeholder. Reverting
leaves cookies sitting in browsers that already have them — harmless, because
nothing would read them any more, and each expires on its own within 15 minutes
or 30 days.

## Out of scope

Exactly as `spec.md > Out of scope`: no login screen, logout, or route guard
(`z8pmx9md6z`); no silent refresh, 401 recovery, or rotation (`z8pmx9md70`); no
permission-driven UI (`z8pmx9md71`); no `?access_token=` on the WebSocket, which
cannot be exercised before a session can be created; no backend change and no
BFF (C-1); no edit to `PROJECT-GUIDE-ar.html`, `worker/index.js`, or
`wrangler.jsonc`.

## Panel response

Three read-only lenses reviewed revision 1 before any code was written:
`senior-reviewer`, `security-reviewer`, `performance-reviewer` (ADR-010). They
returned **24 findings — 2 major from senior, 2 major from security, 13 minor,
7 info**. Disposition: **19 adopted, 3 declined with reasons, 2 noted without a
change**.

### The findings that changed the design (6)

1. **`major` (senior) — two of the six source rules were red before a line was
   written.** Revision 1 banned `persist(` / `createJSONStorage` and any mention
   of web storage outside `stores/connection.ts`. `src/stores/device.ts` uses
   **both** (`persist` + `createJSONStorage(() => localStorage)` under
   `gowa-ui.device.v1`) and `src/stores/recipient.ts` uses `persist` — verified
   against the source. The guard would have failed on its first run and forced
   an unplanned edit to two files that are not in this ticket's scope and hold
   no credential. **Adopted, and it reshaped the guard entirely:** the rules are
   now written against *credentials* (a file may not mention web storage **and**
   a credential identifier) plus a closed three-file allowlist, which is both
   green today and strictly stronger — it catches a token in `localStorage` no
   matter which module writes it, which a blanket `persist` ban never did.
2. **`major` (senior) + `minor` (security) + `minor` (performance) — the same
   defect found from three directions: the landing screen was
   nondeterministic.** Revision 1 called the `/auth/me` 401 → `markUnauthorized`
   → `/connect` interaction "existing behaviour this ticket accepts". Three
   lenses disagreed, and they are right: whether the user lands on the dashboard
   or on "The server rejected this session" depended on which of two unordered
   promises resolved first. **Adopted, with the semantic fix rather than the
   suggested opt-out flag:** the response interceptor now excludes the `/auth/`
   prefix, because a 401 from a *public* auth endpoint (§03) means "no session",
   never "this origin is refused" — which is exactly what `markUnauthorized`
   encodes. Same reasoning as the existing `probeHealth` exemption; no new
   config surface.
3. **`minor` (senior + security, independently) — `boot()` called `/auth/me`
   without checking expiry.** REQ-7 says *unexpired*; revision 1 leaned entirely
   on cookie `Max-Age` and would have spent a guaranteed 401 on any retained or
   clock-skewed cookie — a 401 that then discards the access token. **Adopted:**
   the third cookie already existed to make that check possible, and now it is
   made.
4. **`minor` (senior) — `fetchMe()` could return `undefined` and call it
   authenticated.** `ResponseData.results` is optional
   (`src/api/types.ts:4`), and `results()` casts. A 200 with an empty envelope
   would have produced `status: 'authenticated', user: undefined` — the precise
   negation of AC-14. **Adopted:** an `isAuthUser()` runtime guard, and a
   shapeless response is a failed rehydration.
5. **`minor` (security) — the bearer header had no same-origin guard.** axios
   ignores `baseURL` for an absolute URL, and this backend is documented to
   return absolute `qr_link` / `file_path` values built from its own `Host`
   header. **Adopted:** the header is attached only to a relative URL, and a
   source rule plus a unit test pin it.
6. **`minor` (senior) — `toCurl`'s contract would have become a lie.** Its own
   comment claims the rendered command is the request the UI sends; after step 6
   that is false for every guarded endpoint, and `curl.ts` was not in the file
   list. **Adopted, taking the placeholder option:** the command renders a
   valueless `-H 'Authorization: Bearer <token>'`, mirroring the `@filename`
   placeholder the same file already uses for a file it cannot read. AC-18 is
   untouched — no value is read from anywhere — and the operator now sees why a
   copied command needs a credential.

### Adopted without a design change (13)

7. **`minor` (senior) — the `bootStarted` latch was extra state.** It made AC-4's
   field list literally false and published a store update. Adopted: the latch is
   now derived from `status` + `access_token`, so there is no sixth field and no
   test-only reset hatch.
8. **`minor` (performance) — pin the synchronous half of `boot()`.** Adopted as
   an explicit plan commitment *and* an assertion: `auth.test.ts` reads the
   store between calling `boot()` and awaiting it.
9. **`minor` (performance) — the disk-walking guard would go quiet in watch
   mode.** Adopted with a better fix than the one suggested: `import.meta.glob`
   with `?raw` puts the guarded files in vitest's module graph, so the guard
   re-runs on exactly the edit it exists to catch.
10. **`info` (performance) — six walks over the same tree.** Adopted: one glob,
    six assertions.
11. **`minor` (security) — AC-18 rested on a grep.** Adopted: an executed
    assertion in `api-error.test.ts` that a rejected request's serialised error
    carries no token.
12. **`minor` (security) + `minor` (performance) — the token is on the wire
    twice, and the bundle request now carries cookies.** Adopted as *measured
    cost*, recorded in ADR-012 with the byte figure and the edge-cache caveat,
    rather than left as "a consequence".
13. **`minor` (security) — `Secure` cannot protect the edge→backend hop.**
    Adopted: ADR-012 states the HTTPS requirement on `GOWA_ORIGIN`.
14. **`info` ×2 (security) — no runtime dependency, no deployment runtime file,
    and `/auth/me`-as-authority avoids a stale-permission second source.**
    Confirmed; no change.
15. **`info` ×3 (performance) — anonymous first load costs nothing, no component
    subscribes to the new store, the new tests never enter the build graph.**
    Confirmed; NFR-6 holds.
16. **`info` (senior) — the import-cycle argument checks out in both evaluation
    orders, and `ui-build` is the right profile for it.** Confirmed.
17. **`info` (senior) — the workspace was missing `ticket.md`.** Adopted:
    `ticket.md` is written before implementation, and is the canonical state
    record (TS-1/TS-2).
18. **`info` (performance) — one extra WebSocket handshake open/close on the 401
    path.** Noted; `desired` / `abandonedUrl` already prevent a loop, and the
    `/auth/` exemption above removes most of the path anyway.
19. **`minor` (security) — an epoch-bump forced logout is indistinguishable from
    an ordinary expiry.** Accepted as scope: the reference (§03) says the correct
    handling is *try refresh once, then full logout with a message*, and the
    refresh layer is `z8pmx9md70`. Recorded there rather than half-built here.

### Declined, with reasons (3)

20. **`major` (security) — "scope the refresh cookie to `Path=/api/auth`".**
    Declined on a technical ground the finding did not have: these cookies are
    **read by JavaScript**, and `document.cookie` only exposes cookies whose
    `Path` is a prefix of the *document's* path. The SPA is served at the origin
    root, so a refresh cookie at `/api/auth` would be invisible to the store that
    owns it (REQ-1, AC-2) and to `z8pmx9md70`, which must put the token in a
    request **body** — the server never reads it from a `Cookie` header at all.
    Path scoping protects cookies a *server* consumes; it cannot help here. The
    residual risk the finding correctly identifies is recorded in ADR-012.
21. **`major` (security) — "make the refresh cookie a session cookie or a much
    shorter window".** Declined: AC-8 states the refresh cookie's lifetime is the
    refresh token's own 30 days, and a session cookie would discard the property
    the backend deliberately issues a 30-day token for. The risk — one XSS
    becomes a month-long takeover — is real, is the exact reason the ticket
    demands an ADR, and is recorded in ADR-012 rather than silently traded away.
    Narrowing it is a spec change and therefore the owner's, not this plan's.
22. **`minor` (security) — "let `boot()`'s `/auth/me` skip `markUnauthorized`
    via an interceptor opt-out".** The *problem* is adopted (finding 2); the
    *mechanism* is declined. A per-request opt-out flag means an axios config
    augmentation and a second way to reason about 401s. Excluding the `/auth/`
    prefix is one predicate, needs no new surface, and is correct for the login
    and refresh calls the next two tickets add — which would each have needed the
    flag set by hand.
