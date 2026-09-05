---
ticket: z8pmx9m6af
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-08-31
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6af"
  github: ""
---

# Plan — 23 · Login and tokens (revision 2)

> Revision 1 was reviewed by the advisory panel (senior / security / performance)
> **against the source**, before any code was written. 47 findings. This revision
> is what gets implemented. Every finding is answered under *Panel response*.
>
> **Three findings were reached independently by two lenses each**, and two of
> them would have shipped a feature that passes its own test while doing nothing.

## Approach

A **leaf** token package, a **usecase** service that orchestrates over the
repository, a thin REST handler, one `app.Use` line, and one sweeper worker.

The layering is the rule ticket 22's panel established and this ticket must not
break: `pkg/auth` imports nothing from this repository, because ticket 24 wires a
permission constant into every handler package and a leaf cannot be one half of
an import cycle. The ClickUp plan puts `service.go` in `pkg/auth`; that would
give `pkg/auth` an `IChatStorageRepository` dependency and reintroduce exactly
the placement ticket 22 rejected (`usecase/identity.go:15-25`). **Deviation D-1.**

Enforcement is deliberately deferred. `Authenticate` identifies; it never denies.
Basic auth remains the only enforcer at every commit of this ticket.

### Layer map

```
pkg/auth/            LEAF — no repository, no fiber, no config
  perm.go            (ticket 22) the catalogue
  password.go        (ticket 22) bcrypt + the timing countermeasure
  token.go           NEW: HS256 sign/verify, claims, secret validation
  refresh.go         NEW: 32-byte CSPRNG token + sha256 digest
  principal.go       NEW: Principal, the immutable cache, the pure builder
  throttle.go        NEW: the process-wide bcrypt semaphore

domains/auth/        NEW: DTOs + the interface ui/rest is allowed to reach
domains/chatstorage/ +RefreshToken, +IdentitySnapshot, +7 interface methods
infrastructure/chatstorage/
  refresh_token_repository.go  NEW: 5 refresh statements + user read + snapshot
  refresh_token_retention.go   NEW: the sweeper
usecase/auth.go      NEW: Login / Refresh / Logout / Me / Verify + cache reload
ui/rest/auth.go      NEW: the four endpoints + the two limiters
ui/rest/middleware/authenticate.go  NEW: bearer -> Principal, permissive
cmd/rest.go          the app.Use line, the apiGroup move, the sweeper
config/settings.go   the non-secret auth settings
docs/openapi.yaml    the four paths
```

## Design decisions

### 1 · The token (AC-1, AC-5)

`pkg/auth/token.go` holds a `TokenService` built from a secret, an issuer and an
access TTL. **The constructor returns `(nil, error)` on an invalid secret**, so a
verifier keyed on an empty string cannot exist anywhere in the process
(panel: security 6).

- **Sign**: `jwt.NewWithClaims(jwt.SigningMethodHS256, claims)`.
- **Verify**: `jwt.ParseWithClaims(raw, &claims, keyFunc,
  jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(iss),
  jwt.WithExpirationRequired(), jwt.WithIssuedAt(),
  jwt.WithLeeway(30*time.Second))`.

`WithValidMethods` is what makes `alg: none` and the RS256-key-confusion attack
both impossible; the `keyFunc` **additionally** re-checks the method, because a
key function that hands back an HMAC secret for any algorithm is the second half
of that attack and a future refactor could drop the parser option without a test
noticing.

`Verify` then **rejects an empty `sub` explicitly**. jwt/v5 does not validate
`sub` at all, so without this a token with no subject parses cleanly, misses the
principal cache and proceeds as anonymous — which is harmless today and becomes a
denial bypass the moment ticket 24 builds refusal on that lookup
(panel: security 12).

Claims embed `jwt.RegisteredClaims` (`sub`, `iat`, `exp`, `iss`, `jti`) and add
`role`, `account_id`, `epoch`. Eight claims, exactly AC-5's list. `jti` is
`fiberUtils.UUID()` — the generator device and user ids already use. It has no
reader in this ticket; it is the handle a future access-token denylist needs, and
omitting it now would mean re-issuing every outstanding token later to get it.

### 2 · The refresh token (AC-6)

`pkg/auth/refresh.go`:

- `NewRefreshToken() (raw, digest string, err error)` — 32 bytes from
  `crypto/rand`, base64url (unpadded) on the wire, `sha256` hex in the column.
- `HashRefreshToken(raw string) string` — the same digest, for the lookup.

Not a JWT, deliberately: a refresh token must be **revocable**, and revocation
needs a row, not a signature. `crypto/rand.Read` errors are returned, never
ignored — a silently zero token would be a fixed, guessable credential.

The column is `VARCHAR(64)`, exactly 64 hex characters of SHA-256; the width is
the specification of the algorithm (migration 69).

### 3 · The principal cache (AC-11, AC-12)

`pkg/auth/principal.go`:

