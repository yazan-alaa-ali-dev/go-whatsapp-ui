---
ticket: z8pmx9kzc7
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-08-25
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzc7"
  github: ""
---

# Specification — 16 · Add the account layer above devices

## Business goal

Devices are today a flat list: every WhatsApp number is an island, and nothing in
the store says which numbers belong to the same operator. Tickets 17–20 need that
statement — a reply that cannot leave from the number it arrived on must be able
to leave from a **sibling** number, and "sibling" has no meaning without a
grouping. This ticket introduces the grouping and the routing columns, and
nothing else: no runtime path reads them yet, so the server must behave exactly
as it does today.

## User story

As **an operator running several WhatsApp numbers**, I want **to group my numbers
under one account and order them**, so that **a later ticket can send a reply from
a sibling number instead of failing, without the reply ever leaving my account**.

## Functional requirements

- **REQ-1** An `accounts` table exists and holds an account identity, a display
  name, and a **reference** to a Meta access token (never the token).
- **REQ-2** Every device row carries the routing columns the later tickets read:
  account membership, transport, priority, send state, and the three Meta
  identity columns.
- **REQ-3** The new device columns are readable through the repository — a value
  written to the column comes back out of the device-read paths.
- **REQ-4** An operator can create an account, list accounts, attach an existing
  device to an account, set the reply order inside an account, and mark a device
  blocked or usable.
- **REQ-5** `account_id = ''` denotes **absence** of an account, not a shared
  account, and is never presented as an account entity.
- **REQ-6** Values drawn from a closed list (`send_state`, `transport`, the
  priority shape, the token-reference shape) are validated in one place.
- **REQ-7** The account endpoints reach storage through a domain interface and a
  usecase, not from the HTTP handler.
- **REQ-8** The account endpoints are protected: when the deployment has no
  credentials configured, the request is refused.

## Non-functional requirements

- **NFR-1** The server boots against a pre-existing database on **both** SQLite
  and PostgreSQL; no migration statement is dialect-specific and none of them
  rewrites existing rows.
- **NFR-2** No existing behaviour changes: no runtime path reads the new columns
  in this ticket, and no existing API response gains or loses a field.
- **NFR-3** The Meta token reference never appears in a response or a log line,
  and the resolved token never enters the database.
- **NFR-4** The account endpoints never execute inside a device context they did
  not ask for.
- **NFR-5** An account is an **organizational grouping within one trust domain**,
  not an authorization boundary. Basic auth in this service is a flat
  `user:secret` list with no per-credential scope, so any authenticated caller can
  list every account, attach any device and block any device; the account scope in
  the `WHERE` clauses prevents accidents, not privilege escalation. Every mutating
  account call therefore records the acting username in an audit log line. Tickets
  17–20 must not read account membership as tenant isolation.

## Constraints

- **CON-1** No deployment runtime file is modified (`docker-compose.yml`,
  `docker/golang.Dockerfile`, `docker/entrypoint.sh`, the three workflows).
- **CON-2** The migration list is **append-only** and index-positional; on
  PostgreSQL the whole pending batch runs in one transaction, so a single
  unportable statement stops the server from booting.
- **CON-3** Two companion slots legitimately share one `jid` and differ only by
  `ad_jid`. No constraint may forbid that.
- **CON-4** The name `AccountID` is already taken by `ChatwootDeviceConfig` and
  means a Chatwoot account. The new field must not reuse it.

## Acceptance criteria

### Schema

- **AC-1** Migrations M-a…M-h are appended to the existing list: the `accounts`
  table, and `account_id`, `transport`, `priority` (default `100`), `send_state`,
  `meta_phone_number_id`, `meta_display_phone`, `meta_waba_id` on `devices`.
- **AC-2** A partial unique index exists on `devices(meta_phone_number_id)
  WHERE meta_phone_number_id <> ''`.
