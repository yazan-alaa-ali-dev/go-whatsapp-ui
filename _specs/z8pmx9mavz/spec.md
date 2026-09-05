---
ticket: z8pmx9mavz
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-09-03
links:
  clickup: "https://app.clickup.com/t/z8pmx9mavz"
  github: ""
---

# Specification — 27 · Disable a device's webhook without deleting it

## Business goal

There is today exactly one way for an account admin to stop a device's webhook:
`PATCH /devices/{device_id}/webhook` with an empty `webhook_url`. That is a
**deletion**, and it is worse than useless for the job the admin actually has —
"stop the robot, let me answer this customer myself for ten minutes."

It fails in three separate ways at once:

1. **It destroys the settings.** `SetDeviceWebhookConfig`
   (`sqlite_repository.go:1686`) writes all four columns in one UPDATE, so
   clearing the URL also clears the secret and the event list. Re-enabling means
   re-entering them, and the secret is the one value the admin may no longer have.
2. **It does not stop the events — it redirects them.** With the device's URL
   gone, `webhookConfigFromRecord` returns `nil`, and
   `forwardPayloadToConfiguredWebhooks` falls straight through to
   `webhookURLs = config.WhatsappWebhook` (`webhook_forward.go:136`). The admin
   asked for silence and got a change of destination — to a deployment-wide
   endpoint they do not own.
3. **It does not stop the automatic reply.** The same URL is the AI agent
   endpoint (`agentEndpointFromRecord`, `agent_bridge.go:1326`), and clearing it
   makes the bridge fall back to `AGENT_WEBHOOK_URL` — so the customer keeps
   receiving generated answers, now from the global agent. The only switch that
   stops that is the `AGENT_WEBHOOK_URL` environment variable, which is
   deployment-wide and belongs to the operator, not to the account admin.

So the admin who wants to take over one conversation manually must either accept
that the agent keeps answering over their shoulder, or ask the operator to
restart the deployment with the bridge off for **every** account.

This ticket adds the one thing that is missing: a **per-device switch that
preserves the settings**. It is deliberately not a new configuration surface —
it is a single boolean column, one route, and two gates on paths that already
read the device row.

## User story

As **an Account Admin**, I want to **disable the webhook of a device in my
account without deleting its stored configuration**, so that **the automatic
reply driven by the webhook response stops, I can answer manually through the
send API, and I can re-enable it later with the same settings without entering
them again**.

## Functional requirements

- **REQ-1** A device row carries a **persistent enable flag**, defaulting to
  enabled, that survives restarts and is independent of every other device.
- **REQ-2** An authorized caller can set that flag through the REST API by naming
  the device and the desired boolean, and **nothing else** — the request neither
  carries nor requires `webhook_url`.
- **REQ-3** While the flag is off, **no webhook event leaves for that device** —
  not to its own URL, and not to the global `WHATSAPP_WEBHOOK` list. Disabling is
  silence, not redirection. *(Amended after panel review: "no event leaves" is a
  claim about the **webhook delivery path**, not about all automated processing.
  Two lenses independently observed that inbound speech-to-text, media
  auto-download, the built-in auto-reply and Chatwoot forwarding all run
  **upstream** of this gate and are unaffected. They are named in Out of scope so
  the promise is not read wider than it is.)*
- **REQ-4** While the flag is off, the **AI agent bridge is not run for that
  device**, so no reply generated from a webhook response reaches the customer.
- **REQ-5** Turning the flag back on restores delivery to the **same URL, secret,
  event list and TLS setting**, with nothing re-entered.
- **REQ-6** The stored webhook settings are **byte-unchanged** by a disable or an
  enable, and the existing `PATCH .../webhook` does not implicitly change the
  flag in either direction.
- **REQ-7** The current flag is **readable** through the existing
  `GET /devices/{device_id}/webhook`.
- **REQ-8** The operation is bounded by the **existing** device permissions and
  the existing device-ownership guard; no permission is added to the catalogue.
- **REQ-9** Every successful state write emits an **audit line** naming the
  actor, the device and the new state, and a **websocket broadcast** in the
  existing shape.
- **REQ-10** The new route is **documented** in the served OpenAPI document and
  is present in the route→permission matrix that the policy tests walk.

