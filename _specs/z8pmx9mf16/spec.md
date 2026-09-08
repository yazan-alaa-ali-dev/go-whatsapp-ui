---
ticket: z8pmx9mf16
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-09-07
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf16"
  github: ""
---

# Specification — 6 · Add the account scope store and the accounts/users API layer

## Business goal

Phase 2 adds three administrative surfaces to this dashboard — accounts, account
devices, and users. Four tickets will build those screens. This one builds the
two things all four of them stand on, and **changes no screen at all**: the
primitive that owns *which account the operator is looking at*, and the typed
request layer for the endpoints those screens call.

The reason this is one ticket rather than the first slice of four is a single
fact about the backend, and it is the fact the whole phase rests on:

> **The account is not a scope on the wire.**

There is no `X-Account-Id` header, no impersonation request and no account-switch
endpoint. Exactly one thing carries scope to the server — the device id — and the
backend derives the account from the ownership of that device (study §04;
reference §06). Everything the UI calls "the current account" is therefore a
**client-side lens**: it narrows the list of devices the operator may pick from,
and the device selection does the rest.

That has a consequence which is not obvious and which is the single most
expensive bug this phase can ship. If the lens changes but the device selection
does not, the very next request leaves carrying a device belonging to the
*previous* account — and the backend answers `404 DEVICE_NOT_FOUND`, byte for
byte the same body it gives for a device that never existed, because a `403`
there would confirm the device exists (reference §06). The operator sees a
dashboard that has silently gone blank with no diagnosis available anywhere. The
lens and the device selection must therefore move in **one** state write.

Building this once, centrally, is also what keeps four later tickets from each
inventing their own answer to "which devices am I looking at", and then
disagreeing.

## User story

As **a Frontend Engineer**,
I want **the account scope primitive and the typed API clients for accounts and
users**,
so that **every phase-2 screen stands on one owner of the scope and one request
layer, instead of each screen inventing its own**.

## Functional requirements

- **REQ-1** — One client-side store owns the account scope, persisted under a
  versioned name, as every persisted store in this repository already is.
- **REQ-2** — The scope has exactly two meanings: the **implicit scope** (the
  account the principal belongs to, which the server applies by itself) and an
  **explicit account**. They are distinct values, and the implicit one is not
  spelled as an empty string.
- **REQ-3** — Changing the scope clears the selected device **synchronously, in
  the same action**, in both directions — entering an account and returning to
  the implicit scope.
- **REQ-4** — The scope store adds **no header** to any request. The HTTP layer
  is not touched by this ticket.
- **REQ-5** — A hook answers "the devices for the current scope", choosing the
  unfiltered device list for the implicit scope and the filtered one for an
  explicit account.
- **REQ-6** — The account filter is sent **only** when the principal holds the
  permission that makes it work; without that permission the server answers the
  filter with `503`, and a UI that asks for it anyway has manufactured its own
  failure.
- **REQ-7** — A blank value is never sent as the filter. A blank means *no
  filter* — never "the devices that have no account".
- **REQ-8** — A malformed account id (`400`) and an account with no devices
  (`200` with an empty list) are two different states, and the second is not an
  error.
- **REQ-9** — Every device query key carries the scope, so entering an account
  can never render the previous account's devices out of the cache. Existing
  prefix-based invalidation keeps working.
- **REQ-10** — A typed client covers all nine account endpoints and the six user
  endpoints, unwrapping the standard envelope like every other client here.
- **REQ-11** — The user update payload is a true partial: an untouched field is
  absent from the JSON, never present as an empty string.
- **REQ-12** — The shared registry device type carries the three routing fields
  the server returns only to a privileged caller, as optional fields read by key
  presence.
- **REQ-13** — The user-facing message table gains the phase-2 rejections, each
  saying what happened and what to do next.

## Non-functional requirements

- **NFR-1 — Nothing renders differently.** No screen, route, navigation item or
  existing request changes behaviour. A reviewer must be able to run the app
  before and after this ticket and see no difference.
- **NFR-2 — No new authority.** Nothing here decides a right from a role name,
  and nothing reads the principal's permission list except through the single
  reader ticket 5 established. Hiding a control remains an affordance and never
  enforcement.
- **NFR-3 — No server text is rendered as HTML.** Account names and usernames are
  server-supplied strings and are treated as such.
- **NFR-4 — Presence and permission stay different authorities.** The optional
  device routing fields are read by key presence; they are not folded into the
  message-masking vocabulary, and the two modules do not learn about each other.
- **NFR-5 — Every new pure function is unit-tested**, and the rules this ticket
  relies on are executable where they can be.

## Constraints

