---
ticket: z8pmx9mf19
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-09-08
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf19"
  github: ""
---

# Specification — 9 · Build the account devices surface

## Business goal

The reply path of an account is currently something an operator **infers from
behaviour**. Which devices an account owns, which of them is tried first, which
one is blocked, and whether a device's webhook is even switched on — none of
those questions has a screen. `/accounts/:accountId` renders a device *count* and
an empty state saying the surface is not built yet.

The screen is worth building carefully for two reasons, and both are traps rather
than features:

1. **Two endpoints answer "which devices does this account own", and only one of
   them is right.** `GET /accounts/{id}/devices` reads the device rows — which is
   what the reply path itself reads — and `GET /devices?account_id=` reads the
   live registry, which carries connection state but cannot show a row the
   registry did not load. Building the membership list from the registry silently
   drops devices, and the *next* thing an operator does is change the order,
   which then submits a list missing those devices and is refused with `400`. The
   join must be a **left join on the rows**.
2. **Two different operations both look like "turn the webhook off".** Emptying
   `webhook_url` through `PATCH /devices/{id}/webhook` is a **deletion** — it
   erases the URL, the secret and the event list, and the device's events then
   fall back to the deployment-wide webhook list, so events keep going out, just
   somewhere else. `PATCH /devices/{id}/webhook/enabled` with `false` is
   **silence**: nothing is delivered, nothing falls back, and the AI agent bridge
   is not called, so no automatic reply reaches the customer. A UI that conflates
   them either leaks a customer's events to the wrong endpoint or silently stops
   answering them.

## User story

As **an Account Administrator**,
I want **to see, order, block, add and configure the devices of an account in one
place**,
so that **the reply path of that account is something I can inspect and change,
instead of something I infer from behaviour**.

## Functional requirements

### The membership list

- **REQ-1 — Membership, reply order and send state come from the rows.**
  `GET /accounts/{account_id}/devices` is the authoritative answer to which
  devices an account owns.
- **REQ-2 — Connection state comes from the registry.**
  `GET /devices?account_id=` carries the live `state`, `display_name` and
  `phone_number`, and nothing else on this screen is sourced from it.
- **REQ-3 — The two are joined as a left join on the rows.** A row with no
  registry match still belongs to the account and is presented with an
  "unknown / not loaded" state, never as `disconnected`.
- **REQ-4 — A registry entry with no row is not invented into the list.** The
  membership list is exactly the row set.
- **REQ-5 — Building the membership list from the registry alone is forbidden**,
  and the prohibition is executable rather than a comment.

### Reply order

- **REQ-6 — Order is presented as a position, not as a `priority` number.**
  `100` is the column default meaning "unordered"; showing the raw number invites
  a manual edit the endpoint does not accept.
- **REQ-7 — Lower priority is tried first, and the screen says so in words.**
- **REQ-8 — Reordering sends the complete ordered device set of the account**,
  built from the row source, through `PUT /accounts/{account_id}/devices/order`.
- **REQ-9 — A refused order is reloaded, not retried.** A list that omits a
  device, repeats one, or names a device of another account answers `400` and
  nothing is written; the UI re-reads the rows.
- **REQ-10 — At most 256 entries** are ever submitted, and a longer set is
  refused client-side with a stated reason rather than sent.

### Send state

- **REQ-11 — Blocking uses the closed list.**
  `PATCH /accounts/{account_id}/devices/{device_id}` with the empty string
  (usable) or `blocked` (skipped by the reply fallback).
- **REQ-12 — The empty string is a legitimate value** and no payload-cleaning
  helper may drop it — it is the only way to clear the flag.
- **REQ-13 — A blocked device stays in the order** with a clear badge and is
  never removed from the list, or unblocking becomes unreachable.
- **REQ-14 — Order and blocking are orthogonal** and the screen presents them
  that way.

### Fallback readiness

