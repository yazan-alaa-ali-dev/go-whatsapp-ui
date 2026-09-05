---
ticket: z8pmx9m6ag
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-09-01
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6ag"
  github: ""
---

# Verification — 24 · Enforcement

**Outcome: PASSED**, with two items carried forward and explicitly **not**
resolved (§ Carried forward). Three acceptance criteria were amended and one
added after the review panel; all four are flagged in `spec.md` for the owner to
overrule.

## Runtime impact

**Yes — this ticket changes runtime behaviour, deliberately and irreversibly.**
It is the enforcement ticket: every non-public route now refuses a caller who
lacks its permission, HTTP basic auth is gone, and `gowa rest` will not start
without `AUTH_JWT_SECRET`. Rollback is redeploy-the-previous-binary; there is no
configuration-level rollback, which is constraint C-1's accepted cost.

**No deployment runtime file was modified.** Verified:
`git status --porcelain docker-compose.yml docker/ .github/workflows/` returns
nothing.

## Validation commands

Run from `src/`:

```
go build ./...   OK
go vet  ./...    OK
go test ./...    3 packages FAIL, 160 leaf failures — IDENTICAL to baseline
```

The suite comparison is mechanical, not visual:

| | Baseline | After |
|---|---|---|
| Failing packages | `infrastructure/chatstorage`, `infrastructure/whatsapp`, `usecase` | same three (`diff` of sorted `FAIL` lines: empty) |
| Leaf failures | 160 | 160 |
| `go-sqlite3 requires cgo` messages | 153 | 153 |
| Failures without a cgo cause | 0 | 0 |

All 160 are one environmental cause: no C compiler on this machine, so
`CGO_ENABLED=0` and `go-sqlite3` compiles to a stub. **This ticket introduced no
new failure.**

The three packages it touches are green and were green at baseline:

```
ok  ui/rest              ok  ui/rest/middleware              ok  cmd
115 tests pass, 0 fail
```

## Acceptance criteria

