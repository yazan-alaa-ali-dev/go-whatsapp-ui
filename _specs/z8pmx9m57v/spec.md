---
ticket: z8pmx9m57v
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-08-30
links:
  clickup: "https://app.clickup.com/t/z8pmx9m57v"
  github: ""
---

# Specification — 21 · Make the account a real owner of devices

## Business goal

Tickets 16-19 built the account layer as **vocabulary**: the `accounts` table, the
`devices.account_id` column, the attach/order/send-state endpoints, and a reply
path that resolves the account and fails over inside it. What none of them added
is a way for that account to be *chosen when a device is born*, or to be *seen
when devices are listed*.

The result is an account layer that is real in the schema and absent from the
workflow. A device created through the API is born with `account_id = ''` — no
account — and every device response is silent about the account, so an operator
cannot tell which company a number belongs to without reading the database. The
routing layer that tickets 18/19 depend on is therefore populated only by an
operator who remembers to call attach afterwards.

This ticket closes the entry door and opens the read path: a device can be
created **inside** an account in one atomic write, every device response carries
its account, devices can be filtered by account, and an account can be read and
finally deleted — including the subscription-cancellation case where the account
and its devices go away together.

## User story

As **the system administrator**, I want to **create an account, create devices
inside it, list devices by account, and delete the account with its devices when
the customer cancels**, so that **the account is the unit I actually operate on,
not a label I have to remember to attach afterwards**.

## Functional requirements

- **REQ-1** A device can be created **inside** an account through a new
  account-scoped route, and the account is written in the device's **first**
  INSERT — not by a follow-up attach.
- **REQ-2** Creating a device inside an account that does not exist creates
  nothing and reports "account not found".
- **REQ-3** The existing `POST /devices` keeps its exact current behaviour: no
  new required field, no account, no changed response. The two creation paths
  coexist deliberately (owner decision D2); one is retired by a later ticket.
- **REQ-4** Both creation paths share **one** device-creation implementation. The
  account-scoped route is a wrapper over it, never a second implementation.
- **REQ-5** Every device read path (`GET /devices`, `GET /devices/:device_id`)
  reports the device's `account_id`, `priority` and `send_state`.
- **REQ-6** `GET /devices` accepts an `account_id` query parameter and returns
  only the devices of that account.
- **REQ-7** An account's devices can be read directly, in reply order, without
  mutating anything.
- **REQ-8** An account can be deleted. Deleting an account that still owns
  devices is **refused** unless the caller asks for the cascade explicitly.
- **REQ-9** The explicit cascade purges each of the account's devices through the
  **existing** device-purge path, and deletes the account row **last**.
- **REQ-10** Every new mutating call is audit-logged with the acting username,
  like every existing account call.
- **REQ-11** `readme.md` documents the new routes, the new response fields and
  filter, the legacy status of `POST /devices`, and the irreversibility of the
  cascade.

## Non-functional requirements

- **NFR-1** **No behaviour change for any existing route.** Every route that
  ships today answers exactly as it does today, for every input it accepts today.
- **NFR-2** **Freshness over caching.** The account shown for a device is read
  from the database on the request that reports it, never from a value cached in
  the in-memory registry — an attach performed through another route must be
  visible on the next list.
- **NFR-3** **One query, not N.** Adding the account to the device list costs a
  **single** additional storage read for the whole list, never one per device.
- **NFR-4** **The routing columns survive reconnection.** The invariant pinned by
  `TestSaveDeviceRecordPreservesRouting` — a reconnect writes display_name, jid
  and ad_jid and nothing else — holds unchanged after this ticket.
- **NFR-5** **Destructive by request only.** No call deletes a device unless the
  caller explicitly asked for the cascade; the default answer to "delete an
  account that owns devices" is a refusal that writes nothing.
- **NFR-6** **Resumable cascade.** A cascade interrupted at any point leaves the
  account owning whatever was not purged, so re-running the same call finishes
  the job. It never leaves a device pointing at an account that no longer exists.
- **NFR-7** The account remains an **organizational / routing** boundary, not an
  access boundary (owner decision D1). No route gains, loses, or changes an
  authentication or authorization check.

## Constraints

- **CON-1** No deployment runtime file is modified (`docker-compose.yml`,
  `docker/golang.Dockerfile`, `docker/entrypoint.sh`, the three workflows).
- **CON-2** No migration is added and no schema is changed. Every column this
  ticket writes already exists (migrations 51-58).
- **CON-3** No backfill. Devices carrying `account_id = ''` stay that way; the
  owner attaches them manually (decision D4). `scope.txt` rule 03 forbids a
  shared default account.
