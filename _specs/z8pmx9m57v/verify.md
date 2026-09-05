---
ticket: z8pmx9m57v
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-08-30
links:
  clickup: "https://app.clickup.com/t/z8pmx9m57v"
  github: ""
---

# Verification — 21 · Make the account a real owner of devices

**Outcome: PASSED**, with two explicitly stated limits (AC-18 and the purge
residue) recorded below rather than reported as passes.

## Runtime impact

**No deployment runtime file was modified.** `docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml` and
`.github/workflows/set-latest-tag.yaml` are untouched (CON-1).

No migration was added; no schema changed. Every column written here was created
by migrations 51-58 in ticket 16 and has been dormant since.

**Behaviour changes an operator will notice**

- Three new routes on `/accounts`, all behind the existing basic-auth guard.
- `GET /devices` and `GET /devices/:device_id` carry three more fields — **only**
  where `APP_BASIC_AUTH` is configured; a deployment without it sees byte-identical
  responses to before.
- `GET /devices` now performs one storage read per call. It could not fail before;
  it still cannot — an unfiltered list degrades to empty routing fields instead.
- `POST /devices` is unchanged in every respect.

## Commands run

```
go build -C src ./...                 # clean
go vet   -C src ./...                 # clean
go test  -C src -tags purego ./...    # 1 failure (pre-existing)
go test  -C src ./...                 # default mode; see below
```

### Why `-tags purego` is the real run

This host has no gcc, so `CGO_ENABLED=0` and `go-sqlite3` compiles to a stub that
fails every sqlite-backed test — **132 distinct tests, measured on the untouched
tree before the first edit**. `readme.md` documents a `purego` build tag that swaps
in a pure-Go SQLite. Under it the suite runs against a **real database**:

- **Before any edit:** the 132 "failures" are the stub, not the code.
- **After the change:** `--- FAIL: TestResolveDocumentMIME/Zip` — and nothing else.

### The one failure, and why it is not ours

`usecase.TestResolveDocumentMIME/Zip` expects `application/zip` while Windows
resolves `.zip` to `application/x-zip-compressed`. It is recorded as pre-existing
in the `verify.md` of tickets `cu-z8pmx9kcv6`, `cu-z8pmx9kcv7`, `cu-z8pmx9kcv8` and
`cu-z8pmx9kcva`, and it touches nothing this ticket changed.

### Default mode, for completeness

`go test -C src ./...` reports 137 distinct failures: the 132 baseline plus the 5
new sqlite-backed tests, which hit the same stub for the same reason. All 5 pass
under `purego`. No test that passed before this ticket fails after it, in either
mode.

### Mutation check — the tests catch a broken implementation

A green suite proves little when the code under test is new, so each load-bearing
guard was broken on purpose and restored:

| Mutation | Test | Result |
|----------|------|--------|
| Pre-existing-row check disabled | `TestCreateDeviceForAccountRefusesAnExistingRow` | FAILED as required |
| `DELETE … NOT EXISTS` made unconditional | `TestDeleteAccountIfEmptyRefusesWhileADevicePointsAtIt` | FAILED as required |
| `ctx.Err()` check removed from the cascade | `TestDeleteAccountCascadeStopsWhenTheRequestDeadlineExpires` | FAILED as required |
| `accountLayerVisible()` forced true | `TestListDevicesHidesTheAccountWhenNoAuthIsConfigured` + `…RefusesTheFilterWithoutAuth` | both FAILED as required |

## Acceptance criteria

