---
ticket: z8pmx9md6y
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-09-05
links:
  clickup: "https://app.clickup.com/t/z8pmx9md6y"
  github: ""
---

# Verification — 2 · Build the single-source-of-truth auth session store on cookies

Outcome: **PASSED**. All 19 acceptance criteria are mapped to an executed
result. Eight of the nine test cases pass; one is recorded **partial**, with the
exact limit stated rather than rounded up to a pass.

## Runtime impact statement (TR-3)

**No deployment runtime file was changed. No.**

The canonical list (`project-config.yaml > deployment_runtime.files`) is
`.github/workflows/ci.yml`, `.github/workflows/release.yml`, `vite.config.ts`,
`package.json`, `index.html`. `git status` confirms none is modified, and no
dependency was added — the cookie adapter is 90 lines of this repository's own
code rather than a package. `worker/index.js` and `wrangler.jsonc`, which
`z8pmx9md6x` added, were not touched either; the panel's edge-cache and TLS
findings against them are recorded in ADR-012 as deployment consequences, not
implemented here.

## Baseline (measured on the branch before the first edit)

`npm run test` → **64 passed / 9 files**. After: **109 passed / 13 files**
(+45).

## Validation profile — `ui-build`

| Check | Command | Exit | Result |
|---|---|---|---|
| `ui-typecheck` | `npm run typecheck` | 0 | PASS |
| `ui-lint` | `npm run lint` | 0 | PASS — 4 warnings, all pre-existing `react/only-export-components`, none in a file this ticket touched |
| `ui-test` | `npm run test` | 0 | PASS — 109/109 |
| `ui-build` | `npm run build` | 0 | PASS — one file in `dist/`, 1,014.08 kB (415.04 kB gzip), 2110 modules, no rollup warning about the new import cycle |

Per-file counts of the suite this ticket added or changed: `cookies.test.ts` 12,
`auth.test.ts` 14, `http.test.ts` 6, `source-policy.test.ts` 11,
`curl.test.ts` 11 (was 9), `api-error.test.ts` 5 (was 4).

## Acceptance criteria

### Single source of truth

| AC | Result | Evidence |
|---|---|---|
| **AC-1** one auth store, sole owner | PASS | `src/stores/auth.ts` is the only module holding session state; `source-policy.test.ts > the access token is named only where it is owned, fetched or attached` limits `access_token` to `stores/auth.ts`, `api/auth.ts`, `lib/http.ts` |
| **AC-2** no other module reads tokens from storage | PASS | same rule, plus `document.cookie is touched in exactly one file` — mutation-tested: a `document.cookie` read added to `lib/format.ts` turned it red |
| **AC-3** no other module writes tokens | PASS | all four cookie writers are module-private in `stores/auth.ts`; the adapter is reached from nowhere else (`offenders(/document\s*\.\s*cookie/)` allows only `lib/cookies.ts`) |
| **AC-4** the store owns the named fields | PASS | `AuthState` in `src/stores/auth.ts` carries exactly `access_token`, `refresh_token`, `access_token_expires_at`, `user` (all seven sub-fields typed in `api/auth.ts`), `status` — and no sixth field: the boot latch is derived from `status` + `access_token`, per the panel |
| **AC-5** `expires_in` converted once, inside the store | PASS | `auth.test.ts > converts expires_in once into an absolute timestamp and keeps no second copy` asserts the timestamp bounds **and** `expect(state).not.toHaveProperty('expires_in')` |

### Cookie storage

