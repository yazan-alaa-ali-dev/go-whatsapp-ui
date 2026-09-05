# ADR 012: The auth session is stored in JavaScript-written cookies

- **Status:** accepted
- **Date:** 2026-09-05
- **Ticket:** z8pmx9md6y
- **Deciders:** developer (owner), advisory review panel (senior / security / performance)

## Context

The backend removed basic auth entirely and replaced it with a short-lived JWT
access token plus a long-lived opaque refresh token (`docs/gowa-frontend-reference-ar.html`
§03). Ticket `z8pmx9md6x` deleted the credential the dashboard used to hold and
put nothing in its place, so the UI needs a session layer, and it needs exactly
one — if more than one module can answer "what is the current session?", the
first disagreement is an auth bug.

Where that session lives is the decision. The options a browser SPA actually
has:

- `localStorage` — what the previous bundle used for a plaintext password, and
  what the ticket explicitly forbids.
- Memory only — no session survives a reload, which makes a 15-minute access
  token unusable and a 30-day refresh token pointless.
- `HttpOnly` cookies set by a server — the strongest option, and **not available
  here**: `HttpOnly` can only be set by a server response, and this SPA is a
  static single-file bundle served by the same gowa process it calls. Getting it
  would mean introducing a Backend-for-Frontend, which is a different system,
  not a step in this ticket.
- Cookies written from JavaScript — bounded lifetime, `SameSite`, `Secure`, and
  one audited accessor, but readable by script.

The ticket requires the choice and its security limits to be recorded here.

## Decision

The session is persisted in **three cookies written from JavaScript**, through a
single adapter (`src/lib/cookies.ts`) that is the only code in `src/` permitted
to touch `document.cookie`, and owned by a single store (`src/stores/auth.ts`)
that is the only module permitted to read or write a token:

| Cookie | Holds | `Max-Age` |
|---|---|---|
| `gowa-ui.access.v1` | the access token | the `expires_in` the server returned (900s) |
| `gowa-ui.refresh.v1` | the refresh token | `2592000` (30 days, §03) |
| `gowa-ui.access_expires.v1` | the absolute expiry, epoch ms | same as the access cookie |

Every cookie carries `Path=/`, `SameSite=Strict`, and `Secure` when the page is
`https:`. `user` and `permissions[]` are **not** persisted: `GET /auth/me` is
their authority on every boot, so no stale copy can outlive a token-epoch bump.

Nothing is written to `localStorage` or `sessionStorage`, and
`src/lib/source-policy.test.ts` fails the suite if anything ever is.

## Consequences

**This does not protect against XSS, and no part of this decision claims it
does.** Without `HttpOnly`, injected script reads `document.cookie` exactly as
easily as it reads `localStorage`. What the move buys is narrower and still
real: a lifetime the browser enforces without the app's help, `SameSite=Strict`
so the credential is never attached cross-site, `Secure` so it never crosses a
plaintext hop on an https deployment, and one audited door instead of an open
key-value bag. The honest summary is *smaller blast radius, same XSS exposure*.

The costs the review panel measured, recorded rather than argued away:

- **A 30-day refresh token in a script-readable cookie means one XSS is a
  month-long account takeover**, outliving the 15-minute access token by a
  factor of 2880. Rotation and reuse-detection (§03) do not help an attacker who
  holds the live token. The 30 days is the lifetime the server issues and the
  ticket's AC-8 requires; shortening it is a product decision, not a UI one.
- **`Path=/` cannot be narrowed**, and not because an AC says so: these cookies
  are read by JavaScript, and `document.cookie` only exposes cookies whose
  `Path` is a prefix of the *document's* path. The SPA is served at the origin
  root, so a refresh cookie scoped to `/api/auth` would be invisible to the
  store that owns it — and the refresh token travels in a request **body**, not
  a `Cookie` header, so the server would never read it there either. Path
  scoping protects cookies a server consumes; it cannot help here.
- **The access token therefore travels twice on every API call** — once in the
  `Authorization` header the server reads, once in a `Cookie` header it ignores.
  With a typical HS256 JWT of ~250 bytes that is roughly **0.65 KB of request
  headers per call, of which ~0.4 KB is ignored**, uncompressed on HTTP/1.1.
- **The `GET /` document request now carries cookies too**, so an edge cache in
  front of the deployment may treat the single-file bundle — the largest
  download the app has — as uncacheable. Worth confirming against the actual
  Cloudflare Workers configuration before assuming a cache hit.
- **`Secure` follows the page's scheme and can reach no further.** A deployment
  served over plain `http:` gets cookies in clear text, and the Worker's hop to
  `GOWA_ORIGIN` is outside a cookie flag's reach entirely: **`GOWA_ORIGIN`
  should be an `https:` origin**, or both tokens cross that hop unencrypted.
- **Between the access cookie expiring and the refresh layer landing
  (`z8pmx9md70`), a reload yields an anonymous session** even though a valid
  30-day refresh token is still held. That is the intended boundary of this
  ticket, not a defect.

Reversible: the cookies are additive, and reverting the change leaves them to
expire on their own within 15 minutes or 30 days.

## Alternatives considered

- **`localStorage`** — rejected by the ticket, and rightly: it offers no
  lifetime, no `SameSite`, no `Secure`, and no single accessor. It is strictly
  worse than a cookie on every axis except convenience.
- **Memory only** — no reload survives it, so the 30-day refresh token the
  backend deliberately issues would buy nothing. Rejected.
- **`HttpOnly` cookies via a BFF** — the correct answer to XSS, and out of reach
  without a server in front of the bundle. Recorded here as the thing this
  decision is knowingly *not*, so that a future BFF ticket has a reason on file
  rather than a rediscovery.
- **`zustand/persist` with a custom cookie `StateStorage`** — would serialise
  the whole slice (including `user`) into one cookie and rehydrate
  asynchronously, leaving a window in which requests leave with no bearer
  header. Three explicit cookie reads are smaller and synchronous. Rejected.