## Non-functional requirements

- **NFR-1** **No new read on any request path.** Both gates are placed where the
  device row has *already* been resolved by the existing code, so the per-event
  query count is unchanged. `TestWebhookForwardStorageCallCountIsUnchanged`
  (`webhook_account_routing_test.go:400`, exact equality: 1 read on the JID path,
  2 on the session-id fallback) and `TestReplyPathDeviceRowReadsMatchBaseline`
  (`agent_reply_routing_test.go:578`) must still pass **untouched** — which is
  only true because of the representation chosen in `plan.md > D-1`.
- **NFR-2** **Fail open on absence, fail closed on intent.** A device row that
  cannot be resolved, or a read that fails, behaves exactly as it does today
  (global fallback) — the switch must never turn a lookup failure into a
  deployment-wide outage. Only a row that *says* `false` silences anything.
- **NFR-3** **The default is enabled, and it is the column's default, not the
  application's.** The migration is append-only with `DEFAULT TRUE` and performs
  no backfill `UPDATE`, so an existing deployment's behaviour is bit-identical
  after the upgrade.
- **NFR-4** **The new column is visible on every device read path at once.** It
  is added to the single shared `deviceRoutingColumns` tail and its scan-target
  list, which is the mechanism that exists in this repository precisely to stop a
  column being visible on some read paths and zero-valued on others.
- **NFR-5** **The secret is never logged.** No new log line may carry
  `webhook_secret`, directly or through a struct.
- **NFR-6** No deployment runtime file is modified.
- **NFR-7** The change is reversible by reverting the code alone: a database that
  has run migration 75 works unchanged against the previous binary, which never
  names the column.

## Constraints

- **C-1** `getMigrations()` is **index-positional** — schema version N is
  `migrations[N-1]`. The new migration is **75, appended last**; inserting
  anywhere else renumbers every later migration. Four tests pin the count at 74
  and must be moved to 75 in the same change.
- **C-2** A migration is **one statement, no backfill `UPDATE`** — asserted by
  `sqlite_repository_account_test.go:62-87` — and must survive the dialect walk in
  `migrations_dialect_test.go`. *(Corrected after panel review: that walk covers
  **SQLite and PostgreSQL only**; there is no MySQL dialect in this repository, so
  a MySQL check is not a thing `/verify` can run.)*
- **C-3** Any change to an `IChatStorageRepository` signature must land in the
  concrete repository **and** in
  `infrastructure/whatsapp/chatstorage_wrapper.go`, which delegates the whole
  interface. A missing method is a build break; a wrong one is a silent
  cross-tenant write.
- **C-4** `AssertPolicyCoverage` refuses to boot when a `:device_id` route lacks
  the ownership guard, and `TestSection06CoversEveryRegisteredRoute` refuses to
  pass when a registered route is missing from the matrix. The new route must
  satisfy both.
- **C-5** Guard order on a route line is load-bearing: `Require(...)` first, then
  `owns`, then the handler. Fiber runs handlers first-argument-first, so a
  trailing guard is registered and never executed.
- **C-6** Go's zero value for `bool` is `false` — which, for a field named
  `WebhookEnabled`, reads as *disabled*. Every construction and read path of
  `DeviceRecord` must be accounted for, and the "row absent" case must be
  distinguished from the "row says false" case at the gate, never by the field's
  zero value. *(Sharpened after panel review: the repository holds **97
  `DeviceRecord{...}` literals across 18 test files**, plus five in production
  code. A plain `bool` field turns every one of them into a silently disabled
  device. The constraint is therefore not "be careful at the call sites" — it is
  that the representation must make the safe answer the zero value.)*
- **C-8** `resolveDeviceRowForWebhook`'s precedence — "the first row carrying a
  usable `webhook_url` wins, JID row before session row" — is **deliberate,
  documented and test-pinned** (`TestResolveDeviceRowJIDWebhookWins` asserts the
  session path runs **zero** times when the JID row has a webhook). This ticket
  reads that resolution; it does not redefine it. See AC-25.
- **C-7** The OpenAPI document exists in **two** copies: `docs/openapi.yaml` and
  the embedded `src/ui/rest/apidocs/openapi.yaml`, which is the one actually
  served at `/api-docs`. Both are updated or the served document is wrong.

