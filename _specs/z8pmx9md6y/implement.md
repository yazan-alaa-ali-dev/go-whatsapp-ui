---
ticket: z8pmx9md6y
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-09-05
links:
  clickup: "https://app.clickup.com/t/z8pmx9md6y"
  github: ""
---

# Implementation — 2 · Build the single-source-of-truth auth session store on cookies

Applied on branch `ticket/z8pmx9md6y`, cut from `ticket/z8pmx9md6x` (see
`ticket.md > Execution context` for why not from `main`). No commit is created
here — committing is the delivery boundary's job (`/publish-pr`).

## Files changed

### New

| File | What it is |
|---|---|
| `src/lib/cookies.ts` | The cookie adapter. `cookieAttributes` is pure and takes `secure` as an argument; `getCookie` / `setCookie` / `removeCookie` are the only code in `src/` that touches `document.cookie`. Every entry point degrades to "no session" rather than throwing when cookies are disabled or `document` is absent. |
| `src/lib/cookies.test.ts` | 12 cases: the exact attribute string under `https:` and `http:`, per-cookie `Max-Age`, `Max-Age=0` plus a matching `Path` on removal, value encoding, a name that is a suffix of another, and both no-`document` and storage-refused paths. |
| `src/api/auth.ts` | `AuthUser` and `AuthTokenPair` as the reference documents them, an `isAuthUser` runtime guard, and `fetchMe()`. |
| `src/stores/auth.ts` | The session store: the five owned fields, `storeTokenPair`, `clearSession`, `boot`, `diagnostics`, and the four module-private cookie writers that keep the cookie names in one place. |
| `src/stores/auth.test.ts` | 14 cases over a `document.cookie` jar and a mocked `@/api/auth`. |
| `src/lib/http.test.ts` | 6 cases over the real interceptor chain, driven by a stub axios adapter. |
| `src/lib/source-policy.test.ts` | The executable source policy: 10 rules over every non-test file in `src/`, plus a self-check that it is reading source at all. |
| `.claude/docs/adr/ADR-012-cookie-session-storage.md` | The cookie-over-`localStorage` decision, its explicit non-claim about XSS, and the four costs the panel measured. |

### Edited

| File | Change |
|---|---|
| `src/lib/http.ts` | Request interceptor attaches `Authorization: Bearer <token>` from the store, on relative URLs only. Response interceptor no longer calls `markUnauthorized()` for a 401 from an `/auth/` path. |
| `src/lib/curl.ts` | The rendered command gains a valueless `-H 'Authorization: Bearer <token>'`. |
| `src/lib/curl.test.ts` | The exact-command case updated for the new header; the "carries no credential" case rewritten as "stands in for the credential", plus a new case proving no token value can appear. |
| `src/lib/api-error.test.ts` | One case: an `ApiError` built from a request that carried an `Authorization` header serialises without it. |
| `src/App.tsx` | The existing boot effect also calls `useAuth.getState().boot()`. |

**No file in `project-config.yaml > deployment_runtime.files` was modified.**
`worker/index.js` and `wrangler.jsonc` were not touched either.

## Deviations from the plan

Four, all additive, none changing the approach the panel reviewed.

1. **`src/lib/http.test.ts` was added; the plan did not list it.** The plan
   committed to mutation-testing "the same-origin check on the bearer header"
   and there was no test to go red — the two panel-driven fixes in `http.ts`
   (the same-origin guard and the `/auth/` exemption) had no executed coverage
   at all, only a source-scan rule. A guard the plan promises to mutate must
   exist. It exercises the real interceptor chain through a stub axios adapter,
   and as a side effect it is the runtime proof that the documented import cycle
   (`stores/auth` → `api/auth` → `lib/http` → `stores/auth`) resolves.
2. **The source policy is 10 rules, not the 6 the plan enumerated.** The extra
   three fell out of writing them: a self-check that the guard is actually
   reading source (a glob that silently matched nothing would make every other
   rule vacuously pass), a direct assertion that `stores/auth.ts` contains no
   `persist`, and a `refresh_token`-is-opaque rule separate from the JWT one.