| AC | Result | Evidence |
|----|--------|----------|
| **AC-1** — `Require(permission)` on every non-public route, positioned so it executes; no prefix or group change | **PASS** | 95 `middleware.Require(...)` call sites; guard is the **first** handler everywhere. `TestEveryRouteRequiresExactlyItsSection06Permission` fails if any guard is trailing or absent — proved by mutation (below). `TestAccountGuardDoesNotLeakOntoLaterRoutes` pins that no group structure changed. |
| **AC-2** — boot assertion after registration, before `Listen`; `logrus.Fatalln` naming method and path | **PASS** | `middleware.AssertPolicyCoverage(app, config.AppBasePath)` is the last statement before `Listen` (`cmd/rest.go:308`). `TestCoverageReportsAnUnguardedRoute` (TC-1) asserts it names the exact offending method and path; `TestBootPolicyCoverageOnTheRealRouteSet` (TC-2) runs it over the real route set under two base paths and confirms >100 routes are all classified. |
| **AC-3** — the public allowlist is exactly the enumerated set, `/` exact not prefix | **PASS** *(amended: 8 entries)* | `TestCoverageAllowlistIsExactNotPrefix` — the seven original entries pass, and an unguarded `/chats` is still reported, proving `/` is not matched as a prefix. `POST /auth/logout` is the eighth (D-6). |
| **AC-4** — mapping matches §06 of the reference document | **PASS** *(amended: 23 of 25)* | `TestEveryRouteRequiresExactlyItsSection06Permission` drives all 89 rows with a principal holding every permission **except** the expected one and requires `403 PERMISSION_DENIED`. `TestSection06CoversEveryRegisteredRoute` walks router→table so a new route cannot be silently untested. `messages.transcript.read` and `users.manage` have no route to map. |
| **AC-5** — `user` token gets 403 on every `/send/*` and on the three `/chat/:jid/*` writes, and is not refused `GET /chats` | **PASS** | `TestUserRoleIsRefusedEverySendRoute`, built from `pkgAuth.UserPermissions()` rather than a literal list, so widening the role is felt here. |
| **AC-6** — unauthenticated 401, authenticated-but-unprivileged 403, never conflated | **PASS** | `TestRequireSeparates401From403`, `TestAnonymousAndUnprivilegedAreNeverConflated`, `TestAccountRoutesRefuseAnonymousCallers` (401) vs `TestAccountRoutesRefuseCallersWithoutAccountsManage` (403). Assertions key on the codes `UNAUTHENTICATED` / `PERMISSION_DENIED`, not the status alone. |
| **AC-7** — basic auth completely removed; repo-wide grep returns nothing | **PASS** | `grep -rn "AppBasicAuthCredential\|basicauth" --include=*.go src/` → **0 matches**. `newBasicAuthMiddleware`, `WebsocketQueryAuth`, `RequireBasicAuthConfigured`, `AppBasicAuthCredential`, the `--basic-auth`/`-b` flag and the `app_basic_auth` viper binding are all gone; the five remaining textual hits are comments recording what was removed. Setting `APP_BASIC_AUTH` now does nothing — nothing reads the name. |
| **AC-8** — all five basic-auth-keyed guards converted | **PASS** | `/accounts/*` → `accounts.manage` (per route, not on the group); `accountLayerVisible(c)` → `accounts.manage` on the principal (`TestListDevicesPublishesTheAccountWhenAuthIsConfigured` / `...Hides...` / `TestListDevicesRefusesTheFilterWithoutAuth`, now 403); agent toggle → `admin.debug.toggle` (`TestAgentToggleRefusesAnonymousCallers`); retention → `admin.retention.run` (`TestRetentionRunRefusesAnonymousCallers`); `cmd/root.go` warning rewritten to name `AUTH_JWT_SECRET`. |
| **AC-9** — audit actor from the `Principal`; all nine lines record a real `user_id` | **PASS** | `auditActor(c)` returns `principal.UserID`. `TestAccountAuditActorIsTheUserID` asserts it at the REST edge; `TestAgentToggleWritesAuditLine` and `TestAgentToggleAuditLineResistsLogInjection` assert the emitted line carries the user id. `usecase/account.go` is unchanged — its nine call sites already read the context value. |
| **AC-10** — `/ws` uses `?access_token=`; `?authorization=` no longer accepted | **PASS** | `TestWebsocketAccessTokenQuery`: the token is promoted to `Authorization: Bearer`, the parameter is stripped afterwards, `?authorization=` is ignored, a non-upgrade request is untouched, and an existing header wins. |
| **AC-11** — no valid token cannot reach a non-public route; refused 401 before any handler | **PASS** *(via `Require`, deviation D-5)* | `Authenticate` stays identify-only; the 401 is `Require`'s, and AC-2 guarantees every non-public route carries one. `TestDeviceMiddlewareDefersToTheGuardForAnonymousCallers` covers the ~75 routes where this was false before the fix. |
| **AC-12** — `.env.example`, `README.md` **and `docs/openapi.yaml`** no longer document `APP_BASIC_AUTH` | **PASS** *(amended)* | `.env.example`: variable removed, a new "Enforcement" section documents the public routes and an ordered upgrade path. `readme.md`: 0 basic-auth mentions except the one line saying the flag no longer exists. `docs/openapi.yaml`: 0 mentions — `basicAuth` scheme deleted, global `security` is `bearerAuth`, the nine account `503 ACCOUNTS_AUTH_REQUIRED` responses rewired to `403 PermissionDenied`, and new `Unauthenticated` / `PermissionDenied` responses added. YAML parses; **no dangling `$ref`**. |
| **AC-13** — `gowa rest` refuses to start without `AUTH_JWT_SECRET` | **PASS** *(added)* | `cmd/rest.go:69-72` — `logrus.Fatalln` naming the variable and the generation command, placed in `restServer` and not in `initAuthUsecase` so `gowa mcp` still boots without a secret it does not use. |

## Test cases

| TC | Result | Note |
|----|--------|------|
| TC-1 (AC-2) | PASS | `TestCoverageReportsAnUnguardedRoute` |
| TC-2 (AC-2) | PASS | `TestBootPolicyCoverageOnTheRealRouteSet`, base path `""` and `/gowa` |
| TC-3 (AC-3) | PASS | `TestCoverageAllowlistIsExactNotPrefix` — classifier level, which is where the risk is; a routing-level test would not have caught a prefix-matched `/` |
| TC-4 (AC-5) | PASS | `TestUserRoleIsRefusedEverySendRoute` |
| TC-5 (AC-6) | PASS | `TestAnonymousAndUnprivilegedAreNeverConflated` |
| TC-6 (AC-7) | PASS | grep returns 0; `APP_BASIC_AUTH` is unread, so a deployment that still sets it behaves identically |
| TC-7 (AC-8) | PASS | The four surfaces answer 401/403, never 503-for-a-missing-credential; `GET /devices` still populates the three routing fields for a caller holding `accounts.manage` |
| TC-8 (AC-9) | PASS | `TestAccountAuditActorIsTheUserID` |
| TC-9 (AC-10) | PASS | `TestWebsocketAccessTokenQuery` |
| TC-10 (AC-4) | PASS | Proved **behaviourally**, not by reading a label — see `spec.md` and the header of `policy_matrix_test.go` for why the label cannot be read back |
| TC-11 (AC-1, AC-11) | PASS | Manual mutation check, four defects, all detected — table below |
| TC-12 (NFR-5) | PASS | build / vet / test, compared mechanically against baseline |
| TC-13 (AC-13) | PASS | Code inspection of `cmd/rest.go:69-72`; not automated (see Carried forward) |