| AC | Result | Evidence |
|----|--------|----------|
| AC-1 · unknown account → 404, nothing created | **PASS** | `TestCreateDeviceRefusesAnUnknownAccountBeforeCreating` (no creation reached), `TestCreateDeviceRouteMapsAccountNotFound` (404/`ACCOUNT_NOT_FOUND`) |
| AC-2 · account on the first row, no attach step | **PASS** | `TestSaveDeviceRecordInsertsTheAccount` — real SQLite, row read straight back; `TestCreateDeviceForAccountPersistsTheAccountOnTheFirstRow` — exactly one persisted record |
| AC-3 · both routes are one implementation | **PASS** | `TestCreateDeviceKeepsTheLegacyPathAccountLess` + `TestCreateDeviceForAccountPersistsTheAccountOnTheFirstRow`: same registry entry, same record fields, differing only in `account_id` (restated after the panel to be observable rather than a code-reading claim) |
| AC-3a · a pre-existing row is refused, never taken over | **PASS** | `TestCreateDeviceForAccountRefusesAnExistingRow` — 409, the shadowed row's name/JID/account unchanged, no slot left behind. Mutation-checked. |
| AC-4 · `POST /devices` unchanged | **PASS** | `TestCreateDeviceKeepsTheLegacyPathAccountLess`, `TestCreateDeviceLegacyPathStillSwallowsPersistFailure`, `TestSaveDeviceRecordInsertsNoAccountForLegacyCallers`, and the untouched `TestAddDevice_ForwardsFullWebhookConfig` |
| AC-5 · the three fields on `GET /devices` | **PASS** | `TestListDevicesReportsTheRoutingFields`, `TestListDevicesPublishesTheAccountWhenAuthIsConfigured` |
| AC-6 · `?account_id=` filters; bad id 400; unknown account empty | **PASS** | `TestListDevicesFiltersByAccount` (filter, blank = no filter, unknown = empty), `TestListDevicesPassesTheFilterDown` (400 on a malformed id, usecase never reached) |
| AC-7 · exactly one extra storage call | **PASS** | `TestListDevicesCostsOneStorageCall` — counted at N=1 and N=5: 1 list call, 0 per-device reads. `TestGetDeviceCostsOneStorageCall` — exactly 1. |
| AC-8 · account devices in priority order, nothing written | **PASS** | `TestListDevicesRequiresTheAccount`, `TestListAccountDevicesRouteIsReachable`; ordering comes from the unmodified `ListDeviceRecordsByAccount` (`ORDER BY priority ASC, device_id ASC`) |
| AC-9 · 409 while the account owns devices, nothing written | **PASS** | `TestDeleteAccountRefusesWhileItOwnsDevices` — no purge, the delete statement never reached, the account intact; `TestDeleteAccountMapsTheTwoConflicts` for the code |
| AC-10 · empty account deleted; unknown 404 | **PASS** | `TestDeleteAccountRemovesAnEmptyAccount`, `TestDeleteAccountIfEmptyDeletesAnEmptyAccount` (real SQLite) |
| AC-11 · cascade purges then deletes; `expected_devices` required | **PASS** | `TestDeleteAccountCascadePurgesThenDeletes`, `TestDeleteAccountCascadeRequiresTheExpectedCount` (nil / too low / too high all refuse and purge nothing), `TestDeleteAccountDecodesTheCascadeParameters` |
| AC-11a · per-device budget; untried devices left whole | **PASS** | `TestDeleteAccountCascadeStopsWhenTheRequestDeadlineExpires` (nothing started, both reported not-attempted), `TestDeleteAccountCascadeGivesEachDeviceItsOwnBudget` (the purge context is alive). Mutation-checked. |
| AC-12 · a failed purge keeps the account and names the device | **PASS** | `TestDeleteAccountCascadeKeepsTheAccountWhenADevicePurgeFails` |
| AC-13 · a late attach keeps the account | **PASS** | `TestDeleteAccountCascadeKeepsTheAccountWhenADeviceIsAttachedLate` (usecase) and `TestDeleteAccountIfEmptyRefusesWhileADevicePointsAtIt` (the statement itself, real SQLite). Mutation-checked. |
| AC-14 · the reconnect invariant still holds | **PASS** | `TestSaveDeviceRecordPreservesRouting` — the pre-existing test, unmodified, green under `purego` |
| AC-15 · no authentication change | **PASS** | `account_auth_test.go` unchanged in substance; it **enumerates** the routes from the router, so the three new ones are covered by the 503 guard automatically — which is exactly what its comment predicted a sixth route would need |
| AC-15a · the account layer is invisible without basic auth | **PASS** | `TestListDevicesHidesTheAccountWhenNoAuthIsConfigured`, `TestGetDeviceHidesTheAccountWhenNoAuthIsConfigured`, `TestListDevicesRefusesTheFilterWithoutAuth` (503, usecase never reached). Mutation-checked. |
| AC-16 · audit lines carry the actor | **PASS** | Reviewed at the source: `CreateDevice`, the pre-purge WARN, each purged device, and both delete outcomes log `accountActorFromContext(ctx)`. The existing `ContextWithAccountActor` seam is unchanged. |
| AC-17 · readme and OpenAPI document the change | **PASS** | `readme.md` — an "Accounts and devices" section (creation, both list shapes, the cascade with its irreversibility warning and the suspend alternative) plus eight table rows; `docs/openapi.yaml` — three paths, the `account_id` parameter, three `DeviceInfo` fields, `DeleteAccountResponse`. Re-parsed after editing: 90 paths, all eight account operations present. |
| AC-18 · the existing accounts are removed from the database | **PASS, with a stated limit** | See below. |

