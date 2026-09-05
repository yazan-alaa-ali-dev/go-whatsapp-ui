---
ticket: z8pmx9m6pg
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-09-03
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6pg"
  github: ""
---

# Specification — 28 · Fall back to SMS when every WhatsApp channel fails

## Business goal

The service has exactly one delivery failover today, and it is narrow.

Ticket 19 gave the **AI agent reply path** the ability to re-send an undelivered
reply once from a sibling device of the same account, ordered by `priority` and
skipping any device whose `send_state` is `blocked`
(`agent_reply_order.go > buildAttemptOrder`). When that sibling attempt also
fails — or when there is no sibling at all, which is every deployment that has
not configured an account — `deliverAgentReplyWithFailover` logs and abandons
the message.

The operator-facing send endpoints have **no failover whatsoever**.
`usecase.serviceSend.SendText` resolves one client from the request's device
context, and a whatsmeow error is returned to the caller unchanged. There is no
second device and no second channel.

So the state an account admin actually hits — every WhatsApp number in the
account logged out, blocked, or refused — ends in a message that is not
delivered and, on the agent path, is not even reported to anyone outside the log.

This ticket adds the one thing missing below the existing device chain: when
every WhatsApp channel available to the account has failed **and the failure
proves nothing reached WhatsApp**, the same plain text is delivered to the
recipient's dialable E.164 number through an HTTP SMS gateway configured at the
deployment level and enabled per account.

The stage is **last, never first**, and it is **armable per tenant**: an account
that has not asked for it behaves bit-identically to today.

## User story

As **an Account Admin**, I want **a text message that WhatsApp refused to accept
from every number in my account delivered to the same recipient as an SMS through
a configured SMS gateway**, so that **the customer still receives the message when
the account has no usable WhatsApp channel left, instead of the message being
silently dropped**.

## Functional requirements

- **REQ-1** An account row carries a **persistent SMS-fallback switch**,
  defaulting to OFF, independent of every other account and of every device.
- **REQ-2** An authorized caller can set that switch through the REST API by
  naming the account and the desired boolean, and nothing else. The switch is
  readable through the existing account read route.
- **REQ-3** The deployment carries **one** SMS gateway, configured entirely from
  the environment: destination URL, credential, sender id, timeout. The
  credential never enters the database, a response, or a log line.
- **REQ-4** When a text message fails on **every WhatsApp channel available to
  it**, and the account switch is on, and the deployment gateway is completely
  configured, the same text is sent once to the recipient's E.164 number.
- **REQ-5** The stage is reached **only** from a failure that proves nothing was
  handed to WhatsApp. A failure that occurred while sending ends the message.
- **REQ-6** At most **one** SMS per failed message, and the gateway is called at
  most **once** — no retry, and no further channel after it.
- **REQ-7** `POST /send/message` reports which channel delivered the message.
- **REQ-8** Every enable/disable, every SMS attempt and every skip is recorded on
  one log line each, in the vocabulary the account and agent paths already use.

## Non-functional requirements

- **NFR-1 Cost on the untouched deployment is zero.** A deployment with no
  gateway configured performs **no additional database read and no additional
  outbound call** on any send, successful or failed, and writes no log line above
  debug. The green path — a message WhatsApp accepted — reaches no part of the
  stage. *(Amended after panel review: the original wording said "no additional
  work", which the performance lens falsified from the plan's own text — the send
  path's liveness precheck reads `IsConnected`/`IsLoggedIn` a second time, ~30ns,
  on every successful text send. That cost is accepted and recorded rather than
  hidden behind a claim that is not true.)*
- **NFR-2 One rule, one home.** "Does this failure prove nothing was written?" is
  answered by a **single** function shared by both send paths. A second copy is
  how the duplicate-delivery guard desynchronises.