```go
type Principal struct {
    UserID, Username, Role, AccountID string
    Roles, Permissions []string
    Status     string
    TokenEpoch int
}
type PrincipalCache struct { v atomic.Pointer[map[string]*Principal] }
```

- **Immutable snapshot swapped atomically.** `Load` reads the pointer and returns
  a `*Principal` that is never mutated in place. That is what makes the read
  lock-free and allows a reload to run concurrently with traffic without an
  `RWMutex` on the hot path.
- **Built from plain data**, so the cache stays in the leaf:
  `BuildPrincipals(snapshot IdentitySnapshot) map[string]*Principal` takes three
  slices and returns the map. Reading those slices is a repository call and lives
  in `usecase`.
- **Permissions are the union of every role the user holds**, deduplicated and
  sorted. The `role` claim is the *primary* role — `admin` when held, otherwise
  the alphabetically first — and is informational only, because ticket 24 reads
  `Permissions`, never `Role`.

**Reload triggers: exactly two.** Once at service construction, and explicitly
via `Service.ReloadPrincipals()`, which ticket 26 calls after every write to
`users`, `user_roles` or `role_permissions`.

**The 30-second background ticker of revision 1 is removed** (panel: senior 8,
performance 3, security 6 — three lenses, three different reasons). It was
invented; no AC asks for it. It contradicts this repo's own precedent against
tunable intervals (`debug_retention.go:14-18`). Its stated justification —
multi-replica write invisibility — describes a deployment this repo does not
support, because every process auto-connects **every** device at boot
(`helpers.SetAutoConnectAfterBooting`), so two replicas against one store fight
over the same whatsmeow sessions. And at 30s it was 8,640 round trips per day per
process against a remote Supabase, forever, for a table of tens of rows.

**The staleness this leaves is stated rather than hidden.** This ticket ships no
endpoint that writes `users`, `user_roles` or `role_permissions` — ticket 26 owns
those and owns calling `ReloadPrincipals()`. So within a process the cache can
only go stale via an out-of-band database edit. And the path that *mints* new
credentials never trusts the cache: refresh reads the user row authoritatively
(§4 step 4). AC-12's "immediately" is therefore exact for refresh and exact for
verify in the process that made the change.

### 4 · Rotation and re-use detection (AC-6, AC-7, AC-8)

Repository methods (`refresh_token_repository.go`):

| Method | Statement |
|---|---|
| `CreateRefreshToken(*RefreshToken, tokenHash string) error` | INSERT — the digest is a **separate argument**, never a field on the struct (panel: senior 6; the rule `CreateUser` set at `user_repository.go:265-268`) |
| `GetRefreshTokenByHash(hash) (*RefreshToken, error)` | `sql.ErrNoRows` when unknown |
| `ClaimRefreshToken(hash, now) (bool, error)` | `UPDATE ... SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL AND expires_at > ?`, reporting `RowsAffected() > 0` |
| `RevokeRefreshTokenFamily(familyID, now) (int64, error)` | `UPDATE ... SET revoked_at=? WHERE family_id=? AND revoked_at IS NULL` |
| `DeleteExpiredRefreshTokens(ctx, cutoff, revokedCutoff, limit) (int64, error)` | the sweep, §7 |
| `GetUserByUserID(userID) (*User, error)` | **the method revision 1 was missing** |
| `LoadIdentitySnapshot() (IdentitySnapshot, error)` | the three cache reads, in one transaction |

`GetUserByUserID` is the finding two lenses reached independently (senior 4,
performance 4): revision 1's step 4 said "load the user from the database" while
the only user read in existence is `GetUserByUsername`
(`user_repository.go:335`) and `refresh_tokens` carries only `user_id`. It
deliberately **omits `password_hash` from its SELECT list** — unlike
`GetUserByUsername`, which pulls the hash into memory on a path that has no use
for it.

`CountActiveRefreshTokens` is **dropped**: it was test-only surface, and every
interface method costs a delegation in `chatstorage_wrapper.go`. Ticket 22 is
explicit that it shipped "SIX methods, not sixteen" for this reason
(`user_repository.go:17-20`). The tests query `r.db` directly, in-package.

**The algorithm — claim first.**

1. `ClaimRefreshToken` — the **single conditional UPDATE** is the whole
   concurrency control, and it comes first. It returns true for exactly one of
   two racing callers. (Revision 1 read the row first; that read decided nothing
   and cost a round trip on the success path — panel: performance 5. Success is
   now 3 remote round trips instead of 4.)
2. `claimed == true` → `GetUserByUserID`; reject unless `status == active` and
   `token_epoch == claims.epoch`, revoking the family if not. Then issue a new
   access token and a new refresh token **in the same `family_id`**.
