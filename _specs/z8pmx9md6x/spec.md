---
ticket: z8pmx9md6x
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-09-05
links:
  clickup: "https://app.clickup.com/t/z8pmx9md6x"
  github: ""
---

# Specification — 1 · Route all API traffic through a same-origin proxy path

## Business goal

Today the dashboard asks the operator to type a **Server URL**, persists it in
`localStorage` under `gowa-ui.connection.v1`, and feeds it into `axios baseURL`.
The backend address therefore lives in the browser: readable in devtools, in the
persisted store, and in every request line. Anyone who can open the dashboard
learns where the API actually is, and can then talk to it directly — outside the
proxy, and outside whatever that proxy enforces.

This ticket removes that for good. All HTTP and WebSocket traffic leaves through
a single **relative same-origin prefix**; the reverse proxy — or gowa itself when
it serves this bundle — becomes the only party that knows the real address. The
scope is **transport only**: nothing here changes what authenticates a request,
which is ticket `z8pmx9md6y`.

## User story

As **a System Admin**, I want the dashboard to talk to the backend **only through
a same-origin proxy path**, so that **the real backend URL never reaches the
browser and cannot be read, scraped, or abused from the client bundle**.

## Functional requirements

- **REQ-1** One module owns the API prefix, exports it as one constant, and is
  the only place a request URL is built.
- **REQ-2** The prefix is relative and same-origin: no scheme, no host, no port.
- **REQ-3** The shared axios instance takes its `baseURL` from that constant,
  not from a value read out of a store.
- **REQ-4** The WebSocket URL is derived from `window.location` — scheme mapped
  `http:` to `ws:` and `https:` to `wss:` — and from the same prefix.
- **REQ-5** Absolute URLs the server returns (`qr_link`, media `file_path`) are
  re-rooted onto the same-origin prefix, because the server builds them from its
  own `Host` header and they are wrong behind a proxy.
- **REQ-6** `GET /health` is requested at the server **root**, never under the
  prefix, because it is registered outside `APP_BASE_PATH` (reference §02).
- **REQ-7** The Server URL field, and the whole notion of a user-supplied
  backend address, are gone from the UI.
- **REQ-8** `baseUrl`, `username` and `password` are gone from the connection
  store and from anything persisted to `localStorage`.
- **REQ-9** The `unconfigured` status is gone; connection state describes only
  whether the backend answered, never whether it was configured.
- **REQ-10** The unreachable-backend message describes a **network failure** and
  never asks the operator to correct a URL.
- **REQ-11** `npm run dev` still works with no operator input: the dev proxy
  forwards the prefix (and `/health`) to the backend.

## Non-functional requirements

- **NFR-1** **No absolute backend URL survives in `src/`** — not as a literal,
  not as an inlined build-time value. Verified by search, not by reading.
- **NFR-2** **The shipped bundle does not name the backend.** A text search of
  `dist/index.html` for the backend host and port returns nothing.
- **NFR-3** The build shape is unchanged: still one `vite-plugin-singlefile`
  bundle served by the backend. No new runtime server, no new dependency.
- **NFR-4** `vite.config.ts` is a **deployment runtime file**
  (`project-config.yaml > deployment_runtime.files`). It is touched **only**
  because this plan lists it explicitly; `package.json`, `index.html` and the CI
  workflows are not touched at all.
- **NFR-5** Nothing in this change reads or writes credentials. The
  authentication swap is ticket `z8pmx9md6y`.

## Constraints

- **C-1** The prefix must be a real path segment, not the empty string: REQ-6
  distinguishes "under the prefix" from "at the root", which the empty string
  cannot express.
- **C-2** The vitest environment is the Node default — there is no `jsdom`, and
  adding one would edit `package.json` (forbidden by NFR-4). Any URL builder
  that must be unit-tested therefore has to accept its `location` rather than
  reach for a global.
- **C-3** Removing `username`/`password` (REQ-8) necessarily removes the basic
  auth the axios interceptor, the cURL preview and the WebSocket query currently
  attach. That is a **consequence of the ticket, not a decision of this plan**;
  the replacement (Bearer plus silent refresh) is ticket `z8pmx9md6y`.
- **C-4** Deployments must map **both** `/api/*` and `/health` on the page's
  origin to the backend, and must serve the bundle **at the origin root**. This
  is stated in the README rather than enforced in code — the UI cannot verify its
  own proxy. `/health` in particular is a boot gate: map only `/api` and the
  dashboard reports `unreachable` forever while the API works fine.
- **C-5** **Ordering precondition — this ticket must not ship alone.** It removes
  the only credential the client has, and the replacement (Bearer plus silent
  refresh) is ticket `z8pmx9md6y`. Against any server that authenticates its
  endpoints — which reference §03 says the current backend does — the branch on
  its own yields a dashboard whose every guarded call returns 401, with no
  in-session way back: the 401 interceptor sets `unauthorized`, and the form that
  used to clear it is gone. The branch is therefore held unmerged until
  `z8pmx9md6y` lands beside it.

## Known limits

What this change achieves is narrower than "the backend URL never reaches the
browser", and the difference matters:

- **The server still names itself in response bodies.** `qr_link` and media
  `file_path` are built by the server from its own `Host` header, so the internal
  address arrives inside the JSON — readable in devtools, in the query cache, in
  a HAR export. `rerootServerUrl` (AC-7) discards it at request time, which is
  all a browser client can do. Stripping it from the payload is the reverse
  proxy's job, and the README says so.