## Acceptance criteria

### Storage and the default

- **AC-1** Migration **75** adds `devices.webhook_enabled` as a single
  append-only statement with `NOT NULL DEFAULT TRUE`, performs no backfill, and
  applies cleanly on SQLite and PostgreSQL. The migration count assertions move
  from 74 to 75.
- **AC-2** A device that existed before the upgrade, and a device created after
  it without naming the field, both read back **`webhook_enabled = true`**.
- **AC-3** The column is read on **every** device read path that carries the
  shared column tail — `GetDeviceRecord`, `GetDeviceRecordByJID`,
  `ListDeviceRecords` and both account-scoped device listings — so no path
  reports a device as disabled merely because the column was left out of its
  `SELECT`.
- **AC-4** Writing the flag touches **only** `webhook_enabled` and `updated_at`;
  `webhook_url`, `webhook_secret`, `webhook_events` and
  `webhook_insecure_skip_verify` are literally unchanged, verified by reading the
  row back.
- **AC-5** `PATCH /devices/{device_id}/webhook` (the existing settings route)
  does **not** write `webhook_enabled` in either direction: a disabled device
  whose URL is changed stays disabled, and an enabled one stays enabled.

### The endpoint

- **AC-6** `PATCH /devices/{device_id}/webhook/enabled` with body
  `{"enabled": false}` answers **200** with results
  `{"device_id": ..., "webhook_enabled": false}`, and with `{"enabled": true}`
  answers 200 and `webhook_enabled = true`.
- **AC-7** The request is **idempotent**: sending the same value twice yields the
  same 200 and the same body, and is not an error.
- **AC-8** A body whose `enabled` is a string (`"yes"`), a number, or absent
  entirely is refused with **400 `BAD_REQUEST`** and a structured
  `ResponseData` message, **before** any database write — the row is unchanged.
- **AC-9** Disabling a device that has **no** stored `webhook_url` succeeds; it
  is not an error, and the state applies once a URL is configured later.
- **AC-10** `GET /devices/{device_id}/webhook` returns a `webhook_enabled` field.
  It is `true` for a device that was never disabled and for a device whose
  webhook configuration row is absent entirely.

### Authorization and tenant safety

- **AC-11** The write requires `devices.webhook.write` and the read requires
  `devices.webhook.read`; **no new permission id is added to the catalogue**, and
  the catalogue's contents are unchanged by this ticket.
- **AC-12** A caller holding the `user` role — which holds neither permission —
  is refused **403 `PERMISSION_DENIED`**, and no write is performed.
- **AC-13** A caller naming a `device_id` owned by another account is refused
  **404 `DEVICE_NOT_FOUND`**, byte-identical to the answer for a `device_id` that
  does not exist, echoing the caller's own submitted string; the other account's
  device row is unchanged. A `super_admin` reaches any account's device, matching
  every other `:device_id` route.
- **AC-14** The new route appears in the `policy_matrix_test.go` route→permission
  table, and the boot-time `AssertPolicyCoverage` still passes on the real route
  set — i.e. the route carries both `Require(...)` and the ownership guard, in
  that order.

### Delivery behaviour

- **AC-15** While a device is disabled, an inbound event produces **no HTTP
  request to the device's webhook URL and no HTTP request to the global
  `WHATSAPP_WEBHOOK` list**. This holds for every event family, because all of
  them funnel through the one decision function.
- **AC-16** While a device is disabled, the **agent bridge performs no call**:
  no request reaches the agent endpoint and no generated reply is sent to the
  customer — including through the ticket-19 sibling failover, which is not
  reached because the bridge returns before any candidate is built.
- **AC-17** While a device is disabled, an inbound message is still **stored in
  chat storage** exactly as before, and the admin can still reply through
  `POST /send/message` and the other send endpoints under their existing
  `messages.send` permission. No send path consults the flag.
- **AC-18** Disabling one device has **no effect on any sibling** in the same
  account: an enabled sibling keeps delivering to its own URL and keeps running
  the bridge.
- **AC-19** Re-enabling restores delivery **immediately, on the first inbound
  event after the write** — no restart and no re-pairing — to the same URL with
  the same secret, because the gate is read per event from the row the path
  already loads.
