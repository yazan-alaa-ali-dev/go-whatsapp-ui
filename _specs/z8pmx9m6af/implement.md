---
ticket: z8pmx9m6af
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-08-31
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6af"
  github: ""
---

# Implementation — 23 · Login and tokens

Applied on branch `ticket/z8pmx9m6af`, cut from `ticket/z8pmx9m6ae` (ticket 22's
tip). Fourteen new files, thirteen modified.

## Baseline

`go test -tags purego ./...` was run on the **unmodified** tree before the first
edit. One failure existed already:

```
--- FAIL: TestResolveDocumentMIME/Zip
FAIL  github.com/aldinokemal/go-whatsapp-web-multidevice/usecase
```

Unrelated to this ticket (document MIME sniffing), and the same pre-existing
failure tickets 18 and 22 recorded. Every later result is read against it.

`-tags purego` is required — without it the SQLite driver is a CGO stub and ~30
storage tests fail with "Binary was compiled with CGO_ENABLED=0".

The `go get` probe run before the baseline was reverted (`git checkout -- go.mod
go.sum`) so the baseline was measured on a genuinely unmodified tree.

## Files changed

### New

| File | What |
|---|---|
| `src/pkg/auth/token.go` | HS256 sign/verify with the algorithm pinned twice, the eight claims, secret validation |
| `src/pkg/auth/refresh.go` | 32-byte CSPRNG token + SHA-256 digest |
| `src/pkg/auth/principal.go` | `Principal`, the atomic immutable cache, the pure builder |
| `src/pkg/auth/throttle.go` | the process-wide bcrypt semaphore |
| `src/pkg/auth/token_test.go` | TC-1, TC-2, TC-5 + the cache and semaphore units |
| `src/domains/auth/auth.go` | DTOs, the five sentinels, `UserView` |
| `src/domains/auth/interfaces.go` | `IAuthUsecase` |
| `src/infrastructure/chatstorage/refresh_token_repository.go` | the seven storage methods |
| `src/infrastructure/chatstorage/refresh_token_retention.go` | the sweeper + its worker |
| `src/infrastructure/chatstorage/refresh_token_repository_test.go` | TC-6, TC-7, TC-13 |
| `src/usecase/auth.go` | the service: login, refresh, logout, verify, reload |
| `src/usecase/auth_test.go` | TC-3, TC-4, TC-8, TC-9, TC-10, TC-14 |
| `src/ui/rest/auth.go` | the four endpoints, the two limiters, `authError` |
| `src/ui/rest/auth_test.go` | TC-11 + the response-shape and leak assertions |
| `src/ui/rest/middleware/authenticate.go` | bearer → principal, permissive |
| `src/ui/rest/middleware/authenticate_test.go` | TC-12 |

### Modified

| File | What |
|---|---|
| `src/domains/chatstorage/chatstorage.go` | `RefreshToken`, `IdentitySnapshot`, `SnapshotUser`, `SnapshotPair` |
| `src/domains/chatstorage/interfaces.go` | the seven token methods |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | seven delegations, no device scoping |
| `src/config/settings.go` | six non-secret auth settings |
| `src/cmd/root.go` | env binding for the six |
| `src/cmd/rest.go` | `apiGroup` moved, `app.Use(Authenticate)`, `/auth`, the sweeper |
| `src/cmd/helpers.go` | `initAuthUsecase`, `startRefreshTokenSweeper` |
| `src/cmd/root_test.go` | one redaction case for `auth_jwt_secret` |
| `src/.env.example` | the seven keys + the generation command + the CORS note |
| `readme.md` | eight env-table rows |
| `docs/openapi.yaml` | four paths, eight schemas, five responses, `bearerAuth` |
| `src/go.mod`, `src/go.sum` | `github.com/golang-jwt/jwt/v5 v5.3.1` |

## Deviations from the plan

### D-1 — the concurrency test needed a retry loop that the plan did not anticipate

`TestRefreshTokenRotationIsAtomic` failed on its first run: **all ten** racing
claims returned `SQLITE_BUSY` and zero succeeded.

That is a property of the **test harness**, not of the statement or of
production. `newTestDB` opens a bare SQLite file with no pragmas, while a real
deployment goes through `sqlite.FormatChatStorageURI`, which sets
`busy_timeout(30000)` (`src/pkg/sqlite/sqlite_purego.go:17`) — the driver then
waits for the writer lock instead of erroring.

This mattered more than it looks. With zero successes the test **could not tell a
working gate from a broken one**: a `ClaimRefreshToken` that always returned
`false` would have passed it identically. The fix retries only lock contention,
so each goroutine still ends on a definitive yes or no and the assertion is over
ten real answers.

### D-2 — `truncateRunes` was added, and is not in the plan

