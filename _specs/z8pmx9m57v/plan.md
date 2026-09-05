---
ticket: z8pmx9m57v
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-08-30
links:
  clickup: "https://app.clickup.com/t/z8pmx9m57v"
  github: ""
---

# Plan — 21 · Make the account a real owner of devices

> **Revision 2.** Revision 1 was authored before any code was written and reviewed
> by the advisory panel (senior / security / performance) **against the source**.
> The panel returned **35 findings, 8 major**; this revision is the result. Every
> finding is answered in `## Panel response` — adopted, declined with a reason, or
> recorded as a correction to the panel.
>
> **Revision 1 would not have compiled**, and two of its three headline claims
> were false. See `Panel response > Corrections to revision 1`.

## Anchors, not line numbers

Every location below is named by **symbol**. The line anchors quoted in earlier
tickets of this series were already stale by the time they were read.

## Approach

Three new routes on the existing `/accounts` group, two enriched device reads, and
**one** new column in **one** existing INSERT. No migration, no schema change, no
new table: every column this ticket writes was created by migrations 51-58 and has
been dormant since ticket 16.

The shape of the change is deliberately asymmetric:

- **Creation** binds the account at the *storage* layer, so the account is part of
  the row that is born — and the account path **verifies** that, because the
  upsert it rides on cannot promise it (D-A).
- **Reading** takes the account from the *database on every request*, never from a
  field cached on the in-memory `DeviceInstance` (D-B).
- **Deletion** reuses `DeviceManager.PurgeDevice` verbatim, is ordered for
  resumability, and is bounded so the 45-second request deadline cannot tear a
  device in half (D-C).

## The four design decisions worth arguing about

### D-A — the account rides the INSERT, and the account path *verifies* it

`SaveDeviceRecord` is an "UPDATE, else INSERT" upsert whose **UPDATE branch is a
pinned invariant**: it writes `display_name`, `jid`, `ad_jid`, `updated_at` and
nothing else, because it runs on every reconnect and widening it would zero the
routing columns of every device overnight (`TestSaveDeviceRecordPreservesRouting`).

So the change is confined to the **INSERT branch**, which gains `account_id` bound
from `record.GowaAccountID`. For every existing caller that field is the zero
value, so the inserted value is `''` — identical to the column default the INSERT
relies on today. The UPDATE branch is not touched.

**Revision 1 claimed this made AC-2 "true by construction". It does not**, and all
three lenses found the same hole from three directions:

`CreateDevice` checks only the in-memory map (`m.devices`), while `loadFromRegistry`
deliberately **skips** records without deleting them — a shadowed auto-created
slot, a duplicate identity. A `device_id` that exists as a row but not in the
registry therefore passes the uniqueness check, takes the **UPDATE** branch, and:

- `account_id` is never written (the row may even belong to another account),
- `display_name`/`jid`/`ad_jid` of the shadowed row are overwritten with the empty
  values of a fresh instance,
- and the route answers `200 · created in account X`.

The fix is two cheap statements on the **account path only**:

1. **Before** creating, `GetDeviceRecord(id)`: a pre-existing row is a `409`, not a
   silent takeover.
2. **After** persisting, re-read and confirm `account_id` matches; a mismatch
   removes the in-memory slot and returns an error.

The legacy `POST /devices` keeps its exact current behaviour (NFR-1) — including
its tolerance of that same drift, which is pre-existing and not this ticket's to
change.

### D-B — the account on a device read is a fresh single query, never a cached field

`GET /devices` is built from the in-memory registry (`DeviceManager.ListDevices` →
`convertInstance`), which has no account. Two ways to fix it: cache the account on
`DeviceInstance`, or read the rows on the request and merge.

**Merge is chosen.** `AttachDeviceToAccount`, `SetAccountDeviceOrder` and
`SetAccountDeviceSendState` write those columns straight to SQL without touching
the registry, so a cached field would be wrong immediately after the routes that
already ship are used — and wrong in the direction that matters, showing a device
as unattached while the reply path treats it as a sibling.

