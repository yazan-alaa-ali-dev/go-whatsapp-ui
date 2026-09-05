---
ticket: z8pmx9md6y
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-09-05
links:
  clickup: "https://app.clickup.com/t/z8pmx9md6y"
  github: ""
---

# Specification — 2 · Build the single-source-of-truth auth session store on cookies

## Business goal

The backend removed basic auth entirely and replaced it with a JWT access token
plus an opaque refresh token (reference §03). The dashboard has no session layer
at all: ticket `z8pmx9md6x` deleted the credential it used to hold, and put
nothing in its place. Every guarded endpoint therefore answers 401 today.

This ticket builds the **one place** the session lives: a single store that owns
`access_token`, `refresh_token`, the access token's absolute expiry, and the
`user` object with its `permissions[]`, persisted through **cookies only**. Three
later tickets stand on it — the login screen (`z8pmx9md6z`), silent refresh
(`z8pmx9md70`), and the typed permissions layer (`z8pmx9md71`) — and each of them
is a different reason to reach for the session. If more than one module can
answer "what is the current session?", they will disagree, and the disagreement
will be an auth bug. Scope here is **storage and state**: no login screen, no
refresh scheduler, no permission-driven UI.

The choice of cookies over `localStorage` is deliberate and is **not** a claim of
XSS safety — see *Known limits*.

## User story

As **a System Admin**, I want the session (tokens, user, permissions) to live in
**one single source of truth** persisted in **cookies, never in localStorage**,
so that **no part of the app invents its own copy of the auth state and the
tokens are not sitting in a storage the whole page can trivially dump**.

## Functional requirements

- **REQ-1** One module (`src/stores/auth.ts`) owns the session state; every read
  of a token goes through it and every write goes through an action on it.
- **REQ-2** The owned fields are `access_token`, `refresh_token`,
  `access_token_expires_at`, `user` (`user_id`, `username`, `account_id`, `role`,
  `roles[]`, `permissions[]`, `status`), and a session `status`.
- **REQ-3** `expires_in` — seconds, and describing the access token alone
  (reference §03) — is converted to an absolute timestamp **once**, inside the
  store, at the moment the pair is stored.
- **REQ-4** A cookie adapter (`src/lib/cookies.ts`) exposes `get` / `set` /
  `remove` and is the only code in `src/` that touches `document.cookie`.
- **REQ-5** Every cookie the adapter writes carries `SameSite=Strict`, `Path=/`,
  and `Secure` when the page is `https:`.
- **REQ-6** The access-token cookie's lifetime is the token's own lifetime (the
  `expires_in` the server returned); the refresh-token cookie's is the refresh
  token's own (30 days, reference §03).
- **REQ-7** On boot, when an unexpired access token is present, `GET /auth/me` is
  called **exactly once** and its response is the authoritative source for `user`
  and `permissions[]`.
- **REQ-8** The shared axios instance attaches `Authorization: Bearer <token>`
  from the store when a token is held — the store is the only source of it.
- **REQ-9** A failed `/auth/me` leaves the session not-authenticated **without
  destroying the refresh token**; recovery is `z8pmx9md70`'s job.
- **REQ-10** A diagnostic accessor reports the session as `authenticated` /
  `anonymous` / `unknown` and whether each token is held, never their values.
- **REQ-11** The legacy `localStorage` key `gowa-ui.connection.v1` is removed on
  boot if present, and nothing is migrated out of it.

## Non-functional requirements

- **NFR-1** **No token, password, or credential is ever written to
  `localStorage` or `sessionStorage`** — enforced by an executable regression
  guard over `src/`, not by review discipline.
- **NFR-2** The auth store does not use `zustand persist` /
  `createJSONStorage(() => localStorage)` for any field.
- **NFR-3** No JWT is decoded anywhere in `src/`. `account_id`, `epoch` and `sub`
  are claims the server rebuilds per request; the UI reads them from `/auth/me`
  or not at all. The refresh token is opaque and decoding it is an error.
- **NFR-4** No full token value reaches `console` or any log line.
- **NFR-5** No deployment runtime file (`project-config.yaml >
  deployment_runtime.files`) is modified: no new dependency, no build change, no
  entry-document change. The vitest environment is therefore still the Node
  default.
