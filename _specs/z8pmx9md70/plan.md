---
ticket: z8pmx9md70
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-09-06
links:
  clickup: "https://app.clickup.com/t/z8pmx9md70"
  github: ""
---

# Plan — 4 · Add silent refresh, 401 recovery and token rotation

> **Revision 2.** Revision 1 was reviewed by the advisory panel (senior /
> security / performance) **before any code was written**. They returned **35
> findings — 9 major**. Eight changed the design, and one changed the
> specification: revision 1 proposed reading the refresh token from the cookie
> at the moment of use, which narrows a reuse-detection window by opening a
> *principal-substitution* one. Full disposition in *Panel response* at the end
> of this file.

## Approach

The session already has one owner and one reconciliation idiom, and this ticket
adds nothing new to either. `src/stores/auth.ts` owns the pair; `wsClient.sync()`
derives the socket from store state rather than being commanded. Renewal is
written the same way.

Three pieces, and the boundaries between them are the whole design:

| Piece | Where | What it knows |
|---|---|---|
| `refreshSession()` — the rotation itself, single-flight | `src/stores/auth.ts` | the tokens |
| the proactive schedule | `src/lib/session-refresh.ts` | only *when* the access token dies |
| the reactive path | `src/lib/http.ts` | only that a request got a 401 |

Only the first names a token. The scheduler reads `access_token_expires_at`; the
interceptor calls an action and replays a request. That keeps NFR-1 true by
construction and keeps the executable source policy
(`src/lib/source-policy.test.ts`) able to enforce it.

### What is already true, and what this ticket actually adds

The panel's last finding is the one worth reading first: a third of the
acceptance criteria describe code that already exists, and a plan that reads as
if all thirty were new work invites re-deriving evidence at `/verify`.

| Already satisfied before this ticket | By |
|---|---|
| AC-1, AC-3, AC-4 | the request interceptor (`z8pmx9md6y`, extended by `z8pmx9md6z`) |
| AC-2 | `basicAuthHeader` was deleted in `z8pmx9md6x`; nothing constructs a Basic credential |
| AC-14 (the *atomicity*) | `storeTokenPair` already writes both cookies and all four fields in one `set` |
| AC-18, AC-19, AC-21 (the *teardown*) | the store's `clearSession`, `App.tsx`'s edge-triggered cache effect, the route guard |
| AC-25 | no credential has been in the socket URL since `z8pmx9md6x` |

They are still verified — they are properties this ticket must not break — but
no step below is spent building them.

### One refresh, however many callers ask for it

`refreshSession()` is a **single-flight** action: a module-level promise created
on the first call and returned to every caller until it settles.

```
refreshSession(): Promise<RefreshOutcome>
  if (inFlight) return inFlight
  ...
  inFlight = (async () => { one POST /auth/refresh })()
    .finally(() => { inFlight = null })       // <- the panel's first major
  return inFlight
```

**The `finally` is the whole mechanism.** Revision 1's pseudocode omitted it,
and two lenses independently worked out what that costs: the promise is created
once, settles, and is then handed to every later caller forever — so a page
would refresh exactly once, the second rotation fourteen minutes later would
return a stale settled outcome, and the reactive path would replay requests with
a dead token indefinitely. `clearSession` nulls it too, so a suite that leaves a
pending flight behind cannot poison the next test.

That one mechanism then satisfies three criteria at once: five concurrent 401s
share it (AC-11), a proactive renewal racing a reactive one shares it (REQ-5),
and two components mounting together share it. There is no second dedupe.

### Three outcomes, because "failed" is not one thing

`RefreshOutcome = 'refreshed' | 'ended' | 'deferred'`:

- **`refreshed`** — a new pair is in the store and in the cookies.
- **`ended`** — the server judged the refresh token and refused it: HTTP 401 or
  the code `AUTH_INVALID_REFRESH_TOKEN`. Reuse detection has revoked the family,
  so there is nothing to retry and nothing to keep: `clearSession(reason)`, both
  cookies gone (AC-16). Also returned, **without touching anything**, when there
  was no refresh token to spend, or when the session moved on mid-flight (below).
- **`deferred`** — the request failed for a reason that says nothing about the
  token: 429 (C-4 makes this real), a 5xx, a transport failure. Nothing is torn
  down *by the store* and no retry is scheduled (AC-17, REQ-9).

### The store refuses to resurrect a session it no longer owns