Cost, measured by the performance lens against the real UI: `GET /devices` is
**not** timer-polled (`useQuery(['devices'])` with no `refetchInterval`), the table
holds one row per WhatsApp slot, and one extra scan is ~10-50µs against a JSON
encode that dominates it. One query per call, never one per device.

Two consequences are written down rather than left to be discovered:

- **The read must not become fallible.** `GET /devices` cannot start returning 500
  because SQLite was briefly locked — the UI refetches this list on four websocket
  events. Unfiltered: log the error and serve the list with empty routing fields.
  **Filtered**: return the error, because answering "no devices in that account"
  when the truth is "the query failed" is worse than failing.
- **Two answers to "the devices of account X" now exist.** `GET /devices?account_id=`
  is **registry-sourced** (a shadowed row is invisible); `GET /accounts/:id/devices`
  is **storage-sourced**. The storage one is **authoritative** — it is what the
  reply path reads. This is stated in the code, the readme and the OpenAPI text.

### D-C — the cascade is bounded, resumable, and the account row is deleted atomically

```
requireAccount                                   → 404 if unknown
enumerate the account's devices                  → storage, authoritative
if not purging and any device exists             → 409, nothing written
if purging: expected_devices must equal the count → 409 on mismatch
WARN-log actor + the enumerated device ids       → before anything is destroyed
for each device:
    if ctx.Err() != nil → stop; the rest are "not attempted"
    PurgeDevice(WithTimeout(WithoutCancel(ctx), 15s), id)   ← the existing path
DELETE FROM accounts WHERE account_id = ? AND NOT EXISTS (devices of it)
if it deleted 0 rows → the account survives; report what is left
```

Five properties fall out, each answering a specific panel finding:

- **Resumable.** A crash or a deadline mid-loop leaves the account owning the rest,
  so the same call finishes the job.
- **The deadline cannot tear a device in half.** The request carries a 45-second
  deadline (`middleware.RequestTimeout`), and `PurgeDevice` deletes the device row
  even when its context is dead — which would leave a device with no row but with
  live whatsmeow store rows, re-adopted at the next boot as a fresh account-less
  slot. Each device therefore gets its **own** budget on a context detached from
  the request (`context.WithoutCancel` + 15s — the idiom already used at
  `usecase/send.go:80`), and the loop stops cleanly at the top rather than starting
  a purge it cannot finish.
- **Atomic against a late attach.** The account row is removed by a single
  conditional `DELETE … WHERE NOT EXISTS (…)`, not by "re-read, then delete" —
  which still had a window in which `AttachDeviceToAccount` could land, and there
  is no foreign key to catch it.
- **A mistyped-but-valid account id fails on the count, not on a customer's data.**
  `expected_devices` is required for the cascade: `acc_alpha` and `acc_alpha2` both
  pass `requireAccount`, and only the count tells them apart.
- **Fail-safe on partial failure.** Errors are collected with `errors.Join` — the
  shape `PurgeDevice` itself uses — and the account survives as the resume handle.

### D-D — the account layer becomes visible only where the account layer is available

`GET /devices` is registered on `apiGroup` (`cmd/rest.go`), and basic auth is
installed **only when `APP_BASIC_AUTH` is configured**. The `/accounts` group
answers `503 ACCOUNTS_AUTH_REQUIRED` in that case precisely so the account
topology is not served to an anonymous caller.

Publishing `account_id`/`priority`/`send_state` on `GET /devices` would hand that
same topology — which number belongs to which customer, which is blocked — to
anyone, through a route the guard does not cover.

So the REST layer gates the *data*, not the route: when
`len(config.AppBasicAuthCredential) == 0`, the three routing fields are cleared
from the response and the `account_id` filter answers `503 ACCOUNTS_AUTH_REQUIRED`
— the same code the account group uses. A deployment without basic auth therefore
sees a byte-identical `GET /devices` to today's (NFR-1), and the account layer
stays invisible exactly where it is unreachable.