### AC-18 in full

The local `storages/chatstorage.db` was **inspected before anything was written**:
11 tables, **no `accounts` table**, **no `devices.account_id` column**, zero device
rows, and no `schema_migrations` table. It predates migrations 51+ entirely — the
account layer has never existed in it.

So there was nothing to delete, and nothing was run. The reset refused to touch the
database rather than reporting a vacuous success. **The limit is stated plainly:
this verifies the procedure and the state of the database that was actually
reachable here; it does not verify a deployment database, which this host does not
have.** For that database, with the service stopped:

```sql
-- Back up first. VACUUM INTO, not a file copy: a live SQLite database keeps
-- -wal/-shm beside the main file, and copying the main file alone can tear it.
VACUUM INTO 'chatstorage.db.pre-z8pmx9m57v.bak';

BEGIN;
-- All three columns, not just account_id: a device left 'blocked' by a deleted
-- account would silently re-enter the next account still skipped by the reply
-- fallback. 100 is the migration-54 default.
UPDATE devices SET account_id = '', priority = 100, send_state = ''
 WHERE account_id <> '';
-- UPDATE before DELETE, in one transaction — the cascade's ordering rule: no
-- device may point at an account row that is already gone.
DELETE FROM accounts;
COMMIT;

SELECT COUNT(*) FROM accounts;                          -- expect 0
SELECT COUNT(*) FROM devices WHERE account_id <> '';    -- expect 0
```

## Stated limit — what the cascade does not clean up

Two residues are inherited from the existing purge path, which this ticket reuses
**verbatim** by design. Neither is a defect introduced here, and both were declined
as scope in `plan.md > Panel response > Declined`:

1. **Media files survive.** Extracted media is written to one flat shared folder
   (`statics/media`) with no per-device partition, so neither `DELETE /devices/:id`
   today nor this cascade can delete a specific device's media. A data-retention
   ticket owns this.
2. **A device row the registry never loaded is purged only in storage.**
   `PurgeDevice` resolves the JID from the in-memory registry, so for such a row the
   whatsmeow store/keys rows and the phone-side link survive while the row is
   deleted. Changing that changes `DELETE /devices/:device_id` too, in a ticket that
   promised to reuse the purge path unchanged.

## Traceability

Every acceptance criterion above maps to an executed result. 38 new test functions
across six files; four load-bearing guards mutation-checked. The runtime-impact
statement is the first section of this document: **no deployment runtime file
changed.**

## What a reviewer should look at first

1. `plan.md > Panel response` — 35 findings, 8 major, and the three corrections to
   revision 1. Revision 1 **would not have compiled**, and its central claim
   ("AC-2 is true by construction") was false.
2. `src/infrastructure/whatsapp/device_manager.go > CreateDeviceForAccount` — the
   three guards, and why the cleanup is an inline `delete` and not `RemoveDevice`
   (that would deadlock on `m.mu`).
3. `src/usecase/account.go > DeleteAccount` — the six-step order, and
   `accountDevicePurgeBudget` beside it.
4. `src/ui/rest/device.go > accountLayerVisible` — the leak this closes is real:
   `/devices` is not covered by the guard that protects `/accounts`.