- **The property that does hold** is: the UI never uses, stores, or displays a
  backend address, and every request it originates is same-origin. That is what
  AC-1 through AC-8 and AC-16 are verified against.
- **`/app/info` still reports `base_path`.** The UI does not render it (see the
  Connection card), but the value is in the response.

## Acceptance criteria

Numbered in the order the ClickUp ticket states them.

### Scope and isolation

- **AC-1** There is one single source for the API prefix — one module exporting
  one constant — and no request URL is built outside it. *(REQ-1)*
- **AC-2** The prefix is relative same-origin and contains no scheme, no host
  and no port. *(REQ-2)*
- **AC-3** No absolute backend URL remains written in any file under `src/`.
  *(NFR-1)*
- **AC-4** A text search of `dist/index.html` for the backend host returns no
  match. *(NFR-2)*

### General behaviour

- **AC-5** The shared axios instance in `src/lib/http.ts` uses the fixed relative
  `baseURL` instead of a value coming from the store. *(REQ-3)*
- **AC-6** The WebSocket URL is derived from `window.location` (`ws:` with
  `http:`, `wss:` with `https:`) and not from a stored value. *(REQ-4)*
- **AC-7** `rerootServerUrl` re-roots any absolute URL returned by the server
  onto the same-origin prefix. *(REQ-5)*
- **AC-8** `npm run dev` forwards the prefix to the backend through the existing
  vite dev proxy, with no URL entered by the operator. *(REQ-11)*

### Removed surface

- **AC-9** The Server URL field is removed from the connection UI. *(REQ-7)*
- **AC-10** `baseUrl`, `username` and `password` are removed from
  `src/stores/connection.ts` and from any persisted state. *(REQ-8)*
- **AC-11** The `unconfigured` status is removed. *(REQ-9)*
- **AC-12** The probe against `/devices` is no longer used as a connection test.
  *(REQ-6, REQ-9)*

### Deployment runtime guard

- **AC-13** `vite.config.ts` is modified only because this plan lists it
  explicitly in *Files to change*. *(NFR-4)*
- **AC-14** `package.json`, `index.html` and the CI workflows are unchanged.
  *(NFR-4)*
- **AC-15** The build stays a single-file bundle served by the backend; no new
  runtime server is introduced. *(NFR-3)*

### UI and API consistency

- **AC-16** Every endpoint (`/auth/*`, `/chats`, `/devices`, `/message/*`, and
  the rest) is requested through the same prefix without exception. *(REQ-1,
  REQ-3)*
- **AC-17** `GET /health` is requested at the root path, not through the prefix.
  *(REQ-6)*
- **AC-18** The message shown when the backend is unreachable describes a network
  failure and does not ask the operator to correct a URL. *(REQ-10)*

## Test cases

- **TC-1 — every request leaves same-origin.** Navigate the running dashboard
  with the Network tab open: every request, and the WebSocket handshake, shows
  the page's own origin. No request goes to another host or port. *(AC-2, AC-5,
  AC-6, AC-16)*
- **TC-2 — the bundle does not leak the backend address.** After `npm run build`,
  search `dist/index.html` for the backend host and port, and for any value left
  over from `VITE_DEFAULT_SERVER_URL`. No match. *(AC-3, AC-4)*
- **TC-3 — the dev proxy works.** `npm run dev` against a running backend: the UI
  loads and issues working requests with no URL entered anywhere. *(AC-8, AC-9)*
- **TC-4 — re-rooting an absolute URL from the server.** Given a `qr_link` built
  from a wrong `Host` header, the QR image is requested through the same-origin
  prefix and the returned host is not used. *(AC-7)*
- **TC-5 — a network failure does not ask for a URL.** With the backend down
  behind the proxy, opening the UI shows a clear connection-failure message, no
  Server URL input, and writes no connection value to `localStorage`. *(AC-10,
  AC-11, AC-18)*
- **TC-6 — the prefix constant is relative.** A unit test asserts the exported
  constant starts with `/` and parses with no scheme, host or port. *(AC-2)*
- **TC-7 — health is not prefixed.** A unit test shows the health request path is
  the root path, distinct from the prefixed path. *(AC-17)*
- **TC-8 — the legacy persisted key is gone.** With `gowa-ui.connection.v1`
  pre-seeded in `localStorage`, loading the app leaves it absent. *(AC-10)*
- **TC-9 — the deployment runtime guard holds.** `git diff --stat` on the branch
  shows `vite.config.ts` as the only deployment runtime file touched. *(AC-13,
  AC-14, AC-15)*

## Out of scope

- **Authentication.** No login screen, no Bearer token, no refresh rotation, no
  `/auth/*` call. Ticket `z8pmx9md6y` owns all of it. This ticket only *stops*
  sending the basic-auth credentials it can no longer store (C-3).
- Permission-driven UI (`permissions[]` from `/auth/me`), redaction handling,
  device-scoping changes, and every other item in reference §11.
- Any change to the backend, its `APP_BASE_PATH`, or its proxy configuration.
- Renaming or restructuring routes beyond what removing the Server URL forces.
- Response-body URL rewriting (the proxy's job — see *Known limits*).
- `PROJECT-GUIDE-ar.html`: its connection walkthrough goes stale here and is
  rewritten again by `z8pmx9md6y`. Updating it twice is churn; `AGENTS.md` and
  `README.md`, which are read as instructions, are updated in this ticket.
