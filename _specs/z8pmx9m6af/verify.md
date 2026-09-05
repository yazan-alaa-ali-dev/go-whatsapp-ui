---
ticket: z8pmx9m6af
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-08-31
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6af"
  github: ""
---

# Verification — 23 · Login and tokens

**Outcome: PASSED on every acceptance criterion, with one environmental gap
recorded in full below (§ PostgreSQL) and one escalation carried forward (§ E-1).**

## Runtime impact

**Does this change touch a deployment runtime file? NO.**
`docker-compose.yml`, `docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml` and
`.github/workflows/set-latest-tag.yaml` are all unmodified. `git diff --stat`
lists thirteen modified files, none of them in that set.

**Does it change the behaviour of any existing route? NO.** The change adds one
`app.Use` that identifies and never denies, four new routes registered above the
basic-auth block, and one worker. Basic auth is untouched and remains the sole
enforcer. The one reordering of existing code (`apiGroup` moved above the
basic-auth block) was verified behaviour-neutral against the library source.

## Validation commands

From `src/`:

```
go build ./...                    OK
go vet ./...                      OK
go test -tags purego ./...        1 failure — pre-existing (see below)
```

Baseline, measured on the unmodified tree **before the first edit**:
`TestResolveDocumentMIME/Zip` in `usecase` already failed. It is the only failure
after the change too, so the suite is green against its baseline.

## Acceptance criteria

