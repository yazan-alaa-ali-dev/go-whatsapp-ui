---
ticket: z8pmx9mf18
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-09-07
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf18"
  github: ""
---

# Specification — 8 · Build the accounts list and the account lifecycle

## Business goal

Onboarding a customer and offboarding one are today operations of the database.
There is no way to see which accounts exist, no way to create one, and no way to
end one — the account layer exists on the wire, ticket 6 typed it, ticket 7
opened the route, and `/accounts` still renders a placeholder.

The screen is worth building carefully for one reason: **it is the first surface
in this phase that destroys data, and what it destroys cannot be recreated from
this product.** Purging a device destroys its WhatsApp session keys; re-pairing
needs physical access to the customer's phone. So the delete is not a button with
a confirmation — it is a two-step confirmation over a **partial-execution
report**, because the endpoint legitimately answers `200` having deleted nothing.

The second goal is narrower and easy to get wrong: **one screen serves both
audiences.** `GET /accounts` already returns every account to a global caller and
only the caller's own account to everybody else (reference §05), so the account
administrator's view is the same component with one row in it. No branch produces
that, and no second "admin" screen is built — two screens doing the same job
diverge within a quarter.

## User story

As **a Super Administrator**,
I want **to see every account, create one, and end one safely**,
so that **onboarding and offboarding a customer are operations of the product
rather than of the database**.

## Functional requirements

- **REQ-1 — The list is one component for both audiences.** `/accounts` renders
  the rows `GET /accounts` returns. The server scopes the response; no client
  branch chooses what to show.
- **REQ-2 — The columns are the ones the account object carries.** Name, account
  id, SMS fallback state, created date, and a way into the account. There is no
  device-count column: the count is not on the account object (`Q-7`), and one
  request per row to obtain it is not acceptable.
- **REQ-3 — The detail screen is built from the list.** There is no
  single-account read endpoint (`Q-5`), so nothing fetches an account by id.
- **REQ-4 — No account name is editable.** No endpoint changes it (`Q-5`), so no
  editable name field is rendered anywhere.
- **REQ-5 — Creation is offered only with `accounts.manage.all`.** Fields: an
  optional `account_id` (generated when omitted), a `name`, and an optional
  advanced `meta_token_ref`.
- **REQ-6 — `meta_token_ref` is the name of an environment variable, not a
  token.** The helper text says so, the field validates the configured prefix
  (`META_TOKEN_` by default) before the request is made, and the value is never
  rendered back after creation.
- **REQ-7 — Creation is a create, not an upsert.** Naming an existing account
  answers `409` and is reported as "an account with this id already exists",
  never as a silent overwrite.
- **REQ-8 — Deletion is offered with `accounts.manage` within scope.**
- **REQ-9 — The cascade is asked for explicitly or not at all.** An account that
  still owns devices is refused with `409 ACCOUNT_HAS_DEVICES` unless the purge
  was requested; the refusal is rendered rather than pre-empted.
- **REQ-10 — The confirmation is two steps.** Step one states the account's
  current device count and requires the account name to be typed. Step two sends
  the request.
- **REQ-11 — `expected_devices` is read live at the moment of submission.** Never
  from a cached list, and never defaulted — a missing value is not read as zero.
- **REQ-12 — A count mismatch is rendered as a mismatch.** `409
  ACCOUNT_DEVICE_COUNT_MISMATCH` means nothing was purged and nothing deleted;
  the message says the count changed and asks for a reload.
- **REQ-13 — The outcome is a report, not a toast.** Which devices were purged,
  which failed, and which were never attempted because the request deadline
  expired, each listed separately.
- **REQ-14 — `account_deleted` is the only field that answers "is this account
  gone".** A `200` carrying `account_deleted: false` is never presented as
  success.
- **REQ-15 — A kept account offers a re-run.** The cascade is safe to re-run,
  because whatever was not purged is still owned by the account.