- **CON-4** The reply-path behaviour of tickets 18/19 is untouched. This ticket
  adds no send path, no fallback rule and no transport write.
- **CON-5** `POST /devices` is not modified — not even to accept an optional
  account (decision D2). Consolidating the two creation paths is a later ticket.
- **CON-6** Extracted media files live in one flat shared folder
  (`statics/media`) with no per-device partition, so neither the existing device
  purge nor this cascade can delete a device's media. Inherited, not fixed here.

## Acceptance criteria

### Creating a device inside an account

- **AC-1** `POST /accounts/:account_id/devices/create` with an account that does
  not exist returns `404 ACCOUNT_NOT_FOUND`, creates no device row, and registers
  no device in the in-memory registry.
- **AC-2** A device created through that route reads back from the database
  carrying the account id **from its first row** — proven by asserting the
  account on the row produced by creation itself, with no attach call in between.
- **AC-3** The route is a **wrapper**: a device created through either route
  yields the same registry entry and the same `DeviceRecord` fields except
  `account_id`. (Restated after the panel: "created by the same code path" could
  only be asserted by reading the source, so any test for it passed tautologically.)

- **AC-3a** A device id that already exists **as a row** — including one the
  registry skipped and therefore does not hold — is refused with `409`, not
  silently taken over. The refusal exists because the underlying upsert is
  UPDATE-first: without it the route would overwrite the shadowed row's
  identity, leave `account_id` unwritten, and still answer `200`.
- **AC-4** `POST /devices` accepts exactly the same body as before, answers with
  the same shape, and still produces a device with no account.

### Seeing the account

- **AC-5** `GET /devices` returns `account_id`, `priority` and `send_state` for
  every device.
- **AC-6** `GET /devices?account_id=X` returns only the devices whose account is
  `X`; a syntactically invalid id is a `400`, and an id naming an account that
  holds no device is an empty list, not an error.
- **AC-7** Adding the account to `GET /devices` costs **exactly one** additional
  storage call for the whole response, independent of the number of devices —
  proven by counting calls through a fake repository, not by reading the code.
- **AC-8** `GET /accounts/:account_id/devices` returns the account's devices
  ordered by `priority` ascending, and writes nothing.

### Deleting an account

- **AC-9** `DELETE /accounts/:account_id` on an account that still owns devices
  returns `409 ACCOUNT_HAS_DEVICES`, deletes nothing, and purges no device.
- **AC-10** `DELETE /accounts/:account_id` on an account with no devices deletes
  the account and returns success; on an unknown account it returns
  `404 ACCOUNT_NOT_FOUND`.
- **AC-11** `DELETE /accounts/:account_id?purge_devices=true&expected_devices=N`
  purges every device of the account through the existing purge path and then
  deletes the account, so that afterwards no `devices` row carries that account id
  and no `accounts` row exists for it. `expected_devices` is **required** for the
  cascade and must equal the account's current device count; a mismatch is a `409`
  that purges nothing. Two correctly-shaped ids differ only by their contents, so
  the count is what tells `acc_alpha` from `acc_alpha2` before anything is
  destroyed.

- **AC-11a** Each device is purged on its **own** deadline, detached from the
  request deadline, and the loop stops cleanly rather than starting a purge it
  cannot finish. A device that was not attempted is reported as not attempted, and
  is left whole — never with its row deleted and its WhatsApp session alive.
- **AC-12** If purging one device fails, the account row is **kept**, the
  remaining devices are still attempted, and the response names the device(s)
  that failed.
- **AC-13** If a device is attached to the account while the cascade is running,
  the account row is **not** deleted — the final state is re-checked before the
  account row is removed, so no device is ever left pointing at a deleted
  account.

### Invariants that must not break

- **AC-14** `SaveDeviceRecord`'s UPDATE branch still writes only `display_name`,
  `jid`, `ad_jid` and `updated_at`, so a reconnect cannot clear `account_id`,
  `priority` or `send_state`.
- **AC-15** No route's authentication changes: the account routes still require
  basic auth to be configured, and no per-account authorization is introduced.

- **AC-15a** The account layer is visible only where it is reachable: when the
  deployment has no `APP_BASIC_AUTH` configured, `GET /devices` returns exactly
  what it returns today — no `account_id`, `priority` or `send_state` — and the
  `account_id` filter answers `503 ACCOUNTS_AUTH_REQUIRED`, the same code the
  `/accounts` group uses. Otherwise the routing columns the `/accounts` group
  refuses to serve anonymously would be published through a route the guard does
  not cover.
- **AC-16** Every new mutating call (create-in-account, delete-account) writes an
  audit line carrying the acting username.

### Documentation and reset