- **AC-20** **Absence is not disablement.** A device whose row cannot be resolved
  (unknown JID, ambiguous companion slots) and a device whose row read *fails*
  both behave exactly as they do today: the global fallback still applies and the
  bridge still runs. Only a resolved row carrying `false` silences anything.

### Observability

- **AC-21** Every successful write emits one audit line in the existing
  `[ACCOUNTS] actor=... ` shape naming the actor, the device and the new state,
  and one `DEVICE_WEBHOOK_CONFIG_UPDATED` websocket broadcast carrying the
  device id, scoped to the device's account exactly as the sibling route is.
- **AC-22** An event skipped because of the disable records a **`debug`** line
  naming the device and the reason, so deliberate silence is distinguishable from
  a malfunction; the agent bridge records its own. Neither line, nor any other
  line added by this ticket, contains `webhook_secret`.
- **AC-23** A refusal caused by permission or ownership discloses nothing about
  the other account: the 403 and the 404 bodies are unchanged from the shapes the
  existing guards already produce.

### The stated limit

- **AC-25** **The flag is read off the row the delivery path resolves.** In the
  normal case — and in every case where the device has no `webhook_url` at all —
  that row is the arrival device, and the disable is honoured. Where a **stale row
  holds the JID and carries a usable `webhook_url`** while the live slot is
  resolved only through the registry (the blank-JID case
  `TestForwardPayload_DeviceRowWithBlankJID` pins), precedence gives the stale
  row, and **that row's flag governs** — so disabling the live slot does not
  silence events delivered through the stale row. This is a **stated limit, not a
  defect discovered later**: it is pinned by a test, it is the same row-identity
  ambiguity that already decides which `account_id` ticket 17 stamps on those
  events, and closing it would invert C-8's pinned precedence and cost a second
  query on every inbound event. *(Added after panel review: two lenses found this
  independently, from opposite directions — see `plan.md > Panel response`.)*

### Documentation

- **AC-24** `PATCH /devices/{device_id}/webhook/enabled` is documented in **both**
  copies of `openapi.yaml` with a request example and a response example, and the
  `get`/`patch` entries for `/devices/{device_id}/webhook` describe
  `webhook_enabled`. Errors are the existing `ResponseData` shape (`status`,
  `code`, `message`, `results`).

## Test cases

- **TC-1 — Admin disables an active device webhook.** Given an `admin` in the
  owning account and a device carrying a URL and a secret, `enabled=false`
  answers 200 with `webhook_enabled=false`; `GET .../webhook` then shows the same
  URL and secret; an audit line names the actor, device and state. *(AC-4, AC-6,
  AC-10, AC-21)*
- **TC-2 — No event and no auto-reply while disabled.** Given a disabled device
  and a configured global `WHATSAPP_WEBHOOK`, an inbound message produces no
  request to the device URL, none to the global list, and no agent call; the
  message is still stored. *(AC-15, AC-16, AC-17)*
- **TC-3 — Manual reply while disabled.** The admin's `POST /send/message`
  answers 200 and produces exactly one outbound message — the agent bridge adds
  no second, duplicate reply. *(AC-17)*
- **TC-4 — Re-enabling restores the stored configuration.** `enabled=true`
  answers 200; the next event reaches the same URL with the same secret; nothing
  was re-entered. *(AC-5, AC-19)*
- **TC-5 — Invalid payload is rejected.** `{"enabled":"yes"}` and `{}` both
  answer 400 `BAD_REQUEST`, and the row is unchanged. *(AC-8)*
- **TC-6 — Normal user is refused.** A `user`-role caller gets 403
  `PERMISSION_DENIED` and no write occurs. *(AC-12)*
- **TC-7 — Cross-account attempt is refused without disclosure.** An `admin` of
  account A aimed at a device of account B gets 404 `DEVICE_NOT_FOUND`, identical
  to a fictional id, and B's row is unchanged. *(AC-13)*
- **TC-8 — Existing devices keep working after the migration.** Rows created
  before migration 75 report `webhook_enabled = true` and keep delivering.
  *(AC-1, AC-2)*