| AC | Result | Evidence |
|---|---|---|
| **AC-6** cookies only, via `src/lib/cookies.ts` with get/set/remove | PASS | the adapter exports exactly those three plus the pure `cookieAttributes`; `cookies.test.ts` 12/12 |
| **AC-7** `SameSite=Strict`, `Path=/`, `Secure` over https | PASS | `cookies.test.ts` asserts the **exact** string `gowa-ui.access.v1=token; Path=/; SameSite=Strict; Max-Age=900; Secure` and its `http:` counterpart without `Secure`; `auth.test.ts` re-asserts both attributes on all three cookies as actually written |
| **AC-8** access cookie = token lifetime, refresh cookie = 30 days | PASS | `auth.test.ts > gives each cookie its own token lifetime, not a shared one`: `Max-Age` 900 / 900 / 2592000 |
| **AC-9** no token, password or credential in `localStorage`/`sessionStorage` | PASS | three independent source rules, all mutation-tested — a single `localStorage.setItem('access_token', t)` in `lib/format.ts` turned **four** assertions red; `auth.test.ts > persists nothing to web storage` additionally stubs both storages and asserts `setItem` is never called at runtime |
| **AC-10** no `zustand persist` over `localStorage` for a sensitive field | PASS | `source-policy.test.ts` asserts `stores/auth.ts` contains neither `persist(` nor `createJSONStorage`, and confines both to `stores/device.ts` / `stores/recipient.ts`, which hold a device id and recent recipients |

### Migration and cleanup

| AC | Result | Evidence |
|---|---|---|
| **AC-11** legacy `gowa-ui.connection.v1` removed on boot | PASS | delivered by `z8pmx9md6x` and still green: `connection.test.ts > deletes the key an older bundle used for the address and password`. Deliberately not re-implemented in the auth store — a second owner of one cleanup is the failure mode this ticket exists to prevent |
| **AC-12** legacy `username`/`password` erased, never migrated | PASS | `clearLegacyStorage()` calls `removeItem` and nothing else; no code path reads that key. Verified by inspection and by the storage-allowlist rule, which permits `connection.ts` to name storage but the `setItem` rule forbids writing |
| **AC-13** `username`/`password` absent from `src/stores/connection.ts` | PASS | `grep -n "password\|username" src/stores/connection.ts` returns only two prose comments describing what the deleted key used to hold; there is no such field on `ConnectionState` |

### Rehydration authority

| AC | Result | Evidence |
|---|---|---|
| **AC-14** `GET /auth/me` called exactly once on boot, authoritative | PASS | `auth.test.ts > makes GET /auth/me the authority for user and permissions` (user and `permissions[]` equal the response) and `> calls /auth/me exactly once even though StrictMode boots twice` (two concurrent boots plus a third: `toHaveBeenCalledTimes(1)`) |
| **AC-15** no JWT claim decoded in the UI | PASS | `source-policy.test.ts > no JWT is decoded in the UI` — mutation-tested with `atob(t.split('.')[1])`. `account_id`, `epoch` and `sub` appear nowhere outside the `AuthUser` type fed by `/auth/me` |
| **AC-16** the refresh token is treated as opaque | PASS | a second rule forbids splitting or decoding it; the store passes it to the cookie adapter and reads it back, nothing more |
| **AC-17** a 401 leaves the session invalid, recovery deferred | PASS | `auth.test.ts > leaves the refresh token intact when /auth/me answers 401`: status `anonymous`, `user` null, `access_token` null, **`refresh_token` still held and the cookie still present**. No `/auth/refresh` call exists in this ticket |

### Audit and observability

| AC | Result | Evidence |
|---|---|---|
| **AC-18** no full token to console or any log | PASS | `source-policy.test.ts` confines `Bearer` to `lib/http.ts` and `lib/curl.ts`'s valueless placeholder; `api-error.test.ts > drops the request that failed` asserts a serialised `ApiError` from a request that carried the header contains neither the token nor `Bearer`, and that its keys are exactly `status`, `code`, `message`; `curl.test.ts > cannot leak a token, because it is given none to read` |
| **AC-19** diagnostics report state, not values | PASS | `auth.test.ts > reports the session without naming either token`: `JSON.stringify(diagnostics())` contains neither token value, while reporting `status`, `hasAccessToken`, `hasRefreshToken` and a permission **count** |

## Test cases