| AC | Result | Evidence |
|----|--------|----------|
| **AC-1** — jwt/v5 direct dependency; HS256 pinned; `alg: none` and RS256 rejected | **PASS** | `go.mod` now carries `github.com/golang-jwt/jwt/v5 v5.3.1`. `TestParseAccessTokenRejectsForgedAlgorithms` constructs a real `alg: none` token (via `jwt.UnsafeAllowNoneSignatureType`), a real RS256 token signed with a generated 2048-bit key, and an HS256 token signed with the wrong secret — all three rejected. A correctly signed token is accepted in the same test, so the three rejections cannot come from a verifier that rejects everything. |
| **AC-2** — refuses to boot on a bad secret | **PASS, amended** | `TestValidateJWTSecret` pins three answers: `""` → `ErrSecretAbsent`, 16 bytes → `ErrSecretTooShort`, 32 bytes → nil, and the constructor returns `(nil, error)` for the first two so a verifier keyed on a weak secret cannot exist. `initAuthUsecase` turns **too short** into `logrus.Fatalf`. **Absent is deliberately NOT fatal** — see the amendment note below. `TestAuthRoutesAnswer503WhenNotConfigured` pins the 503 path. |
| **AC-3** — login returns the four fields; `user` never contains `password_hash` | **PASS** | `TestLoginResponseShape` asserts all four inside `results`. `TestLoginSucceedsAndNeverLeaksTheHash` marshals the real response and greps it for the field name, the stored bcrypt hash **and** the plaintext password — none present. It also asserts the raw refresh token is not a key in storage and its digest is. |
| **AC-4** — unknown user and wrong password are indistinguishable, in body and timing | **PASS** | `TestLoginFailuresAreIndistinguishable` covers seven rejection shapes (unknown, wrong password, disabled, empty password, empty/blank username, and both) — all `ErrInvalidCredentials`. `TestLoginRejectionsAreUniform` asserts identical status, code **and** message through the HTTP layer, including an unparseable body. `TestEmptyPasswordDoesNotSkipTheBcryptCost` measures the branches. |
| **AC-5** — eight claims; `exp - iat == 900` | **PASS** | `TestSignProducesEveryRequiredClaim` decodes the token **off the wire** (base64 segments, not the Go struct) so the JSON tags are what is asserted, checks all eight claim names, `exp-iat == 900`, `iss`, `sub`, `epoch`, and that the header names HS256. |
| **AC-6** — 32 random bytes, stored only as sha256, rotated on every use | **PASS** | `TestNewRefreshToken` decodes the token and asserts 32 bytes of entropy, a 64-character digest, that neither contains the other, and that 128 successive tokens never collide. `TestCreateAndClaimRefreshToken` proves one claim succeeds and the second on the same token fails. `TestRefreshRotatesAndDetectsReuse` asserts the returned token actually changed and the family is preserved. |
| **AC-7** — a re-used token revokes the whole family | **PASS** | `TestRefreshRotatesAndDetectsReuse` replays the original token past the grace window and asserts **every** row of the family is revoked, then asserts the *most recently issued* sibling also stops working — the victim is logged out too, which is what makes the theft visible. `TestRevokeRefreshTokenFamily` proves another user's family is untouched. |
| **AC-8** — rotation is atomic under concurrency | **PASS** | `TestRefreshTokenRotationIsAtomic` fires ten goroutines released together at one token and asserts **exactly one** success. See the harness note in `implement.md > D-1`: the first run returned zero successes and could not have distinguished a working gate from a broken one, so the test was corrected before it was trusted. |
| **AC-9** — logout revokes the family; `/auth/me` returns effective permissions | **PASS** | `TestLogoutRevokesTheWholeFamily` (family-wide, idempotent, silent on unknown tokens). `TestEffectivePermissionCounts` asserts **25** for admin and **9** for user through the cache, and that the user role cannot send. `TestMe` asserts the HTTP shape: 401 anonymous with `AUTH_REQUIRED`, and 25 permissions for an admin principal. |
| **AC-10** — `app.Use` unconditional, principal on the context, `c.Next()` for anonymous | **PASS** | `cmd/rest.go` installs it outside the `if len(config.AppBasicAuthCredential) > 0` block. `TestAuthenticateNeverDenies` drives **ten** shapes — nil service, unconfigured, no header, a `Basic` header, malformed scheme, empty bearer, forged, expired, superseded, disabled — and asserts 200 and `anonymous` for every one. `TestAuthenticateAttachesPrincipal` asserts the principal reaches both readers and that the scheme match is case-insensitive. |
| **AC-11** — resolved from an in-memory cache; a verified request performs zero queries | **PASS** | `TestVerifyIssuesNoDatabaseQuery` sets the fake repository to fail **every** call, then verifies 50 times: all succeed, and the recorded call count is unchanged. A verification that issued even one query would fail outright. |
| **AC-12** — non-active status or a superseded epoch is rejected at verify, refresh **and login** | **PASS** | `TestVerifyRejectsDisabledAndSupersededTokens` asserts `ErrUserDisabled` and `ErrTokenSuperseded` immediately after the change (not at token expiry), and that refresh also refuses for a disabled user. The login half is in `TestLoginFailuresAreIndistinguishable` ("disabled user" case). |
| **AC-13** — `/auth/login` and `/auth/refresh` rate limited per IP | **PASS** | `TestLoginRouteIsRateLimited` drives the **route as registered** and asserts 429 with `AUTH_RATE_LIMITED` past the budget, plus that the usecase ran exactly the allowed number of times. **Mutation-tested** — see below. `TestRefreshHasItsOwnBudget` proves an exhausted login budget does not throttle refresh. |
| **AC-14** — expired rows swept; a recently revoked row is kept | **PASS** | `TestRefreshTokenSweep` seeds five rows (expired, expired+revoked, live, revoked one hour ago, revoked 200 hours ago) and asserts exactly three are removed — with an explicit message on the freshly-revoked case explaining that sweeping it would turn a detectable re-use into an unknown token. A second sweep reports 0. |

## The two things a green test would not have proved

### 1 · The rate limiter was mutation-tested, because it would otherwise have shipped dead

This is the finding two lenses reached independently, and it is the reason
TC-11 is driven through `InitRestAuth` on a real app rather than a hand-built
handler chain.

Fiber v3 runs route handlers **first-argument-first** —
`app.Add` builds the chain as `append([]any{handler}, handlers...)`
(`fiber/v3@v3.4.0/app.go:1095-1097`) — so a *trailing* limiter runs only if the
handler before it calls `c.Next()`, which a login handler that returns a response
never does. Revision 1 of the plan specified exactly that trailing form.

The route was reverted to it and the test failed:

```
--- FAIL: TestLoginRouteIsRateLimited
    auth_test.go:124: over-budget attempt: status = 401, want 429.
```