## Steps

### Step 1 — baseline, measured before any edit (done)

`go build -C src ./...` → clean. `go vet -C src ./...` → clean.
`go test -C src ./...` → **111 `--- FAIL:` lines in 3 packages**, every one of them
`Binary was compiled with 'CGO_ENABLED=0', go-sqlite3 requires cgo to work`. There
is no gcc on this host, so no sqlite-backed test can execute here; the number is
identical to the baseline measured for ticket `z8pmx9m4nd`. The tree also carries
uncommitted work from that ticket (STT, `pion/opus` in `go.mod`), which is part of
the baseline and is not touched or staged by this ticket.

### Step 2 — storage

`src/infrastructure/chatstorage/sqlite_repository.go`
- `SaveDeviceRecord`: add `account_id` to the **INSERT** column list, bound from
  `record.GowaAccountID`. UPDATE branch untouched.

`src/infrastructure/chatstorage/account_repository.go` — the home of every account
statement and of `errBlankAccountID()`
- `DeleteAccountIfEmpty(accountID string) (bool, error)`: one conditional DELETE
  (D-C). The guard is in the **name** so no caller can hold it wrong.

`src/domains/chatstorage/interfaces.go` — declare `DeleteAccountIfEmpty`; add
`ErrAccountHasDevices` and `ErrAccountDeviceCountMismatch` beside the existing
account errors (they live here, not in `chatstorage.go`).

`src/infrastructure/whatsapp/chatstorage_wrapper.go` — mirror
`DeleteAccountIfEmpty` as a pass-through. **Not optional**: `deviceChatStorage`
implements `IChatStorageRepository` explicitly, so an unmirrored method is a
compile error. Revision 1 omitted this file and would not have built.

### Step 3 — device manager

`src/infrastructure/whatsapp/device_manager.go`
- `CreateDeviceForAccount(ctx, requestedID, accountID string)` holds the current
  body of `CreateDevice` plus, when `accountID != ""`: the pre-existing-row check,
  `GowaAccountID` on the persisted record, the surfaced persist error, and the
  read-back verification (D-A).
- On the account path's error exits, the in-memory slot is removed with an inline
  `delete(m.devices, id)` — **not** `m.RemoveDevice(id)`, which takes `m.mu` (held
  here under `defer`) and would deadlock, and which would also try to delete a
  storage row that was never written.
- `CreateDevice(ctx, requestedID)` becomes a one-line wrapper passing `""`. One
  implementation, two doors (REQ-4).

### Step 4 — device usecase

`src/usecase/device.go`
- `ListDevices(ctx, accountID string)`: one `ListDeviceRecords()`, indexed by
  device id, merged per device. The filter applies only when the **trimmed value is
  non-empty** — `ValidateAccountID` rejects `""` with "account_id is required", so
  an unconditional call would turn plain `GET /devices` into a 400. A blank
  parameter means *no filter*; it never means "the devices with no account".
- `GetDevice`: one `GetDeviceRecord(deviceID)`, merged.
- `applyDeviceRouting(dev *domainDevice.Device, rec *domainChatStorage.DeviceRecord)`
  copies exactly three fields and discards the record — which is also what keeps
  `webhook_secret` (selected by `GetDeviceRecord`) out of the read path.
- `AddDeviceInAccount(ctx, accountID, deviceID)` — **no webhook parameter** (see
  the panel response, S-SEC-10). `AddDevice` keeps its webhook handling and both
  call the same manager path.
- `LogoutDevice`'s websocket payload calls `s.ListDevices(ctx, "")` instead of
  re-implementing the list, so one concept has one shape — and the duplicated loop
  is deleted.

`src/domains/device/device.go` — `Device` gains `AccountID`, `Priority`,
`SendState`. `account_id` is **not** `omitempty`: a client must be able to tell
"no account" from "field absent".

