---
ticket: z8pmx9m57v
stage: intake
mode: standard
status: in_progress
owner: developer
updated: 2026-08-30
links:
  clickup: "https://app.clickup.com/t/z8pmx9m57v"
  github: ""
---

# Intake — Make the account a real owner of devices

## Ticket Reference

| Field | Value |
|-------|-------|
| Slug | `z8pmx9m57v` |
| Title | Make the account a real owner of devices — mandatory account on device creation, account-scoped device queries, and a complete account lifecycle |
| Owner | developer |
| Created | 2026-08-30 |
| ClickUp | <https://app.clickup.com/t/z8pmx9m57v> (status `claude ai to do`) |

## Ticket Summary

*The request as received (owner, 2026-08-30):* the account layer above devices
exists but is not bound tightly enough — adding a device does not require an
existing account; a device query should carry the account it belongs to; and it
must be decided whether the account becomes an authentication boundary or stays
an organizational layer. The existing account rows are to be deleted so the
layer starts clean.

The scenario that must work after this ticket: **as the system administrator, I
create an account, enter that account, create a device that belongs to it — and
when I query devices they come back grouped/filterable by `account_id`.**

### Observed gaps (read-only investigation, 2026-08-30)

| # | Gap | Location |
|---|-----|----------|
| G1 | `POST /devices` neither accepts nor validates an `account_id`; every new device is born with `account_id = ''` | `src/ui/rest/device.go:62` · `src/infrastructure/whatsapp/device_manager.go:429` |
| G2 | `GET /devices` and `GET /devices/:device_id` are projected from the in-memory `DeviceInstance`, which carries no account, so no device response mentions one and no filter exists | `src/usecase/device.go:318` (`convertInstance`) · `src/domains/device/device.go:17` |
| G3 | There is no read endpoint `GET /accounts/:account_id/devices` — the device list only appears as a side effect of attach/order | `src/ui/rest/account.go:45-49` (five routes) |
| G4 | No `DELETE /accounts/:account_id`, no rename, and no detach — a device can never leave an account except by being purged | same file |
| G5 | `devices.account_id` has no index; the composite `(account_id, priority)` index was deliberately deferred at ticket 16 | `src/infrastructure/chatstorage/sqlite_repository.go:3599` |
| G6 | The account is not an access boundary: `APP_BASIC_AUTH` is a flat credential list with no per-credential scope, so any authenticated caller sees and mutates every account | `src/cmd/rest.go:153` · `src/ui/rest/middleware/require_basic_auth.go:32` |

The link between `accounts` and `devices` already exists in the schema
(migration 52) and in the repository (`AttachDeviceToAccount`,
`ListDeviceRecordsByAccount`) — it is **optional at the API boundary**, which is
exactly the weakness the owner identified.

## Goal

Make `account_id` a mandatory, atomically written property of every device
created through the API, expose it (and let callers filter by it) on every device
read path, and complete the account lifecycle (read devices of an account,
delete/detach) — then reset the existing `accounts` rows so the layer starts
clean.

## Readiness checks

- [x] The request has a clear, single focused outcome (one ticket = one outcome).
- [x] The goal is stated in one or two sentences.
- [x] Success is describable in observable, testable terms (the administrator
      scenario above is executable end to end against the REST API).
- [x] No hard-stop condition applies (see `CLAUDE.md > Hard stop conditions`).
- [x] Any deployment runtime file impact is known and called out below.

## Deployment runtime impact

**No.** No deployment runtime file (`docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml`,
`.github/workflows/set-latest-tag.yaml`) is in scope. The change is confined to
`src/` (REST handlers, usecases, device manager, storage) plus a one-time data
reset of `storages/chatstorage.db`.

## Owner decisions (2026-08-30) — open questions resolved

| # | Question | Owner's answer | Consequence for the spec |
|---|----------|----------------|--------------------------|
| D1 | Does the account become an authentication boundary? | **No — organizational layer only, not a boundary.** | Auth is unchanged: `RequireBasicAuthConfigured` on `/accounts`, flat credential list, actor audit log. `scope.txt` rule 01 stands. Per-credential tenancy is a separate future ticket that this ticket only *enables*. |
| D2 | Creation surface: change `POST /devices`, or add a new route? | **Add a NEW route** so the existing one keeps working as it does today. The two paths coexist **on purpose, for now**; a later ticket picks ONE of them — the one where `account_id` is mandatory — but not in this ticket, so the running system is never broken. | `POST /devices` is **untouched** — no new required field, no breaking change, every existing client keeps working. The account-bound creation lives at a new account-scoped route (`POST /accounts/:account_id/devices/create`), which also matches the "enter the account, then create a device" scenario literally. See "Deferred — consolidating the two creation paths" below. |
| D3 | Document the change in `readme.md`? | **Yes.** | `readme.md` is in "Files to change": the new creation route, the `account_id` field and `?account_id=` filter on the device reads, and the account delete semantics (D5). |
| D4 | Backfill existing devices into an account? | **No — the owner attaches them manually.** | No migration backfill (which `scope.txt` rule 03 forbids anyway). Existing devices keep `account_id = ''` until attached via the existing `POST /accounts/:account_id/devices`. |
| D5 | Account deletion semantics? | **Delete the account together with its devices** — see the cancellation scenario below. | `DELETE /accounts/:account_id` with an explicit cascade flag; the devices are found **by `account_id`** and purged through the existing device-purge path. |
| D6 | How are devices selected for the cascade? | **By `account_id`, together with the account, so nothing is left inconsistent.** | The cascade enumerates `ListDeviceRecordsByAccount(account_id)` and the account row is deleted **last**. |