then restored and re-run green. Without that check the ticket would have shipped
a rate limit that is present in the source, passes review, and never executes —
and a test written against the same assumption would have certified it.

### 2 · The empty-password oracle was closed before it could be measured

`pkg/auth.VerifyPassword` returns false **without calling bcrypt** when the
password is empty (`password.go:82-84`). So `{"username":"admin","password":""}`
would have returned in microseconds for a real user while an unknown username
paid the full ~300ms `DummyVerifyPassword` — defeating AC-4 with the cheapest
possible probe, straight past the countermeasure ticket 22 shipped for it.

`LoginRequest.Validate` now rejects an empty password before any lookup, so the
short-circuit is unreachable from a request.
`TestEmptyPasswordDoesNotSkipTheBcryptCost` asserts that an empty-password probe
costs the same against a known and an unknown user, and that the unknown-user
branch is not far faster than the wrong-password branch — which is what would
show `DummyVerifyPassword` had stopped being called.

## PostgreSQL — NOT RUN, and this is a real gap

**The PostgreSQL half of NFR-5 was not verified.** DNS resolution failed
machine-wide for the whole of this session's verification window:

```
nslookup aws-0-ap-northeast-2.pooler.supabase.com   -> DNS request timed out
nslookup proxy.golang.org                           -> DNS request timed out
nslookup github.com                                 -> DNS request timed out
```

so it is a general network outage on this machine, not something specific to the
database.

**It was retried after the outage partially cleared** — `gh` was able to push the
branch and open the PR — and the database run **still failed**: `nslookup` times
out for every host (`github.com` included), so `git`/`gh` resolved through some
other path (a proxy, or a cached entry) while Go's own resolver, which `lib/pq`
uses, cannot. The gap below therefore stands as written; it is not stale.

The attempted run failed at connect:

```
--- FAIL: TestRefreshTokenRotationIsAtomic
    reach postgres database (CHAT_STORAGE_TEST_POSTGRES_URI): dial tcp 15.165.245.138:5432: ...
--- FAIL: TestRefreshTokenSweep
    reach postgres database (CHAT_STORAGE_TEST_POSTGRES_URI): lookup aws-0-ap-northeast-2.pooler.supabase.com: no such host
```

**What this does and does not mean.** `newTestDB` fails rather than skips when
the URI is set and unreachable, so the gap is visible rather than silently green
— which is the trap ticket 22 recorded (an unset URI makes it fall back to SQLite
*silently*, so a green default run proves nothing about PostgreSQL).

Three things are therefore **unproven on PostgreSQL**:

1. `ClaimRefreshToken`'s conditional `UPDATE ... WHERE revoked_at IS NULL` and its
   `RowsAffected()` semantics — the whole of AC-8.
2. The sweep's `DELETE ... WHERE token_id IN (SELECT ... ORDER BY ... LIMIT ?)`.
3. `time.Time` binding on the four timestamp comparisons.

**Why the risk is nonetheless low, stated rather than assumed.** Every statement
added by this ticket is written in the `?` form the `dbHandle` rewrites
(`dbhandle.go`), uses only constructs already shipped and proven on both engines
by earlier tickets — the conditional-UPDATE-on-rows-affected shape is
`MarkAccountDeviceBlocked`'s, and the `IN (SELECT ... LIMIT)` delete is
`DeleteMessageDebugOlderThanAllDevices`'s, which documents its portability at
`sqlite_repository.go:2678-2683` — and adds no new SQL construct of any kind. No
migration is added, so the schema is unchanged from ticket 22's, which **was**
verified against the live PostgreSQL.

**Required before this reaches production:** re-run, with the network available,

```
CHAT_STORAGE_TEST_POSTGRES_URI=<uri> go test -tags purego -timeout 25m \
  ./infrastructure/chatstorage/ \
  -run 'TestRefreshTokenRotationIsAtomic|TestRefreshTokenSweep|TestCreateAndClaimRefreshToken|TestRevokeRefreshTokenFamily|TestLoadIdentitySnapshot|TestGetUserByUserID'
```

