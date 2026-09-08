---
ticket: z8pmx9md70
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-09-06
links:
  clickup: "https://app.clickup.com/t/z8pmx9md70"
  github: ""
---

# Implementation — 4 · Add silent refresh, 401 recovery and token rotation

Applied on branch `ticket/z8pmx9md70`, cut from `ticket/z8pmx9md6z`. No commit is
created here — the single publishable commit is `/publish-pr`'s (IM-9, PB-8).

## Files changed

### New (2)

| File | What it is |
|---|---|
| `src/lib/session-refresh.ts` | The proactive schedule. A singleton reconciled from store state, the same shape as `wsClient`: `MARGIN_MS`, `sync()`, `stop()`, `armedFor`, `attemptedFor`. It knows *when* the access token dies and nothing else — it never reads a token. |
| `src/lib/session-refresh.test.ts` | 12 cases: the margin, arming, not arming, re-arming from a rotation, the churn ceiling, the spent-attempt guard, cancellation, and the per-session budget. |

### Edited (9)

| File | Change |
|---|---|
| `src/api/auth.ts` | `refresh(refresh_token)` — `POST /auth/refresh`, validated with the existing `isAuthTokenPair`, mirroring `login()` including `MALFORMED_TOKEN_PAIR`. |
| `src/stores/auth.ts` | `RefreshOutcome`, `RefreshRecord`, `CATALOGUE_CODES`, the module-level `inFlight` promise, `refreshSession()`, `recordRefresh()`, `lastRefresh` in state and in `diagnostics()`, `endRefusedSession(reason?)`, `clearSession` nulling the flight, and `boot()`'s recovery path. |
| `src/lib/http.ts` | The 401 branch rewritten: the `sessionRetry` module augmentation, the live-session gate, the public-auth exclusion, the one-attempt teardown, one `await refreshSession()`, header assignment and replay. `AUTH_PREFIX` deleted. |
| `src/lib/ws.ts` | The access token in the handshake URL; `abandonedUrl` → `abandonedKey`, keyed on the token-stripped handshake; a `handshakeKey` field; the tokenless gate; `stop()` clears both URLs. |
| `src/App.tsx` | `sessionRefresh.sync()` subscribed beside `wsClient.sync()`, and `stop()` in the same cleanup. |
| `src/lib/source-policy.test.ts` | Access-token rule narrowed to `/\baccess_token\b/` with `src/lib/ws.ts` added to its allowlist; new flat `console.` ban. |
| `src/lib/http.test.ts` | 9 new reactive-path cases, 1 assertion inverted, 2 re-commented. |
| `src/lib/ws.test.ts` | `beforeEach` seeds a token; the exact-URL assertion updated; 4 new cases. |
| `src/stores/auth.test.ts` | 23 new cases: rotation, the three outcomes, single-flight, the identity check, the audit record, and boot recovery. |

**No deployment runtime file was touched.** `git status` shows no change to
`.github/workflows/ci.yml`, `.github/workflows/release.yml`, `vite.config.ts`,
`package.json` or `index.html`, and no dependency was added or removed.

## What the plan said, and what was actually written

The eight design decisions the panel forced into revision 2 are all present, and
each is worth naming with the line that carries it:

| Panel finding | In the code |
|---|---|
| single-flight never released | `finally { inFlight = null }` in `refreshSession`, plus `inFlight = null` in `clearSession` |
| replay path had no teardown | `if (config.sessionRetry) { endRefusedSession(); reject }` |
| lost live-session gate | `if (status !== 'authenticated') return Promise.reject(apiError)` — the first guard |
| budget refilled per rotation | `handshakeKey` (no token) vs `url` (with token) in `ws.ts` |
| in-flight refresh resurrects a session | `if (get().refresh_token !== spent) return 'ended'`, on both the success and the failure branch |
| cookie-first read substitutes principals | not written at all — `refreshSession` spends `get().refresh_token` |
| `deferred` used the inferred reason | `endRefusedSession('expired')` in `http.ts`; inference reserved for `ended` |
| `boot()` latch broken by an early await | the `status: 'anonymous'` write precedes every `await`, with a comment saying so |

## Deviations from the plan

Five, four of them additive and one a correction the plan could not have known
to make.

1. **`recordRefresh` became a store action rather than a private helper.**
   The plan described "a store field surfaced through `diagnostics()`" without
   saying who writes it. A module-level function would have had to call `set`
   from outside the store's own closure; an action is the idiom every other
   write in this file uses, and it costs one line in `AuthState`.

2. **`boot()`'s two branches were restructured into an `if/else`.** The plan
   showed the recovery branch only. The existing code fell *through* to a
   shared `set(...)` for the live-token case, which no longer works once the
   recovery branch has to write synchronously and then await — so the live-token
   write moved into an explicit `else`. Same behaviour, one less implicit path.

3. **`http.test.ts` records request *snapshots*, not axios configs.** The plan
   said the replay must be asserted to carry the new token. Written the obvious
   way it did not: `http.request(config)` replays the config that failed, so the
   first attempt and the replay share a headers object, and reading the header
   afterwards showed the *first* request carrying the rotated token. The
   assertion would have read backwards and proved nothing. The adapter now
   captures `{url, authorization, body}` at the moment each request leaves.

4. **Two guards had no test until mutation testing said so, and both got one.**
   This is the honest part of the record, because in both cases the guard was
   real and the plan's claim that it was covered was wrong:

   - **The live-session gate.** Removing it broke nothing. The case meant to
     cover it set `refresh_token: null`, so `refreshSession` short-circuited
     before the gate ever mattered. The gate's real work is on the
     **involuntary** teardown, where `endSession` keeps the refresh token on
     purpose: a request still in the air would otherwise spend it, and a pair
     carrying `user` would put the status back to `authenticated` — a session
     the store had just declared over, resurrected by a straggler. That case is
     now written, and the mutation dies against it.
   - **`armedFor`.** Removing it broke nothing either, and the reason exposed a
     false claim in the test's own comment: the delay is computed from an
     *absolute* deadline, so re-arming on every store write still fires at
     exactly the right moment. `armedFor` does not protect the deadline; it
     protects against a `clearTimeout`/`setTimeout` pair on every `set()` in the
     application. So the test now counts the churn instead of the timing, and
     the comment says what the property actually is.

5. **`ws.test.ts` gained a case the plan did not list.** The plan promised to
   keep the authenticated-but-tokenless claim covered; it also needed one for
   the rotation itself (`AC-23`) and one for the budget (`AC-26`), because the
   budget fix is the panel's finding and an untested fix is a claim. Four new
   cases rather than the one the plan named.

## Validation run

Profile `ui-build`, all four checks, from the repository root:

| Check | Command | Exit | Result |
|---|---|---|---|
| `ui-typecheck` | `npm run typecheck` | 0 | PASS |
| `ui-lint` | `npm run lint` | 0 | PASS — 4 warnings, the same 4 as the baseline |
| `ui-test` | `npm run test` | 0 | PASS — **215 tests / 16 files** (baseline 168 / 15) |
| `ui-build` | `npm run build` | 0 | PASS — `dist/index.html` 1,024.23 kB, gzip 418.03 kB |

Full acceptance-criteria mapping, the mutation log and the open items are in
`verify.md`.
