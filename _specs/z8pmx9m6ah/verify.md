---
ticket: z8pmx9m6ah
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-09-01
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6ah"
  github: ""
---

# Verification — 25 · Scoping and leak closure

Outcome: **PASSED**, with two items explicitly carried forward unresolved (below) and
eight residual risks recorded for the owner.

## Runtime impact statement

**No deployment runtime file changed.** `docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml` and
`.github/workflows/set-latest-tag.yaml` are all absent from the diff. No schema
migration, no data migration, no new configuration key. Rollback is `git revert` of the
single commit; the previous binary behaves exactly as before.

**One behavioural change is a deployment concern and is called out here rather than
buried:** the server now **refuses to boot** if a route naming `:device_id` carries no
ownership guard (AC-16). That is deliberate — it is ticket 24's coverage pattern
extended — but it means a future route added without the guard fails at startup rather
than in review.

## Acceptance criteria

| AC | Result | Evidence |
|----|--------|----------|
| **AC-1** — `accountID` cached; ownership performs zero queries | **PASS** | Cached at `device_instance.go` under the existing mutex; populated at `device_manager.go` `loadFromRegistry` and `CreateDeviceForAccount`, refreshed by `SetDeviceAccount`, backfilled free in `usecase/device.go ListDevices` from rows it already read. Every ownership call site reads `instance.AccountID()` — a field read: `middleware/device.go:101`, `middleware/device_ownership.go:86`, `rest/chatwoot.go:988`, `usecase/device.go:304`, `usecase/app.go:301`. No repository is reachable from any of them. `TestMayAddressDeviceIsPure` |
| **AC-2** — one rule function, `""` is the empty set | **PASS** | `pkg/auth/scope.go`. `TestMayAddressDevice` — 11 cases covering admin+foreign, admin+`""`, user with `""`, user matching, user mismatching, nil, and whitespace |
| **AC-3** — enforced at three call sites incl. the no-id fallback | **PASS** | `DeviceMiddleware` both paths (`device.go`); 9 `/devices/:device_id*` routes carry `owns` (`device.go`); 3 Chatwoot config routes carry `chatwootDeviceGuard` (`cmd/rest.go`) plus `SyncHistory`/`SyncStatus`/`ListChatwootConfigs` in-handler. `TestDeviceMiddlewareChecksTheFallbackPath`, `TestDeviceMiddlewareRefusesAForeignHeaderDevice`, `TestRequireDeviceOwnershipRefusesAForeignDevice` |
| **AC-4** — 404, body identical to a missing device, caller's own string | **PASS** | `middleware.DeviceNotFound`. `TestOwnershipRefusalIsIndistinguishableFromAMissingDevice` (byte equality after normalising the submitted id) and `TestOwnershipRefusalDoesNotDiscloseViaJIDProbe` (the by-JID probe that makes resolved ≠ submitted) |
| **AC-5** — `GET /devices` and `/app/devices` scoped; filter narrows only | **PASS** | `rest/device.go scopeToPrincipal` before `hideAccountFields`; `rest/app.go Devices`. `TestListDevicesIsScopedToThePrincipalsAccount` (3/2/6/0), `TestListDevicesFilterNarrowsAndNeverWidens` |
| **AC-6** — `ListChatwootConfigs` scoped | **PASS** | `rest/chatwoot_config.go`, one index built from a single registry pass. `TestListChatwootConfigsIsAccountScoped` (4 sub-cases) |
| **AC-7** — no debug fields, `?include_debug` ignored, loader **not called** | **PASS** | `usecase/chat.go resolveMessageDebug` returns before `GetMessageDebugExistsBatch`. `TestRedactsAndSkipsForAnUnprivilegedCaller` asserts call counts are 0 |
| **AC-8** — no transcript fields, `GetMessageTranscriptBatch` **not called** | **PASS** | `usecase/chat.go loadTranscripts` returns before the batch. Same test; `TestEachPermissionGatesOnlyItsOwnFields` proves the two permissions are independent |
| **AC-9** — `HasDebug` gains `omitempty` | **PASS** | `domains/chat/chat.go`. `TestHasDebugIsOmittedWhenFalse` |
| **AC-10** — absent principal redacts; MCP unchanged | **PASS** | `TestAbsentPrincipalRedacts`, `TestSystemPrincipalKeepsMCPUnchanged` (which calls the same helper the MCP handlers call) |
| **AC-11** — principal cached per connection; filter reads only that | **PASS** | `ui/websocket/websocket.go handleRegister` snapshots from `conn.Locals`; `shouldDeliver` reads the cached principal and the sender's stamped account. `TestFanOutFiltersByTheRecipientsAccount`, `TestUnstampedBroadcastReachesOnlyOperators` |
| **AC-12** — `FETCH_DEVICES` unicast and filtered | **PASS** | `Target` field, reply routed through the hub. `TestFetchDevicesRepliesOnlyWithTheCallersDevices` |
| **AC-13** — `/message/:message_id/debug` unchanged, no second guard | **PASS** | `git diff` on `ui/rest/message.go` and `usecase/message.go` is **empty**. The route still carries exactly one guard, `Require(PermMessagesDebugRead)` (`message.go:37`) |
| **AC-14** — embedded device lists narrowed and redacted per recipient | **PASS** | `usecase/device.go deviceListPayload`, `usecase/app.go appDeviceListPayload`. `TestDeviceListPayloadNarrowsPerRecipient`, `…HidesTheAccountLayer`, `…DoesNotMutateTheSharedSlice` |
| **AC-15** — build, vet, test pass vs. baseline | **PASS** | Build and vet clean. `go test ./...` **mechanically identical** to the baseline: same 3 packages, same 167 failure lines, same test names |
| **AC-16** — boot refuses an unguarded `:device_id` route | **PASS** | `middleware/coverage.go`. `TestBootPolicyCoverageOnTheRealRouteSet` — and it caught two genuine omissions during implementation |
| **AC-17** — `POST /devices` creates in the caller's own account | **PASS** | `usecase/device.go AddDevice` reads the principal's account. Admin (`""`) and principal-less callers unchanged |