3. **Comments are stripped before any rule is matched.** Unplanned and
   necessary: `stores/connection.ts` explains in prose that it deletes a key
   that held a *password*, and `stores/auth.ts` and `cookies.ts` both document
   in prose that they write no *`localStorage`*. Matching raw text would fail
   three files for saying what they correctly do. The stripper is a lexer
   approximation (`[^:]` keeps `https://` from reading as a line comment) and
   can only ever remove text, never conceal added code.
4. **`getCookie` also rejects a name that is a suffix of a longer cookie's
   name.** Not in the plan; found while writing the test. `document.cookie`
   entries are `; `-separated, and matching on `includes` would have let
   `other.gowa-ui.access.v1` answer for `gowa-ui.access.v1`.

## Validation run

Profile `ui-build` (`project-config.yaml > validation_profiles`), from the
repository root:

| Check | Command | Result |
|---|---|---|
| `ui-typecheck` | `npm run typecheck` | exit 0 |
| `ui-lint` | `npm run lint` | exit 0 — 4 warnings, all pre-existing `react/only-export-components` in files this ticket did not touch |
| `ui-test` | `npm run test` | exit 0 — **109 passed / 13 files**, from a 64-test baseline measured on the branch before the first edit |
| `ui-build` | `npm run build` | exit 0 — `dist/` holds exactly one file, `index.html`, 1,014.08 kB (415.04 kB gzip) |

The build matters here specifically: this ticket introduces the repository's
first import cycle, and rollup — not `tsc` — is what would have objected. 2110
modules transformed, no warning.

The bundle was checked directly: it contains `SameSite=Strict`,
`gowa-ui.access.v1` and the cURL placeholder, and contains **no** occurrence of
`RULE:` — confirming `source-policy.test.ts` and its `?raw` imports of every
source file never enter the build graph.

### Mutation testing

Every guard this ticket adds was made to fail before it was trusted. Each
mutation was applied, run, and reverted.

| Mutation | Result |
|---|---|
| `const stash = (t: string) => localStorage.setItem('access_token', t)` added to `src/lib/format.ts` | **4 rules** went red independently, each naming `src/lib/format.ts`: the credential-and-storage rule, the `setItem` rule, the storage-allowlist rule, and the access-token-owner rule |
| `document.cookie` read added to `src/lib/format.ts` | the one-cookie-door rule went red |
| `atob(t.split('.')[1])` added to `src/lib/format.ts` | the no-JWT-decoding rule went red |
| The same-origin check removed from the bearer header in `http.ts` | `http.test.ts > is not attached to an absolute URL` went red: `expected 'Bearer eyJhbGciOiJIUzI1NiJ9…' to be undefined` |
| Revision 1's **blanket** `persist` rule restored (no allowlist) | went red against **`src/stores/device.ts` and `src/stores/recipient.ts`** — the senior lens's major finding reproduced exactly, and the reason the shipped rule is credential-scoped instead |

That last row is the ticket's most useful negative result: the guard revision 1
described would have failed on its first run and forced an unplanned edit to two
files holding a device id and a list of recent recipients — neither a credential,
neither in this ticket's scope.

### Live verification

Run against the real gowa server on `localhost:3000` (the address
`VITE_DEFAULT_SERVER_URL` names). A first attempt was answered by an
intercepting `squid/7.2` proxy with `403 ERR_ACCESS_DENIED`; bypassing that
proxy reached the server itself.

| Check | Result |
|---|---|
| `GET /health` | `200`, `text/plain`, body `OK` — the backend is up |
| `GET /auth/me` with no header | `401` `{"code":"UNAUTHENTICATED","message":"authentication required"}` |
| `GET /auth/me` with a bogus bearer | `401`, same envelope — a malformed token is not accepted |
| `AuthPrincipalResponse` in the **running server's** `/api-docs/openapi.yaml` | `results` is an `AuthUserView` — the shape `fetchMe()` unwraps, confirmed against the server rather than only the bundled reference |
| `AuthTokenPair` in the same document | `access_token`, `refresh_token`, `expires_in`, `user` — the shape `storeTokenPair` accepts |

`POST /auth/login` was **not** exercised: no credentials for this server are
held, the endpoint is rate-limited to 10 attempts a minute (§03), and guessing
at them is not verification. Creating a session is `z8pmx9md6z`'s scope in any
case (spec C-4).