| TC | Result | Note |
|---|---|---|
| **TC-1** session in cookies, not localStorage | PASS | `auth.test.ts` (cookie names, lifetimes, attributes, and no `setItem` at runtime) + the three source rules |
| **TC-2** legacy storage cleanup | **PARTIAL** | The `localStorage` half is executed (`connection.test.ts`, unchanged and green) and no session can be created from the legacy values because no code reads that key. The "user is presented with the login screen" half **cannot be executed in this ticket** — there is no login screen until `z8pmx9md6z` (spec C-4, Out of scope) |
| **TC-8 live** | PASS | `GET /auth/me` on the running server returns `401 {"code":"UNAUTHENTICATED"}` with no header and with a bogus bearer — the exact response the store's 401 branch is written against |
| **TC-3** single source of truth | PASS | `source-policy.test.ts`, mutation-tested on both halves (token read outside the store; `document.cookie` outside the adapter) |
| **TC-4** `/auth/me` is the authority | PASS | `auth.test.ts`, two cases; no claim is read from the JWT (AC-15) |
| **TC-5** unsafe storage is rejected | PASS | The guard was **made to fail** and restored: `localStorage.setItem('access_token', …)` added to `lib/format.ts` turned four rules red, each naming the file and stating the rule in its own message |
| **TC-6** seconds-to-timestamp conversion | PASS | `expires_in: 900` → `access_token_expires_at` bounded to `[before+900_000, now+900_000]`, and no `expires_in` retained |
| **TC-7** cookie attributes | PASS | exact-string assertions for `https:`/`http:`, per-cookie `Max-Age`, and `Max-Age=0` + matching `Path` on removal |
| **TC-8** a 401 does not destroy the refresh token | PASS | `auth.test.ts`, asserting both the state field and the surviving cookie |
| **TC-9** the diagnostic names no token | PASS | serialised output checked against both token values |

Two further behaviours were verified that the spec did not ask for, both
introduced by panel findings: the bearer header is **not** attached to an
absolute URL (`http.test.ts`, mutation-tested), and a 401 from an `/auth/`
endpoint does **not** flip the connection status (`http.test.ts`).

## What a green result here does not prove

- **No authenticated live session was exercised.** The live checks that could
  be run were (see `implement.md > Live verification`): the server answers
  `/health` `200 text/plain OK`, answers `/auth/me` `401
  {"code":"UNAUTHENTICATED"}` both without a header and with a bogus bearer, and
  its **own** `/api-docs/openapi.yaml` confirms `AuthPrincipalResponse.results`
  is an `AuthUserView` — the shape `fetchMe()` unwraps. What was **not** run is
  a successful `/auth/me` with a real token: no credentials for this server are
  held, and `POST /auth/login` is rate-limited and out of scope (C-4). So the
  *success* path is verified against the schema and the unit suite, not against
  a live 200. The mitigation is in the code rather than in this document: the
  `isAuthUser` runtime guard makes a wrong assumption **fail closed** — an
  unexpected envelope produces an anonymous session, never an authenticated one
  with an empty principal.
- **No browser pass.** The Chrome extension was not available, so the
  `document.cookie` behaviour is verified against a jar that mirrors the
  browser's write-one/read-all accessor, not against a browser. The attribute
  string is asserted exactly, which is what a browser parses.
- **The regression guard is a source scan.** It reads text with comments
  stripped. It cannot stop code that computes `"local" + "Storage"` at runtime,
  and its comment stripper is a lexer approximation. It can only ever remove
  text from what it inspects, so it cannot conceal added code.
- **Cookies are not XSS protection**, and nothing here claims otherwise — see
  ADR-012 and `spec.md > Known limits`. This ticket reduces the leak surface; it
  does not close it.
- **The session cannot yet be created.** Everything above verifies rehydration
  and storage. Login is `z8pmx9md6z`, refresh is `z8pmx9md70`.

## Panel findings — disposition

24 findings from three lenses, reviewed **before** implementation:
**19 adopted, 3 declined with reasons, 2 noted**. Full text and reasoning in
`plan.md > Panel response`. The two that changed the outcome most:

1. The senior lens found that revision 1's source rules were **red against code
   that already ships** (`stores/device.ts` uses `persist` *and*
   `createJSONStorage(() => localStorage)`; `stores/recipient.ts` uses
   `persist`). Reproduced under mutation testing during verify: restoring the
   blanket rule fails against both files. The shipped guard is credential-scoped
   and is strictly stronger.
2. Three lenses independently found the same nondeterminism: a boot `/auth/me`
   401 racing the health probe decided whether the user landed on the dashboard
   or on "The server rejected this session". Fixed semantically — a 401 from a
   public `/auth/*` endpoint means "no session", not "this origin is refused" —
   and pinned by `http.test.ts`.
