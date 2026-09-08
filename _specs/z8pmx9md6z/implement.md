---
ticket: z8pmx9md6z
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-09-06
links:
  clickup: "https://app.clickup.com/t/z8pmx9md6z"
  github: ""
---

# Implementation — 3 · Replace the connect screen with JWT login, logout and a route guard

Applied on branch `ticket/z8pmx9md6z`, cut from `ticket/z8pmx9md6y`. No commit is
created here — the single publishable commit is `/publish-pr`'s (IM-9, PB-8).

## Files changed

### New (8)

| File | What it is |
|---|---|
| `src/pages/login.tsx` | The login screen: two fields, the error banner, the sign-out notice, the self-retiring connection banner, the 429 wait. |
| `src/components/layout/require-session.tsx` | The route guard. Three branches, one selector, one `useLocation`. Exports only a component. |
| `src/components/layout/user-menu.tsx` | The principal and the Log out control in the shell header. |
| `src/features/auth/retry-countdown.tsx` | The rate-limit wait, isolated so its 1 Hz tick does not re-render the form. |
| `src/lib/auth-messages.ts` | The error catalogue, the sign-out notices and the connection notices — the login screen's provable half. |
| `src/lib/auth-messages.test.ts` | 15 cases over that table. |
| `src/lib/session-route.ts` | `LOGIN_PATH`, `HOME_PATH`, `afterLoginPath`. |
| `src/lib/session-route.test.ts` | 10 cases, most of them rejections. |

### Edited (13)

| File | Change |
|---|---|
| `src/stores/auth.ts` | `SessionEndReason`, `endReason`, `refusalReason`, `signIn`, `signOut`, `endSession`, `endRefusedSession`, `consumeEndReason`; `clearSession` takes a reason; `boot`'s 401 branch now delegates to `endSession`. |
| `src/api/auth.ts` | `LoginCredentials`, `isAuthTokenPair`, `login()`, `logout()`. |
| `src/lib/http.ts` | `PUBLIC_AUTH_PATHS` checked first in the request interceptor; the 401 branch ends the session instead of marking the connection unauthorized. |
| `src/lib/ws.ts` | `sync()` gates on the session instead of the probe and forgets `abandonedUrl` on the way out; `stop()` early-returns when there is nothing to stop. |
| `src/App.tsx` | `/login` route, the guard as a layout route above `AppShell`, `ConnectPage` gone, `useAuth` replaces `useConnection` as a `sync()` trigger, and the edge-triggered cache teardown. |
| `src/components/layout/app-shell.tsx` | The connection gate and the `/connect` redirect are gone; `<UserMenu />` added. |
| `src/hooks/use-devices.ts`, `src/hooks/use-app-info.ts` | `enabled` reads the session, not the probe. |
| `src/stores/connection.ts` | `markUnauthorized` removed. |
| `src/lib/source-policy.test.ts` | `CREDENTIAL` widened to a bare `password`; three rules added. |
| `src/stores/auth.test.ts` | +18 cases. |
| `src/lib/http.test.ts` | The 401 describe replaced; the public-route describe added. |
| `src/lib/ws.test.ts` | Session-driven instead of probe-driven; +5 cases. |
| `src/stores/connection.test.ts` | The `markUnauthorized` case removed, with a note saying where its subject went. |

### Deleted (1)

- `src/pages/connect.tsx` — 70 lines (AC-5).

**Deployment runtime files: none touched.** No dependency added.

## Deviations from the plan

Five, all recorded rather than smoothed over.

1. **`signOut` is hardened against a synchronous throw.** The plan wrote
   `void logout(token).catch(() => {})`. Writing the test for it exposed that a
   `logout` that throws *before* returning a promise — or returns a non-promise —
   would propagate out of `signOut` and skip `clearSession` entirely, which is
   the one thing AC-21 forbids. It is now
   `try { void Promise.resolve(logout(token)).catch(() => {}) } catch {}`, with a
   test that mutates `logout` to throw synchronously. Strictly additive.