`refresh_tokens.user_agent` is `VARCHAR(255)` and a browser can send more. Byte
truncation would split a multi-byte rune and store invalid UTF-8, which
PostgreSQL rejects outright — so the naive form would turn a long non-ASCII user
agent into a **failed login**. Ten lines, plus
`TestCreateRefreshTokenTruncatesUserAgentSafely`.

### D-3 — `isMissingUserError` matches on a message string

`GetUserByUsername` refuses a blank username with
`fmt.Errorf("username is required")` — not `sql.ErrNoRows`
(`user_repository.go:336`). The login path must treat that as "no such user", or
it escapes as a 500 while every other bad username answers 401, which is a
difference an attacker can measure.

Matching a message is ugly. The alternative was exporting a sentinel from ticket
22's file, which would widen this ticket's diff into a file it has no other
reason to touch. The match is confined to one function with the reasoning
written on it, and `TestLoginFailuresAreIndistinguishable` pins the behaviour so
a future sentinel can replace the match without changing the contract.

### D-4 — `PrincipalFromGoContext` was added

The plan named only `PrincipalFromContext(c fiber.Ctx)`. The middleware writes
the principal into **both** `c.Locals` and the request `context.Context`, so
there are two readers to serve; a usecase reached through a `context.Context`
has no `fiber.Ctx` to ask. This mirrors `ContextWithAccountActor`.

### D-5 — the sweep is one statement with two cutoffs, not two statements

The plan described "a second, bounded delete". It is one `DELETE` with
`expires_at < ? OR (revoked_at IS NOT NULL AND expires_at < ?)`, which keeps the
batch bound (`LIMIT`) meaningful — two statements would each take the full batch
and double the work per pass — and still drives from
`idx_refresh_tokens_expires`.

### D-6 — the readme's docker-compose examples were NOT edited

The senior lens flagged them as becoming non-booting under AC-2. That was true of
**revision 1's** fatal-on-absent behaviour. Since the amended AC-2 boots without
a secret (`/auth/*` answers 503), the examples still work unchanged, so editing
them would have been a change with no reason behind it. Recorded because their
absence from the diff looks like an oversight and is not.

## What was deliberately NOT changed

- **Basic auth.** Untouched. It is still the only enforcer on every route, and
  `WebsocketQueryAuth` is unchanged. `Require()`, the route policy and
  `AssertPolicyCoverage` are ticket 24's.
- **No migration.** The schema shipped with ticket 22 (migrations 62–72); this
  ticket adds none, and `TestAccountSchemaIsAppendedNotEdited`'s count of 72
  still holds.
- **No deployment runtime file.** `docker-compose.yml`, `docker/` and
  `.github/workflows/` are untouched.
- **No cobra flag and no `config` global for `AUTH_JWT_SECRET`.** Read at its
  call site in `restServer` and passed as an argument.
- **`redactedSettings()` was not edited.** It already matches any key containing
  `auth`; a test case pins that rather than adding a redundant rule.
- **The MCP server gets no auth.** `initAuthUsecase` is called from `restServer`,
  not `initApp`, so `gowa mcp` neither builds a verifier nor sweeps a table it
  never writes.

## One reordering of existing code

`cmd/rest.go`: the `apiGroup` construction moved from below the basic-auth block
to above it. Verified behaviour-neutral against the library —
`app.Group(prefix)` with no handlers registers no route at all, it only returns a
prefixing router (`fiber/v3@v3.4.0/app.go:1110-1113`). Without the move the
`/auth` group could be base-path-correct **or** public, not both.

## Validation run

From `src/`:

```
go build ./...                    OK
go vet ./...                      OK
go test -tags purego ./...        only the pre-existing TestResolveDocumentMIME/Zip
```

### The limiter mutation

`TestLoginRouteIsRateLimited` was checked against the defect it exists to catch.
The route was temporarily reverted to the plan's original trailing-handler form,
`app.Post("/login", rest.Login, newAuthLimiter(...))`, and the test failed:

```
--- FAIL: TestLoginRouteIsRateLimited
    auth_test.go:124: over-budget attempt: status = 401, want 429.
```

The correct order was then restored and the test re-run green. This matters
because the trailing form is what revision 1 of the plan specified: without a
test driven through the **registered route**, the ticket would have shipped a
rate limit that is registered, reviewed, and never executed.

### PostgreSQL — NOT COMPLETED, see `verify.md`

The PostgreSQL half could not be run: DNS resolution failed machine-wide during
this session (`proxy.golang.org` and the Supabase pooler host both unresolvable).
The named tests **fail rather than skip** when the URI is set and unreachable, so
this is visible and not silently green. Recorded as an open gap in `verify.md`
rather than reported as a pass.

No test schema was created — `newTestDB` aborts at `Ping`, before
`CREATE SCHEMA` — so no `gowa_test_<pid>_<n>` orphan was left behind. This could
not be confirmed against the server for the same reason it could not be run.