- **NFR-3 The stage is testable without a live WhatsApp client**: its decision
  rules are pure values, and its one I/O step sits behind a seam, matching
  `agent_reply_order.go` and `agentSendMessageFn`.
- **NFR-4 The tenant bound is not re-implemented.** The new route reuses
  `RequireAccountScope` + `requireAccount` exactly as the other account routes do,
  so its refusal is byte-identical to theirs.
- **NFR-5 Additive schema only.** One `ALTER TABLE ... ADD COLUMN` with a
  non-volatile default, no backfill `UPDATE`, no table rewrite; a rolled-back
  binary simply ignores the column.

## Constraints

- **C-1** No deployment runtime file is touched (`docker-compose.yml`,
  `docker/golang.Dockerfile`, `docker/entrypoint.sh`, the three workflows).
- **C-2** No new permission enters the catalogue (`pkg/auth/perm.go`).
- **C-3** Migrations are **index-positional** — schema version N is
  `migrations[N-1]` — so the new statement is **appended**, never inserted.
- **C-4** `infrastructure/whatsapp` may not import `usecase`. Anything shared by
  the agent path and the send usecase must live in a package both can import.
- **C-5** The existing sibling-device ordering rules are not changed.

## Scope decision recorded — what "every WhatsApp attempt available" means

The ticket says the SMS stage runs after "the requested or arrival device first,
then the eligible sibling device chain of the same account", while its Out of
scope forbids "any change to the existing sibling-device ordering rules" and its
narrative describes this ticket as adding "a **final** fallback stage **below the
existing device chain**".

Those reconcile in exactly one way, and the ticket's own test cases settle it:
the only test case naming a sibling — *"The sibling device is tried before SMS"* —
is written on the **agent reply path**. There is no test case asking
`POST /send/message` to try a second device.

So **"every WhatsApp attempt available for that message"** is read per path:

| Path | WhatsApp attempts available today | This ticket |
|---|---|---|
| Agent reply | arrival device, then at most one eligible sibling (ticket 19) | SMS after both |
| `POST /send/message` | the requested device only | SMS after it |

Adding a device chain to the operator send path is **out of scope** and named as
such below. It is a separate ticket, and building it here would rewrite ticket
19's ordering rules for a second caller — the one thing this ticket forbids.

## Acceptance criteria

### Scope and tenant safety

- **AC-1** The SMS fallback runs only for a message sent from a device that
  belongs to the caller's own account.
- **AC-2** An Account Admin can enable or disable the fallback **only** for their
  own account; a request naming another `account_id` is refused with
  `404 ACCOUNT_NOT_FOUND` and discloses nothing about that account.
- **AC-3** A `super_admin` may enable or disable it on any account, matching every
  other account-scoped route.
- **AC-4** The enable state is stored on the **account row** — never a global
  setting, never a per-device setting.
- **AC-5** Enabling it on one account has no effect on any other account in the
  same deployment.

### Authorization

- **AC-6** Enabling or disabling requires the existing `accounts.manage`
  permission.
- **AC-7** Reading the current state requires `accounts.manage` and is returned by
  the existing account read route.
- **AC-8** The ordinary `user` role holds neither and is refused
  `403 PERMISSION_DENIED`.
- **AC-9** Sending a message that may fall back to SMS requires only the existing
  `messages.send` permission; no additional permission is required at send time.
- **AC-10** No new permission is added to the permission catalogue.

### General behaviour

- **AC-11** The SMS stage is attempted **only** after every WhatsApp attempt
  available for that message has failed (see the scope decision above).
- **AC-12** It is attempted only when the account has the fallback enabled **and**
  the deployment carries a complete gateway configuration; otherwise the message
  fails exactly as it does today.
- **AC-13** The SMS recipient is the resolved phone-number JID converted to E.164.
  A recipient with no dialable number — a group JID, or an unresolved `@lid`
  identity — gets no SMS attempt.
- **AC-14** The SMS body is the plain text of the failed message, with no added
  prefix, suffix or provider branding.