- **REQ-16 — The dialog states the cost in plain words.** Purging a device
  destroys its WhatsApp session keys, re-pairing needs physical access to the
  customer's phone, and it is irreversible.
- **REQ-17 — The dialog names the documented alternative to ending a
  subscription:** block every device and keep the data.
- **REQ-18 — Nothing on this screen is gated on a role name.** Create is hidden
  without `accounts.manage.all`; delete is hidden without `accounts.manage`.
- **REQ-19 — A `403` that arrives anyway is a permission message.** It triggers
  no refresh and no logout.
- **REQ-20 — The account scope does not survive the account.** Deleting the
  account the session is currently scoped into returns the scope to implicit,
  and so does a scope naming an account that a loaded account list does not
  contain.
- **REQ-21 — Deleting your own account is named as what it is.** When the target
  is the account the signed-in principal belongs to, the dialog says so: this
  ends their access to the dashboard and there is no way back through the
  product.

## Non-functional requirements

- **NFR-1 — Every decision on this screen is provable.** This repository has no
  component renderer in its test environment, so each decision — what to send,
  what the outcome was, which rejection this is, whether the scope must be left —
  is a pure function taking its inputs as arguments, with a colocated test. A
  decision embedded in JSX is a decision nobody can assert.
- **NFR-2 — One query per screen, no per-row request.** The list is a single
  `GET /accounts` shared through the existing `accountsKey()`. No hook is called
  per row and no permission is read per row.
- **NFR-3 — Hiding a control is an affordance, never enforcement.** The server
  guards every route; a hidden control is one the operator is spared.
- **NFR-4 — The reference value is never displayed, logged, or persisted.**
  `meta_token_ref` exists on the create request and on no response type; nothing
  reads it back.
- **NFR-5 — Server-supplied text is rendered as text.** Account names are
  operator-chosen strings and are sanitised and capped by the existing
  `accountName` before they reach the chrome.
- **NFR-6 — No new dependency.** The dialogs are built from the shadcn/ui
  primitives already vendored.

## Constraints

- **C-1** — The account API layer (`src/api/accounts.ts`) is complete and tested
  from ticket 6 and is **not** modified. This ticket consumes it.
- **C-2** — `permissions[]` is read only through `@/hooks/use-permissions`; no
  file may decide anything from `role` or `roles[]`
  (`src/lib/source-policy.test.ts`).
- **C-3** — `@/stores/account` may be imported only where the scope is owned or
  applied; widening that allowlist requires a written justification inside the
  test.
- **C-4** — No deployment runtime file is touched.
- **C-5** — No dynamic `import()` and no `React.lazy` — the single-file build
  forbids code splitting.

## Acceptance criteria

### The list

- **AC-1** — `/accounts` lists the accounts `GET /accounts` returns; an account
  administrator sees exactly one row and no code branch produces that. (REQ-1)
- **AC-2** — The columns are name, account id, SMS fallback state, created date,
  and an action that opens the account. (REQ-2)
- **AC-3** — There is no device-count column in the list; the count is shown on
  the account detail screen instead. (REQ-2)
- **AC-4** — No component fetches an account by id; the detail screen is built
  from the list. (REQ-3)
- **AC-5** — No editable account-name field is rendered anywhere. (REQ-4)

### Creating an account

- **AC-6** — The create action is rendered only for a holder of
  `accounts.manage.all`. (REQ-5, REQ-18)
- **AC-7** — The form carries an optional `account_id`, a `name`, and an optional
  advanced `meta_token_ref`; an omitted id is sent as omitted, not as `''`.
  (REQ-5)
- **AC-8** — `meta_token_ref` is rejected before the request when it is not a
  plausible environment-variable name carrying the configured prefix, and the
  helper text names the prefix and says the field is a name, not a value.
  (REQ-6)
- **AC-9** — No value of `meta_token_ref` is rendered after creation, and the
  field is cleared when the dialog closes. (REQ-6, NFR-4)
- **AC-10** — A `409` from `POST /accounts` is reported as "an account with this
  id already exists", never as a silent overwrite. (REQ-7)