Every acceptance criterion is mapped to an executed result. Verification depth is
`all-ac`, as the workflow form requires.

## Suite comparison

Baseline (unmodified tree) and post-change run, durations normalised away:

```
diff baseline.norm final.norm  →  no output
baseline failure lines: 167     final: 167
```

Same three failing packages, same tests, same leaf failures. 153 of the 167 carry the
literal message `Binary was compiled with 'CGO_ENABLED=0', go-sqlite3 requires cgo to
work`; the remainder are `TestResolveDocumentMIME/Zip`, a Windows MIME-registry
difference. **Zero failures without a pre-existing environmental cause, and none
introduced.**

236 tests pass across the five packages this ticket touches.

## Mutation testing

Six plausible defects injected one at a time; all six detected. Two initially survived
and both were gaps in the TESTS, which is the outcome mutation testing exists to
produce — details and fixes in `implement.md`. A third mutant was withdrawn as
behaviour-equivalent and replaced with a real one.

## Carried forward — NOT resolved

1. **`-race` could not be run.** It requires cgo and this machine has no C compiler.
   The WebSocket change is the one that would most benefit from it. The single-writer
   invariant is therefore argued structurally — every write happens on the `RunHub`
   goroutine, and the `FETCH_DEVICES` reply travels the `Broadcast` channel with a
   `Target` precisely so that stays true — rather than demonstrated. All three panel
   lenses independently identified the naive version (writing from the reader
   goroutine) as a process-killing panic, so this is the change that most deserves a
   race run before it reaches production.
2. **No live boot.** AC-16 rests on `TestBootPolicyCoverageOnTheRealRouteSet`, which
   mirrors `cmd/rest.go` rather than being it. The mirror caught two real omissions,
   which is some evidence it is faithful, but it is still a mirror.

## Residual risks for the owner

1. **The WebSocket principal is fixed for the life of the connection.** A disable, a
   role change or a token-epoch bump does not reach an already-open socket until it
   reconnects, while REST re-reads the cache every request. AC-11 asks for exactly this
   ("stores its `Principal` at handshake"), and the performance lens suggested
   re-resolving per fan-out; that was declined as an AC deviation and is recorded here
   instead. **Worth a follow-up ticket.**
2. **Ticket 26 must require a non-blank account for non-admin roles.** `users.account_id`
   defaults to `''`, and a `''` principal addresses the empty set — so the first user
   created with the column default will see an empty fleet and 404s indistinguishable
   from "no device". Inert today (the bootstrap admin is the only user and holds
   `accounts.manage`), and a trap the moment ticket 26 ships.
3. **`POST /devices` now takes the strict creation path for a non-admin.** A non-empty
   account routes through `CreateDeviceForAccount`'s three guards — a pre-existing row
   is refused rather than silently taken over, a persist failure is surfaced, the
   account is verified by read-back. Better behaviour, but different: a user retrying a
   creation that half-failed will now see an error where an admin would not.
4. **Ownership refusals are indistinguishable from missing devices by design**, which
   is also true for support. A user reporting "my device is gone" cannot be told apart
   from a misconfigured account without server-side logs. Refusals are logged at debug.
5. **The public Chatwoot webhooks are still unscoped and still fail open** with no
   `CHATWOOT_WEBHOOK_SECRET`. They carry no principal, so scoping is meaningless rather
   than deferred — but they remain the only unauthenticated path that can cause an
   outbound WhatsApp send. Recorded by ticket 24, closed by neither.
6. **`/devices/:device_id/chatwoot/config` still needs `X-Device-Id`** in a
   multi-device deployment, because those routes sit below the header device group.
   Pre-existing, untouched (fixing it means reordering registrations), and now written
   down in `plan.md` Finding D.
7. **`/ws` sits inside the device-scoped group**, so in a single-device deployment whose
   device belongs to another account the handshake is refused 400 before the
   per-connection filter is ever reached. Accepted; same root cause as 6.
8. **`GET /app/devices` was scoped although no shipped AC asked for it** (Deviation 9).
   If the owner considers that out of scope it is a three-line revert in
   `ui/rest/app.go`.

## What this ticket does NOT close

Isolation *within* an account (users sharing an account see the same data), the
`devices.account_id` model itself, `/statics` hardening, and user administration —
all out of scope per `spec.md`.