3. `claimed == false` → read the row to find out why.
   - `sql.ErrNoRows` — unknown hash, or the sweeper removed it between the two
     statements. **Plain 401, no family action** (panel: security 10a; revision 1
     left this branch undefined and it would have surfaced as a 500).
   - expired but never revoked → plain 401, family untouched. An expired token is
     not evidence of theft.
   - `revoked_at IS NOT NULL` **and** `now - revoked_at > reuseGraceWindow` →
     **re-use**: `RevokeRefreshTokenFamily`, then 401.
   - `revoked_at IS NOT NULL` within the grace window → 401, **family untouched**.

The **grace window (10s)** is panel finding performance 6, and it is not a
softening. Without it, two parallel XHRs from one legitimate browser produce one
winner and one loser; the loser sees `revoked_at IS NOT NULL` and revokes the
whole family, logging the user out of every tab and forcing a fresh bcrypt login.
A benign race and a theft are indistinguishable by timestamp alone, but they are
very distinguishable by *interval*: a thief replaying a captured token is not
doing it 10 seconds after the victim rotated it, in the same second, by accident.

4. If `CreateRefreshToken` fails after a successful claim, the caller has been
   silently logged out. That is a 500, with a `warn` log carrying **`family_id`
   only** — never the raw token or its digest (panel: security 10b).

### 5 · The endpoints (AC-3, AC-4, AC-9, AC-13)

`ui/rest/auth.go`, mounted on `apiGroup.Group("/auth")` **after**
`app.Use(Authenticate)` and **before** the basic-auth block.

| Route | Body | Success |
|---|---|---|
| `POST /auth/login` | `{username, password}` | 200 |
| `POST /auth/refresh` | `{refresh_token}` | 200, the rotated pair |
| `POST /auth/logout` | `{refresh_token}` | 200, family revoked |
| `GET /auth/me` | — | 200, principal + effective permissions |

- **The envelope is `utils.ResponseData{Status, Code, Message, Results}`**, with
  the four login fields inside `Results` (panel: senior 10). Every handler in
  this repo answers that shape and `docs/openapi.yaml` assumes it; a bare body
  here would be the only exception in the codebase.
- **One generic failure** for every login rejection: `401
  AUTH_INVALID_CREDENTIALS`, one fixed message, from a single sentinel the
  handler cannot see past.
- **Request validation runs before any lookup.** `username` and `password` must
  be non-empty. This is not hygiene — it closes a live enumeration oracle
  (panel: security 7): `pkg/auth/password.go:82-84` returns false **without
  calling bcrypt** when `plain == ""`, so `{"username":"admin","password":""}`
  returns in microseconds for an existing user while an unknown user pays the
  full ~300ms `DummyVerifyPassword`. The cheapest possible probe defeats AC-4
  outright. Rejecting an empty password at the DTO boundary makes the
  short-circuit unreachable from a request.
- **The timing countermeasure**: the "no such user" branch calls
  `auth.DummyVerifyPassword()`. "Not resolvable" is **one branch** — a nil user
  *or* a blank-input error from the repository — because
  `GetUserByUsername` returns `fmt.Errorf("username is required")`, not
  `sql.ErrNoRows`, for a username that normalises to empty
  (`user_repository.go:336-339`), and revision 1's "single sentinel" claim was
  false for that input (panel: security 8). Only a genuine transport failure
  escapes as non-401.
- **Login checks `status == active`**, after the bcrypt comparison completes so
  it is not a new oracle, returning the same generic sentinel (panel: security 4).
  Revision 1 let a disabled user obtain a live token pair and a persisted refresh
  family; only the middleware would have rejected it, while the refresh row
  stayed real. **AC-12 is amended to name login.**
- **The response user is a DTO** (`domains/auth.UserView`), not
  `domainChatStorage.User`. The domain type carries `json:"-"` on the hash, but a
  tag is one keystroke from deletion; a struct with no such field cannot regress.
- **`authError(c, err)`**, an explicit mapper in the shape of `accountError`
  (`ui/rest/account.go:75-81`), never `utils.PanicIfNeeded`. `middleware/recovery.go:21`
  renders a non-`GenericError` as `fmt.Sprintf("%v", err)`, so a driver error on
  the refresh path would put SQL, schema **and the bound `token_hash`** into a 500
  body (panel: security 9).
- `GET /auth/me` answers 401 without a principal — the endpoint's own
  precondition, not policy enforcement, which remains ticket 24's.

**Rate limiting (AC-13) — three corrections.**

1. **The limiter is the FIRST handler**, not a trailing one:
   `grp.Post("/login", loginLimiter, h.Login)`. Two lenses caught this
   independently (security 2, senior 1) and I verified it: `app.Add` builds the
   chain as `append([]any{handler}, handlers...)` (`fiber/v3@v3.4.0/app.go:1095-1097`),
   so handlers run **first-argument-first**. Revision 1's trailing placement puts
   the limiter after a handler that never calls `c.Next()` — a rate limit that
   is never executed, and that would have passed a test written against the same
   wrong assumption.