`src/domains/device/interfaces.go` — `ListDevices(ctx, accountID string)` and
`AddDeviceInAccount`.

### Step 5 — account usecase

`src/usecase/account.go`
- `serviceAccount` gains `devices domainDevice.IDeviceUsecase`. **No new
  `IAccountDeviceOps` interface**: it would have one implementation and one caller,
  and this repo's stub pattern is embedding the real interface
  (`usecase/account_test.go`, `ui/rest/device_test.go`), so the narrow interface
  bought nothing.
- `CreateDevice(ctx, accountID, request)` — `requireAccount` first (404 before
  anything is created), then create, then audit.
- `ListDevices(ctx, accountID)` — `requireAccount`, then the existing
  `devicesOfAccount`. No new storage code.
- `DeleteAccount(ctx, accountID, purgeDevices bool, expectedDevices *int)` — D-C.

`src/cmd/root.go` — `usecase.NewAccountService(chatStorageRepo, deviceUsecase)`,
and **rewrite the comment above it**: "it holds no device manager because attaching
a device touches no live session" stops being true the moment the cascade ships,
and a stale rationale is how the next ticket re-derives the wrong constraint.

### Step 6 — REST

`src/ui/rest/account.go` — three routes on the existing group:

```go
app.Post("/:account_id/devices/create", rest.CreateDevice)
app.Get("/:account_id/devices", rest.ListDevices)
app.Delete("/:account_id", rest.DeleteAccount)
```

No ordering caveat: Fiber v3 matches `/:account_id/devices/create` and
`/:account_id/devices` distinctly (different segment counts), and `DELETE
/:account_id` collides with nothing on this group.

`accountError` gains `ErrAccountHasDevices → 409 ACCOUNT_HAS_DEVICES` and
`ErrAccountDeviceCountMismatch → 409 ACCOUNT_DEVICE_COUNT_MISMATCH`. The new
handlers use `accountError`, never `utils.PanicIfNeeded`: the recovery middleware
renders an unrecognised error as `fmt.Sprintf("%v", err)`, which would put driver
text and schema names in a 500 body.

`src/ui/rest/device.go` — read `account_id` from the query and apply D-D: when no
basic-auth credential is configured, clear the three routing fields and answer the
filter with `503 ACCOUNTS_AUTH_REQUIRED`.

### Step 7 — documentation

`readme.md` — the endpoint table has **no** account rows at all today, so the three
new routes are added together with the five that already ship; plus the new device
fields, the filter, `POST /devices` marked as the legacy account-less path, and the
irreversibility of the cascade.

`docs/openapi.yaml` — **found by re-reading the repo, not by the panel**: the
account endpoints have been specified there since ticket 16, so documenting only
`readme.md` would leave the machine-readable spec stale for three new routes.
Adds: the three paths, `account_id` as a query parameter on `GET /devices`, and
the three fields on `DeviceInfo`.

### Step 8 — tests

Fake-backed (these actually execute on this host):
- `usecase`: 404 before creation; the audit actor; cascade order and success;
  `expected_devices` mismatch → 409 with nothing purged; partial failure keeps the
  account; the account survives when a device is attached late; **call counting**
  for AC-7 (one `ListDeviceRecords` for N devices, one `GetDeviceRecord` for a
  single device); the filter is applied only when non-empty.
- `ui/rest`: the three routes' status codes; the 409s; the auth 503; and D-D —
  routing fields absent when no basic auth is configured.
- `infrastructure/whatsapp`: `CreateDeviceForAccount` persists the account;
  a pre-existing row is refused instead of silently taken over; a persist failure
  leaves no ghost in the registry; `CreateDevice` still persists no account.

sqlite-backed (correct, but **cannot execute on this host** — no cgo):
- the INSERT carries the account; `DeleteAccountIfEmpty` refuses a non-empty
  account and reports not-found for an unknown one; the UPDATE-branch invariant
  still holds (existing test, unmodified).

### Step 9 — validation