- **NFR-6** The change adds no work to a render hot path: the store is read with
  selectors or via `getState()` outside React, never by subscribing a component
  to the whole store.

## Constraints

- **C-1** **There is no `HttpOnly` available.** Setting `HttpOnly` requires the
  cookie to come from a server response, and this SPA is served as a static
  bundle by the same gowa process it calls. Introducing a BFF is a different
  system, not a step in this ticket.
- **C-2** **The vitest environment is Node** (NFR-5): there is no `document`, no
  `localStorage`, no `location`. Anything unit-tested must therefore tolerate
  their absence at import time and be exercisable through a stubbed global.
- **C-3** **`GET /auth/me` needs a bearer token to answer**, so REQ-7 cannot be
  satisfied without REQ-8. The header is in scope for that reason and no other.
- **C-4** **No session can be created by this ticket.** `POST /auth/login` is
  `z8pmx9md6z`. What ships here is rehydration of a session that already exists
  in cookies, plus the store the login screen will write into.
- **C-5** After `z8pmx9md6x` every request is same-origin, so a `Path=/` cookie is
  attached to every API call as a `Cookie` header even though the server reads
  the `Authorization` header and ignores it. That is a consequence of the AC's
  required attributes, not a choice of this plan.

## Known limits

Stated plainly, because the ticket's own security note demands it:

- **A cookie written from JavaScript is not protected against XSS.** Without
  `HttpOnly` (C-1), injected script reads `document.cookie` as easily as it reads
  `localStorage`. What the move actually buys is narrower and still real: a
  bounded lifetime (the token disappears on its own), `SameSite=Strict` (no
  cross-site attachment), `Secure` on https (never on a plaintext hop), and a
  single audited accessor instead of an open key-value bag. This is an accepted
  decision, recorded as an ADR.
- **`Secure` cannot be set over plain `http:`**, so a deployment served without
  TLS gets a cookie that travels in clear text. The adapter follows the page's
  own scheme; it cannot fix the deployment.
- **The session is only as good as `/auth/me`.** Between the access cookie
  expiring (15 minutes) and the refresh layer landing (`z8pmx9md70`), a reload
  yields an anonymous session even though a valid 30-day refresh token is still
  held. That is the intended boundary, not a defect.
- **The regression guard is a source scan, not a runtime sandbox.** It fails a
  file that mentions web storage next to a credential identifier; it cannot stop
  code that computes the string `"local" + "Storage"` at runtime.

## Acceptance criteria

Numbered in the order the ClickUp ticket states them.

### Single source of truth

- **AC-1** There is one auth store (`src/stores/auth.ts`) and it is the sole
  owner of the session state. *(REQ-1)*
- **AC-2** No other module reads the tokens from storage — every read goes
  through the store. *(REQ-1, REQ-8)*
- **AC-3** No other module writes the tokens — every write goes through an action
  defined on the store. *(REQ-1)*
- **AC-4** The store owns `access_token`, `refresh_token`,
  `access_token_expires_at`, `user` (`user_id`, `username`, `account_id`, `role`,
  `roles[]`, `permissions[]`, `status`), and a session `status`. *(REQ-2)*
- **AC-5** `expires_in` (seconds) is converted once, inside the store, into an
  absolute timestamp. *(REQ-3)*

### Cookie storage

- **AC-6** Persistence is through cookies only, via a cookie adapter
  (`src/lib/cookies.ts`) exposing `get` / `set` / `remove`. *(REQ-4)*
- **AC-7** Every cookie is written with `SameSite=Strict`, `Path=/`, and `Secure`
  over `https` — with the documented exception for local `http` development.
  *(REQ-5)*
- **AC-8** The access-token cookie's lifetime is the access token's (15 minutes
  as the server reports it) and the refresh-token cookie's is its own (30 days).
  *(REQ-6)*
- **AC-9** No token, password, or credential is written to `localStorage` or
  `sessionStorage` anywhere in `src/`. *(NFR-1)*
- **AC-10** The store does not use `zustand persist` with
  `createJSONStorage(() => localStorage)` for any sensitive field. *(NFR-2)*

### Migration and cleanup