2. **The key is the TCP peer, not `c.IP()`.** With `TrustProxy: true` and a
   non-empty `APP_TRUSTED_PROXIES`, `cmd/rest.go:50-53` sets
   `ProxyHeader = X-Forwarded-Host`, and `EnableIPValidation` is never set — so
   `req.go:636-641` returns the raw header **verbatim**, unparsed. An attacker
   rotating that header mints unlimited limiter buckets from one connection
   (panel: security 3). The key generator uses `c.RequestCtx().RemoteIP()`.
   Behind a proxy this is a *per-proxy* budget rather than a per-client one; that
   is the safe direction, and §5's semaphore is what actually bounds the cost.
   Recorded as a stated limit, not glossed.
3. **Two separate budgets**, because the two routes have opposite shapes: login
   is expensive and rare (10 / minute), refresh is cheap and frequent — every 15
   minutes per active session (60 / minute). One shared budget would either
   throttle legitimate refreshes or leave login too loose.

**The bcrypt semaphore** (`pkg/auth/throttle.go`) is the bound that holds
regardless of the limiter (panel: security 3, performance 2 — both lenses).
`password.go:10-21` says out loud that a login flood starves the whatsmeow event
goroutines, because they share this process. A per-IP limit cannot bound that: 20
distinct sources saturate a core at cost 12, and "distinct source" is free over
an IPv6 /64 or a rotating proxy. A buffered channel of `max(1, GOMAXPROCS/2)`
wraps every password comparison — including `DummyVerifyPassword`, or the
countermeasure becomes a timing signal again — and returns
`503 AUTH_BUSY` immediately when full rather than queueing.

### 6 · The middleware (AC-10)

`ui/rest/middleware/authenticate.go`:

- Reads `Authorization: Bearer <token>` only. A `Basic` header is ignored and
  passed through untouched, so the basic-auth middleware below still sees it.
- On a valid token: `c.Locals(...)` **and**
  `c.SetContext(context.WithValue(c.Context(), ...))`, so both a handler and a
  usecase reached through `context.Context` can read the principal.
- On a missing, malformed, expired or superseded token: **`c.Next()`**. This
  ticket identifies; it does not deny. A rejection is logged at debug only, never
  with the token.
- **Nil-guarded**: `Authenticate(nil)` must `c.Next()`, not panic. Installed with
  `app.Use`, a panic here is a 500 on *every* request in the API
  (panel: security 6).
- Exports `PrincipalFromContext(c) (*auth.Principal, bool)` so ticket 24 has one
  reader rather than five.

**Exact position** — named precisely, because "above the basic-auth block" also
permits *above `Recovery`*, where a panic escapes to fasthttp instead of becoming
a 500 (panel: security 15). It goes **after** the public routes (`/health`,
`/statics`, the Chatwoot webhooks) and **immediately before** the
`if len(config.AppBasicAuthCredential) > 0` block at `cmd/rest.go:102` — which is
after `Recovery()` (line 63) and `RequestTimeout()` (line 64). And the `/auth`
routes are registered **after** it, or `/auth/me` would always 401
(panel: senior 13).

**One reordering in `cmd/rest.go`** (panel: senior 3, security 14, performance
nit — three lenses): the `/auth` group needs `APP_BASE_PATH`, but `apiGroup` is
built at line 117, *after* the basic-auth block. Registering `/auth` before that
block therefore means either dropping the base path (breaking every sub-path
deployment's login) or landing behind basic auth (breaking AC-3 whenever
`APP_BASIC_AUTH` is set). The fix is to **move the `apiGroup` construction
(lines 117-120) above the basic-auth block**. I verified this is behaviour-neutral:
`app.Group(prefix)` with no handlers registers no route at all
(`fiber/v3@v3.4.0/app.go:1110-1113`).

### 7 · The sweeper (AC-14)

`infrastructure/chatstorage/refresh_token_retention.go`, modelled on
`debug_retention.go`: a 2-minute first-sweep delay to keep it off the boot path,
an hourly tick, bounded batches with a pause so SQLite's single writer is
released between them.

**The statement is pinned here**, because the obvious form does not compile on
either engine (panel: senior 7, performance 7): `DELETE ... LIMIT` is unavailable
— mattn does not compile `SQLITE_ENABLE_UPDATE_DELETE_LIMIT`, and PostgreSQL has
no such clause — so the bound goes through a primary-key subselect, exactly as
`DeleteMessageDebugOlderThanAllDevices` documents at
`sqlite_repository.go:2678-2683`. `refresh_tokens` has a single-column PK, so it
is simpler than the `message_debug` composite:

```sql
DELETE FROM refresh_tokens
 WHERE token_id IN (
   SELECT token_id FROM refresh_tokens
    WHERE expires_at < ?
    ORDER BY expires_at
    LIMIT ?
 )
```

The cutoff is bound as a `time.Time`, not a formatted string — the rule
`sqlite_repository.go:2693-2697` records, and what makes the stored TEXT
comparable given `time.Local = time.UTC` at `root.go:77`. `ORDER BY expires_at`
is what keeps it an `idx_refresh_tokens_expires` range seek on both engines.

