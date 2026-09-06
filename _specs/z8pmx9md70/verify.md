---
ticket: z8pmx9md70
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-09-06
links:
  clickup: "https://app.clickup.com/t/z8pmx9md70"
  github: ""
---

# Verification — 4 · Add silent refresh, 401 recovery and token rotation

**Outcome: PASSED, with two open items stated in full below.** All 30 acceptance
criteria are mapped to a result. Twenty-six rest on an executed assertion, two on
an assertion plus a read-through, and two on a read-through alone — labelled per
criterion rather than averaged, because C-1 (no component renderer) is still in
force and pretending otherwise would be the easiest place to lose the truth.

Nothing was verified against a running gowa server; see *Open items*.

## Runtime impact statement (TR-3)

**No deployment runtime file changed.** `.github/workflows/ci.yml`,
`.github/workflows/release.yml`, `vite.config.ts`, `package.json` and
`index.html` are untouched, and `git status` confirms it. No dependency was
added or removed; `package-lock.json` is unchanged.

There is a **runtime behaviour change for users**, and it is the point of the
ticket: a session no longer ends after fifteen minutes. Two consequences are
worth stating rather than burying:

- The dashboard now issues `POST /auth/refresh` roughly every fourteen minutes
  per open tab, and reopens the WebSocket each time (§10 freezes the principal
  at the handshake, so it must). An idle signed-in tab therefore pays one
  handshake and one `devices` refetch per rotation. This was raised at review
  and accepted explicitly.
- A **429 on `/auth/refresh` reached through a 401 now signs the user out.** The
  rate-limit bucket is keyed on the TCP peer, so behind a busy reverse proxy
  that can be somebody else's traffic. The reference is unambiguous — one
  refresh attempt on a 401, then a logout — and the alternative is a session
  that cannot renew itself, which is the half-working state this ticket removes.
  A *proactive* 429 ends nothing, because the access token is still alive there.

## Baseline (measured on this branch before the first edit)

- 15 test files, **168 tests**, all passing.
- `npm run typecheck` exit 0; `npm run lint` exit 0 with 4 pre-existing
  `react(only-export-components)` warnings.

## Validation profile — `ui-build`

| Check | Command | Exit | Result |
|---|---|---|---|
| `ui-typecheck` | `npm run typecheck` | 0 | PASS |
| `ui-lint` | `npm run lint` | 0 | PASS — 4 warnings, the same 4 as the baseline |
| `ui-test` | `npm run test` | 0 | PASS — **215 tests / 16 files** |
| `ui-build` | `npm run build` | 0 | PASS — `dist/index.html` 1,024.23 kB, gzip 418.03 kB |

47 tests added. The lint count is unchanged rather than incidentally so:
`AUTH_PREFIX` became unreachable when the 401 branch switched to
`isPublicAuthPath`, and was deleted in the same edit so it could not add an
unused-variable warning to the baseline.

## Acceptance criteria

Legend: **executed** — an assertion in the suite fails if it regresses;
**read-through** — verified by reading the code, because C-1 leaves no way to
render it.

### Bearer header on every request

| AC | Result | Evidence |
|---|---|---|
| AC-1 | PASS — executed | `http.test.ts` *"comes from the auth store, and from nowhere else"*; the interceptor is unchanged by this ticket. |
| AC-2 | PASS — executed | `grep -rn basicAuthHeader src/` returns nothing; `source-policy.test.ts` *"a bearer token is attached in one interceptor"* limits `Bearer` to `http.ts` and `curl.ts`. |
| AC-3 | PASS — executed | `http.test.ts` *"sends no Authorization header to any of them"*, and *"attempts no refresh for a public auth route"* re-proves it for the new path. `/health` never goes through this client at all — `probeHealth` uses a bare axios instance (read-through for that one route). |
| AC-4 | PASS — executed | `http.test.ts` *"sends no device id either"* and *"still sends the bearer to /auth/me"*; the request interceptor's device branch is untouched. |

### Scheduled silent refresh