The security lens found a hole revision 1 had no answer for. Between the `await`
and the write there is nothing that checks the session still exists, so a
`signOut()` landing mid-flight is *undone*: `storeTokenPair` rewrites both
cookies, puts a refresh token back, resets `endReason` to null, and — if the
pair carries `user` — flips the status back to `authenticated`. A user who
pressed Log out ends up signed in.

The fix is one identity check, and it needs no counter: **the token I spent must
still be the token the store holds.**

```
const spent = get().refresh_token
...await refresh(spent)...
if (get().refresh_token !== spent) return 'ended'   // discard the pair, write nothing
```

A teardown nulls it; a sign-in replaces it; either way the pair is dropped
unwritten. The same check guards the failure branch, so a `clearSession` cannot
be issued against a session that is no longer the one that failed.

### The reason a session ended is computed, not assumed

`refusalReason(access_token_expires_at)` (`z8pmx9md6y`) already encodes the
inference: an access token refused *inside* its own lifetime points at a
`token_epoch` bump, one refused after it at ordinary expiry. The `ended` branch
reads it **before** `clearSession` wipes the expiry. That is AC-20.

It is used **only** where the server actually judged a token. The security lens
caught revision 1 applying it to the `deferred` path too, where it would tell a
user "An administrator changed your account" because a proxy returned 429 — and
would make a real forced logout indistinguishable from a rate-limit blip. The
reactive path's `deferred` teardown therefore passes an explicit, neutral
`'expired'`, so `endRefusedSession` gains one optional argument:

```
endRefusedSession: (reason?: SessionEndReason)   // absent = infer, present = state
```

### Proactive: a timer reconciled from state, not re-armed by hand

`src/lib/session-refresh.ts` exports a singleton with `sync()` and `stop()`, the
same shape as `wsClient`. `App.tsx` subscribes it to the auth store next to the
socket. `sync()`:

1. If `status !== 'authenticated'` or there is no expiry → clear the timer and
   return. That is AC-7 and AC-8, and it costs one branch, because ending a
   session is a store write and every store write calls `sync()`.
2. If a timer is **already armed for this same expiry** → return. The
   performance lens is right that `wsClient.stop()` and `sync()` both carry that
   early return for exactly this reason: the subscription is selector-free and
   fires on every auth-store write, `consumeEndReason` and boot's hydration
   write included. `armedFor` is that guard.
3. Otherwise arm at `max(expiresAt - now - MARGIN, 0)`, with
   `MARGIN_MS = 60_000` — **the 60 seconds AC-5 asks be stated explicitly**. For
   the documented `expires_in: 900` that is 840 seconds.

**AC-6 is free.** A successful refresh calls `storeTokenPair`, which writes a new
`access_token_expires_at`; that write notifies the subscription; `sync()` re-arms
from the new number. There is no "re-arm after success" line to forget.

**The loop that has to be prevented.** If the timer fires and the refresh comes
back `deferred`, nothing in the store changes, so nothing re-arms — which is
"no immediate automatic retry" (AC-17) for free. But a *later* unrelated store
write would find the same expiry now in the past, compute `delay = 0` and fire
again. So the singleton also remembers `attemptedFor` — the expiry it has
already spent an attempt on — and refuses to attempt for that value twice.
`armedFor` guards re-arming; `attemptedFor` guards re-attempting; they are two
different failure modes and both are one field each.

### Reactive: one attempt per request, one teardown when it fails

The 401 branch of the response interceptor becomes:

1. **Ignore it unless the session is live.** `status !== 'authenticated'` → do
   nothing. Both the senior and the performance lens landed on this from
   different directions, and it is doing three jobs at once:
   - it is the no-op that already absorbs the burst of refetch 401s a cache
     teardown produces (today's `endRefusedSession` provides it; revision 1 lost
     it). Without it, `signOut()`'s in-flight 401s each call `refreshSession()`,
     find no token, and `clearSession(refusalReason(null))` **overwrites
     `endReason: 'signed-out'` with `'expired'`** — the login screen would say
     "Your session expired" after a deliberate sign-out;
   - it stops a second wave. `main.tsx` sets `retry: 1`, so every TanStack query
     issues a second axios call with a fresh config and a fresh one-attempt
     flag; once the first failure has made the session anonymous, that second
     wave refreshes nothing. This is why no cooldown timer is needed;
   - it keeps `boot()` out of the reactive path entirely (status is `unknown`
     there), so a bad boot costs one refresh and not two.
