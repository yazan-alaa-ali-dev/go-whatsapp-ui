---
ticket: z8pmx9m6af
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-08-31
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6af"
  github: ""
---

# Specification — 23 · Login and tokens

## Business goal

Make it possible to **obtain and verify a token**. Today the only credential this
gateway understands is a flat `APP_BASIC_AUTH` list: one shared password, no
identity, no roles, no revocation, and a base64 string that never expires sitting
in every browser's WebSocket URL. Ticket 22 shipped the identity rows; nothing
reads them. This ticket is the first that turns a stored identity into a request
the server can attribute to a person.

It deliberately **identifies without denying**. Basic auth stays the enforcer
until ticket 24 replaces it, so there is no commit at which neither mechanism
guards the routes.

## User story

As an operator of a shared gateway, I want each person to log in with their own
username and password and receive a short-lived token, so that disabling one
person or lowering their role takes effect at once instead of requiring a
password rotation that logs everybody out.

## Functional requirements

- **FR-1** — A token service signs and verifies access tokens with HS256, with the
  algorithm **pinned at verification**, and rejects any token presenting another
  `alg`.
- **FR-2** — The server validates the signing secret at start-up and refuses to
  serve the REST API with a secret that is absent or too short.
- **FR-3** — `POST /auth/login` exchanges a username and password for an access
  token, a refresh token, the access token's lifetime, and a view of the user
  that carries no credential material.
- **FR-4** — A failed login is indistinguishable between "no such user" and
  "wrong password", in body, code and elapsed time.
- **FR-5** — `POST /auth/refresh` exchanges a refresh token for a new pair,
  rotating the presented token, and detects re-use of an already-rotated token by
  revoking the whole rotation lineage.
- **FR-6** — `POST /auth/logout` revokes the presented token's whole lineage.
- **FR-7** — `GET /auth/me` returns the caller's principal and its effective
  permissions.
- **FR-8** — A global middleware turns a bearer token into a principal on the
  request context and passes anonymous requests through untouched.
- **FR-9** — A user's role, account and status are resolved from an in-memory
  snapshot rather than from the token, so a change takes effect without waiting
  for the token to expire.
- **FR-10** — Expired refresh-token rows are removed periodically.

## Non-functional requirements

- **NFR-1** — A verified request performs **no database query** for
  authentication.
- **NFR-2** — The credential-bearing endpoints are rate-limited per client IP, so
  the cost of a bcrypt verification cannot be used to starve the WhatsApp event
  goroutines that share this process.
- **NFR-3** — No credential, secret, token or hash is written to a log, an error
  message, or a response body.
- **NFR-4** — Every existing route keeps its present behaviour and its present
  guard. The change adds a middleware that identifies; it removes nothing.
- **NFR-5** — Every new statement runs unmodified on both SQLite and PostgreSQL,
  the two backends this repository supports.
- **NFR-6** — Rotation is safe under concurrency: two simultaneous presentations
  of one refresh token cannot both succeed.

## Constraints

- **C-1** — `pkg/auth` is a **leaf**: it imports nothing from this repository.
  Ticket 24 wires a permission constant into every handler package, and a leaf
  cannot be one half of an import cycle with any of them. Anything that
  orchestrates over `IChatStorageRepository` belongs in `usecase/`, as ticket 22
  established for the seeder.
- **C-2** — The refresh-token table, its three indexes and the rotation invariant
  shipped with ticket 22 (migrations 69-72). This ticket **adds no migration**.
- **C-3** — Deployment runtime files (`docker-compose.yml`, `docker/`,
  `.github/workflows/`) are not touched.
- **C-4** — Basic auth is not removed, altered or made conditional. `Require()`,
  the route policy and the boot-time coverage assertion belong to ticket 24.
- **C-5** — A secret is read at its call site and passed as an argument; it is
  never parked in a `config` global and never given a cobra flag, because a flag
  puts a secret into `ps` output and shell history (the rule ticket 22 set for
  `AUTH_BOOTSTRAP_ADMIN` and ticket 14 set for `CHAT_STORAGE_URI`).

## Acceptance criteria

