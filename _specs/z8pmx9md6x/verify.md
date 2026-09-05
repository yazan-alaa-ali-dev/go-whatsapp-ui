---
ticket: z8pmx9md6x
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-09-05
links:
  clickup: "https://app.clickup.com/t/z8pmx9md6x"
  github: ""
---

# Verification — 1 · Route all API traffic through a same-origin proxy path

**Outcome: PASSED**, with two acceptance criteria carrying a stated limit
(AC-1, AC-8) and one whose scope is narrowed to what the ticket actually means
(AC-3). Nothing is recorded as proven that was not executed.

## Runtime impact statement (TR-3)

**Yes — one deployment runtime file changed: `vite.config.ts`.** It was listed
explicitly in the approved `plan.md > Files to change`, and the change is
confined to the `server.proxy` map (`git diff --stat`: 15 insertions, 4
deletions, all inside `server`). Plugins, `viteSingleFile`, `resolve.alias`,
`loadEnv` and the build shape are untouched. `package.json`, `index.html`,
`.github/workflows/ci.yml` and `.github/workflows/release.yml` are unchanged —
`git status --short` lists `vite.config.ts` alone from the guarded set.

## Baseline (measured on `main` before the first edit)

`typecheck` clean · `lint` 4 warnings / 0 errors · `test` 47 passing ·
`build` succeeds · **`dist/index.html` contains `http://localhost:3000`.**
The leak this ticket removes was measured, not assumed.

## Validation profile — `ui-build`

| Check | Command | Exit | Result |
|---|---|---|---|
| `ui-typecheck` | `npm run typecheck` | 0 | pass |
| `ui-lint` | `npm run lint` | 0 | pass — 4 warnings, 0 errors, identical to baseline |
| `ui-test` | `npm test` | 0 | pass — 9 files, 64 tests, 0 failures |
| `ui-build` | `npm run build` | 0 | pass — single `dist/index.html`, 1,011.07 kB |

No new failure, and no pre-existing failure to distinguish: the baseline suite
was fully green.

## Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| **AC-1** one module, one constant, no URL built outside it | **pass, with a stated limit** | `API_PREFIX` is declared once, in `src/lib/url.ts`, alongside every builder that consumes it (`rerootServerUrl`, `toWebSocketUrl`, `absoluteApiUrl`, `joinUrl`). `grep -rn "baseUrl\|normalizeBaseUrl\|sameOriginBaseUrl"` over `src/` → **no match**. *Limit:* enforced by where the code sits and by review, not by a lint rule — nothing mechanically prevents a future file from building its own URL. |
| **AC-2** prefix relative, no scheme/host/port | **pass** | Unit test `API_PREFIX > is relative same-origin`: starts with `/`, not `//`, `new URL(API_PREFIX)` throws, contains no `:`. |
| **AC-3** no absolute backend URL in `src/` | **pass, scope stated** | `grep -rnE "https?://[A-Za-z0-9.-]" src/ --include=*.ts --include=*.tsx \| grep -v "\.test\.ts"` → 6 hits, **all `placeholder=` strings for third-party URLs the operator types** (webhook endpoint, media URL, `chat.whatsapp.com` invite links). None is a backend address. `grep -rn "VITE_DEFAULT_SERVER_URL" src/` → **no match** (was `connect.tsx:25`). Test files legitimately carry absolute origins as fixtures and are excluded, per the correction the senior lens forced on this check. |
| **AC-4** bundle does not name the backend | **pass** | After `npm run build`: the configured value from `.env.example` (`http://localhost:3000`) is **absent** from `dist/index.html`; so is the bare `localhost:3000`. Baseline contained it, from the Server URL field's placeholder. |
| **AC-5** axios uses the fixed relative `baseURL` | **pass** | `axios.create({ baseURL: API_PREFIX, … })` in `src/lib/http.ts`; the interceptor no longer reads the store. Live: `:5173/api/devices` returned the backend's **401**, not Vite's SPA fallback. |
| **AC-6** WS URL from `window.location`, ws:/wss: mapped | **pass** | Tests `derives wss from an https page` and `derives ws from an http page`; `ws.test.ts` asserts the opened socket URL is `ws://localhost:5173/api/ws`. |
| **AC-7** `rerootServerUrl` re-roots onto the prefix | **pass** | Four tests: host discarded, `base_path` stripped, query preserved, relative input handled. `rerootServerUrl('http://0.0.0.0:3000/statics/qrcode/x.png')` → `/api/statics/qrcode/x.png`. |
| **AC-8** `npm run dev` forwards the prefix, no URL entered | **pass, browser step stated** | Live through the running dev server: `:5173/api/devices` → **401**, matching `:3000/devices` (401) and *not* `:3000/api/devices` (**404**) — the rewrite strips the prefix. `:5173/health` → `200 text/plain OK`. `:5173/` → `200 text/html` (SPA still served). *Not executed:* loading the dashboard in a browser (extension unavailable). |
| **AC-9** Server URL field removed | **pass** | `grep -rn "server-url\|Server URL" src/` → **no match**; `grep -c "server-url" dist/index.html` → **0**. `connect.tsx` renders no `<Input>`. |
| **AC-10** `baseUrl`/`username`/`password` gone, and unpersisted | **pass** | Absent from `src/stores/connection.ts`; `zustand/middleware` is no longer imported there. The only `localStorage` reference in the connection path is `removeItem('gowa-ui.connection.v1')`. Tested: `boot` *deletes the key an older bundle used*, and *survives storage being blocked*. (`device.ts` and `recipient.ts` still persist — a device id and recent recipients; no address, no credential.) |
| **AC-11** `unconfigured` removed | **pass** | `ConnectionStatus` is `booting \| connected \| unauthorized \| unreachable`. `grep -rn "unconfigured" src/` → **no match**. |
| **AC-12** `/devices` probe no longer the connection test | **pass** | `probeServer` deleted; `probeHealth` requests `HEALTH_PATH`. Tested: *asks for the health path at the root, unprefixed* asserts the argument is `/health` and does not contain `/api`. |
| **AC-13** `vite.config.ts` changed only because the plan listed it | **pass** | Listed in `plan.md > Files to change` (marked **YES**) and in the *Deployment runtime guard* section, before implementation. Diff confined to `server.proxy`. |
| **AC-14** `package.json`, `index.html`, CI unchanged | **pass** | `git status --short -- package.json index.html .github/` → **empty**. |
| **AC-15** single-file build, no new runtime server | **pass** | `ls dist/` → `index.html` only. No dependency added (`package.json` untouched). Bundle shrank by 1.88 kB. |
| **AC-16** every endpoint through the same prefix | **pass** | No file under `src/api/` was modified; all 60-odd call sites pass relative paths through the shared instance, which now carries `baseURL = /api`. The only bare-axios uses in `src/` are `probeHealth` (deliberate, AGENTS.md #6) and a type import in `api-error.ts`. |
| **AC-17** `/health` at the root, not prefixed | **pass** | Test `is distinct from the health path` (`HEALTH_PATH` does not start with `API_PREFIX`) and *asks for the health path at the root*. Live: `:5173/health` reached the backend and returned its `OK`. |
| **AC-18** unreachable message describes a network failure, asks for no URL | **pass** | `connect.tsx` renders "Can't reach the server — … Nothing here needs correcting — the connection itself failed." No input element on the page. A distinct `unauthorized` message exists so a 401 is not mislabelled as a network fault. |

**Coverage: 18 of 18 acceptance criteria mapped to an executed result**
(`all-ac`, MO-6). None deferred, none inferred.

## Test cases

| TC | Result | Note |
|---|---|---|
| TC-1 every request same-origin | **partial — HTTP-level only** | Proven at the transport layer: the dev proxy carried `/api/devices` and `/health` to the backend, and no absolute backend URL survives in `src/` or the bundle. **Not proven in a browser**: the devtools Network pass was not run. |
| TC-2 bundle does not leak the backend | **pass** | See AC-4. Baseline contained the host; the build does not. |
| TC-3 the dev proxy works | **pass** | Verified live against the running backend (AC-8 row). |
| TC-4 re-rooting a server-built URL | **pass** | Unit-tested (AC-7 row). A real `qr_link` was not fetched — pairing a device was out of reach here. |
| TC-5 network failure does not ask for a URL | **partial** | The screen has no input and no connection value is written (AC-9, AC-10, AC-18, all statically verified). **Not proven in a browser**: the rendered screen was not observed with the backend down. |
| TC-6 the prefix constant is relative | **pass** | Unit test. |
| TC-7 health is not prefixed | **pass** | Two unit tests plus the live `:5173/health` result. |
| TC-8 the legacy persisted key is gone | **pass** | Unit-tested with a stubbed `localStorage`, including the storage-blocked path. |
| TC-9 deployment runtime guard holds | **pass** | See AC-13, AC-14. |

## What a green result here does not prove

Stated plainly, because the gaps are the useful part:

- **No browser ran this build.** The Chrome extension was unavailable, so TC-1
  and TC-5 rest on HTTP-level and static evidence. What is unverified is the
  rendering, not the routing: the routing was exercised end-to-end against the
  real server.
- **The dashboard does not work end-to-end on this branch, by design.** The live
  backend returns **401** on `/devices` and on the `/ws` upgrade, because this
  ticket removes the only credential the client had and the replacement is
  `z8pmx9md6y`. `spec.md > C-5` states this as an ordering precondition: the
  branch must not ship alone. `/health` is public, so `boot()` still reports
  `connected` and the 401s then route to the `unauthorized` screen — the
  interim behaviour the plan describes, observed rather than assumed.
- **The backend still names itself in response bodies** (`qr_link`,
  `file_path`). `spec.md > Known limits` and the README say so. This ticket makes
  the UI stop *using* the address; it cannot make the server stop *sending* it.
- **AC-1 is a review property, not an enforced one.** No lint rule stops a future
  file from building its own URL.
- **`/health` liveness is not API liveness.** A proxy mapping `/health` but not
  `/api` would boot the dashboard into a working shell whose every call fails.
  The README names both requirements for exactly this reason.

## Panel findings — disposition

All 32 advisory findings were answered in `plan.md > Panel response` before any
code was written: **29 adopted, 3 declined with reasons.** Four changed the
design, and one of those (the dev-proxy rewrite regex) was a defect that would
have shipped a development environment where every request 404s. The panel is
advisory (RP-2) — it informed this result and did not decide it.