### Deleting an account

- **AC-11** — The delete action is rendered only for a holder of
  `accounts.manage`. (REQ-8, REQ-18)
- **AC-12** — The cascade is a deliberate, off-by-default opt-in in the dialog;
  without it the request carries no `purge_devices`, and a `409
  ACCOUNT_HAS_DEVICES` is rendered as its own notice. (REQ-9)
- **AC-13** — The confirmation has two steps: step one states the account's
  current device count and requires the account's **id** to be typed exactly;
  step two is the submission. (REQ-10)

  > **Revised after the advisory panel (security lens).** The ClickUp criterion
  > asks for the account *name*. Three facts make the name the wrong string to
  > confirm an irreversible purge against: it is not unique (only `account_id`
  > is), it is server-controlled text that `accountName` must strip of Unicode
  > control and format characters and truncate at 60 characters — so the dialog
  > would display either a string the operator cannot type or a raw one that
  > re-opens the bidi reordering attack ticket 7 closed — and the id is already
  > rendered raw by `IdText` and is immune to both. The name is displayed
  > alongside, sanitised, as context. The deviation makes the confirmation
  > stronger, and is recorded in `plan.md` and `implement.md`.
- **AC-14** — When the cascade was asked for, the submitted `expected_devices` is
  the length of a device list read at submission time, never a cached one and
  never a default. (REQ-11)
- **AC-15** — A `409 ACCOUNT_DEVICE_COUNT_MISMATCH` is rendered as its own
  notice: nothing purged, nothing deleted, reload and try again. (REQ-12)
- **AC-16** — The outcome is rendered as a report listing purged, failed and
  not-attempted devices separately. (REQ-13)
- **AC-17** — The success path is chosen from `account_deleted` alone; a `200`
  carrying `account_deleted: false` is never presented as success. (REQ-14)
- **AC-18** — When the account was kept, a re-run action is offered, and it
  re-reads the device count live. (REQ-15, REQ-11)
- **AC-19** — The dialog states that purging destroys WhatsApp session keys, that
  re-pairing needs physical access to the customer's phone, and that it is
  irreversible. (REQ-16)
- **AC-20** — The dialog names the documented alternative: block every device and
  keep the data. (REQ-17)
- **AC-21** — After a response that deleted the account, the account list is
  refetched and, if the session was scoped into that account, the scope returns
  to implicit. The device caches are told what actually changed: the `['devices']`
  prefix whenever devices were purged, and the deleted account's device key
  removed rather than refetched. (REQ-20)
- **AC-21a** — Deleting the account the signed-in principal themselves belongs to
  carries a distinct warning naming that consequence. The action is not withheld
  — the server is the authority — but it is never presented as an ordinary
  delete. (REQ-21)
- **AC-21b** — A scope naming an account that is absent from a loaded, non-empty
  account list returns to implicit. A pending or failed list leaves it alone.
  (REQ-20)

  > **AC-21a and AC-21b were added after the advisory panel (security lens).**
  > For a holder of `accounts.manage` without `.all`, `GET /accounts` returns
  > exactly one row — their own account — so the only delete this screen offers
  > them is an irreversible self-lockout with no in-product recovery, and nothing
  > in the ClickUp criteria mentions it. Separately, the account lens persists to
  > `localStorage` and zustand's persist does not broadcast, so a second tab
  > keeps a lens naming a deleted account; `GET /devices?account_id=<gone>`
  > answers `200` with an empty array, which is the undiagnosable blank state
  > ticket 7 built the context bar to prevent.

### Permissions

- **AC-22** — Nothing on this screen reads `role` or `roles[]`; every gate is a
  permission. (REQ-18, C-2)
- **AC-23** — Permission booleans are hoisted once per screen; no `<Can>` and no
  permission hook is called per row. (NFR-2)
- **AC-24** — A `403` is surfaced as a permission message and triggers no refresh
  and no logout. (REQ-19)

### Testing