| ID | Criterion | Requirement |
|----|-----------|-------------|
| **AC-1** | `github.com/golang-jwt/jwt/v5` is a **direct** dependency, and every verify call pins the algorithm with `jwt.WithValidMethods([]string{"HS256"})`. A token signed with `alg: none` or with `RS256` is rejected. | FR-1 |
| **AC-2** | A JWT secret that is **present but shorter than 32 bytes** makes the REST server **refuse to boot** (`logrus.Fatalln`). An **absent** secret is not fatal: the server boots, logs an `ERROR`, and every `/auth/*` route answers `503 AUTH_NOT_CONFIGURED`. *(Amended from the ClickUp AC after panel review — see `plan.md > §8` and `> D-2`. The fatal half is kept where it has a security argument: a weak secret is worse than none. The absent half would crash-loop every existing deployment on upgrade while buying nothing, because this ticket does not enforce; ticket 24, which does, escalates it.)* | FR-2 |
| **AC-3** | `POST /auth/login` with valid credentials returns `{access_token, refresh_token, expires_in, user}`, and `user` never contains `password_hash`. | FR-3 |
| **AC-4** | An unknown username and a wrong password return the **same** status, code and message, and the elapsed time does not distinguish them. | FR-4 |
| **AC-5** | The access token carries `sub`, `role`, `account_id`, `epoch`, `jti`, `iat`, `exp`, `iss`, and expires after the configured access TTL (default 15m). | FR-1 |
| **AC-6** | The refresh token is 32 random bytes, stored **only** as its SHA-256 digest, expires after the configured refresh TTL (default 720h), and is **rotated on every use**: the presented row is revoked and a new one issued in the same family. | FR-5 |
| **AC-7** | Presenting an already-rotated refresh token revokes **every** token in that `family_id` and answers 401. | FR-5 |
| **AC-8** | Rotation is atomic: two concurrent refreshes with the same token yield exactly one success and one 401, decided by a conditional `UPDATE ... WHERE revoked_at IS NULL` on rows-affected. | NFR-6 |
| **AC-9** | `POST /auth/logout` revokes the whole family; `GET /auth/me` returns the principal and its **effective permissions** — 25 for `admin`, 9 for `user`. | FR-6, FR-7 |
| **AC-10** | `Authenticate` is installed with `app.Use` **unconditionally** — not inside `if len(config.AppBasicAuthCredential) > 0` — builds a `Principal{UserID, Role, AccountID, Permissions}` into `c.Locals` and the request context, and, in this ticket only, calls `c.Next()` for anonymous requests rather than denying. | FR-8, NFR-4 |
| **AC-11** | Role, account and status are read from an in-memory principal cache, not from the token claims; the cache is rebuilt on every write to `users`, `user_roles` or `role_permissions`. A verified request performs **zero** database queries. | FR-9, NFR-1 |
| **AC-12** | A user whose `status` is not `active`, or whose `token_epoch` differs from the token's `epoch` claim, is rejected at **verify**, at **refresh**, and at **login**. *(Login added after panel review: without it a disabled user still obtains a signed access token and a persisted refresh family — see `plan.md > §5`.)* The login check runs **after** the bcrypt comparison, so it introduces no new timing oracle, and returns the same generic failure. | FR-9 |
| **AC-13** | `/auth/login` and `/auth/refresh` are rate-limited per client IP. | NFR-2 |
| **AC-14** | Expired `refresh_tokens` rows are swept periodically. A **revoked** row is kept for a bounded re-use-detection window (48h) rather than until its natural expiry — long enough that a replayed token is still detected, short enough that a continuously active session does not accumulate ~2,880 undeleted rows over 30 days. Beyond that window a replayed token gets a plain 401 instead of a family revocation: the token does not work either way, what is lost is the detection. *(Amended after panel review — `plan.md > §7`.)* | FR-10 |

## Test cases

| ID | AC | Action | Expected |
|----|----|--------|----------|
| **TC-1** | AC-1 | Craft tokens with `alg: none` and with `RS256`, plus an HS256 token signed with the wrong secret, and present them. | All rejected. Only a correctly signed HS256 token is accepted. |
| **TC-2** | AC-2 | Call the secret validator with `""`, with a 16-byte value and with a 32-byte value; and construct the token service with each. | `""` reports *absent* (503 path, not fatal); 16 bytes reports *too short* (fatal path); 32 bytes succeeds. The constructor returns an error rather than a service for the first two, so a verifier keyed on a weak or empty secret cannot exist. |
| **TC-3** | AC-3 | Log in as the bootstrap admin against a migrated database. | 200, all four fields present, and the serialised body contains neither `password_hash` nor the hash's bytes. |
| **TC-4** | AC-4 | Log in with an unknown user, then with a known user and a wrong password. | Identical status, code and message; both paths perform exactly one bcrypt comparison. |
| **TC-5** | AC-5 | Decode the returned access token. | All eight claims present; `exp - iat == 900` at the default TTL; `iss` matches the configured issuer. |
| **TC-6** | AC-6, AC-7 | Refresh once (succeeds), then present the **original** refresh token again. | The second call answers 401, and every row sharing that `family_id` has `revoked_at` set. |
| **TC-7** | AC-8 | Fire two refreshes with the same token concurrently. | Exactly one success and one failure. |
| **TC-8** | AC-9 | Read the effective permissions of the `admin` role and of the `user` role through the service. | 25 and 9 respectively; logout revokes every row of the family. |
| **TC-9** | AC-11 | Verify a token against a repository that fails every call. | Verification succeeds — proof that the path issues no query. |
| **TC-10** | AC-12 | Set the user's `status` to `disabled`, then bump `token_epoch`, while a valid access token is outstanding. | Verification fails immediately in both cases, and refresh fails, with distinct internal errors. |
| **TC-11** | AC-13 | Drive the login route past its configured per-IP budget. | The over-budget request is refused with 429 while a different IP is unaffected. |
| **TC-12** | AC-10, NFR-4 | Run `go build ./...`, `go vet ./...` and `go test -tags purego ./...`; call an existing route through a Fiber app carrying `Authenticate` with no bearer token. | The suite is green against the recorded baseline, and the route answers exactly as it does without the middleware. |
| **TC-13** | AC-14 | Insert an expired row, a freshly-revoked row, and a revoked row older than the re-use window, then sweep. | The expired row and the old revoked row are deleted; the freshly-revoked row survives, so re-use detection still works inside the window. |
| **TC-14** | AC-4, AC-12 | Log in with an empty password against an existing user; and log in with correct credentials as a `disabled` user. | Both are refused with the same generic 401 as an unknown user. The empty-password probe must not return measurably faster than an unknown-user probe — the oracle `VerifyPassword`'s empty-input short circuit would otherwise open. |

## Out of scope

- Removing, altering or conditioning basic auth (ticket 24).
- `Require()`, the route to permission policy, and `AssertPolicyCoverage` (ticket 24).
- Device ownership scoping, field redaction and WebSocket token scoping (ticket 25).
- User administration endpoints — create, disable, change role (ticket 26).
- Any migration. The identity and refresh-token schema shipped with ticket 22.
- The `gowa-ui` dashboard's own login screen.