- **AC-17** `readme.md` **and `docs/openapi.yaml`** document the three new routes,
  the new device response fields and the `account_id` filter, mark `POST /devices`
  as the legacy account-less path, and state that the cascade is irreversible.
  OpenAPI is included because it has specified the account endpoints since ticket
  16; documenting only the readme would leave the machine-readable spec stale.
- **AC-18** The existing `accounts` rows are removed from the deployment
  database, and no device is left carrying a deleted account. The procedure is
  recorded with the exact statements, and the state of the database that was
  actually inspected is reported rather than assumed.

## Test cases

| ID | Given | When | Then |
|----|-------|------|------|
| TC-1 | No account `acc_ghost` exists | `POST /accounts/acc_ghost/devices/create` | 404 `ACCOUNT_NOT_FOUND`; no device row is written and the registry is unchanged (AC-1) |
| TC-2 | Account `acc_alpha` exists | `POST /accounts/acc_alpha/devices/create` | The device row read straight back carries `account_id = acc_alpha` with no attach call in between (AC-2) |
| TC-3 | A fake storage counting its calls | A device is created through the new route | The account is present on the INSERT itself — no follow-up UPDATE writes it (AC-2/AC-3) |
| TC-4 | The legacy route | `POST /devices` with the pre-ticket body | Same response shape as before, device created with no account (AC-4) |
| TC-5 | Three devices, two of them in `acc_alpha` | `GET /devices` | Every entry carries `account_id`, `priority`, `send_state` (AC-5) |
| TC-6 | The same fleet | `GET /devices?account_id=acc_alpha` | Exactly the two devices of `acc_alpha` (AC-6) |
| TC-7 | `GET /devices?account_id=` with an id breaking the id pattern | The request is served | 400, and no storage call is made (AC-6) |
| TC-8 | A counting repository and N devices | `GET /devices` | The storage call count is 1 for the whole list, for N = 1 and N = 5 (AC-7) |
| TC-9 | `acc_alpha` with devices at priority 20 and 10 | `GET /accounts/acc_alpha/devices` | The priority-10 device comes first; nothing is written (AC-8) |
| TC-10 | `acc_alpha` owning one device | `DELETE /accounts/acc_alpha` | 409 `ACCOUNT_HAS_DEVICES`; the account row and the device row both still exist (AC-9) |
| TC-11 | `acc_empty` owning nothing | `DELETE /accounts/acc_empty` | Success; the row is gone. A second call returns 404 (AC-10) |
| TC-12 | `acc_alpha` owning two devices | `DELETE /accounts/acc_alpha?purge_devices=true` | Both devices are purged through the existing purge path, then the account row is deleted; no `devices` row carries `acc_alpha` (AC-11) |
| TC-13 | Purging the second device fails | The same cascade | The first device is still purged, the account row **survives**, and the response names the failed device (AC-12) |
| TC-14 | A device appears in the account after the purge loop finishes | The same cascade | The account row is not deleted, and the response says so (AC-13) |
| TC-15 | A device row carrying `account_id`, `priority`, `send_state` | `SaveDeviceRecord` is called with only display_name/jid/ad_jid set | All three routing columns are unchanged (AC-14 — the existing test, still green) |
| TC-16 | Basic auth not configured | Any account route, including the new ones | 503 `ACCOUNTS_AUTH_REQUIRED`, exactly as today (AC-15) |
| TC-17 | An actor authenticated as `ops` | A device is created in an account, and an account is deleted | Both write an audit line naming `ops` (AC-16) |
| TC-18 | A device id that exists as a row but not in the registry | `POST /accounts/acc_alpha/devices/create` with that id | 409; the existing row's `display_name`/`jid` are unchanged and its account is unchanged (AC-3a) |
| TC-19 | `acc_alpha` owning two devices | The cascade with `expected_devices=1` | 409; nothing is purged and the account survives (AC-11) |
| TC-20 | A deployment with no `APP_BASIC_AUTH` | `GET /devices`, then `GET /devices?account_id=acc_alpha` | The first carries no routing fields; the second is 503 `ACCOUNTS_AUTH_REQUIRED` (AC-15a) |

## Out of scope

- Consolidating the two creation paths into one mandatory-account path — a later
  ticket (decision D2).
- Per-account authentication / tenancy — a later ticket (decision D1).
- Detaching a device from its account without deleting it.
- Renaming an account, and any per-account device counter on `GET /accounts`.
- The Meta Cloud channel and number registration (ticket 20).
- Any change to the reply path, fallback order or transport rules (tickets 18/19).
- Deleting media files from disk (CON-6).
- Any index addition. `devices.account_id` stays unindexed: the table holds one
  row per WhatsApp slot (tens at most) and every path this ticket adds is
  operator-triggered.
