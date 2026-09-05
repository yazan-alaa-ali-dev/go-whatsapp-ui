---
ticket: z8pmx9md6x
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-09-05
links:
  clickup: "https://app.clickup.com/t/z8pmx9md6x"
  github: ""
---

# Implementation — 1 · Route all API traffic through a same-origin proxy path

Applied on branch `ticket/z8pmx9md6x`, cut from clean `main` at `6bee49e`.
No commit is created here; the single publishable commit is `/publish-pr`'s job.

## Files changed

**17 modified, 2 added.** One deployment runtime file (`vite.config.ts`), listed
in the approved plan.

| File | What changed |
|---|---|
| `src/lib/url.ts` | Now owns `API_PREFIX = '/api'` and `HEALTH_PATH = '/health'`. `rerootServerUrl` and `toWebSocketUrl` lost their `baseUrl` parameter; `absoluteApiUrl` added for the cURL preview. `normalizeBaseUrl`, `sameOriginBaseUrl` and `b64encode` deleted. |
| `src/lib/http.ts` | `axios.create({ baseURL: API_PREFIX })`. The request interceptor no longer reads the store or attaches an `Authorization` header — only the device header remains. |
| `src/lib/api-error.ts` | `basicAuthHeader` deleted (all three callers gone). |
| `src/stores/connection.ts` | Rewritten: `status` only, no `persist`, no `baseUrl`/`username`/`password`, no `connect`/`disconnect`, no `unconfigured`. `probeHealth` replaces `probeServer`. Legacy key cleared inside `boot()`. |
| `src/pages/connect.tsx` | Form replaced by a status screen with distinct `unreachable` / `unauthorized` messages and a Retry that calls `boot()`. |
| `src/lib/ws.ts` | URL from `window.location` + prefix, no `authorization` param, plus the handshake give-up ceiling (`MAX_HANDSHAKE_ATTEMPTS`, `everOpened`, `abandonedUrl`). |
| `src/features/session/login-qr-dialog.tsx` | `rerootServerUrl(qr.qr_link, base_path)`; the `!baseUrl` guard removed. |
| `src/features/chat/message-media.tsx` | `rerootServerUrl(file_path, base_path)`; store subscription dropped. |
| `src/lib/curl.ts` | `CurlOptions` is `{ deviceId, origin? }`; `-u`, `revealSecrets` and the mask removed. |
| `src/components/shared/curl-dialog.tsx` | Reads no credentials; builds the command only while open; one `toCurl` call. |
| `src/pages/settings.tsx` | Connection card restated (API path + origin); no `baseUrl`, username, Disconnect, or `base_path`. |
| `src/lib/url.test.ts` | Rewritten for the new signatures; adds TC-6 and TC-7. |
| `src/lib/curl.test.ts` | Rewritten for the new options shape; the auth-rendering tests deleted with the feature. |
| `vite.config.ts` | **Deployment runtime.** `server.proxy` replaced: `/api` with the corrected `/^\/api/` rewrite, `/health` with none. Nothing else in the file touched. |
| `README.md` | Deployment shape, "What your deployment needs", dev instructions, credential-rotation warning. |
| `AGENTS.md` | Anti-patterns #4 and #6 restated. |
| `.env.example` | Restated as the dev proxy target only. |
| `src/stores/connection.test.ts` | **Added** — the probe rule. |
| `src/lib/ws.test.ts` | **Added** — the give-up ceiling. |

## Deviations from the plan

1. **Two test files added beyond the plan's list.** The plan's step 11 named only
   `url.test.ts` and `curl.test.ts`. `src/stores/connection.test.ts` (11 tests)
   and `src/lib/ws.test.ts` (6 tests) were added because they cover the two
   pieces of logic the panel rated **major** — the `/health` acceptance rule and
   the WebSocket give-up ceiling. Both are new behaviour, invisible to the
   existing suite, and both were mutation-tested (below). Shipping the riskiest
   logic in the change with no test that can fail was the alternative.

