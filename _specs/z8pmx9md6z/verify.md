---
ticket: z8pmx9md6z
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-09-06
links:
  clickup: "https://app.clickup.com/t/z8pmx9md6z"
  github: ""
---

# Verification — 3 · Replace the connect screen with JWT login, logout and a route guard

**Outcome: PASSED, with one open item stated in full below.** Every acceptance
criterion is mapped to a result. Fifteen rest on an executed assertion, three on
an assertion plus a read-through, and eight on a read-through alone — a
consequence of C-1, which this document names per criterion rather than
averaging away. Nothing was verified against a running backend.

## Runtime impact statement (TR-3)

**No deployment runtime file changed.** `.github/workflows/ci.yml`,
`.github/workflows/release.yml`, `vite.config.ts`, `package.json` and
`index.html` are untouched, and `git status` confirms it. No dependency was
added or removed; `package-lock.json` is unchanged.

There is a **runtime behaviour change for users**, which is the point of the
ticket and is stated here rather than buried: after this change the dashboard
cannot be used without signing in. A deployment whose backend has no
`AUTH_JWT_SECRET` will show the login screen and refuse every sign-in with the
"not set up for sign-in" message — correctly, because that server cannot issue a
session, but it is a visible change for anyone who was reaching the old
basic-auth-less UI and seeing a partly working dashboard.

## Baseline (measured on this branch before the first edit)

- 13 test files, **109 tests**, all passing.
- `npm run typecheck` exit 0; `npm run lint` exit 0 with 4 pre-existing
  `react(only-export-components)` warnings.

## Validation profile — `ui-build`

| Check | Command | Exit | Result |
|---|---|---|---|
| `ui-typecheck` | `npm run typecheck` | 0 | PASS |
| `ui-lint` | `npm run lint` | 0 | PASS — 4 warnings, the same 4 as the baseline |
| `ui-test` | `npm run test` | 0 | PASS — **168 tests / 15 files** |
| `ui-build` | `npm run build` | 0 | PASS — `dist/index.html` 1,022.03 kB, gzip 417.37 kB |

59 tests added. The build matters here specifically because the ticket deletes a
route module and adds four, and extends the import cycle `z8pmx9md6y`
introduced — rollup, not `tsc`, is what would object to that.

## Acceptance criteria

Legend: **executed** — an assertion in the suite fails if it regresses;
**read-through** — verified by reading the code, because C-1 leaves no way to
render it.

### General behavior

| AC | Result | Evidence |
|---|---|---|
| AC-1 | PASS (read-through + grep) | `login.tsx` renders `id="username"`, `id="password"` (`type="password"`) and one `type="submit"`. A grep for `serverUrl`/`baseUrl`/`Server URL`/`http://` in the page returns only a comment saying the field is gone. |
| AC-2 | PASS (executed) | `auth.test.ts` asserts `login` is called with exactly `{ username, password }`; `api/auth.ts` posts it to `/auth/login`; `http.test.ts` exercises that path through the real interceptor chain. |
| AC-3 | PASS (executed + read-through) | Executed: `signIn` stores both tokens, the absolute expiry and the principal, and writes all three cookies. Read-through: `login.tsx` navigates to `afterLoginPath(arrival.from)` on success. |
| AC-4 | PASS (executed) | `http.test.ts`: no `Authorization` and no `X-Device-Id` on `/auth/login`, `/auth/refresh` or `/auth/logout`, with a token held in the store. |
| AC-5 | PASS (executed) | `src/pages/connect.tsx` is deleted (`git status` shows `D`); a grep for a `/connect` route returns nothing. The `path="*"` catch-all sends a stale link to `/`, and the guard forwards it to `/login`. |

### Authorization and routing guard

| AC | Result | Evidence |
|---|---|---|
| AC-6 | PASS (read-through) | `App.tsx` nests every application route inside `<Route element={<RequireSession />}>`, which returns `<Navigate to={LOGIN_PATH}>` for any status other than `authenticated`. |
| AC-7 | PASS (executed + read-through) | Executed: `session-route.test.ts` — a Location object round-trips to `/chats?jid=123`, and every foreign or malformed destination falls back to `/`. Read-through: the guard stamps `state={{ from: location }}` and the page reads it. |
| AC-8 | PASS (read-through) | `login.tsx` returns `<Navigate to={HOME_PATH} replace />` when `status === 'authenticated'`, before any other work. |
| AC-9 | PASS (read-through) | The guard renders a spinner for `unknown` and never `<Outlet/>`, so no protected route mounts before the session is known. It sits **above** `AppShell`, so `DeviceSwitcher` — and therefore `useDevices` — cannot mount and fire a guarded request first. `useDevices` and `useAppInfo` are additionally gated on the session. |