- **AC-25** — Tests cover the two-step confirmation payload, the live device
  count, the partial-report rendering decision and the "kept on purpose"
  outcome. (NFR-1)
- **AC-26** — The build-failing source policy passes, including the rules this
  ticket adds. (C-2, C-3, NFR-4)

## Test cases

| # | Case | Maps to |
|---|---|---|
| TC-1 | An account administrator — `accounts.manage`, not `.all` — loads `/accounts`: exactly the caller's own account is listed and the create action is absent. | AC-1, AC-6 |
| TC-2 | Delete is confirmed without asking for the cascade on an account owning two devices: the request carries no `purge_devices`, the server answers `409 ACCOUNT_HAS_DEVICES`, and the notice explains the devices must be purged explicitly. | AC-12 |
| TC-3 | The dialog was opened when the account had two devices and a third was attached meanwhile: the cascade submits the count read at submission, the server answers `409 ACCOUNT_DEVICE_COUNT_MISMATCH`, and the UI asks for a reload rather than retrying with the stale number. | AC-14, AC-15 |
| TC-4 | A cascade in which one device failed answers `200` with `account_deleted: false`: it is not reported as deleted, the purged / failed / not-attempted devices are listed separately, and a re-run action is offered. | AC-16, AC-17, AC-18 |
| TC-5 | A literal token typed into the reference field is rejected before the request; the helper text names the required prefix; no value of the field is rendered after creation. | AC-8, AC-9 |
| TC-6 | An omitted `account_id` is sent as an omitted field, not as an empty string; a blank `meta_token_ref` is omitted the same way. | AC-7 |
| TC-7 | A `409` from create maps to the "account id already exists" notice, and a `409` from delete maps to one of the two delete notices according to which request was made. | AC-10, AC-12, AC-15 |
| TC-8 | `account_deleted: true` with a non-empty `failed_devices` — a shape the server documents as impossible — is still read from `account_deleted`, and the failures are still listed. | AC-17 |
| TC-9 | Deleting the account the session is scoped into returns the scope to implicit; deleting a different account, or a response that kept the account, leaves the scope alone. | AC-21 |
| TC-9a | A scope naming an account absent from a loaded, non-empty list returns to implicit; a pending list, a failed list and an empty list each leave it alone. | AC-21b |
| TC-9b | The delete of the principal's own account is recognised as such; the delete of any other account is not. | AC-21a |
| TC-10 | The typed confirmation matches the account id exactly and rejects a near miss, leading and trailing whitespace excepted; a blank box never confirms. | AC-13 |
| TC-11 | `npm run test` passes `source-policy.test.ts`, including the rules this ticket adds. | AC-26 |
| TC-12 | The accounts screen renders no `<Can>` and calls no permission hook inside a `.map(`. | AC-23 |

## Out of scope

- The devices tab of an account — membership, reply order, blocking (ticket 9).
- The users tab of an account (ticket 10).
- The SMS fallback switch (ticket 11). This ticket **displays** the state the
  account object carries and changes nothing.
- Any change to `src/api/accounts.ts`, which ticket 6 completed and tested.
- Resolving the study's open questions `Q-1..Q-8`. `Q-5` and `Q-7` are *obeyed*
  here (no single-account read, no device-count column), not resolved.
- Editing an account name — there is no endpoint.
- Detaching a device from an account — there is no endpoint (`Q-6`).

## Known limits

- **`GET /accounts` has no pagination and no total.** The deployment's assumed
  order of magnitude is tens of accounts. The list renders what it is given; a
  search or a page control belongs to a later ticket and to a backend that can
  support one.
- **The `META_TOKEN_` prefix is a client-side constant.** The reference calls it
  "the configured prefix (default `META_TOKEN_`)", and this client has no way to
  read a deployment's configuration. A deployment that configured a different
  prefix must change the constant; until then the server remains the authority
  and its rejection is rendered.
- **Nothing is verified against a running gowa server.** Every assertion is made
  against the reference and against tests.