| AC | Result | Evidence |
|---|---|---|
| AC-5 | PASS — executed | `session-refresh.test.ts` *"fires a minute before the access token expires, not when it expires"* — asserted on both sides of the boundary — and *"states the margin as sixty seconds"*. Mutation **M10** (margin → 0) killed. |
| AC-6 | PASS — executed | *"re-arms from the NEW expiry after a rotation, with nobody re-arming it"*. |
| AC-7 | PASS — executed | *"cancels the renewal when the session ends, with nobody cancelling it"* and *"leaves no timer behind when it is stopped"*. |
| AC-8 | PASS — executed | *"arms nothing while no session exists"* and *"arms nothing for an authenticated session with no known expiry"*. |

### Reactive refresh on 401

| AC | Result | Evidence |
|---|---|---|
| AC-9 | PASS — executed | `http.test.ts` *"ends the session rather than looping when the replay is refused too"* — exactly 2 attempts and 1 refresh against an endpoint that answers 401 forever. Mutation **M1** killed. |
| AC-10 | PASS — executed | *"replays the request with the NEW token, not the one that was refused"* — the assertion is on the header value, not on the attempt count. Mutation **M4** killed. |
| AC-11 | PASS — executed | *"serves five concurrent 401s from one refresh"* (1 refresh, 11 requests) and the store-level *"serves every concurrent caller from one request"*. |
| AC-12 | PASS — executed | *"attempts no refresh for a 401 on a public auth route"* — two requests sent, two expected. Mutation **M3** killed 11 tests. |
| AC-13 | PASS — executed | Same case as AC-9: the client cannot distinguish a route-line 401 from an auth-layer one, and takes the identical path. `403` is out of scope by specification. |

### Token rotation

| AC | Result | Evidence |
|---|---|---|
| AC-14 | PASS — executed | `auth.test.ts` *"replaces both halves of the pair, in the store and in the cookies"* — asserts both cookies, both fields and the derived expiry. |
| AC-15 | PASS — executed | *"spends the new refresh token on the next rotation, never the old one"* asserts the exact call sequence `[[old], [rotated]]`; `http.test.ts` *"rotates both halves of the pair together"* asserts the request body. |
| AC-16 | PASS — executed | *"clears the whole session when the server refuses the refresh token"* — both cookies gone, one call made. |
| AC-17 | PASS — executed | *"tears nothing down for a failure that judged no token"* (store) and *"does not retry a refresh the rate limiter refused, nor blame permissions"* (transport). |

### Failure → full logout

| AC | Result | Evidence |
|---|---|---|
| AC-18 | PASS — executed + read-through | The cookie and store half is executed (AC-16 above). The query-cache half is `App.tsx`'s edge-triggered effect, unchanged by this ticket and unreachable without a renderer (C-1). |
| AC-19 | PASS — executed + read-through | The socket half is executed: `ws.test.ts` *"closes an open socket when the session ends"*. The routing half is `RequireSession` re-rendering on `status`, read-through by C-1. |
| AC-20 | PASS — executed | `auth.test.ts` *"calls a live token refused alongside its refresh token a permissions change"* and its expired counterpart; `http.test.ts` proves the 429 path says `expired` instead. Mutation **M5** killed. |
| AC-21 | PASS — read-through | No state exists in which a dead session renders old data: the teardown is a single store action, the guard unmounts the tree on `status`, and `source-policy.test.ts` fails the build if a second teardown is ever written. Not renderable under C-1. |

### WebSocket lifecycle

| AC | Result | Evidence |
|---|---|---|
| AC-22 | PASS — executed | `ws.test.ts` *"opens a same-origin socket under the API prefix, carrying the access token"* — the full URL is asserted verbatim. |
| AC-23 | PASS — executed | *"reopens with the new token after a rotation"* — two sockets, and the second carries the new token and not the old one. |
| AC-24 | PASS — executed | *"closes an open socket when the session ends"*, *"opens nothing while the session is anonymous"*. Mutation **M7** killed. |
| AC-25 | PASS — executed | *"carries no legacy basic credential in the query string"* — asserts the exact parameter set is `access_token` + `device_id`, so a third parameter fails rather than slipping through a negative match. |
| AC-26 | PASS — executed | *"does not refill the refused-handshake budget on every rotation"*, alongside the pre-existing ceiling and abandonment cases which still pass. Mutation **M6** killed 12 tests. |

### Recovery on reload