- **TC-9 — Sibling isolation.** Disabling device A leaves device B in the same
  account delivering to its own URL and running the bridge. *(AC-18)*
- **TC-10 — The settings route does not move the flag.** `PATCH .../webhook` on a
  disabled device leaves it disabled. *(AC-5)*
- **TC-11 — Absence is not disablement.** An unresolvable JID and a failing row
  read both still fall back to the global list and still run the bridge. *(AC-20)*
- **TC-12 — The read count is unchanged.** The existing per-event query-count
  assertions pass with no edit. *(NFR-1)*
- **TC-13 — Idempotence.** The same request twice yields the same 200 body.
  *(AC-7)*
- **TC-14 — Route coverage.** The policy matrix and the boot coverage assertion
  both cover the new route. *(AC-14)*
- **TC-15 — The stated limit is pinned, not assumed.** A stale JID row carrying a
  usable webhook and `webhook_enabled = true`, beside a live session row carrying
  `false`, still delivers — and the assertion says in words that this is the
  documented limit, so a future reader meets it as a decision rather than as a
  surprise. *(AC-25)*
- **TC-16 — Disabled with no URL at all.** A disabled device with **no**
  `webhook_url` and a configured global `WHATSAPP_WEBHOOK` list delivers nothing.
  This is the case the deletion workaround gets wrong today and the one an admin
  is most likely to be in. *(AC-15, AC-9)*

## Out of scope

- **Any UI.** There is no embedded frontend surface for this in the repository;
  the REST API is the whole deliverable.
- **Account-level or deployment-level disable.** The switch is per device only.
- **The built-in auto-reply** (`handleAutoReply`, `WHATSAPP_AUTO_REPLY`). It is
  not driven by a webhook response, so the ticket's rationale does not reach it,
  and silencing it would be a behaviour change nobody asked for.
- **Inbound speech-to-text.** *(Added after panel review — two lenses.)* A voice
  note reaching a disabled device is still transcribed: `transcribeInboundAudio`
  runs at `event_message_handler.go:80`, upstream of both gates, and that is a
  billed third-party round trip. It is kept deliberately — the transcript is
  served by `messages.transcript.read` and stored with the message, and it is
  exactly what an admin answering **manually** wants to read. "Disable the
  webhook" is not "stop processing my messages".
- **Media auto-download.** *(Added after panel review.)* `buildMediaFields`
  fetches images, video, documents and audio from the WhatsApp CDN while building
  the payload, **before** the delivery gate, and the payload is then discarded.
  Gating earlier would mean resolving the device row in `forwardMessageToWebhook`
  — either a second query or a signature change to a function thirteen call sites
  share — and `handleImageMessage` downloads images independently of the webhook
  anyway. The attachment is also what the admin needs in order to answer by hand.
- **Footprint.** Disabling frees nothing: the whatsmeow client, its socket and its
  storage stay attached, and the Chatwoot forward goroutine and retry worker still
  run per event. The switch stops **outbound automation**, not resource use.
- **Chatwoot forwarding.** It is a separate integration with its own per-device
  configuration and its own disable; the ticket names the webhook and the agent
  bridge, and widening the switch to Chatwoot would silence a channel the admin
  did not ask about.
- **The sibling-as-transport question.** When an *enabled* device's reply fails
  over to a sibling under ticket 19, the sibling's own flag is not consulted: the
  flag governs whether a device's own arrivals drive automation, not whether the
  device may carry another device's reply. Recorded as a decision, not an
  omission — see `plan.md > Decisions`.
- **A new permission.** `devices.webhook.read`/`.write` already exist and are the
  right granularity; the catalogue is untouched.
- **Retro-fitting the existing `PATCH .../webhook` handler's other defect** — it
  echoes `webhook_secret` back in its response, and `GET .../webhook` does the
  same, so `devices.webhook.read` hands out the signing secret. Real, and left
  alone: it is pre-existing on a route this ticket only adds a field to. The new
  handler must not widen it — it returns `device_id` and `webhook_enabled` and
  nothing else, and never marshals a `DeviceWebhookConfig` wholesale. *(Trimmed
  after panel review: the claim that the existing handler "validates nothing" was
  false — it does reject a missing `webhook_url` with 400.)*