`go build -C src ./...`, `go vet -C src ./...`, `go test -C src ./...`, compared
against the Step 1 baseline of 111 pre-existing failures.

### Step 10 — the database reset (AC-18)

Inspect first and report what is actually there — the local `storages/chatstorage.db`
was inspected during planning and carries **no `accounts` table and no
`devices.account_id` column at all** (migrations 51+ have never run against it, and
it holds zero devices), so "delete the existing accounts" is a no-op on this
database and the procedure below is what applies to a deployment database.

```sql
BEGIN;
UPDATE devices SET account_id = '', priority = 100, send_state = '' WHERE account_id <> '';
DELETE FROM accounts;
COMMIT;
```

- **All three columns**, not just `account_id`: a device left `blocked` from a
  deleted account would silently re-enter the next account still skipped by the
  reply fallback. `100` is the migration-54 default.
- **UPDATE before DELETE**, in one transaction — the same ordering rule as the
  cascade: no device may point at an account row that is already gone.
- The backup is taken with `VACUUM INTO`, not a file copy: a running SQLite
  database keeps `-wal`/`-shm` beside the main file and a plain copy can be torn.
- Row counts before and after are recorded in `verify.md`.

## Files to change

| File | Change |
|------|--------|
| `src/infrastructure/chatstorage/sqlite_repository.go` | INSERT carries `account_id` |
| `src/infrastructure/chatstorage/account_repository.go` | `DeleteAccountIfEmpty` |
| `src/domains/chatstorage/interfaces.go` | declare it; two new errors |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | pass-through (build-critical) |
| `src/infrastructure/whatsapp/device_manager.go` | `CreateDeviceForAccount`; `CreateDevice` wrapper |
| `src/domains/device/device.go` | `AccountID`, `Priority`, `SendState` |
| `src/domains/device/interfaces.go` | filtered list; `AddDeviceInAccount` |
| `src/usecase/device.go` | creation in account; routing merge; one list shape |
| `src/domains/account/account.go` | `CreateDeviceRequest`, `DeleteAccountResult` |
| `src/domains/account/interfaces.go` | three usecase methods |
| `src/usecase/account.go` | the three operations |
| `src/ui/rest/account.go` | three routes, two 409 mappings |
| `src/ui/rest/device.go` | `account_id` filter, D-D gate |
| `src/cmd/root.go` | wiring + the stale comment |
| `readme.md` | documentation |
| `docs/openapi.yaml` | three paths, one parameter, three fields |
| tests | as in Step 8 |

## Validation strategy

`go build -C src ./...`, `go vet -C src ./...`, `go test -C src ./...` from the
repository root. Every acceptance criterion maps to a test in Step 8 except AC-17
(documentation — reviewed) and AC-18 (the reset — recorded with its statements and
the **observed** state of the database).

## Rollback

Reverting the commit restores previous behaviour for all code. Three things are
contract changes rather than pure additions, and are listed because "additive"
would understate them:

1. `IDeviceUsecase.ListDevices` gains a parameter (one production caller).
2. `domainDevice.Device` gains three JSON fields consumed by the dashboard UI.
3. `NewAccountService` gains a parameter.

All three are compile-time and safe to revert. **Step 10 is not covered by that**:
`DELETE FROM accounts` is production data, and reverting the commit does not undo
it. Its rollback is the `VACUUM INTO` backup taken immediately before, and it is
run **after** the code is deployed, never before.

## Out of scope

As `spec.md > Out of scope`: no consolidation of the two creation paths, no
tenancy, no detach, no index, no media cleanup, and no change to `PurgeDevice`
itself.

## Panel response

The advisory panel (`senior-reviewer`, `security-reviewer`, `performance-reviewer`
— the lenses `/review` dispatches) reviewed revision 1 **against the source**
before any code was written. **35 findings, 8 major.** The senior lens had to be
re-run after its first attempt died on an API error.