- **REQ-15 — `fallback_allowed` is labelled "allowed as fallback", never
  "ready".** Sending also requires that the device is not blocked and that its
  session is live; it is half the answer.
- **REQ-16 — `fallback_allowed` and `fallback_reason` are optional** and are
  rendered only when present.

### Creating and attaching devices

- **REQ-17 — Creation inside an account uses the account-scoped path.**
  `POST /accounts/{account_id}/devices/create` creates a slot owned by the
  account from its first stored row, so there is no window in which the device
  belongs to nobody. It is the only creation path **the account surface** offers.
- **REQ-17a — The generic device dashboard keeps `POST /devices`, and reports
  what it produced.** *(Revised after the advisory panel — see `plan.md > Panel
  response`, finding S-1.)* The ticket's stated decision was that the generic
  path stops being a creation path anywhere in the UI. It cannot be: the
  account-scoped endpoint requires `accounts.manage + scope` (reference §05),
  and the seeded `user` role holds `devices.create` and **not**
  `accounts.manage` (§04) — so routing the dashboard through it replaces a
  working button with a guaranteed `403` for the one role that legitimately
  uses it. The hazard the decision names is real and is closed differently, as
  the study's §08 danger box prescribes: the create result's `account_id` is
  read, and a device that came back belonging to no account is reported as
  such. Presence and value are distinguished — an **absent** `account_id` means
  the caller may not see it, and only a **present, blank** one means the device
  belongs to nobody.
- **REQ-18 — Creation failures are reported as themselves.** A `404` means the
  account does not exist and nothing was created; a `409` means the device id is
  taken and was never taken over.
- **REQ-19 — Attaching an existing slot uses `POST /accounts/{account_id}/devices`.**
  Re-attaching to the same account is idempotent; a device that belongs elsewhere
  answers `409` and is shown as such.
- **REQ-20 — No "move a device between accounts" action is offered**, because
  there is no detach endpoint (`Q-6`).
- **REQ-21 — Pairing, logout, reconnect and delete stay on the existing device
  endpoints**, gated by `devices.pair` and `devices.delete`.
- **REQ-22 — A device `404` is "not available", never "forbidden".**
  *(Narrowed after the advisory panel — see finding SEC-6.)* The backend answers
  `404` with a body identical to a device that does not exist, deliberately, so
  a `404` may never be rendered as a statement about permission. A `403` is a
  different fact — the server refusing the *operation*, not hiding a device's
  existence — and continues to be reported as the permission refusal it is,
  through the existing `toActionErrorMessage`.
- **REQ-23 — The `404` echoes the submitted id**, which is what identifies the
  failing request; the id shown is the one that was sent.

### The device webhook

- **REQ-24 — The webhook surface is reached from a device inside the account**,
  reading with `GET /devices/{device_id}/webhook` and writing with
  `PATCH /devices/{device_id}/webhook`.
- **REQ-25 — It is gated by `devices.webhook.read` to open and
  `devices.webhook.write` to save.** Without the write permission the values are
  shown read-only rather than as an editable form that will be refused.
- **REQ-26 — `webhook_enabled` is read and shown.** A device that has never been
  disabled reports `true`, and so does a device with no webhook configuration at
  all — absence of configuration is not being silenced.
- **REQ-27 — The switch sends a real JSON boolean** through
  `PATCH /devices/{device_id}/webhook/enabled`. A string, a number or an omitted
  field is a `400` and nothing is written. The call is idempotent.
- **REQ-28 — The switch and the URL are different operations and the UI says so.**
  Emptying `webhook_url` is a deletion of the URL, the secret and the event list,
  after which events fall back to the deployment-wide webhook list. The UI states
  exactly that before an empty URL is saved.
- **REQ-29 — What `enabled: false` means is stated where the switch lives:**
  nothing delivered, nothing falling back, the AI agent bridge not called for
  that device — but messages still received and stored, and manual replies still
  working.