| AC | Result | Evidence |
|---|---|---|
| AC-27 | PASS — executed | `auth.test.ts` *"spends the refresh token when the access cookie has expired, then fetches the principal"* and *"recovers with no access cookie at all"*. |
| AC-28 | PASS — executed | *"lands anonymous with both cookies gone when the refresh token is rejected"*, plus the deferred-failure counterpart which keeps the token. |

### Audit and logging

| AC | Result | Evidence |
|---|---|---|
| AC-29 | PASS — executed | `source-policy.test.ts` *"nothing in src/ writes to the console at all"* — a flat ban with an empty exemption list, over every non-test file in `src/`. |
| AC-30 | PASS — executed | `auth.test.ts` *"records a success as a verdict and a status"* (serialises `diagnostics()` and asserts neither token appears) and *"keeps a catalogue code and drops anything else the server wrote"*. Mutation **M15** killed. |

## Mutation log (author discipline, not gate evidence)

Recorded here as `plan.md > Validation strategy` says it should be: these are not
reproducible from the profile and are not offered as gate evidence (VP-3). Each
guard was removed, the suite run, and the guard restored.

| # | Guard removed | Result |
|---|---|---|
| M1 | the one-attempt teardown in the 401 branch | **killed** — 1 failure |
| M2 | the live-session gate | **survived**, then killed — see below |
| M3 | the public-auth exclusion | **killed** — 11 failures |
| M4 | the replay's header assignment | **killed** — 1 failure |
| M5 | the explicit `'expired'` reason on `deferred` | **killed** — 1 failure |
| M6 | the token-stripped budget key in `ws.ts` | **killed** — 12 failures |
| M7 | the tokenless-session gate in `ws.ts` | **killed** — 1 failure |
| M8 | `armedFor`'s early return | **survived**, then killed — see below |
| M9 | the `attemptedFor` guard | **killed** — 1 failure |
| M10 | the 60-second margin | **killed** — 2 failures |
| M11 | the identity check on the success branch | **killed** — 1 failure |
| M12 | the identity check on the failure branch | **killed** — 1 failure |
| M13 | the single-flight `finally` | **killed** — 16 failures |
| M14 | the no-token short circuit | **killed** — 1 failure |
| M15 | the catalogue filter on the audit record | **killed** — 1 failure |
| M16 | the `boot()` latch ordering (await moved above the write) | **killed** — 1 failure |

**Two survived, and both were real gaps in the tests rather than dead code.**
This is the part of the exercise that earned its cost:

- **M2 — the live-session gate.** Removing it broke nothing, because the case
  meant to cover it set `refresh_token: null` and so short-circuited before the
  gate could matter. The gate's real work is on the *involuntary* teardown,
  where `endSession` keeps the refresh token deliberately: a 401 still in flight
  would otherwise spend it, and a pair carrying `user` would flip the status
  back to `authenticated` — a session the store had just declared over,
  resurrected by a straggler. A case for that was written; M2 now fails against
  it.
- **M8 — `armedFor`.** Removing it broke nothing either, and the reason
  contradicted the test's own comment: the delay is computed from an *absolute*
  deadline, so re-arming on every store write still fires at exactly the right
  moment. `armedFor` protects against a `clearTimeout`/`setTimeout` pair on
  every `set()` in the application, not against a drifting deadline. The test
  now counts timer churn rather than timing, and the comment states the property
  it actually holds.

## Open items

Recorded rather than glossed:

1. **Nothing was verified against a running gowa server.** No backend was
   reachable from this environment, so `POST /auth/refresh`, rotation, reuse
   detection, the 429 bucket and the `?access_token=` handshake were exercised
   only against fakes built from the reference. Everything asserted is asserted
   against the documented contract (§02, §03, §10), which is the same source the
   implementation was written from — so a contract error would pass both. The
   three highest-value live checks, for whoever has a server: a rotation that
   really happens fourteen minutes in, a `/ws` handshake the server accepts with
   the query token, and a deliberately reused refresh token producing the
   401/`AUTH_INVALID_REFRESH_TOKEN` the `ended` path is written for.
2. **No browser pass.** C-1 rules out rendering, so AC-21 and the routing half
   of AC-19 rest on reading the code. They are unchanged behaviour from
   `z8pmx9md6z` rather than new claims, which is why they are recorded as
   read-through and not as risk.