2. **Ignore it for a public auth route** — `isPublicAuthPath`, already in this
   file (AC-12). This *narrows* today's exclusion, which is every `/auth/*`: a
   401 from `GET /auth/me` is a refused session and must be recoverable.
   `AUTH_PREFIX` becomes dead and is deleted in the same edit.
3. **If this request has already spent its attempt** — the `sessionRetry` flag,
   declared on the axios config by module augmentation — then
   `endRefusedSession()` and reject. Revision 1 only rejected, and three lenses
   said the same thing: a route that still 401s after a *successful* refresh
   would leave the session `authenticated` holding a credential the server
   refuses, the guard would never redirect, and the dashboard would sit there
   401ing. The inferred reason is right here: a freshly minted token being
   refused is what a `token_epoch` bump looks like.
4. **Otherwise** set the flag and `await refreshSession()`:
   - `refreshed` → `config.headers.Authorization = 'Bearer ' + <new token>`,
     then `http.request(config)`. **Assignment, not `delete`** — the senior lens
     caught that `delete` would also discard a header a caller set deliberately
     (there is a test for that), and that an `AxiosHeaders` delete is
     case-sensitive besides. One line either way, and this one is correct.
   - `ended` → the store has already torn down; reject.
   - `deferred` → `endRefusedSession('expired')`, then reject.

That last case is a deliberate, stated decision rather than a side effect, and
two lenses asked for it to be named: **a 429 reached through a 401 ends the
session.** The reference is unambiguous that a 401 gets one refresh attempt and
then a logout, and a UI that keeps a session it cannot renew is precisely the
half-working state this ticket exists to remove. A *proactive* 429 does not end
anything — the access token is still alive there.

Everything downstream is already built: the route guard re-renders because
`status` changed (AC-19), `App.tsx` cancels and clears the query cache (AC-18,
AC-21), `wsClient.sync()` closes the socket (AC-24). No new teardown is written,
and `src/lib/source-policy.test.ts` already fails the build if one is.

### The WebSocket becomes a function of the token — but the budget is not

`wsClient.sync()` gains the access token as an input, so AC-23 needs no code: a
rotation writes a new token, the subscription fires `sync()`, the computed URL
differs from `this.url`, and the existing `reopen()` swaps the socket. That is
the same reconciliation that already handles a device switch.

But revision 1 claimed this was "not a bypass of the ceiling" and offered no
mechanism, and two lenses took it apart. `abandonedUrl` is keyed on the exact
URL, so once the token is *in* that URL every rotation produces a URL that was
never abandoned — and a deployment where `/ws` is refused for a non-token reason
(a proxy that does not map it, the case `ws.ts` names in its own comment) would
burn a fresh six-socket budget **every fourteen minutes for the life of the
tab**. `ws.test.ts` already encodes the invariant this breaks: *"gives each
session one attempt budget, not one per store write."*

So the abandonment is keyed on the handshake **without** the token:

```
const key = toWebSocketUrl({ device_id })                    // budget identity
const url = toWebSocketUrl({ access_token, device_id })      // what is opened
```

A rotation changes `url` and reopens; it does not change `key` and so cannot
refill the budget. A device switch and a session ending still do, exactly as
before. The cost is stated rather than hidden: a socket abandoned while its
token was dying does not get a second chance from the rotation alone — but six
consecutive refusals inside ~63 seconds, against a token with fourteen minutes
left, is not a token problem.

`this.url` and `abandonedKey` hold URLs in memory; the former now contains a
token and is cleared by `stop()` and by the non-authenticated branch of
`sync()`, which is where it was already cleared. Nothing logs or persists it.

### Recovery on reload

`boot()` currently drops an expired access cookie and stops, with a comment
naming this ticket. It gains the missing half — and the senior lens caught the
trap in adding it: `boot()`'s StrictMode latch is *the session state itself*
(`status !== 'unknown' || access_token !== null`), and revision 1 would have put
an `await refreshSession()` **before** the write that closes it, so React's
second invocation would re-enter and issue a second `GET /auth/me`. The
invariant is in `boot()`'s own doc-comment.

So the order is fixed and explicit: hydrate the refresh token and set
`status: 'anonymous'` **synchronously**, closing the latch, and only then await.