**A second, bounded delete for spent rows** (panel: performance 1). Revision 1
swept only `expires_at < now`, so every rotated row lived the full 30 days: at
one rotation per 15 minutes that is ~96 rows/day and ~2,880 rows per continuously
active session, none of which the sweep ever touched. A second statement, same
shape, adds `revoked_at IS NOT NULL` and uses a cutoff of
`now + (refreshTTL - reuseGraceRetention)` — which, because a revoked row's
`expires_at ≈ created + TTL`, is "revoked and older than the retention window"
expressed as an `idx_refresh_tokens_expires` range seek. No new index, no
migration (C-2 holds). At 48h that is ~192 rows/session instead of ~2,880.

`reuseGraceRetention` is a **constant, not a setting** — the repo's own rule that
the policy is the policy and the interval is only how promptly it is applied
(`debug_retention.go:14-18`).

**AC-14 is amended** to state the consequence honestly: re-use detection is
bounded to 48 hours. A spent token replayed after that gets a plain 401 rather
than a family revocation. Since an active session rotates every 15 minutes, a
48-hour-old spent token means ~192 rotations have happened since; a thief holding
it would have spent it long before. The stolen token does not work either way —
what is lost is the *detection*, not the protection.

Started from `cmd/rest.go` next to `startDebugRetentionWorker`, on the same
cancellable context, so it stops before the pool it writes through is closed.

### 8 · Configuration

| Key | Default | Where |
|---|---|---|
| `AUTH_JWT_SECRET` | *(none)* | read at the call site in `restServer`, passed as an argument — **never** in `config`, **never** a flag (C-5) |
| `AUTH_JWT_ISSUER` | `gowa` | `config.AuthJWTIssuer` |
| `AUTH_ACCESS_TTL` | `15m` | `config.AuthAccessTTL` |
| `AUTH_REFRESH_TTL` | `720h` | `config.AuthRefreshTTL` |
| `AUTH_LOGIN_RATE_LIMIT` | `10` | `config.AuthLoginRateLimit` |
| `AUTH_REFRESH_RATE_LIMIT` | `60` | `config.AuthRefreshRateLimit` |
| `AUTH_RATE_WINDOW` | `1m` | `config.AuthRateWindow` |

`AUTH_PRINCIPAL_CACHE_REFRESH` is **gone** with the ticker (§3).

`redactedSettings()` already replaces any key containing `auth`, `secret` or
`token` (`root.go:466`), so the startup dump is safe with no edit; a test case
pins that for `auth_jwt_secret` rather than adding a redundant rule.

**AC-2 — amended, and this is the one place the panel talked me out of the
ticket's literal wording.** Revision 1 made an absent secret `logrus.Fatalln`.
The security lens argued against it and I agree, on this repository's own
precedent: `cmd/root.go:1384-1389` states the rule for exactly this situation —
ticket 22's identity boot is deliberately **not** fatal because "nothing here is
read by any route in this ticket … Ticket 24 — the first that actually depends on
these rows — owns escalating it." This ticket is equally non-enforcing by design.
A fatal therefore buys **zero** attack-surface reduction while guaranteeing that
every existing deployment crash-loops on image update — for a WhatsApp gateway
that means dropped inbound events and a `/health` probe that never answers. The
senior lens independently noted that `readme.md`'s two docker-compose examples
become non-booting.

So, in the shape this repo already chose for this exact problem
(`middleware/require_basic_auth.go:32-47`):

- **Secret absent** → boot, log an `ERROR`, and every `/auth/*` route answers
  `503 AUTH_NOT_CONFIGURED`. Reject rather than refuse-to-mount: a surface that
  changes shape with configuration is harder to diagnose than one that answers a
  reason.
- **Secret present but shorter than 32 bytes** → **`logrus.Fatalln`**. This half
  of AC-2 is kept exactly, because it is the half with a security argument behind
  it: a weak secret is worse than none, since it looks like protection.
- Ticket 24, where JWT becomes the enforcer and booting without it genuinely
  means unguarded, escalates absent → fatal.

The check and the service construction both live at the top of `restServer`, not
in `initApp` — `cobra.OnInitialize` runs `initApp` for **every** subcommand, so
constructing there would give `gowa mcp` a REST-only dependency (and, in revision
1, an HS256 verifier keyed on `""` — panel: security 6, senior 8).

## Steps