- **AC-15** At most **one** SMS is sent per failed message. A message that already
  produced an SMS never produces a second one on any path.
- **AC-16** The stage runs at most **once** per message: a gateway failure is
  reported and the message ends there — the gateway is not retried and no further
  channel is tried.
- **AC-17** The stage carries its **own timeout budget**, independent of the
  WhatsApp attempt budgets, so a slow WhatsApp attempt can never leave it with no
  time to run.
- **AC-18** A successful SMS does **not** create a WhatsApp message row; the
  message is not shown in chat storage as if WhatsApp had delivered it.
- **AC-19** When the account has the fallback disabled, every send path behaves
  exactly as it does today.

### Fallback eligibility and delivery safety

- **AC-20** The stage is reached **only** from a failure that proves nothing was
  written to WhatsApp — a pre-send refusal: no live session, no usable transport,
  or a rejected recipient.
- **AC-21** A failure that occurred **while** sending, where WhatsApp may already
  hold the message, ends the message with an error and **must not** produce an SMS.
- **AC-22** A WhatsApp send that succeeded never triggers an SMS, including when
  the later chat-storage write of that message fails.
- **AC-23** A device whose `send_state` is `blocked` is skipped by the WhatsApp
  chain exactly as today, and its being skipped is a valid route into the SMS
  stage.
- **AC-24** Validation failures raised before any send is attempted — invalid
  phone, empty message, missing permission — are returned to the caller unchanged
  and never reach the SMS stage.

### Form fields

- **AC-25** `account_id` (URL path) and `sms_fallback_enabled` (body) are both
  required; an incomplete request is rejected **before any write is performed**.
  *(Amended after panel review. The ticket's wording is "before the database is
  touched"; satisfied literally it would force body validation ahead of the
  existence + tenant check, so a foreign `account_id` with a bad body would answer
  `400` while the same foreign id with a good body answers `404` — a
  cross-tenant oracle that tells an attacker which account ids exist. The
  existence/scope check stays first and nothing is written either way.)*
- **AC-26** Gateway credentials are **never** accepted in the request body.

### Configuration

- **AC-27** The gateway is configured by environment variables following the
  existing configuration style: gateway URL, credential, sender id, timeout.
- **AC-28** The credential is read from the environment at call time; it is never
  stored in the database, never returned in any response, and never written to a
  log line.
- **AC-29** An incomplete gateway configuration — any required variable empty —
  disables the stage for the whole deployment, stated **once at startup** as a
  single informational log line rather than repeated per message.
- **AC-30** Every configuration value carries a documented default, or is
  documented as required, in `src/.env.example`.

### Behaviour after saving

- **AC-31** A `200` to the enable/disable route returns `account_id` and
  `sms_fallback_enabled` with its new value.
- **AC-32** The change takes effect on the next send attempt, without restarting
  the service and without re-pairing any device.
- **AC-33** Enabling and disabling are **idempotent**: the same request repeated
  yields the same result and `200`.
- **AC-34** The existing account read route returns `sms_fallback_enabled` for
  every account.
- **AC-35** An account created before this ticket returns
  `sms_fallback_enabled = false`.
- **AC-36** The database migration is **append-only** with a default of `FALSE`.

### Validation and constraints

- **AC-37** A non-boolean `sms_fallback_enabled` — a string, a number, or a
  missing field — is rejected with `400 BAD_REQUEST` and a structured message, and
  the stored state is unchanged.
- **AC-38** An unknown `account_id` returns `404 ACCOUNT_NOT_FOUND` in the same
  non-disclosing shape as AC-2.
- **AC-39** Enabling the fallback while the deployment gateway is unconfigured is
  **allowed** and is not an error; the state is stored and takes effect once the
  gateway is configured.
- **AC-40** A gateway response that is not a success is treated as a failed SMS:
  the caller still receives the original WhatsApp send error, and the gateway
  failure is reported alongside it rather than replacing it.