- **REQ-30 — Turning the switch back on resumes delivery** to the same URL with
  the same secret and event list, with no restart, no re-pairing and no value
  re-entered. The UI does not ask for anything to be re-entered.
- **REQ-31 — The stored secret is never rendered at all.**
  *(Added after the advisory panel — see finding SEC-1; strengthened during
  implementation.)* `webhook_secret` is a signing credential for the customer's
  endpoint, and this ticket widens who can open the panel that carries it. The
  panel reports **whether** a secret is set and offers to replace it; the stored
  value never reaches a rendered node. This is stronger than masking it in a
  field — a masked field still puts the real value in a DOM attribute any
  injected script can read — and it is what the repository's own executable
  source policy leaves available: `source-policy.test.ts` permits the substring
  `password` in four files only, so `type="password"` is not reachable here. The
  value stays in component state so an unrelated save cannot destroy it, and that
  state is cleared when the panel closes.
- **REQ-32 — Skipping TLS verification carries its consequence in words.**
  *(Added after the advisory panel — see finding SEC-2.)* The form already
  offers `webhook_insecure_skip_verify`, and this ticket is the one rewriting
  that form. Enabling it delivers the customer's events, signed with the secret
  above, over a channel whose peer is not authenticated.
- **REQ-33 — A webhook URL that is not `https:` is noticed, not refused.**
  *(Added after the advisory panel — see finding SEC-8.)* Events leave in clear
  text over `http:`. A private-network endpoint is a legitimate deployment, and
  the server is the authority, so this is a stated consequence rather than a
  client-side rejection.

## Non-functional requirements

- **NFR-1 — Every decision is testable without a renderer.** This repository has
  no component renderer in its test environment, so a decision written inside JSX
  is a decision no test can reach. What to send, which source a field came from,
  which rejection arrived and what a webhook save is about to destroy are pure
  functions with colocated tests.
- **NFR-2 — No request per row.** The screen issues a bounded number of queries
  for the whole tab, never one per device.
- **NFR-3 — No permission hook and no `<Can>` inside a `.map()`.** Permission
  booleans are hoisted once in the parent — the study's §13 rule 3, already
  executable in `src/lib/source-policy.test.ts`.
- **NFR-4 — The webhook secret is a credential on screen.** It is never logged,
  never placed in a URL, never rendered into a toast or an error message.
- **NFR-5 — Hiding a control is an affordance, never enforcement.** The server
  remains the only authority, and every permission check here is a UX decision.

## Constraints

- `src/api/` may gain the two missing device-webhook calls and nothing else; the
  nine account calls typed by ticket 6 are used as they are.
- No deployment runtime file is touched.
- No new runtime dependency: drag-and-drop is not worth a package here, and the
  order is changed with explicit move controls that are keyboard-operable.

## Acceptance criteria