## Mutation checks — the reason to believe the green suite

| Defect introduced | Detected by |
|---|---|
| Guard moved to the **trailing** position on `/send/message` — exactly what §05 of the reference document prescribes | `TestEveryRouteRequiresExactlyItsSection06Permission` ✓ |
| `DeviceMiddleware`'s deferral removed | `TestDeviceMiddlewareDefersToTheGuardForAnonymousCallers` ✓ |
| Guard removed from `GET /chats` | `TestEveryRouteRequiresExactlyItsSection06Permission` ✓ |
| `Require` made to check a fixed permission instead of its argument | `TestEveryRouteRequiresExactlyItsSection06Permission` ✓ |

The first is the one that justifies the effort: it is the code the reference
document tells you to write, it passes a boot-coverage assertion, and it enforces
nothing. Without this check it would have shipped green.

## Carried forward — NOT resolved

1. **`go test -race` was not run.** `-race` requires cgo and this machine has no
   C compiler. The ticket adds one concurrency point — two mutex-guarded maps
   written during route construction. `TestGuardIsSafeToConstructConcurrently`
   drives it with 64 goroutines but cannot detect a race without the detector.
   Run on a cgo-capable machine before merge:
   ```
   cd src && CGO_ENABLED=1 go test -race ./ui/rest/... ./cmd/...
   ```
   The same limitation leaves the three sqlite-backed packages untested here,
   exactly as at baseline.

2. **No live boot.** Nothing in this environment can start `gowa rest` against a
   database, so AC-2's `Fatalln` and AC-13's startup refusal are verified by
   `PolicyCoverageViolations` over the real route set plus code inspection, not
   by watching a process exit. `TestBootPolicyCoverageOnTheRealRouteSet` mirrors
   `cmd/rest.go`'s registration; if that mirror ever drifts, the real boot
   assertion is what catches it — loudly, before `Listen`.

## Residual risks the owner is being asked to accept

These are decisions, not defects. Each is recorded at the code site as well.

1. **The dashboard breaks on deploy.** `gowa-ui v1.6.0` sends
   `Authorization: Basic` and opens the WebSocket with `?authorization=`. A UI
   release with a login screen must ship first, or an interface outage must be
   accepted. The REST API stays fully usable with `curl` and tokens.
2. **`--basic-auth` / `-b` is now a crash-loop, not a warning.** Cobra exits
   non-zero on an unknown shorthand, so every launcher still passing it must be
   updated in the same deployment.
3. **`AUTH_JWT_SECRET` is mandatory for `gowa rest`.** Deliberate (AC-13).
4. **Do not create non-admin users until ticket 25.** The `user` role holds
   `devices.pair`, `devices.read` and `devices.create`, and
   `/devices/:device_id/{login,logout,reconnect}` carry no ownership scoping — so
   an ordinary user could pull another tenant's pairing QR or force-logout their
   number. Basic auth hid this because every authenticated caller was effectively
   admin; this ticket creates the first real privilege boundary and does not
   scope it. **Ship admin-only.**
5. **The Chatwoot webhook still fails open** with an empty
   `CHATWOOT_WEBHOOK_SECRET`, and AC-3 permanently allowlists it — it is now the
   only unauthenticated path that can cause an outbound WhatsApp send. A loud
   boot warning was added; making it fatal is a separate ticket because doing it
   here would break every existing Chatwoot deployment on upgrade.
6. **`/statics` stays public** and serves per-tenant media. The allowlist entry
   carries the deferral inline, at the one place that grants it.
7. **`?access_token=` in a URL** reaches proxy logs, browser history and
   `Referer`. Verified it is *not* leaked by this repo's own logger
   (`logger.New()` formats `${path}`, which excludes the query string), and the
   parameter is stripped after promotion — but an upstream proxy has already seen
   it. A short-lived single-use `ws` ticket is the real fix, and is a ticket.
8. **`gowa mcp` remains entirely unauthenticated.** It runs an SSE server, not
   Fiber, and none of this reaches it. Declared out of scope in `spec.md` rather
   than left unsaid — after this ticket the REST surface is locked while MCP is
   an open send path.

## Amended and added acceptance criteria — for the owner to overrule

- **AC-3**: 7 → 8 allowlist entries (`POST /auth/logout`).
- **AC-4**: 25 → 23 permissions (two have no route).
- **AC-12**: extended to `docs/openapi.yaml`.
- **AC-13**: added (fatal without `AUTH_JWT_SECRET`).

Each carries its reasoning inline in `spec.md`. If the owner rejects any of them,
the change is small and local in every case.