2. **`CurlOptions` kept an optional `origin`.** The plan said `{ deviceId }`,
   after the senior lens objected to injecting the origin twice. It is injected
   **once**: `absoluteApiUrl` defaults to `window.location.origin`, and
   `CurlOptions.origin` is optional and unset by the dialog — it exists only so
   `curl.test.ts` can run in the Node environment (C-2), which the lens's
   preferred shape would have made impossible.

3. **`FakeSocket` in `ws.test.ts` declares its `url` field explicitly** rather
   than as a constructor parameter property. `erasableSyntaxOnly` in
   `tsconfig.app.json` rejects parameter properties. Worth recording because
   **vitest passed and `tsc -b` failed** — esbuild strips the syntax, the
   type-checker refuses it. The full profile caught what the test run did not.

4. **`.env.example` was rewritten rather than edited.** Both of its comment lines
   described the removed connect screen.

No other deviation. No file outside the plan's list was modified, and no
deployment runtime file other than `vite.config.ts` was touched.

## Validation run

Profile `ui-build` — all four checks, from the repository root.

| Check | Command | Result |
|---|---|---|
| `ui-typecheck` | `npm run typecheck` | **pass**, exit 0, no output |
| `ui-lint` | `npm run lint` | **pass**, exit 0 — 4 warnings, 0 errors; identical to the `main` baseline |
| `ui-test` | `npm test` | **pass** — 9 files, **64 tests**, 0 failures (baseline: 7 files, 47 tests) |
| `ui-build` | `npm run build` | **pass** — `dist/index.html`, 1,011.07 kB (baseline 1,012.95 kB), single file |

### Mutation testing

A green suite proves nothing about a guard that was never exercised, and two of
these guards exist only because a lens found their absence. Each was removed,
the suite re-run, and the guard restored:

| Mutation | Expected to break | Result |
|---|---|---|
| Delete the `MAX_HANDSHAKE_ATTEMPTS` branch in `scheduleReconnect` | the give-up test | **caught** — `gives up instead of reconnecting for the life of the tab` failed |
| Delete `if (url === this.abandonedUrl) return` in `sync()` | the restart test | **caught** — `is not restarted by a later no-op store write` failed |
| Restore revision 1's probe rule (reject `text/html` regardless of status) | the 503 and gateway tests | **caught** — 2 failures, exactly the case the security lens predicted |
| Drop the `text/html` check, keep only `status === 200` | the SPA-fallback test | **caught** — `rejects a 200 that is html` failed |

Every mutation was reverted and the suite re-verified green before proceeding.

### Live verification against the real backend

A gowa server is running on `localhost:3000`. (It is masked from `curl` by a
local squid proxy on the same port — every request needed `--noproxy '*'`, and
the first attempt without it produced squid's own 403 for *every* path,
including the SPA. That false signal is recorded because it would otherwise look
like evidence.)

With the dev server running (`npm run dev`):

| Request | Result | What it proves |
|---|---|---|
| `:3000/health` directly | `200`, `text/plain`, body **`OK`** | The decision **not** to require JSON was right — a JSON rule would have called this healthy server dead |
| `:3000/api/devices` directly | **404** | The unstripped path — precisely what revision 1's rewrite would have sent |
| `:3000/devices` directly | **401** | The stripped path the backend actually serves |
| `:5173/api/devices` via the dev proxy | **401** | It matches the stripped path, not the 404 — **the rewrite is correct**, and revision 1's bug was real and would have broken every dev request |
| `:5173/health` via the dev proxy | `200 text/plain`, `OK` | The `/health` entry reaches the backend root, not Vite's SPA fallback (AC-8, AC-17) |
| `:5173/` | `200 text/html` | The SPA is still served; only the two prefixes are proxied |
| `:5173/api/ws` upgrade attempt | **401** | The WebSocket handshake is refused now the credential is gone — **D3 confirmed live**. This is the exact loop the ceiling now stops, and the exact reason C-5 says the ticket must not ship alone |

A browser pass (devtools Network, `localStorage` inspection) was **not** run: the
Chrome extension is not connected in this environment. What that leaves unproven
is stated in `verify.md` rather than papered over.