```
if (!accessToken || expired) {
  if (expired) clearAccess()
  set({ access_token: null, refresh_token, access_token_expires_at: null,
        user: null, status: 'anonymous' })          // latch closed, no await yet
  if (!refreshToken) return
  if (await get().refreshSession() !== 'refreshed') return   // AC-28
}
...fetchMe() as today...                                     // AC-27
```

An access token that is *alive* but refused keeps `z8pmx9md6y`'s handling
(`endSession(refusalReason(...))`, refresh token kept). That is a deliberate
non-change: a `token_epoch` bump invalidates the refresh token too, so a refresh
there buys a round-trip and a second `/auth/me` to reach the same answer, and
the next reload takes the expired path and self-heals.

### Where the refresh outcome is recorded

AC-30 asks that attempts be recorded; revision 1 named "the outcome record" once
and never gave it a home, which three lenses noticed. There is no logger in
`src/` and — checked — **zero `console.*` calls in the shipped source**. So:

- the record is a store field, surfaced through `diagnostics()`, which is
  already the audited "what may be shown to a human" boundary (AC-30);
- and `src/lib/source-policy.test.ts` gains a **flat ban on `console.` anywhere
  in `src/`** (AC-29). Both the security and the senior lens preferred it to
  revision 1's "a token near a console call" regex, which cannot see
  `console.log(pair)` or `console.log(useAuth.getState())`. The stricter rule is
  the simpler one, and its exemption list is empty.

The record is `{ outcome, status, code, at }` and nothing else. `code` is
server-controlled text, so it is carried **only when it is one of the
reference's own §02 catalogue codes** and dropped otherwise — `toApiError` falls
back to `error.message`, and on this path that could be any intermediary's prose.

## Steps

1. **`src/api/auth.ts`** — add `refresh(refresh_token)`: `POST /auth/refresh`,
   result validated by the existing `isAuthTokenPair`, mirroring `login()`
   including its `MALFORMED_TOKEN_PAIR` rejection.
2. **`src/stores/auth.ts`** — `RefreshOutcome`, `RefreshRecord`, the
   single-flight promise with its `finally`, `refreshSession()` (identity check,
   three outcomes, reason computed before teardown, catalogue-filtered record),
   `endRefusedSession(reason?)`, `clearSession` nulling the flight, the record in
   `diagnostics()`, and `boot()`'s recovery path with the latch closed first.
3. **`src/lib/session-refresh.ts`** (new) — the `sessionRefresh` singleton:
   `MARGIN_MS = 60_000`, `sync()`, `stop()`, `armedFor`, `attemptedFor`.
4. **`src/lib/http.ts`** — the 401 branch: live-session gate, public-auth
   exclusion, one-attempt flag with its teardown, `await refreshSession()`,
   header **assignment**, replay. Add the `sessionRetry` module augmentation and
   delete the now-dead `AUTH_PREFIX`.
5. **`src/lib/ws.ts`** — access token in the handshake URL, budget keyed on the
   token-stripped URL (`abandonedUrl` → `abandonedKey`), gate on the token.
6. **`src/App.tsx`** — subscribe `sessionRefresh.sync()` where `wsClient.sync()`
   already is, and `stop()` it in the same cleanup.
7. **`src/lib/source-policy.test.ts`** — narrow the access-token rule from
   `/access_token/` to `/\baccess_token\b/` so it stops matching
   `access_token_expires_at` (the scheduler reads the expiry and must not need
   an exemption for it), add `src/lib/ws.ts` to that rule's allowlist because
   the handshake is where the token is *attached* (C-3), and add the flat
   `console.` ban.
8. **Tests** — `src/lib/session-refresh.test.ts` (new); extend and, where noted
   below, **rewrite** cases in `src/lib/http.test.ts`, `src/lib/ws.test.ts` and
   `src/stores/auth.test.ts`.

## Files to change

| File | Change |
|---|---|
| `src/api/auth.ts` | add `refresh()` |
| `src/stores/auth.ts` | `refreshSession()`, the record, `endRefusedSession(reason?)`, `boot()` recovery |
| `src/lib/session-refresh.ts` | **new** — the proactive scheduler singleton |
| `src/lib/session-refresh.test.ts` | **new** |
| `src/lib/http.ts` | the 401 branch: gate, refresh once, replay, teardown; `AUTH_PREFIX` deleted |
| `src/lib/http.test.ts` | new reactive-path cases **and three rewritten assertions** (below) |
| `src/lib/ws.ts` | token in the handshake URL; budget keyed without it |
| `src/lib/ws.test.ts` | `beforeEach` **rewritten** to seed a token; URL assertions updated |
| `src/lib/source-policy.test.ts` | narrowed token rule, ws exemption, flat console ban |
| `src/stores/auth.test.ts` | rotation, the three outcomes, the identity check, boot recovery |
| `src/App.tsx` | subscribe and stop the scheduler |
| `_specs/z8pmx9md70/*` | the workflow artifacts |