1. `go get github.com/golang-jwt/jwt/v5` — adds a **new direct require and new
   `go.sum` entries**; it is in neither file today (panel: senior 9 corrected
   revision 1's "promotes it out of `// indirect`"). Resolvable from the local
   module cache at v5.3.1.
2. `pkg/auth/token.go`, `refresh.go`, `principal.go`, `throttle.go`. Tests: TC-1,
   TC-2, TC-5.
3. `domains/chatstorage`: `RefreshToken`, `IdentitySnapshot`, seven interface
   methods; wrapper delegation.
4. `infrastructure/chatstorage/refresh_token_repository.go` +
   `refresh_token_retention.go`. Tests: TC-6, TC-7, TC-13.
5. `domains/auth` — DTOs and `IAuthUsecase`.
6. `usecase/auth.go` — the service, reusing `usecase.LookupUserByUsername`, which
   ticket 22 shipped for this path (`usecase/identity.go:213-228`; panel: senior
   12). Tests: TC-3, TC-4, TC-8, TC-9, TC-10, TC-14.
7. `ui/rest/middleware/authenticate.go`. Test: TC-12.
8. `ui/rest/auth.go` with the two limiters. Test: TC-11.
9. `cmd/rest.go`: **move `apiGroup` above the basic-auth block**, add
   `app.Use(Authenticate)`, register `/auth` after it, start the sweeper.
   `config/settings.go`, `.env.example`, `readme.md`, `docs/openapi.yaml`.
10. `go build ./...`, `go vet ./...`, `go test -tags purego ./...` against the
    baseline; then the named PostgreSQL runs.

## Files to change

### New

- `src/pkg/auth/token.go`, `refresh.go`, `principal.go`, `throttle.go`
- `src/pkg/auth/token_test.go`
- `src/domains/auth/auth.go`, `src/domains/auth/interfaces.go`
- `src/infrastructure/chatstorage/refresh_token_repository.go`
- `src/infrastructure/chatstorage/refresh_token_retention.go`
- `src/infrastructure/chatstorage/refresh_token_repository_test.go`
- `src/usecase/auth.go`, `src/usecase/auth_test.go`
- `src/ui/rest/auth.go`, `src/ui/rest/auth_test.go`
- `src/ui/rest/middleware/authenticate.go`, `authenticate_test.go`

### Modified

- `src/domains/chatstorage/chatstorage.go` — `RefreshToken`, `IdentitySnapshot`
- `src/domains/chatstorage/interfaces.go` — seven methods
- `src/infrastructure/whatsapp/chatstorage_wrapper.go` — delegation
- `src/config/settings.go` — six non-secret auth settings
- `src/cmd/rest.go` — the `apiGroup` move, `app.Use`, `/auth`, the sweeper
- `src/cmd/helpers.go` — `startRefreshTokenSweeper`
- `src/cmd/root_test.go` — one redaction case for `auth_jwt_secret`
- `src/.env.example` — the seven keys, the generation command, the CORS note
- `readme.md` — the env table and the two docker-compose examples
- `docs/openapi.yaml` — four paths, the 401 and the 429/503 responses
- `src/go.mod`, `src/go.sum`
- `_specs/z8pmx9m6af/*`

`docs/openapi.yaml` and `readme.md` were both missing from revision 1
(panel: senior 2, 11). `openapi.yaml` has been an adopted panel finding on three
prior tickets (`z8pmx9kzc7`, `cu-z8pmx9kcvb`, `z8pmx9m57v`), and under IM-4 an
unlisted file cannot be touched mid-implement.

### Not touched

`docker-compose.yml`, `docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/*` (C-3).

## E-1 · Escalated precondition — the Supabase `anon` grant

**This is the finding that matters most, and it is not fixed by this ticket.**

`_specs/z8pmx9m6ae/verify.md:170-240` records, with a full enumeration, that all
29 tables in `public` are granted `arwdDxtm` to `anon` — the role behind the
project's public PostgREST endpoint — with RLS on **zero** of them, and that
`pg_default_acl` grants the same to every future table. Ticket 22 escalated it;
the owner approved remediation; applying it was blocked by the environment's
safety classifier, so it shipped still open.

Ticket 22 could tolerate that because nothing read the rows. **This ticket makes
those rows the authentication decision.** With the grant open, anyone holding the
project's public anon key can `INSERT` a `refresh_tokens` row carrying a chosen
`token_hash` and the admin's `user_id`, then `POST /auth/refresh` and receive an
admin access token — no password, no bcrypt, no rate limit. They can equally
`UPDATE users.password_hash` or `INSERT` into `role_permissions`.

The remediation SQL is in `_specs/z8pmx9m6ae/verify.md`. It is **not** something
this ticket's code can do, and I cannot run it. It is recorded here as a
**deployment precondition**, and `verify.md` will carry a read-only probe of
`has_table_privilege('anon','refresh_tokens','INSERT')` as evidence of the state
at delivery.

## Validation strategy

- `go build ./...`, `go vet ./...` from `src/`.
- `go test -tags purego ./...` from `src/`. **`-tags purego` is mandatory** —
  without it the SQLite driver is a CGO stub and ~30 storage tests fail with
  "Binary was compiled with CGO_ENABLED=0" (ticket 22 recorded this after it cost
  a confused run).
- A **baseline captured on the unmodified tree before the first edit**. Measured:
  one pre-existing failure, `TestResolveDocumentMIME` in `usecase` — the same one
  tickets 18 and 22 recorded. Every later result is read against it.
- **PostgreSQL, named and recorded** (panel: performance 9). `newTestDB` falls
  back to SQLite **silently** when `CHAT_STORAGE_TEST_POSTGRES_URI` is unset
  (`postgres_support_test.go:68-79`), so a green default run proves nothing about
  the conditional UPDATE, the `IN (SELECT … LIMIT)` delete, or timestamp
  comparison. `verify.md` must record these as **non-skipped, dialect =
  postgres**: `TestRefreshTokenRotationIsAtomic`,
  `TestRefreshTokenReuseRevokesFamily`, `TestRefreshTokenSweep`. Any schema
  created is dropped explicitly and the database confirmed clean.
- The **boot-path delta** is measured and recorded next to ticket 22's number
  (panel: performance 8).
- No manual gateway boot is required for any AC.

## Rollback

Revert the commit. Basic auth is untouched, no migration is added, and no
existing route reads anything this ticket writes, so a revert restores the
previous behaviour completely. Rows already in `refresh_tokens` become abandoned
data in a table ticket 22 already shipped; nothing reads or sweeps them, and a
re-apply picks them up harmlessly.

## Out of scope

As `spec.md > Out of scope`. No `Require()`, no route policy, no
`AssertPolicyCoverage`, no basic-auth change, no migration.

## Risks and unknowns

- **R-1 — E-1 above.** The single largest risk in this ticket, and it is
  environmental, not code.
- **R-2 — the principal cache is correctness-critical.** A missed
  `ReloadPrincipals()` in ticket 26 means a revoked user keeps working in that
  process until restart. With the ticker gone there is no backstop; ticket 26
  must route every identity write through one function. Stated, not mitigated
  here.
- **R-3 — the limiter is per-process and its key space is unbounded.** N replicas
  give N × the budget, and one map entry per distinct peer per window. Acceptable
  only because the bcrypt semaphore, not the limiter, is what bounds CPU.
- **R-4 — re-use detection is bounded to 48 hours** by the sweep (§7), and to
  outside a 10-second grace window (§4). Both are stated trades, not oversights.
- **R-5 — `/auth/login` is callable cross-origin by default.**
  `cmd/rest.go:299-307` defaults `AllowOrigins` to `["*"]` with `Authorization`
  allowed, so any page can drive login attempts from visitors' browsers —
  distributed credential stuffing a per-IP limiter structurally cannot see
  (panel: security 13). `.env.example` and `readme.md` gain a note that
  `APP_CORS_ALLOWED_ORIGINS` becomes required once `/auth` exists.
- **R-6 — the WebSocket token of ticket 25** is exposed to the upstream proxy
  access log, `Referer` and browser history — **not**, as revision 1 claimed, to
  Fiber's request logger: its default format uses `${path}`, which carries no
  query string (panel: security 16). `${error}` *is* logged, so no auth handler
  may return an error whose message contains a token.
- **R-7 — AC-9's "25 and 9" asserts the seeded state, not an invariant.** The
  runtime authority is `role_permissions`, which an operator (or, per E-1, anyone
  with the anon key) can edit (panel: security 18).

## Deviations from the ClickUp plan

- **D-1 — `service.go` moves from `pkg/auth` to `usecase/auth.go`**, and
  `cache.go` becomes `pkg/auth/principal.go` holding only the immutable snapshot
  and a pure builder. `pkg/` in this tree holds leaf helpers; the leaf property is
  what lets ticket 24 import a permission constant from every handler package
  without an import cycle. Confirmed by the senior lens against
  `usecase/identity.go:15-25`.
- **D-2 — AC-2's absent-secret fatal becomes a 503**, short-secret stays fatal.
  Reasoning in §8. **This is a change to an owner-stated acceptance criterion and
  is flagged for the owner to overrule.**
- **D-3 — AC-12 extends to login** (§5), and **AC-14 bounds re-use detection to
  48 hours** (§7). Both amend `spec.md`.
- **D-4 — `src/config/settings.go` gains non-secret settings only**; the secret is
  read at its call site (C-5). No cobra flag for any auth value.
- **D-5 — one reordering of existing code**: `apiGroup` moves above the
  basic-auth block in `cmd/rest.go`. Verified behaviour-neutral.

## Panel response

Revision 1 went to the three lenses **against the source**. 47 findings. Six
changed the design, three were declined with reasons, and **three revision-1
claims were factually wrong about this repository**.

### Two lenses independently found the same three defects

**(1) The rate limiter would never have run.** Security and senior both found it,
and I verified it at `fiber/v3@v3.4.0/app.go:1095-1097`. Revision 1 asserted
"Fiber v3 takes middleware as trailing variadic handlers"; the opposite is true —
`Add` builds the chain as `append([]any{handler}, handlers...)`, so the *first*
argument runs first. `Post("/auth/login", h.Login, limiter)` registers a limiter
that is never reached, because a login handler that returns a response never
calls `c.Next()`. AC-13 and NFR-2 would have shipped as dead code — and, worse,
TC-11 as revision 1 planned it (a hand-built app) would have passed against the
same wrong assumption, so the test would have certified the defect. This is the
clearest case in the ticket of a green test proving nothing.

**(2) The refresh path had no way to read its user.** Senior and performance both
found it. Revision 1's step 4 said "load the user from the database"; the only
user read that exists is `GetUserByUsername` (`user_repository.go:335`), and
`refresh_tokens` carries only `user_id`. An implementer would have invented an
eighth method mid-implement (an IM-4 scope violation) or reused the three-query
snapshot read *per refresh*. Fixed by naming `GetUserByUserID` explicitly, and —
performance's addition — omitting `password_hash` from its SELECT list.

**(3) The 30-second cache ticker.** All three lenses, for three different
reasons: senior — invented, no AC asks for it, and against the repo's precedent
on tunable intervals; performance — 8,640 round trips/day/process against a
remote Supabase, justified by a multi-replica shape this repo does not support
(every process auto-connects every device, so two replicas fight over the same
whatsmeow sessions); security — constructed in `initApp`, which runs for every
subcommand, so `gowa mcp` would poll identity tables forever and hold an HS256
verifier keyed on `""`. Removed entirely.

### Adopted, changing the design

- **The empty-password enumeration oracle** (security 7). The best single finding
  in this review. `password.go:82-84` short-circuits `VerifyPassword` to false
  *without bcrypt* when the password is empty — so the cheapest possible probe,
  `{"password":""}`, returns in microseconds for a real user and ~300ms for an
  unknown one, defeating AC-4 completely. Ticket 22 shipped
  `DummyVerifyPassword` precisely to close this oracle, and revision 1 would have
  left a door straight past it. Fixed with request validation at the DTO
  boundary, before any lookup.
- **Login never checked `status`** (security 4). A disabled user could obtain a
  live token pair and a persisted refresh family. AC-12 amended.
- **Family revocation on ordinary client concurrency** (performance 6). Two
  parallel XHRs from one browser would have logged the user out everywhere. The
  10-second grace window.
- **Unbounded `refresh_tokens` growth** (performance 1). ~2,880 rows per active
  session that the sweep never touched. Second bounded delete, index-seekable, no
  migration.
- **The bcrypt semaphore** (security 3, performance 2). A per-IP limit cannot
  bound CPU when "distinct IP" is free; and with `X-Forwarded-Host` unvalidated
  it is bypassable from one connection.
- **`apiGroup` has to move** (senior 3, security 14). The `/auth` group had
  nowhere to mount that was both base-path-correct and public.
- **AC-2's fatal becomes a 503** (security 5). Discussed in §8 and flagged as
  D-2 for the owner.
- Plus: the sweep statement shape (senior 7, performance 7), the separate hash
  argument (senior 6), dropping `CountActiveRefreshTokens` (senior 5), the
  `ResponseData` envelope (senior 10), `authError` (security 9), the two
  undefined rotation branches (security 10), empty `sub` and leeway
  (security 12), the nil guard and exact placement (security 6, 15),
  `docs/openapi.yaml` and `readme.md` (senior 2, 11), reusing
  `LookupUserByUsername` (senior 12), claim-before-read (performance 5), and the
  named PostgreSQL runs (performance 9).

### Declined, with reasons

- **Performance's version-probe cache design** (a `COUNT(*)`/`MAX(updated_at)`
  poll before rebuilding). Declined as **moot**: it optimises the ticker, and the
  ticker is gone. Re-proposing it would reintroduce the polling all three lenses
  objected to, at a lower price.