Two lenses independently found the same structural defect from opposite
directions: the security lens through the UPDATE-first upsert, the senior lens
through `loadFromRegistry`'s deliberate skipping — revision 1's central claim,
"AC-2 is true by construction", was false, and its own tests ran on an empty table
and could not have caught it.

### Adopted (22)

| # | Lens | Finding | What changed |
|---|------|---------|--------------|
| A-1 | sec + senior | A `device_id` that exists as a row but not in the registry takes the UPDATE branch: no account written, the shadowed row's JID blanked, and a `200` returned | D-A: pre-existing-row check → 409, and read-back verification after persist |
| A-2 | senior | Adding a method to `IChatStorageRepository` without mirroring it on `deviceChatStorage` is a **compile error** | `chatstorage_wrapper.go` added to Files to change |
| A-3 | sec | `GET /devices` is not behind `RequireBasicAuthConfigured`; publishing the routing columns there leaks the account topology to anonymous callers in an unauthenticated deployment | D-D |
| A-4 | perf | The 45s request deadline plus `PurgeDevice`'s unconditional row delete leaves half-purged devices that the next boot re-adopts as fresh account-less slots | Per-device budget on `WithoutCancel`, `ctx.Err()` check at the top of the loop, untried devices reported |
| A-5 | sec | "Re-read then delete" still has a window for a late attach, and there is no FK | Single conditional `DELETE … WHERE NOT EXISTS` |
| A-6 | sec | An irreversible fleet purge behind one boolean; `acc_alpha` vs `acc_alpha2` both pass `requireAccount` | `expected_devices` required for the cascade; enumerated device ids WARN-logged with the actor **before** the loop |
| A-7 | sec + senior | `Rollback` claimed a revert needs no data repair; a file copy is not a valid backup of a live SQLite database | Rollback rewritten; `VACUUM INTO`; the reset runs after deployment |
| A-8 | sec | The reset left `priority`/`send_state` behind, so a blocked device re-enters the next account still skipped | All three columns cleared, in one transaction |
| A-9 | sec + perf + senior | Returning the persist error leaves a ghost slot in `m.devices` | Inline `delete(m.devices, id)` on the account path's error exits |
| A-10 | senior | `ValidateAccountID` rejects `""`, so validating unconditionally turns plain `GET /devices` into a 400 | Validate and filter only when the trimmed value is non-empty |
| A-11 | senior | `DeleteAccount` belongs in `account_repository.go`; the account errors live in `domains/chatstorage/interfaces.go` | Step 2 corrected |
| A-12 | senior | `IAccountDeviceOps` = one implementation, one caller, duplicating methods already on `IDeviceUsecase` | Dropped; `serviceAccount` holds `IDeviceUsecase` |
| A-13 | perf + senior | The `DEVICE_LOGGED_OUT` payload re-implements the device list and would silently lack the new fields | It calls `s.ListDevices(ctx, "")`; the duplicated loop is deleted |
| A-14 | perf | `GET /devices` would become able to 500 on a transient lock, and the UI refetches it on four websocket events | Unfiltered degrades with empty routing fields; filtered fails loudly |
| A-15 | perf + senior | Two different answers to "the devices of account X" (registry-sourced vs storage-sourced) | Storage is declared authoritative, in code, readme and OpenAPI |
| A-16 | sec | The account layer would start carrying `webhook_secret` through `IAccountDeviceOps` and the mirrored request struct | The account-scoped create takes **no** webhook; `PATCH /devices/:id/webhook` already exists |
| A-17 | sec | `GetDeviceRecord` selects `webhook_secret`, which the new merge would pull into the read path | `applyDeviceRouting` copies exactly three fields and discards the record; stated in the code |
| A-18 | senior | AC-3 as written could only be asserted by reading code — a tautological test | AC-3 restated: either route yields the same registry entry and the same `DeviceRecord` fields except `account_id` |
| A-19 | senior | The "registration order matters" note documents a hazard that does not exist in Fiber v3 | Dropped |
| A-20 | senior | `cmd/root.go`'s comment — "the account layer holds no device manager" — becomes false with the cascade | Rewritten in the same edit |
| A-21 | senior | Rollback understated the contract changes | Three of them listed explicitly |
| A-22 | perf | AC-7's counting test should also pin `GET /devices/:id` at exactly one `GetDeviceRecord` | Added to Step 8 |