| ID | Criterion | Requirements |
|----|-----------|--------------|
| **AC-1** | The devices tab lists exactly the devices `GET /accounts/{id}/devices` returned, in the order it returned them. | REQ-1, REQ-4 |
| **AC-2** | A row with no registry match is listed as belonging to the account with an "unknown / not loaded" state, never as `disconnected`. | REQ-3 |
| **AC-3** | A registry entry with no matching row does not appear in the membership list. | REQ-4 |
| **AC-4** | Connection state, display name and phone number on a joined row come from the registry entry; membership, priority and send state come from the row. | REQ-2, REQ-1 |
| **AC-5** | An executable source rule fails the build if the devices tab builds its list from the registry query. | REQ-5 |
| **AC-6** | Each row shows its position (1st, 2nd, …), and the raw `priority` number is rendered nowhere. | REQ-6 |
| **AC-7** | The screen states in words that the lower position is tried first. | REQ-7 |
| **AC-8** | Moving a device up or down submits every device id of the account, once each, in the new order. | REQ-8 |
| **AC-9** | The submitted order is derived from the row source, so a device the registry did not load is still in the payload. | REQ-8, REQ-3 |
| **AC-10** | A `400` from the order endpoint re-reads the rows and reports the refusal; it does not resubmit. | REQ-9 |
| **AC-11** | An account owning more than 256 devices does not submit an order; the reason is stated. | REQ-10 |
| **AC-12** | Blocking submits the `blocked` send state; unblocking submits the empty string. | REQ-11 |
| **AC-13** | The unblock payload reaches the wire with the empty string intact, and an executable rule keeps the account API module free of the payload-cleaning helper. | REQ-12 |
| **AC-14** | A blocked device keeps its position in the list and carries a badge; blocking never removes a row. | REQ-13, REQ-14 |
| **AC-15** | `fallback_allowed` is rendered with the words "allowed as fallback" and never "ready"; `fallback_reason` is shown when present. | REQ-15, REQ-16 |
| **AC-16** | Both fallback fields render nothing at all when absent, and their absence is not reported as a failure. | REQ-16 |
| **AC-17** | The create action **inside the account surface** issues `POST /accounts/{id}/devices/create` and no request to `POST /devices`. *(Narrowed — panel S-1.)* | REQ-17 |
| **AC-17a** | The generic dashboard create keeps `POST /devices` and reports a device whose returned `account_id` is **present and blank** as belonging to no account; an **absent** `account_id` is reported as nothing at all. *(Added — panel S-1.)* | REQ-17a |
| **AC-18** | An executable source rule fails the build if anything under `src/features/account-devices/` or `src/pages/account-detail.tsx` imports the generic `addDevice` client. *(Scoped to the surface — panel S-2.)* | REQ-17 |
| **AC-19** | A `404` from creation reports that the account does not exist and that nothing was created; a `409` reports that the id is taken and was not taken over. | REQ-18 |
| **AC-20** | The attach action issues `POST /accounts/{id}/devices`, and a `409` is reported as "that device belongs to another account". | REQ-19 |
| **AC-21** | No control anywhere offers moving or detaching a device from its account. | REQ-20 |
| **AC-22** | Pair, logout, reconnect and delete on a device row are offered only with `devices.pair` / `devices.delete`, and reuse the existing device endpoints. | REQ-21 |
| **AC-23** | A device `404` is rendered as "not available" and never as a statement about permission; the classifier's `404` arm is what an executable rule asserts. A `403` keeps the existing permission sentence. *(Narrowed — panel SEC-6.)* | REQ-22 |
| **AC-24** | The id shown in a device rejection is the id that was submitted. | REQ-23 |
| **AC-25** | The webhook panel opens only with `devices.webhook.read`; without `devices.webhook.write` its fields are read-only and no save control is offered. | REQ-24, REQ-25 |
| **AC-26** | `webhook_enabled` from the read is rendered as the switch's state, and a device with no webhook configuration shows the switch on rather than off. No switch is rendered before the read arrives, and a response omitting the field is labelled as *reported* on rather than shown as confirmed. *(Refined — panel S-7, SEC-9.)* | REQ-26 |
| **AC-27** | Toggling the switch sends a real JSON boolean to `PATCH /devices/{id}/webhook/enabled`, and nothing else. | REQ-27 |
| **AC-28** | Saving a form whose URL is empty is announced first as a deletion of the URL, the secret and the event list, and as a fallback of the device's events to the deployment-wide webhook. | REQ-28 |
| **AC-29** | Saving a non-empty URL is not announced as a deletion. | REQ-28 |
| **AC-30** | The four consequences of disabling — no delivery, no fallback, no agent bridge, messages still received — are stated where the switch lives. | REQ-29 |
| **AC-31** | Re-enabling asks for no value to be re-entered and sends only the switch call. | REQ-30 |
| **AC-32** | The webhook secret appears in no toast, no error message and no rendered command; a save that carried it never renders the server's own text back. *(Extended — panel SEC-7.)* | NFR-4 |
| **AC-35** | The stored secret is bound to no input and rendered nowhere; the panel states only whether one is set and offers a replacement field. Its state is cleared when the panel closes. *(Added — panel SEC-1, SEC-7; strengthened at implementation.)* | REQ-31 |
| **AC-36** | The TLS-verification switch states, where it lives, that enabling it sends the customer's signed events over a channel whose peer is not authenticated. *(Added — panel SEC-2.)* | REQ-32 |
| **AC-37** | A webhook URL whose scheme is not `https:` is saved, with a stated consequence rather than a refusal. *(Added — panel SEC-8.)* | REQ-33 |
| **AC-33** | Tests cover the left join on the rows, the complete-set order payload, the empty-string send state surviving the payload path, and the difference between disabling a webhook and clearing its URL. | NFR-1 |
| **AC-34** | The tab issues a bounded number of queries — no query, mutation or permission hook is instantiated per device row. | NFR-2, NFR-3 |