2. **`signIn` falls back to `GET /auth/me` when the pair carries no principal.**
   Not in the plan. `storeTokenPair` only marks a session `authenticated` when a
   `user` is present, and the reference marks `user` optional on the pair — so a
   deployment that omitted it would leave the user in a loop: signed in, guard
   refuses, back to a login screen that just succeeded. Three lines, and it
   rolls the partial session back if the fallback itself fails.

3. **`afterLoginPath` rejects control characters instead of stripping and
   re-checking.** The plan described a strip-then-recheck pass on top of the
   control-character check. Implementing it made the second pass dead code — a
   candidate that survives the control-character check has nothing left to strip.
   The rejection covers the same attack (`"/<TAB>//evil.example"`), and the tests
   assert tab, CR and LF individually. Written as a code-point scan rather than a
   regexp, because a character class over C0 controls means putting those bytes
   in the source file.

4. **`afterLoginPath` also rejects `/login` itself.** Not in the plan, found
   while writing the tests: the guard can stamp `/login` as the refused
   destination, and returning a user there after a successful sign-in would
   bounce them straight back out of the screen they just finished with.

5. **The plan promised a mutation test that is not possible.** It said the cache
   teardown would be made level-triggered again to show "the edge test goes red".
   There is no edge test: the teardown lives in `App.tsx`, and C-1 means no
   component can be rendered. The edge-trigger is verified by read-through and by
   the live check, and `verify.md` records it as such. Two testable mutations
   were run in its place (the 401 burst guard, and the public-auth-path skip).

## Validation run

Profile `ui-build`, from a **109-test / 13-file** baseline measured on this
branch before the first edit.

| Check | Command | Result |
|---|---|---|
| `ui-typecheck` | `npm run typecheck` | exit 0 |
| `ui-lint` | `npm run lint` | exit 0 — the same 4 pre-existing warnings, none added |
| `ui-test` | `npm run test` | **168 passed / 15 files**, exit 0 |
| `ui-build` | `npm run build` | exit 0 — `dist/index.html` 1,022.03 kB (gzip 417.37 kB) |

No new lint warning is worth a line of its own: `require-session.tsx`,
`user-menu.tsx` and `retry-countdown.tsx` each export only a component, which is
why none of them joined the four files already tripping
`react(only-export-components)`.

### Mutation testing

Every rule this ticket added was watched failing before it was trusted. Each
mutation was applied, the suite run, and the file restored from a copy.

| Mutation | Rule it should break | Result |
|---|---|---|
| a bare `password` in `src/lib/format.ts` | password containment | RED |
| `setPassword()` in `src/lib/format.ts` | password containment | **GREEN — see below** |
| `formData.password` in `src/lib/format.ts` | password containment | RED |
| a password written to `localStorage` | credential × web storage | RED |
| `clearSession()` called outside the store | single teardown path | RED |
| `dangerouslySetInnerHTML` in `logo.tsx` | server text is text | RED |
| the `abandonedUrl` reset removed from `sync()` | ws re-login regression | RED |
| the `status !== 'authenticated'` check removed | the 401 burst guard | RED |
| the public-auth-path skip removed | no credential on `/auth/login` | RED |

**The one that survived, and what it changed.** The password containment rule was
written `/\bpassword\b/i`, and a leading word boundary cannot match inside
`setPassword` — so a `setPassword()` helper in an unrelated module passed the
rule cleanly. That is exactly the gap the security lens named at review ("would
miss `setPassword(x)`, `formData.password` and `type="password"`"), and the
written rule still had it. It is now a substring match, `/password/i`, and the
three password mutations above were re-run against the corrected rule: all RED.

Worth stating plainly because it is the argument for doing this at all: the rule
was green, the suite was green, and the rule did not work.

### Live verification

Not performed. No gowa backend with `AUTH_JWT_SECRET` configured was reachable
from this environment, so `POST /auth/login`, the guard round-trip and the real
`POST /auth/logout` were **not** exercised against a running server. `verify.md`
records that as an open item rather than as a pass — it is the part C-1 already
keeps out of the unit suite, and it is the part most worth a human's five
minutes.