### Error handling

| AC | Result | Evidence |
|---|---|---|
| AC-10 | PASS (executed) | `auth-messages.test.ts` asserts `kind: 'credentials'` and that the copy matches none of `unknown user` / `user not found` / `wrong password` / `incorrect password`. |
| AC-11 | PASS (executed + read-through) | Executed: `retryAfterSeconds === 60`. Read-through: `login.tsx` sets `retryAt`, `blocked` includes `waiting`, and nothing in the page re-submits — there is no retry call anywhere. |
| AC-12 | PASS (executed) | `kind: 'not-configured'`, copy matches `/deployment\|whoever runs this server/`, and asserts the copy does **not** contain `AUTH_JWT_SECRET`. |
| AC-13 | PASS (executed) | `kind: 'busy'` with no `retryAfterSeconds`, so the button stays enabled for a manual retry. |
| AC-14 | PASS (executed) | `status: 0` maps to `kind: 'network'`, distinct from every auth kind. |
| AC-15 | PASS (executed) | The 429 copy is asserted to mention a shared address rather than the user's own attempts. |

### Logout behavior

| AC | Result | Evidence |
|---|---|---|
| AC-16 | PASS (read-through) | `UserMenu` renders a `DropdownMenuItem` labelled "Log out" calling `signOut`, mounted in the `AppShell` header. |
| AC-17 | PASS (executed) | `signOut` calls `logout(REFRESH_TOKEN)`; `api/auth.ts` posts `{ refresh_token }` to `/auth/logout`. |
| AC-18 | PASS (executed + read-through) | Executed: every cookie removed and the store reset, on success **and** on rejection. Read-through: `App.tsx` runs `cancelQueries()` then `clear()` on the transition out of `authenticated`. |
| AC-19 | PASS (executed) | `ws.test.ts`: an open socket goes `disconnected` when the session ends. |
| AC-20 | PASS (read-through) | Nothing navigates on sign-out; the guard re-renders because `status` changed and redirects. That is the design, not an omission. |
| AC-21 | PASS (executed) | Three cases: a rejecting logout, a logout that never settles, and one that throws synchronously — the local sign-out completes in all three. |

### Forced logout messaging

| AC | Result | Evidence |
|---|---|---|
| AC-22 | PASS (executed) | `http.test.ts`: a 401 on `/devices` with a live token sets `endReason: 'permissions-changed'`. `auth-messages.test.ts`: that reason's copy names permissions and an administrator. |
| AC-23 | PASS (executed + read-through) | Executed: the three messages a user can be shown are asserted pairwise distinct, and an already-expired token yields `expired` rather than `permissions-changed`. Read-through below on what that assertion does **not** prove. |

### UI and API consistency

| AC | Result | Evidence |
|---|---|---|
| AC-24 | PASS (read-through) | Both inputs carry `required`; `incomplete` is part of `blocked`; the submit button is `disabled={blocked}` **and** `submit()` returns early on `blocked` before any request. |
| AC-25 | PASS (executed) | Three source-policy rules, all mutation-tested: `password` may be named only in `api/auth.ts`, `login.tsx` and `auth-messages.ts`; no file naming a credential may touch web storage; nothing writes to web storage at all. The page clears `password` in `finally`. |
| AC-26 | PASS (read-through) | `submitting` is set before the request and cleared in `finally`; it gates both `blocked` and the early return. |

## Test cases

| TC | Result | Note |
|---|---|---|
| TC-1 Successful sign-in | PASS | Store half executed; the navigation is read-through. |
| TC-2 Invalid credentials | PASS | Executed both ends — the message, and that no session or cookie is written. |
| TC-3 Rate limit exceeded | PASS | Executed for the mapping and the window; the disabled button is read-through. |
| TC-4 Route guard | PASS | `afterLoginPath` executed; the redirect and the return are read-through. |
| TC-5 Clean sign-out | PASS | Request, cookies, store and socket executed; the cache reset and routing are read-through. |
| TC-6 Logout that never answers | PASS | Executed, plus the synchronous-throw case the plan had not anticipated. |
| TC-7 Forced sign-out | PASS | Executed through the real interceptor for the live-token 401, and through `boot()` for the reload path. |
| TC-8 Server not configured | PASS | Executed. |
| TC-9 Stale token cannot break sign-in | PASS | Executed — no `Authorization` header. See the limit below on what still travels. |
| TC-10 Empty fields, double submission | PASS (read-through) | No renderer; the gating is three lines and is quoted under AC-24/AC-26. |
| TC-11 Password does not outlive the request | PASS | Executed as source policy, and mutation-tested three ways. |