- **AC-41** The SMS text is truncated only if the gateway documents a maximum
  length, and any truncation is recorded in the log line.

### API consistency

- **AC-42** There is no embedded UI for this feature, so REST is the only surface.
- **AC-43** `POST /send/message` reports which channel delivered the message, so a
  caller can tell an SMS delivery from a WhatsApp delivery from the response alone.
- **AC-44** The new route and the changed response fields are documented in
  `docs/openapi.yaml` and appear at `/api-docs` with request and response examples.
- **AC-45** Errors follow the existing `ResponseData` structure: `status`, `code`,
  `message`, `results`.
- **AC-46** The route-to-permission table in the policy matrix test carries a row
  for the new route.

### Audit and logging

- **AC-47** Every enable or disable writes an audit line naming the **actor**, the
  `account_id` and the new value, in the existing `[ACCOUNTS] actor=...` style.
- **AC-48** Every SMS fallback attempt writes one log line naming the account, the
  originating device, the message id, the outcome, and the coded reason the
  WhatsApp chain failed.
- **AC-49** A message that was eligible for SMS but skipped it writes one line
  stating the coded skip reason: fallback disabled, gateway unconfigured, no
  dialable number, or failure occurred during sending. *(Extended after panel
  review with three more reasons the closed list of four could not express, each
  naming a different operator action: `no_account` — the originating device
  belongs to no account, which is the majority state of every deployment that
  never configured one; `fallback_state_unknown` — the account read itself
  failed, which must not be reported as "disabled"; and `gateway_busy` — the
  stage's concurrency bound was full. `gateway_unconfigured` is recorded at
  **debug** level and nothing louder: it is the state of every deployment that
  has the feature off, its trigger is anyone who messages the number, and an
  info line there would let a stranger set this process's log volume — the
  unbounded-log pattern `agentRefusalWarnTTL` already exists to stop, and a
  direct contradiction of AC-29.)*
- **AC-50** The gateway credential and the message body are **never** written to
  any log line.
- **AC-51** A refusal caused by permission or ownership is logged without
  disclosing any data belonging to the other account.

## Test cases

- **TC-1 (AC-11, AC-12, AC-13, AC-14, AC-15, AC-43, AC-48)** — An account with the
  fallback enabled and a configured gateway; the requested device has no live
  session. Sending a text to a customer with a dialable number: the gateway
  receives exactly one SMS carrying the text unchanged, the response reports SMS
  as the delivering channel, and one log line records the account, device, message
  id and the coded WhatsApp failure reason.
- **TC-2 (AC-20, AC-21, AC-49)** — The WhatsApp attempt fails **after** the message
  was written to the socket. No gateway request is made, the caller receives the
  original send error, and one line records the skip reason
  `failure_during_sending`.
- **TC-3 (AC-11, AC-23)** — Agent path, account with two devices, the arrival
  without a live session and the sibling connected, fallback enabled. The reply is
  delivered over WhatsApp from the sibling and no gateway request is made.
- **TC-4 (AC-19, AC-49)** — Account with `sms_fallback_enabled = false` and a fully
  configured gateway. No gateway request is made, the caller receives exactly the
  error it receives today, and one line records `fallback_disabled`.
- **TC-5 (AC-39)** — A deployment whose gateway variables are empty. An Account
  Admin enabling the fallback on their own account gets `200` with
  `sms_fallback_enabled = true`, and no SMS is attempted for any message.
- **TC-6 (AC-13, AC-49)** — A recipient that resolves to no E.164 number. No
  gateway request is made and one line records `no_dialable_number`.
- **TC-7 (AC-16, AC-40)** — A gateway that answers with a failure. The caller
  receives the original WhatsApp send error, the gateway failure is recorded on its
  own line, and the gateway is called exactly once for that message.