- **C-1** — The dependency chain: this ticket needs the permissions layer from
  `z8pmx9md71` and the session store from `z8pmx9md6y`. Both are merged into the
  branch this one is cut from.
- **C-2** — No deployment runtime file may be touched
  (`.github/workflows/ci.yml`, `.github/workflows/release.yml`,
  `vite.config.ts`, `package.json`, `index.html`).
- **C-3** — There is no component renderer in this repository's test
  environment. A test of rendering behaviour must be written against something
  other than a mounted tree, or written as a test of the pure function under it.
- **C-4** — No browser pass is available in this session, so anything that can
  only be observed in a running browser is recorded as such rather than claimed.
- **C-5** — `src/lib/source-policy.test.ts` is a test that fails the build, not
  optional lint. Two of its rules collide with this ticket head-on: the ban on
  naming `role`/`roles` outside five files, and the single-reader rule on
  `permissions`.
- **C-6** — Eight backend questions (study §14, Q-1..Q-8) have no answer in
  either document. This ticket may not guess at them; where one touches the
  work, the safe assumption is taken and recorded.

## Acceptance criteria

### Account scope store

- **AC-1** — One store owns the account scope and is persisted under the
  versioned name `gowa-ui.account.v1`.
- **AC-2** — `null` means the implicit scope — whatever account the principal
  belongs to — and is a distinct value from any explicit account id.
- **AC-3** — Entering an account clears the selected device **in the same
  synchronous action**, never from a later effect: a device of the previous
  account must never travel in `X-Device-Id` after the scope has changed.
- **AC-4** — Returning to the implicit scope clears the selection the same way.
- **AC-5** — This store adds **no header** to any request; the HTTP layer is
  untouched.

### Scoped device list

- **AC-6** — A hook returns the device list for the current scope: the
  unfiltered list for the implicit scope, the `account_id`-filtered list for an
  explicit one.
- **AC-7** — The `account_id` parameter is sent **only** when the principal
  holds `accounts.manage` — without it the filter answers `503`.
- **AC-8** — A blank value is never sent as the filter: a blank means **no
  filter**, and never "the devices that have no account".
- **AC-9** — A `400` (malformed account id) and a `200` with an empty list are
  surfaced as **two different states** — an error, versus "this account has no
  devices".
- **AC-10** — Naming a foreign account answers `200` with an empty list and is
  not treated as an error — the response must not be usable to discover which
  accounts exist.

### Query keys

- **AC-11** — Every device query key carries the scope, so entering an account
  never renders the previous account's devices out of the cache.
- **AC-12** — Separate keys exist for the account list, an account's devices,
  and the paged user list.
- **AC-13** — The existing WebSocket-driven invalidation keeps working by key
  prefix.

### Accounts API client

- **AC-14** — A typed client covers all nine account endpoints: list accounts,
  create account, delete account, list account devices, attach an existing
  device, create a device inside the account, set the device order, set a device
  send state, set the SMS fallback.
- **AC-15** — `Account` is typed as `account_id`, `name`,
  `sms_fallback_enabled` (**always present**, no omitempty), `created_at`,
  `updated_at`.
- **AC-16** — `meta_token_ref` is **not** on any response type — the field does
  not exist on the response at all, not even hidden behind a tag.
- **AC-17** — The account device type is `device_id`, `jid`, `transport`,
  `priority`, `send_state`, plus `fallback_allowed` and `fallback_reason` as
  **optional** — the reference text carries them while the OpenAPI schema does
  not, so presence is not assumed.
- **AC-18** — The delete result is typed as a **partial-execution report**:
  `account_deleted`, `purged_devices`, `failed_devices`,
  `not_attempted_devices` — not a boolean.

### Users API client

- **AC-19** — A typed client covers list (with `limit` / `offset`), read one,
  create, update, delete, and the administrative password reset.
- **AC-20** — The administration user type carries `user_id`, `username`,
  `email`, `account_id`, `status`, `roles[]`, `token_epoch`, `created_at`,
  `updated_at`.
- **AC-21** — It deliberately carries **no** `permissions` field — the effective
  union is answered by `GET /auth/me` alone — and no password hash, which does
  not exist on the server type.
- **AC-22** — The list response is a **flat array with no total**; the client
  does not invent one.
- **AC-23** — The update payload is a **partial**: an absent field is omitted
  from the JSON entirely, and no field is ever sent as an empty string "to
  complete the shape".

### Registry device type

- **AC-24** — The registry device type gains `account_id`, `priority` and
  `send_state` as **optional** fields, because they are returned only when the
  caller holds `accounts.manage`.
- **AC-25** — They are read by **key presence**, not by value.
- **AC-26** — They are **not** added to the message masking helper: device
  fields and message masking are two different authorities, and the source
  policy forbids the two modules importing each other.