and confirm each reports **PASS, not SKIP**. Run them in small groups: each test
creates, migrates (72 statements) and drops its own schema over the public
internet, and ticket 22 recorded that the whole package does not finish in ten
minutes.

No orphaned `gowa_test_<pid>_<n>` schema was left behind, because `newTestDB`
aborts at `Ping` before `CREATE SCHEMA`. That could not be confirmed against the
server for the same reason the tests could not run.

## E-1 · Escalated, NOT fixed by this ticket — the Supabase `anon` grant

`_specs/z8pmx9m6ae/verify.md:170-240` records that all 29 tables in `public` are
granted `arwdDxtm` to `anon` — the role behind the project's public PostgREST
endpoint — with RLS on **zero** of them, and that `pg_default_acl` grants the same
to every future table. Ticket 22 escalated it, the owner approved remediation,
and applying it was blocked by the environment's safety classifier, so it shipped
open.

**Ticket 22 could tolerate that because nothing read the rows. This ticket makes
those rows the authentication decision.** With the grant open, anyone holding the
project's public anon key can `INSERT` a `refresh_tokens` row carrying a chosen
`token_hash` and the admin's `user_id`, then call `POST /auth/refresh` and receive
an admin access token — no password, no bcrypt, no rate limit. They can equally
`UPDATE users.password_hash` or `INSERT` into `role_permissions`.

Nothing in this ticket's code can fix that, and the remediation SQL is in ticket
22's `verify.md`. It is a **deployment precondition**, not a code change.

I intended to record the current state with a read-only probe of
`has_table_privilege('anon','refresh_tokens','INSERT')`. It was written as a
throwaway test in `infrastructure/chatstorage`, could not run for the same DNS
reason as above, and was **deleted** — it is not in the diff. So the grant state
at delivery is **unknown and must be assumed still open** until checked. Run
before this build first serves traffic:

```sql
SELECT COUNT(*) FROM information_schema.role_table_grants
 WHERE table_schema='public' AND grantee IN ('anon','authenticated');   -- expect 0
SELECT has_table_privilege('anon','refresh_tokens','INSERT');           -- expect false
```

## Amendments to the acceptance criteria, for the owner to overrule

Three ACs were changed after the panel review. Each is flagged because an
acceptance criterion is the owner's, not mine.

- **AC-2 — an absent secret is no longer fatal.** Kept fatal: a secret that is
  *set but shorter than 32 bytes*. Changed: an *absent* secret now boots, logs an
  `ERROR`, and makes `/auth/*` answer `503 AUTH_NOT_CONFIGURED`. The reasoning is
  this repository's own precedent at `cmd/root.go:1384-1389` — ticket 22's
  identity boot is deliberately not fatal because "nothing here is read by any
  route in this ticket … Ticket 24 — the first that actually depends on these
  rows — owns escalating it." This ticket is equally non-enforcing by design, so
  a fatal would buy **zero** attack-surface reduction while crash-looping every
  existing deployment on image update: for a WhatsApp gateway that means dropped
  inbound events and a `/health` probe that never answers. Ticket 24, where JWT
  becomes the enforcer, should escalate it.
- **AC-12 now covers login.** Without it a disabled user could still obtain a
  signed access token and a persisted refresh family; only the middleware would
  have rejected the token, while the refresh row stayed real and usable.
- **AC-14 bounds re-use detection to 48 hours.** Revision 1 kept every spent row
  for the full 30-day refresh lifetime — ~96 rows per day per active session,
  ~2,880 per session, none ever swept. Past the window a replayed token gets a
  plain 401 instead of a family revocation: the token does not work either way,
  what is lost is the detection, and an active session rotates ~192 times in 48
  hours.

## Conclusion

All fourteen acceptance criteria are mapped to executed results and pass. The
suite is green against its recorded baseline, `go vet` is clean, and no
deployment runtime file was touched.

Two items are carried forward and are **not** resolved by this ticket: the
PostgreSQL run (blocked by a network outage, with the exact command recorded) and
the `anon` grant of E-1 (a deployment action the owner must take). Neither is a
defect in the change; both must be closed before this build serves real traffic.