- **Security 11's distinct internal reason codes** for logout-retry vs theft.
  Partially adopted — the grace window fixes the behaviour that mattered. The
  codes themselves are ticket-26 surface (they only become visible when something
  surfaces them), and adding an unread field now is the "ticket 26 will call
  this" surface senior 14 warned against.
- **Security 3's suggestion to add a global attempts-per-window ceiling** on top
  of the semaphore. Declined as redundant: the semaphore already bounds
  concurrent bcrypt work, which is the resource, and a second global counter
  would add a shared lock on the login path to bound a quantity the first
  mechanism already bounds.

### Revision 1 claims that were factually wrong

1. **"Fiber v3 takes middleware as trailing variadic handlers"** — the opposite.
   Detailed above.
2. **"the import promotes it out of `// indirect`"** (senior 9). Wrong:
   `golang-jwt/jwt/v5` appears in **neither** `go.mod` nor `go.sum`. `go get`
   must write new lines in both. The conclusion survives — v5.3.1 is in the local
   module cache, so R-3's offline fallback is not needed — but the stated
   mechanism did not exist.
3. **"exposed to the request logger when `APP_DEBUG` is on"** (security 16).
   Fiber's default logger format uses `${path}`, which carries no query string,
   so that specific exposure does not occur. The real channel is the upstream
   proxy log, `Referer` and browser history. Corrected in R-6 — the point being
   that ticket 25 would otherwise have mitigated the wrong thing.
