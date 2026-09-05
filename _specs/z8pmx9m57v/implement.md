---
ticket: z8pmx9m57v
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-08-30
links:
  clickup: "https://app.clickup.com/t/z8pmx9m57v"
  github: ""
---

# Implementation — 21 · Make the account a real owner of devices

Applied on branch `ticket/z8pmx9m57v`, cut from the tip of `ticket/z8pmx9m4nd` —
the only place the account layer of tickets 16-19 exists (`main` does not carry
it). The PR therefore targets that branch, not `main`.

## Files changed

### New (6, all tests)

| File | What it pins |
|------|--------------|
| `src/infrastructure/whatsapp/device_manager_account_test.go` | the three guards on the account creation path, and that the legacy path keeps its old behaviour including its error tolerance |
| `src/usecase/account_lifecycle_test.go` | create-in-account, and the whole cascade: refusal, count mismatch, order, partial failure, late attach, expired deadline, per-device budget |
| `src/usecase/device_routing_test.go` | the routing merge, the filter, the **call counts**, and the degrade/fail asymmetry |
| `src/ui/rest/device_account_test.go` | the visibility gate — the account layer is invisible on `/devices` without basic auth |
| `src/ui/rest/account_lifecycle_test.go` | the three routes, both 409 codes, and the cascade parameter decoding |
| `src/infrastructure/chatstorage/sqlite_repository_account_lifecycle_test.go` | the widened INSERT and the conditional DELETE, against a **real** database |

38 test functions in total.

### Modified (14)

| File | Change |
|------|--------|
| `src/domains/chatstorage/interfaces.go` | `DeleteAccountIfEmpty` declared; `ErrAccountHasDevices`, `ErrAccountDeviceCountMismatch`, `ErrDeviceExists` added beside the existing account errors |
| `src/infrastructure/chatstorage/account_repository.go` | `DeleteAccountIfEmpty` — one conditional `DELETE … WHERE NOT EXISTS` |
| `src/infrastructure/chatstorage/sqlite_repository.go` | `SaveDeviceRecord`'s **INSERT** branch carries `account_id`; the UPDATE branch untouched |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | `DeleteAccountIfEmpty` pass-through (build-critical) |
| `src/infrastructure/whatsapp/device_manager.go` | `CreateDeviceForAccount` with its three guards; `CreateDevice` is now a one-line wrapper |
| `src/domains/device/device.go` | `Device` gains `AccountID`, `Priority`, `SendState` |
| `src/domains/device/interfaces.go` | `ListDevices(ctx, accountID)`; `AddDeviceInAccount` |
| `src/usecase/device.go` | the routing merge on both reads, `applyDeviceRouting`, `addDevice` as the one creation body, and the logout broadcast reusing `ListDevices` |
| `src/domains/account/account.go` | `CreateDeviceRequest`, `DeleteAccountResult` |
| `src/domains/account/interfaces.go` | `CreateDevice`, `ListDevices`, `DeleteAccount` |
| `src/usecase/account.go` | the three operations, the cascade, `finishAccountDelete`, `accountDevicePurgeBudget` |
| `src/ui/rest/account.go` | three routes, three handlers, three error mappings |
| `src/ui/rest/device.go` | the `account_id` filter and the visibility gate |
| `src/cmd/root.go` | wiring, and the rationale comment that the cascade made false |
| `readme.md` | an "Accounts and devices" section plus eight endpoint-table rows |
| `docs/openapi.yaml` | three paths, one query parameter, three `DeviceInfo` fields, `DeleteAccountResponse` |

Two files in the working tree — `src/infrastructure/whatsapp/event_message_handler.go`
and `src/infrastructure/whatsapp/transcription.go`, plus `src/go.mod`/`go.sum` —
carry **ticket `z8pmx9m4nd`'s uncommitted STT work**. They are not this ticket's,
were not touched, and are not staged.

## What the change does

1. `POST /accounts/:account_id/devices/create` creates a device the account owns
   from its first stored row. The account is confirmed to exist before anything is
   created; a device id that already exists as a row is refused with 409.
2. `GET /accounts/:account_id/devices` reads those devices in reply order —
   authoritative, because it reads the rows the reply path reads.
3. `DELETE /accounts/:account_id` refuses while the account owns devices;
   `?purge_devices=true&expected_devices=N` purges them through the existing device
   purge and then deletes the account, atomically and only while it is empty.