**Assertions that invert, listed rather than discovered.** The senior lens
pointed out that "extend" would hide deleted guarantees:

- `http.test.ts` *"leaves the refresh token alone, so z8pmx9md70 still has one to
  use"* — **no longer true and rewritten.** A 401 on a guarded route now spends
  a refresh, and the 401-for-everything adapter answers `/auth/refresh` 401 too,
  which is the `ended` path: both cookies go. The replacement asserts exactly
  that, and that it took one refresh to get there.
- `http.test.ts` the two `endReason` cases now run through a refresh round-trip;
  their expectations (`permissions-changed` / `expired`) survive, but what they
  are proving changes and the comments say so.
- `ws.test.ts` every case seeds `status: 'authenticated'` with **no** token
  (line 58), so the new gate would make all nine open zero sockets. The
  `beforeEach` seeds a token, the exact-URL assertion gains the parameter, and
  **one new case keeps the uncovered claim**: authenticated with no access token
  opens nothing.

**No deployment runtime file is touched.** `.github/workflows/ci.yml`,
`.github/workflows/release.yml`, `vite.config.ts`, `package.json` and
`index.html` are not on this list and must not appear in the diff (C-6, GU-2).

## Validation strategy

Profile **`ui-build`**: `ui-typecheck`, `ui-lint`, `ui-test`, `ui-build`. The
baseline on this branch is **168 tests in 15 files**, typecheck clean, lint clean
with 4 pre-existing warnings. Deleting `AUTH_PREFIX` in step 4 is part of
keeping lint at that number rather than adding an unused-variable warning to it.

Three properties are asserted deliberately rather than assumed, because each is
a place a passing test could still be measuring nothing:

- **The replay carries the *new* token.** Asserting that a second attempt
  happened proves nothing about which credential it carried.
- **No loop, and no zombie session.** An endpoint that answers 401 forever must
  produce exactly two attempts and one refresh, **and** end the session — the
  second half is the panel's finding, and TC-4 alone would not have caught it.
- **Exact request counts on the boot paths**, so the StrictMode latch and the
  live-session gate are measured rather than believed.

Mutation checks (remove a guard, watch a test fail, restore) are run on the new
guards — the one-attempt flag, the live-session gate, `armedFor`, `attemptedFor`,
the identity check, the budget key. Following the senior lens, they are recorded
as **author discipline in `verify.md`, not as gate evidence**: they are not
reproducible from the profile and VP-3 asks that gate steps be.

## Rollback

Every change is additive except three lines that change existing behaviour (the
401 branch in `http.ts`, the socket URL in `ws.ts`, the expired branch in
`boot()`), and the branch carries no commit until `/publish-pr`.
`git checkout -- src/` restores the working tree; on the published branch,
reverting the single commit removes the layer and leaves `z8pmx9md6z`'s
behaviour intact — a fifteen-minute session, which is a regression but a working
one. No migration and no persisted-shape change: the cookie names are
`z8pmx9md6y`'s and are untouched, so a browser holding a session before the
change still holds it after.

## Out of scope

As `spec.md > Out of scope`. In particular: no `BroadcastChannel` or cross-tab
lock, no `403`/permission work, no change to device selection, and no retry of
anything other than a 401.

## Panel response

Thirty-five findings across the three lenses; **31 adopted, 3 accepted as stated
costs, 1 declined**. Eight changed the design and one changed `spec.md`. The
findings are grouped by what they did to the plan rather than by lens, because
the three lenses converged on the same four defects from different directions.

### The four defects two or more lenses found independently