### Declined (3)

- **A hard cap on the number of devices a cascade may purge** (perf). The reason
  given is real — `PurgeDevice → deleteStoreRowsForJID` enumerates **both**
  whatsmeow containers per device, so the cascade is O(N×D) and that, not the
  account query, is what would blow the 45-second budget. But a cap is the wrong
  instrument: it is a limit the operator cannot raise, and it would refuse an
  account of 40 devices **forever**, since re-running still sees 40. The adopted
  per-device budget plus the `ctx.Err()` check bounds the work of a single request
  *and* leaves it resumable, which is strictly better. The O(N×D) bound is recorded
  here so the next reader does not rediscover it as a surprise.
- **Changing `PurgeDevice` so a device missing from the registry still has its
  whatsmeow store rows deleted** (sec). The finding is correct — `PurgeDevice`
  resolves the JID only from the registry, so such a device is reported purged
  while its store rows and the phone-side link survive. But that is a pre-existing
  property of `DELETE /devices/:device_id`, and changing it changes that route's
  behaviour too, in a ticket that promised to reuse the purge path **verbatim**. It
  is recorded as a stated limit in `verify.md` and belongs to a ticket that owns
  `PurgeDevice`.
- **Splitting AC-18 (the database reset) into its own ticket** (senior). The owner
  asked for the reset as part of this ticket, twice and explicitly. It stays, with
  the honest note that no automated test can cover it and that its rollback is the
  backup, not the revert.

### Corrections to the panel (2)

- **The security lens proposed `m.RemoveDevice(id)` to clean up the ghost slot.**
  That would **deadlock**: `CreateDevice` holds `m.mu` under `defer`, and
  `RemoveDevice` takes the same mutex. It would also delete a storage row that was
  never written. The senior lens caught both. The fix is an inline
  `delete(m.devices, id)`.
- **The security lens asked for a present-but-blank `account_id` to be a 400.**
  Fiber cannot distinguish an absent parameter from a present-but-blank one
  through `c.Query`, and the senior lens showed that validating unconditionally
  breaks plain `GET /devices`. A blank value is therefore treated as *no filter*.
  The underlying worry — that a blank could be read as "the un-accounted fleet",
  which `scope.txt` rule 03 forbids — is addressed: the blank value never reaches
  the filter at all.

### Corrections to revision 1 (3)

1. **It would not have compiled.** `deviceChatStorage` mirrors every account method
   explicitly; the new repository method was not mirrored (A-2).
2. **"AC-2 is true by construction" was false.** The upsert is UPDATE-first, and
   the registry check does not see rows the registry skipped (A-1).
3. **"Every change is additive except two lines" was wrong.** Three contract
   changes ship, one of them a JSON shape consumed by the dashboard (A-21). And
   `docs/openapi.yaml` — which has specified the account endpoints since ticket 16
   — was missing from the plan entirely; found by re-reading the repo, not by the
   panel.

### Recorded, no change (5)

- `GET /devices` is not timer-polled by the dashboard, so one query per call is
  acceptable; a cache would break NFR-2 (perf).
- `UpdateStateFromClient` is ~1µs/device and does not dominate; the new query
  outweighs the whole loop and still costs ~1% of the request (perf).
- The filter belongs in memory, not in SQL: the response must be registry-merged
  anyway, and `ListDeviceRecordsByAccount` is an unindexed scan plus a sort (perf).
- Adding `account_id` to the INSERT branch costs nothing on the connect path,
  which is UPDATE-first (perf).
- No deployment-runtime file is touched, `meta_token_ref` stays selectable by
  exactly one statement, and account ids reach SQL only as bound parameters (sec).