- **TC-8 (AC-25, AC-37)** — `sms_fallback_enabled = "yes"` and an omitted field
  both answer `400 BAD_REQUEST` with a structured message; the stored state is
  unchanged.
- **TC-9 (AC-8, AC-10)** — A caller holding the `user` role is refused
  `403 PERMISSION_DENIED` and nothing is written.
- **TC-10 (AC-2, AC-5, AC-38, AC-51)** — An Account Admin in account A enabling on
  account B gets `404 ACCOUNT_NOT_FOUND`, not `403`; the body discloses nothing
  about B, and B's state is unchanged.
- **TC-11 (AC-19)** — An image send that fails on every WhatsApp channel produces
  no gateway request and returns the original send error.
- **TC-12 (AC-35, AC-36)** — A database holding accounts created before this ticket
  upgrades cleanly and every existing account reports
  `sms_fallback_enabled = false`.
- **TC-13 (AC-22)** — A WhatsApp send that succeeded but whose chat-storage write
  fails produces no gateway request.
- **TC-14 (AC-17)** — The SMS stage's deadline is derived from neither WhatsApp
  attempt's context: an attempt that consumed its whole budget still leaves the SMS
  stage its full one.
- **TC-15 (AC-29, AC-30)** — With any required gateway variable empty, the
  deployment logs one informational line at startup and the stage is off; the
  unconfigured state produces no per-message database read.
- **TC-16 (AC-31, AC-33, AC-34, AC-47)** — Enabling twice returns the same `200`
  body both times, the existing account read route reports the new value, and one
  audit line per call names actor, account and value.
- **TC-17 (AC-18)** — After a successful SMS, chat storage holds no message row for
  it.
- **TC-18 (AC-41)** — With a documented maximum length configured, a longer text is
  truncated to it and the log line records that it was truncated; with no maximum
  configured, the text is sent whole.

## Residual risk, recorded rather than solved

Recorded after panel review, because an operator should arm the gateway knowing
it and because the next ticket should inherit the finding intact.

1. **Any caller holding `messages.send` can spend the deployment's SMS budget**,
   one message per request, on any dialable E.164 number — including a number
   that is not on WhatsApp, which AC-20 explicitly makes eligible. There is no
   per-account or per-deployment spend cap in this ticket: capping spend is a
   feature with its own configuration and storage that no acceptance criterion
   asks for. What *is* bounded here: one failed message produces at most one SMS
   (AC-15), the gateway is never retried (AC-16), the stage is off unless the
   operator configured a gateway **and** the account admin armed the account, and
   the number must pass an 8–15 digit E.164 shape test. The exposure is stated in
   `src/.env.example` beside the gateway settings.
2. **`gowa mcp` and the Chatwoot outbound path are deliberately excluded.** Both
   reach the same `SendText`; MCP has no authentication of any kind, and the
   Chatwoot path would record a WhatsApp delivery that never happened. The stage
   is therefore opt-in per entry point and only `POST /send/message` opts in.
3. **On the agent path the stage runs while the message still holds an
   `agentCalls` slot**, growing the worst-case hold from 180s to 190s (−5% on the
   32-slot ceiling) during an account-wide outage. Releasing the slot earlier
   restructures ticket 19's concurrency design and is out of scope; the 10s
   gateway budget is the mitigation.

## Out of scope

- Media, sticker, contact, location and poll sends — SMS carries no equivalent
  payload. Only `POST /send/message` (text) and the agent reply path are in scope.
- Group recipients.
- Inbound SMS and SMS replies.
- Per-account gateway credentials; multiple gateways or a provider chain.
- **Adding a sibling-device chain to the operator send path** (see the scope
  decision above) — and any change to ticket 19's existing ordering rules.
- Any UI: there is no embedded frontend surface for this in the repository.
- Delivery receipts or status callbacks from the gateway.
- Retrying the gateway, queueing, or any store-and-forward behaviour.