| # | Defect | Found by | Disposition |
|---|---|---|---|
| 1 | **The single-flight promise is never reset.** Revision 1's pseudocode had no `finally`, so the promise is created once, settles, and is returned to every later caller forever: one refresh per page load, then a stale outcome and replays with a dead token. | performance (`major`), security (`minor`), senior (`minor`) | **Adopted.** `.finally(() => { inFlight = null })`, `clearSession` nulls it, and a test asserts a *second* refresh fourteen minutes later issues a second POST. |
| 2 | **The replay path had no teardown.** "Ignore it if the attempt is spent" only rejected, leaving a session `authenticated` while holding a credential the server refuses — the guard never redirects and the dashboard keeps 401ing. | senior (`major`), security (`major`) | **Adopted.** `endRefusedSession()` before rejecting, and TC-18 asserts the session ended rather than only that no loop occurred. |
| 3 | **The 401 branch lost its live-session gate.** Revision 1 dropped the `status !== 'authenticated'` no-op, so `signOut()`'s in-flight 401s would each call `refreshSession()` and overwrite `endReason: 'signed-out'` with `'expired'` — "Your session expired" after a deliberate sign-out. | senior (`major`), performance (`minor`, via the `retry: 1` second wave) | **Adopted.** The gate is restored and is now load-bearing for three separate things (see *Reactive*, step 1). It also removes the need for the cooldown timer the performance lens proposed. |
| 4 | **The rotation refills the refused-handshake budget.** With the token in the URL, `abandonedUrl` can never match again, so a `/ws` that is refused for a non-token reason burns six sockets every fourteen minutes for the life of the tab — breaking an invariant `ws.test.ts` states by name. | performance (`major`), senior (`info`) | **Adopted.** The budget is keyed on the token-stripped handshake; the socket is keyed on the full one. |

### The findings that changed the design on their own

| # | Finding | Lens | Disposition |
|---|---|---|---|
| 5 | **An in-flight refresh resurrects a torn-down session:** nothing between the `await` and `storeTokenPair` checks the session still exists, so a mid-flight `signOut()` is undone — cookies rewritten, `endReason` reset, status back to `authenticated`. | security `major` | **Adopted**, as the identity check ("the token I spent must still be the token the store holds") rather than the suggested generation counter: same guarantee, no new field, and it reads as what it means. The residual — sign out *and in* within one round-trip — is in `spec.md > Known limits`. |
| 6 | **The cookie-first refresh-token read substitutes principals.** The cookie is origin-scoped, not tab-scoped: a second user signing in in another tab puts *their* token there, this tab spends it, and because `storeTokenPair` keeps `state.user` when the pair omits `user`, the UI keeps rendering user A while every request goes out as B. | security `major` | **Adopted by deletion.** The idea is removed entirely and `spec.md > C-5` now records *why* the narrower reuse-detection window was not worth an unbounded one. This is the finding that changed the specification. |
| 7 | **`deferred` used the inferred reason**, so a 429 or a 5xx while the access token was still live would say "An administrator changed your account" — and a real forced logout would stop being distinguishable from a rate-limit blip. | security `major` | **Adopted.** `endRefusedSession` takes an optional explicit reason; the reactive `deferred` path passes `'expired'`; inference is reserved for where the server actually judged a token. |
| 8 | **`boot()`'s StrictMode latch would break.** Revision 1 put `await refreshSession()` before the state write that closes the latch, so React's second invocation re-enters and issues a second `GET /auth/me` — the exact hazard `boot()`'s doc-comment invariant exists to prevent. | senior `major` | **Adopted.** The `status: 'anonymous'` + refresh-token write is explicitly synchronous and precedes every await; a double-boot test covers the recovery path, and the boot tests assert exact request counts. |

### Adopted without changing the shape of the design