- **AC-3** Non-unique indexes `idx_devices_jid` on `devices(jid)` and
  `idx_devices_ad_jid` on `devices(ad_jid)` are created.
- **AC-4** **No unique index is created on `devices(jid)`** — two companion slots
  legitimately share one `jid`.
- **AC-5** Every migration statement runs on both SQLite and PostgreSQL, holds a
  single statement, and no migration issues an `UPDATE` backfill.
- **AC-6** `idx_devices_account_priority` is **not** shipped here (ticket 19).
- **AC-7** `chats.bsuid` (M-j) is **not** shipped here (ticket 20).

### Visibility of the new columns

- **AC-8** `DeviceRecord` carries the seven new fields, named so they do not
  collide with the existing Chatwoot `AccountID` (`GowaAccountID`).
- **AC-9** The explicit column lists in `ListDeviceRecords` and
  `GetDeviceRecordByJID` both include the new columns, and the chat-storage
  wrapper is updated alongside the repository.

### Default-account semantics

- **AC-10** `account_id = ''` means **"no account"**, never "one shared account":
  such a row is arrival-only and has no siblings.
- **AC-11** `GET /accounts` never returns `''` as an account entity.

### Accounts API

- **AC-12** Exactly five endpoints ship: `POST /accounts`, `GET /accounts`,
  `POST /accounts/:account_id/devices`, `PUT /accounts/:account_id/devices/order`,
  `PATCH /accounts/:account_id/devices/:device_id`.
- **AC-13** `POST /accounts/:account_id/meta-numbers` is **not** shipped here.
- **AC-14** `POST /accounts` generates `account_id` when it is omitted, mirroring
  the `CreateDevice` uuid pattern.
- **AC-15** `POST /accounts/:account_id/devices` **links only** — it never creates
  a device slot and never sets priority; a device belongs to at most one account.
- **AC-16** `PUT …/devices/order` accepts the **complete** ordered list; it
  rejects a list that omits a device of the account or names a device from
  another account.
- **AC-17** `PATCH …/devices/:device_id` accepts `send_state` from the closed list
  `{"", "blocked"}` only and returns 400 for anything else; it is also the only
  way to clear the flag.
- **AC-18** `meta_token_ref` is a **reference** (an env-var name or secrets-store
  key), accepted only with the configured prefix; a literal token is rejected.
  The prefix allowlist is enforced on **read and resolve** as well as on write.
- **AC-19** `meta_token_ref` is never returned in any response — not even as a
  reference — and the resolved value is never logged.
- **AC-20** Closed-list validation (`send_state`, `transport`, priority shape)
  lives in one place, `src/validations/account_validation.go`, not inline in each
  handler.

### Layering

- **AC-21** The handler does not touch `IChatStorageRepository` directly: a
  `domains/account` package (interface + DTO) and an account usecase carry the
  work, and `ui/rest/account.go` stays thin.

### Authorization

- **AC-22** The account endpoints are registered on `apiGroup` **above** the
  `headerDeviceGroup` of `cmd/rest.go`, so they never execute inside a device
  context they did not ask for.
- **AC-23** The protection decision is **made and implemented in this ticket**:
  when no credentials are configured the account endpoints reject the request.

### Behaviour preservation

- **AC-24** The server boots against a pre-existing database with no behaviour
  change; existing devices keep working with `account_id = ''`.
- **AC-25** Reconnect and boot do not clear `account_id`, `priority` or
  `send_state` — pinned by a regression test, not left implicit.
- **AC-26** Both migration-count tests are updated to the new count and pass.

## Out of scope

- Reading any new column on a send, receive, or webhook path (tickets 17–19).
- The Meta Cloud inbound receiver, `POST /…/meta-numbers`, and `chats.bsuid`
  (ticket 20).
- `idx_devices_account_priority` (ticket 19).
- Country-based routing and the extended fallback matrix.
- Any change to `POST /devices` slot creation.