## What a green result here does not prove

Stated because a verification that only lists passes is not a verification.

- **Nothing ran against a real gowa server.** No backend with `AUTH_JWT_SECRET`
  was reachable from this environment, so a real `POST /auth/login`, the guard
  round-trip from `/chats` and back, and a real `POST /auth/logout` were not
  exercised. The envelope shapes are coded to the reference and the interceptor
  chain is exercised offline with a stubbed adapter, but the wire has not been
  seen. **This is the open item, and it is the one worth a human's five
  minutes.**
- **Eight criteria rest on reading code.** C-1 — no component renderer, and
  getting one means editing `package.json`, a hard stop — is why. Where a
  behaviour could be moved out of a render to become provable, it was
  (`toLoginError`, `afterLoginPath`, `refusalReason`, every store action). What
  remains in `.tsx` is markup and wiring.
- **The AC-23 distinctness assertion is a regression guard, not proof.** It
  proves three strings differ. That they differ *meaningfully* — that a user
  reading "Your permissions were updated" understands something different from
  "Your session expired" — is a human judgement, made by reading them, and it is
  recorded here as such.
- **"Permissions were updated" remains an inference.** The server sends a 401
  with no cause. The tests prove the inference behaves as designed, including
  under clock skew and a missing expiry cookie; they cannot prove the inference
  is right, and `spec.md > Known limits` says so.
- **A signed-in dashboard still has no live WebSocket.** `/ws` is guarded and
  the handshake carries no credential; adding `?access_token=` is a separate
  decision, out of scope. The socket will attempt, be refused, and abandon —
  exactly as before this ticket. Nothing regressed; nothing is claimed.
- **The source policy is a source scan.** It fails a file that names a password
  next to web storage. It cannot stop code that assembles the string
  `"local" + "Storage"` at runtime.

## Panel findings — disposition

The advisory panel reviewed the plan before any code existed and returned **36
findings, 9 of them major**; 33 were adopted, 1 declined with reasons, 2 noted.
Full text in `plan.md > Panel response`. What actually shipped because of them:

- Sign-out was split into two actions. Revision 1 would have fired
  `POST /auth/logout` on an involuntary 401, revoking the 30-day refresh-token
  family that `z8pmx9md70` is being built to use, and would have reversed
  `z8pmx9md6y`'s explicit decision to keep that token through a boot 401.
- A latent bug in `ws.ts` was found and fixed: `stop()` never cleared
  `abandonedUrl`, so a sign-out followed by a sign-in would have opened no socket
  for the life of the tab. It has a regression test, and removing the fix turns
  that test red.
- The cache teardown became edge-triggered and gained `cancelQueries()`, closing
  the window where a request in flight with the previous session's bearer
  resolves into the next user's cache.
- `use-app-info.ts` — a second probe-gated query the plan had missed — moved to
  the session gate with `use-devices.ts`.
- The connection banner became self-retiring, so a deployment that proxies `/api`
  but not `/health` no longer shows "Can't reach the server" above a form that
  signs in perfectly.
- `afterLoginPath` took a Location rather than a string. As written in revision 1
  it would have stringified to `"[object Object]"` and silently dropped AC-7.
- The refusal inference gained a skew tolerance, and an unreadable expiry now
  reads as *unknown* rather than *not expired* — the benign verdict, on purpose.
- `AUTH_JWT_SECRET` is no longer named to an anonymous visitor, and server text
  is capped and rendered as text, with a source rule forbidding
  `dangerouslySetInnerHTML` anywhere.

One further defect was found by this ticket's own mutation testing rather than by
the panel: the password containment rule was written with a word boundary and
therefore could not match `setPassword`, which is the most likely way a
credential would actually leave a form. The rule was green, the suite was green,
and the rule did not work. It is a substring match now, and the three password
mutations are red against the corrected version. That is the whole argument for
mutation-testing a guard before trusting it.