## Test cases

| ID | Given | When | Then | AC |
|----|-------|------|------|----|
| **TC-1** | An account device the registry did not load | The devices tab renders | The device is listed as belonging to the account, with state "unknown / not loaded", not `disconnected` | AC-1, AC-2 |
| **TC-2** | A registry device whose row is absent | The devices tab renders | It does not appear in the membership list | AC-3 |
| **TC-3** | A row and a registry entry for the same device | The join runs | Membership, priority and send state come from the row; state, name and phone come from the registry | AC-4 |
| **TC-4** | An account owning three devices, one not loaded by the registry | The order is changed | The payload carries all three ids, in the new order, with no duplicates, and no `400` for an incomplete set is produced | AC-8, AC-9 |
| **TC-5** | An order the server refuses with `400` | The refusal arrives | The rows are re-read and the refusal is reported; no resubmission is attempted | AC-10 |
| **TC-6** | An account owning 257 devices | A move is attempted | No request is issued and the 256-entry limit is stated | AC-11 |
| **TC-7** | A blocked device | It is unblocked | The payload carries the empty send state; no cleaning step removes the field; the device keeps its position | AC-12, AC-13, AC-14 |
| **TC-8** | A device with `fallback_allowed: false` and a reason | The row renders | The words "allowed as fallback" appear and "ready" does not; the reason is shown | AC-15 |
| **TC-9** | A device carrying neither fallback field | The row renders | Nothing about fallback is rendered and nothing is reported as missing | AC-16 |
| **TC-10** | The create-device action inside an account | A device is created | `POST /accounts/{id}/devices/create` is issued; no request to the generic create path is made | AC-17, AC-18 |
| **TC-11** | A create answering `409` | The failure is rendered | It reports that the id is taken and that nothing was taken over | AC-19 |
| **TC-12** | A device id belonging to a different account | It is attached | The `409` is reported as belonging to another account; a `404` elsewhere is reported as "not available" and never mentions permission | AC-20, AC-23 |
| **TC-13** | A device with a configured webhook | The webhook is disabled through the switch | The switch endpoint is called with `false`; the stored URL, secret and event list are unchanged; re-enabling resumes delivery without re-entering a value | AC-27, AC-31 |
| **TC-14** | A device with a configured webhook | The URL field is emptied and saved | The UI warns that this erases the URL, the secret and the event list, and that events then fall back to the deployment-wide webhook rather than stop | AC-28 |
| **TC-15** | A device with no webhook configuration | The panel opens | The switch reads as on, not off | AC-26 |
| **TC-16** | A principal holding `devices.webhook.read` and not `.write` | The panel opens | The values are shown read-only and no save control is offered | AC-25 |

## Out of scope

- The users tab of the account detail screen (ticket 10).
- The SMS fallback switch and the account settings tab (ticket 11).
- The accounts list and the account lifecycle (ticket 8, delivered).
- Drag-and-drop as a gesture: the order is changed with explicit move controls.
- Any new backend endpoint, and any answer to the open questions `Q-1`…`Q-8`
  beyond the safe assumptions the study already records.