### Error vocabulary

- **AC-27** — The user-facing message table gains the phase-2 rejections next to
  the existing permission-denied entry: `409 ACCOUNT_HAS_DEVICES`,
  `409 ACCOUNT_DEVICE_COUNT_MISMATCH`, `409` duplicate username / email / inline
  account id, `404` unknown account or role, `403` privilege escalation, `403`
  self mutation, `409` last administrator, `503` password hashing at capacity.
- **AC-28** — Each message says what happened and what to do next; no raw server
  string is rendered as HTML.

### Testing

- **AC-29** — Unit tests cover the atomic device clear on scope change, the
  filter-parameter rule, the empty-versus-malformed distinction, and the partial
  update payload builder.

## Test cases

| ID | Case | Maps to |
|---|---|---|
| TC-1 | A device of account A is selected; the scope is set to account B. The selected device becomes `null` in the same state write, and no request leaves carrying A's device id after the change. | AC-3 |
| TC-2 | The scope is returned to the implicit one from an explicit account with a device selected. The selection is cleared identically. | AC-4 |
| TC-3 | Setting the scope to the value it already holds still leaves the selection in a defined, documented state. | AC-3, AC-4 |
| TC-4 | A principal without `accounts.manage` requests the scoped device list. The request carries no `account_id` parameter, and the UI never manufactures the `503`. | AC-7 |
| TC-5 | A principal with `accounts.manage` and an explicit scope. The request carries the `account_id` parameter. | AC-6, AC-7 |
| TC-6 | The scope is an empty or whitespace-only string. No filter parameter is sent. | AC-8 |
| TC-7 | The device list answers `200` with an empty array for a foreign account. The result is the empty state, not an error, and nothing concludes the account exists. | AC-10 |
| TC-8 | The device list answers `400`. The result is an error state, distinguishable from TC-7. | AC-9 |
| TC-9 | Account A's devices are in the cache and the scope changes to B. No entry from A is served for B's key. | AC-11 |
| TC-10 | The WebSocket device events invalidate the scoped key by prefix. | AC-13 |
| TC-11 | Only `status` was changed on a user form. The built payload contains `status` and nothing else — `account_id` is absent, and certainly not `""`. | AC-23 |
| TC-12 | A field is deliberately cleared to an empty string on a user form where the server accepts one. The payload distinguishes that from an untouched field. | AC-23 |
| TC-13 | The account and account-device types are checked against the reference's field lists, and `meta_token_ref` and `permissions` are absent from every response type. | AC-15, AC-16, AC-17, AC-20, AC-21 |
| TC-14 | The delete-account result is consumed as a report; a caller cannot read it as a boolean without the compiler objecting. | AC-18 |
| TC-15 | Each new rejection maps to a message that names what happened and what to do next, and no branch returns a raw server string alone. | AC-27, AC-28 |
| TC-16 | The three new registry device fields are read by key presence and are absent from the masked-field list. | AC-24, AC-25, AC-26 |

## Out of scope

- **Every screen, route and navigation change** — that is ticket 7. This ticket
  adds no page, no route, no navigation item and no rendered component.
- The accounts, account-devices and users **surfaces** themselves — tickets 8, 9
  and 10.
- `homeSurface()` and any navigation derivation (study §12 lists it beside these
  files; it belongs to ticket 7, which is where its only caller will be).
- Any change to the HTTP layer, the WebSocket, or the device store's own shape.
- Answering the eight open backend questions (study §14). Where one touches this
  work it is recorded as a known limit, not resolved by guessing.

## Known limits

- **The scope is a lens, and it is only advisory.** Nothing in this ticket
  prevents a request from carrying a device outside the current scope; it makes
  the UI stop *offering* one. The server's ownership check is the control, and
  it answers `404`, not `403` — so a mismatch is indistinguishable from a device
  that does not exist. That is the backend's deliberate design (reference §06)
  and this ticket does not try to unmask it.
- **`fallback_allowed` and `fallback_reason` are typed optional on evidence, not
  on preference.** The reference text carries them on the account device object
  and the OpenAPI schema does not (study §14, Q-8). Optional is the shape that
  is true under both readings.
- **`GET /auth/users` has no total and no account filter** (study §14, Q-3).
  This ticket types the list as the flat array it is and does not invent a
  count; the paging consequences land on ticket 10.
- **The seeded roles are not discoverable.** There is no endpoint listing
  available roles (study §14, Q-2), so `roles[]` is typed as the string array
  the wire carries and nothing here validates a member of it.
- **No running server was involved.** Every assertion in this ticket is made
  against the reference documents and against tests; none is made against a live
  gowa instance.