4. `GET /devices` and `GET /devices/:device_id` report `account_id`, `priority`
   and `send_state`, and the list accepts `?account_id=`.
5. None of that is visible when the deployment has no `APP_BASIC_AUTH`.

## Deviations from the plan

Five, all small, and each one found while writing the code rather than the plan.

- **D-1 · `ErrDeviceExists` was not in the plan.** The plan said the account path
  would "refuse a pre-existing row with a 409" without naming the error. Reusing
  a `fmt.Errorf` would have made the REST layer answer 500, since `accountError`
  maps sentinels, not strings. Added as a sentinel beside the others.
- **D-2 · `DeleteAccountIfEmpty`, not `DeleteAccount`.** The plan named the
  repository method `DeleteAccount`. It is named for its guard instead, so no
  caller can hold it as an unconditional delete — the property the whole cascade
  ordering depends on.
- **D-3 · An empty body is accepted on the create route.** Fiber cannot decode a
  body with no content type, so binding unconditionally made
  `curl -X POST …/devices/create` — the simplest and most likely call, with the id
  generated — answer 400. The bind is skipped when the body is empty. Found by a
  test, not by review; the test is kept.
- **D-4 · `docs/openapi.yaml` was added to the change set.** Not in revision 1 at
  all: the account endpoints have been specified there since ticket 16, so
  documenting only `readme.md` would have left the machine-readable spec stale for
  three new routes and three new fields.
- **D-5 · The device response sets `AccountID` on the creation path directly.**
  `convertInstance` reads the in-memory instance, which has no account, so the
  device returned by `addDevice` would otherwise report an empty account it
  demonstrably has. The read paths still take it from storage.

## The baseline, measured before the first edit

- `go build -C src ./...` — clean.
- `go vet -C src ./...` — clean.
- `go test -C src ./...` — **132 distinct failing tests**, every one of them
  `Binary was compiled with 'CGO_ENABLED=0', go-sqlite3 requires cgo to work`.
  There is no gcc on this host.

## The discovery that made validation real

`readme.md` documents a **`purego`** build tag ("a pure-Go SQLite implementation",
for ARM builds without a C toolchain). Under `-tags purego` the sqlite-backed tests
run for real on this host:

```
go test -C src -tags purego ./...
```

The baseline's 132 cgo-stub failures are not failures at all under that tag — the
whole suite passes except one long-standing Windows MIME difference. Every
acceptance criterion in this ticket is therefore validated against a **real
SQLite database**, not a stub, and the earlier tickets in this series recorded
their storage assertions as unverifiable on this host without needing to.

## Validation run

| Command | Result |
|---------|--------|
| `go build -C src ./...` | clean |
| `go vet -C src ./...` | clean |
| `go test -C src -tags purego ./...` | **1 failure**: `TestResolveDocumentMIME/Zip` — pre-existing, documented in four earlier tickets' `verify.md` (Windows resolves `.zip` differently) |
| `go test -C src ./...` (default, no cgo) | 137 distinct failures = the 132 baseline + the 5 new sqlite-backed tests, which hit the same stub. All 5 pass under `purego`. |

## Mutation check — the new tests are not decorative

Each guard was broken deliberately, the test re-run, and the code restored.

| Mutation | Test | Result |
|----------|------|--------|
| The pre-existing-row check disabled in `CreateDeviceForAccount` | `TestCreateDeviceForAccountRefusesAnExistingRow` | **FAILED** as required |
| `DELETE … NOT EXISTS` replaced with an unconditional delete | `TestDeleteAccountIfEmptyRefusesWhileADevicePointsAtIt` | **FAILED** as required |
| The `ctx.Err()` check removed from the cascade loop | `TestDeleteAccountCascadeStopsWhenTheRequestDeadlineExpires` | **FAILED** as required |
| `accountLayerVisible()` forced to `true` | `TestListDevicesHidesTheAccountWhenNoAuthIsConfigured`, `TestListDevicesRefusesTheFilterWithoutAuth` | **both FAILED** as required |

After restoring all four, the suite returned to its single pre-existing failure.

## The database reset (AC-18)

The local `storages/chatstorage.db` was inspected before anything was written. It
holds **11 tables, no `accounts` table, no `devices.account_id` column and zero
device rows** — it predates migrations 51+ entirely and has never been through the
account layer. There is nothing to delete, so **no statement was run and no backup
was needed**; the reset script refused to touch it rather than "succeeding"
vacuously. The procedure for a deployment database is recorded in `verify.md`.