## Deferred — consolidating the two creation paths (owner, 2026-08-30)

Two device-creation paths will exist after this ticket, and that is a **stated,
temporary state**, not an oversight:

| Path | Account | Status after this ticket |
|------|---------|--------------------------|
| `POST /devices` (existing) | none — device is born `account_id = ''` | unchanged, still supported, still the path every current client and the current UI uses |
| `POST /accounts/:account_id/devices/create` (new) | mandatory, validated, written in the first INSERT | the path the new administrator scenario uses |

**The owner's decision:** keep both **now** so the running system never breaks. A
**later ticket** picks ONE of them — the one where `account_id` is mandatory —
and retires the other. That consolidation is explicitly **out of scope here**; it
needs its own ticket because it is the breaking change this ticket was told to
avoid (every existing client, the separate `gowa-ui` project, and any script
calling `POST /devices` would have to move first).

**What this ticket must do so that consolidation is cheap later:**

- The new route is a **thin wrapper over the same `CreateDevice` path**, never a
  second implementation (risk R3). One behaviour, two doors — so closing a door
  later removes code instead of reconciling two divergent creation semantics.
- The account write happens **inside** device creation (first INSERT), not as a
  follow-up attach, so the mandatory-account path is already the real one.
- `readme.md` marks `POST /devices` as **the legacy, account-less path** and
  points new integrations at the account-scoped route — the deprecation notice
  starts here so the later removal is not a surprise.

## Scenario S-2 — subscription cancellation (analysis + recommended answer)

**The situation.** A transport company signs up. The operator creates an account
for them (e.g. `القدموس للنقل`), then creates one or more devices inside that
account and pairs them. Months later the company cancels the subscription. The
operator must remove the account **and everything under it**, and the system must
be left with no device pointing at an account that no longer exists.

**What deleting a device already does today.** `DELETE /devices/:device_id`
(`usecase/device.go` → `DeviceManager.PurgeDevice`, `device_manager.go:264`) is
already a full purge, in this order: best-effort remote WhatsApp unlink and
disconnect → `DeleteDeviceData` (messages, reactions, edits, chatwoot message
links, forward queue, debug rows — one transaction) → the device's Chatwoot
config and its links → the whatsmeow store/keys rows for the JID → the registry
slot and the `devices` row. The cascade must **reuse that path**, not re-implement
a second, thinner delete.

**Recommended answer.**

1. `DELETE /accounts/:account_id` — **refuses by default** with `409` and the
   list of devices still attached. Safe by default is not ceremony here: a purge
   destroys the whatsmeow session keys, and re-pairing needs physical access to
   the customer's phone. An account delete must never unlink a live number as a
   side effect of a mistyped id.
2. `DELETE /accounts/:account_id?purge_devices=true` — the explicit cascade. It
   enumerates the account's devices **by `account_id`**
   (`ListDeviceRecordsByAccount`), purges each through the existing
   `PurgeDevice` path, and deletes the `accounts` row **last**.
3. **Order is load-bearing.** The account row goes last so that a process that
   dies mid-cascade leaves the account still owning whatever was not purged —
   re-running the same call resumes and finishes. Deleting the account first
   would strand devices pointing at a nonexistent account: invisible to every
   account-scoped listing, which is precisely the inconsistency D6 asks to avoid.
4. **Partial failure does not delete the account.** Per-device errors are
   collected (the `errors.Join` shape `PurgeDevice` already uses) and the
   remaining devices are still attempted; if any device failed, the account row
   is kept and the response names the failed device ids. The surviving account is
   the resume handle.
5. **Idempotent.** Deleting an account that owns no devices is a plain row
   delete; deleting an account that is already gone is `404`, not a 500.
6. **Audited.** One log line per purged device plus one for the account, each
   carrying the acting username — the pattern `usecase/account.go` already uses
   for every mutating account call.
7. **Suspension is not deletion.** For a *paused* subscription the operator
   should mark each device `send_state: "blocked"` through the existing
   `PATCH /accounts/:account_id/devices/:device_id` and keep the data. Deletion
   is for true cancellation only — it is irreversible, and the response and
   `readme.md` must say so plainly.

**Known residue (recorded, not fixed here).** Extracted media files live in one
flat shared folder (`statics/media`, `config/settings.go:49`) with no device
partition, so neither `PurgeDevice` today nor this cascade can remove a device's
media files. This ticket inherits that gap rather than widening scope to fix it;
it belongs in a data-retention ticket of its own.

## Readiness Status

`READY`