| # | Finding | Lens | Disposition |
|---|---|---|---|
| 9 | `delete config.headers.Authorization` also discards a header a caller set deliberately (there is a test), and an `AxiosHeaders` delete is case-sensitive. | senior `minor` | **Adopted.** Assignment instead — same line count, correct. |
| 10 | AC-13's premise is wrong against the contract: §02 maps *authenticated but not permitted* to **403**, not 401, and no plan step mapped to AC-13. | senior `minor` | **Adopted.** AC-13 is restated as the 401-at-the-route-line case, `403` is named as `z8pmx9md71`'s, and TC-18 gives `/verify` something executable. |
| 11 | AC-30's "outcome record" was named once and never located; there is no logger in `src/`. | senior `minor`, security `minor` | **Adopted.** A store field surfaced through `diagnostics()`, shaped `{outcome, status, code, at}`, with `code` dropped unless it is a §02 catalogue code — because `toApiError` falls back to server/intermediary prose. |
| 12 | The proposed "token near a `console` call" regex cannot catch `console.log(pair)` or `console.log(useAuth.getState())`; `src/` has zero `console.*` calls, so a flat ban is airtight and free. | security `minor`, senior `info` | **Adopted.** Flat ban, empty exemption list. |
| 13 | The scheduler subscription is selector-free and fires on every auth-store write, but revision 1 defined no idempotent early return — `wsClient` carries one for exactly this reason. | performance `minor` | **Adopted.** `armedFor`, distinct from `attemptedFor`. |
| 14 | Every `ws.test.ts` case seeds `status: 'authenticated'` with no token, so the new gate makes all nine open zero sockets and the abandonment suite silently stops testing what it names. | performance `minor`, senior `minor` | **Adopted.** The `beforeEach` rewrite is listed in *Files to change*, and a new case keeps the authenticated-but-tokenless claim covered. |
| 15 | Three `http.test.ts` 401 tests invert rather than extend; a reader of "extend" will not expect deleted guarantees. | senior `minor` | **Adopted.** Listed explicitly under *Files to change*. |
| 16 | Boot recovery double-pays: narrowing the exclusion to `isPublicAuthPath` lets a 401 from `GET /auth/me` also enter the reactive path. | performance `minor` | **Adopted**, through finding 3's gate — `boot()` runs at `status: 'unknown'`, so it never enters the reactive path — plus exact request-count assertions on both boot paths. |
| 17 | `AUTH_PREFIX` becomes dead once the branch switches to `isPublicAuthPath`, which would move the stated lint baseline. | performance `info` | **Adopted.** Deleted in the same step. |
| 18 | A third of the ACs are satisfied by existing code and no step maps to them; the plan read as if all were new work. | senior `info` | **Adopted.** The *What is already true* table above. |
| 19 | The mutation checks are neither deterministic nor reproducible, which is what VP-3 asks of a validation step. | senior `info` | **Adopted.** Kept as author discipline, recorded in `verify.md`, not presented as gate evidence. |
| 20 | `wsClient` holds a token-bearing URL in memory; the plan added `ws.ts` to the token allowlist without noting it. | security `info` | **Adopted.** Stated, along with the two places it is already cleared, so a later edit to the abandonment logic is judged against it. |
| 21 | REQ-12 said "nothing else that identifies the user" while the URL keeps `device_id`. | security `minor` | **Adopted.** REQ-12 and AC-25 amended to admit `device_id` as accepted log surface. |

### Accepted as stated costs, and one declined

| # | Finding | Lens | Disposition |
|---|---|---|---|
| 22 | A 429 reached through a 401 signs the user out, and the plan's own `deferred` rationale argues against exactly that. | security `minor`, senior `minor` | **Accepted and stated, not changed.** The reference is explicit — one attempt, then logout — and a session that cannot be renewed is the half-working state this ticket removes. Now named in `spec.md > Known limits` with its cost (a shared TCP-peer bucket). A *proactive* 429 still ends nothing. |
| 23 | Every rotation reopens the socket, whose `onopen` fires `FETCH_DEVICES` → `LIST_DEVICES` → `invalidateQueries(['devices'])`: an idle tab pays a handshake and a devices refetch every fourteen minutes. | performance `minor` | **Accepted explicitly.** One refetch per fourteen minutes is not worth a "was this reopen a rotation?" flag threaded through the socket; §10 requires the reopen, and suppressing the fetch would make the socket's own state machine conditional on why it opened. |
| 24 | If `/auth/refresh` returns the optional `user`, `storeTokenPair` writes a new object identity and re-renders `user-menu` every rotation. | performance `info` | **Declined.** Deep-equality on the principal to save one small component one render every fourteen minutes is the gold-plating the senior lens is here to catch. |
| 25 | Single-flight dedupes concurrent 401s, not sequential ones; a wake-from-sleep wave plus `retry: 1` could produce a second refresh POST. Suggested a settled-outcome cooldown. | performance `minor` | **Solved differently.** Finding 3's live-session gate makes the second wave a no-op, because the first failure has already made the session anonymous. A cooldown timer would be a second dedupe mechanism for a case the first one already covers. |

The remaining findings were verifications requiring no action: the response
interceptor gains no per-request cost (every new step is inside the existing 401
branch and the success handler stays the identity function); no re-render storm
in the protected tree (every consumer reads through a selector, and a rotation
does not change `status`); and no deployment runtime file, no new dependency,
and no credential on the refresh request itself.
