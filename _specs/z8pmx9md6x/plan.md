---
ticket: z8pmx9md6x
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-09-05
links:
  clickup: "https://app.clickup.com/t/z8pmx9md6x"
  github: ""
---

# Plan — 1 · Route all API traffic through a same-origin proxy path

> **Revision 2.** Revision 1 was authored before any code and reviewed by the
> advisory panel (senior / security / performance) against the **source**, not
> against its own prose. All 32 findings are answered in
> [Panel response](#panel-response). Four findings changed the design, one
> corrected a claim that would have shipped a broken dev environment, three are
> declined with reasons, and the spec gained a *Known limits* section because a
> lens showed its central property was overstated.

## Approach

The UI has exactly one thing wrong with it for this ticket: the backend address
is a **value** — carried in a store, persisted, and joined onto every path. The
fix is to make it a **constant that is not an address**: a relative path prefix
that only means something to the origin already serving the page.

That single move collapses a surprising amount of surface:

- If the prefix is a constant, `axios.baseURL` no longer needs the store.
- If it is relative, the WebSocket URL has to come from `window.location`, which
  is the only place left that knows an origin.
- If nothing is configurable, the connect **form** has nothing to submit, the
  `unconfigured` status has nothing to describe, and the persisted store has
  nothing worth persisting.

So the work is: one constant, a handful of call sites re-pointed at it, and the
removal of everything that existed only to feed it.

### Where the constant lives

`src/lib/url.ts` — the module that already owns every URL builder in this app
(`joinUrl`, `rerootServerUrl`, `toWebSocketUrl`). Putting `API_PREFIX` there
makes AC-1 true in the strongest available sense: the constant and every
function that consumes it are the same module, so "no URL is built outside it"
is enforced by where the code sits rather than by discipline.

A new one-line `src/lib/api-base.ts` was considered and rejected: it would put
the constant in one module and its consumers in another — more files for less of
the property AC-1 asks for.

### Why the prefix is `/api` and not `''`

AC-17 requires `GET /health` at the **root**, distinct from the prefix. The empty
string cannot express that distinction — with `baseURL: ''` there is no
"under the prefix" to be outside of, and the AC becomes unverifiable. `/api` is
the value the ticket itself names.

### What replaces the `/devices` probe

`boot()` currently probes a **user-entered** URL to decide whether it is a real
gowa server. With no user-entered URL there is nothing to validate, so the probe
stops being an identity check and becomes a **liveness** check: `GET /health` at
the root (reference §02 — always registered there, whatever `APP_BASE_PATH` is).

The acceptance rule is **`status === 200` AND the response is not `text/html`**.
Both halves are load-bearing, and each was put there by a lens:

- **Not `text/html`** — behind an SPA-fallback proxy, and under `vite dev`
  without a `/health` entry, `/health` answers `200 text/html` with
  `index.html`. Without this half, a dead backend reads as connected.
- **`status === 200`** — the reference's OpenAPI gives `/health` a
  `503 text/plain` response, and a 502/504 proxy page is often `text/plain` too.
  Revision 1 rejected only HTML *regardless of status*, so it would have read a
  backend that explicitly reported itself unhealthy as connected.

The rule deliberately does **not** require JSON: gowa's `/health` body is not
pinned by the reference, and a plain-text `OK` must not be misread as a dead
server.

The probe uses a **bare axios call**, not the shared `http` instance — the shared
instance carries `baseURL = API_PREFIX`, which would prefix `/health` and break
AC-17 silently, and its 401 interceptor would call `markUnauthorized()` from
inside boot. This is the same deliberate exception `AGENTS.md` anti-pattern #6
already grants `probeServer`; the anti-pattern text is updated to name the new
function.

### The WebSocket give-up ceiling

Removing the credentials (C-3) removes the `authorization` query parameter from
the `/ws` handshake. **Two lenses independently found the same consequence**:
against a server that authenticates `/ws` (reference §10 — it does), every
handshake is rejected, `onclose` fires, `desired` is still `true`, `attempt` only
resets inside `onopen`, and `backoffDelay` caps the *delay* at 30s but never the
*count*. Every open tab then hammers the proxy forever, while `status` stays
`connected` because HTTP still works — so nothing ever calls `stop()`.

The fix distinguishes a handshake that **never opened** from a socket that opened
and later dropped:

- A socket that has opened before keeps reconnecting forever — that is a network
  blip, and the existing behaviour is right for it.
- A socket that has **never** opened gives up after `WS_MAX_HANDSHAKE_ATTEMPTS`
  and records the URL it failed on, so a later no-op store write cannot restart
  the loop. `sync()` skips a URL already recorded as failed; a URL change (device
  switch, reconnection after a status change) clears it and tries again.

`stop()` already sets `WsStatus: 'disconnected'`, which `WsBadge` renders as
"Live updates offline" — a correct terminal state that needs no new UI.

## Steps

1. **`src/lib/url.ts` — the single source.** Add `API_PREFIX = '/api'` and
   `HEALTH_PATH = '/health'`. Rework the builders to consume the prefix instead
   of a `baseUrl` argument:
   - `absoluteApiUrl(path, origin = window.location.origin)` — an absolute
     same-origin URL for the one consumer that needs a copy-pasteable string
     (the cURL preview). `origin` is the **page's** origin; it is a parameter
     only so the function is testable under the Node vitest environment (C-2).
   - `rerootServerUrl(serverUrl, serverBasePath?)` — loses its `baseUrl`
     parameter and re-roots onto `API_PREFIX`.
   - `toWebSocketUrl(params, location?)` — loses its `baseUrl` parameter, takes
     an injectable `{ protocol, host }` defaulting to `window.location`.
   - Delete `normalizeBaseUrl`, `sameOriginBaseUrl` and `b64encode`. The first
     two existed only to turn a user-entered or page-derived address into a
     `baseUrl`; `b64encode` loses its last caller when the credentials go.
   - No `apiPath()` helper: `http.ts` sets `baseURL = API_PREFIX` and every
     `src/api/*` call already passes a relative path, so it would have no caller.

2. **`src/lib/http.ts`.** `config.baseURL = API_PREFIX`, imported from `url.ts`.
   Drop the store read and the `Authorization` header the interceptor attached
   from `username`/`password` (C-3). Everything else — the device header, the
   envelope helpers, the 401 handler — is untouched, so all ~60 `src/api/*` call
   sites keep working unchanged and inherit the prefix (AC-16).

3. **`src/lib/api-error.ts`.** Delete `basicAuthHeader`. It loses all three
   callers in this ticket (`http.ts`, `connection.ts`, `curl.ts`), and a
   credential-encoding helper with no caller is dead weight inlined into the
   single-file bundle. `toApiError` / `isApiError` are untouched.

4. **`src/stores/connection.ts`.** Reduce to what is left: a `status` of
   `booting | connected | unauthorized | unreachable`, a `boot()` that probes
   `HEALTH_PATH`, and `markUnauthorized()`. Remove `baseUrl`, `username`,
   `password`, `connect()`, `disconnect()`, the `unconfigured` status, the
   `not-gowa` result, and the entire `persist` middleware — with the middleware
   gone, nothing is written to `localStorage` at all (AC-10, AC-11).
   There is no separate `retry()`: it would be `boot()` under a second name, and
   the Retry button calls `boot()` directly.
   The probe timeout drops from 8s to **5s** — it now sits in front of the whole
   UI (`AppShell` blocks on `booting`), so its worst case is a blank screen.
   The legacy `gowa-ui.connection.v1` key — where an older bundle recorded the
   backend address *and a plaintext password* — is removed at the **top of
   `boot()`**, not at module scope: `connection.ts` is imported by `http.ts` and
   `ws.ts`, and an import-time `localStorage` touch throws in the Node vitest
   environment (C-2) and in a browser with storage blocked, blanking the app. The
   removal is guarded with `typeof localStorage !== 'undefined'` and a try/catch.

5. **`src/pages/connect.tsx`.** Replace the form with a status screen carrying
   **two distinct messages** and a Retry button that calls `boot()`:
   - `unreachable` — a network/proxy failure, explicitly not something the
     operator can fix from this screen (AC-18).
   - `unauthorized` — the server rejected the session. This status survives the
     ticket (the 401 interceptor still sets it) and `app-shell.tsx` routes every
     non-`connected` status here, so without its own message a 401 would render
     as a network error and a Retry that can never clear it.

   No inputs, and no `VITE_DEFAULT_SERVER_URL` read. The Retry button is disabled
   while a probe is in flight. The route path stays `/connect` so `app-shell.tsx`
   and any bookmark keep working; only what the page contains changes.

6. **`src/lib/ws.ts`.** `sync()` gates on `status === 'connected'` alone and calls
   `toWebSocketUrl({ device_id })`. The `authorization` query parameter goes with
   the credentials (C-3); reference §10 replaces it with `?access_token=` in
   ticket `z8pmx9md6y`. Add the handshake give-up ceiling described above.

7. **`src/features/session/login-qr-dialog.tsx` and
   `src/features/chat/message-media.tsx`.** Drop the `useConnection` baseUrl
   read; call `rerootServerUrl(url, info?.base_path ?? '')` (AC-7). In the QR
   dialog the `!baseUrl` guard goes with it.

8. **`src/lib/curl.ts` and `src/components/shared/curl-dialog.tsx`.**
   `CurlOptions` becomes `{ deviceId }`: the command renders
   `absoluteApiUrl(path)` and the device header. The `-u` rendering,
   `revealSecrets`, the password mask and the "your password is hidden here"
   note are removed — they render credentials that no longer exist (C-3), and
   with the mask gone the displayed and copied commands are identical, so
   `toCurl` is called once instead of twice. The command is rendered **only while
   the dialog is open**: `CurlDialog` is mounted unconditionally inside
   `FormActions`, and its `request` prop is rebuilt on every keystroke, so today
   `toCurl` (a `JSON.stringify` of the body plus `formFields`) runs on every
   render of every form on screen.

9. **`src/pages/settings.tsx`.** Restate the Connection card: no `baseUrl`, no
   username, no Disconnect button (the store has nothing left to clear). It
   states the request path (`/api`) and that traffic is same-origin. It does
   **not** render `base_path` from `/app/info` — that value discloses the
   backend's mount path, and printing it on screen would undo part of what this
   ticket is for.

10. **`vite.config.ts`** *(deployment runtime file — see the guard section)*.
    Replace the `server.proxy` map with exactly:

    ```ts
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
        ws: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      '/health': {
        target: backendUrl,
        changeOrigin: true,
      },
    }
    ```

    Revision 1 said "same rewrite", which would have kept
    `p.replace(/^\/gowa/, '')` — under a `/api` prefix that strips nothing and
    every dev request forwards as `/api/...` and 404s. The `/health` entry
    carries **no** rewrite (the path is already correct at the backend root) and
    no `ws`. Nothing else in the file changes: same plugins, same
    `viteSingleFile`, same alias, same `loadEnv` (AC-15).

11. **Tests.** Rewrite `src/lib/url.test.ts` for the new signatures and add
    TC-6/TC-7 coverage; update `src/lib/curl.test.ts` for the new options shape;
    drop the `b64encode` tests with the function. Both files stay in the Node
    vitest environment (C-2), which is why `absoluteApiUrl` and `toWebSocketUrl`
    take their origin/location as parameters.

12. **Docs.** `README.md` (deployment modes, the "What your gowa server needs"
    auth bullets, and the dev instructions all describe a field that no longer
    exists), `AGENTS.md` (anti-pattern #4 currently *mandates* the behaviour this
    ticket removes — "the base URL comes from the connection store" — and #6
    names `probeServer` by name), and `.env.example` (`VITE_DEFAULT_SERVER_URL`
    is now only the dev proxy target).

## Files to change

| File | Change | Deployment runtime? |
|---|---|---|
| `src/lib/url.ts` | `API_PREFIX`/`HEALTH_PATH`; builders lose `baseUrl`; `normalizeBaseUrl`, `sameOriginBaseUrl`, `b64encode` deleted | no |
| `src/lib/http.ts` | `baseURL = API_PREFIX`; store read and basic-auth header removed | no |
| `src/lib/api-error.ts` | `basicAuthHeader` deleted (no callers left) | no |
| `src/stores/connection.ts` | reduced to `status`; `persist` removed; bare-axios `/health` probe at 5s; legacy-key cleanup inside `boot()` | no |
| `src/pages/connect.tsx` | form replaced by a status screen with distinct unreachable / unauthorized messages | no |
| `src/lib/ws.ts` | URL from `window.location` + prefix; `authorization` removed; handshake give-up ceiling | no |
| `src/features/session/login-qr-dialog.tsx` | `rerootServerUrl` without `baseUrl` | no |
| `src/features/chat/message-media.tsx` | `rerootServerUrl` without `baseUrl` | no |
| `src/lib/curl.ts` | `CurlOptions` becomes `{ deviceId }`; auth rendering and `revealSecrets` removed | no |
| `src/components/shared/curl-dialog.tsx` | reads no credentials; renders only while open; one `toCurl` call | no |
| `src/pages/settings.tsx` | Connection card restated; no `baseUrl`, username, Disconnect, or `base_path` | no |
| `src/lib/url.test.ts` | rewritten for the new signatures; TC-6, TC-7 | no |
| `src/lib/curl.test.ts` | updated for the new options shape | no |
| `vite.config.ts` | `server.proxy` replaced with the exact map above | **YES** |
| `README.md` | deployment modes, server requirements, dev instructions, credential-rotation note | no |
| `AGENTS.md` | anti-patterns #4 and #6 restated | no |
| `.env.example` | comment restated: dev proxy target only | no |
| `_specs/z8pmx9md6x/*` | workflow artifacts | no |

**Not touched:** `package.json`, `index.html`, `.github/workflows/ci.yml`,
`.github/workflows/release.yml` (AC-14); every file under `src/api/` (they
inherit the prefix through the shared axios instance without an edit — AC-16);
and `PROJECT-GUIDE-ar.html` (see the declined findings).

## Deployment runtime guard

`vite.config.ts` is on the canonical `deployment_runtime.files` list. It is
listed here **explicitly and in advance** (AC-13, GU-2/IM-5) because the change
is not incidental: the dev proxy is the only thing that makes AC-8 true, its
prefix must match `API_PREFIX`, and its rewrite must strip that prefix or
development breaks entirely. The edit is confined to the `server.proxy` map —
plugins, `viteSingleFile`, `resolve.alias`, `loadEnv` and the build shape are
untouched, so AC-15 holds by inspection of the diff.

## Deployment requirement (C-4)

The UI cannot verify its own proxy, so the requirement goes in the README:

1. `/api/*` on the page's origin must reach the backend — via a reverse proxy
   that strips the prefix, or by running gowa with `APP_BASE_PATH=/api`.
2. `/health` on the page's origin must reach the backend root. **This is a boot
   gate**: if only `/api` is mapped, `/health` falls through to the SPA and the
   dashboard reports `unreachable` permanently even though the API works.
3. The bundle must be served **at the origin root**. `API_PREFIX` is
   root-absolute, so serving the dashboard under a sub-path (`/dashboard/`) makes
   its API calls miss. This is an accepted regression of `sameOriginBaseUrl`'s
   mount-path derivation, and it is inherent to the ticket: a constant cannot be
   mount-relative. Routing itself is unaffected — `HashRouter` keeps working at
   any mount path (`AGENTS.md` anti-pattern #3).

Deployment modes 2 and 3 in the README ("host it yourself and point it at your
server", "open the file directly") **stop being supported** by this ticket: there
is no URL to point anywhere, and `file://` has no origin to proxy from. The
README is updated to say so rather than leaving instructions that cannot work.

## Validation strategy

Profile **`ui-build`** (`project-config.yaml > validation_profiles`) — its four
required checks are `ui-typecheck`, `ui-lint`, `ui-test`, `ui-build`, and its
description names exactly this case: a change to something in the
`deployment_runtime` list. (Revision 1 named `ui-standard`, which does not
exist — the defined profiles are `ui-source` and `ui-build`.)

In addition, and specific to this ticket:

| Check | Command | Proves |
|---|---|---|
| No absolute URL in non-test `src/` | `grep -rnE "https?://[A-Za-z0-9.-]" src/ --include=*.ts --include=*.tsx \| grep -v "\.test\.ts"` | AC-3 |
| No `VITE_DEFAULT_SERVER_URL` read in `src/` | `grep -rn "VITE_DEFAULT_SERVER_URL" src/` → no match | AC-3 |
| Bundle does not name the backend | `! grep -q "$(grep VITE_DEFAULT_SERVER_URL .env.example \| cut -d= -f2)" dist/index.html` after `npm run build` | AC-4 |
| Deployment runtime guard | `git status --short` lists only `vite.config.ts` from the guarded set | AC-13, AC-14 |
| Single-file build | `dist/` contains `index.html` and nothing else | AC-15 |

Two corrections the panel forced on revision 1's own checks: the AC-3 grep must
**exclude `*.test.ts`**, because the rewritten URL tests necessarily carry
absolute origins as fixtures (`http://internal:3000`, `https://api.example.com`)
and the check would have failed on the plan's own tests; and it must match any
host, not just `localhost` or a leading numeric octet. The AC-4 check greps the
**configured** value rather than the literal `localhost:3000`, and uses
`! grep -q` — `grep -c` exits 1 on no match, so revision 1's check reported
failure precisely when it passed.

**Baseline, measured on `main` before any edit:** `npm run typecheck` clean,
`npm run lint` 4 pre-existing warnings and 0 errors, `npm test` 47/47 passing,
`npm run build` succeeds, and `dist/index.html` **does** contain
`http://localhost:3000` — from the Server URL field's placeholder. The leak this
ticket removes is measured, not assumed.

TC-1, TC-3, TC-4 and TC-5 need a running backend and a browser; they are recorded
in `verify.md` with their evidence and, where a live backend is not available,
with the static evidence that stands in for them and an explicit statement of
what that evidence does *not* prove.

## Rollback

Every change is confined to the working tree on `ticket/z8pmx9md6x`, which is cut
from clean `main` and carries no commit until `/publish-pr`. Rollback is
`git checkout main` plus deleting the branch — there is no migration, no
persisted-format change to reverse, and no backend-side change.

Two residues do not roll back, and both are intended:

- The `localStorage` key removal in step 4. Reverting the code does not restore a
  value the old bundle would simply re-prompt for.
- The credential that key held. It was stored in plaintext, and the browser's
  password manager may hold a copy the old connect form's `autoComplete` inputs
  saved. The README says to treat it as exposed and rotate it — deleting the key
  is not the same as the secret never having been readable.

## Out of scope

- **Authentication of any kind** (ticket `z8pmx9md6y`) — this plan only removes
  the credentials it can no longer store, per C-3.
- Changing `package.json`, `index.html` or the CI workflows.
- Backend or proxy configuration; the README documents the requirement rather
  than the code enforcing it.
- Any route rename, and any change to `src/api/*`.
- `PROJECT-GUIDE-ar.html` (see the declined findings).

## Panel response

Three read-only lenses reviewed revision 1 against the source. **32 findings:
10 major, 15 minor, 7 info.** 29 adopted, 3 declined with reasons, and one claim
of revision 1 corrected outright.

### The findings that changed the design

**D1 — the dev proxy rewrite would have shipped broken.** *(security-major)*
Revision 1 step 8 said to rename `/gowa` to `/api` keeping "the same rewrite".
The rewrite is `p.replace(/^\/gowa/, '')`. Under a `/api` prefix that pattern
matches nothing, so every dev request would forward to the backend as
`/api/devices` and 404 — AC-8 fails, and it fails in a guarded deployment runtime
file where a second edit is a second hard-stop. Step 10 now writes the exact
`server.proxy` map, rewrite regex included, plus the `/health` entry that carries
no rewrite. A plan that says "same X" about a value that must change is a plan
that has not looked at the value.

**D2 — the spec's central property was overstated.** *(security-major)* The user
story says the backend URL "never reaches the browser". It still does: the server
builds `qr_link` and media `file_path` as absolute URLs from its own `Host`
header, so the internal address arrives **inside the JSON response body** —
visible in devtools, in the query cache, in a HAR export — and `rerootServerUrl`
only discards it at request time. What this ticket actually achieves is narrower
and worth stating precisely: *the UI never uses, stores, or displays a backend
address, and every request it originates is same-origin.* `spec.md` gains a
**Known limits** section saying so, and the README names response-body rewriting
as the proxy's job. The alternative — claiming a property the code does not have
— is how a security control gets trusted for something it does not do.

**D3 — an unauthenticated socket that reconnects forever.** *(security-major and
performance-major, independently.)* Both lenses reached it from opposite
directions. Removing the `authorization` parameter (forced by C-3) leaves `/ws`
rejected on every handshake against a server that authenticates it — which
reference §10 says it does. `desired` stays `true`, `attempt` resets only inside
`onopen`, and `backoffDelay` caps the delay at 30s but never the count, so every
open tab hammers the proxy indefinitely; `status` stays `connected` because HTTP
still works, so nothing calls `stop()`. Step 6 adds a give-up ceiling scoped to
handshakes that **never opened**, with the failed URL recorded so a later no-op
store write cannot restart the loop. A socket that opened once and dropped still
retries forever — that case is a network blip and the existing behaviour is
right.

**D4 — the `/health` rule accepted a server that said it was unhealthy.**
*(security-major, senior-info.)* Revision 1 rejected `text/html` *regardless of
status*, to defeat an SPA fallback. But the reference's OpenAPI gives `/health` a
`503 text/plain` response, and 502/504 proxy pages are commonly `text/plain`
too — so a backend explicitly reporting itself down would have read as
`connected`. The rule is now `status === 200` **and** not `text/html`: the first
half catches the honest failure, the second catches the dishonest 200.

### Adopted without a design change (23)

| # | Lens | Finding | Response |
|---|---|---|---|
| 1 | senior-major | Profile `ui-standard` does not exist; the defined profiles are `ui-source` and `ui-build` | Corrected to `ui-build`, whose description names this exact case |
| 2 | senior-major, security-minor | The ticket alone leaves an anonymous dashboard 401ing on every guarded endpoint | Stated as an explicit ordering precondition in `spec.md` and in the PR body: this branch must not ship alone |
| 3 | senior-major | `unauthorized` status kept but has no UI — `app-shell` routes it to a network-failure page whose Retry can never clear it | Step 5 gives the status screen a distinct `unauthorized` message |
| 4 | senior-major | The AC-3 grep would fail on the plan's own rewritten tests, and its pattern missed non-numeric hosts | Grep excludes `*.test.ts` and matches any host |
| 5 | senior-major | `/health` is a boot gate but C-4 named only `/api/*` | The deployment requirement names both, and says what breaks when only `/api` is mapped |
| 6 | senior-minor | `apiPath()` would have no caller | Dropped from step 1 |
| 7 | senior-minor | Origin injected twice for one consumer | `CurlOptions` is `{ deviceId }`; only `absoluteApiUrl` takes an origin, and only for testability |
| 8 | senior-minor | `retry()` is `boot()` renamed | Removed; Retry calls `boot()` |
| 9 | senior-minor | Deleting `sameOriginBaseUrl` regresses the mount-path promise | Recorded as an accepted, documented regression with the supported mount position stated |
| 10 | senior-minor, security-minor, perf-info | `basicAuthHeader` and `b64encode` survive with no callers | Both deleted; `src/lib/api-error.ts` added to *Files to change* |
| 11 | senior-minor | `AGENTS.md` #4 mandates the behaviour this ticket removes; #6 names `probeServer` | Both restated in step 12 |
| 12 | senior-minor, security-minor | Module-level `localStorage.removeItem` is an import-time side effect that throws under Node vitest and in blocked-storage browsers | Moved inside `boot()`, guarded with `typeof` + try/catch |
| 13 | senior-info | `grep -c` exits 1 on no match — the check reported failure when it passed | Uses `! grep -q` |
| 14 | security-minor | The probe must bypass the shared axios instance or `baseURL` prefixes `/health` | Stated explicitly, with the `AGENTS.md` #6 exception updated |
| 15 | security-minor | AC-4 grepping the literal `localhost:3000` proves nothing when the configured host differs | Greps the configured value, plus asserts no `VITE_DEFAULT_SERVER_URL` reference survives |
| 16 | security-info | The plaintext password in the deleted key may also sit in the browser's password manager | README says to treat it as exposed and rotate it; the rollback note no longer calls it "not a data loss" |
| 17 | security-info | `/app/info.base_path` discloses the backend mount path | Step 9 states the Connection card does not render it |
| 18 | perf-minor | The boot probe gates first paint with an 8s worst case | Timeout cut to 5s; the serial-RTT cost is recorded rather than hidden |
| 19 | perf-minor | Retry can stall for the full timeout on every press | Button disabled while a probe is in flight |
| 20 | perf-minor | `toCurl` runs on every render of every mounted form, on a `request` rebuilt per keystroke | Step 8 renders only while the dialog is open, and calls `toCurl` once |
| 21 | perf-info | The interceptor loses a `getState()` + btoa/TextEncoder per request | Recorded as a measured benefit in `verify.md` |
| 22 | perf-info | Removing `persist` also removes a rehydration `set()` that fired an extra `sync()` per boot; `message-media` drops a store subscription per rendered media message | Recorded as benefits |
| 23 | senior-info, security-major | 503 `text/plain` reads as connected | Folded into D4 |

### Declined, with reasons (3)

- **`PROJECT-GUIDE-ar.html` left stale** *(senior-minor)*. Its "الاتصال بالخادم"
  section describes the connect flow this ticket removes. Declined for **now**:
  it is a narrative onboarding guide, not a contract any code or command reads,
  and the very next ticket (`z8pmx9md6y`) replaces the connection story again
  with the login screen. Rewriting the same section twice in two tickets is churn
  that would land in a diff nobody can review against an AC. `AGENTS.md` and
  `README.md` — which *are* read as instructions, by agents and operators — are
  both updated here. Recorded so the omission is a decision, not an oversight.
- **A 401 tears the socket down with no way back in-session** *(perf-minor)*.
  Real, and a direct consequence of C-3: `markUnauthorized()` → `sync()` →
  `stop()`, and with `connect()` gone nothing re-authorizes. Declined as a
  **code** change because the recovery path is a login screen, which is
  `z8pmx9md6y` by definition; building an interim one would be work that ticket
  deletes. Adopted as documentation: it is named in the ordering precondition.
- **`useConnection.subscribe` has no selector and fires on every `set()`**
  *(perf-info)*. No action, as the lens itself suggested: the store now holds
  only `status`, and `sync()`'s `url === this.url && this.desired` guard absorbs
  a no-op write. Noted so a future reader knows it was considered.

### What revision 1 got wrong

One claim, stated plainly. Revision 1's step 8 said the renamed dev proxy entry
keeps "the same rewrite" — a description of a value that had to change, written
without opening `vite.config.ts:22-29`. It would have produced a development
environment where every request 404s, in the one file this repository treats as a
hard-stop to edit twice. Revision 2 writes the map out in full instead of
describing it.