- **AC-11** On boot the legacy key `gowa-ui.connection.v1` is removed from
  `localStorage` if present. *(REQ-11)*
- **AC-12** Legacy `username` / `password` values are erased, never migrated into
  the new session — basic auth is gone from the backend. *(REQ-11)*
- **AC-13** `username` and `password` are absent from `src/stores/connection.ts`
  for good. *(REQ-11)*

### Rehydration authority

- **AC-14** On boot with a valid access token present, `GET /auth/me` is called
  exactly once and is the authoritative source for `user` and `permissions[]`.
  *(REQ-7)*
- **AC-15** No JWT claim (`account_id`, `epoch`, `sub`) is decoded in the UI and
  no decision is built on one. *(NFR-3)*
- **AC-16** The refresh token is treated as opaque; nothing attempts to decode
  it. *(NFR-3)*
- **AC-17** A 401 from `/auth/me` leaves the session not valid, and the recovery
  is deferred to the refresh layer rather than performed here. *(REQ-9)*

### Audit and observability

- **AC-18** No full token value is written to the console or to any log. *(NFR-4)*
- **AC-19** Diagnostic output reports the session state (`authenticated` /
  `anonymous`) with no token values in it. *(REQ-10)*

## Test cases

- **TC-1 — the session is stored in cookies, not localStorage.** With a session
  present, the access and refresh cookies exist with the required attributes,
  `localStorage` holds no token and no password, and `sessionStorage` holds
  nothing sensitive. *(AC-6, AC-7, AC-8, AC-9)*
- **TC-2 — legacy storage cleanup.** With `gowa-ui.connection.v1` pre-seeded
  holding a username and password, opening the app removes the key, creates no
  session from it, and leaves the user unauthenticated. *(AC-11, AC-12, AC-13)*
- **TC-3 — single source of truth.** Searching `src/` for every read and write of
  the access token shows all of them going through `src/stores/auth.ts`, and no
  `document.cookie` access outside the adapter. *(AC-1, AC-2, AC-3)*
- **TC-4 — `/auth/me` is the authority.** With a valid access token in cookies,
  boot calls `GET /auth/me` once; `user` and `permissions[]` in the store equal
  the response, and no claim is read from inside the JWT. *(AC-14, AC-15)*
- **TC-5 — unsafe storage is rejected.** A regression-guard unit test fails when
  a token is written to `localStorage` from any path other than the store, and
  states the rule in its own assertion message. *(AC-9, AC-10)*
- **TC-6 — the seconds-to-timestamp conversion.** Storing a pair with
  `expires_in: 900` yields an `access_token_expires_at` 900 seconds in the
  future, and the raw `expires_in` is not retained as a second copy. *(AC-5)*
- **TC-7 — cookie attributes.** A unit test asserts the exact attribute string
  the adapter writes, including `Secure` present under `https:` and absent under
  `http:`, and `Max-Age=0` on removal. *(AC-7, AC-8)*
- **TC-8 — a 401 does not destroy the refresh token.** With `/auth/me` answering
  401, the session is not authenticated and the refresh token is still held.
  *(AC-17)*
- **TC-9 — the diagnostic names no token.** The diagnostic accessor's output,
  serialised, contains neither token value. *(AC-18, AC-19)*

## Out of scope

- **The login screen, logout, and the route guard** — `z8pmx9md6z`. Nothing here
  creates a session; it only rehydrates and holds one.
- **Silent refresh, 401 recovery, and rotation** — `z8pmx9md70`. This ticket
  deliberately stops at "not authenticated" and leaves the refresh token intact
  for that ticket to use.
- **The typed permissions layer and permission-driven UI** — `z8pmx9md71`.
  `permissions[]` is stored here as data; nothing reads it yet.
- **The WebSocket `?access_token=` credential.** `/ws` needs the token
  (reference §10), but a socket can only be authenticated once a session can be
  created, which is `z8pmx9md6z`. Attaching it here would ship a code path no
  test in this ticket can reach.
- Any backend change, and any change to `HttpOnly` / BFF architecture (C-1).
- `PROJECT-GUIDE-ar.html`, whose connection walkthrough is rewritten by
  `z8pmx9md6z` when the login screen lands.
